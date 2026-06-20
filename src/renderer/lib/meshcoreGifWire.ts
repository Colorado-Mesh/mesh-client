/**
 * MeshCore Open GIF wire format (`g:GIFID` and Giphy URLs).
 * @see https://github.com/musznik/meshcore-open-mx/blob/dev/lib/helpers/gif_helper.dart
 */

const MESHCORE_GIF_SHORT_WIRE = /^g:([A-Za-z0-9_-]+)$/;
const MESHCORE_GIF_ID = /^[A-Za-z0-9_-]+$/;
const MESHCORE_GIF_PAGE_ID = /^[A-Za-z0-9_]+$/;

function stripOptionalHttpPrefix(text: string): string {
  return text.replace(/^https?:\/\//i, '');
}

function parseGiphyMediaUrlId(text: string): string | null {
  const path = stripOptionalHttpPrefix(text.trim());
  const prefix = 'media.giphy.com/media/';
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx <= 0) return null;
  const id = rest.slice(0, slashIdx);
  const suffix = rest.slice(slashIdx);
  if (suffix !== '/giphy.gif') return null;
  return MESHCORE_GIF_ID.test(id) ? id : null;
}

function parseGiphyPageUrlId(text: string): string | null {
  const path = stripOptionalHttpPrefix(text.trim()).replace(/\/$/, '');
  const prefix = 'giphy.com/gifs/';
  if (!path.startsWith(prefix)) return null;
  const slug = path.slice(prefix.length);
  if (!slug) return null;
  const dashIdx = slug.lastIndexOf('-');
  const id = dashIdx >= 0 ? slug.slice(dashIdx + 1) : slug;
  return MESHCORE_GIF_PAGE_ID.test(id) ? id : null;
}

/** Parse Giphy GIF id from MeshCore Open wire text; null when not a GIF payload. */
export function parseMeshcoreGifId(text: string): string | null {
  const trimmed = text.trim();
  const short = MESHCORE_GIF_SHORT_WIRE.exec(trimmed);
  if (short) return short[1];
  return parseGiphyMediaUrlId(trimmed) ?? parseGiphyPageUrlId(trimmed);
}

export function meshcoreGiphyMediaUrl(gifId: string): string {
  return `https://media.giphy.com/media/${gifId}/giphy.gif`;
}

export function meshcoreGiphyPageUrl(gifId: string): string {
  return `https://giphy.com/gifs/${gifId}`;
}
