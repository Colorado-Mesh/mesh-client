import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '@/renderer/hooks/meshcore/meshcoreHookPreamble';

import {
  MESHCORE_TXT_TYPE_SIGNED_PLAIN,
  parseMeshcoreRoomPostPayload,
} from './meshcoreChannelText';
import { sanitizeMeshcoreChatWireText } from './meshcoreUtils';

/** MeshCore contact type for room BBS servers. */
export const MESHCORE_CONTACT_TYPE_ROOM = 3;

const PRINTABLE_ASCII_MIN = 32;
const PRINTABLE_ASCII_MAX = 126;
const REPLACEMENT_CHAR = 0xfffd;

/** PLAIN room-server system lines (e.g. Bot Stats) are readable ASCII from byte 0. */
export function looksLikeRoomPlainSystemLine(wireText: string): boolean {
  if (wireText.length <= 4) return true;
  for (let i = 0; i < 4; i++) {
    const code = wireText.charCodeAt(i);
    if (code < PRINTABLE_ASCII_MIN || code > PRINTABLE_ASCII_MAX) {
      return false;
    }
  }
  return true;
}

/** SignedPlain author prefixes are raw pubkey bytes — often non-printable or U+FFFD. */
export function looksLikeSignedPlainWirePrefix(wireText: string): boolean {
  if (wireText.length <= 4) return false;
  for (let i = 0; i < 4; i++) {
    const code = wireText.charCodeAt(i);
    if (code === REPLACEMENT_CHAR || code < PRINTABLE_ASCII_MIN || code > PRINTABLE_ASCII_MAX) {
      return true;
    }
  }
  return false;
}

export function shouldStripRoomPostAuthorPrefix(
  wireText: string,
  txtType: number | undefined,
  isKnownRoomNode?: boolean,
): boolean {
  if (wireText.length <= 4) return false;
  if (txtType === MESHCORE_TXT_TYPE_SIGNED_PLAIN) return true;
  if (looksLikeRoomPlainSystemLine(wireText)) return false;
  if (isKnownRoomNode && looksLikeSignedPlainWirePrefix(wireText)) return true;
  return false;
}

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
  opts?: { isKnownRoomNode?: boolean },
): { authorId: number; payload: string } {
  if (shouldStripRoomPostAuthorPrefix(wireText, txtType, opts?.isKnownRoomNode)) {
    const { authorId, payload } = parseMeshcoreRoomPostPayload(wireText, pubKeyPrefixToNodeId);
    return { authorId, payload: sanitizeMeshcoreChatWireText(payload) };
  }
  return { authorId: 0, payload: sanitizeMeshcoreChatWireText(wireText) };
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
