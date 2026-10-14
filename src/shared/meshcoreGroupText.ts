/**
 * MeshCore GRP_TXT (channel message) codec, matching firmware `createGroupDatagram`:
 *
 *   innerPayload = channelHash(1) | MAC(2) | AES-128-ECB(secret[0..16], zero-padded plaintext)
 *   MAC          = HMAC-SHA256(key = secret zero-padded to 32 bytes, ciphertext)[0..2]
 *   plaintext    = timestamp u32 LE | flags u8 | "senderName: text"
 *   channelHash  = SHA-256(secret)[0]
 */

import { ecb } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

const AES_BLOCK = 16;
const MAC_SIZE = 2;
const HMAC_KEY_SIZE = 32;
const CHANNEL_SECRET_SIZE = 16;
const PLAINTEXT_HEADER_SIZE = 5;

export interface MeshcoreGroupTextDecoded {
  timestampSec: number;
  flags: number;
  /** Full on-air text, normally `"senderName: body"`. */
  text: string;
}

function hmacKey(secret: Uint8Array): Uint8Array {
  const key = new Uint8Array(HMAC_KEY_SIZE);
  key.set(secret.subarray(0, Math.min(secret.length, HMAC_KEY_SIZE)));
  return key;
}

function macFor(secret: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  return hmac(sha256, hmacKey(secret), ciphertext).subarray(0, MAC_SIZE);
}

/** One-byte channel hash carried in the first byte of every GRP_TXT inner payload. */
export function meshcoreChannelHash(secret: Uint8Array): number {
  return sha256(secret).at(0) ?? 0;
}

/** Decode a GRP_TXT inner payload with a 16-byte channel secret; `null` on any mismatch. */
export function decodeMeshcoreGroupText(
  secret: Uint8Array,
  innerPayload: Uint8Array,
): MeshcoreGroupTextDecoded | null {
  if (secret.length !== CHANNEL_SECRET_SIZE) return null;
  const cipherLen = innerPayload.length - 1 - MAC_SIZE;
  if (cipherLen < AES_BLOCK || cipherLen % AES_BLOCK !== 0) return null;
  if (innerPayload[0] !== meshcoreChannelHash(secret)) return null;

  const mac = innerPayload.subarray(1, 1 + MAC_SIZE);
  const ciphertext = innerPayload.subarray(1 + MAC_SIZE);
  const expectedMac = macFor(secret, ciphertext);
  if (mac[0] !== expectedMac[0] || mac[1] !== expectedMac[1]) return null;

  const plain = ecb(secret, { disablePadding: true }).decrypt(ciphertext);
  const header = new DataView(plain.buffer, plain.byteOffset, PLAINTEXT_HEADER_SIZE);
  const timestampSec = header.getUint32(0, true);
  const flags = header.getUint8(4);
  let end = plain.length;
  while (end > PLAINTEXT_HEADER_SIZE && plain[end - 1] === 0) end--;
  const text = new TextDecoder().decode(plain.subarray(PLAINTEXT_HEADER_SIZE, end));
  return { timestampSec, flags, text };
}

/** Encode a GRP_TXT inner payload (used by tests and fixtures; mirrors firmware). */
export function encodeMeshcoreGroupText(
  secret: Uint8Array,
  timestampSec: number,
  text: string,
  flags = 0,
): Uint8Array {
  const body = new TextEncoder().encode(text);
  const rawLen = PLAINTEXT_HEADER_SIZE + body.length;
  const plain = new Uint8Array(Math.ceil(rawLen / AES_BLOCK) * AES_BLOCK);
  const ts = timestampSec >>> 0;
  plain[0] = ts & 0xff;
  plain[1] = (ts >>> 8) & 0xff;
  plain[2] = (ts >>> 16) & 0xff;
  plain[3] = (ts >>> 24) & 0xff;
  plain[4] = flags & 0xff;
  plain.set(body, PLAINTEXT_HEADER_SIZE);
  const ciphertext = ecb(secret, { disablePadding: true }).encrypt(plain);
  const out = new Uint8Array(1 + MAC_SIZE + ciphertext.length);
  out[0] = meshcoreChannelHash(secret);
  out.set(macFor(secret, ciphertext), 1);
  out.set(ciphertext, 1 + MAC_SIZE);
  return out;
}
