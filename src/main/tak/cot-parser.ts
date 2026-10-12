import type { TAKContact, TAKContactSource } from '../../shared/tak-types';
import {
  TAK_GEOCHAT_CALLSIGN_MAX_LEN,
  TAK_GEOCHAT_ROOM_MAX_LEN,
  TAK_GEOCHAT_TEXT_MAX_LEN,
} from '../../shared/tak-types';
import { MS_PER_SECOND } from '../../shared/timeConstants';
import { COT_PING_TYPE, COT_STALE_MS, COT_UID_PREFIXES } from './cot-converter';

/** Drop a partial event that grows past this; a sane CoT event is a few KB. */
export const COT_FRAME_MAX_BYTES = 64 * 1024;
/** Clamp the sender's stale window so a bogus `stale` neither hides nor pins a contact. */
const MIN_STALE_WINDOW_MS = 30 * MS_PER_SECOND;
const MAX_STALE_WINDOW_MS = 24 * 60 * 60 * MS_PER_SECOND;
const MAX_UID_LENGTH = 128;
const MAX_TYPE_LENGTH = 64;
const MAX_CALLSIGN_LENGTH = 64;
const MAX_GROUP_LENGTH = 64;
const MAX_REMARKS_LENGTH = 500;
/** ATAK writes this for an unknown height or error. */
const COT_UNKNOWN_VALUE = 9999999;

const EVENT_START_BYTES = Buffer.from('<event', 'ascii');
const EVENT_END_BYTES = Buffer.from('</event>', 'ascii');

export class CotFrameTooLargeError extends Error {
  readonly code = 'COT_FRAME_TOO_LARGE';

  constructor() {
    super(`CoT event exceeds ${COT_FRAME_MAX_BYTES} bytes`);
    this.name = 'CotFrameTooLargeError';
  }
}

function isEventStartBoundary(byte: number): boolean {
  return byte === 0x3e || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x20;
}

/**
 * Splits a TAK streaming connection (newline- or nothing-separated XML CoT) into complete
 * `<event>...</event>` strings. Decodes UTF-8 across chunk boundaries.
 */
export class CotFramer {
  private readonly frame = Buffer.allocUnsafe(COT_FRAME_MAX_BYTES);
  private frameLength = 0;
  private eventStartMatch = 0;
  private eventEndMatch = 0;

  push(chunk: Buffer | string): string[] {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    const frames: string[] = [];
    for (const byte of bytes) {
      if (this.frameLength === 0) {
        this.seekEventStart(byte);
        continue;
      }

      if (this.frameLength >= COT_FRAME_MAX_BYTES) {
        this.reset();
        throw new CotFrameTooLargeError();
      }
      this.frame[this.frameLength++] = byte;

      if (byte === EVENT_END_BYTES[this.eventEndMatch]) {
        this.eventEndMatch++;
      } else {
        this.eventEndMatch = byte === EVENT_END_BYTES[0] ? 1 : 0;
      }
      if (this.eventEndMatch !== EVENT_END_BYTES.length) continue;

      const rawFrame = this.frame.subarray(0, this.frameLength);
      const decodedFrame = rawFrame.toString('utf8');
      const decodedBytes = Buffer.byteLength(decodedFrame, 'utf8');
      this.reset();
      if (rawFrame.byteLength > COT_FRAME_MAX_BYTES || decodedBytes > COT_FRAME_MAX_BYTES) {
        throw new CotFrameTooLargeError();
      }
      frames.push(decodedFrame);
    }
    return frames;
  }

  private seekEventStart(byte: number): void {
    if (this.eventStartMatch < EVENT_START_BYTES.length) {
      if (byte === EVENT_START_BYTES[this.eventStartMatch]) {
        this.eventStartMatch++;
      } else {
        this.eventStartMatch = byte === EVENT_START_BYTES[0] ? 1 : 0;
      }
      return;
    }

    if (!isEventStartBoundary(byte)) {
      this.eventStartMatch = byte === EVENT_START_BYTES[0] ? 1 : 0;
      return;
    }

    EVENT_START_BYTES.copy(this.frame, 0);
    this.frame[EVENT_START_BYTES.length] = byte;
    this.frameLength = EVENT_START_BYTES.length + 1;
    this.eventStartMatch = 0;
    this.eventEndMatch = 0;
  }

  private reset(): void {
    this.frameLength = 0;
    this.eventStartMatch = 0;
    this.eventEndMatch = 0;
  }
}

function unescapeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

const OPEN_TAG = {
  event: /<event(?=[\s/>])[^>]*>/,
  point: /<point(?=[\s/>])[^>]*>/,
  contact: /<contact(?=[\s/>])[^>]*>/,
  group: /<__group(?=[\s/>])[^>]*>/,
  chat: /<__chat(?=[\s/>])[^>]*>/,
} as const;

const ATTR = {
  id: /\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/,
  uid: /\suid\s*=\s*(?:"([^"]*)"|'([^']*)')/,
  type: /\stype\s*=\s*(?:"([^"]*)"|'([^']*)')/,
  time: /\stime\s*=\s*(?:"([^"]*)"|'([^']*)')/,
  stale: /\sstale\s*=\s*(?:"([^"]*)"|'([^']*)')/,
  lat: /\slat\s*=\s*(?:"([^"]*)"|'([^']*)')/,
  lon: /\slon\s*=\s*(?:"([^"]*)"|'([^']*)')/,
  hae: /\shae\s*=\s*(?:"([^"]*)"|'([^']*)')/,
  callsign: /\scallsign\s*=\s*(?:"([^"]*)"|'([^']*)')/,
  name: /\sname\s*=\s*(?:"([^"]*)"|'([^']*)')/,
  role: /\srole\s*=\s*(?:"([^"]*)"|'([^']*)')/,
  chatroom: /\schatroom\s*=\s*(?:"([^"]*)"|'([^']*)')/,
  senderCallsign: /\ssenderCallsign\s*=\s*(?:"([^"]*)"|'([^']*)')/,
} as const;

function openTag(xml: string, name: keyof typeof OPEN_TAG): string | undefined {
  return OPEN_TAG[name].exec(xml)?.[0];
}

function attr(tag: string | undefined, name: keyof typeof ATTR): string | undefined {
  if (!tag) return undefined;
  const m = ATTR[name].exec(tag);
  if (!m) return undefined;
  return unescapeXml(m[1] ?? m[2] ?? '');
}

/** Text of the first `<remarks>` element, or undefined when absent or self-closing. */
function remarksText(xml: string): string | undefined {
  const start = /<remarks(?=[\s>])[^>]*>/.exec(xml);
  if (!start || start[0].endsWith('/>')) return undefined;
  const bodyStart = start.index + start[0].length;
  const end = xml.indexOf('</remarks>', bodyStart);
  return end < 0 ? undefined : unescapeXml(xml.slice(bodyStart, end));
}

function clip(text: string | undefined, max: number): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function staleWindowMs(time: string | undefined, stale: string | undefined): number {
  const t = time ? Date.parse(time) : NaN;
  const s = stale ? Date.parse(stale) : NaN;
  if (!Number.isFinite(t) || !Number.isFinite(s)) return COT_STALE_MS;
  return Math.min(Math.max(s - t, MIN_STALE_WINDOW_MS), MAX_STALE_WINDOW_MS);
}

/** True for a client keepalive ping (`t-x-c-t`), which a server answers with a pong. */
export function isCotPing(xml: string): boolean {
  return attr(openTag(xml, 'event'), 'type') === COT_PING_TYPE;
}

/** Units (`a-…`) and dropped map points (`b-m-p…`); pings, chat, tasking, deletes are not mapped. */
function isMappableType(type: string): boolean {
  return type.startsWith('a-') || type.startsWith('b-m-p');
}

/**
 * Parse one CoT event into a map contact. Returns null for events this app does not map, events
 * without a usable position, and our own mesh nodes echoed back by a server.
 */
