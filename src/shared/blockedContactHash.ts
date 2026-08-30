/**
 * Canonical blocked-contact hash handling, shared by the renderer block store and the
 * main-process DB / import handlers. Do not fork the regex — inbound LXMF filtering
 * compares against these normalized values.
 */

/** LXMF destination hashes are 16 bytes / 32 hex chars. */
export const BLOCKED_CONTACT_HASH_HEX_LENGTH = 32;

/**
 * Lenient normalizer used by existing block/unblock call sites: strips separators and
 * lowercases. Falls back to the trimmed input when hex-stripping empties the string, so
 * a caller-supplied non-hex id still round-trips rather than collapsing to `''`.
 *
 * Bulk import must additionally gate on {@link isValidBlockedContactHash} — the fallback
 * would otherwise persist arbitrary junk as a "blocked hash".
 */
export function normalizeBlockedHash(hash: string): string {
  return hash.replace(/[^0-9a-f]/gi, '').toLowerCase() || hash.trim().toLowerCase();
}

/** Strict check for bulk import: exactly 32 hex characters after normalization. */
export function isValidBlockedContactHash(hash: unknown): boolean {
  if (typeof hash !== 'string') return false;
  const normalized = hash.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return normalized.length === BLOCKED_CONTACT_HASH_HEX_LENGTH;
}
