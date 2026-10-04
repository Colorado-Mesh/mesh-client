/**
 * Developer-initiated service announcements feed (`announcements/announcements.json` on `main`).
 *
 * The feed is remote, untrusted input: every function here is total (never throws) so a broken,
 * empty, or hostile feed degrades to "no announcements" instead of an error surface.
 */

/** Repo-relative path of the feed (pre-commit warning + file validation test key on this). */
export const SERVICE_ANNOUNCEMENT_FEED_REPO_PATH = 'announcements/announcements.json';

export const SERVICE_ANNOUNCEMENT_FEED_URL = `https://raw.githubusercontent.com/Colorado-Mesh/mesh-client/main/${SERVICE_ANNOUNCEMENT_FEED_REPO_PATH}`;

export const SERVICE_ANNOUNCEMENT_SCHEMA_VERSION = 1;
export const SERVICE_ANNOUNCEMENT_MAX_ENTRIES = 20;
export const SERVICE_ANNOUNCEMENT_MAX_FEED_BYTES = 64 * 1024;
export const SERVICE_ANNOUNCEMENT_TITLE_MAX = 120;
export const SERVICE_ANNOUNCEMENT_BODY_MAX = 1000;
export const SERVICE_ANNOUNCEMENT_URL_LABEL_MAX = 40;
export const SERVICE_ANNOUNCEMENT_URL_MAX = 2048;
export const SERVICE_ANNOUNCEMENT_MAX_LOCALES = 32;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const APP_VERSION_PREFIX_RE = /^(\d+)\.(\d+)\.(\d+)/;
const ISO_DATE_TIME_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}/;
const ISO_ZONE_SUFFIX_RE = /(?:Z|[+-]\d{2}:\d{2})$/;
const LOCALE_PRIMARY_RE = /^[a-z]{2,3}$/;
const LOCALE_SUBTAG_RE = /^[A-Za-z0-9]{2,8}$/;
const LOCALE_MAX_SUBTAGS = 3;

/** BCP 47-ish tag like `es`, `pt-BR`, `zh-Hant-TW` (split instead of a nested-quantifier regex). */
function isLocaleTag(tag: string): boolean {
  const [primary = '', ...rest] = tag.split('-');
  return (
    LOCALE_PRIMARY_RE.test(primary) &&
    rest.length <= LOCALE_MAX_SUBTAGS &&
    rest.every((part) => LOCALE_SUBTAG_RE.test(part))
  );
}

export const SERVICE_ANNOUNCEMENT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type ServiceAnnouncementSeverity = (typeof SERVICE_ANNOUNCEMENT_SEVERITIES)[number];

export interface ServiceAnnouncementLocalizedText {
  title?: string;
  body?: string;
  urlLabel?: string;
}

export interface ServiceAnnouncement {
  id: string;
  severity: ServiceAnnouncementSeverity;
  title: string;
  body: string;
  /** Normalized `https:` href; the only URLs main will open for announcements. */
  url?: string;
  urlLabel?: string;
  startsAt?: string;
  expiresAt?: string;
  minAppVersion?: string;
  maxAppVersion?: string;
  localized?: Record<string, ServiceAnnouncementLocalizedText>;
}

export interface ServiceAnnouncementRejectedRow {
  index: number;
  reason: string;
}

export interface ServiceAnnouncementFeedOk {
  ok: true;
  announcements: ServiceAnnouncement[];
  rejected: ServiceAnnouncementRejectedRow[];
}

export interface ServiceAnnouncementFeedInvalid {
  ok: false;
  reason: string;
}

export type ServiceAnnouncementFeedParseResult =
  ServiceAnnouncementFeedOk | ServiceAnnouncementFeedInvalid;

/**
 * `serviceAnnouncements:fetch` result. Only `ok` replaces what the renderer shows; `offline` and
 * `error` keep the current list so a flaky network never retracts a visible announcement.
 */
export type ServiceAnnouncementFetchResult =
  | { status: 'ok'; announcements: ServiceAnnouncement[] }
  | { status: 'offline' }
  | { status: 'error' };

