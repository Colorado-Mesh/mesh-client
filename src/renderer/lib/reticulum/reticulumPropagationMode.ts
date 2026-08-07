import type {
  DiscoveredPropagationRow,
  PropagationNodeRow,
} from '@/renderer/stores/reticulumPropagationStore';

export const RETICULUM_PROPAGATION_MODE_KEY = 'mesh-client:reticulumPropagationMode';

export type ReticulumPropagationMode = 'auto' | 'manual' | 'off';

/**
 * Default mode is **off** (MeshChatX parity): no automatic Preferred changes and no
 * periodic sync until the user opts into Auto/Manual. Persisted values are honored.
 */
export function readReticulumPropagationMode(): ReticulumPropagationMode {
  try {
    const raw = localStorage.getItem(RETICULUM_PROPAGATION_MODE_KEY);
    if (raw === 'auto' || raw === 'manual' || raw === 'off') return raw;
  } catch {
    // catch-no-log-ok localStorage unavailable in private mode
  }
  return 'off';
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

/**
 * What Auto should apply as the Preferred propagation node at this moment, considering
 * both configured nodes and live discovered announces (no manual Add required).
 *
 * Ordering: lowest-hop remote among enabled configured remotes ∪ active discovered
 * (configured wins ties, then name/hash); else enabled `local-prop`; else `null`.
 *
 * A `discovered` result must be soft-upserted (added + preferred) so the sidecar
 * Preferred/sync/cascade APIs, which require a configured row, keep working.
 */
export type AutoPropagationTarget =
  | { kind: 'configured'; id: string }
  | { kind: 'discovered'; destinationHash: string }
  | { kind: 'local' };

interface AutoCandidate {
  hops: number;
  configured: boolean;
  sortKey: string;
  target: AutoPropagationTarget;
}

export function pickAutoPropagationTarget(
  nodes: PropagationNodeRow[],
  discovered: readonly DiscoveredPropagationRow[] = [],
): AutoPropagationTarget | null {
  const configuredHashes = new Set(
    nodes
      .map((n) => n.destination_hash?.toLowerCase())
      .filter((h): h is string => typeof h === 'string' && h.length > 0),
  );

  const candidates: AutoCandidate[] = [];

  for (const node of nodes) {
    if (node.id === 'local-prop' || !node.enabled) continue;
    candidates.push({
      hops: node.hops ?? Number.POSITIVE_INFINITY,
      configured: true,
      sortKey: node.name,
      target: { kind: 'configured', id: node.id },
    });
  }

  for (const row of discovered) {
    if (!row.node_state) continue;
    if (configuredHashes.has(row.destination_hash.toLowerCase())) continue;
    candidates.push({
      hops: row.hops ?? Number.POSITIVE_INFINITY,
      configured: false,
      sortKey: row.display_name?.trim() || row.destination_hash,
      target: { kind: 'discovered', destinationHash: row.destination_hash },
    });
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      if (a.hops !== b.hops) return a.hops - b.hops;
      if (a.configured !== b.configured) return a.configured ? -1 : 1;
      return a.sortKey.localeCompare(b.sortKey);
    });
    return candidates[0].target;
  }

  if (nodes.some((n) => n.id === 'local-prop' && n.enabled)) {
    return { kind: 'local' };
  }
  return null;
}
