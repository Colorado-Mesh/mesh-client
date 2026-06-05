/**
 * 16-byte AES-128 key for the Meshtastic default public channel (base64 "AQ==", zero-padded).
 * Must match main-process {@link parsePsk}("AQ==") and mqtt-manager DEFAULT_PSK.
 */
export const MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES = new Uint8Array([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

/** Zero-pad short Meshtastic channel keys to 16 bytes (matches mqtt-manager parsePsk). */
export function normalizeMeshtasticPskTo16Bytes(psk: Uint8Array | Buffer): Uint8Array {
  const out = new Uint8Array(16);
  const src = psk instanceof Uint8Array ? psk : new Uint8Array(psk);
  const len = Math.min(src.length, 16);
  out.set(src.subarray(0, len));
  return out;
}

/** True when `psk` matches the well-known default Meshtastic public channel key (`AQ==`). */
export function isMeshtasticDefaultPublicPsk(psk: Uint8Array | Buffer): boolean {
  if (!psk || psk.length === 0) return false;
  const n = normalizeMeshtasticPskTo16Bytes(psk);
  for (let i = 0; i < 16; i++) {
    if (n[i] !== MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES[i]) return false;
  }
  return true;
}
