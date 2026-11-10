import { meshcoreRepeaterTraceActiveForNode } from './meshcoreRepeaterRpcInFlight';
import { meshcoreTraceResponsesInFlightCount } from './meshcoreTracePathMultiplex';
import {
  MESHCORE_REPEATER_ADMIN_RF_IDLE_MS,
  MESHCORE_REPEATER_PING_SETTLE_SOFT_MS,
  MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
} from './timeConstants';

const TRACE_IDLE_POLL_MS = 50;

export interface MeshcoreRepeaterPingSettleResult {
  waitedMs: number;
  /** True when a same-node ping was still active after the soft budget. */
  proceededBusy: boolean;
}

/**
 * Block until no MeshCore trace is awaiting TraceData on the companion link.
 * Status/telemetry use a bounded RPC timeout — without this wait that budget is consumed
 * while a ping holds the radio for up to {@link MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS}.
 */
export async function awaitMeshcoreTraceRadioIdle(
  maxWaitMs = MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
): Promise<void> {
  const start = Date.now();
  while (meshcoreTraceResponsesInFlightCount() > 0) {
    if (Date.now() - start > maxWaitMs) {
      throw new Error('timeout waiting for trace');
    }
    await new Promise((resolve) => setTimeout(resolve, TRACE_IDLE_POLL_MS));
  }
}

/**
 * `beforeSend` hook for queued admin RPCs: wait only for active TraceData responses.
 * Companion queue serialization already prevents overlapping sends; do not wait on
 * pending route registration here (that caused 180s blocks while ping was queued).
 * Default budget is {@link MESHCORE_REPEATER_ADMIN_RF_IDLE_MS} so admin sends are not
 * held for a full ping end-to-end cap.
 */
export async function awaitMeshcoreRepeaterAdminRfIdle(
  maxWaitMs = MESHCORE_REPEATER_ADMIN_RF_IDLE_MS,
): Promise<void> {
  try {
    await awaitMeshcoreTraceRadioIdle(maxWaitMs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes('timeout waiting for trace')) {
      console.warn(
        `[meshcoreTraceRadioIdle] admin RF idle timed out after ${maxWaitMs}ms; proceeding with send`,
      );
      return;
    }
    throw e;
  }
}

/**
 * Wait until the same-node ping/trace RPC wrapper finishes (success, failure, or cancel).
 * Call before status/neighbors/telemetry so admin RPCs prefer not to overlap an in-flight ping.
 * After {@link MESHCORE_REPEATER_PING_SETTLE_SOFT_MS} (or `maxWaitMs`), proceeds without throwing.
 */
export async function awaitMeshcoreRepeaterPingSettleForNode(
  nodeId: number,
  maxWaitMs: number = MESHCORE_REPEATER_PING_SETTLE_SOFT_MS,
): Promise<MeshcoreRepeaterPingSettleResult> {
  const start = Date.now();
  const normalizedId = nodeId >>> 0;
  while (meshcoreRepeaterTraceActiveForNode(normalizedId)) {
    if (Date.now() - start > maxWaitMs) {
      const waitedMs = Date.now() - start;
      console.warn(
        `[meshcoreTraceRadioIdle] ping settle soft timeout node=${normalizedId} waitedMs=${waitedMs}; proceeding`,
      );
      return { waitedMs, proceededBusy: true };
    }
    await new Promise((resolve) => setTimeout(resolve, TRACE_IDLE_POLL_MS));
  }
  return { waitedMs: Date.now() - start, proceededBusy: false };
}

export { meshcoreTraceResponsesInFlightCount };
