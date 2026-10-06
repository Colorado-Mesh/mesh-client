import { sanitizeLogMessage } from '../sanitize-log-message';
import { pickBestCandidate } from './gazetteer';

export const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REQUEST_TIMEOUT_MS = 8000;
const MIN_INTERVAL_MS = 1000;

export interface OnlineGeocodeResult {
  lat: number;
  lon: number;
  population?: number;
  label: string;
}

interface OpenMeteoResult {
  latitude?: unknown;
  longitude?: unknown;
  population?: unknown;
  name?: unknown;
  admin1?: unknown;
  country_code?: unknown;
}

let nextAllowedAt = 0;
let chain: Promise<unknown> = Promise.resolve();

export function resetOpenMeteoRateLimitForTests(): void {
  nextAllowedAt = 0;
  chain = Promise.resolve();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toCandidate(r: OpenMeteoResult): (OnlineGeocodeResult & { population?: number }) | null {
  if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null;
  if (!Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) return null;
  const label = [r.name, r.admin1, r.country_code]
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(', ');
  return {
    lat: r.latitude,
    lon: r.longitude,
    ...(typeof r.population === 'number' ? { population: r.population } : {}),
    label,
  };
}

/**
 * Geocode a place via Open-Meteo (GeoNames-backed, no key). `name, qualifier` uses Open-Meteo's
 * admin1/country qualifier syntax. Calls are serialized to one request per second; a rate-limit
 * wait is not a miss. Failures return null.
 */
export async function geocodeOpenMeteo(
  name: string,
  qualifiers: readonly string[],
  near?: { lat: number; lon: number },
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<OnlineGeocodeResult | null> {
  const run = async (): Promise<OnlineGeocodeResult | null> => {
    const start = now();
    const wait = Math.max(0, nextAllowedAt - start);
    nextAllowedAt = Math.max(nextAllowedAt, start) + MIN_INTERVAL_MS;
    if (wait > 0) await sleep(wait);
    return requestOpenMeteo(name, qualifiers, near, fetchImpl);
  };
  const task = chain.then(run, run);
  chain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function requestOpenMeteo(
  name: string,
  qualifiers: readonly string[],
  near: { lat: number; lon: number } | undefined,
  fetchImpl: typeof fetch,
): Promise<OnlineGeocodeResult | null> {
  const query = qualifiers.length > 0 ? `${name}, ${qualifiers[0]}` : name;
  const url = `${OPEN_METEO_GEOCODE_URL}?${new URLSearchParams({
    name: query,
    count: '10',
    language: 'en',
    format: 'json',
  }).toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'mesh-client (weather forecast map layer)' },
    });
    if (!res.ok) {
      console.warn(`[geo] Open-Meteo geocode HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { results?: unknown };
    const results = Array.isArray(body.results) ? (body.results as OpenMeteoResult[]) : [];
    const candidates = results.map(toCandidate).filter((c): c is OnlineGeocodeResult => c !== null);
    return pickBestCandidate(candidates, near);
  } catch (err) {
    console.warn(
      '[geo] Open-Meteo geocode failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
