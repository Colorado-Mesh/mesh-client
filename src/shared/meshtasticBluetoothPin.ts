/** Meshtastic Config.Bluetooth.fixedPin is numeric on the wire; pad for 6-digit display. */
export function formatMeshtasticBluetoothPin(fixedPin: number): string {
  if (!Number.isInteger(fixedPin) || fixedPin < 0 || fixedPin > 999_999) {
    return String(fixedPin);
  }
  return String(fixedPin).padStart(6, '0');
}

/** Parse a 6-digit PIN string for Config.Bluetooth.fixedPin wire value. */
export function parseMeshtasticBluetoothPin(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d{6}$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Restrict Bluetooth PIN field input to at most six decimal digits. */
export function sanitizeMeshtasticBluetoothPinInput(input: string): string {
  return input.replace(/\D/g, '').slice(0, 6);
}
