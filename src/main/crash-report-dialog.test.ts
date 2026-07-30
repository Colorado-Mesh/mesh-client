// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCrashReportUrl,
  type CrashContext,
  resetCrashDialogCooldownForTests,
  showCrashReportDialog,
} from './crash-report-dialog';

const mockShowMessageBoxSync = vi.fn().mockReturnValue(1); // default: Dismiss
const mockOpenExternal = vi.fn().mockResolvedValue(undefined);

vi.mock('electron', () => ({
  app: {
    getVersion: () => '5.24.1',
    isPackaged: true,
  },
  dialog: {
    showMessageBoxSync: (...args: unknown[]) => mockShowMessageBoxSync(...args),
  },
  shell: {
    openExternal: (...args: unknown[]) => mockOpenExternal(...args),
  },
}));

vi.mock('./sanitize-log-message', () => ({
  sanitizeLogMessage: (msg: string) => msg,
}));

afterEach(() => {
  vi.clearAllMocks();
  resetCrashDialogCooldownForTests();
});

describe('buildCrashReportUrl', () => {
  it('builds a valid GitHub issue URL with crash context', () => {
    const ctx: CrashContext = {
      source: 'uncaughtException',
      error: new Error('Cannot read properties of null'),
    };

    const url = buildCrashReportUrl(ctx);

    expect(url).toContain('https://github.com/Colorado-Mesh/mesh-client/issues/new');
    expect(url).toContain('template=crash_report.md');
    expect(url).toContain('Cannot+read+properties+of+null');
    expect(url).toContain('uncaughtException');
    expect(url).toContain('5.24.1');
  });

  it('includes platform and architecture info', () => {
    const ctx: CrashContext = {
      source: 'unhandledRejection',
      error: new Error('ENOENT'),
    };

    const url = decodeURIComponent(buildCrashReportUrl(ctx));

    expect(url).toContain(`App version: 5.24.1`);
    expect(url).toContain('Packaged: yes');
    expect(url).toContain(process.arch);
  });

  it('handles string errors', () => {
    const ctx: CrashContext = {
      source: 'uncaughtException',
      error: 'raw string error',
    };

    const url = buildCrashReportUrl(ctx);

    expect(url).toContain('raw+string+error');
    expect(url).toContain('no+stack+trace');
  });

  it('truncates URLs exceeding the max length', () => {
    const longMessage = 'x'.repeat(10_000);
    const ctx: CrashContext = {
      source: 'uncaughtException',
      error: new Error(longMessage),
    };

    const url = buildCrashReportUrl(ctx);

    expect(url.length).toBeLessThanOrEqual(8200); // allow slight encoding overhead
    expect(url).toContain('truncated');
  });

  it('truncates title to 80 chars', () => {
    const longMessage = 'A'.repeat(200);
    const ctx: CrashContext = {
      source: 'uncaughtException',
      error: new Error(longMessage),
    };

    const url = buildCrashReportUrl(ctx);
    const params = new URLSearchParams(url.split('?')[1]);
    const title = params.get('title') ?? '';

    // [Crash] + space + 80 chars = 88 max
    expect(title.length).toBeLessThanOrEqual(88);
  });
});

describe('showCrashReportDialog', () => {
  it('shows dialog and returns false when user dismisses', () => {
    mockShowMessageBoxSync.mockReturnValue(1);

    const ctx: CrashContext = {
      source: 'uncaughtException',
      error: new Error('test error'),
    };

    const result = showCrashReportDialog(ctx);

    expect(result).toBe(false);
    expect(mockShowMessageBoxSync).toHaveBeenCalledOnce();
    expect(mockOpenExternal).not.toHaveBeenCalled();
  });

  it('opens browser and returns true when user clicks Report', () => {
    mockShowMessageBoxSync.mockReturnValue(0);

    const ctx: CrashContext = {
      source: 'uncaughtException',
      error: new Error('test error'),
    };

    const result = showCrashReportDialog(ctx);

    expect(result).toBe(true);
    expect(mockOpenExternal).toHaveBeenCalledOnce();
    expect(mockOpenExternal.mock.calls[0][0]).toContain(
      'https://github.com/Colorado-Mesh/mesh-client/issues/new',
    );
  });

  it('respects 60s cooldown between dialogs', () => {
    mockShowMessageBoxSync.mockReturnValue(1);

    const ctx: CrashContext = {
      source: 'uncaughtException',
      error: new Error('first'),
    };

    showCrashReportDialog(ctx);
    const secondResult = showCrashReportDialog(ctx);

    expect(secondResult).toBe(false);
    expect(mockShowMessageBoxSync).toHaveBeenCalledOnce();
  });

  it('shows dialog again after cooldown resets', () => {
    mockShowMessageBoxSync.mockReturnValue(1);

    const ctx: CrashContext = {
      source: 'uncaughtException',
      error: new Error('test'),
    };

    showCrashReportDialog(ctx);
    resetCrashDialogCooldownForTests();
    showCrashReportDialog(ctx);

    expect(mockShowMessageBoxSync).toHaveBeenCalledTimes(2);
  });

  it('passes error type in dialog options', () => {
    mockShowMessageBoxSync.mockReturnValue(1);

    const ctx: CrashContext = {
      source: 'uncaughtException',
      error: new Error('something broke'),
    };

    showCrashReportDialog(ctx);

    const options = mockShowMessageBoxSync.mock.calls[0][0] as Record<string, unknown>;
    expect(options.type).toBe('error');
    expect(options.buttons).toEqual(['Report on GitHub', 'Dismiss']);
    expect(options.detail).toContain('something broke');
    expect(options.detail).toContain('uncaughtException');
  });

  it('handles dialog unavailable gracefully', () => {
    mockShowMessageBoxSync.mockImplementation(() => {
      throw new Error('dialog unavailable');
    });

    const ctx: CrashContext = {
      source: 'uncaughtException',
      error: new Error('test'),
    };

    expect(() => showCrashReportDialog(ctx)).not.toThrow();
    expect(showCrashReportDialog(ctx)).toBe(false);
  });

  it('handles string errors in dialog detail', () => {
    mockShowMessageBoxSync.mockReturnValue(1);

    const ctx: CrashContext = {
      source: 'unhandledRejection',
      error: 'non-Error rejection value',
    };

    showCrashReportDialog(ctx);

    const options = mockShowMessageBoxSync.mock.calls[0][0] as Record<string, unknown>;
    expect(options.detail).toContain('non-Error rejection value');
  });
});
