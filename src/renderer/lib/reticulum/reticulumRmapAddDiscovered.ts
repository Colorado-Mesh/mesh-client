import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { invalidateReticulumInterfacesCache } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { ReticulumRmapDiscoveredWireRow } from '@/shared/reticulum-types';

/** Server entrypoints that can become a persistent remote Backbone client. */
const ADDABLE_DISCOVERY_TYPES = new Set(['backboneinterface', 'tcpserverinterface']);

export interface RmapAddDiscoveredInterfaceBody {
  type: 'backbone';
  name: string;
  enabled: boolean;
  host: string;
  port: number;
  network_name?: string;
  passphrase?: string;
}

/** True when the discovery row can be added as a remote Backbone interface. */
export function canAddRmapDiscoveredAsInterface(
  row: Pick<ReticulumRmapDiscoveredWireRow, 'interface_type' | 'reachable_on' | 'port'>,
): boolean {
  const type = row.interface_type
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '');
  if (!ADDABLE_DISCOVERY_TYPES.has(type)) {
    return false;
  }
  const host = row.reachable_on?.trim() ?? '';
  if (!host) {
    return false;
  }
  // Script-style reachable_on cannot be dialed as a static remote target.
  if (host.includes('/') || host.includes('$')) {
    return false;
  }
  const port = row.port;
  return typeof port === 'number' && Number.isFinite(port) && port > 0 && port <= 65535;
}

/** Build POST /api/v1/interfaces body from a discovered Backbone/TCPServer row. */
export function buildAddInterfaceBodyFromDiscovered(
  row: Pick<
    ReticulumRmapDiscoveredWireRow,
    'discovery_name' | 'interface_type' | 'reachable_on' | 'port' | 'ifac_netname' | 'ifac_netkey'
  >,
): RmapAddDiscoveredInterfaceBody | null {
  if (!canAddRmapDiscoveredAsInterface(row)) {
    return null;
  }
  const host = row.reachable_on!.trim();
  const port = row.port!;
  const name = row.discovery_name.trim() || `${host}:${port}`;
  const body: RmapAddDiscoveredInterfaceBody = {
    type: 'backbone',
    name,
    enabled: true,
    host,
    port,
  };
  const netName = row.ifac_netname?.trim();
  if (netName) {
    body.network_name = netName;
  }
  const passphrase = row.ifac_netkey?.trim();
  if (passphrase) {
    body.passphrase = passphrase;
  }
  return body;
}

export type AddRmapDiscoveredResult =
  { ok: true } | { ok: false; reason: 'not_addable' | 'api_error'; error?: string };

/** Persist a discovered Backbone/TCPServer as a Connection interface. */
export async function addRmapDiscoveredAsInterface(
  row: ReticulumRmapDiscoveredWireRow,
): Promise<AddRmapDiscoveredResult> {
  const body = buildAddInterfaceBodyFromDiscovered(row);
  if (!body) {
    return { ok: false, reason: 'not_addable' };
  }
  try {
    const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/interfaces', body)) as {
      ok?: boolean;
      error?: string;
    };
    if (res.ok === false) {
      return { ok: false, reason: 'api_error', error: res.error ?? 'unknown' };
    }
    invalidateReticulumInterfacesCache();
    return { ok: true };
  } catch (e) {
    // catch-no-log-ok error returned to caller for toast/UI
    return { ok: false, reason: 'api_error', error: errLikeToLogString(e) };
  }
}

/** Format host:port for Map detail when both are present. */
export function formatRmapDiscoveredEndpoint(
  row: Pick<ReticulumRmapDiscoveredWireRow, 'reachable_on' | 'port'>,
): string | null {
  const host = row.reachable_on?.trim();
  if (!host) return null;
  if (typeof row.port === 'number' && Number.isFinite(row.port) && row.port > 0) {
    return `${host}:${row.port}`;
  }
  return host;
}