interface FieldOk<T> {
  ok: true;
  value: T;
}
interface FieldErr {
  ok: false;
  reason: string;
}
type FieldResult<T> = FieldOk<T> | FieldErr;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requiredText(raw: unknown, field: string, max: number): FieldResult<string> {
  if (typeof raw !== 'string') return { ok: false, reason: `${field} must be a string` };
  const value = raw.trim();
  if (value === '') return { ok: false, reason: `${field} must not be empty` };
  if (value.length > max) return { ok: false, reason: `${field} exceeds ${max} characters` };
  return { ok: true, value };
}

function optionalText(raw: unknown, field: string, max: number): FieldResult<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  return requiredText(raw, field, max);
}

function optionalHttpsUrl(raw: unknown): FieldResult<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'string' || raw.length > SERVICE_ANNOUNCEMENT_URL_MAX) {
    return { ok: false, reason: 'url must be a string of reasonable length' };
  }
  const parsed = parseHttpsUrl(raw);
  if (!parsed) return { ok: false, reason: 'url must be an https URL without credentials' };
  return { ok: true, value: parsed };
}

/** Normalized href for a credential-free `https:` URL, else null. */
export function parseHttpsUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.hostname === '') {
      return null;
    }
    return u.href;
  } catch {
    // catch-no-log-ok invalid URL is a validation result, not an error
    return null;
  }
}

/** Date.parse rolls `2026-02-30` over to March 2, so confirm the calendar date exists. */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function optionalTimestamp(raw: unknown, field: string): FieldResult<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  const prefix = typeof raw === 'string' ? ISO_DATE_TIME_PREFIX_RE.exec(raw) : null;
  // A zone-less date-time parses as each client's local time; require Z or ±HH:MM.
  if (
    typeof raw !== 'string' ||
    !prefix ||
    !isRealCalendarDate(Number(prefix[1]), Number(prefix[2]), Number(prefix[3])) ||
    !ISO_ZONE_SUFFIX_RE.test(raw) ||
    !Number.isFinite(Date.parse(raw))
  ) {
    return {
      ok: false,
      reason: `${field} must be an ISO 8601 timestamp with Z or a ±HH:MM offset`,
    };
  }
  return { ok: true, value: raw };
}

function optionalVersion(raw: unknown, field: string): FieldResult<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'string' || !VERSION_RE.test(raw)) {
    return { ok: false, reason: `${field} must be X.Y.Z` };
  }
  return { ok: true, value: raw };
}

function optionalLocalized(
  raw: unknown,
): FieldResult<Record<string, ServiceAnnouncementLocalizedText> | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!isPlainObject(raw)) return { ok: false, reason: 'localized must be an object' };
  const keys = Object.keys(raw);
  if (keys.length > SERVICE_ANNOUNCEMENT_MAX_LOCALES) {
    return { ok: false, reason: `localized exceeds ${SERVICE_ANNOUNCEMENT_MAX_LOCALES} locales` };
  }
  const out: Record<string, ServiceAnnouncementLocalizedText> = {};
  for (const locale of keys) {
    if (!isLocaleTag(locale)) {
      return { ok: false, reason: `localized key ${JSON.stringify(locale)} is not a locale` };
    }
    const entry = raw[locale];
    if (!isPlainObject(entry)) {
      return { ok: false, reason: `localized.${locale} must be an object` };
    }
    const title = optionalText(
      entry.title,
      `localized.${locale}.title`,
      SERVICE_ANNOUNCEMENT_TITLE_MAX,
    );
    if (!title.ok) return title;
    const body = optionalText(
      entry.body,
      `localized.${locale}.body`,
      SERVICE_ANNOUNCEMENT_BODY_MAX,
    );
    if (!body.ok) return body;
    const urlLabel = optionalText(
      entry.urlLabel,
      `localized.${locale}.urlLabel`,
      SERVICE_ANNOUNCEMENT_URL_LABEL_MAX,
    );
    if (!urlLabel.ok) return urlLabel;
    const text: ServiceAnnouncementLocalizedText = {};
    if (title.value !== undefined) text.title = title.value;
    if (body.value !== undefined) text.body = body.value;
    if (urlLabel.value !== undefined) text.urlLabel = urlLabel.value;
    // Object.defineProperty keeps a hostile "__proto__"-style key from touching the prototype.
    Object.defineProperty(out, locale, { value: text, enumerable: true, writable: true });
  }
  return { ok: true, value: out };
}

