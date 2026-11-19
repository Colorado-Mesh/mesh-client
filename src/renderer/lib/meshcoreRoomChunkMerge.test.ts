import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/renderer/lib/types';

import { mergeDisplayedRoomPostChunks } from './meshcoreRoomChunkMerge';

function roomPost(payload: string, ts: number): ChatMessage {
  return {
    sender_id: 0x42,
    sender_name: 'Me',
    payload,
    channel: -2,
    timestamp: ts,
    roomServerId: 0xac200e59,
    to: 0xac200e59,
  };
}

describe('mergeDisplayedRoomPostChunks', () => {
  it('merges [1/2] and [2/2] into one displayed post', () => {
    const merged = mergeDisplayedRoomPostChunks([
      roomPost('[1/2] hello ', 1),
      roomPost('[2/2] world', 2),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.payload).toBe('hello world');
  });

  // Read mark / unread divider / Catch up compare receipts; the assembled post must keep
  // the newest observation across chunks (not merely the last chunk index).
  it('gives the assembled post the newest receipt across its chunks', () => {
    const merged = mergeDisplayedRoomPostChunks([
      { ...roomPost('[1/2] hello ', 1), receivedAt: 10 },
      { ...roomPost('[2/2] world', 2), receivedAt: 20 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.receivedAt).toBe(20);
  });

  it('keeps the newest receipt when later chunk indexes have older receipts', () => {
    const merged = mergeDisplayedRoomPostChunks([
      { ...roomPost('[1/2] hello ', 1), receivedAt: 20 },
      { ...roomPost('[2/2] world', 2), receivedAt: 10 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.receivedAt).toBe(20);
  });

  it('keeps an assembled post without a receipt when its chunks have none', () => {
    const merged = mergeDisplayedRoomPostChunks([
      roomPost('[1/2] hello ', 1),
      roomPost('[2/2] world', 2),
    ]);
    expect(merged[0]).not.toHaveProperty('receivedAt');
  });

  it('leaves non-chunk posts unchanged', () => {
    const merged = mergeDisplayedRoomPostChunks([roomPost('Bot Stats (24h):', 1)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.payload).toBe('Bot Stats (24h):');
  });
});
