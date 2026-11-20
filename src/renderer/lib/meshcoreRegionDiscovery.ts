/**
 * Aggregate MeshCore flood-scope region names via ANON_REQ subtype REGIONS (0x01).
 * Explicit, sequential, read-only — no automatic discovery; no admin password.
 */

import { sanitizeLogMessage } from '@/main/sanitize-log-message';
import { hexToBytesExact } from '@/shared/hexBytes';

import {
  deserializeMeshcoreUserMessage,
  isDiagnosticTextI18n,
  MESHCORE_ERR_NOT_CONNECTED,
} from './meshcore/meshcoreMessageI18n';
import type { MeshcoreRepeaterRegions } from './meshcoreRepeaterRegions';
import { MESHCORE_FLOOD_SCOPE_HASHTAG_MAX_LEN } from './meshcoreUtils';
import type { MeshNode } from './types';

export const MESHCORE_REGION_DISCOVERY_MAX_REPEATERS = 24;

export interface MeshcoreRegionDiscoveryCandidate {
  nodeId: number;
  name: string;
  /** 32-byte contact/advert public key used for CMD_SEND_ANON_REQ. */
  publicKey: Uint8Array;
  /** Advert/contact hop count when known; used only for ordering. */
  hopsAway?: number;
  lastHeard?: number;
}

export type MeshcoreRegionDiscoverySkipReason = 'no-pubkey';

export type MeshcoreRegionDiscoveryFailureReason =
  | 'unsupported' // firmware does not implement anon regions
  | 'rejected' // firmware returned an explicit error
  | 'invalid-reply' // parser rejected the payload
  | 'timeout'
  | 'unreachable' // not connected / flood-sent / contact missing
  | 'unknown';

export interface MeshcoreRegionDiscoveryFailure {
  nodeId: number;
  reason: MeshcoreRegionDiscoveryFailureReason;
}

export interface DiscoveredMeshcoreRegion {
  /** Raw name as printed by firmware (hash stripped): `us-tn-tri`, `$private`, or `*`. */
  name: string;
  /** `#us-tn-tri` for public names; null for `*` and `$private`. */
  scopeHashtag: string | null;
  /** Minimum depth across reporting repeaters; display indentation only. */
  depth: number;
  /** At least one reporting repeater marks it `^`. */
  home: boolean;
  /** At least one reporting repeater marks it `F` (flood allowed). */
  floodAllowed: boolean;
  /** Repeater node ids that reported this name. */
  sources: readonly number[];
}

export interface MeshcoreRegionDiscoveryRun {
  entries: DiscoveredMeshcoreRegion[];
  readAt: number; // epoch ms
  truncatedSources: readonly number[];
  skipped: readonly { nodeId: number; reason: MeshcoreRegionDiscoverySkipReason }[];
  failed: readonly MeshcoreRegionDiscoveryFailure[];
  /** True when the caller's signal/current check stopped the run early. */
  cancelled: boolean;
}

export interface MeshcoreRegionDiscoveryProgress {
  done: number;
  total: number;
  nodeId: number;
  name: string;
}

export interface MeshcoreRegionTreeSource {
  nodeId: number;
  tree: MeshcoreRepeaterRegions;
}

/**
 * Firmware stores public regions with a leading '#', but anon CSV / CLI export may
 * print the bare name. The transport key hashes the name INCLUDING '#', so a
 * discovered `us-tn-tri` must become `#us-tn-tri`.
 *
 * Returns null for `*`, `$…` private names, invalid/oversized names.
 */
export function scopeHashtagForRegionName(name: string): string | null {
  if (!name || name === '*' || name.startsWith('$')) return null;
  if (/\p{Cc}/u.test(name)) return null;
  const tagged = name.startsWith('#') ? name : `#${name}`;
  if (tagged.length <= 1 || tagged.length > MESHCORE_FLOOD_SCOPE_HASHTAG_MAX_LEN) return null;
  return tagged;
}

function regionKindRank(name: string): number {
  if (name === '*') return 2;
  if (name.startsWith('$')) return 1;
  return 0;
}

function compareDiscoveredRegions(
  a: DiscoveredMeshcoreRegion,
  b: DiscoveredMeshcoreRegion,
): number {
  const kind = regionKindRank(a.name) - regionKindRank(b.name);
  if (kind !== 0) return kind;
  return a.name.localeCompare(b.name);
}

