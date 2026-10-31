import dns from 'node:dns/promises';
import type { LookupFunction } from 'node:net';

import { Agent, fetch as undiciFetch } from 'undici';

import { isLikelyDirectImageUrl } from '../shared/chatDirectImageUrl';
import { stripConnectHostBrackets } from '../shared/connectHost';
import {
  ipLiteralFamily,
  isGlobalIpLiteral,
  isValidIpLiteral,
  isValidIpv6Literal,
} from '../shared/ipLiteral';
import {
  baseMimeFromContentType,
  bufferToRasterImageDataUrl,
  CHAT_INLINE_IMAGE_MAX_BYTES,
  LINK_PREVIEW_IMAGE_MIMES,
  resolveSafeRasterImageMime,
} from '../shared/safeRasterImageMime';
import { sanitizeLogMessage } from './sanitize-log-message';

export const LINK_PREVIEW_FETCH_TIMEOUT_MS = 10_000;
export const LINK_PREVIEW_DNS_LOOKUP_TIMEOUT_MS = 3_000;
export const LINK_PREVIEW_MAX_HTML_BYTES = 65_536;
export const LINK_PREVIEW_CACHE_TTL_MS = 15 * 60 * 1000;
export const LINK_PREVIEW_IMAGE_MAX_BYTES = CHAT_INLINE_IMAGE_MAX_BYTES;
/** Cached data-URL payload cap (fetch may be larger; oversized bodies are not cached). */
export const LINK_PREVIEW_IMAGE_CACHE_MAX_BYTES = 256 * 1024;
export const LINK_PREVIEW_IMAGE_FETCH_TIMEOUT_MS = 10_000;
/** After a failed image fetch (e.g. 429), do not retry until this elapses. */
export const LINK_PREVIEW_IMAGE_NEGATIVE_CACHE_MS = 5 * 60 * 1000;
/** Max IPC link-preview fetches per rolling window (DoS / resource guard). */
export const LINK_PREVIEW_RATE_LIMIT_MAX = 20;
export const LINK_PREVIEW_RATE_LIMIT_WINDOW_MS = 60_000;
/** Shared hop cap for HTML page and image preview redirect following. */
export const LINK_PREVIEW_MAX_REDIRECTS = 5;
const LINK_PREVIEW_MAX_CACHE_ENTRIES = 256;
const LINK_PREVIEW_MAX_IMAGE_CACHE_ENTRIES = 128;

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
  return baseMimeFromContentType(contentType);
}

export function isLinkPreviewImageMime(contentType: string): boolean {
  return LINK_PREVIEW_IMAGE_MIMES.has(baseMimeFromContentType(contentType));
}

/** Cancel an unused body so the undici Agent pinned to the stream can close. */
export async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // catch-no-log-ok body may already be locked or aborted
  }
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
  const parts = url.pathname.split('/').filter(Boolean);
  const query = url.searchParams.get('v');
  let id: string | undefined;
  if (host.endsWith('youtu.be')) id = parts[0];
  else if (query && YOUTUBE_VIDEO_ID.test(query)) id = query;
  else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1];
  return id && YOUTUBE_VIDEO_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

