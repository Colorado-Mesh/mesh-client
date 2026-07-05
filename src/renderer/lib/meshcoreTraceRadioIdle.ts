import { meshcoreRepeaterTraceActiveForNode } from './meshcoreRepeaterRpcInFlight';
import { meshcoreTraceResponsesInFlightCount } from './meshcoreTracePathMultiplex';
import {
  MESHCORE_REPEATER_PING_SETTLE_MAX_MS,
  MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
} from './timeConstants';

const TRACE_IDLE_POLL_MS = 50;

/**
 * Block until no MeshCore trace is awaiting TraceData on the companion link.
 * Status/telemetry use a 120s RPC timeout — without this wait that budget is consumed
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
 */
export async function awaitMeshcoreRepeaterAdminRfIdle(
  maxWaitMs = MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
): Promise<void> {
  await awaitMeshcoreTraceRadioIdle(maxWaitMs);
}

/**
 * Wait until the same-node ping/trace RPC wrapper finishes (success, failure, or cancel).
 * Call before status/neighbors/telemetry so admin RPCs do not overlap an in-flight ping.
 */
export async function awaitMeshcoreRepeaterPingSettleForNode(
  nodeId: number,
  maxWaitMs: number = MESHCORE_REPEATER_PING_SETTLE_MAX_MS,
): Promise<void> {
  const start = Date.now();
  const normalizedId = nodeId >>> 0;
  while (meshcoreRepeaterTraceActiveForNode(normalizedId)) {
    if (Date.now() - start > maxWaitMs) {
      throw new Error('timeout waiting for ping');
    }
    await new Promise((resolve) => setTimeout(resolve, TRACE_IDLE_POLL_MS));
  }
}

export { meshcoreTraceResponsesInFlightCount };