/** Normalize anon CSV tokens into a flat flood-allowed region tree (depth 0). */
export function meshcoreRegionTreeFromAnonNames(names: readonly string[]): MeshcoreRepeaterRegions {
  const entries: MeshcoreRepeaterRegions['entries'] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.startsWith('#') ? raw.slice(1) : raw;
    if (!name || name === '*' || seen.has(name)) continue;
    seen.add(name);
    entries.push({
      name,
      depth: 0,
      home: false,
      floodAllowed: true,
    });
  }
  return { entries, truncated: false };
}

export function mergeMeshcoreRegionTrees(sources: readonly MeshcoreRegionTreeSource[]): {
  entries: DiscoveredMeshcoreRegion[];
  truncatedSources: number[];
} {
  const byName = new Map<
    string,
    {
      name: string;
      depth: number;
      home: boolean;
      floodAllowed: boolean;
      sources: Set<number>;
    }
  >();
  const truncatedSources: number[] = [];

  for (const source of sources) {
    if (source.tree.truncated) truncatedSources.push(source.nodeId);
    for (const region of source.tree.entries) {
      const existing = byName.get(region.name);
      if (!existing) {
        byName.set(region.name, {
          name: region.name,
          depth: region.depth,
          home: region.home,
          floodAllowed: region.floodAllowed,
          sources: new Set([source.nodeId]),
        });
        continue;
      }
      existing.depth = Math.min(existing.depth, region.depth);
      existing.home = existing.home || region.home;
      existing.floodAllowed = existing.floodAllowed || region.floodAllowed;
      existing.sources.add(source.nodeId);
    }
  }

  const entries = [...byName.values()]
    .map((entry): DiscoveredMeshcoreRegion => ({
      name: entry.name,
      scopeHashtag: scopeHashtagForRegionName(entry.name),
      depth: entry.depth,
      home: entry.home,
      floodAllowed: entry.floodAllowed,
      sources: [...entry.sources].sort((a, b) => a - b),
    }))
    .sort(compareDiscoveredRegions);

  return {
    entries,
    truncatedSources: [...new Set(truncatedSources)].sort((a, b) => a - b),
  };
}

function resolveNodePublicKey(
  node: MeshNode,
  resolvePublicKey?: (nodeId: number) => Uint8Array | null | undefined,
): Uint8Array | null {
  const fromMap = resolvePublicKey?.(node.node_id);
  if (fromMap?.length === 32) return fromMap;
  const fromHex = hexToBytesExact(node.public_key_hex?.replace(/\s/g, '').toLowerCase(), 32);
  return fromHex ?? null;
}

export function selectMeshcoreRegionDiscoveryCandidates(
  nodes: Iterable<MeshNode>,
  opts: {
    selfNodeId?: number | null;
    /** Prefer live contact map; falls back to `node.public_key_hex`. */
    resolvePublicKey?: (nodeId: number) => Uint8Array | null | undefined;
  },
): {
  candidates: MeshcoreRegionDiscoveryCandidate[];
  skipped: { nodeId: number; reason: MeshcoreRegionDiscoverySkipReason }[];
} {
  const selfNodeId = opts.selfNodeId ?? null;
  const skipped: { nodeId: number; reason: MeshcoreRegionDiscoverySkipReason }[] = [];
  const eligible: MeshcoreRegionDiscoveryCandidate[] = [];

  for (const node of nodes) {
    if (node.hw_model !== 'Repeater' && node.hw_model !== 'Room') continue;
    if (selfNodeId != null && node.node_id === selfNodeId) continue;
    const publicKey = resolveNodePublicKey(node, opts.resolvePublicKey);
    if (!publicKey) {
      skipped.push({ nodeId: node.node_id, reason: 'no-pubkey' });
      continue;
    }
    eligible.push({
      nodeId: node.node_id,
      name: node.long_name || `Node-${node.node_id.toString(16).toUpperCase()}`,
      publicKey,
      hopsAway: node.hops_away ?? node.hops,
      lastHeard: node.last_heard,
    });
  }

  // Prefer zero-hop / direct, then recently heard, then name.
  eligible.sort((a, b) => {
    const hopsDiff =
      (a.hopsAway ?? Number.POSITIVE_INFINITY) - (b.hopsAway ?? Number.POSITIVE_INFINITY);
    if (hopsDiff !== 0) return hopsDiff;
    const heardDiff = (b.lastHeard ?? 0) - (a.lastHeard ?? 0);
    if (heardDiff !== 0) return heardDiff;
    return a.name.localeCompare(b.name);
  });

  return {
    candidates: eligible.slice(0, MESHCORE_REGION_DISCOVERY_MAX_REPEATERS),
    skipped,
  };
}

