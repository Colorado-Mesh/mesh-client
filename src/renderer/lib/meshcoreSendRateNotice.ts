import { MESHCORE_FAST_SEND_WARN_INTERVAL_MS } from './timeConstants';

/**
 * App-wide timestamp of the last MeshCore chat send (channel / DM / room). MeshCore airtime is
 * shared across every chat view, so the "sending too fast" cadence is global, not per-view or
 * per-composer instance — two composers must observe the same clock.
 */
let lastMeshcoreSendAtMs = 0;

/** Test-only: clear the shared fast-send clock between cases. */
export function resetMeshcoreSendRateForTests(): void {
  lastMeshcoreSendAtMs = 0;
}

/**
 * True when a MeshCore send happened within `MESHCORE_FAST_SEND_WARN_INTERVAL_MS` (5s) of `nowMs`.
 * Used to surface a non-blocking advisory — this never blocks, disables, or delays the send.
 */
export function isMeshcoreSendTooFast(nowMs: number = Date.now()): boolean {
  if (lastMeshcoreSendAtMs <= 0) return false;
  return nowMs - lastMeshcoreSendAtMs < MESHCORE_FAST_SEND_WARN_INTERVAL_MS;
}

/** Record that a MeshCore send just occurred, for the next fast-send cadence check. */
export function recordMeshcoreSend(nowMs: number = Date.now()): void {
  lastMeshcoreSendAtMs = nowMs;
}
