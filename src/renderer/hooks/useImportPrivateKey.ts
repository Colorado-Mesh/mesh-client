import { useCallback } from 'react';

import { MeshCoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useImportPrivateKey(identityId: IdentityId | null) {
  return useCallback(
    async (privateKey: Uint8Array): Promise<boolean> => {
      const ctx = resolveCall(identityId, 'useImportPrivateKey');
      if (!ctx) return false;
      if (!(ctx.identity.protocol instanceof MeshCoreProtocol)) return false;
      await ctx.identity.protocol.importPrivateKey(ctx.handle, privateKey);
      return true;
    },
    [identityId],
  );
}
