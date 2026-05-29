import { MESHCORE_ROOM_SYNC_MIN_INTERVAL_MINUTES } from './timeConstants';

export interface RoomSyncSchedulerNode {
  nodeId: number;
  roomSyncEnabled: boolean;
  roomSyncIntervalMinutes: number;
  lastRoomSyncAt: number | null;
}

export function isRoomSyncEligible(node: RoomSyncSchedulerNode, now: number): boolean {
  if (!node.roomSyncEnabled) return false;
  const interval = node.roomSyncIntervalMinutes;
  if (!Number.isFinite(interval) || interval < MESHCORE_ROOM_SYNC_MIN_INTERVAL_MINUTES) {
    return false;
  }
  const last = node.lastRoomSyncAt ?? 0;
  return now - last >= interval * 60_000;
}

export function pickMostOverdueRoom(
  nodes: RoomSyncSchedulerNode[],
  now: number,
): RoomSyncSchedulerNode | undefined {
  const eligible = nodes.filter((n) => isRoomSyncEligible(n, now));
  if (eligible.length === 0) return undefined;
  eligible.sort((a, b) => {
    const aOver = now - (a.lastRoomSyncAt ?? 0);
    const bOver = now - (b.lastRoomSyncAt ?? 0);
    if (aOver !== bOver) return bOver - aOver;
    return a.nodeId - b.nodeId;
  });
  return eligible[0];
}
