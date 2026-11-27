const MESHTASTIC_FIRMWARE_API = 'https://api.github.com/repos/meshtastic/firmware/releases/latest';
export const MESHTASTIC_FIRMWARE_RELEASES_URL = 'https://github.com/meshtastic/firmware/releases';

const MESHCORE_FIRMWARE_API = 'https://api.github.com/repos/meshcore-dev/MeshCore/releases/latest';
export const MESHCORE_FIRMWARE_RELEASES_URL = 'https://github.com/meshcore-dev/MeshCore/releases';

const MESHCOM_FIRMWARE_API =
  'https://api.github.com/repos/icssw-org/MeshCom-Firmware/releases/latest';
export const MESHCOM_FIRMWARE_RELEASES_URL =
  'https://github.com/icssw-org/MeshCom-Firmware/releases';

const FIRMWARE_CHECK_TIMEOUT_MS = 10_000;

/** Parsed MeshCom FWVER / release tag (`4.40a`, `v4.40a.11.14`). */
export interface MeshComVersionParts {
  major: number;
  minor: number;
  /** Lowercase letter after minor (e.g. `a` in `4.40a`); empty when absent. */
  letter: string;
  /** Optional release-tag month/day (`11.14` in `v4.40a.11.14`). */
  month: number | null;
  day: number | null;
  /** Calendar year from a device build stamp (`.YYYY.MM.DD`) or a dated release tag. */
  year: number | null;
}

export interface FirmwareCheckResult {
  phase: 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'error';
  latestVersion?: string;
  releaseUrl?: string;
}

export function semverGt(remote: string, local: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const [rMaj, rMin, rPat] = parse(remote);
  const [lMaj, lMin, lPat] = parse(local);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

/** Extract semver from MeshCore tags like companion-v1.16.0 or v1.16.0-07a3ca9. */
export function normalizeMeshCoreVersionTag(tag: string): string {
  const trimmed = tag.trim();
  // Match semver at string start or after a v prefix (companion-v1.16.0, v1.16.0-07a3ca9, 1.16.0).
  const semverMatch = /(?:^|v)(\d+\.\d+\.\d+|\d+\.\d+)/i.exec(trimmed);
  if (semverMatch) return semverMatch[1];
  return trimmed.replace(/^v/i, '');
}

export function looksLikeMeshCoreSemverVersion(version: string): boolean {
  const normalized = normalizeMeshCoreVersionTag(version);
  const parts = normalized.split('.');
  if (parts.length < 2 || parts.length > 3) return false;
  return parts.every((part) => /^\d+$/.test(part));
}

export function meshCoreFirmwareUpdateAvailable(
  deviceFirmware: string,
  release: { version: string; publishedAt: Date },
): boolean {
  if (
    looksLikeMeshCoreSemverVersion(deviceFirmware) &&
    looksLikeMeshCoreSemverVersion(release.version)
  ) {
    const deviceSemver = normalizeMeshCoreVersionTag(deviceFirmware);
    const releaseSemver = normalizeMeshCoreVersionTag(release.version);
    return semverGt(releaseSemver, deviceSemver);
  }

  const deviceDate = parseMeshCoreBuildDate(deviceFirmware);
  if (deviceDate === null) return false;

  return deviceDate < release.publishedAt;
}

export class FirmwareCheckTimeoutError extends Error {
  constructor(ms: number) {
    super(`firmware check timed out after ${ms}ms`);
    this.name = 'FirmwareCheckTimeoutError';
  }
}

export function isFirmwareCheckTimeoutError(err: unknown): err is FirmwareCheckTimeoutError {
  return err instanceof FirmwareCheckTimeoutError;
}

async function fetchWithAbortTimeout(url: string): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort(new FirmwareCheckTimeoutError(FIRMWARE_CHECK_TIMEOUT_MS));
  }, FIRMWARE_CHECK_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ac.signal,
      headers: { Accept: 'application/vnd.github+json' },
    });
  } catch (e) {
    if (ac.signal.aborted) throw new FirmwareCheckTimeoutError(FIRMWARE_CHECK_TIMEOUT_MS);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLatestMeshtasticRelease(): Promise<{
  version: string;
  releaseUrl: string;
}> {
  const res = await fetchWithAbortTimeout(MESHTASTIC_FIRMWARE_API);
  if (!res.ok) throw new Error(`GitHub API responded with ${res.status}`);
  const data = (await res.json()) as { tag_name: string; html_url: string };
  return {
    version: data.tag_name.replace(/^v/, ''),
    releaseUrl: data.html_url,
  };
}

/** GitHub `published_at` as a UTC calendar day (time of day is not part of the compare). */
function githubReleaseCalendarDay(publishedAt: string): Date {
  const raw = new Date(publishedAt);
  return new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate()));
}

