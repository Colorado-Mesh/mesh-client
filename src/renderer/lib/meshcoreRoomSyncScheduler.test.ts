import { describe, expect, it } from 'vitest';

import {
  isRoomSyncEligible,
  pickMostOverdueRoom,
  type RoomSyncSchedulerNode,
} from './meshcoreRoomSyncScheduler';

describe('meshcoreRoomSyncScheduler', () => {
  const base: RoomSyncSchedulerNode = {
    nodeId: 1,
    roomSyncEnabled: true,
    roomSyncIntervalMinutes: 60,
    lastRoomSyncAt: null,
  };

  it('isRoomSyncEligible requires enabled and minimum interval', () => {
    const now = 10_000_000_000;
    expect(isRoomSyncEligible({ ...base, roomSyncEnabled: false }, now)).toBe(false);
    expect(isRoomSyncEligible({ ...base, roomSyncIntervalMinutes: 30 }, now)).toBe(false);
    expect(isRoomSyncEligible(base, now)).toBe(true);
    expect(isRoomSyncEligible({ ...base, lastRoomSyncAt: now - 30 * 60_000 }, now)).toBe(false);
    expect(isRoomSyncEligible({ ...base, lastRoomSyncAt: now - 61 * 60_000 }, now)).toBe(true);
  });

  it('pickMostOverdueRoom chooses the longest overdue eligible room', () => {
    const now = 5_000_000;
    const nodes: RoomSyncSchedulerNode[] = [
      { ...base, nodeId: 10, lastRoomSyncAt: now - 120 * 60_000 },
      { ...base, nodeId: 20, lastRoomSyncAt: now - 180 * 60_000 },
      { ...base, nodeId: 30, roomSyncEnabled: false },
    ];
    expect(pickMostOverdueRoom(nodes, now)?.nodeId).toBe(20);
  });

  it('pickMostOverdueRoom returns undefined when none eligible', () => {
    const now = Date.now();
    expect(
      pickMostOverdueRoom([{ ...base, lastRoomSyncAt: now - 5 * 60_000 }], now),
    ).toBeUndefined();
  });
});
