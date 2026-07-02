import type { PropagationNodeRow } from '@/renderer/stores/reticulumPropagationStore';

export const RETICULUM_PROPAGATION_MODE_KEY = 'mesh-client:reticulumPropagationMode';

export type ReticulumPropagationMode = 'auto' | 'manual' | 'off';

export function readReticulumPropagationMode(): ReticulumPropagationMode {
  try {
    const raw = localStorage.getItem(RETICULUM_PROPAGATION_MODE_KEY);
    if (raw === 'auto' || raw === 'manual' || raw === 'off') return raw;
  } catch {
    // catch-no-log-ok localStorage unavailable in private mode
  }
  return 'auto';
}

export function writeReticulumPropagationMode(mode: ReticulumPropagationMode): void {
  try {
    localStorage.setItem(RETICULUM_PROPAGATION_MODE_KEY, mode);
  } catch {
    // catch-no-log-ok localStorage quota or private mode
  }
}

/** Pick the enabled remote propagation node with the lowest hop count (excludes local-prop). */
export function pickAutoPropagationNodeId(nodes: PropagationNodeRow[]): string | null {
  const candidates = nodes.filter((n) => n.id !== 'local-prop' && n.enabled);
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const ha = a.hops ?? Number.POSITIVE_INFINITY;
    const hb = b.hops ?? Number.POSITIVE_INFINITY;
    if (ha !== hb) return ha - hb;
    return a.name.localeCompare(b.name);
  });
  return sorted[0]?.id ?? null;
}

export function resolvePropagationSyncTargetId(
  mode: ReticulumPropagationMode,
  nodes: PropagationNodeRow[],
  preferredId: string | null,
): string | null {
  if (mode === 'off') return null;
  if (mode === 'auto') return pickAutoPropagationNodeId(nodes);
  return preferredId;
}
