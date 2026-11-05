/**
 * Parse BlueZ device-info text (`Paired: yes|no`) for bond state (Linux).
 * Anchored to line start so a device Name cannot spoof the paired field.
 */
export function parseBluetoothctlPairedState(info: string): 'yes' | 'no' | 'unknown' {
  const s = info.toLowerCase();
  if (/^paired:\s*yes\b/m.test(s)) return 'yes';
  if (/^paired:\s*no\b/m.test(s)) return 'no';
  return 'unknown';
}
