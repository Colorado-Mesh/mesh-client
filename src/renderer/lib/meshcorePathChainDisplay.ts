import type { NodeHashCandidate } from '../../shared/meshcoreNodeHash';
import {
  meshcoreResolveNodeFromPathPrefix,
  meshcoreSplitPathHashSegments,
} from '../../shared/meshcorePathHash';

export interface MeshcorePathChainSegment {
  hex: string;
  resolvedNodeId: number | null;
  resolvedLabel: string | null;
}

/** On-air path hash segment width in bytes. */
export type MeshcoreHashSizeBytes = 1 | 2 | 3;

/** Uppercase hex for one on-air path hash segment (1–3 bytes). */
export function formatMeshcorePathSegmentHex(segment: Uint8Array): string {
  return Array.from(segment, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

export interface BuildMeshcorePathChainOpts {
  pathBytes: readonly number[];
  hashSizeBytes: MeshcoreHashSizeBytes;
  getNodeLabel: (nodeId: number) => string;
  pubKeyByNodeId?: ReadonlyMap<number, Uint8Array>;
  candidates?: readonly NodeHashCandidate[];
}

/**
 * Split path hash bytes into display segments with optional contact name resolution.
 */
export function buildMeshcorePathChainSegments(
  opts: BuildMeshcorePathChainOpts,
): MeshcorePathChainSegment[] {
  const { pathBytes, hashSizeBytes, getNodeLabel, pubKeyByNodeId, candidates = [] } = opts;
  if (pathBytes.length === 0) return [];

  const segments = meshcoreSplitPathHashSegments(pathBytes, hashSizeBytes);
  return segments.map((seg) => {
    const hex = formatMeshcorePathSegmentHex(seg);
    const resolvedNodeId = meshcoreResolveNodeFromPathPrefix(seg, [...candidates], pubKeyByNodeId);
    return {
      hex,
      resolvedNodeId,
      resolvedLabel: resolvedNodeId != null ? getNodeLabel(resolvedNodeId) : null,
    };
  });
}

/** Minimal node fields needed to resolve path hash prefixes to labels. */
export interface MeshcorePathResolutionNode {
  node_id: number;
  last_heard?: number | null;
  long_name?: string | null;
  public_key_hex?: string | null;
}

export interface MeshcorePathResolutionInputs {
  candidates: NodeHashCandidate[];
  pubKeyByNodeId: Map<number, Uint8Array>;
  getNodeLabel: (nodeId: number) => string;
}

function parsePublicKeyHex(hex: string | null | undefined): Uint8Array | null {
  if (hex?.length !== 64) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const b = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(b)) return null;
    bytes[i] = b;
  }
  return bytes;
}

/**
 * Build path-hash resolution inputs from a MeshCore nodes map (same shape as Raw Packet Log).
 */
export function buildMeshcorePathResolutionFromNodes(
  nodes: ReadonlyMap<number, MeshcorePathResolutionNode>,
): MeshcorePathResolutionInputs {
  const pubKeyByNodeId = new Map<number, Uint8Array>();
  const candidates: NodeHashCandidate[] = [];
  for (const [nodeId, node] of nodes) {
    candidates.push({ node_id: nodeId, last_heard: node.last_heard ?? 0 });
    const key = parsePublicKeyHex(node.public_key_hex);
    if (key) pubKeyByNodeId.set(nodeId, key);
  }
  return {
    candidates,
    pubKeyByNodeId,
    getNodeLabel: (id) => {
      const n = nodes.get(id);
      const name = n?.long_name?.trim();
      return name && name.length > 0 ? name : `0x${id.toString(16)}`;
    },
  };
}

/**
 * Derive hash size for companion outPath bytes (no TraceData flags).
 * Prefers segment count = hopCount + 1 (UI hops exclude destination) when that divides evenly.
 */
