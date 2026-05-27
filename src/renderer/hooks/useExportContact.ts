import { useCallback } from 'react';

import { MeshCoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import type { IdentityId } from '../lib/types';
import { useNodeStore } from '../stores/nodeStore';
import { resolveCall } from './_protocolCall';

export function useExportContact(identityId: IdentityId | null) {
  return useCallback(
    async (nodeId: number): Promise<Uint8Array | null> => {
      const ctx = resolveCall(identityId, 'useExportContact');
      if (!ctx || !identityId) return null;
      if (!(ctx.identity.protocol instanceof MeshCoreProtocol)) return null;
      const pubKey = useNodeStore.getState().nodes[identityId]?.[nodeId]?.publicKey;
      if (!pubKey) return null;
      return ctx.identity.protocol.exportContact(ctx.handle, pubKey);
    },
    [identityId],
  );
}
