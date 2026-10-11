import type { RegionalFeedProvider } from '@/shared/beacon';

export interface RegionalFeedPreset {
  id: string;
  label: string;
  baseUrl: string;
  provider: RegionalFeedProvider;
}

export const COLORADO_BEACON_URL = 'https://map.meshcore.coloradomesh.org';

/** Public read-only Beacon services. Choosing one never starts a connection. */
export const BEACON_PRESETS: readonly RegionalFeedPreset[] = [
  { id: 'colorado', label: 'Colorado', baseUrl: COLORADO_BEACON_URL, provider: 'beacon' },
  {
    id: 'meshcore-canada',
    label: 'MeshCore Canada',
    baseUrl: 'https://live.meshcore.ca',
    provider: 'beacon',
  },
  {
    id: 'palouse-mesh',
    label: 'Palouse Mesh · Pacific Northwest',
    baseUrl: 'https://beacon.palouse-mesh.net',
    provider: 'beacon',
  },
  {
    id: 'meshat-sweden',
    label: 'Meshat · Sweden',
    baseUrl: 'https://beacon.meshat.se',
    provider: 'beacon',
  },
  {
    id: 'atviras-tinklas',
    label: 'Atviras Tinklas · Lithuania',
    baseUrl: 'https://beacon.atvirastinklas.lt',
    provider: 'beacon',
  },
  {
    id: 'eastmesh-australia',
    label: 'EastMesh · Australia',
    baseUrl: 'https://beacon.eastmesh.au',
    provider: 'beacon',
  },
  {
    id: 'meshcore-catalunya',
    label: 'MeshCore Catalunya · Spain',
    baseUrl: 'https://vista.livemap-meshcorecat.com',
    provider: 'beacon',
  },
  {
    id: 'meshmapper-worldwide',
    label: 'MeshMapper · Worldwide',
    baseUrl: 'https://analyzer.meshmapper.net',
    provider: 'beacon',
  },
  {
    id: 'bsmesh-germany',
    label: 'BSmesh · Braunschweig, Germany',
    baseUrl: 'https://analyzer.bsmesh.de',
    provider: 'beacon',
  },
];

/** CoreScope API services are separate from similarly named communities' Beacon deployments. */
export const CORESCOPE_PRESETS: readonly RegionalFeedPreset[] = [
  {
    id: 'boston-new-england',
    label: 'Boston · New England',
    baseUrl: 'https://analyzer.bostonme.sh',
    provider: 'corescope',
  },
  {
    id: 'chicagoland',
    label: 'Chicagoland',
    baseUrl: 'https://corescope.chicagolandmesh.org',
    provider: 'corescope',
  },
  {
    id: 'rhineland-germany',
    label: 'Rhineland · Germany',
    baseUrl: 'https://corescope.meshrheinland.de',
    provider: 'corescope',
  },
  {
    id: 'meshat-sweden',
    label: 'Meshat · Sweden',
    baseUrl: 'https://meshcore.meshat.se',
    provider: 'corescope',
  },
  {
    id: 'eastmesh-australia',
    label: 'EastMesh · Australia',
    baseUrl: 'https://core.eastmesh.au',
    provider: 'corescope',
  },
  {
    id: 'atviras-tinklas',
    label: 'Atviras Tinklas · Lithuania',
    baseUrl: 'https://meshcore.atvirastinklas.lt',
    provider: 'corescope',
  },
  {
    id: 'palouse-mesh',
    label: 'Palouse Mesh · Pacific Northwest',
    baseUrl: 'https://map.palouse-mesh.net',
    provider: 'corescope',
  },
];

export function getRegionalFeedPresets(
  provider: RegionalFeedProvider,
): readonly RegionalFeedPreset[] {
  return provider === 'corescope' ? CORESCOPE_PRESETS : BEACON_PRESETS;
}

/** Match only a clean service origin, preserving custom paths/credentials for normal validation. */
export function findRegionalFeedPreset(
  value: string,
  provider: RegionalFeedProvider,
): RegionalFeedPreset | undefined {
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      return undefined;
    }
    return getRegionalFeedPresets(provider).find((preset) => preset.baseUrl === url.origin);
  } catch {
    // catch-no-log-ok Draft URLs need not be valid until the user explicitly connects.
    return undefined;
  }
}

export function findBeaconPreset(value: string): RegionalFeedPreset | undefined {
  return findRegionalFeedPreset(value, 'beacon');
}
