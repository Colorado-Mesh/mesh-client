import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useSendTraceRoute(identityId: IdentityId) {
  return useCallback(
    (nodeId: number): Promise<void> => {
      const ctx = resolveCall(identityId, 'useSendTraceRoute');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.sendTraceRoute(ctx.handle, nodeId);
    },
    [identityId],
  );
}
