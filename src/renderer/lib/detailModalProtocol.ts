import { type MeshProtocol, REGISTERED_MESH_PROTOCOLS } from './types';

/**
 * Resolve which protocol owns the node-detail surface for a selected node id.
 *
 * Prefer the active tab's node map so MeshCom callsign-hash ids (and Meshtastic
 * node nums) that collide with a MeshCore pubkey-derived id do not steal
 * favorites, self detection, or panel actions.
 */
export function resolveDetailModalProtocol(
  selectedNodeId: number | null,
  activeProtocol: MeshProtocol,
  hasNode: (protocol: MeshProtocol, nodeId: number) => boolean,
): MeshProtocol {
  if (selectedNodeId == null) return activeProtocol;
  if (hasNode(activeProtocol, selectedNodeId)) return activeProtocol;
  for (const protocol of REGISTERED_MESH_PROTOCOLS) {
    if (protocol === activeProtocol) continue;
    if (hasNode(protocol, selectedNodeId)) return protocol;
  }
  return activeProtocol;
}