/** Operational MeshCore statuses that may keep an in-flight Discover run alive. */
export function isMeshcoreRegionDiscoveryStatusCurrent(status: string | null | undefined): boolean {
  return status === 'connected' || status === 'configured' || status === 'stale';
}

/** Persist Discover results only when the run finished with at least one region. */
export function shouldPersistDiscoveredMeshcoreRegions(run: {
  cancelled: boolean;
  entries: readonly unknown[];
}): boolean {
  return !run.cancelled && run.entries.length > 0;
}

export function classifyRegionDiscoveryError(error: unknown): MeshcoreRegionDiscoveryFailureReason {
  const message = error instanceof Error ? error.message : String(error);
  const ref = deserializeMeshcoreUserMessage(message);
  if (isDiagnosticTextI18n(ref)) {
    switch (ref.key) {
      case 'infraConfig.regionsUnavailable':
        return 'unsupported';
      case 'infraConfig.commandRejected':
        return 'rejected';
      case 'infraConfig.invalidReply':
        return 'invalid-reply';
      case 'infraConfig.sessionChanged':
        return 'unreachable';
      default:
        break;
    }
  }
  if (/invalid anon regions|invalid-reply/i.test(message)) return 'invalid-reply';
  if (/timed?\s*out|timeout/i.test(message)) return 'timeout';
  if (
    message.includes('Not connected') ||
    message.includes(MESHCORE_ERR_NOT_CONNECTED) ||
    message.includes('not found') ||
    /sent as flood/i.test(message)
  ) {
    return 'unreachable';
  }
  return 'unknown';
}

export interface DiscoverMeshcoreRegionsDeps {
  candidates: readonly MeshcoreRegionDiscoveryCandidate[];
  /** ANON regions query; returns flood-allowed names (may be empty). */
  query: (
    candidate: MeshcoreRegionDiscoveryCandidate,
    opts: { isCurrent?: () => boolean },
  ) => Promise<readonly string[]>;
  isCurrent: () => boolean;
  signal?: AbortSignal;
  onProgress?: (progress: MeshcoreRegionDiscoveryProgress) => void;
}

export async function discoverMeshcoreRegions(
  deps: DiscoverMeshcoreRegionsDeps,
): Promise<MeshcoreRegionDiscoveryRun> {
  const trees: MeshcoreRegionTreeSource[] = [];
  const failed: MeshcoreRegionDiscoveryFailure[] = [];
  let cancelled = false;
  const { candidates, query, isCurrent, signal, onProgress } = deps;

  for (let i = 0; i < candidates.length; i++) {
    if (signal?.aborted || !isCurrent()) {
      cancelled = true;
      break;
    }
    const candidate = candidates[i];
    onProgress?.({
      done: i,
      total: candidates.length,
      nodeId: candidate.nodeId,
      name: candidate.name,
    });
    try {
      const names = await query(candidate, { isCurrent });
      if (signal?.aborted || !isCurrent()) {
        cancelled = true;
        break;
      }
      trees.push({
        nodeId: candidate.nodeId,
        tree: meshcoreRegionTreeFromAnonNames(names),
      });
    } catch (error) {
      const reason = classifyRegionDiscoveryError(error);
      failed.push({ nodeId: candidate.nodeId, reason });
      console.warn(
        `[meshcoreRegionDiscovery] node=${candidate.nodeId} reason=${reason}` +
          (candidate.name ? ` name=${sanitizeLogMessage(candidate.name)}` : ''),
      );
    }
  }

  if (!cancelled && candidates.length > 0) {
    const last = candidates[candidates.length - 1];
    onProgress?.({
      done: candidates.length,
      total: candidates.length,
      nodeId: last.nodeId,
      name: last.name,
    });
  }

  const merged = mergeMeshcoreRegionTrees(trees);
  return {
    entries: merged.entries,
    truncatedSources: merged.truncatedSources,
    failed,
    skipped: [],
    readAt: Date.now(),
    cancelled,
  };
}
