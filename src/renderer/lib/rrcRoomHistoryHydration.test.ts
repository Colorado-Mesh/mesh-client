import { describe, expect, it } from 'vitest';

import {
  clearHydratedRrcRoomKeysForHub,
  hasHydratedRrcRoomKey,
  markHydratedRrcRoomKey,
  resetRrcRoomHistoryHydrationForTests,
  rrcRoomHistoryEpoch,
  unmarkHydratedRrcRoomKey,
} from './rrcRoomHistoryHydration';

describe('rrcRoomHistoryHydration', () => {
  beforeEach(() => {
    resetRrcRoomHistoryHydrationForTests();
  });

  it('starts at epoch 0 for unknown hubs', () => {
    expect(rrcRoomHistoryEpoch('abcd')).toBe(0);
  });

  it('tracks hydrated room keys', () => {
    const key = 'abcd::lobby';
    expect(hasHydratedRrcRoomKey(key)).toBe(false);
    markHydratedRrcRoomKey(key);
    expect(hasHydratedRrcRoomKey(key)).toBe(true);
    unmarkHydratedRrcRoomKey(key);
    expect(hasHydratedRrcRoomKey(key)).toBe(false);
  });

  it('increments hub epoch and clears keys for that hub', () => {
    markHydratedRrcRoomKey('abcd::lobby');
    markHydratedRrcRoomKey('abcd::general');
    markHydratedRrcRoomKey('efgh::lobby');

    clearHydratedRrcRoomKeysForHub('abcd');

    expect(hasHydratedRrcRoomKey('abcd::lobby')).toBe(false);
    expect(hasHydratedRrcRoomKey('abcd::general')).toBe(false);
    expect(hasHydratedRrcRoomKey('efgh::lobby')).toBe(true);
    expect(rrcRoomHistoryEpoch('abcd')).toBe(1);
  });

  it('handles empty hub gracefully', () => {
    expect(() => {
      clearHydratedRrcRoomKeysForHub('');
    }).not.toThrow();
    expect(rrcRoomHistoryEpoch('')).toBe(0);
  });
});
