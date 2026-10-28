import { randomUUID } from 'crypto';

import { isChannelIdentityKey } from '../../shared/channelIdentityKey';
import { isValidLatLon } from '../../shared/geoCoords';
import {
  isTakDmProtocol,
  TAK_CHAT_CHANNELS_MAX,
  TAK_CHAT_ROOM_UID_PREFIX,
  TAK_DIRECT_PEERS_MAX,
  TAK_DM_OUTCOMES,
  TAK_DM_PROTOCOLS,
  TAK_GEOCHAT_CALLSIGN_MAX_LEN,
  TAK_GEOCHAT_ROOM_MAX_LEN,
  TAK_GEOCHAT_TEXT_MAX_LEN,
  type TAKChannelChatMessage,
  type TakChatChannel,
  type TAKDirectMessage,
  type TakDirectPeer,
  type TakDmOutcome,
  type TakDmProtocol,
  type TakDmStatusUpdate,
  type TAKGeochatMessage,
  type TakUnitStyle,
} from '../../shared/tak-types';
import { escapeXml } from '../../shared/xmlEscape';
import { COT_CHAT_ENDPOINT, cotStyleDetail } from './cot-converter';

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
/**
 * Uid of the contact the previous version announced for a GeoChat room open for sending. Those
 * contacts are retired: main tells ATAK devices to drop them after the upgrade.
 */
export function retiredRoomContactUid(room: string): string {
  return `${TAK_CHAT_ROOM_UID_PREFIX}${fnv1aHex(room)}`;
}

/** Most retired rooms the renderer may hand main. */
const RETIRED_ROOMS_MAX = 64;

/** Validate the renderer's list of retired room names. Throws when malformed. */
export function parseTakRetiredRooms(raw: unknown): string[] {
  const channel = 'tak:retireChatRooms';
  if (!Array.isArray(raw) || raw.length > RETIRED_ROOMS_MAX) {
    throw new Error(`${channel}: expected a list of at most ${RETIRED_ROOMS_MAX} room names`);
  }
  return [...new Set(raw.map((r) => label(r, TAK_GEOCHAT_ROOM_MAX_LEN, 'room', channel)))];
}

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
    if (c.protocol !== undefined && c.protocol !== 'meshcore' && c.protocol !== 'meshtastic') {
      throw bad('protocol must be meshcore or meshtastic');
    }
    byKey.set(c.key, {
      key: c.key,
      name,
      send: c.send,
      remote: c.remote,
      ...(c.protocol ? { protocol: c.protocol } : {}),
    });
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
  const endpoint = channel.send ? ` endpoint="${COT_CHAT_ENDPOINT}"` : '';
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

/**
 * A trimmed single-line label of 1 to `max` characters; throws naming the IPC `channel` and
 * `field` otherwise.
 */