/** Validate one feed row. Unknown extra fields are ignored for forward compatibility. */
export function parseServiceAnnouncementEntry(raw: unknown): FieldResult<ServiceAnnouncement> {
  if (!isPlainObject(raw)) return { ok: false, reason: 'entry must be an object' };

  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) {
    return { ok: false, reason: 'id must match /^[a-z0-9][a-z0-9-]{0,63}$/' };
  }
  const severity = raw.severity;
  if (
    typeof severity !== 'string' ||
    !(SERVICE_ANNOUNCEMENT_SEVERITIES as readonly string[]).includes(severity)
  ) {
    return { ok: false, reason: 'severity must be info, warning, or critical' };
  }
  const title = requiredText(raw.title, 'title', SERVICE_ANNOUNCEMENT_TITLE_MAX);
  if (!title.ok) return title;
  const body = requiredText(raw.body, 'body', SERVICE_ANNOUNCEMENT_BODY_MAX);
  if (!body.ok) return body;
  const url = optionalHttpsUrl(raw.url);
  if (!url.ok) return url;
  const urlLabel = optionalText(raw.urlLabel, 'urlLabel', SERVICE_ANNOUNCEMENT_URL_LABEL_MAX);
  if (!urlLabel.ok) return urlLabel;
  const startsAt = optionalTimestamp(raw.startsAt, 'startsAt');
  if (!startsAt.ok) return startsAt;
  const expiresAt = optionalTimestamp(raw.expiresAt, 'expiresAt');
  if (!expiresAt.ok) return expiresAt;
  if (
    startsAt.value !== undefined &&
    expiresAt.value !== undefined &&
    Date.parse(expiresAt.value) <= Date.parse(startsAt.value)
  ) {
    return { ok: false, reason: 'expiresAt must be after startsAt' };
  }
  const minAppVersion = optionalVersion(raw.minAppVersion, 'minAppVersion');
  if (!minAppVersion.ok) return minAppVersion;
  const maxAppVersion = optionalVersion(raw.maxAppVersion, 'maxAppVersion');
  if (!maxAppVersion.ok) return maxAppVersion;
  const localized = optionalLocalized(raw.localized);
  if (!localized.ok) return localized;

  const value: ServiceAnnouncement = {
    id: raw.id,
    severity: severity as ServiceAnnouncementSeverity,
    title: title.value,
    body: body.value,
  };
  if (url.value !== undefined) {
    value.url = url.value;
    if (urlLabel.value !== undefined) value.urlLabel = urlLabel.value;
  }
  if (startsAt.value !== undefined) value.startsAt = startsAt.value;
  if (expiresAt.value !== undefined) value.expiresAt = expiresAt.value;
  if (minAppVersion.value !== undefined) value.minAppVersion = minAppVersion.value;
  if (maxAppVersion.value !== undefined) value.maxAppVersion = maxAppVersion.value;
  if (localized.value !== undefined) value.localized = localized.value;
  return { ok: true, value };
}

/** Validate a decoded feed document. Bad rows are skipped individually. */
export function parseServiceAnnouncementFeed(data: unknown): ServiceAnnouncementFeedParseResult {
  if (!isPlainObject(data)) return { ok: false, reason: 'feed must be a JSON object' };
  if (data.schema !== SERVICE_ANNOUNCEMENT_SCHEMA_VERSION) {
    return { ok: false, reason: `unsupported schema ${String(data.schema)}` };
  }
  if (!Array.isArray(data.announcements)) {
    return { ok: false, reason: 'announcements must be an array' };
  }

  const rows: unknown[] = data.announcements;
  const announcements: ServiceAnnouncement[] = [];
  const rejected: ServiceAnnouncementRejectedRow[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (announcements.length >= SERVICE_ANNOUNCEMENT_MAX_ENTRIES) {
      rejected.push({ index, reason: `over ${SERVICE_ANNOUNCEMENT_MAX_ENTRIES}-entry limit` });
      return;
    }
    const parsed = parseServiceAnnouncementEntry(row);
    if (!parsed.ok) {
      rejected.push({ index, reason: parsed.reason });
      return;
    }
    if (seen.has(parsed.value.id)) {
      rejected.push({ index, reason: `duplicate id ${parsed.value.id}` });
      return;
    }
    seen.add(parsed.value.id);
    announcements.push(parsed.value);
  });
  return { ok: true, announcements, rejected };
}

