import { useCallback } from 'react';

import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import { errLikeToLogString } from '../lib/errLikeToLogString';
import { tryGetMeshtasticSession } from '../lib/sessions/meshtasticSession';
import type { IdentityId } from '../lib/types';
import { getConnection } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import { addMessage, renameMessageId, updateMessageStatus } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';

export function useSendMessage(
  identityId: IdentityId | null,
): (text: string, channelIndex: number, destination?: number, replyTo?: string) => void {
  return useCallback(
    (text: string, channelIndex: number, destination?: number, replyTo?: string) => {
      if (!identityId) return;
      const identity = useIdentityStore.getState().identities[identityId];
      if (!identity) {
        console.warn('[useSendMessage] no identity for', identityId);
        return;
      }
      const handle = connectionDriver.getHandle(identityId);

      // Meshtastic MQTT-only: no RF handle; runtime TransportManager owns publish + echo suppression.
      if (!handle && identity.protocol.type === 'meshtastic') {
        const mqttStatus = getConnection(identityId)?.mqttStatus ?? 'disconnected';
        if (mqttStatus !== 'connected') {
          console.warn('[useSendMessage] no handle and MQTT disconnected for', identityId);
          return;
        }
        const session = tryGetMeshtasticSession();
        if (!session) {
          console.warn('[useSendMessage] Meshtastic runtime not mounted');
          return;
        }
        const replyIdNum =
          replyTo != null && replyTo !== '' ? Number.parseInt(replyTo, 10) : undefined;
        session.sendChatMessage(
          text,
          channelIndex,
          destination,
          replyIdNum != null && !Number.isNaN(replyIdNum) ? replyIdNum : undefined,
        );
        return;
      }

      if (!handle) {
        console.warn('[useSendMessage] no handle for', identityId);
        return;
      }

      const provisionalId = `out:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const myNodeNum = getConnection(identityId)?.myNodeNum ?? 0;
      addMessage(identityId, {
        id: provisionalId,
        from: myNodeNum,
        to: destination ?? 0xffffffff,
        payload: text,
        channelIndex,
        timestamp: Date.now(),
        status: 'sending',
        replyTo,
      });

      // MeshCore DMs need the destination pubkey; look up on nodeStore.
      let destinationPubKey: Uint8Array | undefined;
      if (identity.protocol.type === 'meshcore' && destination != null) {
        destinationPubKey = useNodeStore.getState().nodes[identityId]?.[destination]?.publicKey;
      }

      void identity.protocol
        .sendMessage(handle, { text, channelIndex, destination, destinationPubKey, replyTo })
        .then((res) => {
          if (res.packetId != null) {
            renameMessageId(identityId, provisionalId, String(res.packetId));
          }
        })
        .catch((e: unknown) => {
          const errMsg = errLikeToLogString(e);
          console.warn('[useSendMessage] send failed ' + errMsg);
          updateMessageStatus(identityId, provisionalId, 'failed', errMsg);
        });
    },
    [identityId],
  );
}
