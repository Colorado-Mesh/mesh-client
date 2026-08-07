import {
  pickAutoPropagationTarget,
  readReticulumPropagationMode,
  type ReticulumPropagationMode,
} from '@/renderer/lib/reticulum/reticulumPropagationMode';
import type {
  DiscoveredPropagationRow,
  PropagationNodeRow,
} from '@/renderer/stores/reticulumPropagationStore';

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
 * Preferred sidecar outbound node wins over sync mode — Mode "Off" only
 * disables periodic sync, not the presence of an outbound propagation target.
 * Auto mode also counts an active discovered remote (soft-upsert pending).
 */
export function hasEffectiveReticulumPropagationTarget(
  nodes: PropagationNodeRow[],
  preferredId: string | null,
  mode: ReticulumPropagationMode = readReticulumPropagationMode(),
  discovered: readonly DiscoveredPropagationRow[] = [],
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

  // Auto / manual without preferred: Mode "off"/"manual" skip inventing a target.
  if (mode === 'off') return false;
  if (mode === 'manual') return false;

  const target = pickAutoPropagationTarget(nodes, discovered);
  return target?.kind === 'configured' || target?.kind === 'discovered';
}

/** True when local-prop is enabled (cascade last resort / offline inbox). */
export function hasEnabledLocalPropagation(nodes: PropagationNodeRow[]): boolean {
  return nodes.some((n) => n.id === 'local-prop' && n.enabled);
}

/**
 * True when Direct→PN cascade can still run (remote preferred/auto OR local-prop).
 * Link-timeout failure bridge must skip while this is true.
 */
export function hasReticulumPnCascadeCapacity(
  nodes: PropagationNodeRow[],
  preferredId: string | null,
  mode: ReticulumPropagationMode = readReticulumPropagationMode(),
  discovered: readonly DiscoveredPropagationRow[] = [],
): boolean {
  if (hasEffectiveReticulumPropagationTarget(nodes, preferredId, mode, discovered)) return true;
  return hasEnabledLocalPropagation(nodes);
}
