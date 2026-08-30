import { describe, expect, it } from 'vitest';

import {
  applyRrcHistoryNicksToMembers,
  collectRrcNicksForHub,
  collectRrcNicksFromMessages,
} from '@/renderer/lib/rrcMemberNicksFromHistory';
import type { RrcChatMessage } from '@/shared/rrc-types';

function msg(over: Partial<RrcChatMessage>): RrcChatMessage {
  return {
    id: over.id ?? 'm1',
    room: 'general',
    kind: 'msg',
    body: 'hi',
    timestamp: over.timestamp ?? 1,
    ...over,
  };
}

describe('collectRrcNicksFromMessages', () => {
  it('keeps the newest nick per sender and skips placeholders', () => {
    const nicks = collectRrcNicksFromMessages([
      msg({ id: 'a', sender_hash: 'AABBCCDDEEFF0011', nickname: 'old' }),
      msg({ id: 'b', sender_hash: 'aabbccddeeff0011', nickname: 'qbit' }),
      msg({ id: 'c', sender_hash: '1122334455667788', nickname: 'anonymous' }),
      msg({ id: 'd', sender_hash: 'short', nickname: 'nope' }),
      msg({ id: 'e', nickname: 'noHash' }),
    ]);
    expect(nicks).toEqual([{ hash: 'aabbccddeeff0011', nickname: 'qbit' }]);
  });
});

describe('collectRrcNicksForHub', () => {
  const hub = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  it('gathers nicks from every room of one hub only', () => {
    const messages = new Map<string, RrcChatMessage[]>([
      [`${hub}::general`, [msg({ id: 'g', sender_hash: '1111111111111111', nickname: 'Runr' })]],
      [`${hub}::lobby`, [msg({ id: 'l', sender_hash: '2222222222222222', nickname: 'qbit' })]],
      [
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb::general',
        [msg({ id: 'o', sender_hash: '3333333333333333', nickname: 'OtherHub' })],
      ],
    ]);
    expect(
      collectRrcNicksForHub(messages, hub)
        .map((n) => n.nickname)
        .sort(),
    ).toEqual(['Runr', 'qbit']);
    expect(collectRrcNicksForHub(messages, null)).toEqual([]);
  });
});

describe('applyRrcHistoryNicksToMembers', () => {
  it('labels hash-only members from transcript nicks and prefers the fuller hash', () => {
    const out = applyRrcHistoryNicksToMembers(
      [{ identity_hash: '39f97a577058', nickname: null }],
      collectRrcNicksFromMessages([msg({ sender_hash: '39f97a577058aabb', nickname: 'K90-X' })]),
    );
    expect(out).toEqual([{ identity_hash: '39f97a577058aabb', nickname: 'K90-X' }]);
  });

  it('never overwrites a nick the hub supplied', () => {
    const out = applyRrcHistoryNicksToMembers(
      [{ identity_hash: '39f97a577058', nickname: 'FromWho' }],
      collectRrcNicksFromMessages([msg({ sender_hash: '39f97a577058', nickname: 'FromChat' })]),
    );
    expect(out[0]?.nickname).toBe('FromWho');
  });

  it('leaves unknown hashes and synthetic nick keys untouched', () => {
    const members = [
      { identity_hash: 'deadbeefdeadbeef', nickname: null },
      { identity_hash: 'nick:runr', nickname: null },
    ];
    expect(applyRrcHistoryNicksToMembers(members, [])).toEqual(members);
    expect(
      applyRrcHistoryNicksToMembers(
        members,
        collectRrcNicksFromMessages([msg({ sender_hash: 'ffffffffffff', nickname: 'x' })]),
      ),
    ).toEqual(members);
  });
});
