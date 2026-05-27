import { useCallback } from 'react';

import { MeshCoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useImportContact(identityId: IdentityId | null) {
  return useCallback(
    async (advertBytes: Uint8Array): Promise<void> => {
      const ctx = resolveCall(identityId, 'useImportContact');
      if (!ctx) return;
      if (!(ctx.identity.protocol instanceof MeshCoreProtocol)) return;
      await ctx.identity.protocol.importContact(ctx.handle, advertBytes);
    },
    [identityId],
  );
}
