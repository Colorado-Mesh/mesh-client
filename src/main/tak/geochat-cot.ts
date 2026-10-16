import { randomUUID } from 'crypto';

import { isChannelIdentityKey } from '../../shared/channelIdentityKey';
import { isValidLatLon } from '../../shared/geoCoords';
import {
  TAK_CHAT_CHANNELS_MAX,
  TAK_CHAT_ROOM_UID_PREFIX,
  TAK_GEOCHAT_CALLSIGN_MAX_LEN,
  TAK_GEOCHAT_ROOM_MAX_LEN,
  TAK_GEOCHAT_TEXT_MAX_LEN,
  type TAKChannelChatMessage,
  type TakChatChannel,
  type TAKGeochatMessage,
} from '../../shared/tak-types';
import { escapeXml } from '../../shared/xmlEscape';

/** GeoChat messages stay in ATAK's history; stale only bounds how long servers relay them. */
const GEOCHAT_STALE_MS = 24 * 60 * 60 * 1000;
/** Point CoT uses for an unknown position. */
const UNKNOWN_ALTITUDE = 9999999;
/** Room names and callsigns are single-line labels. */
const CONTROL_CHARS_RE = /\p{Cc}/u;

/** FNV-1a, 32-bit, as eight hex digits: short and stable across restarts. */
function fnv1aHex(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Stable sender uid for a mesh callsign; ATAK groups a sender's messages by it. */
export function geochatSenderUid(callsign: string): string {
  return `MESHCHAT-${fnv1aHex(callsign)}`;
}

/**
 * Stable uid of the contact that stands for a served channel, from the channel's identity key:
 * a channel moved to another slot, or renamed in ATAK's eyes, keeps its contact and history.
 */
export function channelContactUid(channelKey: string): string {
  return `${TAK_CHAT_ROOM_UID_PREFIX}${fnv1aHex(channelKey)}`;
}

/** Validate the renderer's list of channels served to TAK clients. Throws when malformed. */
export function parseTakChatChannels(raw: unknown): TakChatChannel[] {
  const bad = (why: string) => new Error(`tak:setChatChannels: ${why}`);
  if (!Array.isArray(raw) || raw.length > TAK_CHAT_CHANNELS_MAX) {
    throw bad(`expected an array of at most ${TAK_CHAT_CHANNELS_MAX} channels`);
  }
  const byKey = new Map<string, TakChatChannel>();
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== 'object') throw bad('each channel must be an object');
    const c = item as Record<string, unknown>;
    if (!isChannelIdentityKey(c.key)) throw bad('key must be a channel identity key');
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    if (!name || name.length > TAK_GEOCHAT_ROOM_MAX_LEN || CONTROL_CHARS_RE.test(name)) {
      throw bad(`name must be 1-${TAK_GEOCHAT_ROOM_MAX_LEN} printable characters`);
    }
    if (typeof c.send !== 'boolean' || typeof c.remote !== 'boolean') {
      throw bad('send and remote must be booleans');
    }
    byKey.set(c.key, { key: c.key, name, send: c.send, remote: c.remote });
  }
  return [...byKey.values()];
}

/** A TAK client the server can address: the uid and callsign from its own position report. */
export interface GeochatRecipient {
  uid: string;
  callsign: string;
}

/** How long a channel contact stays in ATAK without being announced again. */
export const CHAT_ROOM_CONTACT_STALE_MS = GEOCHAT_STALE_MS;

/** Sender name on notes the server itself writes into a channel's conversation. */
export const CHANNEL_NOTE_SENDER = 'mesh-client';

/**
 * The contact that stands for a served channel. ATAK only transmits chat to a contact it can
 * reach, and `endpoint="*:-1:stcp"` says this one is reached through the server connection, so
 * only a channel TAK clients may send to carries it: a receive-only channel offers no way to
 * type to it. A contact needs a point; a channel has no place, so it sits at 0, 0.
 */
export function buildChannelContactCot(
  channel: TakChatChannel,
  nowMs: number = Date.now(),
): string {
  const uid = escapeXml(channelContactUid(channel.key));
  const time = new Date(nowMs).toISOString();
  const stale = new Date(nowMs + CHAT_ROOM_CONTACT_STALE_MS).toISOString();
  const endpoint = channel.send ? ' endpoint="*:-1:stcp"' : '';
  return (
    `<event version="2.0" uid="${uid}" type="a-f-G-U-C" time="${time}" start="${time}"` +
    ` stale="${stale}" how="h-g-i-g-o">` +
    `<point lat="0" lon="0" hae="${UNKNOWN_ALTITUDE}" ce="9999999" le="9999999"/>` +
    `<detail>` +
    `<contact callsign="${escapeXml(channel.name)}"${endpoint}/>` +
    `<__group name="White" role="Team Member"/>` +
    `</detail>` +
    `</event>`
  );
}

/** One line in a channel's conversation: who said it, what, and when. */
export interface ChannelChatLine {
  senderCallsign: string;
  text: string;
  timeMs: number;
}

/**
 * One line on a served channel, as a direct message to `recipient` from the channel's contact.
 * ATAK files it under that contact, and a reply there comes back addressed to the contact's
 * uid, which names the channel. The original sender's name leads the text because every line
 * in the conversation comes from the same contact.
 */
