import {
  registerReticulumDestinationHash,
  resolveReticulumDestinationHash,
} from '@/renderer/lib/reticulum/destHash';
import {
  reticulumHashForNodeId,
  useReticulumPeerStore,
} from '@/renderer/stores/reticulumPeerStore';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';

/** Cap unresolved face lookups within a peersRevision to avoid unbounded Sets. */
const UNRESOLVED_FACE_CACHE_MAX = 2048;

let unresolvedFaceCacheRevision = -1;
const unresolvedFaceNodeNums = new Set<number>();

function resetUnresolvedFaceCacheIfStale(peersRevision: number): void {
  if (peersRevision === unresolvedFaceCacheRevision) return;
  unresolvedFaceCacheRevision = peersRevision;
  unresolvedFaceNodeNums.clear();
}

/** Test helper — clear negative face-hash cache. */
export function resetReticulumDmFaceHashNegativeCacheForTests(): void {
  unresolvedFaceCacheRevision = -1;
  unresolvedFaceNodeNums.clear();
}

/**
 * Resolve a 32-hex LXMF destination for Chat DM faces / peer-detail links.
 * Prefers the node record hash, then the peer-store / registry fold.
 */
export function resolveReticulumDmFaceHash(
  nodeNum: number,
  nodeDestinationHash?: string | null,
): string | null {
  const fromNode = nodeDestinationHash?.trim();
  if (fromNode) {
    const canonical = canonicalizeReticulumDestinationHash(fromNode);
    if (canonical) {
      registerReticulumDestinationHash(nodeNum, canonical);
      unresolvedFaceNodeNums.delete(nodeNum);
      return canonical;
    }
  }

  const peersRevision = useReticulumPeerStore.getState().peersRevision;
  resetUnresolvedFaceCacheIfStale(peersRevision);
  if (unresolvedFaceNodeNums.has(nodeNum)) {
    return null;
  }

  const fromStore =
    reticulumHashForNodeId(nodeNum) ?? resolveReticulumDestinationHash(nodeNum) ?? null;
  if (!fromStore) {
    unresolvedFaceNodeNums.add(nodeNum);
    if (unresolvedFaceNodeNums.size > UNRESOLVED_FACE_CACHE_MAX) {
      unresolvedFaceNodeNums.clear();
      unresolvedFaceNodeNums.add(nodeNum);
    }
    return null;
  }
  unresolvedFaceNodeNums.delete(nodeNum);
  return canonicalizeReticulumDestinationHash(fromStore) ?? null;
}
