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

/** Uppercase hex for one on-air path hash segment (1–3 bytes). */
export function formatMeshcorePathSegmentHex(segment: Uint8Array): string {
  return Array.from(segment, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

export interface BuildMeshcorePathChainOpts {
  pathBytes: readonly number[];
  hashSizeBytes: 1 | 2 | 3;
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
