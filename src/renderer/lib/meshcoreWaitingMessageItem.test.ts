import { describe, expect, it } from 'vitest';

import {
  isMeshcoreWaitingQueueEmpty,
  normalizeMeshcoreWaitingMessageBatch,
  normalizeMeshcoreWaitingMessageItem,
} from './meshcoreWaitingMessageItem';

describe('normalizeMeshcoreWaitingMessageItem', () => {
  it('returns null for empty queue markers', () => {
    expect(normalizeMeshcoreWaitingMessageItem(null)).toBeNull();
    expect(normalizeMeshcoreWaitingMessageItem([])).toBeNull();
    expect(isMeshcoreWaitingQueueEmpty(null)).toBe(true);
  });

  it('normalizes a single channel message from syncNextMessage', () => {
    const item = {
      channelMessage: { channelIdx: 0, senderTimestamp: 1_700_000_000, text: 'hello' },
    };
    expect(normalizeMeshcoreWaitingMessageItem(item)).toEqual(item);
  });

  it('normalizes getWaitingMessages batch arrays', () => {
    const batch = [
      { channelMessage: { channelIdx: 0, senderTimestamp: 1, text: 'a' } },
      { channelMessage: { channelIdx: 1, senderTimestamp: 2, text: 'b' } },
    ];
    expect(normalizeMeshcoreWaitingMessageBatch(batch)).toHaveLength(2);
    expect(normalizeMeshcoreWaitingMessageItem(batch)).toEqual(batch[0]);
  });
});
