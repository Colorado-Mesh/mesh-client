/**
 * Stable, radio-independent identity for a LoRa group channel. Slot indices differ between
 * radios, so persisted chat rows carry this key and are remapped to whichever slot holds the
 * same channel on the connected radio.
 *
 * The key is a non-cryptographic 64-bit digest of protocol + trimmed name + secret bytes; it
 * keeps raw channel secrets out of SQLite while staying synchronous for write paths.
 */

export type ChannelIdentityProtocol = 'meshtastic' | 'meshcore';

const CHANNEL_KEY_RE = /^[0-9a-f]{16}$/;

function digest64(bytes: Uint8Array): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const b of bytes) {
    h1 = Math.imul(h1 ^ b, 2654435761);
    h2 = Math.imul(h2 ^ b, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export function computeChannelIdentityKey(
  protocol: ChannelIdentityProtocol,
  name: string,
  secret: Uint8Array,
): string {
  const head = new TextEncoder().encode(`${protocol}\u0000${name.trim()}\u0000`);
  const buf = new Uint8Array(head.length + secret.length);
  buf.set(head, 0);
  buf.set(secret, head.length);
  return digest64(buf);
}

export function isChannelIdentityKey(value: unknown): value is string {
  return typeof value === 'string' && CHANNEL_KEY_RE.test(value);
}
