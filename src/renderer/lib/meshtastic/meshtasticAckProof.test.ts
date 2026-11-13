import { describe, expect, it } from 'vitest';

import { ackProofBadgeKey, isAckProofProven, normalizeAckProofStatus } from './meshtasticAckProof';

describe('normalizeAckProofStatus', () => {
  it('maps known enum values', () => {
    expect(normalizeAckProofStatus(0)).toBe('absent');
    expect(normalizeAckProofStatus(1)).toBe('valid');
    expect(normalizeAckProofStatus(2)).toBe('invalid');
    expect(normalizeAckProofStatus(3)).toBe('no_key');
  });

  it('treats nullish as absent and unknown numbers as unknown', () => {
    expect(normalizeAckProofStatus(null)).toBe('absent');
    expect(normalizeAckProofStatus(undefined)).toBe('absent');
    expect(normalizeAckProofStatus(99)).toBe('unknown');
    expect(normalizeAckProofStatus('ACK_PROOF_VALID')).toBe('valid');
  });
});

describe('ackProofBadgeKey', () => {
  it('only labels when the message is acked', () => {
    expect(ackProofBadgeKey('valid', 'sending')).toBeNull();
    expect(ackProofBadgeKey('valid', 'acked')).toBe('proven');
    expect(ackProofBadgeKey('invalid', 'acked')).toBe('failed');
    expect(ackProofBadgeKey('absent', 'acked')).toBe('relayedUnproven');
    expect(ackProofBadgeKey(undefined, 'acked')).toBeNull();
    expect(ackProofBadgeKey('unknown', 'acked')).toBe('unknown');
    expect(ackProofBadgeKey('no_key', 'acked')).toBe('noKey');
  });

  it('never treats unknown as proven', () => {
    expect(isAckProofProven('unknown')).toBe(false);
    expect(isAckProofProven('absent')).toBe(false);
    expect(isAckProofProven('valid')).toBe(true);
  });
});
