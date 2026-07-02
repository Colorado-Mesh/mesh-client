import { describe, expect, it } from 'vitest';

import {
  deserializeMeshcoreUserMessage,
  isDiagnosticTextI18n,
  MESHCORE_ERR_AUTH_FAILED,
  MESHCORE_REPEATER_AUTH_HINT_KEY,
  meshcoreAppendRepeaterAuthHint,
  meshcoreRepeaterRpcErrorMessage,
  meshcoreStoredUserMessage,
  meshcoreUserMessageKey,
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
});
