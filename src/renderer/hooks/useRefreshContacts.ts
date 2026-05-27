import { useCallback } from 'react';

import { MeshCoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import type { IdentityId } from '../lib/types';
import { setMeshcoreContacts } from '../stores/deviceStore';
import { resolveCall } from './_protocolCall';

export function useRefreshContacts(identityId: IdentityId | null) {
  return useCallback(async (): Promise<void> => {
    const ctx = resolveCall(identityId, 'useRefreshContacts');
    if (!ctx || !identityId) return;
    if (!(ctx.identity.protocol instanceof MeshCoreProtocol)) return;
    const contacts = await ctx.identity.protocol.refreshContacts(ctx.handle);
    setMeshcoreContacts(identityId, contacts);
  }, [identityId]);
}