function titleFromImageUrl(url: URL): string {
  const seg = url.pathname.split('/').findLast((s) => s.length > 0) ?? '';
  let title = seg;
  try {
    title = decodeURIComponent(seg);
  } catch {
    // catch-no-log-ok malformed percent-encoding retains the original segment
  }
  return title || url.hostname;
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

/** Resolves one hostname within the link-preview DNS deadline. */
async function lookupHostname(hostname: string): Promise<string> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const { address } = await Promise.race([
      dns.lookup(hostname, { order: 'verbatim' }),
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

/** Returns whether an IP address is globally reachable. */
function isGlobalIpAddress(address: string): boolean {
  return isGlobalIpLiteral(address) === true;
}

/** Single DNS resolution used for both block checks and pinned connect (avoids lookup TOCTOU). */
async function resolvePinnedPreviewAddress(hostname: string): Promise<string> {
  const bare = stripConnectHostBrackets(hostname.trim()).toLowerCase();
  if (isBlockedHostname(bare)) {
    throw new Error('blocked hostname');
  }

  if (isValidIpv6Literal(bare)) {
    if (!isGlobalIpAddress(bare)) throw new Error('blocked hostname');
    return bare;
  }
  if (bare.includes(':')) throw new Error('invalid IP address');

  const address = stripConnectHostBrackets(await lookupHostname(bare));
  if (!isGlobalIpAddress(address)) {
    throw new Error('blocked resolved address');
  }
  return address;
}

/** Returns the explicit URL port or the protocol default. */
function defaultConnectPort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'http:' ? 80 : 443;
}

/** Creates a socket lookup that always returns the validated address. */
function pinnedLookup(address: string): LookupFunction {
  const family = ipLiteralFamily(address) === 4 ? 4 : 6;
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

/** Fetches a URL through an agent pinned to its validated DNS result. */
async function fetchWithResolvedHost(urlString: string, init: RequestInit): Promise<Response> {
  const url = new URL(urlString);
  const address = await resolvePinnedPreviewAddress(url.hostname);
  const hostname = stripConnectHostBrackets(url.hostname);
  const servername = isValidIpLiteral(hostname) ? undefined : hostname;
  const agent = new Agent({
    connect: {
      lookup: pinnedLookup(address),
      port: defaultConnectPort(url),
      servername,
    },
  });
  try {
    const response = (await undiciFetch(urlString, {
      ...init,
      dispatcher: agent,
    } as Parameters<typeof undiciFetch>[1])) as unknown as Response;

    const upstream = response.body;
    // Closing the Agent before the body is consumed aborts streaming downloads
    // (large direct images). Keep it open until the body ends or is cancelled.
    if (!upstream) {
      await agent.close();
      return response;
    }

    let closed = false;
    const closeAgent = (): void => {
      if (closed) return;
      closed = true;
      void agent.close().catch(() => {
        // catch-no-log-ok agent may already be closed after abort
      });
    };

    const reader = upstream.getReader();
    // highWaterMark 0: do not auto-pull on construct. Default HWM can drain an empty
    // upstream before discardResponseBody runs, so cancel never reaches the Agent body.
    const stream = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              closeAgent();
              return;
            }
            controller.enqueue(value);
          } catch (err) {
            // catch-no-log-ok forward stream failure to consumer via controller.error
            closeAgent();
            controller.error(err);
          }
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason);
          } catch {
            // catch-no-log-ok cancel may race with stream abort
          } finally {
            closeAgent();
          }
        },
      },
      { highWaterMark: 0 },
    );

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (err) {
    await agent.close();
    throw err;
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

/** HTTPS + SSRF checks for each preview fetch hop (page or image). */
async function isAllowedHttpsPreviewUrl(urlString: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    // catch-no-log-ok invalid preview URL string
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
  return Buffer.concat(chunks, total);
}

/**
 * Follow page/image HTTPS redirects with the same per-hop checks and body cleanup.
 * Callers retain their Accept header and timeout, and pages retain the final URL.
 */
async function fetchPreviewResponseWithRedirectGuard(
  urlString: string,
  accept: string,
  timeoutMs: number,
  redirectCount = 0,
): Promise<{ response: Response; finalUrl: string } | null> {
  if (!(await isAllowedHttpsPreviewUrl(urlString))) return null;
  if (redirectCount > LINK_PREVIEW_MAX_REDIRECTS) return null;

  const response = await fetchWithResolvedHost(urlString, {
    method: 'GET',
    redirect: 'manual',
    headers: { Accept: accept },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) {
      await discardResponseBody(response);
      return null;
    }
    let nextUrl: string;
    try {
      nextUrl = new URL(location, urlString).href;
    } catch {
      // catch-no-log-ok malformed redirect Location header
      await discardResponseBody(response);
      return null;
    }
    await discardResponseBody(response);
    return fetchPreviewResponseWithRedirectGuard(nextUrl, accept, timeoutMs, redirectCount + 1);
  }

  return { response, finalUrl: urlString };
}

async function readPreviewImageResponse(
  response: Response,
): Promise<{ dataUrl: string; size: number } | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const bytes = await readResponseBodyUpTo(reader, LINK_PREVIEW_IMAGE_MAX_BYTES);
  if (!bytes) return null;
  const mime = resolveSafeRasterImageMime(bytes, LINK_PREVIEW_IMAGE_MIMES);
  return mime ? { dataUrl: bufferToRasterImageDataUrl(bytes, mime), size: bytes.length } : null;
}

