/**
 * crash-report-dialog.test.ts
 *
 * Unit tests for the crash report URL builder, the consent flow, and the
 * self-throttling dialog. Matches the project's Vitest + vi.mock pattern for
 * Electron modules (see fatal-startup-dialog.test.ts) and the app_settings mock
 * pattern (see mqtt-broker-client-id.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory app_settings store backing the mocked database.
const store = new Map<string, string>();

vi.mock('electron', () => ({
  app: {
    getVersion: () => '5.22.0',
    isPackaged: true,
  },
  dialog: {
    showMessageBoxSync: vi.fn(() => 1),
  },
  shell: {
    openExternal: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('./database', () => ({
  getDatabase: () => ({
    prepareOnce: (sql: string) => ({
      get: (key: string) => {
        if (sql.includes('SELECT value')) {
          const value = store.get(key);
          return value != null ? { value } : undefined;
        }
        return undefined;
      },
      run: (key: string, value: string) => {
        if (sql.includes('INSERT OR REPLACE')) {
          store.set(key, value);
        }
        return { changes: 1 };
      },
    }),
  }),
}));

import { dialog, shell } from 'electron';

import {
  buildCrashReportUrl,
  CRASH_REPORT_CONSENT_SETTING_KEY,
  describeReportContents,
  hasStoredCrashReportConsent,
  redactSensitiveForReport,
  resetCrashReportCooldownForTests,
  showCrashReportDialog,
} from './crash-report-dialog';

const mockedShowMessageBoxSync = vi.mocked(dialog.showMessageBoxSync);
const mockedOpenExternal = vi.mocked(shell.openExternal);

/**
 * The crash flow shows up to two sequential dialogs (crash notice, then
 * consent). `queueDialogResponses` returns each queued button index in order.
 */
function queueDialogResponses(...responses: number[]): void {
  let i = 0;
  mockedShowMessageBoxSync.mockImplementation(() => responses[i++] ?? 1);
}

describe('buildCrashReportUrl', () => {
  it('builds a valid GitHub issue URL with error context', () => {
    const url = buildCrashReportUrl({
      source: 'uncaughtException',
      error: new Error('Cannot read properties of null'),
    });
    const params = new URL(url).searchParams;

    expect(url).toContain('https://github.com/Colorado-Mesh/mesh-client/issues/new');
    expect(params.get('template')).toBe('crash_report.md');
    expect(params.get('title')).toContain('[Crash]');
    expect(params.get('title')).toContain('Cannot read properties of null');
    expect(params.get('body')).toContain('uncaughtException');
  });

  it('includes platform and version in the body', () => {
    const url = buildCrashReportUrl({
      source: 'unhandledRejection',
      error: new Error('Network timeout'),
    });
    const body = new URL(url).searchParams.get('body') ?? '';

    expect(body).toContain('5.22.0');
    expect(body).toContain(process.arch);
  });

  it('handles string errors (not Error objects)', () => {
    const url = buildCrashReportUrl({
      source: 'uncaughtException',
      error: 'something broke',
    });
    const body = new URL(url).searchParams.get('body') ?? '';

    expect(body).toContain('something broke');
    expect(body).toContain('(no stack trace)');
  });

  it('truncates the URL to stay within the Windows-safe limit but keeps body content', () => {
    const longMessage = 'x'.repeat(10000);
    const url = buildCrashReportUrl({
      source: 'uncaughtException',
      error: new Error(longMessage),
    });
    const body = new URL(url).searchParams.get('body') ?? '';

    // Under Electron's 2081-char Windows cap for shell.openExternal.
    expect(url.length).toBeLessThanOrEqual(2000);
    expect(body).toContain('truncated');
    // The body must NOT collapse to only the truncation notice — real
    // diagnostic content (the crash source header) has to survive.
    expect(body).toContain('Crash source');
    expect(body.length).toBeGreaterThan(100);
  });

  it('keeps a normal-sized report URL under the Windows-safe limit', () => {
    const url = buildCrashReportUrl({
      source: 'unhandledRejection',
      error: new Error('a typical error message'),
    });
    expect(url.length).toBeLessThanOrEqual(2000);
  });

  it('truncates the title to 80 chars (plus the [Crash] prefix)', () => {
    const longMessage = 'A'.repeat(200);
    const url = buildCrashReportUrl({
      source: 'uncaughtException',
      error: new Error(longMessage),
    });

    const title = new URL(url).searchParams.get('title') ?? '';
    expect(title.length).toBeLessThanOrEqual(88);
  });
});

