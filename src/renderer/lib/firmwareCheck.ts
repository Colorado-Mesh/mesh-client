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
    version: data.tag_name.replace(/^v/, ''),
    releaseUrl: data.html_url,
  };
}

/** Parses a MeshCore build date string like "19 Feb 2025" into a Date (UTC midnight). */
export function parseMeshCoreBuildDate(buildDate: string): Date | null {
  const trimmed = buildDate.trim();
  if (!trimmed) return null;
  const parsed = new Date(`${trimmed} UTC`);
  if (isNaN(parsed.getTime())) return null;
  return parsed;
}
