/**
 * Decide which sidecar refresh work a WS event should trigger.
 * Full path-table peer reloads are expensive (~3k–10k rows); only schedule them
 * for peer-relevant events, not high-frequency stats/interface chatter.
 */

/** Leading + trailing coalesce window for announce/path peer refreshes. */
export const RETICULUM_PEER_REFRESH_COALESCE_MS = 400;

export interface ReticulumSidecarRefreshActions {
  peers: boolean;
  diagnostics: boolean;
  interfaces: boolean;
}

export function reticulumSidecarEventRefreshActions(
  eventType: string,
): ReticulumSidecarRefreshActions {
  switch (eventType) {
    case 'announce.received':
    case 'peers_updated':
    case 'stack_restart_requested':
      return { peers: true, diagnostics: true, interfaces: false };
    case 'stats_update':
      return { peers: false, diagnostics: true, interfaces: false };
    case 'interface.state':
      return { peers: false, diagnostics: false, interfaces: true };
    default:
      return { peers: false, diagnostics: false, interfaces: false };
  }
}

/**
 * Leading + trailing coalesce for peer refresh.
 * - First call in a quiet window runs `onRefresh` immediately (leading).
 * - Further calls within the window reset a trailing timer so a final refresh
 *   runs after `coalesceMs` of quiet (picks up path-table rows that land just
 *   after the announce WS event).
 */
export function scheduleLeadingTrailingRefresh(opts: {
  timerRef: { current: ReturnType<typeof setTimeout> | null };
  onRefresh: () => void;
  coalesceMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): void {
  const coalesceMs = opts.coalesceMs ?? RETICULUM_PEER_REFRESH_COALESCE_MS;
  const setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;

  if (opts.timerRef.current == null) {
    opts.onRefresh();
  } else {
    clearTimeoutFn(opts.timerRef.current);
  }

  opts.timerRef.current = setTimeoutFn(() => {
    opts.timerRef.current = null;
    opts.onRefresh();
  }, coalesceMs);
}
