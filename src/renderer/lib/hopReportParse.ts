import type { ParsedSignalReport, SignalReportSource } from './signalReportParse';

/**
 * Hop / signal lines that people send by hand or from a client, as opposed to bot replies
 * (`signalReportParse.ts`). These never mark the sender as a bot.
 *
 * - `clientAck`: `, ack: SNR 12.2 dB, RSSI -46 dBm, 9 hops via F764, 10BD, E2B7`
 * - `hopReport`: `6 hops to Parker`, `9 hops Woodland Park`, `copy, 3 hops to Erie`,
 *   `eight hops to SW Denver`, `Got you 6 hops`, `10 hops to ruby hill. welcome!`
 */

const MAX_LENGTH = 120;

const CLIENT_ACK_RE =
  /^,? *ack: SNR (-?\d{1,3}\.?\d{0,2}) dB, RSSI (-?\d{1,3}) dBm, (\d{1,2}) hops? via ([0-9a-f, ]{2,400})$/i;
const PATH_HASH_RE = /^[0-9a-f]{2,4}$/i;
const MAX_PATH_HASHES = 64;

const SPELLED_COUNTS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const LEAD_IN_RE = /^(?:copy|got you|heard you)(?: at)?,? +/i;
const TRAILING_WELCOME_RE = / *welcome!*$/i;
const TRAILING_PUNCT_RE = /[.!]+$/;
const HOP_COUNT_RE =
  /^(\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) hops?(?= |$)/i;
const TO_PREFIX_RE = /^to +/i;
const PLACE_RE = /^[\p{L}\p{N}][\p{L}\p{N} '&-]{0,31}$/u;

const HUMAN_SOURCES: ReadonlySet<SignalReportSource> = new Set(['clientAck', 'hopReport']);

/** True for sources typed or sent by people; these must not mark the sender as a bot. */
export function isHumanSignalSource(source: SignalReportSource): boolean {
  return HUMAN_SOURCES.has(source);
}

function parseCount(token: string): number | undefined {
  const lower = token.toLowerCase();
  if (lower in SPELLED_COUNTS) return SPELLED_COUNTS[lower];
  const n = Number.parseInt(token, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse a client ack or hand-typed hop report; null for anything else. */
export function parseHopReport(text: string): ParsedSignalReport | null {
  if (!text || text.length > MAX_LENGTH) return null;
  const line = text.trim();
  if (line.includes('\n')) return null;

  const ack = CLIENT_ACK_RE.exec(line);
  if (ack) return parseClientAck(ack);

  const body = line
    .replace(LEAD_IN_RE, '')
    .replace(TRAILING_WELCOME_RE, '')
    .replace(TRAILING_PUNCT_RE, '');
  const count = HOP_COUNT_RE.exec(body);
  if (!count) return null;
  const hops = parseCount(count[1]);
  if (hops == null) return null;
  const place = body.slice(count[0].length).trim().replace(TO_PREFIX_RE, '');
  if (place && !PLACE_RE.test(place)) return null;
  return {
    source: 'hopReport',
    hops,
    direct: hops === 0,
    ...(place ? { place } : {}),
  };
}

function parseClientAck(m: RegExpExecArray): ParsedSignalReport | null {
  const hashes = m[4].split(',').map((h) => h.trim());
  if (hashes.length > MAX_PATH_HASHES || !hashes.every((h) => PATH_HASH_RE.test(h))) return null;
  const snr = Number.parseFloat(m[1]);
  if (!Number.isFinite(snr)) return null;
  const hops = Number.parseInt(m[3], 10);
  return {
    source: 'clientAck',
    hops,
    direct: hops === 0,
    snr,
    rssi: Number.parseInt(m[2], 10),
    path: hashes.join(', '),
  };
}
