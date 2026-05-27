import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useReboot(identityId: IdentityId) {
  return useCallback(
    (delay?: number): Promise<void> => {
      const ctx = resolveCall(identityId, 'useReboot');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.reboot(ctx.handle, delay);
    },
    [identityId],
  );
}
