/**
 * MECP 1.4.1 §6.1 freetext convention extraction.
 * Patterns and semantics from https://github.com/mecp-org/MECP (freetext/patterns.json,
 * scripts/check-freetext.mjs). Additional Validation failures are ignored; freetext is preserved.
 * Decode order and token claiming follow §6.1 rule 5 (claimed ranges; later overlaps fail).
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

/** §6.1 rule 5 decode order (claimed tokens; later overlaps fail). */
const DECODE_ORDER = [
  'appDesignator',
  'gps',
  'timestamp',
  'language',
  'callsign',
  'reference',
  'pax',
  'duration',
] as const;

type ConventionName = (typeof DECODE_ORDER)[number];

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
  /** Private Use (§U) app designator — first freetext token when a U## code is present. */
  appDesignator: string | null;
}

type RegExpMatch = RegExpMatchArray;

interface MatchValidateContext {
  freetext: string;
  /** Absolute start of the current search slice in `freetext`. */
  pos: number;
}

interface ClaimedMatch {
  match: RegExpMatch;
  /** Absolute start index of the full match (including left boundary). */
  index: number;
  tokenLo: number;
  tokenHi: number;
}

interface ConventionResult {
  value: Partial<FreetextExtracted> & { pax?: number };
  lo: number;
  hi: number;
}

function overlapsClaimed(lo: number, hi: number, claimed: ReadonlySet<number>): boolean {
  for (let i = lo; i < hi; i++) {
    if (claimed.has(i)) return true;
  }
  return false;
}

function claimRange(claimed: Set<number>, lo: number, hi: number): void {
  for (let i = lo; i < hi; i++) claimed.add(i);
}

