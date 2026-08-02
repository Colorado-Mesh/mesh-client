import {
  registerReticulumDestinationHash,
  resolveReticulumDestinationHash,
} from '@/renderer/lib/reticulum/destHash';
import { reticulumHashForNodeId } from '@/renderer/stores/reticulumPeerStore';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';

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
      return canonical;
    }
  }
  const fromStore =
    reticulumHashForNodeId(nodeNum) ?? resolveReticulumDestinationHash(nodeNum) ?? null;
  if (!fromStore) return null;
  return canonicalizeReticulumDestinationHash(fromStore) ?? null;
}
