import { validateReticulumI2pPeers } from '@/renderer/lib/reticulum/reticulumI2pPeerValidation';
import {
  normalizeReticulumInterfaceMode,
  RETICULUM_HUB_INTERFACE_MODE,
} from '@/renderer/lib/reticulum/reticulumInterfaceMode';
import type { ReticulumInterfaceRow } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';
import {
  isDecommissionedReticulumTcpHub,
  normalizeReticulumTcpHubHost,
  RETICULUM_DECOMMISSIONED_HUB_ENDPOINTS,
  type ReticulumDecommissionedHubEndpoint,
} from '@/shared/reticulumDecommissionedHubs';

export type { ReticulumDecommissionedHubEndpoint };
export { RETICULUM_DECOMMISSIONED_HUB_ENDPOINTS };

export type ReticulumDefaultHubRegion =
  'primary_global' | 'north_america' | 'europe' | 'asia_oceania' | 'specialty';

export interface ReticulumDefaultHubPreset {
  id: string;
  name: string;
  type: 'tcp' | 'i2p';
  host: string;
  port?: number;
  region: ReticulumDefaultHubRegion;
}

/** Ordered region groups for the Add default hubs picker. */
export const RETICULUM_DEFAULT_HUB_REGIONS: readonly ReticulumDefaultHubRegion[] = [
  'primary_global',
  'north_america',
  'europe',
  'asia_oceania',
  'specialty',
] as const;

/**
 * Community / backbone bootstrap entries for **Add default network hubs**.
 * Grouped by region for the picker (Primary & Global selected by default).
 *
 * Yggdrasil entries use TCPClientInterface against directory Backbone remotes
 * (types are interchangeable for outbound connect). Added disabled — enable only
 * when a local Yggdrasil tunnel is up.
 */
