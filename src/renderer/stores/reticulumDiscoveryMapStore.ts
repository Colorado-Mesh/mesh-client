import { create } from 'zustand';

import { MAX_RMAP_DISCOVERED_ROWS } from '@/renderer/lib/sessionMemoryCaps';
import { isValidLatLon } from '@/shared/geoCoords';
import type { ReticulumRmapDiscoveredWireRow } from '@/shared/reticulum-types';
import { MS_PER_DAY, MS_PER_SECOND } from '@/shared/timeConstants';

/** Defense-in-depth TTL aligned with sidecar DiscoveryStore (7 days). */
export const RMAP_DISCOVERY_TTL_SEC = 7 * (MS_PER_DAY / MS_PER_SECOND);

const MAX_RMAP_STRING_FIELD_LEN = 256;

interface ReticulumDiscoveryMapState {
  discovered: ReticulumRmapDiscoveredWireRow[];
  loading: boolean;
  lastRefreshAt: number | null;
  setDiscovered: (rows: ReticulumRmapDiscoveredWireRow[]) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;
}

function clampString(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLen);
}

/** Sanitize and validate a single wire row; drop invalid entries. */
export function sanitizeRmapDiscoveryRow(raw: unknown): ReticulumRmapDiscoveredWireRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const discoveryHash = clampString(row.discovery_hash, MAX_RMAP_STRING_FIELD_LEN).trim();
  const transportId = clampString(row.transport_id, MAX_RMAP_STRING_FIELD_LEN).trim();
  if (!discoveryHash || !transportId) return null;

  const latitude = typeof row.latitude === 'number' ? row.latitude : Number(row.latitude);
  const longitude = typeof row.longitude === 'number' ? row.longitude : Number(row.longitude);
  const lastHeard = typeof row.last_heard === 'number' ? row.last_heard : Number(row.last_heard);
  if (!Number.isFinite(lastHeard) || lastHeard <= 0) return null;

  const hasCoordinates =
    Boolean(row.has_coordinates) &&
    isValidLatLon(latitude, longitude) &&
    !(latitude === 0 && longitude === 0);

  return {
    discovery_hash: discoveryHash,
    transport_id: transportId,
    discovery_name: clampString(row.discovery_name, MAX_RMAP_STRING_FIELD_LEN),
    interface_type: clampString(row.interface_type, MAX_RMAP_STRING_FIELD_LEN),
    latitude: Number.isFinite(latitude) ? latitude : 0,
    longitude: Number.isFinite(longitude) ? longitude : 0,
    height: typeof row.height === 'number' && Number.isFinite(row.height) ? row.height : 0,
    transport_enabled: Boolean(row.transport_enabled),
    reachable_on:
      row.reachable_on == null
        ? null
        : clampString(row.reachable_on, MAX_RMAP_STRING_FIELD_LEN) || null,
    port: typeof row.port === 'number' && Number.isFinite(row.port) ? row.port : null,
    frequency:
      typeof row.frequency === 'number' && Number.isFinite(row.frequency) ? row.frequency : null,
    bandwidth:
      typeof row.bandwidth === 'number' && Number.isFinite(row.bandwidth) ? row.bandwidth : null,
    spreading_factor:
      typeof row.spreading_factor === 'number' && Number.isFinite(row.spreading_factor)
        ? row.spreading_factor
        : null,
    coding_rate:
      typeof row.coding_rate === 'number' && Number.isFinite(row.coding_rate)
        ? row.coding_rate
        : null,
    modulation:
      row.modulation == null
        ? null
        : clampString(row.modulation, MAX_RMAP_STRING_FIELD_LEN) || null,
    channel: typeof row.channel === 'number' && Number.isFinite(row.channel) ? row.channel : null,
    hops: typeof row.hops === 'number' && Number.isFinite(row.hops) ? Math.trunc(row.hops) : 0,
    stamp_value:
      typeof row.stamp_value === 'number' && Number.isFinite(row.stamp_value)
        ? Math.trunc(row.stamp_value)
        : 0,
    discovered:
      typeof row.discovered === 'number' && Number.isFinite(row.discovered)
        ? Math.trunc(row.discovered)
        : 0,
    last_heard: Math.trunc(lastHeard),
    heard_count:
      typeof row.heard_count === 'number' && Number.isFinite(row.heard_count)
        ? Math.trunc(row.heard_count)
        : 0,
    status: clampString(row.status, 32) || 'unknown',
    has_coordinates: hasCoordinates,
  };
}

/** Filter stale rows, sanitize, sort by last_heard desc, and cap count. */
export function normalizeRmapDiscoveryRows(
  rows: unknown[],
  nowSec: number = Math.floor(Date.now() / MS_PER_SECOND),
): ReticulumRmapDiscoveredWireRow[] {
  const cutoff = nowSec - RMAP_DISCOVERY_TTL_SEC;
  const sanitized: ReticulumRmapDiscoveredWireRow[] = [];
  for (const raw of rows) {
    const row = sanitizeRmapDiscoveryRow(raw);
    if (!row || row.last_heard < cutoff) continue;
    sanitized.push(row);
  }
  sanitized.sort((a, b) => b.last_heard - a.last_heard);
  if (sanitized.length <= MAX_RMAP_DISCOVERED_ROWS) return sanitized;
  return sanitized.slice(0, MAX_RMAP_DISCOVERED_ROWS);
}

export const useReticulumDiscoveryMapStore = create<ReticulumDiscoveryMapState>((set) => ({
  discovered: [],
  loading: false,
  lastRefreshAt: null,
  setDiscovered: (rows) => {
    set({
      discovered: normalizeRmapDiscoveryRows(rows),
      loading: false,
      lastRefreshAt: Date.now(),
    });
  },
  setLoading: (loading) => {
    set({ loading });
  },
  clear: () => {
    set({
      discovered: [],
      loading: false,
      lastRefreshAt: null,
    });
  },
}));

export function mergeRmapDiscoveryRows(
  existing: ReticulumRmapDiscoveredWireRow[],
  incoming: ReticulumRmapDiscoveredWireRow[],
): ReticulumRmapDiscoveredWireRow[] {
  const byHash = new Map<string, ReticulumRmapDiscoveredWireRow>();
  for (const row of existing) {
    byHash.set(row.discovery_hash, row);
  }
  for (const row of incoming) {
    byHash.set(row.discovery_hash, row);
  }
  return normalizeRmapDiscoveryRows([...byHash.values()]);
}
