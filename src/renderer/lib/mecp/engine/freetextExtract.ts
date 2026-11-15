/**
 * MECP 1.2.1 §6.1 freetext convention extraction.
 * Patterns and semantics from https://github.com/mecp-org/MECP (freetext/patterns.json,
 * scripts/check-freetext.mjs). Additional Validation failures are ignored; freetext is preserved.
 */

import patternsJson from './freetext/patterns.json';

/**
 * Boundary class B from §6.1 rule 4: ASCII whitespace/punctuation except sigils
 * `@ # ~ +` and `- _`, plus listed Unicode. Includes `*` and `/` so forms like
 * `*3pax*` and `3pax/45min` bound correctly; `/` inside callsign still matches
 * because it is part of that convention's pattern.
 */
const B_CLASS =
  '[\\t\\n\\f\\r ,.;:!?\'"()\\[\\]{}*/\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000\\u060C\\u061B\\u061F\\u06D4\\u00AB\\u00BB\\u2013\\u2014\\u2018-\\u201D\\u2026\\u3001\\u3002\\u300C-\\u300F\\u3010\\u3011\\uFF01\\uFF08\\uFF09\\uFF0C\\uFF0E\\uFF1A\\uFF1B\\uFF1F]';
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
    case 's':
      // Ceiling only — do not clamp to 1. `0s` stays 0 so Additional Validation
      // rejects it and matching can continue to a later valid duration (e.g. 7200s).
      return Math.ceil(a / 60);
    default:
      return Number.NaN;
  }
}

/** MECP #28 / PR #29: any positive total is valid in any SI unit (no 1440-minute cap). */
function validateDurationMinutes(mins: number): boolean {
  return Number.isFinite(mins) && mins >= 1;
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
    return { match: m, token: freetext.slice(tokenStart, tokenEnd) };
  }
  return null;
}

function decodeDuration(
  freetext: string,
  codes: readonly string[],
): { minutes: number; token: string } | null {
  const spec = PATTERNS.duration;
  if (spec.scope && !codes.includes(spec.scope)) return null;
  const decodeList = spec.decode;
  const kinds = ['hm', 'h', 'min', 'd', 's', 'bare'] as const;

  for (let i = 0; i < decodeList.length; i++) {
    const kind = kinds[i];
    const pat = decodeList[i];
    if (kind === 'bare') {
      // B_CLASS is a fixed protocol boundary class literal interpolated into the pattern.
      const re = new RegExp(`^(?:[Ee][Tt][Aa] ?)?([0-9]+)(?:${B_CLASS}|$)`);
      const m = re.exec(freetext);
      if (!m) continue;
      const mins = toMinutes('bare', m);
      if (!validateDurationMinutes(mins)) continue;
      const full = m[0];
      const usedRightB = full.length > 0 && B_ONE.test(full[full.length - 1]);
      const token = usedRightB ? full.slice(0, -1) : full;
      return { minutes: mins, token };
    }
    const found = firstValidMatch(pat, freetext, (mm) =>
      validateDurationMinutes(toMinutes(kind, mm)),
    );
    if (found) return { minutes: toMinutes(kind, found.match), token: found.token };
  }
  return null;
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

/** Envelope pattern from patterns.json `message.decode` (trailing space → invalid). */
// eslint-disable-next-line security/detect-non-literal-regexp -- pattern from vendored MECP patterns.json
export const MESSAGE_ENVELOPE_RE = new RegExp(PATTERNS.message.decode);

export function matchMessageEnvelope(
  input: string,
): { severity: string; codes: string[]; freetext: string } | null {
  const m = MESSAGE_ENVELOPE_RE.exec(input);
  if (!m) return null;
  return { severity: m[1], codes: m[2].split(' '), freetext: m[3] || '' };
}
