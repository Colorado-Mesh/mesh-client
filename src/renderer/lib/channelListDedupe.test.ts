import { describe, expect, it } from 'vitest';

import { dedupeChannelPillsByIndex } from './channelListDedupe';

describe('dedupeChannelPillsByIndex', () => {
  it('returns entries sorted by ascending index', () => {
    const channels = [
      { index: 5, label: 'Channel 5' },
      { index: 2, label: 'Channel 2' },
      { index: 8, label: 'Channel 8' },
    ];
    expect(dedupeChannelPillsByIndex(channels).map((c) => c.index)).toEqual([2, 5, 8]);
  });

  it('last-wins dedupe when the same index appears twice', () => {
    const channels = [
      { index: 1, label: 'First' },
      { index: 3, label: 'Three' },
      { index: 1, label: 'Last Wins' },
    ];
    expect(dedupeChannelPillsByIndex(channels)).toEqual([
      { index: 1, label: 'Last Wins' },
      { index: 3, label: 'Three' },
    ]);
  });

  it('does not mutate the input array', () => {
    const channels = [
      { index: 3, label: 'Three' },
      { index: 1, label: 'One' },
      { index: 3, label: 'Three again' },
    ];
    const snapshot = [...channels];
    dedupeChannelPillsByIndex(channels);
    expect(channels).toEqual(snapshot);
  });

  it('handles empty input', () => {
    expect(dedupeChannelPillsByIndex([])).toEqual([]);
  });
});
