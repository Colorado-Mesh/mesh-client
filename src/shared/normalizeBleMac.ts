/** Normalize MAC / BLE address for registry keys (case-insensitive, colon-separated). */
export function normalizeBleMac(mac: string): string {
  const trimmed = mac.trim();
  if (!trimmed) return trimmed;
  const hex = bleIdHexDigits(trimmed);
  if (hex.length === 12) {
    return hex.match(/.{1,2}/g)!.join(':');
  }
  return trimmed.toLowerCase();
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
  return bleIdHexDigits(id).length === 12;
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
