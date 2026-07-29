import dns from 'node:dns/promises';

import { Agent, fetch as undiciFetch } from 'undici';

import { isLikelyDirectImageUrl } from '../shared/chatDirectImageUrl';
import {
  isLinkLocalIpv6,
  isLocalConnectHost,
  isLoopbackHost,
  isPrivateNetworkHost,
  isUniqueLocalIpv6,
  stripConnectHostBrackets,
} from '../shared/connectHost';
import { sanitizeLogMessage } from './sanitize-log-message';

export const LINK_PREVIEW_FETCH_TIMEOUT_MS = 10_000;
export const LINK_PREVIEW_DNS_LOOKUP_TIMEOUT_MS = 3_000;
export const LINK_PREVIEW_MAX_HTML_BYTES = 65_536;
export const LINK_PREVIEW_CACHE_TTL_MS = 15 * 60 * 1000;
export const LINK_PREVIEW_IMAGE_MAX_BYTES = 262_144;
export const LINK_PREVIEW_IMAGE_FETCH_TIMEOUT_MS = 10_000;
/** After a failed image fetch (e.g. 429), do not retry until this elapses. */
export const LINK_PREVIEW_IMAGE_NEGATIVE_CACHE_MS = 5 * 60 * 1000;
/** Max IPC link-preview fetches per rolling window (DoS / resource guard). */
export const LINK_PREVIEW_RATE_LIMIT_MAX = 20;
export const LINK_PREVIEW_RATE_LIMIT_WINDOW_MS = 60_000;
const LINK_PREVIEW_IMAGE_MAX_REDIRECTS = 5;
const LINK_PREVIEW_MAX_CACHE_ENTRIES = 256;
const LINK_PREVIEW_MAX_IMAGE_CACHE_ENTRIES = 128;
/**
 * Raster-only allowlist for preview images rendered via `<img src={data:...}>`.
 * Excludes `image/svg+xml`: SVG is XML that can carry `<script>`/event-handler
 * payloads and unbounded nested references (XML "billion laughs"-style
 * amplification), which is unnecessary defense-in-depth risk for a chat link
 * preview thumbnail. Modern Chromium does not execute script for `<img>` SVGs,
 * but rejecting outright avoids relying on that renderer-specific behavior.
 */
const LINK_PREVIEW_ALLOWED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

const YOUTUBE_PREVIEW_HOSTNAMES = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

const YOUTUBE_VIDEO_ID = /^[\w-]{11}$/;

/** Base MIME from a Content-Type header (strips `; charset=…`). */
export function linkPreviewBaseMime(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? '';
}

export function isLinkPreviewImageMime(contentType: string): boolean {
  return LINK_PREVIEW_ALLOWED_IMAGE_MIME_TYPES.has(linkPreviewBaseMime(contentType));
}

export { isLikelyDirectImageUrl } from '../shared/chatDirectImageUrl';

export function isYouTubePreviewHostname(hostname: string): boolean {
  return YOUTUBE_PREVIEW_HOSTNAMES.has(hostname.toLowerCase());
}

/**
 * Normalize watch / shorts / embed / youtu.be URLs to `https://www.youtube.com/watch?v=ID`
 * for the oEmbed `url` query param. Returns null when no video id can be extracted.
 */
export function canonicalizeYouTubeWatchUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (!isYouTubePreviewHostname(host)) return null;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const id = url.pathname.split('/').find((seg) => seg.length > 0);
    if (id && YOUTUBE_VIDEO_ID.test(id)) {
      return `https://www.youtube.com/watch?v=${id}`;
    }
    return null;
  }

  const fromQuery = url.searchParams.get('v');
  if (fromQuery && YOUTUBE_VIDEO_ID.test(fromQuery)) {
    return `https://www.youtube.com/watch?v=${fromQuery}`;
  }

  const parts = url.pathname.split('/').filter(Boolean);
  const kind = parts[0];
  const id = parts[1];
  if (
    id &&
    YOUTUBE_VIDEO_ID.test(id) &&
    (kind === 'shorts' || kind === 'embed' || kind === 'live' || kind === 'v')
  ) {
    return `https://www.youtube.com/watch?v=${id}`;
  }
  return null;
}

function titleFromImageUrl(url: URL): string {
  const seg = url.pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(seg) || url.hostname;
  } catch {
    // catch-no-log-ok malformed percent-encoding in path segment
    return seg || url.hostname;
  }
}

