import { useRelayCoverageStore } from '@/renderer/lib/relayCoverage/relayCoverageStore';
import type { IdentityId } from '@/renderer/lib/types';

export interface ReticulumPredictedRouteInput {
  hops?: number | null;
  viaHash?: string | null;
}

/**
 * Write predicted RNS path coverage at send time (not a confirmed overhear).
 * `predictedRelayHops = max(0, hops - 1)` when hops is a finite number.
 */
export function setReticulumPredictedRoute(
  identityId: IdentityId,
  messageId: string,
  path: ReticulumPredictedRouteInput,
): void {
  const hopsRaw = path.hops;
  const predictedRelayHops =
    typeof hopsRaw === 'number' && Number.isFinite(hopsRaw)
      ? Math.max(0, Math.trunc(hopsRaw) - 1)
      : undefined;
  const via = path.viaHash?.trim();
  const predictedFirstHop = via && via.length > 0 ? via : undefined;

  if (predictedRelayHops == null && predictedFirstHop == null) {
    return;
  }

  useRelayCoverageStore.getState().set(identityId, messageId, {
    protocol: 'reticulum',
    mode: 'predicted',
    ...(predictedRelayHops != null ? { predictedRelayHops } : {}),
    ...(predictedFirstHop != null ? { predictedFirstHop } : {}),
  });
}
