import { describe, expect, it } from 'vitest';

import {
  coalesceRrcMemberRoster,
  dedupeRrcMembers,
  rrcIdentityHashesMatch,
} from './rrcRoomMembers';

describe('rrcIdentityHashesMatch', () => {
  it('matches full identity to rrcd /who 12-hex prefix', () => {
    expect(rrcIdentityHashesMatch('aabbccddeeff00112233445566778899', 'aabbccddeeff')).toBe(true);
    expect(rrcIdentityHashesMatch('aabbccddeeff', 'aabbccddeeff00112233445566778899')).toBe(true);
    expect(rrcIdentityHashesMatch('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbb')).toBe(false);
  });
});

describe('coalesceRrcMemberRoster', () => {
  it('upgrades /who prefixes to full hashes and keeps known nicks', () => {
    const existing = [
      {
        identity_hash: 'aabbccddeeff00112233445566778899',
        nickname: 'Alice',
      },
      {
        identity_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        nickname: 'Bob',
      },
    ];
    const who = [
      { identity_hash: 'aabbccddeeff', nickname: 'Alice' },
      { identity_hash: 'bbbbbbbbbbbb', nickname: null },
      { identity_hash: 'cccccccccccc', nickname: 'Carol' },
    ];
    expect(coalesceRrcMemberRoster(who, existing)).toEqual([
      { identity_hash: 'aabbccddeeff00112233445566778899', nickname: 'Alice' },
      { identity_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', nickname: 'Bob' },
      { identity_hash: 'cccccccccccc', nickname: 'Carol' },
    ]);
  });

  it('keeps unmatched existing peers when /who is truncated', () => {
    const existing = [
      { identity_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nickname: 'Alice' },
      { identity_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', nickname: 'Bob' },
    ];
    const who = [{ identity_hash: 'aaaaaaaaaaaa', nickname: 'Anonymous' }];
    expect(coalesceRrcMemberRoster(who, existing)).toEqual([
      { identity_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nickname: 'Alice' },
      { identity_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', nickname: 'Bob' },
    ]);
  });

  it('does not let placeholder Anonymous wipe a known nick', () => {
    const existing = [{ identity_hash: 'aabbccddeeff00112233445566778899', nickname: 'Alice' }];
    const who = [{ identity_hash: 'aabbccddeeff', nickname: 'Anonymous' }];
    expect(coalesceRrcMemberRoster(who, existing)).toEqual([
      { identity_hash: 'aabbccddeeff00112233445566778899', nickname: 'Alice' },
    ]);
  });
});

describe('dedupeRrcMembers', () => {
  it('collapses full-hash self with /who prefix self', () => {
    expect(
      dedupeRrcMembers([
        { identity_hash: 'aabbccddeeff00112233445566778899', nickname: 'me' },
        { identity_hash: 'aabbccddeeff', nickname: 'me' },
      ]),
    ).toEqual([{ identity_hash: 'aabbccddeeff00112233445566778899', nickname: 'me' }]);
  });
});
