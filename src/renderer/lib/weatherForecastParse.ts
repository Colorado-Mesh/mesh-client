/**
 * Parses forecast posts from known mesh weather bots into structured data for the map.
 *
 * Profiles:
 * - `nwsPipe`: `Place | NWS forecast` / `Period: 59°F Cond | wind | precip N%` / `Issued ...`
 * - `meshcoreBot` (agessaman/meshcore-bot `wx` / `gwx` / scheduled):
 *   `City, ST: Period: 🌙Cond 52°F NW8 🌦️20% | Period: ☀️Cond 75°/52°`
 * - `meshingAroundMeteo` (SpudGunMan/meshing-around, Open-Meteo):
 *   `Today, Cond: Clear sky. High: 75F, with a low of 52F. ...`
 * - `meshingAroundNoaa` (meshing-around, NOAA with abbreviations):
 *   `Tonight: Mostly clear, with a low ~ 52. SW wind ...`
 *
 * meshing-around replies carry no place name; the bot forecasts for the requester's position.
 */

export type WeatherForecastProfileId =
  'nwsPipe' | 'meshcoreBot' | 'meshingAroundMeteo' | 'meshingAroundNoaa';

export type WeatherForecastLocationSource = 'placeName' | 'requester';

export type WeatherTempUnit = 'F' | 'C';

export interface ParsedForecastPlace {
  /** Place as written in the post, e.g. `Aurora, CO 80013`. */
  label: string;
  name: string;
  /** Region / state / country parts after the name, in order. */
  qualifiers: string[];
  postcode?: string;
}

export interface ParsedWeatherForecast {
  profileId: WeatherForecastProfileId;
  locationSource: WeatherForecastLocationSource;
  place?: ParsedForecastPlace;
  period: string;
  tempValue?: number;
  tempUnit?: WeatherTempUnit;
  highLow?: { high: number; low: number };
  /** First period line without emoji, for compact display. */
  summary: string;
  /** All forecast lines / periods, for the tooltip. */
  segments: string[];
  issuedAt?: string;
  /**
   * The `Issued` line was cut off at the end of a `[1/N]` post (date only, or nothing), with
   * the rest in a continuation part that MeshCore repeaters usually drop.
   */
  issuedTruncated?: boolean;
  hasAlerts: boolean;
}

export interface StrippedBotText {
  text: string;
  part?: { index: number; total: number };
}

const MULTIPART_PREFIX_RE = /^\s*\[(\d{1,2})\/(\d{1,2})\]\s*/;
const MENTION_PREFIX_RE = /^\s*@\[[^\]\n]{1,64}\]\s*/;
const EMOJI_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

/** Strip MeshCore multipart `[n/m]` prefixes and leading `@[name]` mentions (in either order). */
export function stripBotPrefixes(raw: string): StrippedBotText {
  let text = raw;
  let part: StrippedBotText['part'];
  for (let i = 0; i < 4; i++) {
    const multi = MULTIPART_PREFIX_RE.exec(text);
    if (multi) {
      part = { index: Number(multi[1]), total: Number(multi[2]) };
      text = text.slice(multi[0].length);
      continue;
    }
    const mention = MENTION_PREFIX_RE.exec(text);
    if (mention) {
      text = text.slice(mention[0].length);
      continue;
    }
    break;
  }
  return { text: text.trim(), part };
}

