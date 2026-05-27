import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useSetRingtone(identityId: IdentityId) {
  return useCallback(
    (ringtone: string): Promise<void> => {
      const ctx = resolveCall(identityId, 'useSetRingtone');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.setRingtone(ctx.handle, ringtone);
    },
    [identityId],
  );
}
