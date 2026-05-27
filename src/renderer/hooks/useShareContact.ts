import { useCallback } from 'react';

import { MeshCoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import type { IdentityId } from '../lib/types';
import { useNodeStore } from '../stores/nodeStore';
import { resolveCall } from './_protocolCall';

export function useShareContact(identityId: IdentityId | null) {
  return useCallback(
    async (nodeId: number): Promise<boolean> => {
      const ctx = resolveCall(identityId, 'useShareContact');
      if (!ctx || !identityId) return false;
      if (!(ctx.identity.protocol instanceof MeshCoreProtocol)) return false;
      const pubKey = useNodeStore.getState().nodes[identityId]?.[nodeId]?.publicKey;
      if (!pubKey) return false;
      await ctx.identity.protocol.shareContact(ctx.handle, pubKey);
      return true;
    },
    [identityId],
  );
}
