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

export function listMissingDefaultHubPresets(
  interfaces: readonly Pick<ReticulumInterfaceRow, 'type' | 'host' | 'port'>[],
): ReticulumDefaultHubPreset[] {
  return RETICULUM_DEFAULT_HUB_PRESETS.filter(
    (preset) => !interfaces.some((iface) => reticulumInterfaceMatchesHubPreset(iface, preset)),
  );
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
