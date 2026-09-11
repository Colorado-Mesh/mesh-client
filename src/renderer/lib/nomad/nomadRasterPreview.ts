/** Common Nomad `/file/...` raster extensions for inline preview. */
const NOMAD_RASTER_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;

export function isNomadRasterFileName(fileName: string): boolean {
  return NOMAD_RASTER_EXT.test(fileName.trim());
}

/** Build a browser data URL from Nomad file base64 for raster preview. */
export function nomadRasterDataUrl(fileName: string, contentBase64: string): string | null {
  if (!isNomadRasterFileName(fileName)) return null;
  const lower = fileName.toLowerCase();
  let mime = 'application/octet-stream';
  if (lower.endsWith('.png')) mime = 'image/png';
  else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mime = 'image/jpeg';
  else if (lower.endsWith('.gif')) mime = 'image/gif';
  else if (lower.endsWith('.webp')) mime = 'image/webp';
  else if (lower.endsWith('.bmp')) mime = 'image/bmp';
  else if (lower.endsWith('.avif')) mime = 'image/avif';
  return `data:${mime};base64,${contentBase64}`;
}
