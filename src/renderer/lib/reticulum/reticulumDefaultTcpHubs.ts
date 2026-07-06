import type { ReticulumInterfaceRow } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';
import { stripConnectHostBrackets } from '@/shared/connectHost';

export interface ReticulumDefaultTcpHub {
  id: 'testnet' | 'ratspeak';
  name: string;
  host: string;
  port: number;
}

export const RETICULUM_DEFAULT_TCP_HUBS: readonly ReticulumDefaultTcpHub[] = [
  {
    id: 'testnet',
    name: 'RNS Testnet',
    host: 'reticulum.betweentheborders.com',
    port: 4242,
  },
  {
    id: 'ratspeak',
    name: 'Ratspeak',
    host: 'rns.ratspeak.org',
    port: 4242,
  },
];

function normalizeTcpHubHost(host: string): string {
  return stripConnectHostBrackets(host.trim()).toLowerCase();
}

export function reticulumInterfaceMatchesTcpHub(
  iface: Pick<ReticulumInterfaceRow, 'type' | 'host' | 'port'>,
  hub: ReticulumDefaultTcpHub,
): boolean {
  if (iface.type !== 'tcp') {
    return false;
  }
  if (iface.port !== hub.port) {
    return false;
  }
  const ifaceHost = iface.host?.trim();
  if (!ifaceHost) {
    return false;
  }
  return normalizeTcpHubHost(ifaceHost) === normalizeTcpHubHost(hub.host);
}

export function listMissingDefaultTcpHubs(
  interfaces: readonly Pick<ReticulumInterfaceRow, 'type' | 'host' | 'port'>[],
): ReticulumDefaultTcpHub[] {
  return RETICULUM_DEFAULT_TCP_HUBS.filter(
    (hub) => !interfaces.some((iface) => reticulumInterfaceMatchesTcpHub(iface, hub)),
  );
}

export function buildDefaultTcpHubAddRequest(hub: ReticulumDefaultTcpHub): Record<string, unknown> {
  return {
    type: 'tcp',
    name: hub.name,
    host: hub.host,
    port: hub.port,
    enabled: false,
  };
}