describe('describeReportContents', () => {
  it('lists exactly what will be included and reassures nothing is auto-sent', () => {
    const detail = describeReportContents({
      source: 'uncaughtException',
      error: new Error('boom'),
    });

    expect(detail).toContain('Crash source: uncaughtException');
    expect(detail).toContain('Operating system');
    expect(detail).toContain('App version');
    expect(detail).toContain('Error message and stack trace');
    expect(detail).toContain('nothing is sent automatically');
    // Must NOT claim to include logs, messages, identities or the database.
    expect(detail).toContain('No logs, message content, identities, or database contents');
  });
});

describe('redactSensitiveForReport', () => {
  it('redacts POSIX home-directory paths', () => {
    expect(redactSensitiveForReport('at /home/alex/app/index.js:10')).toBe(
      'at /home/<user>/app/index.js:10',
    );
    expect(redactSensitiveForReport('/Users/alex/Library/foo')).toBe('/Users/<user>/Library/foo');
  });

  it('redacts Windows user-profile paths', () => {
    expect(redactSensitiveForReport('C:\\Users\\Alex\\AppData\\x')).toBe(
      'C:\\Users\\<user>\\AppData\\x',
    );
  });

  it('redacts long hex identity/key hashes', () => {
    expect(redactSensitiveForReport('identity 862ccee13d81d8fdbcbc74ea44c26707 failed')).toBe(
      'identity <redacted-hex> failed',
    );
  });

  it('redacts key/value secrets', () => {
    expect(redactSensitiveForReport('password=hunter2')).toBe('password=<redacted>');
    expect(redactSensitiveForReport('token: abc123XYZ')).toBe('token: <redacted>');
  });

  it('redacts Authorization Bearer credentials', () => {
    expect(redactSensitiveForReport('Authorization: Bearer eyJhbGciOiJ.abc.def')).toBe(
      'Authorization: Bearer <redacted>',
    );
    expect(redactSensitiveForReport('failed with bearer sk-live-1234567890')).toBe(
      'failed with Bearer <redacted>',
    );
  });

  it('leaves ordinary error text unchanged', () => {
    const msg = 'Cannot read properties of null (reading foo)';
    expect(redactSensitiveForReport(msg)).toBe(msg);
  });
});

describe('buildCrashReportUrl redaction', () => {
  it('redacts sensitive values that appear in the error/stack', () => {
    const err = new Error('boom at /home/alex/secret with token=abcdef');
    err.stack = 'Error: boom\n    at /home/alex/app.js (862ccee13d81d8fdbcbc74ea44c26707)';
    const body =
      new URL(buildCrashReportUrl({ source: 'uncaughtException', error: err })).searchParams.get(
        'body',
      ) ?? '';

    expect(body).toContain('/home/<user>');
    expect(body).toContain('<redacted-hex>');
    expect(body).toContain('token=<redacted>');
    expect(body).not.toContain('/home/alex');
    expect(body).not.toContain('862ccee13d81d8fdbcbc74ea44c26707');
  });
});