export function meshcoreOutPathHashSizeBytes(
  pathBytes: readonly number[],
  hopCount: number,
): MeshcoreHashSizeBytes {
  const len = pathBytes.length;
  if (len <= 0) return 1;

  const hops = Number.isFinite(hopCount) ? Math.max(0, Math.trunc(hopCount)) : 0;
  const segmentCounts = [hops + 1, hops].filter((s) => s > 0);
  for (const segs of segmentCounts) {
    if (len % segs === 0) {
      const size = len / segs;
      if (size === 1 || size === 2 || size === 3) return size;
    }
  }
  for (const size of [1, 2, 3] as const) {
    if (len % size === 0) return size;
  }
  return 1;
}

export interface MeshcoreDisplayRoute {
  pathBytes: number[];
  hopCount: number;
  hashSizeBytes: MeshcoreHashSizeBytes;
}

/**
 * Current outbound route for display from path-history selection (or null if none / empty).
 */
export function meshcoreDisplayRouteFromPathSelection(
  selection: { pathBytes: number[]; hopCount: number } | null | undefined,
): MeshcoreDisplayRoute | null {
  if (!selection || !Array.isArray(selection.pathBytes) || selection.pathBytes.length === 0) {
    return null;
  }
  const pathBytes = selection.pathBytes.map((b) => b & 0xff);
  const hopCount = Number.isFinite(selection.hopCount)
    ? Math.max(0, Math.trunc(selection.hopCount))
    : Math.max(0, pathBytes.length - 1);
  return {
    pathBytes,
    hopCount,
    hashSizeBytes: meshcoreOutPathHashSizeBytes(pathBytes, hopCount),
  };
}

/** True when two byte arrays match (same route). */
export function meshcorePathBytesEqual(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
): boolean {
  if (a?.length !== b?.length) return false;
  if (a == null || b == null) return false;
  for (let i = 0; i < a.length; i++) {
    if ((a[i] & 0xff) !== (b[i] & 0xff)) return false;
  }
  return true;
}

/**
 * Tooltip for one trace hop row: resolved "hex → name" when a contact matched, bare hex otherwise.
 */
export function meshcoreHopSegmentTooltip(
  t: (key: string, opts?: Record<string, unknown>) => string,
  hop: { hex: string; label?: string | null },
): string | undefined {
  if (!hop.hex) return undefined;
  return hop.label && hop.label !== hop.hex
    ? t('meshcoreRoute.segmentResolvedTooltip', { hex: hop.hex, name: hop.label })
    : t('meshcoreRoute.segmentTooltip', { hex: hop.hex });
}

/**
 * Trace hop rows for UI: pair each pathSnrs entry with a path segment label.
 * Suppresses the final segment when it resolves to the destination (Dest row already names it).
 */
export function meshcoreTraceHopDisplayRows(opts: {
  pathHashes: readonly number[];
  pathSnrs: readonly number[];
  hashSizeBytes: MeshcoreHashSizeBytes;
  destNodeId?: number | null;
  getNodeLabel: (nodeId: number) => string;
  pubKeyByNodeId?: ReadonlyMap<number, Uint8Array>;
  candidates?: readonly NodeHashCandidate[];
}): { snr: number; label: string; hex: string }[] {
  const segments = buildMeshcorePathChainSegments({
    pathBytes: opts.pathHashes,
    hashSizeBytes: opts.hashSizeBytes,
    getNodeLabel: opts.getNodeLabel,
    pubKeyByNodeId: opts.pubKeyByNodeId,
    candidates: opts.candidates,
  });
  const snrs = Array.isArray(opts.pathSnrs) ? opts.pathSnrs : [];
  const destId = opts.destNodeId ?? null;
  const lastSegIsDest =
    destId != null && segments.length > 0 && segments.at(-1)?.resolvedNodeId === destId;

  const rows: { snr: number; label: string; hex: string }[] = [];
  for (let i = 0; i < snrs.length; i++) {
    if (lastSegIsDest && i === segments.length - 1) continue;
    const seg = segments[i];
    rows.push({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- External SDK value is validated by surrounding boundary logic.
      snr: snrs[i] ?? 0,
      label: seg.resolvedLabel ?? '',
      hex: seg.hex,
    });
  }
  return rows;
}