export async function fetchLatestMeshCoreRelease(): Promise<{
  publishedAt: Date;
  version: string;
  releaseUrl: string;
}> {
  const res = await fetchWithAbortTimeout(MESHCORE_FIRMWARE_API);
  if (!res.ok) throw new Error(`GitHub API responded with ${res.status}`);
  const data = (await res.json()) as {
    tag_name: string;
    html_url: string;
    published_at: string;
  };
  return {
    publishedAt: githubReleaseCalendarDay(data.published_at),
    version: normalizeMeshCoreVersionTag(data.tag_name),
    releaseUrl: data.html_url,
  };
}

export async function fetchLatestMeshComRelease(): Promise<{
  version: string;
  releaseUrl: string;
  publishedAt: Date;
}> {
  const res = await fetchWithAbortTimeout(MESHCOM_FIRMWARE_API);
  if (!res.ok) throw new Error(`GitHub API responded with ${res.status}`);
  const data = (await res.json()) as { tag_name: string; html_url: string; published_at: string };
  return {
    version: normalizeMeshComVersionTag(data.tag_name),
    releaseUrl: data.html_url,
    publishedAt: githubReleaseCalendarDay(data.published_at),
  };
}

/**
 * Normalize MeshCom FWVER / GitHub tags for display and compare.
 * Strips leading `v`, whitespace (device may report `4.40 a`), parenthetical region
 * (` (eu)`), and RM fork suffix (`-rm5`). Keeps `major.minor` + optional letter +
 * optional `.MM.DD` or `.YYYY.MM.DD` (calendar suffix — not a semver patch).
 */
export function normalizeMeshComVersionTag(tag: string): string {
  let s = tag.trim();
  if (s.startsWith('v') || s.startsWith('V')) s = s.slice(1);
  const parenStart = s.indexOf('(');
  if (parenStart >= 0) {
    const parenEnd = s.indexOf(')', parenStart + 1);
    if (parenEnd >= 0) {
      s = `${s.slice(0, parenStart)}${s.slice(parenEnd + 1)}`;
    }
  }
  const rmMatch = /-rm\d*/i.exec(s);
  if (rmMatch) {
    const at = rmMatch.index;
    s = `${s.slice(0, at)}${s.slice(at + rmMatch[0].length)}`;
  }
  // Collapse spaces so `4.40 a` / `4.40a .11.22` still parse as lettered MeshCom tags.
  s = s.replace(/\s+/g, '');
  // Separate base + optional date to avoid nested-optional regex (eslint security/detect-unsafe-regex).
  const baseMatch = /^(\d+\.\d+)([a-z]?)/i.exec(s);
  if (!baseMatch) return s;
  const base = `${baseMatch[1]}${baseMatch[2]}`.toLowerCase();
  const rest = s.slice(baseMatch[0].length);
  const withYear = /^\.(\d{4})\.(\d{1,2})\.(\d{1,2})/.exec(rest);
  if (withYear) return `${base}.${withYear[1]}.${withYear[2]}.${withYear[3]}`;
  const dateMatch = /^\.(\d{1,2})\.(\d{1,2})/.exec(rest);
  if (!dateMatch) return base;
  return `${base}.${dateMatch[1]}.${dateMatch[2]}`;
}

