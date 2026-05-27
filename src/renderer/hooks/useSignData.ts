import { useCallback } from 'react';

import { MeshCoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useSignData(identityId: IdentityId | null) {
  return useCallback(
    async (data: Uint8Array): Promise<Uint8Array | null> => {
      const ctx = resolveCall(identityId, 'useSignData');
      if (!ctx) return null;
      if (!(ctx.identity.protocol instanceof MeshCoreProtocol)) return null;
      return ctx.identity.protocol.signData(ctx.handle, data);
    },
    [identityId],
  );
}
