import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useFactoryResetConfig(identityId: IdentityId) {
  return useCallback(
    (): Promise<void> => {
      const ctx = resolveCall(identityId, 'useFactoryResetConfig');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.factoryResetConfig(ctx.handle);
    },
    [identityId],
  );
}
