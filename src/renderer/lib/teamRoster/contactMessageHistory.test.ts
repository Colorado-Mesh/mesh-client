import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/renderer/lib/types';

import { buildContactMessageTimeline } from './contactMessageHistory';
import type { LinkPresenceSnapshot } from './contactPresence';

function msg(
  partial: Partial<ChatMessage> & Pick<ChatMessage, 'sender_id' | 'payload' | 'timestamp'>,
): ChatMessage {
  return {
    sender_name: 'x',
    channel: 0,
    ...partial,
  };
}

describe('contactMessageHistory', () => {
  it('merges multi-protocol DMs for linked peers', () => {
    const snaps: LinkPresenceSnapshot[] = [
      {
        link: { protocol: 'meshtastic', durableKey: '10', nodeId: 10, onRoster: false },
        peerNodeId: 10,
        lastHeardMs: 1,
        status: 'online',
        displayName: 'A',
      },
      {
        link: { protocol: 'reticulum', durableKey: 'aa'.repeat(16), onRoster: false },
        peerNodeId: 99,
        lastHeardMs: 2,
        status: 'online',
        displayName: 'B',
      },
    ];
    const timeline = buildContactMessageTimeline(snaps, {
      meshtastic: [
        msg({ sender_id: 10, to: 1, payload: 'hi lora', timestamp: 100, channel: 0 }),
        msg({ sender_id: 99, to: 1, payload: 'other', timestamp: 200 }),
      ],
      meshcore: [],
      reticulum: [
        msg({
          sender_id: 99,
          payload: 'hi rns',
          timestamp: 300,
          reticulum_sender_hash: 'aa'.repeat(16),
        }),
      ],
    });
    expect(timeline.map((t) => t.message.payload)).toEqual(['hi rns', 'hi lora']);
    expect(timeline[0]?.protocol).toBe('reticulum');
  });

  it('ignores reaction-only rows', () => {
    const snaps: LinkPresenceSnapshot[] = [
      {
        link: { protocol: 'meshtastic', durableKey: '10', nodeId: 10, onRoster: false },
        peerNodeId: 10,
        lastHeardMs: 1,
        status: 'online',
        displayName: null,
      },
    ];
    const timeline = buildContactMessageTimeline(snaps, {
      meshtastic: [
        msg({ sender_id: 10, payload: '👍', timestamp: 1, emoji: 1, replyId: 5 }),
        msg({ sender_id: 10, payload: 'hello', timestamp: 2 }),
      ],
      meshcore: [],
      reticulum: [],
    });
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.message.payload).toBe('hello');
  });
});
