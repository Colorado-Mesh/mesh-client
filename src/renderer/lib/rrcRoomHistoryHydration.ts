/**
 * Session-scoped keys already loaded from SQLite (`${hub}::${room}`).
 * Kept separate from `rrcRoomHistory` / `rrcSessionStore` to avoid an import cycle
 * when hub teardown clears both messages and hydration cache.
 */
const hydratedRoomKeys = new Set<string>();

export function resetRrcRoomHistoryHydrationForTests(): void {
  hydratedRoomKeys.clear();
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
  const prefix = `${hub}::`;
  for (const key of [...hydratedRoomKeys]) {
    if (key.startsWith(prefix)) {
      hydratedRoomKeys.delete(key);
    }
  }
}
