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

export interface ReticulumDefaultHubPreset {
  id: string;
  name: string;
  type: 'tcp' | 'i2p';
  host: string;
  port?: number;
  group: 'backbone' | 'interop';
}

/**
 * Community / backbone bootstrap entries (official public testnet hubs like Dublin
 * and BetweenTheBorders were decommissioned — do not re-add them here).
 *
 * Yggdrasil entries use TCPClientInterface against directory Backbone remotes
 * (types are interchangeable for outbound connect). Added disabled — enable only
 * when a local Yggdrasil tunnel is up.
 */
export const RETICULUM_DEFAULT_HUB_PRESETS: readonly ReticulumDefaultHubPreset[] = [
  {
    id: 'backbone-us-east',
    name: 'RNS_Transport_US-East',
    type: 'tcp',
    host: '45.77.109.86',
    port: 4965,
    group: 'backbone',
  },
  {
    id: 'backbone-i2p-a',
    name: 'RNS I2P Hub A',
    type: 'i2p',
    host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
    group: 'backbone',
  },
  {
    id: 'yggdrasil-ashburn-va',
    name: 'Yggdrasil_Ashburn_VA',
    type: 'tcp',
    host: '201:ac2f:89eb:2afe:5f3d:9db9:a7e9:2f75',
    port: 4343,
    group: 'backbone',
  },
  {
    id: 'ratspeak',
    name: 'Ratspeak',
    type: 'tcp',
    host: 'rns.ratspeak.org',
    port: 4242,
    group: 'interop',
  },
  {
    id: 'rmap-world',
    name: 'RMAP World',
    type: 'tcp',
    host: 'rmap.world',
    port: 4242,
    group: 'interop',
  },
];

export const RETICULUM_RMAP_WORLD_HUB_PRESET = RETICULUM_DEFAULT_HUB_PRESETS.find(
  (preset) => preset.id === 'rmap-world',
)!;

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
): DefaultHubPresetSyncPlan {
  const skip: ReticulumDefaultHubPreset[] = [];
  const add: ReticulumDefaultHubPreset[] = [];
  const repair: DefaultHubPresetSyncRepair[] = [];

  for (const preset of RETICULUM_DEFAULT_HUB_PRESETS) {
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
): Promise<{ plan: DefaultHubPresetSyncPlan; result: DefaultHubPresetsSyncResult }> {
  const plan = planDefaultHubPresetsSync(interfaces);
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
    if (res?.ok === false) {
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
    if (res?.ok === false) {
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
    if (res?.ok === false) {
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
