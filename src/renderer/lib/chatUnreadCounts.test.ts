import { describe, expect, it } from 'vitest';

import {
  computeChannelUnreadCounts,
  computeDmUnreadCounts,
  totalUnreadCount,
} from './chatUnreadCounts';
import type { ChatMessage } from './types';

const ownNodes = new Set([1]);

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

describe('chatUnreadCounts', () => {
  it('counts unread channel messages newer than last-read watermark', () => {
    const counts = computeChannelUnreadCounts(
      [msg({ channel: 0, timestamp: 2000 }), msg({ channel: 1, timestamp: 3000 })],
      { 'ch:0': 1500 },
      ownNodes,
      'meshtastic',
    );
    expect(counts.get(0)).toBe(1);
    expect(counts.get(1)).toBe(1);
  });

  it('skips history rehydration rows and own messages', () => {
    const counts = computeChannelUnreadCounts(
      [
        msg({ channel: 0, isHistory: true }),
        msg({ channel: 0, sender_id: 1 }),
        msg({ channel: 0, to: 1 }),
      ],
      {},
      ownNodes,
      'meshtastic',
    );
    expect(counts.size).toBe(0);
  });

  it('counts DM unread separately from channels', () => {
    const dmCounts = computeDmUnreadCounts(
      [msg({ channel: 0, to: 1, timestamp: 2000 })],
      {},
      ownNodes,
      'meshtastic',
    );
    expect(dmCounts.get(2)).toBe(1);
  });

  it('totalUnreadCount sums channel and DM unreads', () => {
    const total = totalUnreadCount(
      [msg({ channel: 0, timestamp: 2000 }), msg({ channel: 1, to: 1, timestamp: 2000 })],
      {},
      ownNodes,
      'meshcore',
    );
    expect(total).toBe(2);
  });

  it('counts device-timestamp message unread despite client-clock lastRead watermark', () => {
    const clientNow = 1_700_000_000_000;
    const deviceTs = clientNow - 60_000;
    const counts = computeChannelUnreadCounts(
      [msg({ channel: 0, timestamp: deviceTs })],
      { 'ch:0': clientNow },
      ownNodes,
      'meshcore',
    );
    expect(counts.get(0)).toBeUndefined();
  });

  it('excludes MeshCore room BBS posts from channel unread', () => {
    const total = totalUnreadCount(
      [
        msg({ channel: -2, roomServerId: 0xabc, timestamp: 2000 }),
        msg({ channel: 0, timestamp: 2000 }),
      ],
      {},
      ownNodes,
      'meshcore',
    );
    expect(total).toBe(1);
  });
});