function tokenSpan(m: RegExpMatch, absIndex: number): [number, number] {
  const full = m[0];
  let lo = absIndex;
  let hi = absIndex + full.length;
  if (full.length > 0 && B_ONE.test(full[0])) lo += 1;
  if (hi > lo && B_ONE.test(full[full.length - 1])) hi -= 1;
  return [lo, hi];
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

/** True when group 1 is the fractional part of a decimal (digit + .|, before it). */
function isDecimalFraction(freetext: string, group1Start: number): boolean {
  const before = freetext[group1Start - 1];
  const before2 = freetext[group1Start - 2];
  return (before === '.' || before === ',') && before2 >= '0' && before2 <= '9';
}

/**
 * True when group 1 is the minute field of an `H:MM` / `@H:MM` clock
 * (with or without `@`; covers glued forms where timestamp cannot claim).
 */
function isColonClockMinutes(freetext: string, group1Start: number, digits: string): boolean {
  if (freetext[group1Start - 1] !== ':') return false;
  if (!/^[0-5][0-9]$/.test(digits)) return false;
  return /(?:^|[^0-9])([01]?[0-9]|2[0-3])$/.test(freetext.slice(0, group1Start - 1));
}

function validatePax(m: RegExpMatch, ctx: MatchValidateContext): boolean {
  const indices = m.indices;
  if (!indices?.[1]) return false;
  const group1Start = ctx.pos + indices[1][0];
  if (isDecimalFraction(ctx.freetext, group1Start)) return false;
  if (isColonClockMinutes(ctx.freetext, group1Start, m[1])) return false;
  return true;
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
 * Find the first decode match that passes validate() and does not overlap claimed.
 * Wrapped as (?:^|B)(pattern)(?:B|$). On validation/overlap failure, resume after the
 * token (full match minus trailing B), per rule 6.
 */
function firstValidMatch(
  pattern: string,
  freetext: string,
  validate: ((m: RegExpMatch, ctx: MatchValidateContext) => boolean) | null,
  claimed: ReadonlySet<number>,
): ClaimedMatch | null {
  // `d` gives capture indices so Additional Validation can inspect characters
  // before/after group 1 (e.g. R03 decimal-fraction rejection).
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  const re = new RegExp(`(?:^|${B_CLASS})(?:${pattern})(?:${B_CLASS}|$)`, 'd'); // eslint-disable-line security/detect-non-literal-regexp -- trusted/escaped pattern
  let pos = 0;
  while (pos <= freetext.length) {
    const slice = freetext.slice(pos);
    const m = re.exec(slice);
    if (!m) return null;

    const abs = pos + m.index;
    const full = m[0];
    const usedRightB = full.length > 0 && B_ONE.test(full[full.length - 1]);
    const [lo, hi] = tokenSpan(m, abs);
    const resume = Math.max(abs + full.length - (usedRightB ? 1 : 0), abs + 1);

    if (overlapsClaimed(lo, hi, claimed)) {
      pos = resume;
      continue;
    }
    if (validate && !validate(m, { freetext, pos })) {
      pos = resume;
      continue;
    }
    return { match: m, index: abs, tokenLo: lo, tokenHi: hi };
  }
  return null;
}

interface PatternSpec {
  encode?: string | string[];
  decode: string | string[];
  validate?: string;
  scope?: string;
  scopeCategory?: string;
}

function scopeApplies(spec: PatternSpec, codes: readonly string[]): boolean {
  if (spec.scopeCategory) {
    const letter = spec.scopeCategory;
    return codes.some((c) => c.startsWith(letter) && /^[A-Z][0-9]{2}$/.test(c));
  }
  if (spec.scope) return codes.includes(spec.scope);
  return true;
}

function looksLikeMinuteDigits(text: string): boolean {
  return text.length >= 2 && text[0] >= '0' && text[0] <= '5' && text[1] >= '0' && text[1] <= '9';
}

function decodeDuration(
  freetext: string,
  codes: readonly string[],
  claimed: ReadonlySet<number>,
): ConventionResult | null {
  const spec = PATTERNS.duration as PatternSpec;
  if (!scopeApplies(spec, codes)) return null;
  const decodeList = spec.decode;
  if (!Array.isArray(decodeList)) return null;
  const kinds = ['hm', 'h', 'min', 'd', 'bare'] as const;

  let best: { minutes: number; token: string; index: number; lo: number; hi: number } | null = null;

  for (let i = 0; i < decodeList.length; i++) {
    const kind = kinds[i];
    const pat = decodeList[i];
    if (best && kind === 'bare') break;

    const found = firstValidMatch(
      pat,
      freetext,
      (mm, ctx) => {
        if (!(toMinutes(kind, mm) > 0)) return false;
        const indices = mm.indices;
        if (!indices?.[1]) return false;
        const group1Start = ctx.pos + indices[1][0];
        if (isColonClockMinutes(freetext, group1Start, mm[1])) return false;
        if (kind === 'bare') {
          if (indices[2]) return false;
          const group1End = ctx.pos + indices[1][1];
          const sep = freetext[group1End];
          const next = freetext[group1End + 1];
          if ((sep === '.' || sep === ',') && next >= '0' && next <= '9') return false;
          if (sep === ':' && looksLikeMinuteDigits(freetext.slice(group1End + 1))) return false;
          return true;
        }
        return !isDecimalFraction(freetext, group1Start);
      },
      claimed,
    );
    if (found && (!best || found.index < best.index)) {
      best = {
        minutes: toMinutes(kind, found.match),
        token: freetext.slice(found.tokenLo, found.tokenHi),
        index: found.index,
        lo: found.tokenLo,
        hi: found.tokenHi,
      };
    }
  }
  if (!best) return null;
  return {
    value: { duration: best.minutes, durationToken: best.token },
    lo: best.lo,
    hi: best.hi,
  };
}

function patternSpec(name: ConventionName): PatternSpec {
  return (PATTERNS as Record<ConventionName, PatternSpec>)[name];
}

function decodeConvention(
  name: ConventionName,
  freetext: string,
  codes: readonly string[],
  claimed: ReadonlySet<number>,
): ConventionResult | null {
  const spec = patternSpec(name);
  if (!scopeApplies(spec, codes)) return null;

  if (name === 'appDesignator') {
    const decodePat = typeof spec.decode === 'string' ? spec.decode : null;
    if (!decodePat) return null;
    const found = firstValidMatch(decodePat, freetext, null, claimed);
    if (found?.index !== 0) return null;
    return {
      value: { appDesignator: found.match[1] },
      lo: found.tokenLo,
      hi: found.tokenHi,
    };
  }

  if (name === 'duration') {
    return decodeDuration(freetext, codes, claimed);
  }

  const decodePat = typeof spec.decode === 'string' ? spec.decode : null;
  if (!decodePat) return null;

  const validate =
    spec.validate === 'gps'
      ? validateGps
      : spec.validate === 'callsign'
        ? validateCallsign
        : spec.validate === 'pax'
          ? validatePax
          : null;

  const found = firstValidMatch(decodePat, freetext, validate, claimed);
  if (!found) return null;

  let value: ConventionResult['value'];
  switch (name) {
    case 'timestamp':
      value = {
        timestamp: `${String(Number(found.match[1])).padStart(2, '0')}:${found.match[2]}`,
      };
      break;
    case 'pax':
      value = { count: Number(found.match[1]), pax: Number(found.match[1]) };
      break;
    case 'gps':
      value = { gps: { lat: Number(found.match[1]), lon: Number(found.match[2]) } };
      break;
    case 'language':
      value = { language: found.match[1].toLowerCase().replace(/_/g, '-') };
      break;
    case 'callsign':
      value = { callsign: found.match[1].toUpperCase() };
      break;
    case 'reference':
      value = { reference: found.match[1] };
      break;
    default:
      return null;
  }
  return { value, lo: found.tokenLo, hi: found.tokenHi };
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
  appDesignator: null,
};

/** Extract structured conventions from MECP freetext (codes needed for scoped Duration / U). */
export function extractFreetextConventions(
  freetext: string,
  codes: readonly string[],
): FreetextExtracted {
  if (!freetext) return { ...EMPTY_EXTRACTED };
  const out: FreetextExtracted = { ...EMPTY_EXTRACTED };
  const claimed = new Set<number>();
  for (const name of DECODE_ORDER) {
    const result = decodeConvention(name, freetext, codes, claimed);
    if (!result) continue;
    if (result.value.count != null) out.count = result.value.count;
    if (result.value.gps != null) out.gps = result.value.gps;
    if (result.value.duration != null) out.duration = result.value.duration;
    if (result.value.durationToken != null) out.durationToken = result.value.durationToken;
    if (result.value.reference != null) out.reference = result.value.reference;
    if (result.value.language != null) out.language = result.value.language;
    if (result.value.timestamp != null) out.timestamp = result.value.timestamp;
    if (result.value.callsign != null) out.callsign = result.value.callsign;
    if (result.value.appDesignator != null) out.appDesignator = result.value.appDesignator;
    claimRange(claimed, result.lo, result.hi);
  }
  return out;
}

/** §6.1 decoder preprocessing: remove at most one trailing `\n`, `\r`, or `\r\n`. */
function stripTrailingLineEnding(input: string): string {
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
