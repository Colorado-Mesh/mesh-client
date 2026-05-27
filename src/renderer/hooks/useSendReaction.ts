import { useCallback } from 'react';

import { MeshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

export function useSendReaction(identityId: IdentityId | null) {
  return useCallback(
    (emoji: number, messageId: string, channelIndex: number): Promise<void> => {
      const ctx = resolveCall(identityId, 'useSendReaction');
      if (!ctx) return Promise.reject(new Error('Not connected'));
      if (!(ctx.identity.protocol instanceof MeshtasticProtocol)) {
        return Promise.reject(new Error('Protocol does not support reactions'));
      }
      return ctx.identity.protocol.sendReaction(
        ctx.handle,
        emoji,
        parseInt(messageId, 10),
        channelIndex,
      );
    },
    [identityId],
  );
}
