import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { useNodeStore } from '../stores/nodeStore';

export function useSetNodeFavorited(identityId: IdentityId) {
  return useCallback(
    async (nodeId: number, favorited: boolean): Promise<void> => {
      await window.electronAPI.db.setNodeFavorited(nodeId, favorited);
      useNodeStore.setState((s) => {
        const byId = s.nodes[identityId];
        if (!byId?.[nodeId]) return s;
        return {
          nodes: {
            ...s.nodes,
            [identityId]: {
              ...byId,
              [nodeId]: { ...byId[nodeId], favorited },
            },
          },
        };
      });
    },
    [identityId],
  );
}
