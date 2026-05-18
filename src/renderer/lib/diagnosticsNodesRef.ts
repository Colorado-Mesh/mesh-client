import type { MeshNode } from '@/renderer/lib/types';

/** Latest MeshCore node map for Foreign LoRa name resolution when Meshtastic hears MeshCore. */
let meshcoreNodesSnapshot = new Map<number, MeshNode>();
let meshcoreSelfNodeId = 0;

export function setMeshcoreDiagnosticsNodes(nodes: Map<number, MeshNode>, selfNodeId = 0): void {
  meshcoreNodesSnapshot = nodes;
  meshcoreSelfNodeId = selfNodeId;
}

export function getMeshcoreDiagnosticsSelfNodeId(): number {
  return meshcoreSelfNodeId;
}

export function getMergedNodesForForeignLoraDiagnostics(
  meshtasticNodes: Map<number, MeshNode>,
): Map<number, MeshNode> {
  const merged = new Map(meshtasticNodes);
  for (const [id, node] of meshcoreNodesSnapshot) {
    merged.set(id, node);
  }
  return merged;
}
