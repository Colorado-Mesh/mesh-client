import { describe, expect, it } from 'vitest';

import { MAX_IN_MEMORY_CHAT_MESSAGES, trimChatMessagesToMax } from './chatInMemoryBuffer';

describe('trimChatMessagesToMax', () => {
  it('returns the same array when under the cap', () => {
    const a = [1, 2, 3];
    expect(trimChatMessagesToMax(a, 10)).toBe(a);
  });

  it('keeps only the newest tail when over the cap', () => {
    const arr = Array.from({ length: 15 }, (_, i) => i);
    expect(trimChatMessagesToMax(arr, 10)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('MAX_IN_MEMORY_CHAT_MESSAGES is a reasonable fixed bound', () => {
    expect(MAX_IN_MEMORY_CHAT_MESSAGES).toBe(2000);
  });
});