function evictOldestCacheEntry<K, V>(cache: Map<K, V>, maxEntries: number): void {
  while (cache.size >= maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function withInflightDedup<K, T>(
  map: Map<K, Promise<T>>,
  key: K,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = map.get(key);
  if (existing) return existing;
  const promise = fn().finally(() => {
    map.delete(key);
  });
  map.set(key, promise);
  return promise;
}

async function lookupHostname(hostname: string): Promise<string> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const { address } = await Promise.race([
      dns.lookup(hostname, { verbatim: true }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('dns lookup timeout'));
        }, LINK_PREVIEW_DNS_LOOKUP_TIMEOUT_MS);
      }),
    ]);
    return address;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/** Single DNS resolution used for both block checks and pinned connect (avoids lookup TOCTOU). */
async function resolvePinnedPreviewAddress(hostname: string): Promise<string> {
  const bare = stripConnectHostBrackets(hostname.trim()).toLowerCase();
  if (isBlockedHostname(bare)) {
    throw new Error('blocked hostname');
  }
  if (isLoopbackHost(bare) || isLocalConnectHost(bare)) {
    throw new Error('blocked hostname');
  }
  if (isPrivateNetworkHost(bare) || isUniqueLocalIpv6(bare) || isLinkLocalIpv6(bare)) {
    throw new Error('blocked hostname');
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(bare) || bare.includes(':')) {
    return bare;
  }

  const address = await lookupHostname(bare);
  if (
    isLoopbackHost(address) ||
    isPrivateNetworkHost(address) ||
    isUniqueLocalIpv6(address) ||
    isLinkLocalIpv6(address)
  ) {
    throw new Error('blocked resolved address');
  }
  return address;
}

function defaultConnectPort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'http:' ? 80 : 443;
}

async function fetchWithResolvedHost(urlString: string, init: RequestInit): Promise<Response> {
  const url = new URL(urlString);
  const address = await resolvePinnedPreviewAddress(url.hostname);
  const agent = new Agent({
    connect: {
      host: address,
      port: defaultConnectPort(url),
      servername: url.hostname,
    },
  });
  try {
    const response = await undiciFetch(urlString, {
      ...init,
      dispatcher: agent,
    } as Parameters<typeof undiciFetch>[1]);
    return response as unknown as Response;
  } finally {
    await agent.close();
  }
}

function isIpv4Literal(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

const LINK_PREVIEW_BLOCKED_HOSTNAMES = new Set(['localhost', '[::1]', '::1', '0.0.0.0']);

/** og:image hosts that rate-limit direct renderer loads; fetch once in main instead. */
const LINK_PREVIEW_IMAGE_PROXY_HOSTS = new Set(['opengraph.githubassets.com']);

interface TimedCacheEntry<T> {
  value: T;
  expires: number;
}

const previewCache = new Map<string, TimedCacheEntry<LinkPreviewMetadata | null>>();
const imageCache = new Map<string, TimedCacheEntry<string | null>>();
const previewInFlight = new Map<string, Promise<LinkPreviewMetadata | null>>();
const imageInFlight = new Map<string, Promise<string | undefined>>();

/** Timestamps of recent uncached IPC preview attempts (sliding window). */
const linkPreviewRateTimestamps: number[] = [];

/** Returns true when a new uncached preview is allowed under the IPC rate limit. */
export function takeLinkPreviewRateToken(now = Date.now()): boolean {
  const cutoff = now - LINK_PREVIEW_RATE_LIMIT_WINDOW_MS;
  while (linkPreviewRateTimestamps.length > 0) {
    const oldest = linkPreviewRateTimestamps[0];
    if (oldest === undefined || oldest >= cutoff) break;
    linkPreviewRateTimestamps.shift();
  }
  if (linkPreviewRateTimestamps.length >= LINK_PREVIEW_RATE_LIMIT_MAX) {
    return false;
  }
  linkPreviewRateTimestamps.push(now);
  return true;
}

/** Test helper — clears the IPC rate-limit window. */
export function resetLinkPreviewRateLimitForTests(): void {
  linkPreviewRateTimestamps.length = 0;
}

export function clearLinkPreviewCachesForTests(): void {
  previewCache.clear();
  imageCache.clear();
  previewInFlight.clear();
  imageInFlight.clear();
  resetLinkPreviewRateLimitForTests();
}

export function isBlockedHostname(hostname: string): boolean {
  return LINK_PREVIEW_BLOCKED_HOSTNAMES.has(hostname.toLowerCase()) || isIpv4Literal(hostname);
}

/** Block hostnames that resolve to loopback, RFC1918, ULA, or link-local targets (SSRF guard). */
export async function isBlockedHostnameResolved(hostname: string): Promise<boolean> {
  try {
    await resolvePinnedPreviewAddress(hostname);
    return false;
  } catch {
    // catch-no-log-ok DNS failure or blocked target — fail closed for preview fetch
    return true;
  }
}

export function shouldProxyPreviewImageUrl(imageUrl: string): boolean {
  try {
    return LINK_PREVIEW_IMAGE_PROXY_HOSTS.has(new URL(imageUrl).hostname.toLowerCase());
  } catch {
    // catch-no-log-ok invalid image URL string
    return false;
  }
}

async function isAllowedHttpsImageUrl(imageUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    // catch-no-log-ok invalid image URL string
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return !(await isBlockedHostnameResolved(parsed.hostname));
}

async function readResponseBodyUpTo(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = maxBytes - total;
      const slice = value.length <= remaining ? value : value.subarray(0, remaining);
      chunks.push(slice);
      total += slice.length;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // catch-no-log-ok: stream may already be aborted when AbortSignal.timeout fires
    }
  }
  if (total === 0) return null;
  const merged = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    merged.set(chunk, pos);
    pos += chunk.length;
  }
  return merged;
}

