/**
 * MeshCore Open GIF wire format (`g:GIFID` and Giphy URLs).
 * @see https://github.com/musznik/meshcore-open-mx/blob/dev/lib/helpers/gif_helper.dart
 */

const MESHCORE_GIF_SHORT_WIRE = /^g:([A-Za-z0-9_-]+)$/;
const MESHCORE_GIF_ID = /^[A-Za-z0-9_-]+$/;
const MESHCORE_GIF_PAGE_ID = /^[A-Za-z0-9_]+$/;

const GIPHY_MEDIA_ORIGIN = 'https://media.giphy.com';
const GIPHY_PAGE_ORIGIN = 'https://giphy.com';

function readHttpUrl(text: string): URL | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(href);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url;
  } catch {
    // catch-no-log-ok invalid user/mesh wire URL string
    return null;
  }
}

function parseGiphyMediaUrlId(text: string): string | null {
  const url = readHttpUrl(text);
  if (url?.hostname !== 'media.giphy.com') return null;
  const segments = url.pathname.split('/').filter((part) => part.length > 0);
  if (segments.length !== 3 || segments[0] !== 'media' || segments[2] !== 'giphy.gif') {
    return null;
  }
  const id = segments[1];
  return MESHCORE_GIF_ID.test(id) ? id : null;
}

function parseGiphyPageUrlId(text: string): string | null {
  const url = readHttpUrl(text);
  if (url?.hostname !== 'giphy.com') return null;
  const segments = url.pathname.split('/').filter((part) => part.length > 0);
  if (segments.length < 2 || segments[0] !== 'gifs') return null;
  const slug = segments.slice(1).join('/');
  if (!slug) return null;
  const dashIdx = slug.lastIndexOf('-');
  const id = dashIdx >= 0 ? slug.slice(dashIdx + 1) : slug;
  return MESHCORE_GIF_PAGE_ID.test(id) ? id : null;
}

function assertMeshcoreGifId(gifId: string): void {
  if (!MESHCORE_GIF_ID.test(gifId)) {
    throw new Error('Invalid Giphy id');
  }
}

/** Parse Giphy GIF id from MeshCore Open wire text; null when not a GIF payload. */
export function parseMeshcoreGifId(text: string): string | null {
  const trimmed = text.trim();
  const short = MESHCORE_GIF_SHORT_WIRE.exec(trimmed);
  if (short) return short[1];
  return parseGiphyMediaUrlId(trimmed) ?? parseGiphyPageUrlId(trimmed);
}

export function meshcoreGiphyMediaUrl(gifId: string): string {
  assertMeshcoreGifId(gifId);
  return new URL(`/media/${gifId}/giphy.gif`, `${GIPHY_MEDIA_ORIGIN}/`).href;
}

export function meshcoreGiphyPageUrl(gifId: string): string {
  assertMeshcoreGifId(gifId);
  return new URL(`/gifs/${gifId}`, `${GIPHY_PAGE_ORIGIN}/`).href;
}

/** Encode Giphy id as MeshCore Open compact wire (`g:GIFID`). Mirrors Open encodeGif(). */
export function formatMeshcoreGifWire(gifId: string): string {
  assertMeshcoreGifId(gifId);
  return `g:${gifId}`;
}

/** If text is a Giphy URL, short wire, or bare id, return compact `g:ID`; else null. */
export function normalizeMeshcoreGifOutboundWire(text: string): string | null {
  const gifId = parseMeshcoreGifId(text);
  if (gifId == null) return null;
  return formatMeshcoreGifWire(gifId);
}
