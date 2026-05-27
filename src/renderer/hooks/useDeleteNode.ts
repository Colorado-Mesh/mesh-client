import { useCallback } from 'react';

import { MeshCoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import type { IdentityId } from '../lib/types';
import { useNodeStore } from '../stores/nodeStore';
import { resolveCall } from './_protocolCall';

/**
 * Delete a node. MeshCore: looks up the pubkey from nodeStore and calls
 * removeContact on the SDK (forgets the contact on-device). Meshtastic: local
 * delete only (the firmware has no "remove node" RPC).
 */
export function useDeleteNode(identityId: IdentityId) {
  return useCallback(
    async (nodeId: number): Promise<void> => {
      const ctx = resolveCall(identityId, 'useDeleteNode');
      if (!ctx) return;

      if (ctx.identity.protocol instanceof MeshCoreProtocol) {
        const pubKey = useNodeStore.getState().nodes[identityId]?.[nodeId]?.publicKey;
        if (pubKey) {
          await ctx.identity.protocol.removeContact(ctx.handle, pubKey).catch((e: unknown) => {
            console.warn('[useDeleteNode] removeContact failed', e);
          });
        }
      }

      // Always clear locally.
      useNodeStore.setState((s) => {
        const byId = s.nodes[identityId];
        if (!byId) return s;
        const { [nodeId]: _removed, ...rest } = byId;
        return { nodes: { ...s.nodes, [identityId]: rest } };
      });
    },
    [identityId],
  );
}