describe('showCrashReportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    resetCrashReportCooldownForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
    // Default: dismiss the crash notice.
    mockedShowMessageBoxSync.mockReturnValue(1);
  });

  it('shows the crash notice with Report and Dismiss buttons', () => {
    showCrashReportDialog({ source: 'uncaughtException', error: new Error('test') });

    expect(mockedShowMessageBoxSync).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        buttons: ['Report on GitHub', 'Dismiss'],
      }),
    );
  });

  it('does not open the browser when the user dismisses the crash notice', () => {
    queueDialogResponses(1); // Dismiss

    const result = showCrashReportDialog({
      source: 'uncaughtException',
      error: new Error('test'),
    });

    expect(result).toBe(false);
    expect(mockedOpenExternal).not.toHaveBeenCalled();
  });

  it('shows a consent step before opening the browser', () => {
    queueDialogResponses(0, 1); // Report, then Allow once

    const result = showCrashReportDialog({
      source: 'uncaughtException',
      error: new Error('test'),
    });

    // Second dialog is the consent step.
    expect(mockedShowMessageBoxSync).toHaveBeenCalledTimes(2);
    expect(mockedShowMessageBoxSync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        buttons: ['Always allow', 'Allow once', 'Cancel'],
      }),
    );
    expect(result).toBe(true);
    expect(mockedOpenExternal).toHaveBeenCalledWith(
      expect.stringContaining('https://github.com/Colorado-Mesh/mesh-client/issues/new'),
    );
  });

  it('does not open the browser when the user cancels at the consent step', () => {
    queueDialogResponses(0, 2); // Report, then Cancel

    const result = showCrashReportDialog({
      source: 'uncaughtException',
      error: new Error('test'),
    });

    expect(mockedShowMessageBoxSync).toHaveBeenCalledTimes(2);
    expect(result).toBe(false);
    expect(mockedOpenExternal).not.toHaveBeenCalled();
  });

  it('does not persist consent when the user chooses "Allow once"', () => {
    queueDialogResponses(0, 1); // Report, Allow once

    showCrashReportDialog({ source: 'uncaughtException', error: new Error('test') });

    expect(store.get(CRASH_REPORT_CONSENT_SETTING_KEY)).toBeUndefined();
    expect(hasStoredCrashReportConsent()).toBe(false);
  });

  it('persists consent when the user chooses "Always allow"', () => {
    queueDialogResponses(0, 0); // Report, Always allow

    showCrashReportDialog({ source: 'uncaughtException', error: new Error('test') });

    expect(store.get(CRASH_REPORT_CONSENT_SETTING_KEY)).toBe('granted');
    expect(hasStoredCrashReportConsent()).toBe(true);
  });

  it('skips the consent step once "Always allow" has been stored', () => {
    // Pre-seed a granted consent.
    store.set(CRASH_REPORT_CONSENT_SETTING_KEY, 'granted');
    queueDialogResponses(0); // Only the crash notice → Report

    const result = showCrashReportDialog({
      source: 'uncaughtException',
      error: new Error('test'),
    });

    // Only the crash notice is shown — no consent dialog.
    expect(mockedShowMessageBoxSync).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
    expect(mockedOpenExternal).toHaveBeenCalled();
  });

  it('respects the 60s cooldown between dialogs', () => {
    mockedShowMessageBoxSync.mockReturnValue(1); // Dismiss each time

    showCrashReportDialog({ source: 'uncaughtException', error: new Error('first') });

    vi.advanceTimersByTime(30_000);
    showCrashReportDialog({ source: 'uncaughtException', error: new Error('second') });
    expect(mockedShowMessageBoxSync).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31_000);
    showCrashReportDialog({ source: 'uncaughtException', error: new Error('third') });
    expect(mockedShowMessageBoxSync).toHaveBeenCalledTimes(2);
  });

  it('fails silently when the native dialog is unavailable', () => {
    mockedShowMessageBoxSync.mockImplementation(() => {
      throw new Error('dialog unavailable');
    });

    const result = showCrashReportDialog({
      source: 'uncaughtException',
      error: new Error('test'),
    });

    expect(result).toBe(false);
    expect(mockedOpenExternal).not.toHaveBeenCalled();
  });
});