function stripEmoji(s: string): string {
  return s
    .replace(EMOJI_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// US ZIP (+4), 4–6 digit numeric, Canadian, and UK outward/inward postcodes.
const POSTCODE_RES: readonly RegExp[] = [
  /^\d{5}$/,
  /^\d{5}-\d{4}$/,
  /^\d{4,6}$/,
  /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i,
  /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
];

/** Split a trailing postcode (one token, or two for UK / Canadian) off a place part. */
function splitPostcodeTail(part: string): { rest: string; postcode: string } | null {
  const words = part.split(' ');
  for (const n of [2, 1]) {
    if (words.length < n) continue;
    const candidate = words.slice(-n).join(' ');
    if (POSTCODE_RES.some((re) => re.test(candidate))) {
      return { rest: words.slice(0, -n).join(' '), postcode: candidate };
    }
  }
  return null;
}

export function parsePlaceLabel(label: string): ParsedForecastPlace | null {
  const cleaned = stripEmoji(label).replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > 80) return null;
  const parts = cleaned
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  let postcode: string | undefined;
  const last = parts[parts.length - 1];
  const tail = splitPostcodeTail(last);
  if (tail && parts.length > 1) {
    postcode = tail.postcode.toUpperCase();
    if (tail.rest) parts[parts.length - 1] = tail.rest;
    else parts.pop();
  }
  const [name, ...qualifiers] = parts;
  if (!name || /^\d+$/.test(name)) return null;
  return { label: cleaned, name, qualifiers, postcode };
}

/** Stable cache / dedupe key for a place (case- and whitespace-insensitive). */
export function normalizePlaceKey(place: Pick<ParsedForecastPlace, 'name' | 'qualifiers'>): string {
  return [place.name, ...place.qualifiers]
    .map((p) => p.toLowerCase().replace(/\s+/g, ' ').trim())
    .join('|');
}

const DEG_TEMP_RE = /(-?\d{1,3}) *° *([FC])?/i;
/** Second half of a `75°/52°` high/low pair, matched right after the first temperature. */
const DEG_TEMP_PAIR_RE = /^ *\/ *(-?\d{1,3}) *°? *([FC])?/i;

function parseDegreeTemp(
  s: string,
): Pick<ParsedWeatherForecast, 'tempValue' | 'tempUnit' | 'highLow'> | null {
  const m = DEG_TEMP_RE.exec(s);
  if (!m) return null;
  const pair = DEG_TEMP_PAIR_RE.exec(s.slice(m.index + m[0].length));
  const first = Number(m[1]);
  const firstUnit = m[2] as string | undefined;
  const pairUnit = pair?.[2];
  const unitChar = (firstUnit ?? pairUnit)?.toUpperCase();
  const tempUnit = unitChar === 'C' || unitChar === 'F' ? unitChar : undefined;
  if (pair) {
    const second = Number(pair[1]);
    return {
      tempValue: first,
      tempUnit,
      highLow: { high: Math.max(first, second), low: Math.min(first, second) },
    };
  }
  return { tempValue: first, tempUnit };
}

// ─── nwsPipe ────────────────────────────────────────────────────────────────

const NWS_HEADER_RE = /^(?<place>.+?)\s*\|\s*NWS forecast\b/i;
const NWS_PERIOD_RE = /^(?<period>[^:|]{1,40}):\s*(?<rest>.+)$/;
const ISSUED_RE = /^Issued\b\s*(.*?)\.?$/i;
const CLOCK_TIME_RE = /\b\d{1,2}:\d{2}\b/;
const ISSUED_DATE_TIME_RE = /^\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\b/;
const ISSUED_TIME_ONLY_RE = /^\d{1,2}:\d{2}\b/;

function parseNwsPipe(
  lines: string[],
  part: StrippedBotText['part'],
): ParsedWeatherForecast | null {
  const header = NWS_HEADER_RE.exec(lines[0]);
  if (!header?.groups) return null;
  const place = parsePlaceLabel(header.groups.place);
  if (!place) return null;
  let issuedAt: string | undefined;
  let issuedTruncated = false;
  const segments: string[] = [];
  const body = lines.slice(1);
  for (const [i, line] of body.entries()) {
    const issued = ISSUED_RE.exec(line);
    if (!issued) {
      segments.push(line);
      continue;
    }
    issuedAt = issued[1].trim() || undefined;
    issuedTruncated =
      part != null &&
      part.index < part.total &&
      i === body.length - 1 &&
      !CLOCK_TIME_RE.test(issuedAt ?? '');
  }
  const firstPeriod = segments.length > 0 ? NWS_PERIOD_RE.exec(segments[0]) : null;
  const temp = firstPeriod ? parseDegreeTemp(firstPeriod.groups!.rest) : null;
  return {
    profileId: 'nwsPipe',
    locationSource: 'placeName',
    place,
    period: firstPeriod?.groups?.period.trim() ?? '',
    ...temp,
    summary: segments[0] ? stripEmoji(segments[0]) : '',
    segments,
    issuedAt,
    ...(issuedTruncated ? { issuedTruncated } : {}),
    hasAlerts: false,
  };
}

/**
 * Completes a cut-off `Issued` value from the first line of a continuation part, e.g.
 * `10/05` + `10/05 20:52 MDT`, or `10/05` + `20:52 MDT`. Null when the line is not the rest.
 */
export function completeTruncatedIssued(
  partial: string | undefined,
  continuationLine: string,
): string | null {
  const line = continuationLine.trim();
  if (ISSUED_DATE_TIME_RE.test(line)) {
    return !partial || line.startsWith(partial) ? line : null;
  }
  if (partial && ISSUED_TIME_ONLY_RE.test(line)) return `${partial} ${line}`;
  return null;
}

// ─── meshingAroundMeteo ─────────────────────────────────────────────────────

const METEO_LINE_RE =
  /^(?<period>Today|Tomorrow|Futurecast)[,:]\s*Cond:\s*(?<cond>[^.]+)\.\s*High:\s*(?<hi>-?\d{1,3})\s*(?<unit>[FC]),\s*with a low of\s*(?<lo>-?\d{1,3})/i;

function parseMeshingAroundMeteo(lines: string[]): ParsedWeatherForecast | null {
  const idx = lines.findIndex((l) => METEO_LINE_RE.test(l));
  if (idx < 0) return null;
  const m = METEO_LINE_RE.exec(lines[idx])!.groups!;
  const high = Number(m.hi);
  const low = Number(m.lo);
  const segments = lines.slice(idx);
  return {
    profileId: 'meshingAroundMeteo',
    locationSource: 'requester',
    period: m.period,
    tempValue: high,
    tempUnit: m.unit.toUpperCase() as WeatherTempUnit,
    highLow: { high, low },
    summary: `${m.period}: ${m.cond.trim()}`,
    segments,
    hasAlerts: lines.slice(0, idx).some((l) => /\balerts?!/i.test(l)),
  };
}

// ─── meshcoreBot ────────────────────────────────────────────────────────────

/** Matched against whitespace-collapsed text. */
const PERIOD_WORD_RE =
  /^(?:now|today|tonight|this \w+|overnight|tomorrow|tomorrow night|(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?(?: night)?|late \w+)$/i;
const MESHCORE_BOT_RE = /^(?<place>[^:\n|]{2,80}):\s*(?<body>[\s\S]+)$/;
const MESHCORE_SEGMENT_RE = /^(?<period>[^:|]{1,40}):\s*(?<rest>.+)$/;

function parseMeshcoreBot(text: string): ParsedWeatherForecast | null {
  const m = MESHCORE_BOT_RE.exec(text);
  if (!m?.groups) return null;
  const placeLabel = m.groups.place.trim();
  if (PERIOD_WORD_RE.test(stripEmoji(placeLabel).replace(/\s+/g, ' '))) return null;
  const segments = m.groups.body
    .split(/\s+\|\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const first = segments.length > 0 ? MESHCORE_SEGMENT_RE.exec(segments[0]) : null;
  if (!first?.groups) return null;
  const temp = parseDegreeTemp(first.groups.rest);
  if (!temp) return null;
  const place = parsePlaceLabel(placeLabel);
  if (!place) return null;
  return {
    profileId: 'meshcoreBot',
    locationSource: 'placeName',
    place,
    period: first.groups.period.trim(),
    ...temp,
    summary: stripEmoji(segments[0]),
    segments: segments.map(stripEmoji),
    hasAlerts: false,
  };
}

// ─── meshingAroundNoaa ──────────────────────────────────────────────────────

const NOAA_PERIOD_LINE_RE =
  /^(?<period>Today|Tonight|Overnight|This (?:Aftn|Eve|Morning)|Late Aftn|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?: Night)?|[A-Z][\w.' ]{2,30}?(?: Night)?):\s*(?<rest>.+)$/;
const NOAA_HIGH_LOW_RE = /\b(high|low)\s+(?:near|~|of|around)\s*(-?\d{1,3})/i;
const NOAA_ALERTS_RE = /^\d+\s+local alerts!/i;

function parseMeshingAroundNoaa(lines: string[]): ParsedWeatherForecast | null {
  const hasAlerts = lines.length > 0 && NOAA_ALERTS_RE.test(lines[0]);
  const body = hasAlerts ? lines.slice(1) : lines;
  const segments: string[] = [];
  for (const line of body) {
    if (!NOAA_PERIOD_LINE_RE.test(line)) break;
    segments.push(line);
  }
  if (segments.length === 0) return null;
  const first = NOAA_PERIOD_LINE_RE.exec(segments[0])!.groups!;
  const hl = NOAA_HIGH_LOW_RE.exec(first.rest);
  const deg = hl ? null : parseDegreeTemp(first.rest);
  if (!hl && !deg) return null;
  const metric = /\bkm\/h\b|°C/i.test(segments.join(' '));
  const tempUnit: WeatherTempUnit = deg?.tempUnit ?? (metric ? 'C' : 'F');
  return {
    profileId: 'meshingAroundNoaa',
    locationSource: 'requester',
    period: first.period,
    tempValue: hl ? Number(hl[2]) : deg?.tempValue,
    tempUnit,
    summary: segments[0],
    segments,
    hasAlerts,
  };
}

/**
 * Parse a weather bot post. Returns null when the text matches no known profile
 * (unrecognized formats are not plotted).
 */
export function parseWeatherForecastPost(raw: string): ParsedWeatherForecast | null {
  const { text, part } = stripBotPrefixes(raw);
  if (!text) return null;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  return (
    parseNwsPipe(lines, part) ??
    parseMeshingAroundMeteo(lines) ??
    parseMeshcoreBot(text) ??
    parseMeshingAroundNoaa(lines)
  );
}

/** Temperature in Celsius (for the shared color ramp). Unknown units are treated as Fahrenheit. */
export function forecastTempCelsius(
  forecast: Pick<ParsedWeatherForecast, 'tempValue' | 'tempUnit'>,
): number | null {
  if (forecast.tempValue == null || !Number.isFinite(forecast.tempValue)) return null;
  return forecast.tempUnit === 'C' ? forecast.tempValue : ((forecast.tempValue - 32) * 5) / 9;
}

const REQUESTER_COMMAND_RE = /^\s*(?:wx|wxc|weather)\b/i;

/** True when `text` is a meshing-around weather request (`wx`, `wxc`, `weather`). */
export function isWeatherRequestCommand(text: string): boolean {
  return REQUESTER_COMMAND_RE.test(stripBotPrefixes(text).text);
}
