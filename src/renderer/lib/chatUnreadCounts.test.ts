import { describe, expect, it, vi } from 'vitest';

import {
  chatViewKeyForMessage,
  computeChannelUnreadCounts,
  computeDmUnreadCounts,
  hasAudibleBackgroundMessages,
  pickAudibleNotificationType,
  resolveChatNotificationType,
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

  it('ignores broadcast unread on channels not configured on the connected radio', () => {
    const counts = computeChannelUnreadCounts(
      [msg({ channel: 0, timestamp: 2000 }), msg({ channel: 1, timestamp: 3000 })],
      {},
      ownNodes,
      'meshtastic',
      Date.now(),
      { configuredChannelIndices: new Set([0]) },
    );
    expect(counts.get(0)).toBe(1);
    expect(counts.get(1)).toBeUndefined();
    const total = totalUnreadCount(
      [msg({ channel: 0, timestamp: 2000 }), msg({ channel: 1, timestamp: 3000 })],
      {},
      ownNodes,
      'meshtastic',
      undefined,
      { configuredChannelIndices: new Set([0]) },
    );
    expect(total).toBe(1);
  });

  it('ignores MeshCore broadcast unread on unconfigured channel slots', () => {
    const total = totalUnreadCount(
      [msg({ channel: 0, timestamp: 2000 }), msg({ channel: 1, timestamp: 3000 })],
      {},
      ownNodes,
      'meshcore',
      undefined,
      { configuredChannelIndices: new Set([0]) },
    );
    expect(total).toBe(1);
  });

  it('does not filter channels when configuredChannelIndices is empty', () => {
    const counts = computeChannelUnreadCounts(
      [msg({ channel: 0, timestamp: 2000 }), msg({ channel: 1, timestamp: 3000 })],
      {},
      ownNodes,
      'meshtastic',
      Date.now(),
      { configuredChannelIndices: new Set() },
    );
    expect(counts.get(0)).toBe(1);
    expect(counts.get(1)).toBe(1);
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

  it('excludes MeshCore room-server peers from DM unread when requested', () => {
    const dmCounts = computeDmUnreadCounts(
      [msg({ channel: 0, to: 1, timestamp: 2000 })],
      {},
      ownNodes,
      'meshcore',
      { excludeDmPeer: (peer) => peer === 2 },
    );
    expect(dmCounts.size).toBe(0);
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

  it('does not count future poison rows toward channel unread (RTC skew)', () => {
    vi.useFakeTimers();
    const nowMs = 1_700_000_000_000;
    vi.setSystemTime(nowMs);
    const futurePoison = nowMs + 8 * 365 * 24 * 3600 * 1000;
    const legitBot = nowMs - 60_000;
    const counts = computeChannelUnreadCounts(
      [
        msg({ channel: 4, timestamp: futurePoison, sender_id: 99 }),
        msg({ channel: 4, timestamp: legitBot, sender_id: 99 }),
      ],
      { 'ch:4': 0 },
      ownNodes,
      'meshcore',
      nowMs,
    );
    expect(counts.get(4)).toBe(1);
    vi.useRealTimers();
  });

  it('counts device-timestamp message unread when lastRead used client clock from poison mark-read', () => {
    const nowMs = 1_700_000_000_000;
    const deviceTs = nowMs - 60_000;
    const counts = computeChannelUnreadCounts(
      [msg({ channel: 0, timestamp: deviceTs })],
      { 'ch:0': nowMs },
      ownNodes,
      'meshcore',
      nowMs,
    );
    expect(counts.get(0)).toBeUndefined();
  });

  it('counts inbound after lastRead when watermark matches newest legitimate message only', () => {
    const nowMs = 1_700_000_000_000;
    const olderBot = nowMs - 120_000;
    const newerBot = nowMs - 30_000;
    const counts = computeChannelUnreadCounts(
      [
        msg({ channel: 4, timestamp: olderBot, sender_id: 99 }),
        msg({ channel: 4, timestamp: newerBot, sender_id: 99 }),
      ],
      { 'ch:4': olderBot },
      ownNodes,
      'meshcore',
      nowMs,
    );
    expect(counts.get(4)).toBe(1);
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

  it('counts DB-hydrated MeshCore messages as unread when lastRead is behind', () => {
    const counts = computeChannelUnreadCounts(
      [msg({ channel: 1, timestamp: 5000 })],
      { 'ch:1': 1000 },
      ownNodes,
      'meshcore',
    );
    expect(counts.get(1)).toBe(1);
  });

  it('counts DB-hydrated Meshtastic messages as unread when lastRead is behind (parity guard)', () => {
    const counts = computeChannelUnreadCounts(
      [msg({ channel: 1, timestamp: 5000 })],
      { 'ch:1': 1000 },
      ownNodes,
      'meshtastic',
    );
    expect(counts.get(1)).toBe(1);
  });

  it('does not count DB-hydrated MeshCore messages marked isHistory (MsgWaiting backlog)', () => {
    const counts = computeChannelUnreadCounts(
      [msg({ channel: 1, timestamp: 5000, isHistory: true })],
      { 'ch:1': 1000 },
      ownNodes,
      'meshcore',
    );
    expect(counts.size).toBe(0);
  });

  it('does not count MeshCore DM with to:0 as channel unread on ch:-1', () => {
    const counts = computeChannelUnreadCounts(
      [msg({ channel: -1, to: 0, timestamp: 2000 })],
      {},
      ownNodes,
      'meshcore',
    );
    expect(counts.size).toBe(0);
  });

  it('counts MeshCore DM with to:0 in DM unread using sender as peer', () => {
    const dmCounts = computeDmUnreadCounts(
      [msg({ channel: -1, to: 0, timestamp: 2000 })],
      {},
      ownNodes,
      'meshcore',
    );
    expect(dmCounts.get(2)).toBe(1);
  });

  it('MeshCore DM with to:0 does not inflate totalUnread via phantom ch:-1', () => {
    const total = totalUnreadCount(
      [msg({ channel: -1, to: 0, timestamp: 2000 })],
      {},
      ownNodes,
      'meshcore',
    );
    expect(total).toBe(1);
  });
});

describe('chatViewKeyForMessage', () => {
  it('maps MeshCore channel traffic to ch:N', () => {
    expect(chatViewKeyForMessage(msg({ channel: 0 }), 'meshcore', ownNodes)).toBe('ch:0');
  });

  it('maps MeshCore DM with to:0 to dm:sender (not ch:-1)', () => {
    expect(
      chatViewKeyForMessage(msg({ channel: -1, to: 0, sender_id: 2 }), 'meshcore', ownNodes),
    ).toBe('dm:2');
  });
});

describe('hasAudibleBackgroundMessages', () => {
  it('returns false when all messages are on muted views', () => {
    const messages = [msg({ channel: 0, timestamp: 2000 })];
    expect(hasAudibleBackgroundMessages(messages, 'meshcore', new Set(['ch:0']), ownNodes)).toBe(
      false,
    );
  });

  it('returns true when at least one message is on an unmuted view', () => {
    const messages = [msg({ channel: 1, timestamp: 2000 })];
    expect(hasAudibleBackgroundMessages(messages, 'meshcore', new Set(['ch:0']), ownNodes)).toBe(
      true,
    );
  });

  it('returns false when every new message matches a muted DM key', () => {
    const messages = [msg({ channel: -1, to: 0, sender_id: 2, timestamp: 2000 })];
    expect(hasAudibleBackgroundMessages(messages, 'meshcore', new Set(['dm:2']), ownNodes)).toBe(
      false,
    );
  });

  it('returns true when DM mute key does not match chatViewKeyForMessage peer', () => {
    const messages = [msg({ channel: -1, to: 0, sender_id: 2, timestamp: 2000 })];
    expect(hasAudibleBackgroundMessages(messages, 'meshcore', new Set(['ch:-1']), ownNodes)).toBe(
      true,
    );
  });
});

describe('resolveChatNotificationType', () => {
  it('classifies channel messages', () => {
    const messages = [msg({ channel: 0 })];
    expect(resolveChatNotificationType(messages[0], messages, ownNodes, 'meshtastic')).toBe(
      'channel',
    );
  });

  it('classifies DMs', () => {
    const messages = [msg({ channel: 0, to: 1, sender_id: 2 })];
    expect(resolveChatNotificationType(messages[0], messages, ownNodes, 'meshtastic')).toBe('dm');
  });

  it('classifies replies to own messages', () => {
    const parent = msg({ channel: 0, sender_id: 1, packetId: 100, timestamp: 500 });
    const reply = msg({ channel: 0, sender_id: 2, replyId: 100, timestamp: 1000 });
    const messages = [parent, reply];
    expect(resolveChatNotificationType(reply, messages, ownNodes, 'meshtastic')).toBe('reply');
  });

  it('returns null for tapbacks', () => {
    const reaction = msg({ channel: 0, emoji: 0x1f44d, replyId: 42 });
    expect(resolveChatNotificationType(reaction, [reaction], ownNodes, 'meshtastic')).toBeNull();
  });

  it('classifies DM replies to own messages as reply', () => {
    const parent = msg({ channel: 0, sender_id: 1, packetId: 100, timestamp: 500, to: 1 });
    const reply = msg({ channel: 0, sender_id: 2, replyId: 100, timestamp: 1000, to: 1 });
    const messages = [parent, reply];
    expect(resolveChatNotificationType(reply, messages, ownNodes, 'meshtastic')).toBe('reply');
  });
});

describe('pickAudibleNotificationType', () => {
  it('returns null when all messages are muted', () => {
    const messages = [msg({ channel: 0, timestamp: 2000 })];
    expect(pickAudibleNotificationType(messages, 'meshtastic', new Set(['ch:0']), ownNodes)).toBe(
      null,
    );
  });

  it('returns channel for unmuted channel traffic', () => {
    const messages = [msg({ channel: 1, timestamp: 2000 })];
    expect(pickAudibleNotificationType(messages, 'meshtastic', new Set(['ch:0']), ownNodes)).toBe(
      'channel',
    );
  });

  it('picks dm over channel in a batch', () => {
    const messages = [
      msg({ channel: 0, timestamp: 2000 }),
      msg({ channel: 0, to: 1, sender_id: 2, timestamp: 3000 }),
    ];
    expect(pickAudibleNotificationType(messages, 'meshtastic', new Set(), ownNodes)).toBe('dm');
  });

  it('picks reply over channel in a batch', () => {
    const parent = msg({ channel: 0, sender_id: 1, packetId: 100, timestamp: 500 });
    const channelMsg = msg({ channel: 0, timestamp: 2000 });
    const reply = msg({ channel: 0, sender_id: 2, replyId: 100, timestamp: 3000 });
    const messages = [parent, channelMsg, reply];
    expect(pickAudibleNotificationType(messages, 'meshtastic', new Set(), ownNodes)).toBe('reply');
  });

  it('skips history and own messages', () => {
    const messages = [
      msg({ channel: 0, isHistory: true }),
      msg({ channel: 0, sender_id: 1 }),
      msg({ channel: 0, emoji: 0x1f44d, replyId: 99 }),
    ];
    expect(pickAudibleNotificationType(messages, 'meshtastic', new Set(), ownNodes)).toBe(null);
  });

  it('resolves reply parents from allMessages when batch only contains the reply', () => {
    const parent = msg({ channel: 0, sender_id: 1, packetId: 100, timestamp: 500 });
    const reply = msg({ channel: 0, sender_id: 2, replyId: 100, timestamp: 1000 });
    expect(
      pickAudibleNotificationType([reply], 'meshtastic', new Set(), ownNodes, undefined, [
        parent,
        reply,
      ]),
    ).toBe('reply');
  });
});
