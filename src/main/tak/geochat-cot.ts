import { randomUUID } from 'crypto';

import { isValidLatLon } from '../../shared/geoCoords';
import {
  TAK_GEOCHAT_CALLSIGN_MAX_LEN,
  TAK_GEOCHAT_ROOM_MAX_LEN,
  TAK_GEOCHAT_TEXT_MAX_LEN,
  type TAKGeochatMessage,
} from '../../shared/tak-types';
import { escapeXml } from '../../shared/xmlEscape';

/** GeoChat messages stay in ATAK's history; stale only bounds how long servers relay them. */
const GEOCHAT_STALE_MS = 24 * 60 * 60 * 1000;
/** Point CoT uses for an unknown position. */
const UNKNOWN_ALTITUDE = 9999999;
/** Room names and callsigns are single-line labels. */
const CONTROL_CHARS_RE = /\p{Cc}/u;

/** Stable sender uid for a mesh callsign; ATAK groups a sender's messages by it. */
export function geochatSenderUid(callsign: string): string {
  // FNV-1a, 32-bit: short and stable across restarts.
  let h = 0x811c9dc5;
  for (let i = 0; i < callsign.length; i++) {
    h ^= callsign.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `MESHCHAT-${h.toString(16).padStart(8, '0')}`;
}

function label(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string') throw new Error(`tak:pushChatMessage: ${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || CONTROL_CHARS_RE.test(trimmed)) {
    throw new Error(`tak:pushChatMessage: ${field} must be 1-${max} printable characters`);
  }
  return trimmed;
}

/** Validate an untrusted GeoChat message from the renderer. Throws when malformed. */
export function parseTakGeochatMessage(raw: unknown): TAKGeochatMessage {
  if (!raw || typeof raw !== 'object') {
    throw new Error('tak:pushChatMessage: message must be an object');
  }
  const m = raw as Record<string, unknown>;
  const room = label(m.room, TAK_GEOCHAT_ROOM_MAX_LEN, 'room');
  const senderCallsign = label(m.senderCallsign, TAK_GEOCHAT_CALLSIGN_MAX_LEN, 'senderCallsign');
  if (typeof m.text !== 'string' || !m.text.trim() || m.text.length > TAK_GEOCHAT_TEXT_MAX_LEN) {
    throw new Error(`tak:pushChatMessage: text must be 1-${TAK_GEOCHAT_TEXT_MAX_LEN} characters`);
  }
  if (typeof m.timeMs !== 'number' || !Number.isFinite(m.timeMs) || m.timeMs <= 0) {
    throw new Error('tak:pushChatMessage: timeMs must be a positive number');
  }
  const msg: TAKGeochatMessage = { room, senderCallsign, text: m.text.trim(), timeMs: m.timeMs };
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

/** Standard CoT v2.0 GeoChat (`b-t-f`) event for one heard mesh message. */
export function buildGeochatCot(
  msg: TAKGeochatMessage,
  nowMs: number = Date.now(),
  messageId: string = randomUUID(),
): string {
  const senderUid = geochatSenderUid(msg.senderCallsign);
  const room = escapeXml(msg.room);
  const callsign = escapeXml(msg.senderCallsign);
  const uid = escapeXml(`GeoChat.${senderUid}.${msg.room}.${messageId}`);
  const time = new Date(nowMs).toISOString();
  const sentAt = new Date(Math.min(msg.timeMs, nowMs)).toISOString();
  const stale = new Date(nowMs + GEOCHAT_STALE_MS).toISOString();
  const known = msg.latitude != null && msg.longitude != null;
  const point = known
    ? `<point lat="${msg.latitude}" lon="${msg.longitude}" hae="${UNKNOWN_ALTITUDE}" ce="9999999" le="9999999"/>`
    : `<point lat="0" lon="0" hae="${UNKNOWN_ALTITUDE}" ce="9999999" le="9999999"/>`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<event version="2.0" uid="${uid}" type="b-t-f" time="${time}" start="${time}"` +
    ` stale="${stale}" how="h-g-i-g-o">` +
    point +
    `<detail>` +
    `<__chat parent="RootContactGroup" groupOwner="false" chatroom="${room}" id="${room}"` +
    ` senderCallsign="${callsign}">` +
    `<chatgrp uid0="${senderUid}" uid1="${room}" id="${room}"/>` +
    `</__chat>` +
    `<link uid="${senderUid}" type="a-f-G-U-C" relation="p-p"/>` +
    `<remarks source="BAO.F.ATAK.${senderUid}" to="${room}" time="${sentAt}">` +
    `${escapeXml(msg.text)}</remarks>` +
    `</detail>` +
    `</event>`
  );
}
