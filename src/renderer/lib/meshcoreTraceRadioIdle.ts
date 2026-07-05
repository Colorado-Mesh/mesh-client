import { meshcoreTraceResponsesInFlightCount } from './meshcoreTracePathMultiplex';
import { MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS } from './timeConstants';

const TRACE_IDLE_POLL_MS = 50;

/**
 * Block until no MeshCore trace is awaiting TraceData on the companion link.
 * Status/telemetry use a 30s RPC timeout — without this wait that budget is consumed
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

export { meshcoreTraceResponsesInFlightCount };
