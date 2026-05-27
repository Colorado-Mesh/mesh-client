import { useCallback } from 'react';

import type { SetOwnerOptions } from '../lib/protocols/Protocol';
import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useSetOwner(identityId: IdentityId) {
  return useCallback(
    (opts: SetOwnerOptions): Promise<void> => {
      const ctx = resolveCall(identityId, 'useSetOwner');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.setOwner(ctx.handle, opts);
    },
    [identityId],
  );
}
