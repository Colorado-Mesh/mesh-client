const MESHTASTIC_FIRMWARE_API = 'https://api.github.com/repos/meshtastic/firmware/releases/latest';
export const MESHTASTIC_FIRMWARE_RELEASES_URL = 'https://github.com/meshtastic/firmware/releases';

const MESHCORE_FIRMWARE_API = 'https://api.github.com/repos/meshcore-dev/MeshCore/releases/latest';
export const MESHCORE_FIRMWARE_RELEASES_URL = 'https://github.com/meshcore-dev/MeshCore/releases';

const FIRMWARE_CHECK_TIMEOUT_MS = 10_000;

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
  const semverInTag = /v(\d+\.\d+\.\d+|\d+\.\d+)/i.exec(trimmed);
  if (semverInTag) return semverInTag[1];
  const bareSemver = /^(\d+\.\d+\.\d+|\d+\.\d+)/.exec(trimmed);
  if (bareSemver) return bareSemver[1];
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

async function fetchWithAbortTimeout(url: string): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort();
  }, FIRMWARE_CHECK_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ac.signal,
      headers: { Accept: 'application/vnd.github+json' },
    });
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
  const raw = new Date(data.published_at);
  return {
    publishedAt: new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate())),
    version: normalizeMeshCoreVersionTag(data.tag_name),
    releaseUrl: data.html_url,
  };
}

/** Parses a MeshCore build date string like "19 Feb 2025" or "06-Jun-2026" into a Date (UTC midnight). */
export function parseMeshCoreBuildDate(buildDate: string): Date | null {
  const trimmed = buildDate.trim();
  if (!trimmed) return null;
  if (looksLikeMeshCoreSemverVersion(trimmed)) return null;
  const parsed = new Date(`${trimmed} UTC`);
  if (isNaN(parsed.getTime())) return null;
  return parsed;
}