function label(value: unknown, max: number, field: string, channel: string): string {
  if (typeof value !== 'string') throw new Error(`${channel}: ${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || CONTROL_CHARS_RE.test(trimmed)) {
    throw new Error(`${channel}: ${field} must be 1-${max} printable characters`);
  }
  return trimmed;
}

/** Message text of 1 to the GeoChat maximum, and a positive send time; throws otherwise. */
function textAndTime(
  m: Record<string, unknown>,
  channel: string,
): { text: string; timeMs: number } {
  if (typeof m.text !== 'string' || !m.text.trim() || m.text.length > TAK_GEOCHAT_TEXT_MAX_LEN) {
    throw new Error(`${channel}: text must be 1-${TAK_GEOCHAT_TEXT_MAX_LEN} characters`);
  }
  if (typeof m.timeMs !== 'number' || !Number.isFinite(m.timeMs) || m.timeMs <= 0) {
    throw new Error(`${channel}: timeMs must be a positive number`);
  }
  return { text: m.text.trim(), timeMs: m.timeMs };
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
  const senderCallsign = label(
    m.senderCallsign,
    TAK_GEOCHAT_CALLSIGN_MAX_LEN,
    'senderCallsign',
    'tak:pushChatMessage',
  );
  const msg: TAKChannelChatMessage = {
    channelKey,
    senderCallsign,
    ...textAndTime(m, 'tak:pushChatMessage'),
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

const MAX_NODE_ID = 0xffffffff;

/** Validate an untrusted heard direct message from the renderer. Throws when malformed. */
export function parseTakDirectMessage(raw: unknown): TAKDirectMessage {
  const channel = 'tak:pushDirectMessage';
  if (!raw || typeof raw !== 'object') throw new Error(`${channel}: message must be an object`);
  const m = raw as Record<string, unknown>;
  if (!isTakDmProtocol(m.protocol)) {
    throw new Error(`${channel}: protocol must be one of ${TAK_DM_PROTOCOLS.join(', ')}`);
  }
  const nodeId = m.nodeId;
  if (
    typeof nodeId !== 'number' ||
    !Number.isInteger(nodeId) ||
    nodeId <= 0 ||
    nodeId > MAX_NODE_ID
  ) {
    throw new Error(`${channel}: nodeId must be a node number`);
  }
  return {
    protocol: m.protocol,
    nodeId,
    senderCallsign: label(
      m.senderCallsign,
      TAK_GEOCHAT_CALLSIGN_MAX_LEN,
      'senderCallsign',
      channel,
    ),
    ...textAndTime(m, channel),
  };
}

/** Validate the renderer's list of radios with direct messages on. Throws when malformed. */
export function parseTakDmProtocols(raw: unknown): TakDmProtocol[] {
  if (!Array.isArray(raw) || !raw.every(isTakDmProtocol)) {
    throw new Error(`tak:setDirectMessaging: expected a list of ${TAK_DM_PROTOCOLS.join(', ')}`);
  }
  return [...new Set(raw)];
}

/** Validate the renderer's list of conversation peers. Throws when malformed. */
export function parseTakDirectPeers(raw: unknown): TakDirectPeer[] {
  const channel = 'tak:setDirectPeers';
  if (!Array.isArray(raw) || raw.length > TAK_DIRECT_PEERS_MAX) {
    throw new Error(`${channel}: expected a list of at most ${TAK_DIRECT_PEERS_MAX} peers`);
  }
  const byKey = new Map<string, TakDirectPeer>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new Error(`${channel}: peer must be an object`);
    const p = item as Record<string, unknown>;
    if (!isTakDmProtocol(p.protocol)) {
      throw new Error(`${channel}: protocol must be one of ${TAK_DM_PROTOCOLS.join(', ')}`);
    }
    const nodeId = p.nodeId;
    if (
      typeof nodeId !== 'number' ||
      !Number.isInteger(nodeId) ||
      nodeId <= 0 ||
      nodeId > MAX_NODE_ID
    ) {
      throw new Error(`${channel}: nodeId must be a node number`);
    }
    const callsign = label(p.callsign, TAK_GEOCHAT_CALLSIGN_MAX_LEN, 'callsign', channel);
    const key = `${p.protocol}:${nodeId}`;
    if (!byKey.has(key)) byKey.set(key, { protocol: p.protocol, nodeId, callsign });
  }
  return [...byKey.values()];
}

const DM_REF_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Validate an untrusted direct message outcome from the renderer. Throws when malformed. */
export function parseTakDmStatus(raw: unknown): TakDmStatusUpdate {
  const channel = 'tak:dmStatus';
  if (!raw || typeof raw !== 'object') throw new Error(`${channel}: update must be an object`);
  const m = raw as Record<string, unknown>;
  if (typeof m.dmRef !== 'string' || !DM_REF_RE.test(m.dmRef)) {
    throw new Error(`${channel}: dmRef must be a message reference`);
  }
  if (!(TAK_DM_OUTCOMES as readonly unknown[]).includes(m.outcome)) {
    throw new Error(`${channel}: outcome must be one of ${TAK_DM_OUTCOMES.join(', ')}`);
  }
  return { dmRef: m.dmRef, outcome: m.outcome as TakDmOutcome };
}

/** How long a companion keeps its contact without a marker after the last direct message. */
export const DIRECT_CONTACT_TTL_MS = 24 * 60 * 60 * 1000;

/** A companion as a chat contact: its marker's uid and the callsign ATAK shows for it. */
export interface DirectChatContact {
  uid: string;
  callsign: string;
}

/** One line of a direct conversation. */
export interface DirectChatLine {
  text: string;
  timeMs: number;
}

/**
 * Contact for a companion a direct message has passed with but that has no marker on the map
 * (no position, or hidden by the filters or the age limit). It sits at 0, 0, under the marker's
 * uid, so a marker arriving later takes its place, and goes stale a day after `lastDmMs`. It
 * carries the unit style its marker would (type, team, colour, icon), so it looks the same.
 */
export function buildDirectContactCot(
  contact: DirectChatContact,
  lastDmMs: number,
  nowMs: number = Date.now(),
  style: TakUnitStyle = { cotType: 'a-f-G-U-C' },
): string {
  const time = new Date(nowMs).toISOString();
  const stale = new Date(Math.max(lastDmMs + DIRECT_CONTACT_TTL_MS, nowMs)).toISOString();
  return (
    `<event version="2.0" uid="${escapeXml(contact.uid)}" type="${escapeXml(style.cotType)}"` +
    ` time="${time}" start="${time}" stale="${stale}" how="h-g-i-g-o">` +
    `<point lat="0" lon="0" hae="${UNKNOWN_ALTITUDE}" ce="9999999" le="9999999"/>` +
    `<detail>` +
    `<contact callsign="${escapeXml(contact.callsign)}" endpoint="${COT_CHAT_ENDPOINT}"/>` +
    cotStyleDetail(style) +
    `</detail>` +
    `</event>`
  );
}

/**
 * A direct message to `recipient` from a companion's contact. ATAK files it under that contact,
 * and a reply there comes back addressed to the companion's uid.
 */
export function buildDirectChatCot(
  contact: DirectChatContact,
  line: DirectChatLine,
  recipient: GeochatRecipient,
  nowMs: number = Date.now(),
  messageId: string = randomUUID(),
): string {
  return geochatEvent(
    { room: contact.callsign, senderCallsign: contact.callsign, ...line },
    contact.uid,
    contact.callsign,
    recipient.callsign,
    recipient.uid,
    nowMs,
    messageId,
  );
}

/**
 * Delivery receipt (`b-t-f-d`) for the message `messageId` a TAK client sent to a companion's
 * contact: the companion acknowledged it, so ATAK marks it delivered. It describes that
 * conversation as the client filed it (`chatroom`, the companion's uid as its id) and comes
 * from the companion's contact.
 */
export function buildDirectReceiptCot(
  contact: DirectChatContact,
  chatroom: string,
  recipient: GeochatRecipient,
  messageId: string,
  nowMs: number = Date.now(),
): string {
  const time = new Date(nowMs).toISOString();
  const stale = new Date(nowMs + GEOCHAT_STALE_MS).toISOString();
  const uid = escapeXml(contact.uid);
  const id = escapeXml(messageId);
  return (
    `<event version="2.0" uid="${id}" type="b-t-f-d" time="${time}" start="${time}"` +
    ` stale="${stale}" how="h-g-i-g-o">` +
    `<point lat="0" lon="0" hae="${UNKNOWN_ALTITUDE}" ce="9999999" le="9999999"/>` +
    `<detail>` +
    `<__chatreceipt parent="RootContactGroup" groupOwner="false" messageId="${id}"` +
    ` chatroom="${escapeXml(chatroom)}" id="${uid}" senderCallsign="${escapeXml(contact.callsign)}">` +
    `<chatgrp uid0="${escapeXml(recipient.uid)}" uid1="${uid}" id="${uid}"/>` +
    `</__chatreceipt>` +
    `<link uid="${uid}" type="a-f-G-U-C" relation="p-p"/>` +
    `</detail>` +
    `</event>`
  );
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