async function fetchPreviewImageAsDataUrl(imageUrl: string): Promise<string | undefined> {
  if (!(await isAllowedHttpsPreviewUrl(imageUrl))) return undefined;

  const now = Date.now();
  const cached = imageCache.get(imageUrl);
  if (cached && cached.expires > now) {
    return cached.value ?? undefined;
  }

  return withInflightDedup(imageInFlight, imageUrl, async (): Promise<string | undefined> => {
    try {
      const fetched = await fetchPreviewResponseWithRedirectGuard(
        imageUrl,
        'image/*',
        LINK_PREVIEW_IMAGE_FETCH_TIMEOUT_MS,
      );
      const response = fetched?.response;
      if (!response?.ok) {
        if (response) await discardResponseBody(response);
        imageCache.set(imageUrl, {
          value: null,
          expires: now + LINK_PREVIEW_IMAGE_NEGATIVE_CACHE_MS,
        });
        return undefined;
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!isLinkPreviewImageMime(contentType)) {
        await discardResponseBody(response);
        return undefined;
      }

      const image = await readPreviewImageResponse(response);
      if (!image) return undefined;
      const { dataUrl, size } = image;
      // Only cache payloads within the tighter cache ceiling to bound main-process memory.
      if (size <= LINK_PREVIEW_IMAGE_CACHE_MAX_BYTES) {
        evictOldestCacheEntry(imageCache, LINK_PREVIEW_MAX_IMAGE_CACHE_ENTRIES);
        imageCache.set(imageUrl, { value: dataUrl, expires: now + LINK_PREVIEW_CACHE_TTL_MS });
      }
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
  if (!response.ok) {
    await discardResponseBody(response);
    return null;
  }

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

/** Decode a minimal set of HTML entities in OG/meta content values. */
export function decodeLinkPreviewHtmlEntities(value: string): string {
  // Unescape &amp; last so sequences like &amp;lt; stay as &lt; (not <).
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/&amp;/gi, '&');
}

const META_ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
/** Cap meta attribute text before regex parse (ReDoS guard on long tokens without `=`). */
export const LINK_PREVIEW_MAX_META_ATTR_CHARS = 4_096;

/** Parse attributes from a single `<meta …>` attribute string (order-independent). */
export function parseMetaTagAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  META_ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = META_ATTR_RE.exec(attrText)) !== null) {
    // The pattern requires a nonempty name and one of the quoted-value captures.
    const name = match[1].toLowerCase();
    const raw = match[2] ?? match[3];
    attrs[name] = decodeLinkPreviewHtmlEntities(raw);
  }
  return attrs;
}

const META_OPEN_RE = /<meta(?=[\s/>]|$)/gi;

/** Scan each candidate once, respecting quotes and stopping at an unterminated suffix. */
export function scanNextMetaTag(
  html: string,
  from: number,
): { attrText: string; nextIndex: number } | null {
  const start = Math.max(0, from);
  if (!Number.isInteger(start)) return null;
  META_OPEN_RE.lastIndex = start;
  if (!META_OPEN_RE.exec(html)) return null;
  const afterKeyword = META_OPEN_RE.lastIndex;
  let quote = '';
  for (let i = afterKeyword; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return { attrText: html.slice(afterKeyword, i), nextIndex: i + 1 };
  }
  return null;
}

/**
 * Extract meta `content` by Open Graph `property` or HTML `name`, ignoring extra
 * attributes (e.g. React Helmet `data-react-helmet`) and attribute order.
 */
