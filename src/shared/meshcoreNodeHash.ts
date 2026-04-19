/* eslint-disable security/detect-possible-timing-attacks */
/**
 * Minimal node shape required by resolveNodeId.
 * Structurally compatible with MeshNode from src/renderer/lib/types.ts.
 */
export interface NodeHashCandidate {
  node_id: number;
  last_heard: number; // Unix seconds
}

/**
 * XOR-fold a 32-bit node_id down to a 1-byte MeshCore routing hash.
 * Matches hashSizeCode=0 in the RF path prefix (meshcoreRfPath.ts).
 */
export function meshcoreNodeHash(nodeId: number): number {
  return (
    (((nodeId >>> 24) & 0xff) ^
      ((nodeId >>> 16) & 0xff) ^
      ((nodeId >>> 8) & 0xff) ^
      (nodeId & 0xff)) &
    0xff
  );
}

/**
 * Resolve a 1-byte routing hash back to a full node_id.
 *
 * Returns the node_id of the best-matching known node, or null if none match.
 * On hash collision, the node with the highest last_heard timestamp wins.
 * Single-pass O(n) — safe to call inside onDataReceived hot path.
 */
export function resolveNodeId(hash: number, knownNodes: NodeHashCandidate[]): number | null {
  let best: NodeHashCandidate | null = null;
  for (const node of knownNodes) {
    if (meshcoreNodeHash(node.node_id) === hash) {
      if (best === null || node.last_heard > best.last_heard) {
        best = node;
      }
    }
  }
  return best?.node_id ?? null;
}
