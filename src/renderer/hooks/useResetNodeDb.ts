import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useResetNodeDb(identityId: IdentityId) {
  return useCallback(
    (): Promise<void> => {
      const ctx = resolveCall(identityId, 'useResetNodeDb');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.resetNodeDb(ctx.handle);
    },
    [identityId],
  );
}
