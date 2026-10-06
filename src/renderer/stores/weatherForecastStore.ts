import { create } from 'zustand';

import type {
  WeatherForecastProfileId,
  WeatherTempUnit,
} from '@/renderer/lib/weatherForecastParse';
import type { MeshProtocol } from '@/shared/meshProtocol';
import { MS_PER_HOUR } from '@/shared/timeConstants';

/** Forecasts older than this drop off the map. */
export const WEATHER_FORECAST_MAX_AGE_MS = 24 * MS_PER_HOUR;
export const MAX_WEATHER_FORECASTS = 300;
const MAX_SEGMENTS_PER_FORECAST = 12;

/**
 * Where the map position came from: a resolved place (`gazetteer` / `online` / `cache`), the node
 * that asked a requester-located bot (`requester`), or the bot's own position (`senderApprox`).
 */
export type WeatherForecastPositionSource =
  'gazetteer' | 'online' | 'cache' | 'requester' | 'senderApprox';

export interface WeatherForecastEntry {
  key: string;
  /** Place as written in the post; absent for requester-located forecasts. */
  placeLabel?: string;
  /** Gazetteer / geocoder label for the resolved place. */
  resolvedLabel?: string;
  lat: number;
  lon: number;
  population?: number;
  positionSource: WeatherForecastPositionSource;
  profileId: WeatherForecastProfileId;
  period: string;
  tempValue?: number;
  tempUnit?: WeatherTempUnit;
  highLow?: { high: number; low: number };
  summary: string;
  segments: string[];
  issuedAt?: string;
  hasAlerts: boolean;
  receivedAt: number;
  protocol: MeshProtocol;
  senderId: number;
  senderName?: string;
  requesterName?: string;
  messageId: string;
}

interface WeatherForecastState {
  entries: Record<string, WeatherForecastEntry>;
  /** Insert or replace; an older post never overwrites a newer one for the same key. */
  upsertForecast: (entry: WeatherForecastEntry, now?: number) => boolean;
  appendSegments: (key: string, messageId: string, segments: readonly string[]) => void;
  clearForecasts: () => void;
}

function pruneEntries(
  entries: Record<string, WeatherForecastEntry>,
  now: number,
): Record<string, WeatherForecastEntry> {
  const live = Object.values(entries).filter(
    (e) => now - e.receivedAt <= WEATHER_FORECAST_MAX_AGE_MS,
  );
  if (live.length > MAX_WEATHER_FORECASTS) {
    live.sort((a, b) => b.receivedAt - a.receivedAt);
    live.length = MAX_WEATHER_FORECASTS;
  }
  const out: Record<string, WeatherForecastEntry> = {};
  for (const e of live) out[e.key] = e;
  return out;
}

export const useWeatherForecastStore = create<WeatherForecastState>()((set, get) => ({
  entries: {},
  upsertForecast: (entry, now = Date.now()) => {
    if (now - entry.receivedAt > WEATHER_FORECAST_MAX_AGE_MS) return false;
    const existing = get().entries[entry.key];
    if (existing && existing.receivedAt > entry.receivedAt) return false;
    set((s) => ({ entries: pruneEntries({ ...s.entries, [entry.key]: entry }, now) }));
    return true;
  },
  appendSegments: (key, messageId, segments) => {
    const existing = get().entries[key];
    if (existing?.messageId !== messageId || segments.length === 0) return;
    const merged = [...existing.segments, ...segments].slice(0, MAX_SEGMENTS_PER_FORECAST);
    set((s) => ({ entries: { ...s.entries, [key]: { ...existing, segments: merged } } }));
  },
  clearForecasts: () => {
    set({ entries: {} });
  },
}));

/** Forecasts still within the max age, newest first. */
export function selectActiveForecasts(
  entries: Record<string, WeatherForecastEntry>,
  now: number,
): WeatherForecastEntry[] {
  return Object.values(entries)
    .filter((e) => now - e.receivedAt <= WEATHER_FORECAST_MAX_AGE_MS)
    .sort((a, b) => b.receivedAt - a.receivedAt);
}
