/** Shared in-memory retention limits for long-running sessions. */

/**
 * In-memory hard ceiling for Meshtastic nodes, MeshCore contacts, and Reticulum peers.
 * User-facing destination/node caps (default 10k, Reticulum max 50k) apply first.
 */
export const MAX_MESH_ENTITY_CAP = 100_000;

export const MAX_TRACE_ROUTES_PER_IDENTITY = 100;
export const MAX_MESHCORE_CLI_HISTORY_ENTRIES = 50;
export const MAX_MESHTASTIC_TRACE_ROUTE_RESULTS = 100;
export const MAX_DIAGNOSTICS_TRACKED_NODES = MAX_MESH_ENTITY_CAP;
export const MAX_RETICULUM_IDENTITY_DESTINATIONS = MAX_MESH_ENTITY_CAP;
/** In-memory cap for RMAP discovery rows mirrored from the sidecar DiscoveryStore. */
export const MAX_RMAP_DISCOVERED_ROWS = 2_000;
export const LARGE_MESH_NODE_THRESHOLD = 2000;
export const LARGE_MESH_DIAGNOSTICS_REANALYSIS_DELAY_MS = 10_000;
export const SESSION_DB_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Keep the newest `max` entries (tail of array). */
export function trimArrayTail<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  return items.slice(items.length - max);
}

/** Evict oldest Map keys when size exceeds max ( insertion order ). */
export function trimMapToMaxSize<K, V>(map: Map<K, V>, max: number): Map<K, V> {
  if (map.size <= max) return map;
  const next = new Map(map);
  const removeCount = next.size - max;
  const keys = next.keys();
  for (let i = 0; i < removeCount; i++) {
    const k = keys.next();
    if (k.done) break;
    next.delete(k.value);
  }
  return next;
}

/** Evict oldest Map keys not present in `keepIds`. */
export function trimMapToMaxSizeKeeping<K, V>(
  map: Map<K, V>,
  max: number,
  keepIds: Iterable<K>,
): Map<K, V> {
  if (map.size <= max) return map;
  const keep = new Set(keepIds);
  const next = new Map(map);
  for (const key of [...next.keys()]) {
    if (next.size <= max) break;
    if (!keep.has(key)) next.delete(key);
  }
  if (next.size > max) {
    return trimMapToMaxSize(next, max);
  }
  return next;
}
