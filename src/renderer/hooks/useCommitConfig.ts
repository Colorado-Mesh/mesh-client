import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useCommitConfig(identityId: IdentityId) {
  return useCallback(
    (): Promise<void> => {
      const ctx = resolveCall(identityId, 'useCommitConfig');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.commitConfig(ctx.handle);
    },
    [identityId],
  );
}
