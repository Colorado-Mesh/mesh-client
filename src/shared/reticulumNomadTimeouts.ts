/**
 * Nomad page fetch timeouts aligned with Reticulum MeshChat
 * (`NomadnetDownloader`: 15s path lookup + 15s link establishment on TCP;
 * RF uses Python RNS per-hop link establishment scaling).
 */

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

const NOMAD_EGRESS_VIA_VALUES: readonly ReticulumNomadEgressVia[] = ['rf', 'tcp', 'network'];

export function parseReticulumNomadEgressVia(
  value: string | null | undefined,
): ReticulumNomadEgressVia {
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

/** Main-process proxy GET AbortSignal timeout with small buffer. */
export function nomadPageProxyTimeoutMs(egressVia: ReticulumNomadEgressVia, hops: number): number {
  return nomadPageOverallTimeoutSecs(egressVia, hops) * 1_000 + 2_000;
}

/** Parse hops/egress from a nomad page proxy path (including query string). */
export function nomadPageProxyTimeoutMsFromApiPath(apiPath: string): number {
  const query = apiPath.includes('?') ? (apiPath.split('?')[1] ?? '') : '';
  const params = new URLSearchParams(query);
  const hops = Number.parseInt(params.get('hops') ?? '8', 10);
  const egress = parseReticulumNomadEgressVia(params.get('egress'));
  return nomadPageProxyTimeoutMs(egress, hops);
}