async function fetchImageResponseWithRedirectGuard(
  imageUrl: string,
  redirectCount = 0,
): Promise<Response | null> {
  if (!(await isAllowedHttpsImageUrl(imageUrl))) return null;
  if (redirectCount > LINK_PREVIEW_IMAGE_MAX_REDIRECTS) return null;

  const response = await fetchWithResolvedHost(imageUrl, {
    method: 'GET',
    headers: { Accept: 'image/*' },
    redirect: 'manual',
    signal: AbortSignal.timeout(LINK_PREVIEW_IMAGE_FETCH_TIMEOUT_MS),
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) return null;
    let nextUrl: string;
    try {
      nextUrl = new URL(location, imageUrl).href;
    } catch {
      // catch-no-log-ok malformed redirect Location header
      return null;
    }
    return fetchImageResponseWithRedirectGuard(nextUrl, redirectCount + 1);
  }

  return response;
}

async function fetchPreviewImageAsDataUrl(imageUrl: string): Promise<string | undefined> {
  if (!(await isAllowedHttpsImageUrl(imageUrl))) return undefined;

  const now = Date.now();
  const cached = imageCache.get(imageUrl);
  if (cached && cached.expires > now) {
    return cached.value ?? undefined;
  }

  return withInflightDedup(imageInFlight, imageUrl, async (): Promise<string | undefined> => {
    try {
      const response = await fetchImageResponseWithRedirectGuard(imageUrl);
      if (!response?.ok) {
        imageCache.set(imageUrl, {
          value: null,
          expires: now + LINK_PREVIEW_IMAGE_NEGATIVE_CACHE_MS,
        });
        return undefined;
      }
      const contentType = response.headers.get('content-type') ?? '';
      const mime = linkPreviewBaseMime(contentType);
      if (!LINK_PREVIEW_ALLOWED_IMAGE_MIME_TYPES.has(mime)) return undefined;

      const reader = response.body?.getReader();
      if (!reader) return undefined;
      const bytes = await readResponseBodyUpTo(reader, LINK_PREVIEW_IMAGE_MAX_BYTES);
      if (!bytes) return undefined;

      const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
      evictOldestCacheEntry(imageCache, LINK_PREVIEW_MAX_IMAGE_CACHE_ENTRIES);
      imageCache.set(imageUrl, { value: dataUrl, expires: now + LINK_PREVIEW_CACHE_TTL_MS });
      return dataUrl;
    } catch (err) {
      console.debug(
        '[chat] fetchLinkPreview image error:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      imageCache.set(imageUrl, {
        value: null,
        expires: now + LINK_PREVIEW_IMAGE_NEGATIVE_CACHE_MS,
      });
      return undefined;
    }
  });
}

export interface LinkPreviewMetadata {
  title: string;
  description?: string;
  image?: string;
  /** Set when the URL itself is a raster image (not an HTML page with og:image). */
  kind?: 'image';
}

async function fetchYouTubeOEmbedPreview(pageUrl: URL): Promise<LinkPreviewMetadata | null> {
  const watchUrl = canonicalizeYouTubeWatchUrl(pageUrl);
  if (!watchUrl) return null;

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
  const response = await fetchWithResolvedHost(oembedUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(LINK_PREVIEW_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;

  const reader = response.body?.getReader();
  if (!reader) return null;
  const merged = await readResponseBodyUpTo(reader, LINK_PREVIEW_MAX_HTML_BYTES);
  if (!merged) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(merged)) as unknown;
  } catch {
    // catch-no-log-ok malformed oEmbed JSON
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.title !== 'string' || !obj.title.trim()) return null;

  let image: string | undefined;
  if (typeof obj.thumbnail_url === 'string' && obj.thumbnail_url.startsWith('https://')) {
    image = await fetchPreviewImageAsDataUrl(obj.thumbnail_url);
  }

  return {
    title: obj.title.trim(),
    description:
      typeof obj.author_name === 'string' && obj.author_name.trim()
        ? obj.author_name.trim()
        : undefined,
    image,
  };
}

