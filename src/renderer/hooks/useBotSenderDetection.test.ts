import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage, MeshProtocol } from '../lib/types';
import { useBotSendersStore } from '../stores/botSendersStore';
import { scanForBotSenders, useBotSenderDetection } from './useBotSenderDetection';

function msg(id: number, sender_id: number, payload: string): ChatMessage {
  return { id, sender_id, sender_name: `n${sender_id}`, payload, channel: 0, timestamp: id };
}

const BOT_REPLY = '[1a2b] @[alice] | 2 hops, 2-byte hashes, SNR -1.25 | recv 21:25:45';

describe('scanForBotSenders', () => {
  it('marks senders of bot replies and skips self, unknown, and ordinary chat', () => {
    const onBot = vi.fn();
    scanForBotSenders(
      [msg(1, 10, 'hello'), msg(2, 11, BOT_REPLY), msg(3, 99, BOT_REPLY), msg(4, 0, BOT_REPLY)],
      new Set(),
      99,
      onBot,
    );
    expect(onBot.mock.calls).toEqual([[11]]);
  });

  it('skips already-seen messages but still checks older rows inserted by hydration', () => {
    const seen = new Set<string>();
    const first = [msg(5, 10, BOT_REPLY)];
    const onBot = vi.fn();
    scanForBotSenders(first, seen, 99, onBot);
    expect(onBot).toHaveBeenCalledTimes(1);

    onBot.mockClear();
    scanForBotSenders(
      [
        msg(1, 13, BOT_REPLY),
        ...first,
        msg(6, 12, 'Air: tx 1s rx 2s | rx flood 0 direct 0 | tx flood 0 direct 0'),
      ],
      seen,
      99,
      onBot,
    );
    expect(onBot.mock.calls).toEqual([[12], [13]]);
  });

  it('defers scanning until the local node id is known', () => {
    const seen = new Set<string>();
    const messages = [msg(1, 99, BOT_REPLY), msg(2, 11, BOT_REPLY)];
    const onBot = vi.fn();
    scanForBotSenders(messages, seen, null, onBot);
    expect(onBot).not.toHaveBeenCalled();
    expect(seen.size).toBe(0);

    scanForBotSenders(messages, seen, 99, onBot);
    expect(onBot.mock.calls).toEqual([[11]]);
  });
});

describe('useBotSenderDetection', () => {
  beforeEach(() => {
    useBotSendersStore.setState({
      senders: { meshtastic: new Set(), meshcore: new Set(), reticulum: new Set() },
    });
  });

  it('feeds the bot senders store per protocol as messages arrive', () => {
    const self: Record<MeshProtocol, number | null> = {
      meshtastic: 1000,
      meshcore: 2000,
      reticulum: 3000,
    };
    const initial: Record<MeshProtocol, ChatMessage[]> = {
      meshtastic: [msg(1, 5, '🤖 Copy, 4 hops at 12:51')],
      meshcore: [],
      reticulum: [],
    };
    const { rerender } = renderHook(
      ({ m }) => {
        useBotSenderDetection(m, self);
      },
      {
        initialProps: { m: initial },
      },
    );
    expect(useBotSendersStore.getState().senders.meshtastic.has(5)).toBe(true);
    expect(useBotSendersStore.getState().senders.meshcore.size).toBe(0);

    rerender({ m: { ...initial, meshcore: [msg(2, 7, BOT_REPLY)] } });
    expect(useBotSendersStore.getState().senders.meshcore.has(7)).toBe(true);
  });
});
