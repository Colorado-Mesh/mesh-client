/**
 * MECP 1.4.0 §6.1 freetext convention extraction.
 * Patterns and semantics from https://github.com/mecp-org/MECP (freetext/patterns.json,
 * scripts/check-freetext.mjs). Additional Validation failures are ignored; freetext is preserved.
 */

import patternsJson from './freetext/patterns.json';

/**
 * Boundary class B from §6.1 rule 4: `\t \n \f \r`, space, and the explicit ASCII
 * punctuation list, plus listed Unicode. Sigils `@ # ~` and `+ - _` are not
 * boundaries. Decoders MAY treat other non-ASCII space/punctuation as boundaries;
 * this harness sticks to the listed set (no `*` or `/`).
 */
const B_CLASS =
  '[\\t\\n\\f\\r ,.;:!?\'"()\\[\\]{}\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000\\u060C\\u061B\\u061F\\u06D4\\u00AB\\u00BB\\u2013\\u2014\\u2018-\\u201D\\u2026\\u3001\\u3002\\u300C-\\u300F\\u3010\\u3011\\uFF01\\uFF08\\uFF09\\uFF0C\\uFF0E\\uFF1A\\uFF1B\\uFF1F]';
const B_ONE = new RegExp(`^${B_CLASS}$`);

const PATTERNS = patternsJson;

export interface FreetextExtracted {
  count: number | null;
  gps: { lat: number; lon: number } | null;
  duration: number | null;
  /** Original Duration token text (e.g. `45min`, `1h`, `ETA 2d`), for UI stripping. */
  durationToken: string | null;
  reference: string | null;
  language: string | null;
  timestamp: string | null;
  callsign: string | null;
}

type RegExpMatch = RegExpMatchArray;

interface BoundedMatch {
  match: RegExpMatch;
  /** Match excluding one-code-point boundary on each side, when present. */
  token: string;
  /** Absolute start index of the full match (including left boundary). */
  index: number;
}