/** Parse raw feed text. Empty / whitespace-only text is a valid empty feed. */
export function parseServiceAnnouncementFeedText(text: string): ServiceAnnouncementFeedParseResult {
  if (text.trim() === '') return { ok: true, announcements: [], rejected: [] };
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch (e: unknown) {
    // catch-no-log-ok caller logs the returned reason
    return { ok: false, reason: `invalid JSON (${e instanceof Error ? e.message : String(e)})` };
  }
  return parseServiceAnnouncementFeed(data);
}

function versionTriple(raw: string, re: RegExp): [number, number, number] | null {
  const m = re.exec(raw);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!parts.every((n) => Number.isSafeInteger(n))) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function compareTriples(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}

export interface ServiceAnnouncementFilterContext {
  nowMs: number;
  /** Running app version; a prerelease suffix is ignored, an unparsable value skips version gates. */
  appVersion: string;
}

/** `minAppVersion` / `maxAppVersion` gate (inclusive). */
export function matchesServiceAnnouncementAppVersion(
  a: ServiceAnnouncement,
  appVersion: string,
): boolean {
  const app = versionTriple(appVersion, APP_VERSION_PREFIX_RE);
  if (!app) return true;
  const min = a.minAppVersion ? versionTriple(a.minAppVersion, VERSION_RE) : null;
  if (min && compareTriples(app, min) < 0) return false;
  const max = a.maxAppVersion ? versionTriple(a.maxAppVersion, VERSION_RE) : null;
  if (max && compareTriples(app, max) > 0) return false;
  return true;
}

/** `startsAt` (inclusive) / `expiresAt` (exclusive) window. */
export function isServiceAnnouncementInWindow(a: ServiceAnnouncement, nowMs: number): boolean {
  if (a.startsAt !== undefined && Date.parse(a.startsAt) > nowMs) return false;
  if (a.expiresAt !== undefined && Date.parse(a.expiresAt) <= nowMs) return false;
  return true;
}

export function isServiceAnnouncementActive(
  a: ServiceAnnouncement,
  ctx: ServiceAnnouncementFilterContext,
): boolean {
  return (
    isServiceAnnouncementInWindow(a, ctx.nowMs) &&
    matchesServiceAnnouncementAppVersion(a, ctx.appVersion)
  );
}

export function filterActiveServiceAnnouncements(
  list: readonly ServiceAnnouncement[],
  ctx: ServiceAnnouncementFilterContext,
): ServiceAnnouncement[] {
  return list.filter((a) => isServiceAnnouncementActive(a, ctx));
}

export interface ResolvedServiceAnnouncementText {
  title: string;
  body: string;
  urlLabel?: string;
}

/** Localized text for `language` (exact tag, then base language), falling back to English fields. */
export function resolveServiceAnnouncementText(
  a: ServiceAnnouncement,
  language: string,
): ResolvedServiceAnnouncementText {
  const localized = a.localized;
  const base = language.split('-')[0] ?? language;
  const pick =
    localized && Object.prototype.hasOwnProperty.call(localized, language)
      ? localized[language]
      : localized && Object.prototype.hasOwnProperty.call(localized, base)
        ? localized[base]
        : undefined;
  const resolved: ResolvedServiceAnnouncementText = {
    title: pick?.title ?? a.title,
    body: pick?.body ?? a.body,
  };
  const urlLabel = pick?.urlLabel ?? a.urlLabel;
  if (urlLabel !== undefined) resolved.urlLabel = urlLabel;
  return resolved;
}
