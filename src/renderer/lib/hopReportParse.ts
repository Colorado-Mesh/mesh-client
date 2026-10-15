import type { ParsedSignalReport, SignalReportSource } from './signalReportParse';

/**
 * Hop / signal lines that people send by hand or from a client, as opposed to bot replies
 * (`signalReportParse.ts`). These never mark the sender as a bot.
 *
 * - `clientAck`: `, ack: SNR 12.2 dB, RSSI -46 dBm, 9 hops via F764, 10BD, E2B7`
 * - `hopReport`: `6 hops to Parker`, `9 hops Woodland Park`, `copy, 3 hops to Erie`,
 *   `eight hops to SW Denver`, `Got you 6 hops`, `10 hops to ruby hill. welcome!`
 */

const MAX_LENGTH = 228;

const CLIENT_ACK_RE = /^,? *ack: (.+)$/i;
const PATH_HASH_RE = /^[0-9a-f]{2,6}$/i;
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
  if (ack) return parseClientAck(ack[1]);

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

function parseClientAck(body: string): ParsedSignalReport | null {
  const sections = body.split(/ via /i);
  if (sections.length > 2) return null;
  const measurements = sections[0];
  const path = sections.at(1);
  const result: ParsedSignalReport = { source: 'clientAck', direct: false };
  for (const part of measurements.split(/, */)) {
    const snr = /^SNR (-?\d{1,3}\.?\d{0,2}) dB$/i.exec(part);
    const rssi = /^RSSI (-?\d{1,3}) dBm$/i.exec(part);
    const hops = /^(\d{1,2}) hops?$/i.exec(part);
    if (snr && result.snr == null) result.snr = Number(snr[1]);
    else if (rssi && result.rssi == null) result.rssi = Number(rssi[1]);
    else if (hops && result.hops == null) {
      result.hops = Number(hops[1]);
      result.direct = result.hops === 0;
    } else return null;
  }
  if (path != null) {
    const hashes = path.split(',').map((hash) => hash.trim());
    if (
      result.hops == null ||
      hashes.length > MAX_PATH_HASHES ||
      !hashes.every((hash) => hash.length % 2 === 0 && PATH_HASH_RE.test(hash))
    )
      return null;
    result.path = hashes.join(', ');
  }
  return result;
}
