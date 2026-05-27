import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useSetModuleConfig(identityId: IdentityId) {
  return useCallback(
    (config: unknown): Promise<void> => {
      const ctx = resolveCall(identityId, 'useSetModuleConfig');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.setModuleConfig(ctx.handle, config);
    },
    [identityId],
  );
}
