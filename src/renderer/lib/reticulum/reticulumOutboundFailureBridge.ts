import {
  persistReticulumOutboundMessageStatus,
  resolveReticulumOutboundDestHash,
} from '@/renderer/lib/reticulum/applyReticulumOutboundDeliveryStatus';
import { hasReticulumPnCascadeCapacity } from '@/renderer/lib/reticulum/reticulumPropagationEffective';
import {
  readReticulumPropagationMode,
  type ReticulumPropagationMode,
} from '@/renderer/lib/reticulum/reticulumPropagationMode';
import type { IdentityId } from '@/renderer/lib/types';
import { useMessageStore } from '@/renderer/stores/messageStore';
import type {
  DiscoveredPropagationRow,
  PropagationNodeRow,
} from '@/renderer/stores/reticulumPropagationStore';
import { isPnCascadeDeliveryMethod } from '@/shared/reticulumDeliveryMethod';

function normalizeDestHash(hash: string): string {
  return hash.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

/**
 * When PN cascade can still run (remote preferred/auto or enabled local-prop),
 * sidecar owns Direct timeout via multi-PN fallback + `lxmf_outbound_status`.
 * Skip the premature Failed bridge.
 */
export function shouldApplyLinkDeliveryTimeoutFailureBridge(
  nodes: PropagationNodeRow[],
  preferredId: string | null,
  mode: ReticulumPropagationMode = readReticulumPropagationMode(),
  discovered: readonly DiscoveredPropagationRow[] = [],
  autoBlacklist: readonly string[] = [],
): boolean {
  return !hasReticulumPnCascadeCapacity(nodes, preferredId, mode, discovered, autoBlacklist);
}

function destHashMatchesPeer(storedHash: string, targetNorm: string): boolean {
  const storedNorm = normalizeDestHash(storedHash);
  if (!storedNorm || !targetNorm) return false;
  // Require full 32-hex equality to avoid theoretical wrong-peer matches.
  return storedNorm.length === 32 && targetNorm.length === 32 && storedNorm === targetNorm;
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
    if (msg.status !== 'sending' || msg.to == null) continue;
    // Cascade re-queues as Propagated / stored_locally and emits sending — do not fail those.
    if (isPnCascadeDeliveryMethod(msg.reticulumDeliveryMethod)) {
      continue;
    }
    const destHash = resolveReticulumOutboundDestHash(msg.to);
    if (!destHash || !destHashMatchesPeer(destHash, targetNorm)) continue;
    if (persistReticulumOutboundMessageStatus(identityId, msg.id, 'failed', errorMessage)) {
      count += 1;
    }
  }
  return count;
}
