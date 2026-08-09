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

const EMPTY_AUTO_BLACKLIST: ReadonlySet<string> = new Set();

/** Lowercased destination-hash set for Auto ignore filtering. */
export function propagationAutoBlacklistSet(
  blacklist: readonly string[] | null | undefined,
): ReadonlySet<string> {
  if (blacklist == null || blacklist.length === 0) return EMPTY_AUTO_BLACKLIST;
  return new Set(blacklist.map((h) => h.toLowerCase()));
}

export function isPropagationHashAutoBlacklisted(
  hash: string | null | undefined,
  blacklist: ReadonlySet<string>,
): boolean {
  if (!hash) return false;
  return blacklist.has(hash.toLowerCase());
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

export interface DiscoveredPropagationTarget {
  destinationHash: string;
  hops: number;
}

/**
 * Path-table hop counts above this are treated as unusable for Auto ordering
 * (seen in the wild as 100+ hop ghosts that still advertise a low peering cost).
 * Matches the practical clamp used for Reticulum link initiator hops.
 */
export const MAX_PLAUSIBLE_PROPAGATION_HOPS = 32;

/** True when hops came from the path table (not “unknown” / Infinity). */
export function hasFinitePropagationHops(hops: number): boolean {
  return Number.isFinite(hops) && hops >= 0 && hops <= MAX_PLAUSIBLE_PROPAGATION_HOPS;
}

/** Active discovered remotes not already configured, best (lowest hops) first. */
export function listDiscoveredPropagationTargets(
  nodes: PropagationNodeRow[],
  discovered: readonly DiscoveredPropagationRow[],
  autoBlacklist: ReadonlySet<string> = EMPTY_AUTO_BLACKLIST,
): DiscoveredPropagationTarget[] {
  const configuredHashes = configuredPropagationDestinationHashes(nodes);
  const rows: { destinationHash: string; hops: number; sortKey: string }[] = [];
  for (const row of discovered) {
    if (!row.node_state) continue;
    const hash = row.destination_hash.toLowerCase();
    if (configuredHashes.has(hash)) continue;
    if (autoBlacklist.has(hash)) continue;
    rows.push({
      destinationHash: row.destination_hash,
      hops: row.hops ?? Number.POSITIVE_INFINITY,
      sortKey: row.display_name?.trim() || row.destination_hash,
    });
  }
  rows.sort(sortByHopsThenKey);
  return rows.map(({ destinationHash, hops }) => ({ destinationHash, hops }));
}

/** Discovered PNs with a known hop count (path table), best first. */
export function listFiniteHopDiscoveredPropagationTargets(
  nodes: PropagationNodeRow[],
  discovered: readonly DiscoveredPropagationRow[],
  autoBlacklist: ReadonlySet<string> = EMPTY_AUTO_BLACKLIST,
): DiscoveredPropagationTarget[] {
  return listDiscoveredPropagationTargets(nodes, discovered, autoBlacklist).filter((t) =>
    hasFinitePropagationHops(t.hops),
  );
}

/** Discovered PNs with unknown hops (announce heard, no path yet), name/hash sorted. */
export function listUnknownHopDiscoveredPropagationTargets(
  nodes: PropagationNodeRow[],
  discovered: readonly DiscoveredPropagationRow[],
  autoBlacklist: ReadonlySet<string> = EMPTY_AUTO_BLACKLIST,
): DiscoveredPropagationTarget[] {
  return listDiscoveredPropagationTargets(nodes, discovered, autoBlacklist).filter(
    (t) => !hasFinitePropagationHops(t.hops),
  );
}

/**
 * Enabled configured remotes (excludes local-prop), best (lowest hops) first.
 * Pass `autoBlacklist` when ranking for Auto so ignored hashes are omitted.
 */
export function listConfiguredRemotePropagationIds(
  nodes: PropagationNodeRow[],
  autoBlacklist: ReadonlySet<string> = EMPTY_AUTO_BLACKLIST,
): string[] {
  const rows: { id: string; hops: number; sortKey: string }[] = [];
  for (const node of nodes) {
    if (node.id === 'local-prop' || !node.enabled) continue;
    if (isPropagationHashAutoBlacklisted(node.destination_hash, autoBlacklist)) continue;
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

/** 32-hex LXMF destination hash (configured row id or bare Auto one-time target). */
export const RETICULUM_PROPAGATION_DESTINATION_HASH_RE = /^[0-9a-fA-F]{32}$/;

/** Find a configured row by id or destination hash (case-insensitive). */
export function findPropagationNodeByIdOrHash(
  nodes: PropagationNodeRow[],
  id: string,
): PropagationNodeRow | undefined {
  const key = id.toLowerCase();
  return nodes.find((n) => n.id === id || n.destination_hash?.toLowerCase() === key);
}

/**
 * Destination hash for a sync target id (or the id itself when it is already a hash);
 * empty string when the row has no known hash.
 */
export function propagationTargetDestinationHash(nodes: PropagationNodeRow[], id: string): string {
  if (RETICULUM_PROPAGATION_DESTINATION_HASH_RE.test(id)) return id.toLowerCase();
  return nodes.find((n) => n.id === id)?.destination_hash?.toLowerCase() ?? '';
}

/**
 * Manual cascade seed: explicit per-row target, else Preferred, else best configured remote.
 * Does not fall back to local-prop (callers settle local separately).
 */
export function resolveManualCascadeSeed(
  firstTargetId: string | null | undefined,
  preferredId: string | null,
  nodes: PropagationNodeRow[],
): string | null {
  if (firstTargetId != null && firstTargetId.length > 0) return firstTargetId;
  if (preferredId != null && preferredId.length > 0) return preferredId;
  return listConfiguredRemotePropagationIds(nodes).at(0) ?? null;
}

/**
 * True when the local inbox is enabled but the sidecar is still reading its messagestore
 * (`status: 'loading'`). Serving — and therefore sync — is deferred until that finishes.
 */
export function isLocalPropagationLoading(nodes: PropagationNodeRow[]): boolean {
  return nodes.some((n) => n.id === 'local-prop' && n.status === 'loading');
}

/** Enabled local inbox that is ready to sync (messagestore finished loading). */
function hasReadyEnabledLocalPropagationNode(nodes: PropagationNodeRow[]): boolean {
  return hasEnabledLocalPropagationNode(nodes) && !isLocalPropagationLoading(nodes);
}

/**
 * True when this mode has anything to sync with: Auto may use a discovered node, both
 * Auto and Manual may use an added remote or the ready local inbox. Off never syncs.
 * A loading local node alone is not a cascade candidate.
 */
export function hasPropagationCascadeCandidate(
  mode: ReticulumPropagationMode,
  nodes: PropagationNodeRow[],
  discovered: readonly DiscoveredPropagationRow[] = [],
  autoBlacklist: ReadonlySet<string> = EMPTY_AUTO_BLACKLIST,
): boolean {
  if (mode === 'off') return false;
  const autoOmit = mode === 'auto' ? autoBlacklist : EMPTY_AUTO_BLACKLIST;
  return (
    (mode === 'auto' && listDiscoveredPropagationTargets(nodes, discovered, autoOmit).length > 0) ||
    listConfiguredRemotePropagationIds(nodes, autoOmit).length > 0 ||
    hasReadyEnabledLocalPropagationNode(nodes)
  );
}

export function pickAutoPropagationTarget(
  nodes: PropagationNodeRow[],
  discovered: readonly DiscoveredPropagationRow[] = [],
  autoBlacklist: ReadonlySet<string> = EMPTY_AUTO_BLACKLIST,
): AutoPropagationTarget | null {
  // Finite-hop discovered → configured → unknown-hop discovered → local (matches cascade).
  const finiteBest = listFiniteHopDiscoveredPropagationTargets(nodes, discovered, autoBlacklist).at(
    0,
  );
  if (finiteBest != null) {
    return { kind: 'discovered', destinationHash: finiteBest.destinationHash };
  }

  const configuredBest = listConfiguredRemotePropagationIds(nodes, autoBlacklist).at(0);
  if (configuredBest != null) {
    return { kind: 'configured', id: configuredBest };
  }

  const unknownBest = listUnknownHopDiscoveredPropagationTargets(
    nodes,
    discovered,
    autoBlacklist,
  ).at(0);
  if (unknownBest != null) {
    return { kind: 'discovered', destinationHash: unknownBest.destinationHash };
  }

  if (hasReadyEnabledLocalPropagationNode(nodes)) {
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
 * Auto: finite-hop discovered → configured remote → unknown-hop discovered → local-prop.
 * Manual uses Preferred (including `local-prop`), else picks the best configured remote
 * for this sync only (no Preferred write), else local-prop. Off → null.
 */
export function resolvePropagationSyncTargetId(
  mode: ReticulumPropagationMode,
  nodes: PropagationNodeRow[],
  preferredId: string | null,
  discovered: readonly DiscoveredPropagationRow[] = [],
  autoBlacklist: ReadonlySet<string> = EMPTY_AUTO_BLACKLIST,
): string | null {
  if (mode === 'off') return null;
  if (mode === 'manual') {
    if (preferredId != null && preferredId.length > 0) return preferredId;
    const configuredBest = listConfiguredRemotePropagationIds(nodes).at(0);
    if (configuredBest != null) return configuredBest;
    return hasReadyEnabledLocalPropagationNode(nodes) ? 'local-prop' : null;
  }
  const target = pickAutoPropagationTarget(nodes, discovered, autoBlacklist);
  if (target?.kind === 'discovered') return target.destinationHash.toLowerCase();
  if (target?.kind === 'configured') return target.id;
  if (target?.kind === 'local') return 'local-prop';
  return null;
}

/** Hash prefix shown when a sync target has no name yet (matches the discovered list). */
const PROPAGATION_HASH_LABEL_CHARS = 12;

/**
 * Display name for a sync target id — a configured row id, `local-prop`, or the bare
 * destination hash Auto uses for a one-time discovered sync.
 *
 * Discovered nodes are never in `nodes`, so fall back to the announce name and finally a
 * hash prefix. `localLabel` is passed in so this stays pure (callers translate).
 */
export function resolveReticulumPropagationTargetLabel(
  nodes: PropagationNodeRow[],
  discovered: readonly DiscoveredPropagationRow[],
  id: string,
  localLabel: string,
): string {
  if (id === 'local-prop') return localLabel;
  const key = id.toLowerCase();
  const node = nodes.find((n) => n.id === id || n.destination_hash?.toLowerCase() === key);
  if (node) return node.id === 'local-prop' ? localLabel : node.name;
  const row = discovered.find((d) => d.destination_hash.toLowerCase() === key);
  const announced = row?.display_name?.trim();
  if (announced) return announced;
  return id.slice(0, PROPAGATION_HASH_LABEL_CHARS);
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
