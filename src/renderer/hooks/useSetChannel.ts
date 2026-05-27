import { useCallback } from 'react';

import type { SetChannelOptions } from '../lib/protocols/Protocol';
import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useSetChannel(identityId: IdentityId) {
  return useCallback(
    (opts: SetChannelOptions): Promise<void> => {
      const ctx = resolveCall(identityId, 'useSetChannel');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.setChannel(ctx.handle, opts);
    },
    [identityId],
  );
}