export const RETICULUM_DEFAULT_HUB_PRESETS: readonly ReticulumDefaultHubPreset[] = [
  // Primary & Global Backbone
  {
    id: 'dublin-mainnet',
    name: 'RNS Dublin Mainnet',
    type: 'tcp',
    host: 'dublin.connect.reticulum.network',
    port: 4965,
    region: 'primary_global',
  },
  {
    id: 'between-the-borders',
    name: 'RNS Between The Borders',
    type: 'tcp',
    host: 'reticulum.betweentheborders.com',
    port: 4242,
    region: 'primary_global',
  },
  {
    id: 'rmap-world',
    name: 'RMAP World',
    type: 'tcp',
    host: 'rmap.world',
    port: 4242,
    region: 'primary_global',
  },
  {
    id: 'simply-equipped',
    name: 'RNS Simply Equipped',
    type: 'tcp',
    host: 'rns.simplyequipped.com',
    port: 4242,
    region: 'primary_global',
  },
  {
    id: 'beleth',
    name: 'RNS Beleth',
    type: 'tcp',
    host: 'rns.beleth.net',
    port: 4242,
    region: 'primary_global',
  },
  // North America
  {
    id: 'backbone-us-east',
    name: 'RNS_Transport_US-East',
    type: 'tcp',
    host: '45.77.109.86',
    port: 4965,
    region: 'north_america',
  },
  {
    id: 'dfw-central',
    name: 'RNS DFW Central',
    type: 'tcp',
    host: 'dfw.us.g00n.cloud',
    port: 6969,
    region: 'north_america',
  },
  {
    id: 'acehoss',
    name: 'RNS AceHoss',
    type: 'tcp',
    host: 'rns.acehoss.net',
    port: 4242,
    region: 'north_america',
  },
  {
    id: 'firezen',
    name: 'RNS FireZen',
    type: 'tcp',
    host: 'firezen.com',
    port: 4242,
    region: 'north_america',
  },
  {
    id: 'washmesh',
    name: 'RNS WashMesh',
    type: 'tcp',
    host: 'reticulum.washmesh.net',
    port: 7242,
    region: 'north_america',
  },
  {
    id: 'michmesh',
    name: 'MichMesh',
    type: 'tcp',
    host: 'rns.michmesh.net',
    port: 7822,
    region: 'north_america',
  },
  // Europe
  {
    id: 'sweden-bnz',
    name: 'RNS Sweden bnZ',
    type: 'tcp',
    host: 'node01.rns.bnz.se',
    port: 4242,
    region: 'europe',
  },
  {
    id: 'germany-rtclm',
    name: 'RNS Germany rtclm',
    type: 'tcp',
    host: 'rtclm.de',
    port: 4242,
    region: 'europe',
  },
  {
    id: 'germany-dismail',
    name: 'RNS Germany Dismail',
    type: 'tcp',
    host: 'rns.dismail.de',
    port: 7822,
    region: 'europe',
  },
  {
    id: 'belgium-on6zq',
    name: 'RNS Belgium ON6ZQ',
    type: 'tcp',
    host: 'reticulum.on6zq.be',
    port: 4965,
    region: 'europe',
  },
  {
    id: 'quad4',
    name: 'RNS Quad4',
    type: 'tcp',
    host: 'rns.quad4.io',
    port: 4242,
    region: 'europe',
  },
  {
    id: 'istanbul',
    name: 'RNS Istanbul',
    type: 'tcp',
    host: 'istanbul.reserve.network',
    port: 9034,
    region: 'europe',
  },
  {
    id: 'uberspace',
    name: 'RNS UberSpace',
    type: 'tcp',
    host: 'aspark.uber.space',
    port: 44860,
    region: 'europe',
  },
  {
    id: 'nodns1',
    name: 'noDNS1',
    type: 'tcp',
    host: '202.61.243.41',
    port: 4965,
    region: 'europe',
  },
  {
    id: 'nodns2',
    name: 'noDNS2',
    type: 'tcp',
    host: '193.26.158.230',
    port: 4965,
    region: 'europe',
  },
  {
    id: 'vienna-backbone',
    name: 'AT-Vienna-Backbone',
    type: 'tcp',
    host: 'rns.radical.computer',
    port: 4242,
    region: 'europe',
  },
  // Asia & Oceania
  {
    id: 'sydney-australia',
    name: 'RNS Sydney Australia',
    type: 'tcp',
    host: 'sydney.reticulum.au',
    port: 4242,
    region: 'asia_oceania',
  },
  {
    id: 'china',
    name: 'RNS China',
    type: 'tcp',
    host: 'rns.net.cn',
    port: 4242,
    region: 'asia_oceania',
  },
  {
    id: 'se-asia',
    name: 'RNS SE Asia',
    type: 'tcp',
    host: 'rns.jaykayenn.net',
    port: 4242,
    region: 'asia_oceania',
  },
  {
    id: 'nexus-backbone-ph',
    name: 'Nexus BackbonePH',
    type: 'tcp',
    host: '212.227.208.95',
    port: 4242,
    region: 'asia_oceania',
  },
  // Specialty
  {
    id: 'backbone-i2p-a',
    name: 'RNS I2P Hub A',
    type: 'i2p',
    host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
    region: 'specialty',
  },
  {
    id: 'yggdrasil-ashburn-va',
    name: 'Yggdrasil_Ashburn_VA',
    type: 'tcp',
    host: '201:ac2f:89eb:2afe:5f3d:9db9:a7e9:2f75',
    port: 4343,
    region: 'specialty',
  },
  {
    id: 'ratspeak',
    name: 'Ratspeak & Colorado Mesh',
    type: 'tcp',
    host: 'rns.ratspeak.org',
    port: 4242,
    region: 'specialty',
  },
];

export const RETICULUM_RMAP_WORLD_HUB_PRESET = RETICULUM_DEFAULT_HUB_PRESETS.find(
  (preset) => preset.id === 'rmap-world',
)!;

export function presetsForDefaultHubRegion(
  region: ReticulumDefaultHubRegion,
): readonly ReticulumDefaultHubPreset[] {
  return RETICULUM_DEFAULT_HUB_PRESETS.filter((preset) => preset.region === region);
}

/** Default picker selection: Primary & Global only. */
export function defaultSelectedDefaultHubPresetIds(): Set<string> {
  return new Set(
    RETICULUM_DEFAULT_HUB_PRESETS.filter((p) => p.region === 'primary_global').map((p) => p.id),
  );
}

export function formatDefaultHubPresetEndpoint(preset: ReticulumDefaultHubPreset): string {
  if (preset.type === 'i2p') {
    const host = preset.host;
    if (host.length <= 28) return host;
    return `${host.slice(0, 12)}…${host.slice(-10)}`;
  }
  return preset.port != null ? `${preset.host}:${preset.port}` : preset.host;
}

