import { describe, expect, it } from 'vitest';

import { isRrcWhisperPeerHash, rrcWhisperDisplayLabel } from './rrcWhisperReply';

const peerA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('rrcWhisperReply re-exports', () => {
  it('exposes hash guard and display label', () => {
    expect(isRrcWhisperPeerHash(peerA)).toBe(true);
    expect(rrcWhisperDisplayLabel({ identity_hash: peerA, nickname: 'Zeva' })).toBe('Zeva');
    expect(rrcWhisperDisplayLabel({ identity_hash: peerA, nickname: null })).toBe(
      peerA.slice(0, 8),
    );
    expect(rrcWhisperDisplayLabel(null)).toBe('DM');
  });
});
