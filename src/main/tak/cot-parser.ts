import { StringDecoder } from 'string_decoder';

import type { TAKContact, TAKContactSource } from '../../shared/tak-types';
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

const EVENT_END = '</event>';

/**
 * Splits a TAK streaming connection (newline- or nothing-separated XML CoT) into complete
 * `<event>...</event>` strings. Decodes UTF-8 across chunk boundaries.
 */
export class CotFramer {
  private buffer = '';
  private readonly decoder = new StringDecoder('utf8');

  push(chunk: Buffer | string): string[] {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    const frames: string[] = [];
    let end = this.buffer.indexOf(EVENT_END);
    while (end >= 0) {
      const frame = this.buffer.slice(0, end + EVENT_END.length);
      this.buffer = this.buffer.slice(end + EVENT_END.length);
      const start = lastEventStart(frame);
      if (start >= 0) frames.push(frame.slice(start));
      end = this.buffer.indexOf(EVENT_END);
    }
    if (this.buffer.length > COT_FRAME_MAX_BYTES) this.buffer = '';
    return frames;
  }
}

function lastEventStart(frame: string): number {
  let last = -1;
  for (const m of frame.matchAll(/<event[\s>]/g)) last = m.index;
  return last;
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
} as const;

const ATTR = {
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
