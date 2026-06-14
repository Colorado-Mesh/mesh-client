import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '@/renderer/hooks/meshcore/meshcoreHookPreamble';

import {
  MESHCORE_TXT_TYPE_SIGNED_PLAIN,
  parseMeshcoreRoomPostPayload,
} from './meshcoreChannelText';

/** MeshCore contact type for room BBS servers. */
export const MESHCORE_CONTACT_TYPE_ROOM = 3;

export function isMeshcoreRoomServerHwModel(hwModel: string | undefined): boolean {
  return hwModel === 'Room';
}

export function isMeshcoreRoomServerContactType(contactType: number | undefined): boolean {
  return contactType === MESHCORE_CONTACT_TYPE_ROOM;
}

export function meshcoreRoomWireLooksLikeRoom(opts: {
  txtType?: number;
  roomServerId?: number;
  channelIndex?: number;
  messageId?: string;
  senderNodeId?: number;
  isKnownRoomNode?: boolean;
}): boolean {
  if (opts.txtType === MESHCORE_TXT_TYPE_SIGNED_PLAIN) return true;
  if (opts.roomServerId != null && opts.roomServerId !== 0) return true;
  if (opts.channelIndex === MESHCORE_ROOM_MESSAGE_CHANNEL) return true;
  if (opts.messageId?.startsWith('room:')) return true;
  if (opts.isKnownRoomNode && opts.senderNodeId != null && opts.senderNodeId !== 0) return true;
  return false;
}

export function meshcoreRoomPostBodyFromWire(
  wireText: string,
  txtType: number | undefined,
  pubKeyPrefixToNodeId: Map<string, number>,
): { authorId: number; payload: string } {
  if (txtType === MESHCORE_TXT_TYPE_SIGNED_PLAIN) {
    return parseMeshcoreRoomPostPayload(wireText, pubKeyPrefixToNodeId);
  }
  return { authorId: 0, payload: wireText };
}

export function meshcoreRoomMessageId(
  roomServerId: number,
  senderTimestampSec: number,
  authorId?: number,
): string {
  if (authorId != null && authorId !== 0) {
    return `room:${roomServerId}:${authorId}:${senderTimestampSec}`;
  }
  return `room:${roomServerId}:${senderTimestampSec}`;
}
