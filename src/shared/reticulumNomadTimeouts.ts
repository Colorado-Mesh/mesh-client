/**
 * Nomad page fetch timeouts aligned with Reticulum MeshChat
 * (`NomadnetDownloader`: 15s path lookup + 15s link establishment on TCP;
 * RF uses Python RNS per-hop link establishment scaling).
 */

import { MS_PER_SECOND } from './timeConstants';

export type ReticulumNomadEgressVia = 'rf' | 'tcp' | 'network';

/** MeshChat `NomadnetDownloader.download()` path_lookup_timeout default. */
export const NOMAD_PATH_LOOKUP_SECS = 15;

/** MeshChat TCP link_establishment_timeout default. */
export const NOMAD_TCP_LINK_ESTABLISH_SECS = 15;

/** Grace for RTT-scaled link.request transfer after path + link stages. */
export const NOMAD_TCP_TRANSFER_GRACE_SECS = 15;

/** Python RNS `DEFAULT_PER_HOP_TIMEOUT`. */
export const NOMAD_RF_PER_HOP_TIMEOUT_SECS = 6;

/** Python RNS first-hop component in link establishment. */
export const NOMAD_RF_FIRST_HOP_SECS = 6;

/** Extra grace for slow RF page transfers. */
export const NOMAD_RF_TRANSFER_GRACE_SECS = 30;

/** RNS transport default overall cap. */
export const NOMAD_RF_MAX_OVERALL_SECS = 180;

/**
 * Main-process IPC proxy AbortSignal timeout for Nomad page/file GETs.
 * Sidecar LinkClient already enforces the egress×hops deadline; main must not
 * cut off early when UI hops are stale (use a flat cap above the RF max).
 */
export const NOMAD_PROXY_GET_TIMEOUT_MS = (NOMAD_RF_MAX_OVERALL_SECS + 5) * MS_PER_SECOND;

const NOMAD_EGRESS_VIA_VALUES: readonly ReticulumNomadEgressVia[] = ['rf', 'tcp', 'network'];

export function parseReticulumNomadEgressVia(
  value: string | null | undefined,
): ReticulumNomadEgressVia {
  // BLE RNode shares the RF per-hop timeout budget (proxy + sidecar).
  if (value === 'ble') return 'rf';
  if (value != null && (NOMAD_EGRESS_VIA_VALUES as readonly string[]).includes(value)) {
    return value as ReticulumNomadEgressVia;
  }
  return 'network';
}

function boundedNomadHops(hops: number): number {
  if (!Number.isFinite(hops)) return 8;
  return Math.max(1, Math.min(32, Math.trunc(hops)));
}

/** Overall sidecar Link query deadline in seconds. */
export function nomadPageOverallTimeoutSecs(
  egressVia: ReticulumNomadEgressVia,
  hops: number,
): number {
  if (egressVia === 'rf') {
    const boundedHops = boundedNomadHops(hops);
    const linkEstablish = NOMAD_RF_FIRST_HOP_SECS + NOMAD_RF_PER_HOP_TIMEOUT_SECS * boundedHops;
    const total = NOMAD_PATH_LOOKUP_SECS + linkEstablish + NOMAD_RF_TRANSFER_GRACE_SECS;
    return Math.min(NOMAD_RF_MAX_OVERALL_SECS, total);
  }
  return NOMAD_PATH_LOOKUP_SECS + NOMAD_TCP_LINK_ESTABLISH_SECS + NOMAD_TCP_TRANSFER_GRACE_SECS;
}

/**
 * IPC proxy timeout for Nomad page/file fetches.
 * Always the flat {@link NOMAD_PROXY_GET_TIMEOUT_MS} so stale renderer hops
 * cannot abort before the sidecar's own LinkClient deadline.
 */
export function nomadPageProxyTimeoutMsFromApiPath(_apiPath: string): number {
  void _apiPath;
  return NOMAD_PROXY_GET_TIMEOUT_MS;
}
