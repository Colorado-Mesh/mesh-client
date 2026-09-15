import { normalizeNomadPagePath } from './micronParser';

/** Cap cached media base64 length (in-memory browser image cache). */
export const MAX_NOMAD_IMAGE_CACHE_BASE64_CHARS = 512 * 1024;

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

function cacheKey({ hash, mediaPath }: NomadImageCacheKeyInput): string {
  const cleanHash = hash.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  return `${cleanHash}:${normalizeNomadPagePath(mediaPath)}`;
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
}

/** @internal test helper */
export function nomadImageCacheSizeForTests(): number {
  return cache.size;
}
