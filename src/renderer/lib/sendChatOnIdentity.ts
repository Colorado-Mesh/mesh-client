import type { Connection } from '@liamcottle/meshcore.js';

import { messageToDbRow } from '../hooks/meshcore/meshcoreHookPreamble';
import { getConnection } from '../stores/connectionStore';
import { type IdentityRecord, useIdentityStore } from '../stores/identityStore';
import {
  addMessage,
  type MessageRecord,
  renameMessageId,
  updateMessageStatus,
} from '../stores/messageStore';
import { type NodeRecord, upsertNodeRecord, useNodeStore } from '../stores/nodeStore';
import { isMeshcoreOpenWireCompatEnabled } from './appSettingsStorage';
import { withMeshtasticChannelIdentity } from './channelIdentity';
import { nextChatReceivedAt } from './chatReceiveOrder';
import { CHAT_SEND_ERROR_DEST_KEY_KEY } from './chatSendErrorI18n';
import { connectionDriver } from './drivers/ConnectionDriver';
import { errLikeToLogString } from './errLikeToLogString';
import { markOutboundBlocked } from './markOutboundBlocked';
import { meshcomCallForNodeId } from './meshcom/meshcomCallRegistry';
import { meshcomOutboundDest } from './meshcom/meshcomChannel';
import { meshcomTransportSupportsDmDeliveryAck } from './meshcom/meshcomDmDeliveryAck';
import { meshcomPersistIdentityId } from './meshcom/meshcomPersistIdentity';
import { scheduleMeshcomDmAckTimeout } from './meshcom/meshcomRoutingAckSideEffects';
import {
  applyMeshcomSelfCallsign,
  meshcomCallsignFromDeviceHandle,
} from './meshcom/meshcomSelfCallsign';
import {
  clearHeardRepeatWindowIfMessage,
  openHeardRepeatWindow,
} from './meshcore/heardRepeatTracker';
import { maybeRequestMeshcoreAutoOffloadForError } from './meshcore/meshcoreContactCapacityPush';
import { resolveMeshcoreDestinationPubKeyForIdentity } from './meshcore/meshcoreDestinationPubKey';
import { resolveMeshcoreDmDestinationPubKeyAsync } from './meshcore/meshcoreDmSend';
import {
  isMeshcoreTcpOpenHopDeadAccepted,
  trackMeshcoreTcpUserTxSend,
} from './meshcore/meshcoreTcpInitBurst';
import { resolveMeshcoreOutboundWireText } from './meshcoreChannelText';
import { scheduleMeshcoreDmAckPending } from './meshcoreDmAckDelivery';
import { nextMeshcoreMessageLocalOrder } from './meshcoreMessageOrder';
import { isMeshcoreNotFoundError, isMeshcoreTableFullError } from './meshcoreRadioErr';
import {
  addMeshcoreNodeContactToRadio,
  type MeshcoreRoomLoginPathSyncConn,
} from './meshcoreRoomLoginPathSync';
import { listChatMessagesFromStore } from './meshcoreStoreDedup';
import type { SendResult } from './protocols/Protocol';
import { useRelayCoverageStore } from './relayCoverage/relayCoverageStore';
import { sendReticulumChatMessage } from './reticulum/sendReticulumChatMessage';
import { tryGetMeshcoreSession } from './sessions/meshcoreSession';
import { tryGetMeshtasticSession } from './sessions/meshtasticSession';
import { messageRecordToChatMessage, nodeRecordToMeshNode } from './storeRecordAdapters';
import type { IdentityId } from './types';

/** The identity's known nodes; either level of the lookup can miss. */
function nodesOf(identityId: IdentityId): Record<number, NodeRecord | undefined> | undefined {
  return useNodeStore.getState().nodes[identityId];
}

function persistMeshcoreOutboundRow(
  record: MessageRecord,
  myNodeNum: number,
  senderName: string,
  status: 'sending' | 'acked' | 'failed' | 'blocked',
  packetId?: number,
): void {
  const chat = messageRecordToChatMessage({ ...record, status });
  chat.sender_id = myNodeNum;
  chat.sender_name = senderName;
  if (packetId != null) chat.packetId = packetId;
  if (record.to !== 0xffffffff) chat.to = record.to;
  void window.electronAPI.db
    .saveMeshcoreMessage(messageToDbRow(chat, myNodeNum))
    .catch((e: unknown) => {
      console.warn('mcL1119 [useSendMessage] saveMeshcoreMessage failed ' + errLikeToLogString(e));
    });
}

