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
