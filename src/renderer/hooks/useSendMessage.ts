import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '../components/Toast';
import { messageToDbRow } from '../hooks/meshcore/meshcoreHookPreamble';
import { isMeshcoreOpenWireCompatEnabled } from '../lib/appSettingsStorage';
import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import { errLikeToLogString } from '../lib/errLikeToLogString';
import {
  clearHeardRepeatWindowIfMessage,
  openHeardRepeatWindow,
} from '../lib/meshcore/heardRepeatTracker';
import {
  isMeshcoreTcpOpenHopDeadAccepted,
  trackMeshcoreTcpUserTxSend,
} from '../lib/meshcore/meshcoreTcpInitBurst';
import { resolveMeshcoreOutboundWireText } from '../lib/meshcoreChannelText';
import { listChatMessagesFromStore } from '../lib/meshcoreStoreDedup';
import { useRelayCoverageStore } from '../lib/relayCoverage/relayCoverageStore';
import { sendReticulumChatMessage } from '../lib/reticulum/sendReticulumChatMessage';
import { tryGetMeshcoreSession } from '../lib/sessions/meshcoreSession';
import { tryGetMeshtasticSession } from '../lib/sessions/meshtasticSession';
import { messageRecordToChatMessage } from '../lib/storeRecordAdapters';
import type { IdentityId } from '../lib/types';
import { getConnection } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import {
  addMessage,
  type MessageRecord,
  renameMessageId,
  updateMessageStatus,
} from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';

function persistMeshcoreOutboundRow(
  record: MessageRecord,
  myNodeNum: number,
  senderName: string,
  status: 'sending' | 'acked' | 'failed',
  packetId?: number,
): void {
  const chat = messageRecordToChatMessage({ ...record, status });
  chat.sender_id = myNodeNum;
  chat.sender_name = senderName;
  if (packetId != null) chat.packetId = packetId;
  if (record.to !== 0xffffffff) chat.to = record.to;
  void window.electronAPI.db.saveMeshcoreMessage(messageToDbRow(chat)).catch((e: unknown) => {
    console.warn('[useSendMessage] saveMeshcoreMessage failed ' + errLikeToLogString(e));
  });
}

function trySendViaMeshtasticSession(
  identityId: IdentityId,
  handle: unknown,
  text: string,
  channelIndex: number,
  destination: number | undefined,
  replyTo: string | undefined,
): boolean {
  const session = tryGetMeshtasticSession();
  if (!session) return false;
  const mqttStatus = getConnection(identityId)?.mqttStatus ?? 'disconnected';
  const hasMqtt = mqttStatus === 'connected';
  if (!handle && !hasMqtt) {
    console.warn('[useSendMessage] no handle and MQTT disconnected for', identityId);
    return true;
  }
  const replyIdNum = replyTo != null && replyTo !== '' ? Number.parseInt(replyTo, 10) : undefined;
  session.sendChatMessage(
    text,
    channelIndex,
    destination,
    replyIdNum != null && !Number.isNaN(replyIdNum) ? replyIdNum : undefined,
  );
  return true;
}

