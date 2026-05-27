import { useCallback } from 'react';

import type { SendWaypointOptions } from '../lib/protocols/Protocol';
import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useSendWaypoint(identityId: IdentityId) {
  return useCallback(
    (opts: SendWaypointOptions): Promise<void> => {
      const ctx = resolveCall(identityId, 'useSendWaypoint');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.sendWaypoint(ctx.handle, opts);
    },
    [identityId],
  );
}
