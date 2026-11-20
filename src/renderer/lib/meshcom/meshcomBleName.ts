/**
 * MeshCom BLE advertisement naming (firmware `nrf52_ble.cpp` / `esp32_main.cpp`).
 * nRF / ESP32 both use `MC-<mac>-<callsign>` (e.g. `MC-a1b2-NV0N-20`).
 */

/** True when the advertised local name looks like a MeshCom companion. */
export function looksLikeMeshcomBleName(name: string | null | undefined): boolean {
  const n = typeof name === 'string' ? name.trim() : '';
  return /^MC-/i.test(n);
}

/** True when the name looks like a Reticulum RNode (shared NUS UUID — not MeshCom). */
export function looksLikeRnodeBleName(name: string | null | undefined): boolean {
  const n = typeof name === 'string' ? name.trim() : '';
  return /^RNode\b/i.test(n);
}

/**
 * MeshCom BLE picker label: prefer the live MeshCom advert over a stale
 * `bleDeviceNames` cache entry from another protocol on the same CoreBluetooth id.
 */
export function meshcomBlePickerDisplayName(
  deviceId: string,
  advertisedName: string | null | undefined,
  cachedName: string | null | undefined,
  fallback: (
    id: string,
    advertised: string | null | undefined,
    cached: string | null | undefined,
  ) => string,
): string {
  const advertised = advertisedName?.trim() || null;
  const cached = cachedName?.trim() || null;
  if (advertised && looksLikeMeshcomBleName(advertised)) {
    return advertised;
  }
  if (advertised && cached && looksLikeRnodeBleName(cached)) {
    return advertised;
  }
  return fallback(deviceId, advertisedName, cachedName);
}