export type ReticulumInterfaceListGroupId = ReticulumDefaultHubRegion | 'user_defined';

export interface ReticulumInterfaceListGroup {
  id: ReticulumInterfaceListGroupId;
  interfaces: ReticulumInterfaceRow[];
}

function findPresetForInterfaceEndpoint(
  iface: Pick<ReticulumInterfaceRow, 'host' | 'port'>,
): ReticulumDefaultHubPreset | undefined {
  return RETICULUM_DEFAULT_HUB_PRESETS.find((preset) =>
    reticulumInterfaceMatchesHubEndpoint(iface, preset),
  );
}

/** Count enabled interfaces that match any default backbone preset. */
export function countEnabledDefaultHubPresets(
  interfaces: readonly Pick<ReticulumInterfaceRow, 'enabled' | 'host' | 'port'>[],
): number {
  let count = 0;
  for (const iface of interfaces) {
    if (!iface.enabled) continue;
    if (findPresetForInterfaceEndpoint(iface)) count += 1;
  }
  return count;
}

/**
 * Group configured interfaces by default-backbone region, then User Defined.
 * Empty regions are omitted. Within a region, order follows the preset catalog.
 */
export function groupReticulumInterfacesByHubRegion(
  interfaces: readonly ReticulumInterfaceRow[],
): ReticulumInterfaceListGroup[] {
  const byPresetId = new Map<string, ReticulumInterfaceRow>();
  const userDefined: ReticulumInterfaceRow[] = [];

  for (const iface of interfaces) {
    const preset = findPresetForInterfaceEndpoint(iface);
    if (!preset) {
      userDefined.push(iface);
      continue;
    }
    // First match wins if duplicates share an endpoint.
    if (!byPresetId.has(preset.id)) {
      byPresetId.set(preset.id, iface);
    } else {
      userDefined.push(iface);
    }
  }

  const groups: ReticulumInterfaceListGroup[] = [];
  for (const region of RETICULUM_DEFAULT_HUB_REGIONS) {
    const rows: ReticulumInterfaceRow[] = [];
    for (const preset of presetsForDefaultHubRegion(region)) {
      const row = byPresetId.get(preset.id);
      if (row) rows.push(row);
    }
    if (rows.length > 0) {
      groups.push({ id: region, interfaces: rows });
    }
  }
  if (userDefined.length > 0) {
    groups.push({ id: 'user_defined', interfaces: userDefined });
  }
  return groups;
}

export interface DefaultHubPresetsSyncOptions {
  /** When set, only these presets are considered for add/repair/skip. Decommissioned disable always runs. */
  presetIds?: ReadonlySet<string>;
}

function normalizeTcpHubHost(host: string): string {
  return normalizeReticulumTcpHubHost(host);
}

function normalizeI2pPeer(peer: string): string {
  return peer.trim().toLowerCase();
}

export function reticulumInterfaceMatchesHubPreset(
  iface: Pick<ReticulumInterfaceRow, 'type' | 'host' | 'port'>,
  preset: ReticulumDefaultHubPreset,
): boolean {
  if (iface.type !== preset.type) {
    return false;
  }
  const ifaceHost = iface.host?.trim();
  if (!ifaceHost) {
    return false;
  }
  if (preset.type === 'i2p') {
    return normalizeI2pPeer(ifaceHost) === normalizeI2pPeer(preset.host);
  }
  if (iface.port !== preset.port) {
    return false;
  }
  return normalizeTcpHubHost(ifaceHost) === normalizeTcpHubHost(preset.host);
}

export function reticulumInterfaceMatchesHubEndpoint(
  iface: Pick<ReticulumInterfaceRow, 'host' | 'port'>,
  preset: ReticulumDefaultHubPreset,
): boolean {
  const ifaceHost = iface.host?.trim();
  if (!ifaceHost) {
    return false;
  }
  if (preset.type === 'i2p') {
    return normalizeI2pPeer(ifaceHost) === normalizeI2pPeer(preset.host);
  }
  if (iface.port !== preset.port) {
    return false;
  }
  return normalizeTcpHubHost(ifaceHost) === normalizeTcpHubHost(preset.host);
}

export function findInterfaceForHubPresetEndpoint(
  interfaces: readonly ReticulumInterfaceRow[],
  preset: ReticulumDefaultHubPreset,
): ReticulumInterfaceRow | undefined {
  return interfaces.find((iface) => reticulumInterfaceMatchesHubEndpoint(iface, preset));
}

