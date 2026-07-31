/** Shared in-memory retention limits for long-running sessions. */

import { MS_PER_HOUR, MS_PER_MINUTE } from '@/shared/timeConstants';

/**
 * In-memory hard ceiling for Meshtastic nodes, MeshCore contacts, and Reticulum peers.
 * User-facing destination/node caps (default 50k, Reticulum max {@link MAX_MESH_ENTITY_CAP}) apply first.
 */
export const MAX_MESH_ENTITY_CAP = 100_000;

export const MAX_TRACE_ROUTES_PER_IDENTITY = 100;
export const MAX_MESHCORE_CLI_HISTORY_ENTRIES = 50;
export const MAX_MESHTASTIC_TRACE_ROUTE_RESULTS = 100;
export const MAX_TELEMETRY_POINTS = 50;
export const MAX_DIAGNOSTICS_TRACKED_NODES = MAX_MESH_ENTITY_CAP;
export const MAX_RETICULUM_IDENTITY_DESTINATIONS = MAX_MESH_ENTITY_CAP;
/** In-memory cap for RMAP discovery rows mirrored from the sidecar DiscoveryStore. */
export const MAX_RMAP_DISCOVERED_ROWS = 2_000;
/** Soft caps for RRC session state (rooms / nicklists); messages use RRC_ROOM_HISTORY_LOAD_COUNT. */
export const MAX_RRC_ROOMS_PER_HUB = 64;
export const MAX_RRC_MEMBERS_PER_ROOM = 256;
/**
 * In-memory / hydrate soft cap for one RRC room (listRrcMessages limit).
 * Independent of SQLite retention (`rrcMessageRetentionCount`, default 10_000).
 */
export const RRC_ROOM_HISTORY_LOAD_COUNT = 500;
export const LARGE_MESH_NODE_THRESHOLD = 2000;
/** Above this, skip periodic full peer snapshots unless last full refresh is stale. */
export const MEGA_MESH_NODE_THRESHOLD = 10_000;
/** Max age of a warm full peer snapshot before mega-mesh timer refresh may run again. */
export const MEGA_MESH_FULL_PEER_REFRESH_MAX_AGE_MS = 10 * MS_PER_MINUTE;
export const LARGE_MESH_DIAGNOSTICS_REANALYSIS_DELAY_MS = 10_000;
export const SESSION_DB_PRUNE_INTERVAL_MS = 6 * MS_PER_HOUR;

/** Keep the newest `max` entries (tail of array). */
export function trimArrayTail<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  return items.slice(items.length - max);
}

/**
 * Append `entry` to the per-key ring at `key`, keeping at most `max` entries.
 * Returns a new Map so it can be used directly as a React state updater.
 */
export function appendToRingMap<K, V>(
  prev: Map<K, V[]>,
  key: K,
  entry: V,
  max: number,
): Map<K, V[]> {
  const updated = new Map(prev);
  updated.set(key, trimArrayTail([...(prev.get(key) ?? []), entry], max));
  return updated;
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
