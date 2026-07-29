import { persistReticulumOutboundMessageStatus } from '@/renderer/lib/reticulum/applyReticulumOutboundDeliveryStatus';
import { resolveReticulumDestinationHash } from '@/renderer/lib/reticulum/destHash';
import { hasEffectiveReticulumPropagationTarget } from '@/renderer/lib/reticulum/reticulumPropagationEffective';
import {
  readReticulumPropagationMode,
  type ReticulumPropagationMode,
} from '@/renderer/lib/reticulum/reticulumPropagationMode';
import type { IdentityId } from '@/renderer/lib/types';
import { useMessageStore } from '@/renderer/stores/messageStore';
import { reticulumHashForNodeId } from '@/renderer/stores/reticulumPeerStore';
import type { PropagationNodeRow } from '@/renderer/stores/reticulumPropagationStore';

function normalizeDestHash(hash: string): string {
  return hash.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

/**
 * When a remote preferred PN is available, sidecar owns Direct timeout via
 * one-shot PN fallback + `lxmf_outbound_status`. Skip the premature Failed bridge.
 */
export function shouldApplyLinkDeliveryTimeoutFailureBridge(
  nodes: PropagationNodeRow[],
  preferredId: string | null,
  mode: ReticulumPropagationMode = readReticulumPropagationMode(),
): boolean {
  return !hasEffectiveReticulumPropagationTarget(nodes, preferredId, mode);
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
    // Direct→PN fallback re-queues as Propagated and emits sending — do not fail those rows.
    if (msg.reticulumDeliveryMethod === 'propagated') continue;
    const destHash = resolveOutboundDestHash(msg.to);
    if (!destHash || !destHashMatchesPeer(destHash, targetNorm)) continue;
    if (persistReticulumOutboundMessageStatus(identityId, msg.id, 'failed', errorMessage)) {
      count += 1;
    }
  }
  return count;
}
