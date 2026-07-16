/**
 * Shared hex ↔ bytes helpers. Protocol call sites differ in strictness (exact length vs.
 * lenient sniffer decode) — expose variants rather than unifying validation rules.
 */

/** Encode bytes as lowercase hex. Negative byte values (test fixtures, signed buffers) are coerced into range. */
export function bytesToHex(bytes: readonly number[] | Uint8Array): string {
  const hex: string[] = [];
  for (const raw of bytes) {
    const byte = raw < 0 ? raw + 256 : raw;
    hex.push((byte >>> 4).toString(16));
    hex.push((byte & 0xf).toString(16));
  }
  return hex.join('');
}

/**
 * Strip non-hex characters and decode. Returns an empty array for odd-length input instead of
 * throwing — used for best-effort sniffer/log decode where malformed input should not crash rendering.
 */
export function hexToBytesLenient(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  if (clean.length % 2 !== 0) return new Uint8Array();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Decode hex into exactly `byteLength` bytes. Requires `hex.length === byteLength * 2` and every
 * pair to be valid hex; returns `undefined` (never throws) otherwise — used for key/PSK parsing
 * where callers need a validation signal rather than a caught exception.
 */
export function hexToBytesExact(
  hex: string | undefined,
  byteLength: number,
): Uint8Array | undefined {
  if (hex?.length !== byteLength * 2) return undefined;
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byte) || byte < 0 || byte > 255) return undefined;
    bytes[i] = byte;
  }
  return bytes;
}

/** Same as {@link hexToBytesExact} but throws a descriptive error on invalid input. */
export function hexToBytesExactOrThrow(hex: string, byteLength: number): Uint8Array {
  const bytes = hexToBytesExact(hex, byteLength);
  if (!bytes) {
    throw new Error(
      `Invalid hex string. Must be exactly ${byteLength * 2} hexadecimal characters.`,
    );
  }
  return bytes;
}
