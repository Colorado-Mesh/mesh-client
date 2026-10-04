const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** IEEE CRC-32 (zlib), matching the firmware's `crc32Buffer`. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Firmware 2.8 node number for a 32-byte public key (`my_node_num = crc32(public_key)`).
 * Returns null for anything that is not 64 hex characters.
 */
export function meshtasticNodeNumFromPublicKeyHex(publicKeyHex: string): number | null {
  if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(publicKeyHex.slice(i * 2, i * 2 + 2), 16);
  }
  return crc32(bytes);
}
