import { MS_PER_MINUTE } from '@/shared/timeConstants';
import {
  IEM_NEXRAD_ATTRIBUTION,
  IEM_NEXRAD_MAX_NATIVE_ZOOM,
  iemNexradLayer,
} from '@/shared/weather/radarProviders';
import type { RadarFrame, RadarFrames } from '@/shared/weather/types';

const LAGS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;

export function radarBucketMs(nowMs: number): number {
  const step = 5 * MS_PER_MINUTE;
  return Math.floor(nowMs / step) * step;
}

export function iemFrames(nowMs: number): RadarFrames {
  const bucket = radarBucketMs(nowMs);
  // Oldest first / newest last — matches renderer playback (index 0 → length-1).
  const ascendingLags = [...LAGS].reverse();
  const frames: RadarFrame[] = ascendingLags.map((lag) => ({
    provider: 'iem-nexrad' as const,
    id: String(lag),
    timeMs: bucket - lag * MS_PER_MINUTE,
    kind: 'past' as const,
    tileUrlTemplate: `mesh-weather://radar/iem/${lag}/{z}/{x}/{y}.png?t=${bucket}`,
  }));
  return {
    provider: 'iem-nexrad',
    fetchedAtMs: nowMs,
    maxNativeZoom: IEM_NEXRAD_MAX_NATIVE_ZOOM,
    frames,
    attribution: IEM_NEXRAD_ATTRIBUTION,
    coverageUrlTemplate: null,
  };
}

export function iemUpstreamLayer(lagMinutes: number): string {
  return iemNexradLayer(lagMinutes);
}

export { LAGS as IEM_RADAR_LAGS };
