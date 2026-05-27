import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useSetCannedMessages(identityId: IdentityId) {
  return useCallback(
    (messages: string[]): Promise<void> => {
      const ctx = resolveCall(identityId, 'useSetCannedMessages');
      if (!ctx) return Promise.resolve();
      return ctx.identity.protocol.setCannedMessages(ctx.handle, messages);
    },
    [identityId],
  );
}