export function extractMetaContent(
  html: string,
  opts: { property?: string; name?: string },
): string | undefined {
  const wantProperty = opts.property?.toLowerCase();
  const wantName = opts.name?.toLowerCase();
  let cursor = 0;
  while (cursor < html.length) {
    const tag = scanNextMetaTag(html, cursor);
    if (!tag) return undefined;
    cursor = tag.nextIndex;
    if (tag.attrText.length > LINK_PREVIEW_MAX_META_ATTR_CHARS) continue;
    const attrs = parseMetaTagAttributes(tag.attrText);
    const content = attrs.content?.trim();
    if (!content) continue;
    if (wantProperty && attrs.property?.toLowerCase() === wantProperty) return content;
    if (wantName && attrs.name?.toLowerCase() === wantName) return content;
  }
  return undefined;
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

  const metaTitle = extractMetaContent(html, { property: 'og:title' });
  const titleTag = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1];
  // Meta content is already entity-decoded in parseMetaTagAttributes; <title> is not.
  const title = (
    metaTitle ?? (titleTag ? decodeLinkPreviewHtmlEntities(titleTag) : undefined)
  )?.trim();
  if (!title) return null;

  const description =
    extractMetaContent(html, { property: 'og:description' }) ??
    extractMetaContent(html, { name: 'description' });

  const ogImage =
    extractMetaContent(html, { property: 'og:image' }) ??
    extractMetaContent(html, { name: 'twitter:image' });
  let image = ogImage?.startsWith('https://') ? ogImage : undefined;

  if (image) {
    image = await fetchPreviewImageAsDataUrl(image);
  }

  return { title, description, image };
}

async function fetchDirectImagePreviewFromResponse(
  url: URL,
  response: Response,
): Promise<LinkPreviewMetadata | null> {
  const image = await readPreviewImageResponse(response);
  if (!image) return null;
  return { title: titleFromImageUrl(url), image: image.dataUrl, kind: 'image' };
}

/** Extension-hinted HTTPS images via the dedicated image fetcher (follows redirects). */
async function tryDirectImageUrlPreview(url: URL): Promise<LinkPreviewMetadata | null> {
  if (url.protocol !== 'https:' || !isLikelyDirectImageUrl(url.href)) return null;
  const dataUrl = await fetchPreviewImageAsDataUrl(url.href);
  if (!dataUrl) return null;
  return {
    title: titleFromImageUrl(url),
    image: dataUrl,
    kind: 'image',
  };
}

async function fetchLinkPreviewFromHttpResponse(
  url: URL,
  urlString: string,
  response: Response,
): Promise<LinkPreviewMetadata | null> {
  if (!response.ok) {
    await discardResponseBody(response);
    return null;
  }
  const contentType = response.headers.get('content-type') ?? '';

  // HTTPS-only for Content-Type image embeds (cleartext MITM risk).
  if (isLinkPreviewImageMime(contentType)) {
    if (url.protocol !== 'https:') {
      await discardResponseBody(response);
      return null;
    }
    return await fetchDirectImagePreviewFromResponse(url, response);
  }

  if (!contentType.includes('text/html')) {
    await discardResponseBody(response);
    return null;
  }
  return await fetchHtmlLinkPreview(urlString, response);
}

async function fetchLinkPreviewUncached(
  urlString: string,
  url: URL,
): Promise<LinkPreviewMetadata | null> {
  if (await isBlockedHostnameResolved(url.hostname)) return null;

  try {
    if (isYouTubePreviewHostname(url.hostname)) {
      const yt = await fetchYouTubeOEmbedPreview(url);
      if (yt) return yt;
    }

    const direct = await tryDirectImageUrlPreview(url);
    if (direct) return direct;

    const fetched = await fetchPreviewResponseWithRedirectGuard(
      urlString,
      'text/html,image/*,*/*;q=0.8',
      LINK_PREVIEW_FETCH_TIMEOUT_MS,
    );
    if (!fetched) return null;
    const finalUrl = new URL(fetched.finalUrl);
    return await fetchLinkPreviewFromHttpResponse(finalUrl, fetched.finalUrl, fetched.response);
  } catch (err) {
    console.debug(
      '[chat] fetchLinkPreview error:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    return null;
  }
}

export async function fetchLinkPreview(urlString: string): Promise<LinkPreviewMetadata | null> {
  let url: URL;
  try {
    url = new URL(urlString);
    if (url.protocol !== 'https:') return null;
  } catch {
    // catch-no-log-ok invalid URL strings fail closed without preview work
    return null;
  }

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
      const value = await fetchLinkPreviewUncached(urlString, url);
      evictOldestCacheEntry(previewCache, LINK_PREVIEW_MAX_CACHE_ENTRIES);
      previewCache.set(urlString, { value, expires: Date.now() + LINK_PREVIEW_CACHE_TTL_MS });
      return value;
    },
  );
}
