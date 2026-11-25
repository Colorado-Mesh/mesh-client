/**
 * Room BBS wire routing (RF-only SendTxtMsg path).
 *
 * **Wire vs Chat:** Channel/DM chat uses companion text with optional `Sender:` prefix,
 * keyless `@[Name]` replies/tapbacks, and (Radio toggle) MeshCore Open keyed/`r:`/`g:` wire
 * — see `meshcoreChannelText.ts` + `meshcoreOpenReaction.ts`. Room BBS is a separate stack:
 * outbound `TXT_TYPE_PLAIN` (raw UTF-8, optional mesh-client `[i/N]` chunks); inbound user
 * posts are `SignedPlain` (4-byte author pubkey prefix + body, stripped here). System/bot
 * lines may arrive as Plain without a strip. Room posts do not carry `replyId` / tapback
 * metadata; ingest does not run bracket parent lookup or `meshcorePromoteEmojiOnlyReplyToTapback`.
 *
 * **Protocol alignment:** Prefer keeping room and chat behavior consistent where the room-server
 * firmware allows it (dedup skew windows, timestamp clamping, display sanitization). Do not
 * paste chat-only wire (`@[Name#key]`, `r:HASH:INDEX`) into room outbound send unless the
 * official room protocol documents the same shape — other clients would show raw text. Inbound
 * `g:` / `@[…]` in room bodies may still render via `ChatPayloadText` (display-only).
 *
 * **Dedup:** Room duplicates use `meshcoreRoomPostMatch` (not tapback echo or cross-transport
 * channel dedup). MQTT does not carry room traffic.
 */
import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '@/renderer/hooks/meshcore/meshcoreHookPreamble';
import { MESHCORE_CONTACT_TYPE_ROOM } from '@/shared/meshcoreContactHwLabels';

import {
  MESHCORE_TXT_TYPE_SIGNED_PLAIN,
  parseMeshcoreRoomPostPayload,
} from './meshcoreChannelText';
import { sanitizeMeshcoreChatWireText } from './meshcoreUtils';

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

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const DELETE = 0x7f;
const C1_CONTROL_MAX = 0x9f;

/**
 * True when one of the first four characters can only be a raw author key byte. A SignedPlain
 * prefix that arrives without txtType 2 has been UTF-8 decoded, so its bytes show as U+FFFD or
 * as control characters (tab, line feed and carriage return excepted), and real text never
 * starts with those. Letters in any script, emoji and a short first line are text.
 */
export function looksLikeSignedPlainWirePrefix(wireText: string): boolean {
  if (wireText.length <= 4) return false;
  for (let i = 0; i < 4; i++) {
    if (isRawKeyByteChar(wireText.charCodeAt(i))) return true;
  }
  return false;
}

function isRawKeyByteChar(code: number): boolean {
  if (code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN) return false;
  return (
    code === REPLACEMENT_CHAR ||
    code < PRINTABLE_ASCII_MIN ||
    (code >= DELETE && code <= C1_CONTROL_MAX)
  );
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

/**
 * A room line with no author prefix (a PLAIN line such as "Bot Stats (24h):") is written by the
 * room server itself, so the room is its author. Ingest stores it that way and the live decoder
 * keys it the same way, so a reload builds the same id.
 */
export function isMeshcoreRoomOwnLine(
  wireText: string,
  txtType: number | undefined,
  isKnownRoomNode?: boolean,
): boolean {
  return (
    txtType !== MESHCORE_TXT_TYPE_SIGNED_PLAIN &&
    !shouldStripRoomPostAuthorPrefix(wireText, txtType, isKnownRoomNode)
  );
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

/**
 * Store id of a room post, for live posts, own posts and rows read back from SQLite alike. It
 * ends with the post's body as stored (author prefix removed, wire padding cleaned), so two
 * different posts in the same second keep two rows, while the same post delivered again (the
 * waiting-queue drain, a room resending its history, after a restart) keeps one id.
 */
export function meshcoreRoomMessageId(
  roomServerId: number,
  senderTimestampSec: number,
  authorId: number | undefined,
  body: string,
): string {
  if (authorId != null && authorId !== 0) {
    return `room:${roomServerId}:${authorId}:${senderTimestampSec}:${body}`;
  }
  return `room:${roomServerId}:${senderTimestampSec}:${body}`;
}
