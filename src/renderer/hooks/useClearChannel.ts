import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useClearChannel(identityId: IdentityId) {
  return useCallback(
    (index: number): Promise<void> => {
      const ctx = resolveCall(identityId, 'useClearChannel');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.clearChannel(ctx.handle, index);
    },
    [identityId],
  );
}
