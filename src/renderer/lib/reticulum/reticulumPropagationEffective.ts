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
 * Mode "Off" means no propagation support at all: a saved Preferred node stays on the
 * sidecar but is never used, so there is no effective target.
 * Auto without Preferred also counts **discovered** nodes, because the sidecar cascades
 * onto the best heard PN without adding it (`auto_discovered_candidates` in `pn_cascade.rs`).
 * Manual only counts nodes the user added.
 */
export function hasEffectiveReticulumPropagationTarget(
  nodes: PropagationNodeRow[],
  preferredId: string | null,
  mode: ReticulumPropagationMode = readReticulumPropagationMode(),
  discovered: readonly DiscoveredPropagationRow[] = [],
): boolean {
  if (mode === 'off') return false;

  if (isRemotePropagationId(preferredId)) {
    const preferred = findPropagationNode(nodes, preferredId);
    // Prefer sidecar preferred_id even while the node list is still loading.
    if (!preferred) return true;
    return preferred.enabled;
  }

  if (nodes.some((n) => n.preferred === true && isRemotePropagationId(n.id) && n.enabled)) {
    return true;
  }

  // Manual without Preferred picks a configured remote for the send/sync it needs.
  if (mode === 'manual') {
    return pickAutoPropagationTarget(nodes, [])?.kind === 'configured';
  }

  const target = pickAutoPropagationTarget(nodes, discovered);
  return target?.kind === 'configured' || target?.kind === 'discovered';
}

/** True when local-prop is enabled (cascade last resort / offline inbox). */
export function hasEnabledLocalPropagation(nodes: PropagationNodeRow[]): boolean {
  return nodes.some((n) => n.id === 'local-prop' && n.enabled);
}

/**
 * True when Direct→PN cascade can still run (remote preferred/auto OR local-prop).
 * Link-timeout failure bridge must skip while this is true. Mode "Off" has no cascade,
 * so a Direct timeout is terminal.
 */
export function hasReticulumPnCascadeCapacity(
  nodes: PropagationNodeRow[],
  preferredId: string | null,
  mode: ReticulumPropagationMode = readReticulumPropagationMode(),
  discovered: readonly DiscoveredPropagationRow[] = [],
): boolean {
  if (mode === 'off') return false;
  if (hasEffectiveReticulumPropagationTarget(nodes, preferredId, mode, discovered)) return true;
  return hasEnabledLocalPropagation(nodes);
}
