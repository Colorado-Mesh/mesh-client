import type { RadarProviderId } from './types';
import type { LatLonBounds } from './validation';

export const US_NEXRAD_BOUNDS: LatLonBounds = {
  north: 50.0,
  south: 24.0,
  west: -125.0,
  east: -66.0,
};

export const RAINVIEWER_MAX_NATIVE_ZOOM = 7;
export const IEM_NEXRAD_MAX_NATIVE_ZOOM = 10;

export const RAINVIEWER_ATTRIBUTION =
  'Weather data by <a href="https://www.rainviewer.com/">RainViewer</a>';
export const IEM_NEXRAD_ATTRIBUTION =
  'NEXRAD composite © <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a>, NOAA/NWS';

export interface RadarProviderInfo {
  id: RadarProviderId;
  labelKey: string;
  attribution: string;
  maxNativeZoom: number;
  supportsCoverage: boolean;
}

export const RADAR_PROVIDERS: readonly RadarProviderInfo[] = [
  {
    id: 'rainviewer',
    labelKey: 'internetWeather.providerRainViewer',
    attribution: RAINVIEWER_ATTRIBUTION,
    maxNativeZoom: RAINVIEWER_MAX_NATIVE_ZOOM,
    supportsCoverage: true,
  },
  {
    id: 'iem-nexrad',
    labelKey: 'internetWeather.providerNexrad',
    attribution: IEM_NEXRAD_ATTRIBUTION,
    maxNativeZoom: IEM_NEXRAD_MAX_NATIVE_ZOOM,
    supportsCoverage: false,
  },
];

function boundsIntersect(a: LatLonBounds, b: LatLonBounds): boolean {
  if (a.north < b.south || a.south > b.north) return false;
  const aWraps = a.east < a.west;
  const bWraps = b.east < b.west;
  if (!aWraps && !bWraps) {
    return !(a.east < b.west || a.west > b.east);
  }
  return true;
}

/** IEM inside CONUS at zoom >= 5; RainViewer otherwise. */
export function selectRadarProvider(
  bounds: LatLonBounds,
  zoom: number,
  preference: 'auto' | RadarProviderId,
): RadarProviderId {
  if (preference === 'rainviewer' || preference === 'iem-nexrad') return preference;
  if (zoom >= 5 && boundsIntersect(bounds, US_NEXRAD_BOUNDS)) return 'iem-nexrad';
  return 'rainviewer';
}

/** IEM layer name for a lag in minutes: 0 → nexrad-n0q-900913, 5 → nexrad-n0q-m05m-900913. */
export function iemNexradLayer(lagMinutes: number): string {
  const lag = Math.max(0, Math.min(55, Math.floor(lagMinutes / 5) * 5));
  if (lag === 0) return 'nexrad-n0q-900913';
  const padded = String(lag).padStart(2, '0');
  return `nexrad-n0q-m${padded}m-900913`;
}

export function buildIemNexradUrl(layer: string, z: number, x: number, y: number): string {
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/${layer}/${z}/${x}/${y}.png`;
}

export function buildRainViewerRadarUrl(
  host: string,
  path: string,
  z: number,
  x: number,
  y: number,
): string {
  const base = host.replace(/\/$/, '');
  return `${base}${path}/256/${z}/${x}/${y}/2/1_1.png`;
}

export function buildRainViewerCoverageUrl(host: string, z: number, x: number, y: number): string {
  const base = host.replace(/\/$/, '');
  return `${base}/v2/coverage/0/256/${z}/${x}/${y}/0/0_0.png`;
}

export const RAINVIEWER_MANIFEST_URL = 'https://api.rainviewer.com/public/weather-maps.json';
export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
