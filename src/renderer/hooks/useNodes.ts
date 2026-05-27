import { useMemo } from 'react';

import type { IdentityId } from '../lib/types';
import type { NodeRecord } from '../stores/nodeStore';
import { useNodeStore } from '../stores/nodeStore';

const EMPTY_NODES: NodeRecord[] = [];

export function useNodes(identityId: IdentityId | null): NodeRecord[] {
  const byId = useNodeStore((s) => (identityId ? s.nodes[identityId] : undefined));
  return useMemo(() => {
    if (!byId) return EMPTY_NODES;
    return Object.values(byId);
  }, [byId]);
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
