import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useRequestRefresh(identityId: IdentityId) {
  return useCallback(
    (): Promise<void> => {
      const ctx = resolveCall(identityId, 'useRequestRefresh');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.requestRefresh(ctx.handle);
    },
    [identityId],
  );
}
