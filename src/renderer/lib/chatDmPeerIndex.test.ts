import { describe, expect, it } from 'vitest';

import {
  buildChatDmPeerIndex,
  chatDmPeerMessageCounts,
  mergeChatDmPeerDbRows,
} from './chatDmPeerIndex';
import type { ChatMessage } from './types';

const OWN = new Set([1]);

function msg(overrides: Partial<ChatMessage> & Pick<ChatMessage, 'channel'>): ChatMessage {
  return {
    sender_id: 2,
    sender_name: 'Alice',
    payload: 'hi',
    timestamp: 1000,
    status: 'acked',
    ...overrides,
  };
}

describe('buildChatDmPeerIndex', () => {
  it('indexes inbound and outbound Meshtastic DMs; ignores channel traffic', () => {
    const index = buildChatDmPeerIndex(
      [
        msg({ channel: 0, sender_id: 2, to: 1, timestamp: 1000 }),
        msg({ channel: 0, sender_id: 1, to: 2, timestamp: 2000 }),
        msg({ channel: 0, sender_id: 3, timestamp: 3000 }), // broadcast
        msg({ channel: 0, sender_id: 1, to: 4, timestamp: 4000 }),
      ],
      OWN,
      'meshtastic',
    );
    expect([...index.keys()].sort((a, b) => a - b)).toEqual([2, 4]);
    expect(index.get(2)?.lastMessageAt).toBe(2000);
    expect(index.get(2)?.messageCount).toBe(2);
    expect(index.get(4)?.messageCount).toBe(1);
  });

  it('ignores own-only and self messages', () => {
    const index = buildChatDmPeerIndex(
      [msg({ channel: 0, sender_id: 1, to: 1, timestamp: 1000 })],
      OWN,
      'meshtastic',
    );
    expect(index.size).toBe(0);
  });

  it('indexes MeshCore DMs on channel -1; skips roomServerId rows and excludeDmPeer', () => {
    const index = buildChatDmPeerIndex(
      [
        msg({ channel: -1, sender_id: 9, to: 1, timestamp: 1000 }),
        msg({ channel: -1, sender_id: 1, to: 10, timestamp: 2000 }),
        msg({
          channel: -1,
          sender_id: 11,
          to: 1,
          timestamp: 3000,
          roomServerId: 11,
        }),
        msg({ channel: -1, sender_id: 12, to: 1, timestamp: 4000 }),
      ],
      OWN,
      'meshcore',
      { excludeDmPeer: (peer) => peer === 12 },
    );
    expect([...index.keys()].sort((a, b) => a - b)).toEqual([9, 10]);
    expect(index.has(11)).toBe(false);
    expect(index.has(12)).toBe(false);
  });

  it('chatDmPeerMessageCounts matches index counts', () => {
    const messages = [
      msg({ channel: 0, sender_id: 2, to: 1, timestamp: 1000 }),
      msg({ channel: 0, sender_id: 1, to: 2, timestamp: 2000 }),
    ];
    const counts = chatDmPeerMessageCounts(messages, OWN, 'meshtastic');
    expect(counts.get(2)).toBe(2);
  });

  it('mergeChatDmPeerDbRows keeps newer lastMessageAt and existing counts', () => {
    const base = buildChatDmPeerIndex(
      [msg({ channel: 0, sender_id: 2, to: 1, timestamp: 1000 })],
      OWN,
      'meshtastic',
    );
    const merged = mergeChatDmPeerDbRows(base, [
      { node_id: 2, last_message_at: 5000 },
      { node_id: 7, last_message_at: 9000 },
    ]);
    expect(merged.get(2)?.lastMessageAt).toBe(5000);
    expect(merged.get(2)?.messageCount).toBe(1);
    expect(merged.get(7)?.lastMessageAt).toBe(9000);
  });

  it('mergeChatDmPeerDbRows keeps in-memory timestamp when DB is older', () => {
    const base = buildChatDmPeerIndex(
      [msg({ channel: 0, sender_id: 2, to: 1, timestamp: 8000 })],
      OWN,
      'meshtastic',
    );
    const merged = mergeChatDmPeerDbRows(base, [{ node_id: 2, last_message_at: 1000 }]);
    expect(merged.get(2)?.lastMessageAt).toBe(8000);
    expect(merged.get(2)?.messageCount).toBe(1);
  });

  it('mergeChatDmPeerDbRows ignores invalid peer ids', () => {
    const base = new Map<number, { lastMessageAt: number; messageCount: number }>();
    const merged = mergeChatDmPeerDbRows(base, [
      { node_id: 0, last_message_at: 1000 },
      { node_id: -3, last_message_at: 2000 },
      { node_id: Number.NaN, last_message_at: 3000 },
      { node_id: 5, last_message_at: 4000 },
    ]);
    expect([...merged.keys()]).toEqual([5]);
  });

  it('indexes inbound-only and outbound-only peers separately', () => {
    const inboundOnly = buildChatDmPeerIndex(
      [msg({ channel: 0, sender_id: 2, to: 1, timestamp: 1000 })],
      OWN,
      'meshtastic',
    );
    const outboundOnly = buildChatDmPeerIndex(
      [msg({ channel: 0, sender_id: 1, to: 3, timestamp: 2000 })],
      OWN,
      'meshtastic',
    );
    expect([...inboundOnly.keys()]).toEqual([2]);
    expect([...outboundOnly.keys()]).toEqual([3]);
  });
});
