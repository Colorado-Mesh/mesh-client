/**
 * Human-verifiable fingerprint formatting for Reticulum identity hashes (TOFU pin).
 */

/** Group hex into 4-char blocks for out-of-band comparison. */
export function formatReticulumIdentityFingerprint(identityHash: string): string {
  const hex = identityHash
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
  if (!hex) return '';
  const parts: string[] = [];
  for (let i = 0; i < hex.length; i += 4) {
    parts.push(hex.slice(i, i + 4));
  }
  return parts.join(' ').toUpperCase();
}
