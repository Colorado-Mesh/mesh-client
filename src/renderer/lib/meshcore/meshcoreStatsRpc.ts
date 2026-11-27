import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { withTimeout } from '@/shared/withTimeout';

import { MESHCORE_STATS_RPC_TIMEOUT_MS } from '../timeConstants';

export type MeshcoreStatsRpcKind = 'core' | 'radio' | 'packets';

const MESHCORE_STATS_RPC_LABEL = 'MeshCore stats';

/**
 * Bounds one companion stats RPC. meshcore.js `getStats` resolves only on a Stats (or Err)
 * frame, so on a radio that stopped answering the request would never settle and the
 * single-flight stats poll would stay latched with nothing logged.
 */
export function withMeshcoreStatsTimeout<T>(
  rpc: Promise<T>,
  kind: MeshcoreStatsRpcKind,
): Promise<T> {
  return withTimeout(rpc, MESHCORE_STATS_RPC_TIMEOUT_MS, `${MESHCORE_STATS_RPC_LABEL} ${kind}`);
}

/** True when a stats RPC hit {@link withMeshcoreStatsTimeout}'s deadline (radio silent). */
export function isMeshcoreStatsTimeoutError(error: unknown): boolean {
  const msg = errLikeToLogString(error);
  return msg.includes(MESHCORE_STATS_RPC_LABEL) && msg.includes('timed out');
}
