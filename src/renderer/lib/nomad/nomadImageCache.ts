import { normalizeNomadPagePath } from './micronParser';

/** Cap cached media base64 length (in-memory browser image cache).
 * NomadNet `/media` WebP (≤1200px, q85) often exceeds 512KiB base64 — observed
 * banners ~638KiB were silently dropped under the old cap. */
export const MAX_NOMAD_IMAGE_CACHE_BASE64_CHARS = 2 * 1024 * 1024;

const MAX_NOMAD_IMAGE_CACHE_ENTRIES = 128;

export interface NomadImageCacheEntry {
  content_base64: string;
  file_name?: string;
  cachedAt: number;
}

export interface NomadImageCacheKeyInput {
  hash: string;
  /** Nomad `/media/...` path. */
  mediaPath: string;
}

const cache = new Map<string, NomadImageCacheEntry>();

/** Bumped on every clear so in-flight fetches do not repopulate after clear. */
let cacheGeneration = 0;

function cacheKey({ hash, mediaPath }: NomadImageCacheKeyInput): string {
  const cleanHash = hash.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  return `${cleanHash}:${normalizeNomadPagePath(mediaPath)}`;
}

/** Snapshot for callers that must ignore results after a clear. */
export function getNomadImageCacheGeneration(): number {
  return cacheGeneration;
}

export function getNomadImageCache(
  input: NomadImageCacheKeyInput,
): NomadImageCacheEntry | undefined {
  const key = cacheKey(input);
  const entry = cache.get(key);
  if (!entry) return undefined;
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

export function setNomadImageCache(
  input: NomadImageCacheKeyInput,
  entry: Omit<NomadImageCacheEntry, 'cachedAt'>,
): void {
  if (entry.content_base64.length > MAX_NOMAD_IMAGE_CACHE_BASE64_CHARS) return;
  const key = cacheKey(input);
  cache.set(key, { ...entry, cachedAt: Date.now() });
  while (cache.size > MAX_NOMAD_IMAGE_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}

export function clearNomadImageCache(): void {
  cache.clear();
  cacheGeneration += 1;
}

/** @internal test helper */
export function nomadImageCacheSizeForTests(): number {
  return cache.size;
}
