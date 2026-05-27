import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useEnterDfuMode(identityId: IdentityId) {
  return useCallback(
    (): Promise<void> => {
      const ctx = resolveCall(identityId, 'useEnterDfuMode');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.enterDfuMode(ctx.handle);
    },
    [identityId],
  );
}
