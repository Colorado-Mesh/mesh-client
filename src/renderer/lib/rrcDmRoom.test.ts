import { describe, expect, it } from 'vitest';

import type { RrcChatMessage } from '@/shared/rrc-types';

import {
  isRrcDmRoom,
  isRrcLegacyWhispersRoom,
  isRrcWhisperPeerHash,
  parseRrcDmRoomKey,
  resolveRrcDmPeerFromDirectMessage,
  rrcDmDisplayLabel,
  rrcDmRoomKey,
  splitLegacyWhispersMessages,
} from './rrcDmRoom';

const peerA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const peerB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const selfHash = 'cccccccccccccccccccccccccccccccc';

function msg(
  partial: Partial<RrcChatMessage> & Pick<RrcChatMessage, 'id' | 'kind'>,
): RrcChatMessage {
  return {
    room: '[whispers]',
    body: 'hi',
    timestamp: 1,
    ...partial,
  };
}

describe('rrcDmRoom keys', () => {
  it('builds and parses @hash room keys', () => {
    expect(rrcDmRoomKey(peerA)).toBe(`@${peerA}`);
    expect(parseRrcDmRoomKey(`@${peerA.toUpperCase()}`)).toBe(peerA);
    expect(isRrcDmRoom(`@${peerA}`)).toBe(true);
    expect(isRrcDmRoom('#lobby')).toBe(false);
    expect(isRrcLegacyWhispersRoom('[whispers]')).toBe(true);
    expect(isRrcWhisperPeerHash('abcd')).toBe(false);
  });

  it('labels prefer nick then hash prefix', () => {
    expect(rrcDmDisplayLabel({ identity_hash: peerA, nickname: 'Zeva' })).toBe('Zeva');
    expect(rrcDmDisplayLabel({ identity_hash: peerA, nickname: null })).toBe(peerA.slice(0, 8));
    expect(rrcDmDisplayLabel(null)).toBe('DM');
  });
});

describe('resolveRrcDmPeerFromDirectMessage', () => {
  it('uses inbound sender as peer', () => {
    expect(
      resolveRrcDmPeerFromDirectMessage(
        { dst_hash: selfHash, sender_hash: peerA, nickname: 'Zeva' },
        selfHash,
      ),
    ).toEqual({ identity_hash: peerA, nickname: 'Zeva' });
  });

  it('uses dst when sender is self (outbound echo)', () => {
    expect(
      resolveRrcDmPeerFromDirectMessage(
        { dst_hash: peerA, sender_hash: selfHash, nickname: 'Me' },
        selfHash,
      ),
    ).toEqual({ identity_hash: peerA, nickname: null });
  });

  it('returns null without a valid dst_hash', () => {
    expect(
      resolveRrcDmPeerFromDirectMessage(
        { dst_hash: null, sender_hash: peerA, nickname: 'Zeva' },
        selfHash,
      ),
    ).toBeNull();
    expect(
      resolveRrcDmPeerFromDirectMessage(
        { dst_hash: 'short', sender_hash: peerA, nickname: 'Zeva' },
        selfHash,
      ),
    ).toBeNull();
  });

  it('defers when local identity is unavailable (outbound echo before init)', () => {
    // Self-sent echo would otherwise open a DM on the sender (self) if we trusted sender_hash.
    expect(
      resolveRrcDmPeerFromDirectMessage(
        { dst_hash: peerA, sender_hash: selfHash, nickname: 'Me' },
        null,
      ),
    ).toBeNull();
    expect(
      resolveRrcDmPeerFromDirectMessage(
        { dst_hash: peerA, sender_hash: selfHash, nickname: 'Me' },
        undefined,
      ),
    ).toBeNull();
    expect(
      resolveRrcDmPeerFromDirectMessage(
        { dst_hash: selfHash, sender_hash: peerA, nickname: 'Zeva' },
        null,
      ),
    ).toBeNull();
  });
});

describe('splitLegacyWhispersMessages', () => {
  it('buckets inbound and outbound into distinct @hash rooms', () => {
    const byRoom = splitLegacyWhispersMessages(
      [
        msg({
          id: '1',
          kind: 'notice',
          sender_hash: peerA,
          nickname: 'Alice',
          dst_hash: selfHash,
        }),
        msg({
          id: '2',
          kind: 'msg',
          sender_hash: selfHash,
          nickname: 'Me',
          dst_hash: peerB,
        }),
      ],
      selfHash,
    );
    expect([...byRoom.keys()].sort()).toEqual([`@${peerA}`, `@${peerB}`].sort());
    expect(byRoom.get(`@${peerA}`)?.[0]?.nickname).toBe('Alice');
    expect(byRoom.get(`@${peerB}`)?.[0]?.dst_hash).toBe(peerB);
  });

  it('skips self-only outbound rows that lack a peer dst', () => {
    const byRoom = splitLegacyWhispersMessages(
      [
        msg({
          id: '1',
          kind: 'msg',
          sender_hash: selfHash,
          nickname: 'Me',
          dst_hash: null,
        }),
        msg({
          id: '2',
          kind: 'notice',
          sender_hash: peerA,
          nickname: 'Alice',
          dst_hash: null,
        }),
      ],
      selfHash,
    );
    expect([...byRoom.keys()]).toEqual([`@${peerA}`]);
  });
});
