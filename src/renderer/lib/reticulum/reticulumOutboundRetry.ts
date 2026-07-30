/**
 * After a manual LXMF resend succeeds, the store rekeys `pendingId` → `newHash`.
 * Delete the prior SQLite row when `pendingId` was a real LXMF hash (not an optimistic
 * `reticulum-pending-*` id), so failed+retried messages do not leave duplicate DB rows.
 */
export function shouldDeletePriorReticulumOutboundHash(
  pendingId: string,
  newHash: string,
): boolean {
  return pendingId !== newHash && !pendingId.startsWith('reticulum-pending-');
}
