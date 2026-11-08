import { describe, expect, it } from 'vitest';

import { liveTrafficLocalEmptyCopy } from './liveTrafficEmptyState';

describe('liveTrafficLocalEmptyCopy', () => {
  it('asks the user to connect a radio when the local log is empty', () => {
    expect(liveTrafficLocalEmptyCopy(0)).toEqual({
      waiting: 'liveTraffic.waiting',
      waitingHint: 'liveTraffic.waitingHint',
      emptyFeed: 'liveTraffic.emptyFeed',
    });
  });

  it('explains the one-minute window when older local captures exist', () => {
    expect(liveTrafficLocalEmptyCopy(1)).toEqual({
      waiting: 'liveTraffic.waitingQuiet',
      waitingHint: 'liveTraffic.waitingHintQuiet',
      emptyFeed: 'liveTraffic.emptyFeedQuiet',
    });
    expect(liveTrafficLocalEmptyCopy(2500).waitingHint).toBe('liveTraffic.waitingHintQuiet');
  });
});
