/**
 * Callsign ↔ nodeId registry for MeshCom send/DM routing.
 * nodeId is `callsignToNodeId`; callsign remains the wire address.
 */

import { MESHCOM_CONTACT_CAP_DEFAULT } from '@/shared/meshcomConstants';

import { callsignToNodeId, normalizeMeshcomCallsign } from './meshcomCallsign';

const callByNodeId = new Map<number, string>();
const nodeIdByCall = new Map<string, number>();

function evictOldestCallRegistryEntry(): void {
  const oldestNodeId = callByNodeId.keys().next().value;
  if (oldestNodeId == null) return;
  const call = callByNodeId.get(oldestNodeId);
  callByNodeId.delete(oldestNodeId);
  if (call) nodeIdByCall.delete(call);
}

export function registerMeshcomCallsign(callsign: string): number {
  const call = normalizeMeshcomCallsign(callsign);
  if (!call) return 0;
  const nodeId = callsignToNodeId(call);
  const isNew = !callByNodeId.has(nodeId);
  if (isNew && callByNodeId.size >= MESHCOM_CONTACT_CAP_DEFAULT) {
    evictOldestCallRegistryEntry();
  } else if (!isNew) {
    // Refresh insertion order (LRU-ish) for known callsigns.
    callByNodeId.delete(nodeId);
    nodeIdByCall.delete(call);
  }
  callByNodeId.set(nodeId, call);
  nodeIdByCall.set(call, nodeId);
  return nodeId;
}

export function meshcomCallForNodeId(nodeId: number): string | undefined {
  return callByNodeId.get(nodeId);
}

export function meshcomNodeIdForCall(callsign: string): number {
  const call = normalizeMeshcomCallsign(callsign);
  if (!call) return 0;
  const existing = nodeIdByCall.get(call);
  if (existing != null) return existing;
  return registerMeshcomCallsign(call);
}

/** Test / disconnect cleanup. */
export function clearMeshcomCallRegistry(): void {
  callByNodeId.clear();
  nodeIdByCall.clear();
}