function meshcomCallForOutboundNode(identityId: IdentityId, nodeId: number | undefined): string {
  if (nodeId == null || nodeId === 0 || nodeId === 0xffffffff) return '';
  const fromRegistry = meshcomCallForNodeId(nodeId);
  if (fromRegistry) return fromRegistry;
  const longName = nodesOf(identityId)?.[nodeId]?.longName?.trim();
  return longName || '';
}

function persistMeshcomOutboundRow(
  identityId: IdentityId,
  record: MessageRecord,
  myNodeNum: number,
  status: 'sending' | 'acked' | 'failed',
  msgId?: string,
): void {
  const fromCall =
    meshcomCallForOutboundNode(identityId, myNodeNum) ||
    meshcomCallForOutboundNode(identityId, record.from) ||
    null;
  const toCallOrGroup =
    record.channelIndex > 0
      ? meshcomOutboundDest({ channelIndex: record.channelIndex })
      : record.to !== 0xffffffff
        ? meshcomCallForOutboundNode(identityId, record.to) || null
        : '*';
  void window.electronAPI.db
    .saveMeshcomMessage({
      // Stable offline slot — session ids can be ephemeral across rematch/restart.
      identity_id: meshcomPersistIdentityId(),
      msg_id: msgId ?? record.id,
      from_call: fromCall,
      to_call_or_group: toCallOrGroup,
      text: record.payload,
      channel_idx: record.channelIndex,
      // MeshCom DB only accepts rf|mqtt|both — outbound RF chat is 'rf' (not 'local').
      received_via: 'rf',
      timestamp: record.timestamp,
      status,
      received_at: record.receivedAt ?? Date.now(),
    })
    .catch((e: unknown) => {
      console.warn('mcL1120 [useSendMessage] saveMeshcomMessage failed ' + errLikeToLogString(e));
    });
}

/**
 * MeshCore DMs with an expected ACK CRC stay `sending` until event 130 or the runtime
 * hop-ACK timer (hop-scaled floor applied in scheduleMeshcoreDmAckPendingImpl). Channel
 * floods and sends without a CRC are delivered when the companion accepts the frame.
 * Returns true when the row is waiting on that tracker.
 */
function settleMeshcoreOutboundAfterCompanionAccept(opts: {
  identityId: IdentityId;
  resolvedId: string;
  record: MessageRecord;
  myNodeNum: number;
  senderName: string;
  packetId?: number;
  estTimeoutMs?: number;
  isDm: boolean;
  destination?: number;
}): boolean {
  const packetIdU32 = opts.packetId != null ? opts.packetId >>> 0 : undefined;
  if (opts.isDm && packetIdU32 != null) {
    persistMeshcoreOutboundRow(
      { ...opts.record, id: opts.resolvedId, status: 'sending' },
      opts.myNodeNum,
      opts.senderName,
      'sending',
      packetIdU32,
    );
    const scheduled = scheduleMeshcoreDmAckPending({
      identityId: opts.identityId,
      ackKeyU32: packetIdU32,
      // Runtime owns hop-scaled floor via computeMeshcoreDmAckWaitMs.
      estTimeoutMs: opts.estTimeoutMs ?? 0,
      destNodeId: opts.destination,
    });
    if (!scheduled) {
      console.warn(
        'mcL1121 [useSendMessage] MeshCore DM hop-ACK tracker is not registered; message stays pending',
      );
    }
    return true;
  }
  updateMessageStatus(opts.identityId, opts.resolvedId, 'acked');
  persistMeshcoreOutboundRow(
    { ...opts.record, id: opts.resolvedId, status: 'acked' },
    opts.myNodeNum,
    opts.senderName,
    'acked',
    packetIdU32,
  );
  return false;
}

