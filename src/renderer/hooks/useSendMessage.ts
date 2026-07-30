import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '../components/Toast';
import { messageToDbRow } from '../hooks/meshcore/meshcoreHookPreamble';
import { isMeshcoreOpenWireCompatEnabled } from '../lib/appSettingsStorage';
import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import { errLikeToLogString } from '../lib/errLikeToLogString';
import {
  findReticulumParentRecordByHash,
  persistReticulumOutboundRecord,
  resolveReticulumOutboundSenderHash,
} from '../lib/ingest/reticulumIngest';
import { resolveMeshcoreOutboundWireText } from '../lib/meshcoreChannelText';
import { listChatMessagesFromStore } from '../lib/meshcoreStoreDedup';
import { truncateReplyPreviewText } from '../lib/replyPreview';
import { resolveReticulumDestinationHash, reticulumHashToNodeId } from '../lib/reticulum/destHash';
import { tryGetMeshcoreSession } from '../lib/sessions/meshcoreSession';
import { tryGetMeshtasticSession } from '../lib/sessions/meshtasticSession';
import {
  getReticulumSendMessage,
  resolveReticulumOutboundVia,
  tryGetReticulumSession,
} from '../lib/sessions/reticulumSession';
import { messageRecordToChatMessage } from '../lib/storeRecordAdapters';
import type { IdentityId } from '../lib/types';
import { getConnection } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import {
  addMessage,
  type MessageRecord,
  renameMessageId,
  updateMessageStatus,
  upsertMessage,
  useMessageStore,
} from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import { reticulumHashForNodeId } from '../stores/reticulumPeerStore';

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

function sendReticulumChatMessage(opts: {
  identityId: IdentityId;
  text: string;
  channelIndex: number;
  destination?: number;
  replyTo?: string;
  retryOfStoreId?: string;
  onNoPropagationNode: () => void;
}): boolean {
  const {
    identityId,
    text,
    channelIndex,
    destination,
    replyTo,
    retryOfStoreId,
    onNoPropagationNode,
  } = opts;
  const session = tryGetReticulumSession();
  const send = getReticulumSendMessage(session);
  if (!send || !session) {
    console.warn('[useSendMessage] Reticulum runtime not mounted');
    return true;
  }
  const destHash =
    typeof destination === 'string'
      ? destination
      : (reticulumHashForNodeId(destination ?? 0) ?? resolveReticulumDestinationHash(destination));
  if (!destHash) {
    console.warn('[useSendMessage] no Reticulum destination hash for', destination);
    return true;
  }
  const selfNodeId = session.selfNodeId;
  if (typeof selfNodeId !== 'number') {
    console.warn('[useSendMessage] Reticulum self node id not ready');
    return true;
  }
  const receivedVia = resolveReticulumOutboundVia(destHash);
  const toNodeId = (destination ?? reticulumHashToNodeId(destHash)) >>> 0;
  const senderName = session.getFullNodeLabel(selfNodeId);
  const senderHash = resolveReticulumOutboundSenderHash(selfNodeId);
  const existing =
    retryOfStoreId != null && retryOfStoreId !== ''
      ? useMessageStore.getState().messages[identityId]?.[retryOfStoreId]
      : undefined;
  const parent = replyTo ? findReticulumParentRecordByHash(identityId, replyTo) : undefined;
  const replyPreviewText = parent ? truncateReplyPreviewText(parent.payload) : undefined;
  const replyPreviewSender = parent?.senderName?.trim() || undefined;
  const replyFields = replyTo
    ? {
        reticulumReplyToHash: replyTo,
        ...(replyPreviewText ? { replyPreviewText } : {}),
        ...(replyPreviewSender ? { replyPreviewSender } : {}),
      }
    : {};

  let pendingId: string;
  let record: MessageRecord;
  if (existing) {
    pendingId = existing.id;
    record = {
      ...existing,
      from: selfNodeId >>> 0,
      senderName,
      to: toNodeId,
      payload: text,
      channelIndex,
      status: 'sending',
      receivedVia,
      error: undefined,
      reticulumDeliveryMethod: undefined,
      reticulumMessageHash: undefined,
      ...replyFields,
    };
    upsertMessage(identityId, record);
  } else {
    pendingId = `reticulum-pending-${Date.now()}`;
    record = {
      id: pendingId,
      from: selfNodeId >>> 0,
      senderName,
      to: toNodeId,
      payload: text,
      channelIndex,
      timestamp: Date.now(),
      status: 'sending',
      receivedVia,
      ...replyFields,
    };
    addMessage(identityId, record);
  }
  if (senderHash) {
    persistReticulumOutboundRecord(identityId, record, senderHash, senderName, destHash, 'sending');
  }
  void send(text, destHash, replyTo ?? undefined, pendingId, replyPreviewText).catch(
    (e: unknown) => {
      const err = errLikeToLogString(e);
      if (err.includes('no_propagation_node')) {
        onNoPropagationNode();
      }
      console.warn('[useSendMessage] reticulum send failed ' + err);
    },
  );
  return true;
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
        console.warn('[useSendMessage] no handle for', identityId);
        return;
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

      void identity.protocol
        .sendMessage(handle, {
          text: wireText,
          channelIndex,
          destination,
          destinationPubKey,
          replyTo,
        })
        .then((res) => {
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
        })
        .catch((e: unknown) => {
          const errMsg = errLikeToLogString(e);
          console.warn('[useSendMessage] send failed ' + errMsg);
          updateMessageStatus(identityId, provisionalId, 'failed', errMsg);
          if (identity.protocol.type === 'meshcore') {
            persistMeshcoreOutboundRow(record, myNodeNum, meshcoreSenderName, 'failed');
          }
          if (isMeshtastic && meshtasticTempPacketId != null) {
            void window.electronAPI.db
              .updateMessageStatus(meshtasticTempPacketId, 'failed', errMsg)
              .catch((dbErr: unknown) => {
                console.debug(
                  '[useSendMessage] updateMessageStatus failed ' + errLikeToLogString(dbErr),
                );
              });
          }
        });
    },
    [identityId, addToast, t],
  );
}
