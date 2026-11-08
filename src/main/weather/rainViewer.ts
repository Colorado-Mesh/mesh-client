import { RAINVIEWER_MANIFEST_URL } from '@/shared/weather/radarProviders';
import { WEATHER_JSON_MAX_BYTES } from '@/shared/weather/validation';

import {
  fetchBounded,
  WEATHER_JSON_TIMEOUT_MS,
  type WeatherFetchDeps,
  weatherUserAgent,
} from './http';

const ALLOWED_HOST = 'https://tilecache.rainviewer.com';
const PATH_RE = /^\/v2\/radar\/[A-Za-z0-9/_-]{1,128}$/;

export interface RainViewerManifest {
  host: string;
  generatedMs: number;
  frames: { timeMs: number; path: string; kind: 'past' | 'nowcast' }[];
}

export interface RainViewerDeps extends WeatherFetchDeps {
  getAppVersion: () => string;
}

export async function fetchRainViewerManifest(
  deps: RainViewerDeps,
): Promise<RainViewerManifest | null> {
  const result = await fetchBounded(RAINVIEWER_MANIFEST_URL, {
    timeoutMs: WEATHER_JSON_TIMEOUT_MS,
    maxBytes: WEATHER_JSON_MAX_BYTES,
    accept: 'application/json',
    userAgent: weatherUserAgent(deps.getAppVersion()),
    deps,
  });
  if (!result) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body.toString('utf8'));
  } catch {
    // catch-no-log-ok invalid JSON → treat as provider miss
    return null;
  }
  return parseRainViewerManifest(parsed);
}

export function parseRainViewerManifest(raw: unknown): RainViewerManifest | null {
  if (raw == null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const host = typeof obj.host === 'string' ? obj.host.replace(/\/$/, '') : '';
  if (host !== ALLOWED_HOST) return null;
  const generatedSec =
    typeof obj.generated === 'number' && Number.isFinite(obj.generated) ? obj.generated : null;
  if (generatedSec == null) return null;
  const radar =
    obj.radar != null && typeof obj.radar === 'object'
      ? (obj.radar as Record<string, unknown>)
      : {};
  const past = Array.isArray(radar.past) ? radar.past : [];
  const nowcast = Array.isArray(radar.nowcast) ? radar.nowcast : [];
  const frames: RainViewerManifest['frames'] = [];
  const push = (item: unknown, kind: 'past' | 'nowcast') => {
    if (item == null || typeof item !== 'object') return;
    const f = item as Record<string, unknown>;
    const time = typeof f.time === 'number' && Number.isFinite(f.time) ? f.time : null;
    const path = typeof f.path === 'string' ? f.path : null;
    if (time == null || path == null || !PATH_RE.test(path)) return;
    frames.push({ timeMs: time * 1000, path, kind });
  };
  for (const item of past) push(item, 'past');
  for (const item of nowcast) push(item, 'nowcast');
  frames.sort((a, b) => a.timeMs - b.timeMs);
  // Deduplicate by time, keep last
  const byTime = new Map<number, RainViewerManifest['frames'][number]>();
  for (const f of frames) byTime.set(f.timeMs, f);
  return {
    host,
    generatedMs: generatedSec * 1000,
    frames: [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs),
  };
}

export function pathForRainViewerTime(
  manifest: RainViewerManifest,
  timeSeconds: number,
): string | null {
  const timeMs = timeSeconds * 1000;
  const frame = manifest.frames.find((f) => f.timeMs === timeMs);
  return frame?.path ?? null;
}