function validateGps(m: RegExpMatch): boolean {
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function validateCallsign(m: RegExpMatch): boolean {
  return m[1].length <= 12;
}

function toMinutes(kind: string, m: RegExpMatch): number {
  const a = Number(m[1]);
  // Optional capture may be absent at runtime; RegExpMatchArray indexes are typed as string.
  const b = m[2] ? Number(m[2]) : 0;
  switch (kind) {
    case 'hm':
      return a * 60 + b;
    case 'h':
      return a * 60;
    case 'min':
    case 'bare':
      return a;
    case 'd':
      return a * 1440;
    default:
      return Number.NaN;
  }
}

/**
 * Find the first decode match that passes validate().
 * Wrapped as (?:^|B)(pattern)(?:B|$). On validation failure, resume after the
 * token (full match minus trailing B), per rule 6.
 */
function firstValidMatch(
  pattern: string,
  freetext: string,
  validate: ((m: RegExpMatch) => boolean) | null,
): BoundedMatch | null {
  // eslint-disable-next-line security/detect-non-literal-regexp -- pattern from vendored MECP patterns.json
  const re = new RegExp(`(?:^|${B_CLASS})(?:${pattern})(?:${B_CLASS}|$)`);
  let pos = 0;
  while (pos <= freetext.length) {
    const slice = freetext.slice(pos);
    const m = re.exec(slice);
    if (!m) return null;

    const abs = pos + m.index;
    const full = m[0];
    const usedLeftB = abs > 0 && full.length > 0 && B_ONE.test(full[0]);
    const usedRightB = full.length > 0 && B_ONE.test(full[full.length - 1]);

    let tokenEnd = abs + full.length - (usedRightB ? 1 : 0);
    const tokenStart = abs + (usedLeftB ? 1 : 0);
    if (tokenEnd < tokenStart) tokenEnd = tokenStart;

    if (validate && !validate(m)) {
      pos = Math.max(tokenEnd, abs + 1);
      continue;
    }
    return { match: m, token: freetext.slice(tokenStart, tokenEnd), index: abs };
  }
  return null;
}

/**
 * R03 Duration: first unit-bearing match by position wins; pattern order breaks
 * ties at the same index. Bare number is a fallback only when no unit-bearing
 * value matches; a decimal group fails Additional Validation (no match).
 */
function decodeDuration(
  freetext: string,
  codes: readonly string[],
): { minutes: number; token: string } | null {
  const spec = PATTERNS.duration;
  if (spec.scope && !codes.includes(spec.scope)) return null;
  const decodeList = spec.decode;
  const kinds = ['hm', 'h', 'min', 'd', 'bare'] as const;

  let best: { minutes: number; token: string; index: number } | null = null;

  for (let i = 0; i < decodeList.length; i++) {
    const kind = kinds[i];
    const pat = decodeList[i];
    // Bare number is only used when no unit-bearing value matched.
    if (best && kind === 'bare') break;

    const found = firstValidMatch(pat, freetext, (mm) => {
      const mins = toMinutes(kind, mm);
      // Bare Additional Validation: reject when the optional decimal group matched.
      return mins > 0 && (kind !== 'bare' || !mm[2]);
    });
    if (found && (!best || found.index < best.index)) {
      best = {
        minutes: toMinutes(kind, found.match),
        token: found.token,
        index: found.index,
      };
    }
  }
  return best ? { minutes: best.minutes, token: best.token } : null;
}

function decodePax(freetext: string): number | null {
  const found = firstValidMatch(PATTERNS.pax.decode, freetext, null);
  if (!found) return null;
  return Number(found.match[1]);
}

function decodeGps(freetext: string): { lat: number; lon: number } | null {
  const found = firstValidMatch(PATTERNS.gps.decode, freetext, validateGps);
  if (!found) return null;
  return { lat: Number(found.match[1]), lon: Number(found.match[2]) };
}

function decodeTimestamp(freetext: string): string | null {
  const found = firstValidMatch(PATTERNS.timestamp.decode, freetext, null);
  if (!found) return null;
  return `${String(Number(found.match[1])).padStart(2, '0')}:${found.match[2]}`;
}

function decodeLanguage(freetext: string): string | null {
  const found = firstValidMatch(PATTERNS.language.decode, freetext, null);
  if (!found) return null;
  return found.match[1].toLowerCase().replace(/_/g, '-');
}

function decodeCallsign(freetext: string): string | null {
  const found = firstValidMatch(PATTERNS.callsign.decode, freetext, validateCallsign);
  if (!found) return null;
  return found.match[1].toUpperCase();
}

function decodeReference(freetext: string): string | null {
  const found = firstValidMatch(PATTERNS.reference.decode, freetext, null);
  return found ? found.match[1] : null;
}

const EMPTY_EXTRACTED: FreetextExtracted = {
  count: null,
  gps: null,
  duration: null,
  durationToken: null,
  reference: null,
  language: null,
  timestamp: null,
  callsign: null,
};

/** Extract structured conventions from MECP freetext (codes needed for scoped Duration). */
export function extractFreetextConventions(
  freetext: string,
  codes: readonly string[],
): FreetextExtracted {
  if (!freetext) return { ...EMPTY_EXTRACTED };
  const duration = decodeDuration(freetext, codes);
  return {
    count: decodePax(freetext),
    gps: decodeGps(freetext),
    duration: duration?.minutes ?? null,
    durationToken: duration?.token ?? null,
    reference: decodeReference(freetext),
    language: decodeLanguage(freetext),
    timestamp: decodeTimestamp(freetext),
    callsign: decodeCallsign(freetext),
  };
}

/** §6.1 decoder preprocessing: remove at most one trailing `\n`, `\r`, or `\r\n`. */
export function stripTrailingLineEnding(input: string): string {
  if (input.endsWith('\r\n')) return input.slice(0, -2);
  if (input.endsWith('\n') || input.endsWith('\r')) return input.slice(0, -1);
  return input;
}

/** Envelope pattern from patterns.json `message.decode` (trailing space → invalid). */
// eslint-disable-next-line security/detect-non-literal-regexp -- pattern from vendored MECP patterns.json
export const MESSAGE_ENVELOPE_RE = new RegExp(PATTERNS.message.decode);

export function matchMessageEnvelope(
  input: string,
): { severity: string; codes: string[]; freetext: string } | null {
  const m = MESSAGE_ENVELOPE_RE.exec(stripTrailingLineEnding(input));
  if (!m) return null;
  return { severity: m[1], codes: m[2].split(' '), freetext: m[3] || '' };
}
