/** Path extensions that strongly suggest a direct raster image URL (query ignored). */
const DIRECT_IMAGE_PATH_EXT = /\.(?:jpe?g|png|gif|webp|avif|bmp|ico)$/i;

/** True when the URL path looks like a direct image (e.g. `/photo.jpg`). */
export function isLikelyDirectImageUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return DIRECT_IMAGE_PATH_EXT.test(parsed.pathname);
  } catch {
    // catch-no-log-ok invalid URL string
    return false;
  }
}
