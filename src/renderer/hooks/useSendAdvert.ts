import { useCallback } from 'react';

import { MeshCoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useSendAdvert(identityId: IdentityId | null) {
  return useCallback(async (): Promise<void> => {
    const ctx = resolveCall(identityId, 'useSendAdvert');
    if (!ctx) return;
    if (!(ctx.identity.protocol instanceof MeshCoreProtocol)) return;
    await ctx.identity.protocol.sendAdvert(ctx.handle);
  }, [identityId]);
}
