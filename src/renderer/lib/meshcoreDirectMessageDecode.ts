import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '@/renderer/hooks/meshcore/meshcoreHookPreamble';

import { resolveMeshcoreNodeIdFromPubKeyPrefix } from './meshcore/meshcorePubKeyRegistry';
import {
  MESHCORE_TXT_TYPE_CLI_DATA,
  MESHCORE_TXT_TYPE_SIGNED_PLAIN,
  parseMeshcoreRoomPostPayload,
} from './meshcoreChannelText';
import { meshcoreRoomMessageId, meshcoreRoomWireLooksLikeRoom } from './meshcoreRoomMessageRouting';
import {
  isMeshcoreTransportStatusChatLine,
  meshcoreCompanionRxPathLenToHopCount,
  pubKeyPrefixHex,
} from './meshcoreUtils';
import { effectiveMessageTimestampMs } from './nodeStatus';
import type { DomainEvent } from './protocols/Protocol';

export interface DecodeMeshcoreDirectMessageInput {
  pubKeyPrefix: Uint8Array;
  text: string;
  senderTimestamp: number;
  txtType?: number;
  /** Companion ContactMsgRecv / waiting-message pathLen (0xFF = direct). */
  pathLen?: number;
}

function decodeTransportStatusDeviceLog(text: string): DomainEvent[] {
  const line = text.length > 220 ? `${text.slice(0, 220)}…` : text;
  return [
    {
      type: 'device_log',
      payload: {
        message: line,
        time: Date.now(),
        source: 'meshcore',
        level: 0,
      },
    },
  ];
}

function resolveRoomAuthorIdForMessageId(
  text: string,
  txtType: number | undefined,
  isKnownRoomNode: boolean,
  nodeIdByPrefix: Map<string, number>,
): number | undefined {
  const shouldParseAuthor =
    txtType === MESHCORE_TXT_TYPE_SIGNED_PLAIN || (isKnownRoomNode && text.length > 4);
  if (!shouldParseAuthor) return undefined;
  const authorId = parseMeshcoreRoomPostPayload(text, nodeIdByPrefix).authorId;
  return authorId !== 0 ? authorId : undefined;
}

function resolveSenderIdFromPrefix(prefix: string, nodeIdByPrefix: Map<string, number>): number {
  const known = nodeIdByPrefix.get(prefix) ?? 0;
  if (known !== 0) return known;
  const resolved = resolveMeshcoreNodeIdFromPubKeyPrefix(prefix) ?? 0;
  if (resolved !== 0) {
    nodeIdByPrefix.set(prefix, resolved);
  }
  return resolved;
}

/** Shared DM/room decode for MeshCoreProtocol.subscribe and event-131 waiting-message ingest. */
export function decodeMeshcoreDirectMessageEvents(
  raw: DecodeMeshcoreDirectMessageInput,
  nodeIdByPrefix: Map<string, number>,
  roomNodeIds: ReadonlySet<number>,
): DomainEvent[] {
  if (raw.txtType === MESHCORE_TXT_TYPE_CLI_DATA) {
    const cliPrefix = pubKeyPrefixHex(raw.pubKeyPrefix);
    return [
      {
        type: 'meshcore_cli_response',
        payload: {
          text: raw.text,
          senderNodeId: resolveSenderIdFromPrefix(cliPrefix, nodeIdByPrefix),
          pubKeyPrefixHex: cliPrefix,
        },
      },
    ];
  }
  if (isMeshcoreTransportStatusChatLine(raw.text)) {
    return decodeTransportStatusDeviceLog(raw.text);
  }
  const prefix = pubKeyPrefixHex(raw.pubKeyPrefix);
  const senderId = resolveSenderIdFromPrefix(prefix, nodeIdByPrefix);
  const isSignedPlain = raw.txtType === MESHCORE_TXT_TYPE_SIGNED_PLAIN;
  if (isSignedPlain && senderId !== 0) {
    (roomNodeIds as Set<number>).add(senderId);
  }
  const isKnownRoomNode = senderId !== 0 && roomNodeIds.has(senderId);
  const isRoomWire = meshcoreRoomWireLooksLikeRoom({
    txtType: raw.txtType,
    senderNodeId: senderId,
    isKnownRoomNode,
  });
  const roomServerId = isRoomWire && senderId !== 0 ? senderId : undefined;
  const authorIdForId =
    roomServerId != null
      ? resolveRoomAuthorIdForMessageId(raw.text, raw.txtType, isKnownRoomNode, nodeIdByPrefix)
      : undefined;
  const hopCount = meshcoreCompanionRxPathLenToHopCount(raw.pathLen);
  return [
    {
      type: 'text_message',
      payload: {
        id:
          roomServerId != null
            ? meshcoreRoomMessageId(roomServerId, raw.senderTimestamp, authorIdForId)
            : `${senderId}:${raw.senderTimestamp}`,
        from: senderId,
        to: 0,
        payload: raw.text,
        channelIndex: isRoomWire ? MESHCORE_ROOM_MESSAGE_CHANNEL : -1,
        timestamp: effectiveMessageTimestampMs(raw.senderTimestamp * 1000),
        ...(hopCount != null ? { hopCount } : {}),
        ...(raw.txtType != null ? { txtType: raw.txtType } : {}),
        ...(roomServerId != null ? { roomServerId } : {}),
      },
    },
  ];
}

/** Route a queued contactMessage (event 131) through PacketRouter when identity is bound. */
export function dispatchMeshcoreWaitingContactMessage(
  identityId: string,
  contactMessage: DecodeMeshcoreDirectMessageInput,
  nodeIdByPrefix: Map<string, number>,
  roomNodeIds: ReadonlySet<number>,
  dispatch: (event: DomainEvent, identityId: string) => void,
  onDeviceLog?: (line: string) => void,
): void {
  for (const event of decodeMeshcoreDirectMessageEvents(
    contactMessage,
    nodeIdByPrefix,
    roomNodeIds,
  )) {
    if (event.type === 'device_log') {
      onDeviceLog?.(event.payload.message);
      continue;
    }
    dispatch(event, identityId);
  }
}
