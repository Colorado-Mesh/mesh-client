import { useEffect, useRef } from 'react';

import { errLikeToLogString } from '../lib/errLikeToLogString';
import {
  isValidNoiseFloorReading,
  MESHCORE_NOISE_FLOOR_TREND_POLL_MS,
} from '../lib/meshcore/noiseFloorHistory';
import { useNoiseFloorHistoryStore } from '../stores/noiseFloorHistoryStore';

export interface UseMeshcoreNoiseFloorTrendOpts {
  /** When false, neither sample nor poll. */
  enabled: boolean;
  nodeId: number | null | undefined;
  /**
   * Latest snapshot noise floor (local stats or remote Status). Sampled into the store
   * while the panel is enabled; `0` is kept, `undefined` means no snapshot yet.
   */
  noiseFloor: number | undefined;
  /**
   * When true, periodically call `onRequestRepeaterStatus` while the document is visible.
   * Local companion stats already poll elsewhere — leave this false for our node.
   */
  pollRemote: boolean;
  onRequestRepeaterStatus?: (nodeId: number) => Promise<void>;
  pollIntervalMs?: number;
  /** Override visibility check (tests). Defaults to `document.visibilityState === 'visible'`. */
  isDocumentVisible?: () => boolean;
}

function defaultIsDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/**
 * Sample MeshCore noise-floor readings for the selected node detail panel, and optionally
 * refresh remote Status on an interval. Never starts a global always-on poll.
 */
export function useMeshcoreNoiseFloorTrend({
  enabled,
  nodeId,
  noiseFloor,
  pollRemote,
  onRequestRepeaterStatus,
  pollIntervalMs = MESHCORE_NOISE_FLOOR_TREND_POLL_MS,
  isDocumentVisible = defaultIsDocumentVisible,
}: UseMeshcoreNoiseFloorTrendOpts): void {
  const recordSample = useNoiseFloorHistoryStore((s) => s.recordSample);
  const onRequestRef = useRef(onRequestRepeaterStatus);
  const isVisibleRef = useRef(isDocumentVisible);

  useEffect(() => {
    onRequestRef.current = onRequestRepeaterStatus;
    isVisibleRef.current = isDocumentVisible;
  }, [onRequestRepeaterStatus, isDocumentVisible]);

  // Ingest snapshot readings only while this node detail is active.
  useEffect(() => {
    if (!enabled || nodeId == null || nodeId <= 0) return;
    if (!isValidNoiseFloorReading(noiseFloor)) return;
    if (!isVisibleRef.current()) return;
    recordSample(nodeId, noiseFloor);
  }, [enabled, nodeId, noiseFloor, recordSample]);

  // Remote Status refresh: selected node + panel enabled + document visible only.
  useEffect(() => {
    if (!enabled || !pollRemote || nodeId == null || nodeId <= 0) return;
    if (!onRequestRef.current) return;

    let cancelled = false;
    let inFlight = false;

    const tick = () => {
      if (cancelled) return;
      if (!isVisibleRef.current()) return;
      const request = onRequestRef.current;
      if (!request || inFlight) return;
      inFlight = true;
      void request(nodeId)
        .catch((e: unknown) => {
          console.warn(
            '[useMeshcoreNoiseFloorTrend] remote status poll failed ' + errLikeToLogString(e),
          );
        })
        .finally(() => {
          inFlight = false;
        });
    };

    const intervalId = setInterval(tick, pollIntervalMs);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, pollRemote, nodeId, pollIntervalMs]);
}
