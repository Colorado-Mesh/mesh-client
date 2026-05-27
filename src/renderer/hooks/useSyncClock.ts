import { useCallback } from 'react';

import { MeshCoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useSyncClock(identityId: IdentityId | null) {
  return useCallback(async (): Promise<void> => {
    const ctx = resolveCall(identityId, 'useSyncClock');
    if (!ctx) return;
    if (!(ctx.identity.protocol instanceof MeshCoreProtocol)) return;
    await ctx.identity.protocol.syncClock(ctx.handle);
  }, [identityId]);
}
