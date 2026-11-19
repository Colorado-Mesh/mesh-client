/**
 * Compose MECP acknowledgements and correlate inbound ACKs with open incidents.
 *
 * - General ACK: `MECP/<sev>/R01 <echoed codes> [freetext] ~CALLSIGN` (R01 = Acknowledged).
 * - Beacon ACK:  `MECP/<sev>/B02 [freetext]` (reduce beacon transmission rate).
 * - Beacon cancel: `MECP/<sev>/B03 [freetext]` (sender is OK).
 */

import type { Severity } from './engine';
import { CODE_REGEX, encode, getByteLength, isBeaconAck, MAX_MESSAGE_BYTES } from './engine';
import type { EmergencyIncident } from './incidentTypes';

export const MECP_ACK_CODE = 'R01';
export const MECP_BEACON_CODE = 'B01';
export const MECP_BEACON_ACK_CODE = 'B02';
export const MECP_BEACON_CANCEL_CODE = 'B03';

const ACK_MARKER_CODES: ReadonlySet<string> = new Set([
  MECP_ACK_CODE,
  MECP_BEACON_ACK_CODE,
  MECP_BEACON_CANCEL_CODE,
]);

/** MECP 1.4.0 callsign: `~([A-Z0-9]+(?:/[A-Z0-9]+)*)`, max 12 characters. */
const CALLSIGN_MAX_LEN = 12;
const CALLSIGN_SEGMENT_RE = /^[A-Za-z0-9]+$/;

export function isGeneralAck(codes: readonly string[]): boolean {
  return codes.includes(MECP_ACK_CODE);
}

/** Codes echoed by an ACK, excluding the ACK/beacon marker codes themselves. */
export function echoedAckCodes(codes: readonly string[]): string[] {
  return [...new Set(codes.filter((c) => !ACK_MARKER_CODES.has(c)))];
}

/**
 * Canonical encode form: uppercase A–Z / 0–9 segments joined by `/`, ≤12 chars.
 * Drops empty / invalid segments; truncates from the end if over the limit.
 */
function sanitizeCallsign(callsign: string | undefined): string {
  if (!callsign) return '';
  const segments = callsign
    .split('/')
    .map((s) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
    .filter((s) => CALLSIGN_SEGMENT_RE.test(s));
  if (segments.length === 0) return '';
  let out = segments.join('/');
  while (out.length > CALLSIGN_MAX_LEN && segments.length > 0) {
    const last = segments[segments.length - 1];
    if (last.length > 1) {
      segments[segments.length - 1] = last.slice(0, -1);
    } else {
      segments.pop();
    }
    out = segments.join('/');
  }
  return out.length <= CALLSIGN_MAX_LEN ? out : out.slice(0, CALLSIGN_MAX_LEN);
}

function truncateToBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (getByteLength(text) <= maxBytes) return text;
  const chars = Array.from(text);
  while (chars.length > 0 && getByteLength(chars.join('')) > maxBytes) {
    chars.pop();
  }
  return chars.join('').trimEnd();
}

/**
 * Encode keeping the result within MAX_MESSAGE_BYTES: freetext is truncated first
 * (the `~CALLSIGN` suffix is preserved), then trailing echoed codes are dropped.
 */
function composeWithinLimit(
  severity: Severity,
  requiredCodes: string[],
  optionalCodes: string[],
  freetext: string,
  suffix: string,
): string {
  const codes = [...requiredCodes, ...optionalCodes];
  const buildFreetext = (body: string): string => [body, suffix].filter(Boolean).join(' ');

  const minimal = encode(severity, codes, suffix);
  if (!minimal.overLimit) {
    const budget = MAX_MESSAGE_BYTES - minimal.byteLength - 1;
    const body = truncateToBytes(freetext.trim().replace(/\s+/g, ' '), budget);
    return encode(severity, codes, buildFreetext(body)).message;
  }

  const kept = [...optionalCodes];
  while (kept.length > 0 && encode(severity, [...requiredCodes, ...kept], suffix).overLimit) {
    kept.pop();
  }
  return encode(severity, [...requiredCodes, ...kept], suffix).message;
}

export function composeGeneralAck(
  severity: Severity,
  codes: string[],
  opts?: { callsign?: string; freetext?: string },
): string {
  const echoed = echoedAckCodes(codes.filter((c) => CODE_REGEX.test(c)));
  const callsign = sanitizeCallsign(opts?.callsign);
  return composeWithinLimit(
    severity,
    [MECP_ACK_CODE],
    echoed,
    opts?.freetext ?? '',
    callsign ? `~${callsign}` : '',
  );
}

export function composeBeaconAck(severity: Severity, opts?: { freetext?: string }): string {
  return composeWithinLimit(severity, [MECP_BEACON_ACK_CODE], [], opts?.freetext ?? '', '');
}

export function composeBeaconCancel(severity: Severity, opts?: { freetext?: string }): string {
  return composeWithinLimit(severity, [MECP_BEACON_CANCEL_CODE], [], opts?.freetext ?? '', '');
}

/**
 * Pick the unresolved incident an inbound ACK refers to.
 *
 * Scoring prefers exact echoed-code sets, then code overlap, then matching severity, then
 * recency. `preferSenderId` names the ORIGINAL distress sender; it is ignored when it equals
 * the ACK sender, and incidents raised by the ACK sender are never candidates.
 */
export function findOpenIncidentForAck(
  incidents: readonly EmergencyIncident[],
  parsed: { severity: number; codes: string[]; senderId?: string },
  opts?: { preferSenderId?: string },
): EmergencyIncident | null {
  const ackSender = parsed.senderId;
  const preferSender =
    opts?.preferSenderId && opts.preferSenderId !== ackSender ? opts.preferSenderId : undefined;
  const echoed = echoedAckCodes(parsed.codes);
  const beaconAck = isBeaconAck(parsed.codes);

  let best: EmergencyIncident | null = null;
  let bestScore = -1;
  for (const inc of incidents) {
    if (inc.status === 'resolved') continue;
    if (ackSender && inc.senderId === ackSender) continue;

    const overlap = echoed.filter((c) => inc.codes.includes(c)).length;
    const beaconMatch = beaconAck && inc.beaconActive;
    if (echoed.length > 0 && overlap === 0 && !beaconMatch) continue;
    if (beaconAck && echoed.length === 0 && !inc.beaconActive) continue;

    let score = 0;
    if (preferSender && inc.senderId === preferSender) score += 1000;
    if (beaconMatch) score += 200;
    if (echoed.length > 0 && overlap === echoed.length && overlap === inc.codes.length) {
      score += 100;
    }
    score += overlap * 10;
    if (inc.severity === parsed.severity) score += 5;

    if (
      score > bestScore ||
      (score === bestScore && best !== null && inc.lastSeenAt > best.lastSeenAt)
    ) {
      best = inc;
      bestScore = score;
    }
  }
  return best;
}
