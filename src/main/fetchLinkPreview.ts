import { sanitizeLogMessage } from './sanitize-log-message';

export const LINK_PREVIEW_FETCH_TIMEOUT_MS = 10_000;
export const LINK_PREVIEW_MAX_HTML_BYTES = 65_536;
export const LINK_PREVIEW_CACHE_TTL_MS = 15 * 60 * 1000;
export const LINK_PREVIEW_IMAGE_MAX_BYTES = 262_144;
export const LINK_PREVIEW_IMAGE_FETCH_TIMEOUT_MS = 10_000;
/** After a failed image fetch (e.g. 429), do not retry until this elapses. */
export const LINK_PREVIEW_IMAGE_NEGATIVE_CACHE_MS = 5 * 60 * 1000;

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

export function clearLinkPreviewCachesForTests(): void {
  previewCache.clear();
  imageCache.clear();
}

export function isBlockedHostname(hostname: string): boolean {
  return LINK_PREVIEW_BLOCKED_HOSTNAMES.has(hostname.toLowerCase()) || isIpv4Literal(hostname);
}

export function shouldProxyPreviewImageUrl(imageUrl: string): boolean {
  try {
    return LINK_PREVIEW_IMAGE_PROXY_HOSTS.has(new URL(imageUrl).hostname.toLowerCase());
  } catch {
    // catch-no-log-ok invalid image URL string
    return false;
  }
}

function isAllowedHttpsImageUrl(imageUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    // catch-no-log-ok invalid image URL string
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return !isBlockedHostname(parsed.hostname);
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
    void reader.cancel();
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

async function fetchPreviewImageAsDataUrl(imageUrl: string): Promise<string | undefined> {
  if (!isAllowedHttpsImageUrl(imageUrl)) return undefined;

  const now = Date.now();
  const cached = imageCache.get(imageUrl);
  if (cached && cached.expires > now) {
    return cached.value ?? undefined;
  }

  try {
    const response = await fetch(imageUrl, {
      method: 'GET',
      headers: { Accept: 'image/*' },
      signal: AbortSignal.timeout(LINK_PREVIEW_IMAGE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      imageCache.set(imageUrl, {
        value: null,
        expires: now + LINK_PREVIEW_IMAGE_NEGATIVE_CACHE_MS,
      });
      return undefined;
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) return undefined;

    const reader = response.body?.getReader();
    if (!reader) return undefined;
    const bytes = await readResponseBodyUpTo(reader, LINK_PREVIEW_IMAGE_MAX_BYTES);
    if (!bytes) return undefined;

    const mime = contentType.split(';')[0]?.trim() || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
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
}

export interface LinkPreviewMetadata {
  title: string;
  description?: string;
  image?: string;
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
  if (isBlockedHostname(url.hostname)) return null;

  try {
    const response = await fetch(urlString, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(LINK_PREVIEW_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return null;

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

    if (image && shouldProxyPreviewImageUrl(image)) {
      image = await fetchPreviewImageAsDataUrl(image);
    }

    return { title, description, image };
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

  const value = await fetchLinkPreviewUncached(urlString);
  previewCache.set(urlString, { value, expires: now + LINK_PREVIEW_CACHE_TTL_MS });
  return value;
}
