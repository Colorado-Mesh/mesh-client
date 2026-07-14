/** Canonical Reticulum destination hash: exactly 32 lowercase ASCII hex digits. */
const RETICULUM_DESTINATION_HASH_RE = /^[0-9a-f]{32}$/;
const RETICULUM_DESTINATION_HASH_LOOSE_RE = /^[0-9a-fA-F]{32}$/;

/**
 * Canonicalize a destination hash to 32 lowercase hex chars.
 * Rejects stripping / separator removal — input must already be exactly 32 hex digits
 * (case-insensitive). Matches sidecar `parse_hash16()`.
 */
export function canonicalizeReticulumDestinationHash(raw: string): string | null {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!RETICULUM_DESTINATION_HASH_LOOSE_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/** True when `value` is already a canonical 32-char lowercase hex hash. */
export function isCanonicalReticulumDestinationHash(value: string): boolean {
  return RETICULUM_DESTINATION_HASH_RE.test(value);
}
