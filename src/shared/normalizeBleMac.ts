/** Normalize MAC / BLE address for registry keys (case-insensitive, colon-separated). */
export function normalizeBleMac(mac: string): string {
  const trimmed = mac.trim();
  if (!trimmed) return trimmed;
  const hex = trimmed.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length === 12) {
    return hex.match(/.{1,2}/g)!.join(':');
  }
  return trimmed.toLowerCase();
}
