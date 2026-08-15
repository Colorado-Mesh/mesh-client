import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  deserializeMeshcoreUserMessage,
  isDiagnosticTextI18n,
  MESHCORE_ERR_AUTH_FAILED,
  MESHCORE_REPEATER_AUTH_HINT_KEY,
  meshcoreAppendRepeaterAuthHint,
  meshcoreRepeaterAdminErrorMessage,
  meshcoreRepeaterAdminRpcErrorBudgetMs,
  meshcoreRepeaterRpcErrorMessage,
  meshcoreStoredUserMessage,
  meshcoreUserMessageKey,
  translateRepeaterCliHistoryText,
} from './meshcoreMessageI18n';

describe('meshcoreMessageI18n', () => {
  it('meshcoreUserMessageKey returns key for string refs', () => {
    expect(meshcoreUserMessageKey('meshcore.errors.notConnected')).toBe(
      'meshcore.errors.notConnected',
    );
    expect(meshcoreUserMessageKey('plain error')).toBeNull();
  });

  it('meshcoreAppendRepeaterAuthHint returns prefixed ref for auth failures', () => {
    const out = meshcoreAppendRepeaterAuthHint(MESHCORE_ERR_AUTH_FAILED);
    expect(out).toEqual({
      type: 'prefixed',
      message: MESHCORE_ERR_AUTH_FAILED,
      hintKey: MESHCORE_REPEATER_AUTH_HINT_KEY,
    });
  });

  it('meshcoreAppendRepeaterAuthHint leaves unrelated errors unchanged', () => {
    expect(meshcoreAppendRepeaterAuthHint('Request timed out (~10s)')).toBe(
      'Request timed out (~10s)',
    );
  });

  it('meshcoreRepeaterRpcErrorMessage maps timeout to timedOutApprox key', () => {
    const ref = meshcoreRepeaterRpcErrorMessage('login timeout', 10_000);
    expect(isDiagnosticTextI18n(ref) && ref.key).toBe('meshcore.errors.requestTimedOutApprox');
  });

  it('meshcoreRepeaterRpcErrorMessage maps trace-idle timeout to timedOutApprox key', () => {
    const ref = meshcoreRepeaterRpcErrorMessage('timeout waiting for trace', 120_000);
    expect(isDiagnosticTextI18n(ref) && ref.key).toBe('meshcore.errors.requestTimedOutApprox');
    if (isDiagnosticTextI18n(ref)) {
      expect(ref.params?.seconds).toBe(120);
    }
  });

  it('meshcoreRepeaterAdminRpcErrorBudgetMs uses ping-settle budget for ping wait errors', () => {
    expect(meshcoreRepeaterAdminRpcErrorBudgetMs('timeout waiting for ping', 120_000)).toBe(
      360_000,
    );
  });

  it('meshcoreRepeaterAdminErrorMessage translates i18n keys', () => {
    const t = ((key: string) =>
      key === 'meshcore.errors.notConnected' ? 'Not connected' : key) as TFunction;
    expect(meshcoreRepeaterAdminErrorMessage(t, new Error('meshcore.errors.notConnected'))).toBe(
      'Not connected',
    );
    expect(meshcoreRepeaterAdminErrorMessage(t, 'plain failure')).toBe('plain failure');
  });

  it('meshcoreStoredUserMessage round-trips prefixed refs', () => {
    const stored = meshcoreStoredUserMessage(MESHCORE_ERR_AUTH_FAILED);
    expect(stored.startsWith('\x1eMC_I18N:')).toBe(true);
    const parsed = deserializeMeshcoreUserMessage(stored);
    expect(parsed).toEqual({
      type: 'prefixed',
      message: MESHCORE_ERR_AUTH_FAILED,
      hintKey: MESHCORE_REPEATER_AUTH_HINT_KEY,
    });
  });

  it('translateRepeaterCliHistoryText translates serialized error lines', () => {
    const t = ((key: string, params?: { seconds?: number; detail?: string }) => {
      if (key === 'meshcore.errors.requestTimedOutApprox') {
        return `Request timed out (~${params?.seconds ?? '?'}s)`;
      }
      if (key === 'repeatersPanel.cliHistoryError') {
        return `[Error: ${params?.detail ?? ''}]`;
      }
      return key;
    }) as TFunction;
    const stored = meshcoreStoredUserMessage(
      meshcoreRepeaterRpcErrorMessage('CLI command timed out after 30000ms', 30_000),
    );
    expect(translateRepeaterCliHistoryText(t, 'received', `[Error: ${stored}]`)).toBe(
      '[Error: Request timed out (~30s)]',
    );
    expect(translateRepeaterCliHistoryText(t, 'sent', 'clock')).toBe('clock');
    expect(translateRepeaterCliHistoryText(t, 'received', '01:46 - 17/8/2026 UTC')).toBe(
      '01:46 - 17/8/2026 UTC',
    );
  });
});