export function parseCotEvent(
  xml: string,
  source: TAKContactSource,
  nowMs: number = Date.now(),
): TAKContact | null {
  const eventTag = openTag(xml, 'event');
  const uid = clip(attr(eventTag, 'uid'), MAX_UID_LENGTH);
  const type = clip(attr(eventTag, 'type'), MAX_TYPE_LENGTH);
  if (!uid || !type || !isMappableType(type)) return null;
  if (COT_UID_PREFIXES.some((prefix) => uid.startsWith(prefix))) return null;

  const pointTag = openTag(xml, 'point');
  const lat = Number(attr(pointTag, 'lat'));
  const lon = Number(attr(pointTag, 'lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  const haeRaw = Number(attr(pointTag, 'hae'));
  const hae = Number.isFinite(haeRaw) && haeRaw !== COT_UNKNOWN_VALUE ? haeRaw : undefined;

  const groupTag = openTag(xml, 'group');

  const contact: TAKContact = {
    uid,
    type,
    callsign: clip(attr(openTag(xml, 'contact'), 'callsign'), MAX_CALLSIGN_LENGTH) ?? uid,
    lat,
    lon,
    source,
    receivedAt: nowMs,
    staleAt: nowMs + staleWindowMs(attr(eventTag, 'time'), attr(eventTag, 'stale')),
  };
  if (hae !== undefined) contact.hae = hae;
  const group = clip(attr(groupTag, 'name'), MAX_GROUP_LENGTH);
  if (group) contact.group = group;
  const role = clip(attr(groupTag, 'role'), MAX_GROUP_LENGTH);
  if (role) contact.role = role;
  const remarks = clip(remarksText(xml), MAX_REMARKS_LENGTH);
  if (remarks) contact.remarks = remarks;
  return contact;
}

/** GeoChat message type; delivery (`b-t-f-d`) and read (`b-t-f-r`) receipts are not messages. */
const COT_GEOCHAT_TYPE = 'b-t-f';
/** Sender uid prefix this app writes on mirrored mesh messages (`geochatSenderUid`). */
const MESH_CHAT_UID_PREFIX = 'MESHCHAT-';
const CHAT_UID_RE = /^[A-Za-z0-9_.:@-]{1,128}$/;
const MAX_CHAT_ROOM_ID_LENGTH = 128;
const CHAT_MESSAGE_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const CONTROL_CHARS_GLOBAL_RE = /\p{Cc}+/gu;

/** One GeoChat message a TAK client sent. */
export interface CotGeochat {
  room: string;
  /** Empty when the event carried none; the caller falls back to the client's callsign. */
  senderCallsign: string;
  /** The uid the event claims as its sender; the server checks it against the connection. */
  senderUid: string;
  text: string;
  /** Message id from the event uid, when it has a usable one. */
  messageId?: string;
  /**
   * The conversation id: the recipient's uid for a direct message, otherwise usually the room
   * name. Lets the server recognise a message addressed to a room's contact.
   */
  roomId?: string;
}

/** Single line: control characters (newlines included) collapse to one space. */
function singleLine(text: string | undefined): string | undefined {
  return text?.replace(CONTROL_CHARS_GLOBAL_RE, ' ');
}

/**
 * Parse a GeoChat (`b-t-f`) event from a TAK client into the room, sender and text. The sender
 * uid is read only from the event uid, `GeoChat.<sender uid>.<room>.<message id>`, and is a
 * claim the server still has to check against the connection. Returns null for anything else,
 * for a message without a room, sender uid or text, and for this app's own mirrored mesh
 * messages.
 */
export function parseGeochatEvent(xml: string): CotGeochat | null {
  const eventTag = openTag(xml, 'event');
  if (attr(eventTag, 'type') !== COT_GEOCHAT_TYPE) return null;
  const chatTag = openTag(xml, 'chat');
  const room = clip(singleLine(attr(chatTag, 'chatroom')), TAK_GEOCHAT_ROOM_MAX_LEN);
  const text = clip(singleLine(remarksText(xml)), TAK_GEOCHAT_TEXT_MAX_LEN);
  if (!room || !text) return null;

  const uidParts = (attr(eventTag, 'uid') ?? '').split('.');
  const fromEventUid = uidParts[0] === 'GeoChat' && uidParts.length >= 4;
  const senderUid = fromEventUid ? (uidParts[1] ?? '') : '';
  if (!CHAT_UID_RE.test(senderUid)) return null;
  if (senderUid.startsWith(MESH_CHAT_UID_PREFIX)) return null;
  if (COT_UID_PREFIXES.some((prefix) => senderUid.startsWith(prefix))) return null;

  const chat: CotGeochat = {
    room,
    senderCallsign:
      clip(singleLine(attr(chatTag, 'senderCallsign')), TAK_GEOCHAT_CALLSIGN_MAX_LEN) ?? '',
    senderUid,
    text,
  };
  const roomId = singleLine(attr(chatTag, 'id'))?.trim();
  if (roomId && roomId.length <= MAX_CHAT_ROOM_ID_LENGTH) chat.roomId = roomId;
  const messageId = fromEventUid ? (uidParts[uidParts.length - 1] ?? '') : '';
  if (CHAT_MESSAGE_ID_RE.test(messageId)) chat.messageId = messageId;
  return chat;
}
