const AUTO_TRACEROUTE_INTERVAL_MS = 30 * 60 * 1_000; // 30 minutes
const INTER_NODE_DELAY_MS = 2_000; // 2 second gap between traces to avoid flooding

/**
 * Starts a periodic network discovery loop that traceroutes all known nodes.
 *
 * @param traceRouteFn    Async function to run traceroute to a single node.
 * @param getNodeIds      Returns the current list of node IDs to probe (excluding our own node).
 * @param intervalMs      How often to run a full sweep (default: 30 minutes).
 * @param interNodeDelayMs  Delay between individual traces (default: 2 seconds). Pass 0 in tests.
 * @returns               A stop function — call it to cancel the scheduler.
 */
export function startNetworkDiscovery(
  traceRouteFn: (nodeId: number) => Promise<void>,
  getNodeIds: () => number[],
  intervalMs: number = AUTO_TRACEROUTE_INTERVAL_MS,
  interNodeDelayMs: number = INTER_NODE_DELAY_MS,
): () => void {
  let stopped = false;
  let sweepTimeout: ReturnType<typeof setTimeout> | null = null;
  let nodeDelayTimeout: ReturnType<typeof setTimeout> | null = null;

  async function runSweep(): Promise<void> {
    const nodeIds = getNodeIds();
    for (const nodeId of nodeIds) {
      if (stopped) return;
      try {
        await traceRouteFn(nodeId);
      } catch (e) {
        console.warn('[networkDiscovery] traceroute failed for node', nodeId, e);
      }
      if (stopped) return;
      // Small delay between nodes to avoid flooding the mesh
      if (interNodeDelayMs > 0) {
        await new Promise<void>((resolve) => {
          nodeDelayTimeout = setTimeout(resolve, interNodeDelayMs);
        });
      }
    }
  }

  function scheduleNext(): void {
    if (stopped) return;
    sweepTimeout = setTimeout(() => {
      void (async () => {
        if (stopped) return;
        await runSweep();
        scheduleNext();
      })();
    }, intervalMs);
  }

  // Run an immediate sweep, then schedule recurring ones
  void runSweep().then(() => {
    if (!stopped) scheduleNext();
  });

  return function stop() {
    stopped = true;
    if (sweepTimeout !== null) {
      clearTimeout(sweepTimeout);
      sweepTimeout = null;
    }
    if (nodeDelayTimeout !== null) {
      clearTimeout(nodeDelayTimeout);
      nodeDelayTimeout = null;
    }
  };
}
