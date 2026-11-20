/**
 * Callsign ↔ nodeId registry for MeshCom send/DM routing.
 * nodeId is `callsignToNodeId`; callsign remains the wire address.
 */

import { callsignToNodeId, normalizeMeshcomCallsign } from './meshcomCallsign';

const callByNodeId = new Map<number, string>();
const nodeIdByCall = new Map<string, number>();

export function registerMeshcomCallsign(callsign: string): number {
  const call = normalizeMeshcomCallsign(callsign);
  if (!call) return 0;
  const nodeId = callsignToNodeId(call);
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
