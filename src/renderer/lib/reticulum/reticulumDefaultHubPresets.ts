import { validateReticulumI2pPeers } from '@/renderer/lib/reticulum/reticulumI2pPeerValidation';
import type { ReticulumInterfaceRow } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';
import { stripConnectHostBrackets } from '@/shared/connectHost';

export interface ReticulumDefaultHubPreset {
  id: string;
  name: string;
  type: 'tcp' | 'i2p';
  host: string;
  port?: number;
  group: 'testnet' | 'interop';
}

/** Official Main Testnet TCP/I2P bootstrap entries + Ratspeak interop hub. */
export const RETICULUM_DEFAULT_HUB_PRESETS: readonly ReticulumDefaultHubPreset[] = [
  {
    id: 'testnet-dublin',
    name: 'RNS Testnet Dublin',
    type: 'tcp',
    host: 'dublin.connect.reticulum.network',
    port: 4965,
    group: 'testnet',
  },
  {
    id: 'testnet-betweentheborders',
    name: 'RNS Testnet BetweenTheBorders',
    type: 'tcp',
    host: 'reticulum.betweentheborders.com',
    port: 4242,
    group: 'testnet',
  },
  {
    id: 'testnet-us-east',
    name: 'RNS_Transport_US-East',
    type: 'tcp',
    host: '45.77.109.86',
    port: 4965,
    group: 'testnet',
  },
  {
    id: 'testnet-i2p-a',
    name: 'RNS Testnet I2P Hub A',
    type: 'i2p',
    host: 'g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p',
    group: 'testnet',
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
  return stripConnectHostBrackets(host.trim()).toLowerCase();
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
  iface: Pick<ReticulumInterfaceRow, 'type' | 'name' | 'host' | 'port'>,
  preset: ReticulumDefaultHubPreset,
): boolean {
  return reticulumInterfaceMatchesHubPreset(iface, preset) && iface.name === preset.name;
}

export function buildDefaultHubRepairPatch(
  iface: Pick<ReticulumInterfaceRow, 'type' | 'name' | 'host' | 'port'>,
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
  return Object.keys(patch).length > 0 ? patch : null;
}

export interface DefaultHubPresetSyncRepair {
  preset: ReticulumDefaultHubPreset;
  iface: ReticulumInterfaceRow;
  patch: Record<string, unknown>;
}

export interface DefaultHubPresetSyncPlan {
  skip: ReticulumDefaultHubPreset[];
  add: ReticulumDefaultHubPreset[];
  repair: DefaultHubPresetSyncRepair[];
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

  return { skip, add, repair };
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
  phase: 'add' | 'repair';
  error: string;
}

export interface DefaultHubPresetsSyncResult {
  added: number;
  repaired: number;
  skipped: number;
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
    failed: [],
  };

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
