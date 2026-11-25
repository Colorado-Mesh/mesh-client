/**
 * Persist discovered MeshCore flood-scope region directories per companion radio.
 * Re-derivable UI cache in app settings (localStorage).
 */

import { MS_PER_DAY } from '@/shared/timeConstants';

import { getAppSettingsRaw, mergeAppSetting } from './appSettingsStorage';
import type { DiscoveredMeshcoreRegion } from './meshcoreRegionDiscovery';
import { scopeHashtagForRegionName } from './meshcoreRegionDiscovery';
import { MESHCORE_FLOOD_SCOPE_HASHTAG_MAX_LEN } from './meshcoreUtils';
import { parseStoredJson } from './parseStoredJson';

export const MESHCORE_DISCOVERED_REGIONS_SETTING_KEY = 'meshcoreDiscoveredRegions';
const MESHCORE_DISCOVERED_REGIONS_VERSION = 1 as const;
export const MESHCORE_DISCOVERED_REGIONS_MAX_RADIOS = 8;
export const MESHCORE_DISCOVERED_REGIONS_MAX_ENTRIES = 128;
export const MESHCORE_DISCOVERED_REGIONS_STALE_MS = 7 * MS_PER_DAY;

const RADIO_SIGNATURE_RE = /^meshcore:pk:[0-9a-f]{64}$/i;

export interface MeshcoreDiscoveredRegionsCache {
  version: typeof MESHCORE_DISCOVERED_REGIONS_VERSION;
  readAt: number;
  entries: DiscoveredMeshcoreRegion[];
  truncatedSources: number[];
}

function isValidRadioSignature(signature: string | undefined): signature is string {
  return typeof signature === 'string' && RADIO_SIGNATURE_RE.test(signature);
}

function sanitizeSources(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const value of raw) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const id = Math.trunc(value);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.sort((a, b) => a - b);
}

function sanitizeEntry(raw: unknown): DiscoveredMeshcoreRegion | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.name !== 'string' || !record.name || /\p{Cc}/u.test(record.name)) return null;
  if (record.name.length > MESHCORE_FLOOD_SCOPE_HASHTAG_MAX_LEN) return null;
  const expectedHashtag = scopeHashtagForRegionName(record.name);
  const scopeHashtag =
    record.scopeHashtag === null || record.scopeHashtag === undefined
      ? expectedHashtag
      : typeof record.scopeHashtag === 'string'
        ? record.scopeHashtag
        : null;
  if (scopeHashtag !== expectedHashtag) {
    // Prefer recomputed hashtag; drop if stored tag contradicts name rules.
    if (expectedHashtag == null && scopeHashtag != null) return null;
  }
  const depth =
    typeof record.depth === 'number' && Number.isFinite(record.depth) ? record.depth : 0;
  return {
    name: record.name,
    scopeHashtag: expectedHashtag,
    depth: Math.max(0, Math.trunc(depth)),
    home: record.home === true,
    floodAllowed: record.floodAllowed === true,
    sources: sanitizeSources(record.sources),
  };
}

function sanitizeCache(raw: unknown): MeshcoreDiscoveredRegionsCache | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== MESHCORE_DISCOVERED_REGIONS_VERSION) return null;
  if (typeof record.readAt !== 'number' || !Number.isFinite(record.readAt)) return null;
  if (!Array.isArray(record.entries)) return null;

  const seen = new Set<string>();
  const entries: DiscoveredMeshcoreRegion[] = [];
  for (const entry of record.entries) {
    const sanitized = sanitizeEntry(entry);
    if (!sanitized) continue;
    if (seen.has(sanitized.name)) continue;
    seen.add(sanitized.name);
    entries.push(sanitized);
    if (entries.length >= MESHCORE_DISCOVERED_REGIONS_MAX_ENTRIES) break;
  }

  return {
    version: MESHCORE_DISCOVERED_REGIONS_VERSION,
    readAt: Math.trunc(record.readAt),
    entries,
    truncatedSources: sanitizeSources(record.truncatedSources),
  };
}

function readAllCaches(): Record<string, MeshcoreDiscoveredRegionsCache> {
  const settings =
    parseStoredJson<Record<string, unknown>>(
      getAppSettingsRaw(),
      'loadDiscoveredMeshcoreRegions',
    ) ?? {};
  const raw = settings[MESHCORE_DISCOVERED_REGIONS_SETTING_KEY];
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, MeshcoreDiscoveredRegionsCache> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidRadioSignature(key)) continue;
    const cache = sanitizeCache(value);
    if (cache) out[key] = cache;
  }
  return out;
}

function persistAllCaches(caches: Record<string, MeshcoreDiscoveredRegionsCache>): void {
  const entries = Object.entries(caches);
  if (entries.length <= MESHCORE_DISCOVERED_REGIONS_MAX_RADIOS) {
    mergeAppSetting(
      MESHCORE_DISCOVERED_REGIONS_SETTING_KEY,
      caches,
      'saveMeshcoreDiscoveredRegions',
    );
    return;
  }
  entries.sort((a, b) => a[1].readAt - b[1].readAt);
  const kept = Object.fromEntries(entries.slice(-MESHCORE_DISCOVERED_REGIONS_MAX_RADIOS));
  mergeAppSetting(MESHCORE_DISCOVERED_REGIONS_SETTING_KEY, kept, 'saveMeshcoreDiscoveredRegions');
}

export function loadDiscoveredMeshcoreRegions(
  radioSignature: string | undefined,
): MeshcoreDiscoveredRegionsCache | null {
  if (!isValidRadioSignature(radioSignature)) return null;
  return readAllCaches()[radioSignature] ?? null;
}

export function saveDiscoveredMeshcoreRegions(
  radioSignature: string,
  cache: MeshcoreDiscoveredRegionsCache,
): void {
  if (!isValidRadioSignature(radioSignature)) return;
  const sanitized = sanitizeCache(cache);
  if (!sanitized) return;
  const all = readAllCaches();
  all[radioSignature] = sanitized;
  persistAllCaches(all);
}

export function isDiscoveredMeshcoreRegionsStale(
  cache: Pick<MeshcoreDiscoveredRegionsCache, 'readAt'> | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!cache) return false;
  return nowMs - cache.readAt > MESHCORE_DISCOVERED_REGIONS_STALE_MS;
}
