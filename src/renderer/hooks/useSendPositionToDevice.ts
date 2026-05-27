import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useSendPositionToDevice(identityId: IdentityId) {
  return useCallback(
    (lat: number, lon: number, alt?: number): Promise<void> => {
      const ctx = resolveCall(identityId, 'useSendPositionToDevice');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.sendPositionToDevice(ctx.handle, lat, lon, alt);
    },
    [identityId],
  );
}
