/** Match reticulum-sidecar `stable_hash` (FNV-1a 128-bit) as 32-char hex. */
function stableHash128Hex(input: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 128n) - 1n;
  for (const byte of new TextEncoder().encode(input)) {
    h ^= BigInt(byte);
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(32, '0');
}

export function computeReticulumMessageHash(
  senderHash: string,
  timestampMs: number,
  text: string,
): string {
  return stableHash128Hex(`${senderHash}:${timestampMs}:${text}`);
}
