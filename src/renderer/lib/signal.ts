export function rssiToSignalLevel(rssi: number | null | undefined): 0 | 1 | 2 | 3 | 4 {
  if (rssi == null) return 0;
  if (rssi > -60) return 4;
  if (rssi > -70) return 3;
  if (rssi > -80) return 2;
  if (rssi > -90) return 1;
  return 0;
}

/** True when BLE RSSI is known and at most 1 bar (≤ -80 dBm). Unknown/null → false. */
export function isWeakBleRssi(rssi: number | null | undefined): boolean {
  if (rssi == null || !Number.isFinite(rssi)) return false;
  return rssiToSignalLevel(rssi) <= 1;
}

/** Weakest finite RSSI in a list (most negative); null when none known. */
export function weakestBleRssi(
  devices: readonly { rssi?: number | null | undefined }[],
): number | null {
  let weakest: number | null = null;
  for (const device of devices) {
    const rssi = device.rssi;
    if (rssi == null || !Number.isFinite(rssi)) continue;
    if (weakest == null || rssi < weakest) weakest = rssi;
  }
  return weakest;
}