async function fetchHtmlLinkPreview(
  urlString: string,
  response: Response,
): Promise<LinkPreviewMetadata | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const merged = await readResponseBodyUpTo(reader, LINK_PREVIEW_MAX_HTML_BYTES);
  if (!merged) return null;

  const html = new TextDecoder().decode(merged);

  const ogTitle =
    /<meta\s+property="og:title"\s+content="([^"]+)"/i.exec(html)?.[1] ??
    /<meta\s+content="([^"]+)"\s+property="og:title"/i.exec(html)?.[1] ??
    /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1];
  if (!ogTitle?.trim()) return null;

  const title = ogTitle.trim();

  const ogDesc =
    /<meta\s+property="og:description"\s+content="([^"]+)"/i.exec(html)?.[1] ??
    /<meta\s+content="([^"]+)"\s+property="og:description"/i.exec(html)?.[1] ??
    /<meta\s+name="description"\s+content="([^"]+)"/i.exec(html)?.[1];
  const description = ogDesc?.trim() || undefined;

  const ogImage =
    /<meta\s+property="og:image"\s+content="([^"]+)"/i.exec(html)?.[1] ??
    /<meta\s+content="([^"]+)"\s+property="og:image"/i.exec(html)?.[1];
  let image = ogImage?.trim().startsWith('https://') ? ogImage.trim() : undefined;

  if (image) {
    image = await fetchPreviewImageAsDataUrl(image);
  }

  return { title, description, image };
}

async function fetchDirectImagePreviewFromResponse(
  url: URL,
  response: Response,
  mime: string,
): Promise<LinkPreviewMetadata | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const bytes = await readResponseBodyUpTo(reader, LINK_PREVIEW_IMAGE_MAX_BYTES);
  if (!bytes) return null;
  const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  return {
    title: titleFromImageUrl(url),
    image: dataUrl,
    kind: 'image',
  };
}

async function fetchLinkPreviewUncached(urlString: string): Promise<LinkPreviewMetadata | null> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    // catch-no-log-ok invalid URL string — silent failure by design
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (await isBlockedHostnameResolved(url.hostname)) return null;

  try {
    if (isYouTubePreviewHostname(url.hostname)) {
      const yt = await fetchYouTubeOEmbedPreview(url);
      if (yt) return yt;
    }

    // Extension-hinted HTTPS images: follow redirects via the dedicated image fetcher.
    if (url.protocol === 'https:' && isLikelyDirectImageUrl(urlString)) {
      const dataUrl = await fetchPreviewImageAsDataUrl(urlString);
      if (dataUrl) {
        return {
          title: titleFromImageUrl(url),
          image: dataUrl,
          kind: 'image',
        };
      }
    }

    const response = await fetchWithResolvedHost(urlString, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'text/html,image/*,*/*;q=0.8' },
      signal: AbortSignal.timeout(LINK_PREVIEW_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    const mime = linkPreviewBaseMime(contentType);

    if (LINK_PREVIEW_ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
      return await fetchDirectImagePreviewFromResponse(url, response, mime);
    }

    if (!contentType.includes('text/html')) return null;
    return await fetchHtmlLinkPreview(urlString, response);
  } catch (err) {
    console.debug(
      '[chat] fetchLinkPreview error:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    return null;
  }
}

export async function fetchLinkPreview(urlString: string): Promise<LinkPreviewMetadata | null> {
  const now = Date.now();
  const cached = previewCache.get(urlString);
  if (cached && cached.expires > now) {
    return cached.value;
  }

  // Join in-flight work without consuming a rate-limit token.
  const inFlight = previewInFlight.get(urlString);
  if (inFlight) return inFlight;

  if (!takeLinkPreviewRateToken()) {
    console.debug('[chat] fetchLinkPreview rate limited');
    return null;
  }

  return withInflightDedup(
    previewInFlight,
    urlString,
    async (): Promise<LinkPreviewMetadata | null> => {
      const value = await fetchLinkPreviewUncached(urlString);
      evictOldestCacheEntry(previewCache, LINK_PREVIEW_MAX_CACHE_ENTRIES);
      previewCache.set(urlString, { value, expires: Date.now() + LINK_PREVIEW_CACHE_TTL_MS });
      return value;
    },
  );
}
