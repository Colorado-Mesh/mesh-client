import type { IdentityId } from '../lib/types';
import type { NodeRecord } from '../stores/nodeStore';
import { useNodeStore } from '../stores/nodeStore';

export function useNodes(identityId: IdentityId): NodeRecord[] {
  return useNodeStore((s) => {
    const byId = s.nodes[identityId];
    return byId ? Object.values(byId) : [];
  });
}

export function useNode(identityId: IdentityId, nodeId: number): NodeRecord | null {
  return useNodeStore((s) => s.nodes[identityId]?.[nodeId] ?? null);
}

export function useWaypoints(identityId: IdentityId) {
  return useNodeStore((s) => {
    const byId = s.waypoints[identityId];
    return byId ? Object.values(byId) : [];
  });
}

export function useTraceRoutes(identityId: IdentityId) {
  return useNodeStore((s) => s.traceRoutes[identityId] ?? []);
}
