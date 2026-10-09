import { useEffect, useRef } from 'react';

import { isMeshProtocol } from '@/shared/meshProtocol';

import { startAutoResend } from '../lib/autoResend/autoResendController';
import type { MeshProtocol } from '../lib/types';
import { getIdentity } from '../stores/identityStore';

export type AutoResendProtocolSend = (
  text: string,
  channelIndex: number,
  destination?: number,
  replyTo?: string,
  retryOfStoreId?: string,
) => string | undefined;

/**
 * Automatically resend failed regular messages (see `autoResendPolicy.ts`). Mount once from
 * App with each protocol's `useSendMessage` result.
 */
export function useAutoResend(sendByProtocol: Record<MeshProtocol, AutoResendProtocolSend>): void {
  const sendRef = useRef(sendByProtocol);
  useEffect(() => {
    sendRef.current = sendByProtocol;
  }, [sendByProtocol]);

  useEffect(
    () =>
      startAutoResend(
        (protocol, args) =>
          sendRef.current[protocol](
            args.text,
            args.channelIndex,
            args.destination,
            args.replyTo,
            args.retryOfStoreId,
          ),
        (identityId) => {
          const type = getIdentity(identityId)?.protocol.type;
          return type != null && isMeshProtocol(type) ? type : null;
        },
      ),
    [],
  );
}
