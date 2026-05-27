import { useCallback } from 'react';

import { MeshCoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useExportPrivateKey(identityId: IdentityId | null) {
  return useCallback(async (): Promise<Uint8Array | null> => {
    const ctx = resolveCall(identityId, 'useExportPrivateKey');
    if (!ctx) return null;
    if (!(ctx.identity.protocol instanceof MeshCoreProtocol)) return null;
    return ctx.identity.protocol.exportPrivateKey(ctx.handle);
  }, [identityId]);
}
