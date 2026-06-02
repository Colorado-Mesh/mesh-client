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

  it('leaves non-chunk posts unchanged', () => {
    const merged = mergeDisplayedRoomPostChunks([roomPost('Bot Stats (24h):', 1)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.payload).toBe('Bot Stats (24h):');
  });
});
