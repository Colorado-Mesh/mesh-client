/**
 * After LXMF send (or resend) rekeys `pendingId` → `newHash`, delete the prior SQLite row.
 * Covers:
 * - optimistic `reticulum-pending-*` rows (otherwise orphan while still `sending`)
 * - prior real LXMF hashes after a successful retry
 */
export function shouldDeletePriorReticulumOutboundHash(
  pendingId: string,
  newHash: string,
): boolean {
  return pendingId !== newHash && pendingId.length > 0 && newHash.length > 0;
}
