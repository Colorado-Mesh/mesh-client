import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useFactoryReset(identityId: IdentityId) {
  return useCallback((): Promise<void> => {
    const ctx = resolveCall(identityId, 'useFactoryReset');
    if (!ctx) return Promise.resolve();
    return ctx.identity.protocol.factoryReset(ctx.handle);
  }, [identityId]);
}
