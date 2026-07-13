import {
  pickAutoPropagationNodeId,
  readReticulumPropagationMode,
  type ReticulumPropagationMode,
} from '@/renderer/lib/reticulum/reticulumPropagationMode';
import type { PropagationNodeRow } from '@/renderer/stores/reticulumPropagationStore';

function isRemotePropagationId(id: string | null | undefined): id is string {
  return Boolean(id && id !== 'local-prop');
}

function findPropagationNode(
  nodes: PropagationNodeRow[],
  id: string,
): PropagationNodeRow | undefined {
  return nodes.find((n) => n.id === id || n.destination_hash === id);
}

/**
 * True when a remote (non-local-prop) propagation node can carry offline LXMF.
 *
 * Preferred sidecar outbound node wins over App sync mode — Mode "Off" only
 * disables periodic sync, not the presence of an outbound propagation target.
 */
export function hasEffectiveReticulumPropagationTarget(
  nodes: PropagationNodeRow[],
  preferredId: string | null,
  mode: ReticulumPropagationMode = readReticulumPropagationMode(),
): boolean {
  if (isRemotePropagationId(preferredId)) {
    const preferred = findPropagationNode(nodes, preferredId);
    // Prefer sidecar preferred_id even while the node list is still loading.
    if (!preferred) return true;
    return preferred.enabled;
  }

  if (nodes.some((n) => n.preferred === true && isRemotePropagationId(n.id) && n.enabled)) {
    return true;
  }

  // Auto / manual without preferred: any enabled remote counts for offline fallback
  // capacity. Mode "off" skips inventing a target when none is preferred.
  if (mode === 'off') return false;
  if (mode === 'manual') return false;

  return pickAutoPropagationNodeId(nodes) != null;
}
