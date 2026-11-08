/** Honest delivery / reliability proxies — not end-to-end ACK PDR. */

export const PDR_PROXY_MIN_SAMPLES = 10;

export interface EchoLossProxy {
  /** Fraction of observed packets that were echo/duplicate (0–1). */
  echoLossRate: number;
  /** 1 − echoLossRate when sample count is enough; otherwise null. */
  reliability: number | null;
  total: number;
  duplicates: number;
}

/**
 * Meshtastic session proxy from diagnostics `packetStats`.
 * High duplicates indicate multi-path echoes / loops, not necessarily undelivered packets.
 */
export function meshtasticEchoLossProxy(
  stats: {
    total: number;
    duplicates: number;
  } | null,
): EchoLossProxy | null {
  if (!stats || stats.total <= 0) return null;
  const duplicates = Math.max(0, Math.min(stats.duplicates, stats.total));
  const echoLossRate = duplicates / stats.total;
  const reliability =
    stats.total >= PDR_PROXY_MIN_SAMPLES ? Math.max(0, Math.min(1, 1 - echoLossRate)) : null;
  return { echoLossRate, reliability, total: stats.total, duplicates };
}

export interface PathReliabilityProxy {
  /** Laplace-smoothed success rate (matches pathHistoryStore computeScore). */
  reliability: number;
  successCount: number;
  failureCount: number;
  attempts: number;
}

/** MeshCore path reliability from aggregated success/failure counts. */
export function meshcorePathReliabilityProxy(opts: {
  successCount: number;
  failureCount: number;
}): PathReliabilityProxy | null {
  const successCount = Math.max(0, opts.successCount);
  const failureCount = Math.max(0, opts.failureCount);
  const attempts = successCount + failureCount;
  if (attempts <= 0) return null;
  const reliability = (successCount + 1) / (attempts + 2);
  return { reliability, successCount, failureCount, attempts };
}
