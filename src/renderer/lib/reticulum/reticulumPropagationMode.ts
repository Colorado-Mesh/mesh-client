import type {
  DiscoveredPropagationRow,
  PropagationNodeRow,
} from '@/renderer/stores/reticulumPropagationStore';

export const RETICULUM_PROPAGATION_MODE_KEY = 'mesh-client:reticulumPropagationMode';

export type ReticulumPropagationMode = 'auto' | 'manual' | 'off';

const PROPAGATION_MODES = new Set<ReticulumPropagationMode>(['auto', 'manual', 'off']);

export function isReticulumPropagationMode(value: unknown): value is ReticulumPropagationMode {
  return typeof value === 'string' && PROPAGATION_MODES.has(value as ReticulumPropagationMode);
}

/**
 * Default mode is **off** (MeshChatX parity): no automatic Preferred changes and no
 * periodic sync until the user opts into Auto/Manual. Persisted values are honored
 * (including legacy `auto` saved when App-panel default was Auto).
 */
export function readReticulumPropagationMode(): ReticulumPropagationMode {
  try {
    const raw = localStorage.getItem(RETICULUM_PROPAGATION_MODE_KEY);
    if (isReticulumPropagationMode(raw)) return raw;
  } catch {
    // catch-no-log-ok localStorage unavailable in private mode
  }
  return 'off';
}

export function writeReticulumPropagationMode(mode: ReticulumPropagationMode): void {
  if (!isReticulumPropagationMode(mode)) return;
  try {
    localStorage.setItem(RETICULUM_PROPAGATION_MODE_KEY, mode);
  } catch {
    // catch-no-log-ok localStorage quota or private mode
  }
}

/** Destination hashes already present as configured propagation rows. */
export function configuredPropagationDestinationHashes(
  nodes: PropagationNodeRow[],
): ReadonlySet<string> {
  return new Set(
    nodes
      .map((n) => n.destination_hash?.toLowerCase())
      .filter((h): h is string => typeof h === 'string' && h.length > 0),
  );
}

/**
 * Ranking helper for UI (e.g. “Add closest”), diagnostics, and Auto sync order.
 *
 * Ordering: **best active discovered** (lowest hops) → else **best enabled configured
 * remote** → else enabled `local-prop` → else `null`.
 *
 * Auto one-time-syncs a discovered hash without adding it or writing Preferred.
 */
export type AutoPropagationTarget =
  | { kind: 'configured'; id: string }
  | { kind: 'discovered'; destinationHash: string }
  | { kind: 'local' };

interface RankedRemote {
  hops: number;
  sortKey: string;
}

function sortByHopsThenKey<T extends RankedRemote>(a: T, b: T): number {
  if (a.hops !== b.hops) return a.hops - b.hops;
  return a.sortKey.localeCompare(b.sortKey);
}

/** Active discovered remotes not already configured, best (lowest hops) first. */
export function listDiscoveredPropagationTargets(
  nodes: PropagationNodeRow[],
  discovered: readonly DiscoveredPropagationRow[],
): { destinationHash: string; hops: number }[] {
  const configuredHashes = configuredPropagationDestinationHashes(nodes);
  const rows: { destinationHash: string; hops: number; sortKey: string }[] = [];
  for (const row of discovered) {
    if (!row.node_state) continue;
    const hash = row.destination_hash.toLowerCase();
    if (configuredHashes.has(hash)) continue;
    rows.push({
      destinationHash: row.destination_hash,
      hops: row.hops ?? Number.POSITIVE_INFINITY,
      sortKey: row.display_name?.trim() || row.destination_hash,
    });
  }
  rows.sort(sortByHopsThenKey);
  return rows.map(({ destinationHash, hops }) => ({ destinationHash, hops }));
}

/** Enabled configured remotes (excludes local-prop), best (lowest hops) first. */
export function listConfiguredRemotePropagationIds(nodes: PropagationNodeRow[]): string[] {
  const rows: { id: string; hops: number; sortKey: string }[] = [];
  for (const node of nodes) {
    if (node.id === 'local-prop' || !node.enabled) continue;
    rows.push({
      id: node.id,
      hops: node.hops ?? Number.POSITIVE_INFINITY,
      sortKey: node.name,
    });
  }
  rows.sort(sortByHopsThenKey);
  return rows.map((r) => r.id);
}

export function hasEnabledLocalPropagationNode(nodes: PropagationNodeRow[]): boolean {
  return nodes.some((n) => n.id === 'local-prop' && n.enabled);
}

export function pickAutoPropagationTarget(
  nodes: PropagationNodeRow[],
  discovered: readonly DiscoveredPropagationRow[] = [],
): AutoPropagationTarget | null {
  const discoveredBest = listDiscoveredPropagationTargets(nodes, discovered).at(0);
  if (discoveredBest != null) {
    return { kind: 'discovered', destinationHash: discoveredBest.destinationHash };
  }

  const configuredBest = listConfiguredRemotePropagationIds(nodes).at(0);
  if (configuredBest != null) {
    return { kind: 'configured', id: configuredBest };
  }

  if (hasEnabledLocalPropagationNode(nodes)) {
    return { kind: 'local' };
  }
  return null;
}

/**
 * Lowest-hop enabled configured remote (excludes local-prop and discovered).
 * Thin wrapper over {@link pickAutoPropagationTarget} with an empty discovery list.
 */
export function pickAutoPropagationNodeId(nodes: PropagationNodeRow[]): string | null {
  const target = pickAutoPropagationTarget(nodes, []);
  return target?.kind === 'configured' ? target.id : null;
}

/**
 * Sync target hint for UI enablement.
 *
 * Auto: best discovered destination hash (one-time sync), else best configured remote,
 * else local-prop. Manual uses Preferred (including `local-prop`). Off → null.
 */
export function resolvePropagationSyncTargetId(
  mode: ReticulumPropagationMode,
  nodes: PropagationNodeRow[],
  preferredId: string | null,
  discovered: readonly DiscoveredPropagationRow[] = [],
): string | null {
  if (mode === 'off') return null;
  if (mode === 'manual') return preferredId;
  const discoveredBest = listDiscoveredPropagationTargets(nodes, discovered).at(0);
  if (discoveredBest != null) {
    return discoveredBest.destinationHash.toLowerCase();
  }
  const configured = listConfiguredRemotePropagationIds(nodes).at(0);
  if (configured != null) return configured;
  if (hasEnabledLocalPropagationNode(nodes)) return 'local-prop';
  return null;
}

/** Compact diagnostic label for an Auto target (kind:id). */
export function formatAutoPropagationTargetLabel(
  target: AutoPropagationTarget | null,
): string | null {
  if (target == null) return null;
  if (target.kind === 'configured') return `configured:${target.id}`;
  if (target.kind === 'discovered') {
    return `discovered:${target.destinationHash.slice(0, 12)}`;
  }
  return 'local';
}
