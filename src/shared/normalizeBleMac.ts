function isHexChar(ch: string | undefined): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

/**
 * Compact 12-hex, or six 2-hex octets with a consistent `:` or `-` separator.
 * Rejects suffixes and unsupported separators (do not strip them into a MAC).
 */
function isStrictBleMacShape(id: string): boolean {
  if (id.length === 12) {
    for (let i = 0; i < 12; i++) {
      if (!isHexChar(id[i])) return false;
    }
    return true;
  }
  if (id.length !== 17) return false;
  const sep = id[2];
  if (sep !== ':' && sep !== '-') return false;
  for (let i = 0; i < 6; i++) {
    const offset = i * 3;
    if (!isHexChar(id[offset]) || !isHexChar(id[offset + 1])) return false;
    if (i < 5 && id[offset + 2] !== sep) return false;
  }
  return true;
}

/** Normalize MAC / BLE address for registry keys (case-insensitive, colon-separated). */
export function normalizeBleMac(mac: string): string {
  const trimmed = mac.trim();
  if (!trimmed) return trimmed;
  if (!isStrictBleMacShape(trimmed)) {
    return trimmed.toLowerCase();
  }
  const hex = bleIdHexDigits(trimmed);
  return hex.match(/.{1,2}/g)!.join(':');
}

/** Stripped lowercase hex digits from a MAC, UUID, or other BLE identifier. */
function bleIdHexDigits(id: string): string {
  return id
    .trim()
    .replace(/[^0-9a-fA-F]/g, '')
    .toLowerCase();
}

/** True when `id` is a 48-bit BLE MAC (colon, hyphen, or compact 12-hex). */
export function isTwelveHexBleMac(id: string): boolean {
  return isStrictBleMacShape(id.trim());
}

/**
 * Colon-separated lowercase MAC when `id` is 12-hex; otherwise the original identifier
 * (CoreBluetooth UUIDs must not be lowercased).
 */
export function formatBleDeviceIdForDisplay(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return trimmed;
  if (isTwelveHexBleMac(trimmed)) return normalizeBleMac(trimmed);
  return trimmed;
}

export interface BlePickerIdentityInput {
  deviceId: string;
  address?: string | null;
  cachedMac?: string | null;
}

export interface BlePickerIdentity {
  /** Formatted MAC or the original non-MAC identifier. */
  display: string;
  isMac: boolean;
}

/** Prefer a real MAC from scan `address`, then a cached UUID→MAC mapping, then `deviceId`. */
export function resolveBlePickerIdentity(input: BlePickerIdentityInput): BlePickerIdentity {
  for (const candidate of [input.address, input.cachedMac, input.deviceId]) {
    const trimmed = candidate?.trim() ?? '';
    if (!trimmed) continue;
    if (isTwelveHexBleMac(trimmed)) {
      return { display: formatBleDeviceIdForDisplay(trimmed), isMac: true };
    }
  }
  const deviceId = input.deviceId.trim();
  return { display: formatBleDeviceIdForDisplay(deviceId), isMac: false };
}
