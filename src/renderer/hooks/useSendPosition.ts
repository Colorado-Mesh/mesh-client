import { useCallback } from 'react';

import type { SendPositionOptions } from '../lib/protocols/Protocol';
import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useSendPosition(identityId: IdentityId) {
  return useCallback(
    (opts: SendPositionOptions): Promise<void> => {
      const ctx = resolveCall(identityId, 'useSendPosition');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.sendPosition(ctx.handle, opts);
    },
    [identityId],
  );
}
