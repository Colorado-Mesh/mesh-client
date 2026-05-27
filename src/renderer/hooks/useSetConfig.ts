import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useSetConfig(identityId: IdentityId) {
  return useCallback(
    (config: unknown): Promise<void> => {
      const ctx = resolveCall(identityId, 'useSetConfig');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.setConfig(ctx.handle, config);
    },
    [identityId],
  );
}
