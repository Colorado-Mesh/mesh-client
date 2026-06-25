import { describe, expect, it } from 'vitest';

import { isPairingRelatedError, markPairingRelatedError } from './blePairingError';

describe('blePairingError', () => {
  it('marks and detects pairing-related errors', () => {
    const err = markPairingRelatedError('pairing failed', true);
    expect(isPairingRelatedError(err)).toBe(true);
    expect(err.message).toBe('pairing failed');
  });

  it('does not tag non-pairing errors', () => {
    const err = markPairingRelatedError('timeout', false);
    expect(isPairingRelatedError(err)).toBe(false);
    expect(isPairingRelatedError(new Error('other'))).toBe(false);
    expect(isPairingRelatedError('string')).toBe(false);
  });
});