export function parseMeshComVersion(version: string): MeshComVersionParts | null {
  const normalized = normalizeMeshComVersionTag(version);
  const baseMatch = /^(\d+)\.(\d+)([a-z]?)/i.exec(normalized);
  if (!baseMatch) return null;
  const rest = normalized.slice(baseMatch[0].length);
  const withYear = /^\.(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(rest);
  const dateMatch = withYear ? null : /^\.(\d{1,2})\.(\d{1,2})$/.exec(rest);
  if (rest.length > 0 && !withYear && !dateMatch) return null;
  return {
    major: Number.parseInt(baseMatch[1], 10),
    minor: Number.parseInt(baseMatch[2], 10),
    letter: baseMatch[3].toLowerCase(),
    year: withYear ? Number.parseInt(withYear[1], 10) : null,
    month: withYear
      ? Number.parseInt(withYear[2], 10)
      : dateMatch
        ? Number.parseInt(dateMatch[1], 10)
        : null,
    day: withYear
      ? Number.parseInt(withYear[3], 10)
      : dateMatch
        ? Number.parseInt(dateMatch[2], 10)
        : null,
  };
}

function utcCalendarDay(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2099) return null;
  return Date.UTC(year, month - 1, day);
}

/**
 * True when GitHub release is newer than device FWVER.
 * Device strings without a date stay quiet when the letter series matches (no perpetual toast).
 * When both sides have a calendar day, compare full dates. `releasePublishedAt` supplies the
 * year GitHub tags omit (`.MM.DD`), so a January release is newer than a November device.
 */
export function meshComFirmwareUpdateAvailable(
  deviceFirmware: string,
  releaseVersion: string,
  releasePublishedAt?: Date | null,
): boolean {
  const device = parseMeshComVersion(deviceFirmware);
  const release = parseMeshComVersion(releaseVersion);
  if (!device || !release) return false;
  if (release.major !== device.major) return release.major > device.major;
  if (release.minor !== device.minor) return release.minor > device.minor;
  if (release.letter !== device.letter) return release.letter > device.letter;
  if (device.month == null || device.day == null) return false;

  const published =
    releasePublishedAt != null && !Number.isNaN(releasePublishedAt.getTime())
      ? new Date(
          Date.UTC(
            releasePublishedAt.getUTCFullYear(),
            releasePublishedAt.getUTCMonth(),
            releasePublishedAt.getUTCDate(),
          ),
        )
      : null;
  const releaseYear = release.year ?? published?.getUTCFullYear() ?? null;
  const releaseMonth = release.month ?? (published != null ? published.getUTCMonth() + 1 : null);
  const releaseDay = release.day ?? published?.getUTCDate() ?? null;
  if (releaseMonth == null || releaseDay == null) return false;

  const deviceYear = device.year;
  if (deviceYear != null && releaseYear != null) {
    const deviceDay = utcCalendarDay(deviceYear, device.month, device.day);
    const releaseDayMs = utcCalendarDay(releaseYear, releaseMonth, releaseDay);
    if (deviceDay == null || releaseDayMs == null) return false;
    return deviceDay < releaseDayMs;
  }
  if (releaseMonth !== device.month) return releaseMonth > device.month;
  return releaseDay > device.day;
}

/** Parses a MeshCore build date string like "19 Feb 2025" or "06-Jun-2026" into a Date (UTC midnight). */
export function parseMeshCoreBuildDate(buildDate: string): Date | null {
  const trimmed = buildDate.trim();
  if (!trimmed) return null;
  if (looksLikeMeshCoreSemverVersion(trimmed)) return null;
  const parsed = new Date(`${trimmed} UTC`);
  if (isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}