function interfaceFullyMatchesDefaultHubPreset(
  iface: Pick<ReticulumInterfaceRow, 'type' | 'name' | 'host' | 'port' | 'mode'>,
  preset: ReticulumDefaultHubPreset,
): boolean {
  // Any valid canonical mode counts; missing/invalid mode needs repair → boundary.
  const modeOk = normalizeReticulumInterfaceMode(iface.mode) != null;
  return reticulumInterfaceMatchesHubPreset(iface, preset) && iface.name === preset.name && modeOk;
}

export function buildDefaultHubRepairPatch(
  iface: Pick<ReticulumInterfaceRow, 'type' | 'name' | 'host' | 'port' | 'mode'>,
  preset: ReticulumDefaultHubPreset,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (iface.name !== preset.name) {
    patch.name = preset.name;
  }
  if (iface.type !== preset.type) {
    patch.type = preset.type;
  }
  const ifaceHost = iface.host?.trim() ?? '';
  if (ifaceHost !== preset.host) {
    patch.host = preset.host;
  }
  if (preset.type === 'tcp' && preset.port != null && iface.port !== preset.port) {
    patch.port = preset.port;
  }
  // Only fill missing/invalid mode; do not overwrite a user-chosen valid mode.
  if (normalizeReticulumInterfaceMode(iface.mode) == null) {
    patch.mode = RETICULUM_HUB_INTERFACE_MODE;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

export function reticulumInterfaceMatchesDecommissionedHub(
  iface: Pick<ReticulumInterfaceRow, 'type' | 'host' | 'port' | 'enabled'>,
  endpoint: ReticulumDecommissionedHubEndpoint,
): boolean {
  if (iface.type !== 'tcp' || !iface.enabled) {
    return false;
  }
  const ifaceHost = iface.host?.trim();
  if (!ifaceHost || iface.port == null) {
    return false;
  }
  // Match by shared catalog; still require this endpoint id for plan grouping.
  if (!isDecommissionedReticulumTcpHub(ifaceHost, iface.port)) {
    return false;
  }
  const normalized = normalizeTcpHubHost(ifaceHost);
  return (
    iface.port === endpoint.port &&
    endpoint.hosts.some((host) => normalizeTcpHubHost(host) === normalized)
  );
}

export interface DefaultHubPresetSyncRepair {
  preset: ReticulumDefaultHubPreset;
  iface: ReticulumInterfaceRow;
  patch: Record<string, unknown>;
}

export interface DecommissionedHubDisableRepair {
  endpoint: ReticulumDecommissionedHubEndpoint;
  iface: ReticulumInterfaceRow;
  patch: { enabled: false };
}

export interface DefaultHubPresetSyncPlan {
  skip: ReticulumDefaultHubPreset[];
  add: ReticulumDefaultHubPreset[];
  repair: DefaultHubPresetSyncRepair[];
  /** Enabled interfaces pointed at known-dead hubs → disable. */
  disableDecommissioned: DecommissionedHubDisableRepair[];
}

export function planDefaultHubPresetsSync(
  interfaces: readonly ReticulumInterfaceRow[],
  options?: DefaultHubPresetsSyncOptions,
): DefaultHubPresetSyncPlan {
  const skip: ReticulumDefaultHubPreset[] = [];
  const add: ReticulumDefaultHubPreset[] = [];
  const repair: DefaultHubPresetSyncRepair[] = [];
  const selected = options?.presetIds;

  for (const preset of RETICULUM_DEFAULT_HUB_PRESETS) {
    if (selected && !selected.has(preset.id)) {
      continue;
    }
    const existing = findInterfaceForHubPresetEndpoint(interfaces, preset);
    if (!existing) {
      add.push(preset);
      continue;
    }
    if (interfaceFullyMatchesDefaultHubPreset(existing, preset)) {
      skip.push(preset);
      continue;
    }
    const patch = buildDefaultHubRepairPatch(existing, preset);
    if (patch) {
      repair.push({ preset, iface: existing, patch });
    } else {
      skip.push(preset);
    }
  }

  const disableDecommissioned: DecommissionedHubDisableRepair[] = [];
  for (const endpoint of RETICULUM_DECOMMISSIONED_HUB_ENDPOINTS) {
    for (const iface of interfaces) {
      if (reticulumInterfaceMatchesDecommissionedHub(iface, endpoint)) {
        disableDecommissioned.push({
          endpoint,
          iface,
          patch: { enabled: false },
        });
      }
    }
  }

  return { skip, add, repair, disableDecommissioned };
}

export function listMissingDefaultHubPresets(
  interfaces: readonly Pick<ReticulumInterfaceRow, 'type' | 'host' | 'port' | 'name' | 'id'>[],
): ReticulumDefaultHubPreset[] {
  return planDefaultHubPresetsSync(interfaces as ReticulumInterfaceRow[]).add;
}

export function buildDefaultHubAddRequest(
  preset: ReticulumDefaultHubPreset,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    type: preset.type,
    name: preset.name,
    host: preset.host,
    enabled: false,
    mode: RETICULUM_HUB_INTERFACE_MODE,
  };
  if (preset.type === 'tcp' && preset.port != null) {
    body.port = preset.port;
  }
  return body;
}

export function isDefaultHubPresetAddable(preset: ReticulumDefaultHubPreset): boolean {
  if (preset.type !== 'i2p') {
    return true;
  }
  return validateReticulumI2pPeers(preset.host) === null;
}

export interface DefaultHubPresetSyncFailure {
  presetId: string;
  phase: 'add' | 'repair' | 'disable';
  error: string;
}

export interface DefaultHubPresetsSyncResult {
  added: number;
  repaired: number;
  skipped: number;
  /** Enabled decommissioned hubs that were disabled. */
  disabledDecommissioned: number;
  failed: DefaultHubPresetSyncFailure[];
}

type ReticulumHubSyncApi = Pick<typeof window.electronAPI.reticulum, 'proxyPost' | 'proxyPut'>;

/** Apply sync plan via sidecar IPC; continues on individual preset failures. */
export async function applyDefaultHubPresetsSync(
  interfaces: readonly ReticulumInterfaceRow[],
  api: ReticulumHubSyncApi,
  options?: DefaultHubPresetsSyncOptions,
): Promise<{ plan: DefaultHubPresetSyncPlan; result: DefaultHubPresetsSyncResult }> {
  const plan = planDefaultHubPresetsSync(interfaces, options);
  const result: DefaultHubPresetsSyncResult = {
    added: 0,
    repaired: 0,
    skipped: plan.skip.length,
    disabledDecommissioned: 0,
    failed: [],
  };

  for (const { iface, patch, endpoint } of plan.disableDecommissioned) {
    const res = (await api.proxyPut(`/api/v1/interfaces/${iface.id}`, patch)) as {
      ok?: boolean;
      error?: string;
    };
    if (res.ok === false) {
      result.failed.push({
        presetId: endpoint.id,
        phase: 'disable',
        error: res.error?.trim() || 'unknown',
      });
      console.debug(
        '[reticulumDefaultHubPresets] disable decommissioned hub failed',
        endpoint.id,
        res.error,
      );
      continue;
    }
    result.disabledDecommissioned += 1;
  }

  for (const { iface, patch, preset } of plan.repair) {
    const res = (await api.proxyPut(`/api/v1/interfaces/${iface.id}`, patch)) as {
      ok?: boolean;
      error?: string;
    };
    if (res.ok === false) {
      result.failed.push({
        presetId: preset.id,
        phase: 'repair',
        error: res.error?.trim() || 'unknown',
      });
      console.debug('[reticulumDefaultHubPresets] repair default hub failed', preset.id, res.error);
      continue;
    }
    result.repaired += 1;
  }

  for (const preset of plan.add) {
    if (!isDefaultHubPresetAddable(preset)) {
      result.failed.push({
        presetId: preset.id,
        phase: 'add',
        error: 'invalid i2p peer address',
      });
      console.debug('[reticulumDefaultHubPresets] skip unaddable default hub preset', preset.id);
      continue;
    }
    const res = (await api.proxyPost('/api/v1/interfaces', buildDefaultHubAddRequest(preset))) as {
      ok?: boolean;
      error?: string;
    };
    if (res.ok === false) {
      result.failed.push({
        presetId: preset.id,
        phase: 'add',
        error: res.error?.trim() || 'unknown',
      });
      console.debug('[reticulumDefaultHubPresets] add default hub failed', preset.id, res.error);
      continue;
    }
    result.added += 1;
  }

  return { plan, result };
}
