import { useEffect } from 'react';

import { isPlausibleNoiseFloorDbm } from '../lib/rfNoiseFloor';
import { useNoiseFloorHistoryStore } from '../stores/noiseFloorHistoryStore';

export interface UseRfNoiseFloorHistoryOpts {
  /** Panel mounted + a live reading exists. */
  enabled: boolean;
  nodeId: number | null | undefined;
  noiseFloor: number | undefined;
  /** Observation time from the source; defaults to now when the source has none. */
  observedAt?: number;
}

/**
 * Sample the connected radio's noise floor while the RF panel is mounted.
 * Panel-scoped on purpose: no global poll, and implausible sentinels (0 / out of band) never enter
 * the shared history store, so a non-reporting firmware cannot paint a fake 0 dBm trend.
 */
export function useRfNoiseFloorHistory({
  enabled,
  nodeId,
  noiseFloor,
  observedAt,
}: UseRfNoiseFloorHistoryOpts): void {
  const recordSample = useNoiseFloorHistoryStore((s) => s.recordSample);

  useEffect(() => {
    if (!enabled || nodeId == null || nodeId <= 0) return;
    if (!isPlausibleNoiseFloorDbm(noiseFloor)) return;
    recordSample(nodeId, noiseFloor, observedAt ?? Date.now());
  }, [enabled, nodeId, noiseFloor, observedAt, recordSample]);
}
