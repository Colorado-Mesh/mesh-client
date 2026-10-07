import { describe, expect, it } from 'vitest';

import { dedupeChannelPillsByIndex } from './channelListDedupe';

describe('dedupeChannelPillsByIndex', () => {
  it('returns empty array when given empty input', () => {
    expect(dedupeChannelPillsByIndex([])).toEqual([]);
  });

  it('preserves single elements and sorts by index', () => {
    const channels = [
      { index: 3, name: 'Ch 3' },
      { index: 1, name: 'Ch 1' },
      { index: 2, name: 'Ch 2' },
    ];
    expect(dedupeChannelPillsByIndex(channels)).toEqual([
      { index: 1, name: 'Ch 1' },
      { index: 2, name: 'Ch 2' },
      { index: 3, name: 'Ch 3' },
    ]);
  });

  it('keeps the last entry when duplicate indices exist', () => {
    const channels = [
      { index: 0, name: 'Old Primary' },
      { index: 1, name: 'Secondary' },
      { index: 0, name: 'Updated Primary' },
    ];
    expect(dedupeChannelPillsByIndex(channels)).toEqual([
      { index: 0, name: 'Updated Primary' },
      { index: 1, name: 'Secondary' },
    ]);
  });
});
