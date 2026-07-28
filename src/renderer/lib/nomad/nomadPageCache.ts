import type { NomadPageRequestData } from '@/shared/nomad-types';

import { normalizeNomadPagePath, serializeNomadPageRequestDataKey } from './micronParser';

/** Cap cached page size — aligned with NomadNetworkPanel display limit. */
export const MAX_NOMAD_PAGE_CACHE_CHARS = 256 * 1024;

const MAX_NOMAD_PAGE_CACHE_ENTRIES = 32;

export interface NomadPageCacheEntry {
  content: string;
  content_type?: string;
  cachedAt: number;
}

export interface NomadPageCacheKeyInput {
  hash: string;
  path: string;
  /** NomadNet link request vars (`var_*` / `field_*`); part of cache identity. */
  requestData?: NomadPageRequestData;
}

const cache = new Map<string, NomadPageCacheEntry>();

function cacheKey({ hash, path, requestData }: NomadPageCacheKeyInput): string {
  const cleanHash = hash.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  const dataKey = serializeNomadPageRequestDataKey(requestData);
  return `${cleanHash}:${normalizeNomadPagePath(path)}:${dataKey}`;
}

export function getNomadPageCache(input: NomadPageCacheKeyInput): NomadPageCacheEntry | undefined {
  const key = cacheKey(input);
  const entry = cache.get(key);
  if (!entry) return undefined;
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

export function setNomadPageCache(
  input: NomadPageCacheKeyInput,
  entry: Omit<NomadPageCacheEntry, 'cachedAt'>,
): void {
  if (entry.content.length > MAX_NOMAD_PAGE_CACHE_CHARS) return;
  const key = cacheKey(input);
  cache.set(key, { ...entry, cachedAt: Date.now() });
  while (cache.size > MAX_NOMAD_PAGE_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}

/** @internal test helper */
export function clearNomadPageCache(): void {
  cache.clear();
}

/** @internal test helper */
export function nomadPageCacheSizeForTests(): number {
  return cache.size;
}
