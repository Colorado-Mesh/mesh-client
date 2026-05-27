import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useShutdown(identityId: IdentityId) {
  return useCallback(
    (delay?: number): Promise<void> => {
      const ctx = resolveCall(identityId, 'useShutdown');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.shutdown(ctx.handle, delay);
    },
    [identityId],
  );
}