export function buildChannelChatCot(
  channel: TakChatChannel,
  line: ChannelChatLine,
  recipient: GeochatRecipient,
  nowMs: number = Date.now(),
  messageId: string = randomUUID(),
): string {
  return geochatEvent(
    {
      room: channel.name,
      senderCallsign: line.senderCallsign,
      timeMs: line.timeMs,
      text: `${line.senderCallsign}: ${line.text}`,
    },
    channelContactUid(channel.key),
    channel.name,
    recipient.callsign,
    recipient.uid,
    nowMs,
    messageId,
  );
}

/** A trimmed single-line label of 1 to `max` characters; throws naming `field` otherwise. */
function label(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string') throw new Error(`tak:pushChatMessage: ${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || CONTROL_CHARS_RE.test(trimmed)) {
    throw new Error(`tak:pushChatMessage: ${field} must be 1-${max} printable characters`);
  }
  return trimmed;
}

/** Validate an untrusted heard channel message from the renderer. Throws when malformed. */
export function parseTakChannelChatMessage(raw: unknown): TAKChannelChatMessage {
  if (!raw || typeof raw !== 'object') {
    throw new Error('tak:pushChatMessage: message must be an object');
  }
  const m = raw as Record<string, unknown>;
  if (!isChannelIdentityKey(m.channelKey)) {
    throw new Error('tak:pushChatMessage: channelKey must be a channel identity key');
  }
  const channelKey = m.channelKey;
  const senderCallsign = label(m.senderCallsign, TAK_GEOCHAT_CALLSIGN_MAX_LEN, 'senderCallsign');
  if (typeof m.text !== 'string' || !m.text.trim() || m.text.length > TAK_GEOCHAT_TEXT_MAX_LEN) {
    throw new Error(`tak:pushChatMessage: text must be 1-${TAK_GEOCHAT_TEXT_MAX_LEN} characters`);
  }
  if (typeof m.timeMs !== 'number' || !Number.isFinite(m.timeMs) || m.timeMs <= 0) {
    throw new Error('tak:pushChatMessage: timeMs must be a positive number');
  }
  const msg: TAKChannelChatMessage = {
    channelKey,
    senderCallsign,
    text: m.text.trim(),
    timeMs: m.timeMs,
  };
  if (m.latitude != null || m.longitude != null) {
    if (
      typeof m.latitude !== 'number' ||
      typeof m.longitude !== 'number' ||
      !isValidLatLon(m.latitude, m.longitude)
    ) {
      throw new Error('tak:pushChatMessage: latitude/longitude must be a valid pair');
    }
    msg.latitude = m.latitude;
    msg.longitude = m.longitude;
  }
  return msg;
}

/**
 * Standard CoT v2.0 GeoChat (`b-t-f`) event for one message. `senderUid` is the sending device's
 * own uid when a TAK client's message is passed on to the other clients; a heard mesh message
 * has none, so its sender uid is derived from the callsign.
 */
export function buildGeochatCot(
  msg: TAKGeochatMessage,
  nowMs: number = Date.now(),
  messageId: string = randomUUID(),
  senderUid: string = geochatSenderUid(msg.senderCallsign),
): string {
  return geochatEvent(msg, senderUid, msg.senderCallsign, msg.room, msg.room, nowMs, messageId);
}

/**
 * The GeoChat event both builders share. `chatroom` is the conversation's display name and
 * `chatId` its id: the room name for a room, the recipient's uid for a direct message.
 */
function geochatEvent(
  msg: TAKGeochatMessage,
  senderUid: string,
  senderCallsign: string,
  chatroom: string,
  chatId: string,
  nowMs: number,
  messageId: string,
): string {
  const room = escapeXml(chatroom);
  const id = escapeXml(chatId);
  const sender = escapeXml(senderUid);
  const uid = escapeXml(`GeoChat.${senderUid}.${chatId}.${messageId}`);
  const time = new Date(nowMs).toISOString();
  const sentAt = new Date(Math.min(msg.timeMs, nowMs)).toISOString();
  const stale = new Date(nowMs + GEOCHAT_STALE_MS).toISOString();
  const known = msg.latitude != null && msg.longitude != null;
  const lat = known ? msg.latitude : 0;
  const lon = known ? msg.longitude : 0;

  return (
    `<event version="2.0" uid="${uid}" type="b-t-f" time="${time}" start="${time}"` +
    ` stale="${stale}" how="h-g-i-g-o">` +
    `<point lat="${lat}" lon="${lon}" hae="${UNKNOWN_ALTITUDE}" ce="9999999" le="9999999"/>` +
    `<detail>` +
    `<__chat parent="RootContactGroup" groupOwner="false" chatroom="${room}" id="${id}"` +
    ` senderCallsign="${escapeXml(senderCallsign)}">` +
    `<chatgrp uid0="${sender}" uid1="${id}" id="${id}"/>` +
    `</__chat>` +
    `<link uid="${sender}" type="a-f-G-U-C" relation="p-p"/>` +
    `<remarks source="BAO.F.ATAK.${sender}" to="${id}" time="${sentAt}">` +
    `${escapeXml(msg.text)}</remarks>` +
    `</detail>` +
    `</event>`
  );
}
