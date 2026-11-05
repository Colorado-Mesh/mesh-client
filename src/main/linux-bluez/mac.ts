/** MAC helpers for BlueZ object paths (`/org/bluez/hci0/dev_AA_BB_…`). */

export function isMacAddress(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 6) return false;
  return parts.every((part) => /^[0-9A-Fa-f]{2}$/.test(part));
}

/** BlueZ device object-path suffix from a colon MAC (case-insensitive). */
export function macToDeviceSuffix(mac: string): string {
  if (!isMacAddress(mac)) {
    throw new Error(`invalid MAC address: ${mac}`);
  }
  return `dev_${mac.replace(/:/g, '_').toUpperCase()}`;
}
