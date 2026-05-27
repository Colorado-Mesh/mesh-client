import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useRequestPosition(identityId: IdentityId) {
  return useCallback(
    (nodeId: number): Promise<void> => {
      const ctx = resolveCall(identityId, 'useRequestPosition');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.requestPosition(ctx.handle, nodeId);
    },
    [identityId],
  );
}
