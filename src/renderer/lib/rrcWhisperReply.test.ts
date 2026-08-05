import { describe, expect, it } from 'vitest';

import type { RrcChatMessage } from '@/shared/rrc-types';

import {
  isRrcWhisperPeerHash,
  resolveRrcWhisperReplyTarget,
  rrcWhisperDisplayLabel,
} from './rrcWhisperReply';

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

describe('isRrcWhisperPeerHash', () => {
  it('accepts 32-hex hashes', () => {
    expect(isRrcWhisperPeerHash(peerA)).toBe(true);
    expect(isRrcWhisperPeerHash(peerA.toUpperCase())).toBe(true);
  });

  it('rejects short or empty values', () => {
    expect(isRrcWhisperPeerHash(null)).toBe(false);
    expect(isRrcWhisperPeerHash('')).toBe(false);
    expect(isRrcWhisperPeerHash('abcd')).toBe(false);
    expect(isRrcWhisperPeerHash('nick:alice')).toBe(false);
  });
});

describe('resolveRrcWhisperReplyTarget', () => {
  it('prefers the stored last whisper peer', () => {
    const result = resolveRrcWhisperReplyTarget({
      lastWhisperPeer: { identity_hash: peerA, nickname: 'Alice' },
      messages: [
        msg({
          id: '1',
          kind: 'notice',
          sender_hash: peerB,
          nickname: 'Bob',
          timestamp: 2,
        }),
      ],
      localIdentityHash: selfHash,
    });
    expect(result).toEqual({ identity_hash: peerA, nickname: 'Alice' });
  });

  it('ignores stored peer with invalid hash and falls back to messages', () => {
    const result = resolveRrcWhisperReplyTarget({
      lastWhisperPeer: { identity_hash: 'short', nickname: 'X' },
      messages: [
        msg({
          id: '1',
          kind: 'system',
          dst_hash: peerA,
          timestamp: 1,
        }),
      ],
    });
    expect(result).toEqual({ identity_hash: peerA, nickname: null });
  });

  it('uses newest outbound system dst_hash when store is empty', () => {
    const result = resolveRrcWhisperReplyTarget({
      lastWhisperPeer: null,
      messages: [
        msg({ id: '1', kind: 'system', dst_hash: peerA, timestamp: 1 }),
        msg({ id: '2', kind: 'system', dst_hash: peerB, timestamp: 2 }),
      ],
    });
    expect(result).toEqual({ identity_hash: peerB, nickname: null });
  });

  it('uses outbound msg dst_hash (room-style echo)', () => {
    const result = resolveRrcWhisperReplyTarget({
      lastWhisperPeer: null,
      messages: [
        msg({
          id: '1',
          kind: 'msg',
          body: 'hi',
          nickname: 'Me',
          sender_hash: selfHash,
          dst_hash: peerA,
          timestamp: 1,
        }),
      ],
      localIdentityHash: selfHash,
    });
    expect(result).toEqual({ identity_hash: peerA, nickname: null });
  });

  it('uses inbound sender_hash and skips local self', () => {
    const result = resolveRrcWhisperReplyTarget({
      lastWhisperPeer: null,
      messages: [
        msg({
          id: '1',
          kind: 'notice',
          sender_hash: selfHash,
          nickname: 'Me',
          timestamp: 1,
        }),
        msg({
          id: '2',
          kind: 'notice',
          sender_hash: peerA,
          nickname: 'Alice',
          timestamp: 2,
        }),
      ],
      localIdentityHash: selfHash,
    });
    expect(result).toEqual({ identity_hash: peerA, nickname: 'Alice' });
  });

  it('returns null when nothing resolves', () => {
    expect(
      resolveRrcWhisperReplyTarget({
        lastWhisperPeer: null,
        messages: [msg({ id: '1', kind: 'system', body: 'noise', timestamp: 1 })],
        localIdentityHash: selfHash,
      }),
    ).toBeNull();
  });
});

describe('rrcWhisperDisplayLabel', () => {
  it('prefers nickname, then hash prefix, then fallback', () => {
    expect(rrcWhisperDisplayLabel({ identity_hash: peerA, nickname: 'Zeva' })).toBe('Zeva');
    expect(rrcWhisperDisplayLabel({ identity_hash: peerA, nickname: null })).toBe(
      peerA.slice(0, 8),
    );
    expect(rrcWhisperDisplayLabel(null)).toBe('[whispers]');
  });
});
