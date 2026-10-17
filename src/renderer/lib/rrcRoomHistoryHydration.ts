/**
 * Session-scoped keys already loaded from SQLite (`${hub}::${room}`).
 * Kept separate from `rrcRoomHistory` / `rrcSessionStore` to avoid an import cycle
 * when hub teardown clears both messages and hydration cache.
 */
const hydratedRoomKeys = new Set<string>();
const hubHistoryEpochs = new Map<string, number>();

export function rrcRoomHistoryEpoch(hub: string): number {
  return hubHistoryEpochs.get(hub) ?? 0;
}

export function resetRrcRoomHistoryHydrationForTests(): void {
  hydratedRoomKeys.clear();
  hubHistoryEpochs.clear();
}

export function hasHydratedRrcRoomKey(key: string): boolean {
  return hydratedRoomKeys.has(key);
}

export function markHydratedRrcRoomKey(key: string): void {
  hydratedRoomKeys.add(key);
}

export function unmarkHydratedRrcRoomKey(key: string): void {
  hydratedRoomKeys.delete(key);
}

/** Drop hydration markers for every room under `hub` (32-hex lowercase). */
export function clearHydratedRrcRoomKeysForHub(hub: string): void {
  if (!hub) return;
  hubHistoryEpochs.set(hub, rrcRoomHistoryEpoch(hub) + 1);
  const prefix = `${hub}::`;
  for (const key of hydratedRoomKeys) {
    if (key.startsWith(prefix)) {
      hydratedRoomKeys.delete(key);
    }
  }
}
