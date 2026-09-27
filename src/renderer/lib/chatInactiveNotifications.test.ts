import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/renderer/lib/types';

import {
  CHAT_NOTIF_MUTED_STORAGE_KEY,
  resolveInactiveChatNotification,
  resolveInactiveChatNotificationType,
} from './chatInactiveNotifications';

const ownNodes = new Set([1]);

function msg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    channel: 0,
    sender_id: 2,
    text: 'hi',
    timestamp: 1000,
    ...overrides,
  } as ChatMessage;
}

describe('resolveInactiveChatNotification', () => {
  it('returns the newest unmuted message with its view key', () => {
    const older = msg({ id: 1, channel: 1, timestamp: 1 });
    const newer = msg({ id: 2, channel: 2, timestamp: 2 });
    const muted = msg({ id: 3, channel: 0, timestamp: 3 });
    const result = resolveInactiveChatNotification({
      newMessages: [older, newer, muted],
      allMessages: [older, newer, muted],
      protocol: 'meshtastic',
      ownNodeIds: ownNodes,
      ownSenderId: 1,
      mutedViews: new Set(['ch:0']),
      notifGloballyMuted: false,
    });
    expect(result?.type).toBe('channel');
    expect(result?.message).toBe(newer);
    expect(result?.viewKey).toBe('ch:2');
  });

  it('skips own messages', () => {
    expect(
      resolveInactiveChatNotification({
        newMessages: [msg({ sender_id: 1 })],
        allMessages: [msg({ sender_id: 1 })],
        protocol: 'meshtastic',
        ownNodeIds: ownNodes,
        ownSenderId: 1,
        mutedViews: new Set(),
        notifGloballyMuted: false,
      }),
    ).toBeNull();
  });
});

describe('resolveInactiveChatNotificationType', () => {
  it('returns null when globally muted', () => {
    expect(
      resolveInactiveChatNotificationType({
        newMessages: [msg()],
        allMessages: [msg()],
        protocol: 'meshtastic',
        ownNodeIds: ownNodes,
        ownSenderId: 1,
        mutedViews: new Set(),
        notifGloballyMuted: true,
      }),
    ).toBeNull();
  });

  it('returns null when all new messages are in muted views', () => {
    expect(
      resolveInactiveChatNotificationType({
        newMessages: [msg({ channel: 0 })],
        allMessages: [msg({ channel: 0 })],
        protocol: 'meshtastic',
        ownNodeIds: ownNodes,
        ownSenderId: 1,
        mutedViews: new Set(['ch:0']),
        notifGloballyMuted: false,
      }),
    ).toBeNull();
  });

  it('returns channel for unmuted channel traffic', () => {
    expect(
      resolveInactiveChatNotificationType({
        newMessages: [msg({ channel: 1 })],
        allMessages: [msg({ channel: 1 })],
        protocol: 'meshtastic',
        ownNodeIds: ownNodes,
        ownSenderId: 1,
        mutedViews: new Set(['ch:0']),
        notifGloballyMuted: false,
      }),
    ).toBe('channel');
  });

  it('returns dm for direct messages', () => {
    expect(
      resolveInactiveChatNotificationType({
        newMessages: [msg({ channel: 0, to: 1, sender_id: 2 })],
        allMessages: [msg({ channel: 0, to: 1, sender_id: 2 })],
        protocol: 'meshtastic',
        ownNodeIds: ownNodes,
        ownSenderId: 1,
        mutedViews: new Set(),
        notifGloballyMuted: false,
      }),
    ).toBe('dm');
  });

  it('returns reply for replies to own messages', () => {
    const parent = msg({ channel: 0, sender_id: 1, packetId: 100, timestamp: 500 });
    const reply = msg({ channel: 0, sender_id: 2, replyId: 100, timestamp: 1000 });
    expect(
      resolveInactiveChatNotificationType({
        newMessages: [reply],
        allMessages: [parent, reply],
        protocol: 'meshtastic',
        ownNodeIds: ownNodes,
        ownSenderId: 1,
        mutedViews: new Set(),
        notifGloballyMuted: false,
      }),
    ).toBe('reply');
  });

  it('returns null for own messages, tapbacks, and history', () => {
    expect(
      resolveInactiveChatNotificationType({
        newMessages: [
          msg({ sender_id: 1 }),
          msg({ emoji: 0x1f44d, replyId: 42 }),
          msg({ isHistory: true }),
        ],
        allMessages: [],
        protocol: 'meshtastic',
        ownNodeIds: ownNodes,
        ownSenderId: 1,
        mutedViews: new Set(),
        notifGloballyMuted: false,
      }),
    ).toBeNull();
  });

  it('exports the global mute storage key used by App', () => {
    expect(CHAT_NOTIF_MUTED_STORAGE_KEY).toBe('mesh-client:notifMuted');
  });
});