function trySendViaMeshtasticSession(
  identityId: IdentityId,
  handle: unknown,
  text: string,
  channelIndex: number,
  destination: number | undefined,
  replyTo: string | undefined,
): { handled: boolean; messageId?: string } {
  const session = tryGetMeshtasticSession();
  if (!session) return { handled: false };
  const mqttStatus = getConnection(identityId)?.mqttStatus ?? 'disconnected';
  const hasMqtt = mqttStatus === 'connected';
  if (!handle && !hasMqtt) {
    console.warn('mcL1122 [useSendMessage] no handle and MQTT disconnected for', identityId);
    return { handled: true };
  }
  const replyIdNum = replyTo != null && replyTo !== '' ? Number.parseInt(replyTo, 10) : undefined;
  const messageId = session.sendChatMessage(
    text,
    channelIndex,
    destination,
    replyIdNum != null && !Number.isNaN(replyIdNum) ? replyIdNum : undefined,
  );
  return { handled: true, ...(messageId != null ? { messageId } : {}) };
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

/** What to send: the same arguments the Chat composer passes. */
export interface ChatSendRequest {
  text: string;
  channelIndex: number;
  /** Node to send a direct message to; omit for a channel message. */
  destination?: number;
  /** Store id of the message being replied to. */
  replyTo?: string;
  /** Store id of the failed message this send retries (Reticulum re-keys it). */
  retryOfStoreId?: string;
}

/** Problems the caller may want to show; the Chat hook turns them into toasts. */
export interface ChatSendNotices {
  onNoPropagationNode?: () => void;
  onMissingLxmfDelivery?: () => void;
}

/**
 * Send one chat message on an identity through the normal path for its protocol: the message
 * is added to the store as `sending`, persisted, tracked for its ack, and picked up by automatic
 * resend, exactly as a message typed in Chat. Usable outside React (the TAK relay sends through
 * it). Returns the provisional store id, or undefined when nothing was sent.
 */
export function sendChatOnIdentity(
  identityId: IdentityId,
  request: ChatSendRequest,
  notices: ChatSendNotices = {},
): string | undefined {
  const { text, channelIndex, destination, replyTo, retryOfStoreId } = request;
  // A lookup by id can miss (identity removed mid-send), whatever the record type says.
  const identity = useIdentityStore.getState().identities[identityId] as IdentityRecord | undefined;
  if (!identity) {
    console.warn('mcL1123 [useSendMessage] no identity for', identityId);
    return;
  }
  // Reticulum: sidecar LXMF send (no ConnectionDriver handle).
  if (identity.protocol.type === 'reticulum') {
    return (
      sendReticulumChatMessage({
        identityId,
        text,
        channelIndex,
        destination,
        replyTo,
        retryOfStoreId,
        onNoPropagationNode: () => {
          notices.onNoPropagationNode?.();
        },
        onMissingLxmfDelivery: () => {
          notices.onMissingLxmfDelivery?.();
        },
      }) ?? undefined
    );
  }

  const handle = connectionDriver.getHandle(identityId);

  // Meshtastic: runtime TransportManager sends RF + MQTT concurrently (hybrid or MQTT-only).
  if (identity.protocol.type === 'meshtastic') {
    const viaSession = trySendViaMeshtasticSession(
      identityId,
      handle,
      text,
      channelIndex,
      destination,
      replyTo,
    );
    if (viaSession.handled) {
      return viaSession.messageId;
    }
    if (!handle) {
      console.warn('mcL1124 [useSendMessage] Meshtastic runtime not mounted and no RF handle');
      return;
    }
  }

  if (!handle) {
    // OpenHop dead bridge may still send via quiet reopen (handle recreated on open).
    if (!(identity.protocol.type === 'meshcore' && isMeshcoreTcpOpenHopDeadAccepted())) {
      console.warn('mcL1125 [useSendMessage] no handle for', identityId);
      return;
    }
  }

  const isMeshtastic = identity.protocol.type === 'meshtastic';
  const isMeshcom = identity.protocol.type === 'meshcom';
  const isMeshcoreDm = identity.protocol.type === 'meshcore' && destination != null;
  const isMeshcomDm = isMeshcom && destination != null;
  const { provisionalId, meshtasticTempPacketId } = allocateOutboundProvisionalId(
    isMeshtastic,
    isMeshcoreDm,
  );
  let myNodeNum = getConnection(identityId)?.myNodeNum ?? 0;
  let meshcomSenderName: string | undefined;
  // MeshCom self callsign can arrive after link-up; stamp from handle when myNodeNum is still 0
  // so the first bubble is not left/"00".
  if (isMeshcom && myNodeNum === 0) {
    const fromHandle = meshcomCallsignFromDeviceHandle(handle);
    if (fromHandle.callsign) {
      myNodeNum = applyMeshcomSelfCallsign(identityId, fromHandle.callsign, {
        operatorName: fromHandle.operatorName,
      });
      meshcomSenderName = fromHandle.callsign;
    }
  } else if (isMeshcom && myNodeNum > 0) {
    meshcomSenderName =
      meshcomCallForNodeId(myNodeNum) ||
      nodesOf(identityId)?.[myNodeNum]?.longName?.trim() ||
      undefined;
  }
  const meshcoreSenderName =
    identity.protocol.type === 'meshcore'
      ? nodesOf(identityId)?.[myNodeNum]?.longName?.trim() ||
        tryGetMeshcoreSession()?.getSelfName?.(myNodeNum)?.trim() ||
        'Me'
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
    // Incoming MeshCore @[Name] replies resolve against this live record.
    ...(isMeshcore ? { senderName: meshcoreSenderName } : {}),
    ...(isMeshcom && meshcomSenderName ? { senderName: meshcomSenderName } : {}),
    to: destination ?? 0xffffffff,
    payload: resolvedOutbound.displayPayload,
    channelIndex: isMeshcoreDm || isMeshcomDm ? -1 : channelIndex,
    ...(isMeshcoreDm ? { localOrder: nextMeshcoreMessageLocalOrder() } : {}),
    timestamp: Date.now(),
    // Taken here, not by the store, so every save of this row carries the receipt the live row
    // holds; it can run ahead of the stamp (a same-millisecond backlog, or a clock set back).
    receivedAt: nextChatReceivedAt(),
    status: 'sending' as const,
    replyTo,
  };
  addMessage(identityId, record);

  // MeshCore channel floods: Chat sends via this hook (not useMeshcoreRuntime).
  // Open the heard-repeat listen window on the provisional bubble id (renameMessageId
  // re-keys coverage if packetId later replaces it).
  if (isMeshcore && !isMeshcoreDm) {
    const radioName = tryGetMeshcoreSession()?.getSelfName?.(myNodeNum)?.trim();
    openHeardRepeatWindow(
      identityId,
      provisionalId,
      undefined,
      undefined,
      radioName
        ? {
            channelIndex,
            senderName: radioName,
            wireText: resolvedOutbound.wireText,
            sentAtSec: Math.floor(record.timestamp / 1000),
          }
        : undefined,
    );
  }

  const abandonMeshcoreHeardRepeat = (): void => {
    if (!(isMeshcore && !isMeshcoreDm)) return;
    clearHeardRepeatWindowIfMessage(identityId, provisionalId);
    useRelayCoverageStore.getState().remove(identityId, provisionalId);
  };

  if (isMeshtastic) {
    void window.electronAPI.db
      .saveMessage(withMeshtasticChannelIdentity(messageRecordToChatMessage(record)))
      .catch((e: unknown) => {
        console.debug('[useSendMessage] saveMessage failed ' + errLikeToLogString(e));
      });
  }
  if (isMeshcom) {
    persistMeshcomOutboundRow(identityId, record, myNodeNum, 'sending');
  }

  let destinationPubKey: Uint8Array | undefined;
  if (isMeshcoreDm) {
    destinationPubKey = resolveMeshcoreDestinationPubKeyForIdentity(identityId, destination);
  }

  const wireText = resolvedOutbound.wireText;

  const failMeshcoreDmNoKey = (): void => {
    console.warn('mcL1126 [useSendMessage] send blocked ' + CHAT_SEND_ERROR_DEST_KEY_KEY);
    markOutboundBlocked(identityId, provisionalId, CHAT_SEND_ERROR_DEST_KEY_KEY);
    persistMeshcoreOutboundRow(record, myNodeNum, meshcoreSenderName, 'blocked');
    abandonMeshcoreHeardRepeat();
  };

  /** Companion SendTxtMsg needs the contact on-radio; restore once on ERR_NOT_FOUND. */
  const sendMeshcoreProtocolMessage = async (
    sendHandle: unknown,
    key: Uint8Array,
  ): Promise<SendResult> => {
    const opts = {
      text: wireText,
      channelIndex,
      destination,
      destinationPubKey: key,
      replyTo,
    };
    try {
      return await identity.protocol.sendMessage(sendHandle, opts);
    } catch (e: unknown) {
      if (!isMeshcoreNotFoundError(e) || destination == null) {
        if (isMeshcoreTableFullError(e)) {
          maybeRequestMeshcoreAutoOffloadForError(e);
        }
        throw e;
      }
      const storeRecord = nodesOf(identityId)?.[destination];
      const nodeForRadio = storeRecord
        ? nodeRecordToMeshNode(storeRecord)
        : {
            long_name: '',
            hw_model: '',
            last_heard: 0,
            latitude: null as number | null,
            longitude: null as number | null,
          };
      try {
        await addMeshcoreNodeContactToRadio(
          sendHandle as MeshcoreRoomLoginPathSyncConn,
          key,
          nodeForRadio,
        );
      } catch (restoreErr: unknown) {
        maybeRequestMeshcoreAutoOffloadForError(
          restoreErr instanceof Error ? restoreErr.cause : restoreErr,
        );
        throw restoreErr;
      }
      upsertNodeRecord(identityId, { nodeId: destination, onRadio: true });
      return await identity.protocol.sendMessage(sendHandle, opts);
    }
  };

  const beginOutboundSend = (dmKey: Uint8Array | undefined): void => {
    if (isMeshcoreDm) {
      if (!dmKey) {
        failMeshcoreDmNoKey();
        return;
      }
      destinationPubKey = dmKey;
    }

    if (isMeshcore && isMeshcoreTcpOpenHopDeadAccepted()) {
      void (async () => {
        try {
          const applyOpenHopSendResult = (res: SendResult): void => {
            const resolvedId = res.packetId != null ? String(res.packetId >>> 0) : provisionalId;
            if (res.packetId != null && resolvedId !== provisionalId) {
              renameMessageId(identityId, provisionalId, resolvedId);
            }
            settleMeshcoreOutboundAfterCompanionAccept({
              identityId,
              resolvedId,
              record,
              myNodeNum,
              senderName: meshcoreSenderName,
              packetId: res.packetId,
              estTimeoutMs: res.estTimeoutMs,
              isDm: isMeshcoreDm,
              destination,
            });
          };
          const runTx = tryGetMeshcoreSession()?.runMeshcoreUserTxWithLiveTcp;
          if (!runTx) {
            await tryGetMeshcoreSession()?.ensureTcpLiveForUserTx?.();
            const liveHandle = connectionDriver.getHandle(identityId);
            if (!liveHandle) {
              throw new Error('MeshCore TCP live reopen produced no handle');
            }
            const sendPromise =
              isMeshcoreDm && dmKey
                ? sendMeshcoreProtocolMessage(liveHandle, dmKey)
                : identity.protocol.sendMessage(liveHandle, {
                    text: wireText,
                    channelIndex,
                    destination,
                    destinationPubKey: dmKey,
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
            if (isMeshcoreDm && dmKey) {
              return sendMeshcoreProtocolMessage(liveHandle, dmKey);
            }
            return identity.protocol.sendMessage(liveHandle, {
              text: wireText,
              channelIndex,
              destination,
              destinationPubKey: dmKey,
              replyTo,
            });
          });
          // Only after OpenHop retry loop resolves — not inside the parked op (latch-retry
          // may re-run the send; premature acked would stick if attempt 2 failed).
          applyOpenHopSendResult(res);
        } catch (e: unknown) {
          const errMsg = errLikeToLogString(e);
          console.warn('mcL1127 [useSendMessage] OpenHop live reopen failed ' + errMsg);
          updateMessageStatus(identityId, provisionalId, 'failed', errMsg);
          persistMeshcoreOutboundRow(record, myNodeNum, meshcoreSenderName, 'failed');
          abandonMeshcoreHeardRepeat();
        }
      })();
      return;
    }

    // Prefer a fresh driver handle so an async DM key lookup cannot reuse a stale capture.
    const liveHandle = connectionDriver.getHandle(identityId) ?? handle;
    if (!liveHandle) {
      console.warn('mcL1128 [useSendMessage] no handle for', identityId);
      abandonMeshcoreHeardRepeat();
      return;
    }

    finishSend(liveHandle, dmKey);
  };

  // getHandle() is `unknown`; NonNullable<unknown> is `unknown & {}` and trips
  // @typescript-eslint/no-generated-empty-object-type under typescript-eslint 8.70+.
  const finishSend = (sendHandle: unknown, dmKey?: Uint8Array): void => {
    const sendPromise =
      isMeshcoreDm && dmKey
        ? sendMeshcoreProtocolMessage(sendHandle, dmKey)
        : identity.protocol.sendMessage(sendHandle, {
            text: wireText,
            // MeshCom DM: match the store row (-1). Chat may still pass the last GRC pill.
            channelIndex: isMeshcomDm ? -1 : channelIndex,
            destination,
            destinationPubKey: dmKey ?? destinationPubKey,
            replyTo,
          });
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

        if (identity.protocol.type === 'meshcore') {
          settleMeshcoreOutboundAfterCompanionAccept({
            identityId,
            resolvedId,
            record,
            myNodeNum,
            senderName: meshcoreSenderName,
            packetId: res.packetId,
            estTimeoutMs: res.estTimeoutMs,
            isDm: isMeshcoreDm,
            destination,
          });
        } else if (isMeshcom) {
          // ALL / GRC: treat wire accept as delivered. DMs wait for OTA ACK
          // (meshcomRoutingAckSideEffects) with a FAQ-aligned timeout.
          if (isMeshcomDm) {
            const meshcomTransport = getConnection(identityId)?.connectionType;
            if (meshcomTransportSupportsDmDeliveryAck(meshcomTransport)) {
              persistMeshcomOutboundRow(
                identityId,
                { ...record, id: resolvedId, status: 'sending' },
                myNodeNum,
                'sending',
                resolvedId,
              );
              scheduleMeshcomDmAckTimeout(identityId, resolvedId);
            } else {
              updateMessageStatus(identityId, resolvedId, 'acked');
              persistMeshcomOutboundRow(
                identityId,
                { ...record, id: resolvedId },
                myNodeNum,
                'acked',
                resolvedId,
              );
            }
          } else {
            updateMessageStatus(identityId, resolvedId, 'acked');
            persistMeshcomOutboundRow(
              identityId,
              { ...record, id: resolvedId },
              myNodeNum,
              'acked',
              resolvedId,
            );
          }
        } else {
          updateMessageStatus(identityId, resolvedId, 'acked');
        }
        if (isMeshtastic && meshtasticTempPacketId != null) {
          const rowPacketId = res.packetId ?? meshtasticTempPacketId;
          void window.electronAPI.db
            .updateMessageStatus(rowPacketId, 'acked')
            .catch((e: unknown) => {
              console.debug('[useSendMessage] updateMessageStatus failed ' + errLikeToLogString(e));
            });
        }
      },
      (e: unknown) => {
        const errMsg = errLikeToLogString(e);
        console.warn('mcL1129 [useSendMessage] send failed ' + errMsg);
        updateMessageStatus(identityId, provisionalId, 'failed', errMsg);
        if (identity.protocol.type === 'meshcore') {
          persistMeshcoreOutboundRow(record, myNodeNum, meshcoreSenderName, 'failed');
        }
        if (isMeshcom) {
          persistMeshcomOutboundRow(identityId, record, myNodeNum, 'failed');
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

  if (isMeshcoreDm && !destinationPubKey) {
    void (async () => {
      const lookupHandle =
        (handle as Connection | null | undefined) ??
        (connectionDriver.getHandle(identityId) as Connection | null | undefined);
      const key = await resolveMeshcoreDmDestinationPubKeyAsync(
        identityId,
        destination,
        nodesOf(identityId)?.[destination],
        { conn: lookupHandle },
      );
      // Re-read after the async lookup so a reconnect mid-wait is not short-circuited by
      // the earlier captured handle (beginOutboundSend also prefers a fresh getHandle).
      beginOutboundSend(key);
    })();
    return provisionalId;
  }

  beginOutboundSend(destinationPubKey);
  return provisionalId;
}
