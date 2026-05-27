import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useRebootOta(identityId: IdentityId) {
  return useCallback(
    (delay?: number): Promise<void> => {
      const ctx = resolveCall(identityId, 'useRebootOta');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.rebootOta(ctx.handle, delay);
    },
    [identityId],
  );
}
