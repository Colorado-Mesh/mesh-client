/** Normalize LXMF / Reticulum message hash for case-insensitive equality. */
export function normalizeReticulumMessageHash(hash: string | null | undefined): string {
  return (hash ?? '').trim().toLowerCase();
}

/**
 * Valid outbound WS / persist message hash: lowercase hex, 8–128 chars
 * (LXMF hashes are 64 hex; provisional ids may be shorter hex).
 */
export function isValidReticulumOutboundMessageHash(hash: string | null | undefined): boolean {
  const normalized = normalizeReticulumMessageHash(hash);
  return /^[0-9a-f]{8,128}$/.test(normalized);
}

export function reticulumMessageHashesEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizeReticulumMessageHash(a);
  const right = normalizeReticulumMessageHash(b);
  return left.length > 0 && left === right;
}
