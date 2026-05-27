import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useDeleteWaypoint(identityId: IdentityId) {
  return useCallback(
    (id: number): Promise<void> => {
      const ctx = resolveCall(identityId, 'useDeleteWaypoint');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.deleteWaypoint(ctx.handle, id);
    },
    [identityId],
  );
}
