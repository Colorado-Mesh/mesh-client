import { persistReticulumOutboundMessageStatus } from '@/renderer/lib/reticulum/applyReticulumOutboundDeliveryStatus';
import { resolveReticulumDestinationHash } from '@/renderer/lib/reticulum/destHash';
import type { IdentityId } from '@/renderer/lib/types';
import { useMessageStore } from '@/renderer/stores/messageStore';
import { reticulumHashForNodeId } from '@/renderer/stores/reticulumPeerStore';

function normalizeDestHash(hash: string): string {
  return hash.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

function destHashMatchesPeer(storedHash: string, targetNorm: string): boolean {
  const storedNorm = normalizeDestHash(storedHash);
  if (!storedNorm || !targetNorm) return false;
  if (storedNorm === targetNorm) return true;
  if (storedNorm.length >= 32 && targetNorm.length >= 16) {
    return storedNorm.startsWith(targetNorm) || targetNorm.startsWith(storedNorm);
  }
  return false;
}

function resolveOutboundDestHash(toNodeId: number | undefined): string | null {
  if (toNodeId == null) return null;
  return reticulumHashForNodeId(toNodeId) ?? resolveReticulumDestinationHash(toNodeId);
}

/** Mark outbound LXMF rows failed (store + SQLite) when direct link delivery times out. */
export function failReticulumSendingOutboundToDestHash(
  identityId: IdentityId,
  destinationHash: string,
  errorMessage: string,
): number {
  const targetNorm = normalizeDestHash(destinationHash);
  if (!targetNorm) return 0;
  const bucket = useMessageStore.getState().messages[identityId] ?? {};
  let count = 0;
  for (const msg of Object.values(bucket)) {
    if (msg.status !== 'sending' || msg.to == null) continue;
    const destHash = resolveOutboundDestHash(msg.to);
    if (!destHash || !destHashMatchesPeer(destHash, targetNorm)) continue;
    if (persistReticulumOutboundMessageStatus(identityId, msg.id, 'failed', errorMessage)) {
      count += 1;
    }
  }
  return count;
}