function allocateOutboundProvisionalId(
  isMeshtastic: boolean,
  isMeshcoreDm: boolean,
): { provisionalId: string; meshtasticTempPacketId?: number; meshcoreDmTempPacketId?: number } {
  const meshtasticTempPacketId = isMeshtastic
    ? (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0 // NOSONAR non-crypto local temp packet id
    : undefined;
  const meshcoreDmTempPacketId = isMeshcoreDm
    ? (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0 // NOSONAR non-crypto local temp packet id
    : undefined;
  let provisionalId: string;
  if (meshtasticTempPacketId != null) {
    provisionalId = String(meshtasticTempPacketId);
  } else if (meshcoreDmTempPacketId != null) {
    provisionalId = String(meshcoreDmTempPacketId);
  } else {
    provisionalId = `out:${Date.now()}:${Math.random().toString(36).slice(2)}`; // NOSONAR non-crypto local provisional id
  }
  return { provisionalId, meshtasticTempPacketId, meshcoreDmTempPacketId };
}

export function useSendMessage(
  identityId: IdentityId | null,
): (
  text: string,
  channelIndex: number,
  destination?: number,
  replyTo?: string,
  retryOfStoreId?: string,
) => void {
  const { addToast } = useToast();
  const { t } = useTranslation();
  return useCallback(
    (
      text: string,
      channelIndex: number,
      destination?: number,
      replyTo?: string,
      retryOfStoreId?: string,
    ) => {
      if (!identityId) return;
      const identity = useIdentityStore.getState().identities[identityId];
      if (!identity) {
        console.warn('[useSendMessage] no identity for', identityId);
        return;
      }
      // Reticulum: sidecar LXMF send (no ConnectionDriver handle).
      if (identity.protocol.type === 'reticulum') {
        sendReticulumChatMessage({
          identityId,
          text,
          channelIndex,
          destination,
          replyTo,
          retryOfStoreId,
          onNoPropagationNode: () => {
            addToast(t('chatPanel.reticulumNoPropagationNode'), 'error');
          },
        });
        return;
      }

      const handle = connectionDriver.getHandle(identityId);

      // Meshtastic: runtime TransportManager sends RF + MQTT concurrently (hybrid or MQTT-only).
      if (identity.protocol.type === 'meshtastic') {
        if (
          trySendViaMeshtasticSession(identityId, handle, text, channelIndex, destination, replyTo)
        ) {
          return;
        }
        if (!handle) {
          console.warn('[useSendMessage] Meshtastic runtime not mounted and no RF handle');
          return;
        }
      }

      if (!handle) {
        // OpenHop dead bridge may still send via quiet reopen (handle recreated on open).
        if (!(identity.protocol.type === 'meshcore' && isMeshcoreTcpOpenHopDeadAccepted())) {
          console.warn('[useSendMessage] no handle for', identityId);
          return;
        }
      }

      const isMeshtastic = identity.protocol.type === 'meshtastic';
      const isMeshcoreDm = identity.protocol.type === 'meshcore' && destination != null;
      const { provisionalId, meshtasticTempPacketId } = allocateOutboundProvisionalId(
        isMeshtastic,
        isMeshcoreDm,
      );
      const myNodeNum = getConnection(identityId)?.myNodeNum ?? 0;
      const meshcoreSenderName =
        identity.protocol.type === 'meshcore'
          ? (useNodeStore.getState().nodes[identityId]?.[myNodeNum]?.longName ?? 'Me')
          : 'Me';
      const isMeshcore = identity.protocol.type === 'meshcore';
      const openWireCompat = isMeshcore && isMeshcoreOpenWireCompatEnabled();
      const resolvedOutbound = isMeshcore
        ? resolveMeshcoreOutboundWireText({
            text,
            replyTo,
            channelIndex,
            destination,
            myNodeNum,
            messages: listChatMessagesFromStore(identityId),
            openWireCompat,
          })
        : { wireText: text, displayPayload: text };
      const record = {
        id: provisionalId,
        from: myNodeNum,
        to: destination ?? 0xffffffff,
        payload: resolvedOutbound.displayPayload,
        channelIndex,
        timestamp: Date.now(),
        status: 'sending' as const,
        replyTo,
      };
      addMessage(identityId, record);

      // MeshCore channel floods: Chat sends via this hook (not useMeshcoreRuntime).
      // Open the heard-repeat listen window on the provisional bubble id (renameMessageId
      // re-keys coverage if packetId later replaces it).
      if (isMeshcore && !isMeshcoreDm) {
        openHeardRepeatWindow(identityId, provisionalId);
      }

      const abandonMeshcoreHeardRepeat = (): void => {
        if (!(isMeshcore && !isMeshcoreDm)) return;
        clearHeardRepeatWindowIfMessage(identityId, provisionalId);
        useRelayCoverageStore.getState().remove(identityId, provisionalId);
      };

      if (isMeshtastic) {
        void window.electronAPI.db
          .saveMessage(messageRecordToChatMessage(record))
          .catch((e: unknown) => {
            console.debug('[useSendMessage] saveMessage failed ' + errLikeToLogString(e));
          });
      }

      let destinationPubKey: Uint8Array | undefined;
      if (isMeshcoreDm) {
        destinationPubKey = useNodeStore.getState().nodes[identityId]?.[destination]?.publicKey;
        destinationPubKey ??= tryGetMeshcoreSession()?.getDestinationPubKey?.(destination);
      }

      const wireText = resolvedOutbound.wireText;

      if (isMeshcore && isMeshcoreTcpOpenHopDeadAccepted()) {
        void (async () => {
          try {
            const applyOpenHopSendResult = (res: { packetId?: number }): void => {
              const resolvedId = res.packetId != null ? String(res.packetId >>> 0) : provisionalId;
              if (res.packetId != null && resolvedId !== provisionalId) {
                renameMessageId(identityId, provisionalId, resolvedId);
              }
              updateMessageStatus(identityId, resolvedId, 'acked');
              persistMeshcoreOutboundRow(
                { ...record, id: resolvedId, status: 'acked' },
                myNodeNum,
                meshcoreSenderName,
                'acked',
                res.packetId != null ? res.packetId >>> 0 : undefined,
              );
            };
            const runTx = tryGetMeshcoreSession()?.runMeshcoreUserTxWithLiveTcp;
            if (!runTx) {
              await tryGetMeshcoreSession()?.ensureTcpLiveForUserTx?.();
              const liveHandle = connectionDriver.getHandle(identityId);
              if (!liveHandle) {
                throw new Error('MeshCore TCP live reopen produced no handle');
              }
              const sendPromise = identity.protocol.sendMessage(liveHandle, {
                text: wireText,
                channelIndex,
                destination,
                destinationPubKey,
                replyTo,
              });
              trackMeshcoreTcpUserTxSend(sendPromise);
              applyOpenHopSendResult(await sendPromise);
              return;
            }
            const res = await runTx(async () => {
              const liveHandle = connectionDriver.getHandle(identityId);
              if (!liveHandle) {
                throw new Error('MeshCore TCP live reopen produced no handle');
              }
              return identity.protocol.sendMessage(liveHandle, {
                text: wireText,
                channelIndex,
                destination,
                destinationPubKey,
                replyTo,
              });
            });
            // Only after OpenHop retry loop resolves — not inside the parked op (latch-retry
            // may re-run the send; premature acked would stick if attempt 2 failed).
            applyOpenHopSendResult(res);
          } catch (e: unknown) {
            const errMsg = errLikeToLogString(e);
            console.warn('[useSendMessage] OpenHop live reopen failed ' + errMsg);
            updateMessageStatus(identityId, provisionalId, 'failed', errMsg);
            persistMeshcoreOutboundRow(record, myNodeNum, meshcoreSenderName, 'failed');
            abandonMeshcoreHeardRepeat();
          }
        })();
        return;
      }

      if (!handle) {
        console.warn('[useSendMessage] no handle for', identityId);
        abandonMeshcoreHeardRepeat();
        return;
      }

      const finishSend = (
        sendHandle: NonNullable<typeof handle>,
        opts?: { trackForOpenHopLiveWindow?: boolean },
      ): void => {
        const sendPromise = identity.protocol.sendMessage(sendHandle, {
          text: wireText,
          channelIndex,
          destination,
          destinationPubKey,
          replyTo,
        });
        if (opts?.trackForOpenHopLiveWindow) {
          trackMeshcoreTcpUserTxSend(sendPromise);
        }
        void sendPromise.then(
          (res) => {
            const resolvedId = res.packetId != null ? String(res.packetId >>> 0) : provisionalId;
            if (res.packetId != null && resolvedId !== provisionalId) {
              renameMessageId(identityId, provisionalId, resolvedId);
              if (isMeshtastic && meshtasticTempPacketId != null) {
                void window.electronAPI.db
                  .updateMessagePacketId(meshtasticTempPacketId, res.packetId >>> 0, myNodeNum)
                  .catch((e: unknown) => {
                    console.debug(
                      '[useSendMessage] updateMessagePacketId failed ' + errLikeToLogString(e),
                    );
                  });
              }
            }

            updateMessageStatus(identityId, resolvedId, 'acked');
            if (identity.protocol.type === 'meshcore') {
              const rowForDb: MessageRecord = {
                ...record,
                id: resolvedId,
                status: 'acked',
              };
              persistMeshcoreOutboundRow(
                rowForDb,
                myNodeNum,
                meshcoreSenderName,
                'acked',
                res.packetId != null ? res.packetId >>> 0 : undefined,
              );
            }
            if (isMeshtastic && meshtasticTempPacketId != null) {
              const rowPacketId = res.packetId ?? meshtasticTempPacketId;
              void window.electronAPI.db
                .updateMessageStatus(rowPacketId, 'acked')
                .catch((e: unknown) => {
                  console.debug(
                    '[useSendMessage] updateMessageStatus failed ' + errLikeToLogString(e),
                  );
                });
            }
          },
          (e: unknown) => {
            const errMsg = errLikeToLogString(e);
            console.warn('[useSendMessage] send failed ' + errMsg);
            updateMessageStatus(identityId, provisionalId, 'failed', errMsg);
            if (identity.protocol.type === 'meshcore') {
              persistMeshcoreOutboundRow(record, myNodeNum, meshcoreSenderName, 'failed');
            }
            abandonMeshcoreHeardRepeat();
            if (isMeshtastic && meshtasticTempPacketId != null) {
              void window.electronAPI.db
                .updateMessageStatus(meshtasticTempPacketId, 'failed', errMsg)
                .catch((dbErr: unknown) => {
                  console.debug(
                    '[useSendMessage] updateMessageStatus failed ' + errLikeToLogString(dbErr),
                  );
                });
            }
          },
        );
      };

      finishSend(handle);
    },
    [identityId, addToast, t],
  );
}
