/**
 * Firmware `defaultpsk` (Meshtastic `Channels.h`) — the 16-byte AES-128 key that one-byte PSK
 * shorthand alias `0x01` (base64 "AQ==") expands to. This is the real channel-settings key for
 * the default public channel ("LongFast"), not a zero-padded literal — firmware does not use the
 * raw alias byte for encryption or channel-hashing, only as a compact on-device/QR-code stand-in.
 * Must match main-process {@link parsePsk} and mqtt-manager `DEFAULT_PSK`.
 */
export const MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES = new Uint8Array([
  0xd4, 0xf1, 0xbb, 0x3a, 0x20, 0x29, 0x07, 0x59, 0xf0, 0xbc, 0xff, 0xab, 0xcf, 0x4e, 0x69, 0x01,
]);

/**
 * Expand a Meshtastic one-byte PSK shorthand alias (firmware `Channels::getKey`) to its full
 * 16-byte key. Alias `1` is the standard default key above; `2`-`10` are "simple" presets
 * derived by incrementing the default key's final byte by `(index - 1)`. `0` means "no
 * encryption" (no key). Returns `null` for `0` and for any index outside the defined `1`-`10`
 * range (not a firmware-recognized alias).
 */
export function expandMeshtasticPskAlias(index: number): Uint8Array | null {
  if (index < 1 || index > 10) return null;
  const lastIndex = MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES.length - 1;
  return MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES.map((byte, i) =>
    i === lastIndex ? (byte + (index - 1)) & 0xff : byte,
  );
}

/**
 * Normalize a Meshtastic channel PSK to 16 bytes. A one-byte input is treated as a firmware
 * shorthand alias and properly expanded (matches mqtt-manager `parsePsk`); any other short
 * input is zero-padded (not a defined firmware shorthand, kept permissive for malformed input).
 */
export function normalizeMeshtasticPskTo16Bytes(psk: Uint8Array | Buffer): Uint8Array {
  const src = psk instanceof Uint8Array ? psk : new Uint8Array(psk);
  if (src.length === 1) {
    const expanded = expandMeshtasticPskAlias(src.at(0) ?? 0);
    if (expanded) return expanded;
  }
  const out = new Uint8Array(16);
  const len = Math.min(src.length, 16);
  out.set(src.subarray(0, len));
  return out;
}

/** True when `psk` matches the well-known default Meshtastic public channel key (`AQ==`). */
export function isMeshtasticDefaultPublicPsk(psk: Uint8Array | Buffer): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  if (!psk || psk.length === 0) return false;
  const n = normalizeMeshtasticPskTo16Bytes(psk);
  for (let i = 0; i < 16; i++) {
    if (n[i] !== MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES[i]) return false;
  }
  return true;
}
