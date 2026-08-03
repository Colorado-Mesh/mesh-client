/** Community directory of live Reticulum backbone / entrypoint interface definitions. */
export const RETICULUM_BACKBONE_DIRECTORY_URL = 'https://directory.rns.recipes/';

/**
 * Historical official-testnet TCP endpoints that no longer accept connections.
 * Keep in sync with reticulum-sidecar `ensure_decommissioned_hubs_disabled` hosts/ports.
 */
export interface ReticulumDecommissionedHubEndpoint {
  id: string;
  /** Any historical hostname for this dead hub (compared case-insensitively). */
  hosts: readonly string[];
  port: number;
}

export const RETICULUM_DECOMMISSIONED_HUB_ENDPOINTS: readonly ReticulumDecommissionedHubEndpoint[] =
  [
    {
      id: 'decommissioned-amsterdam',
      hosts: ['amsterdam.connect.reticulum.network'],
      port: 4965,
    },
  ];

export function normalizeReticulumTcpHubHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim().toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function isDecommissionedReticulumTcpHub(host: string, port: number): boolean {
  const normalized = normalizeReticulumTcpHubHost(host);
  return RETICULUM_DECOMMISSIONED_HUB_ENDPOINTS.some(
    (endpoint) =>
      endpoint.port === port &&
      endpoint.hosts.some((h) => normalizeReticulumTcpHubHost(h) === normalized),
  );
}

/** True when an interface row is a TCP client pointed at a decommissioned hub endpoint. */
export function isDecommissionedReticulumTcpInterfaceRow(iface: {
  type: string;
  host?: string | null;
  port?: number | null;
}): boolean {
  if (iface.type.toLowerCase() !== 'tcp') return false;
  if (typeof iface.host !== 'string' || typeof iface.port !== 'number') return false;
  return isDecommissionedReticulumTcpHub(iface.host, iface.port);
}
