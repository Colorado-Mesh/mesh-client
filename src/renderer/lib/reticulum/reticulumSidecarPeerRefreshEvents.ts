/**
 * Decide which sidecar refresh work a WS event should trigger.
 * Full path-table peer reloads are expensive (~3k–50k rows); announce and
 * peers_updated membership growth apply incremental patches instead.
 */

/** Leading + trailing coalesce window for rare full peer refreshes. */
export const RETICULUM_PEER_REFRESH_COALESCE_MS = 400;

/** Widen coalesce under large path tables / announce storms. */
export const RETICULUM_PEER_REFRESH_STORM_COALESCE_MS = 1000;

export interface ReticulumSidecarRefreshActions {
  /** Full GET /peers snapshot (expensive). */
  peers: boolean;
  diagnostics: boolean;
  interfaces: boolean;
  /** Apply WS payload patches into the peer store (cheap). */
  peerPatches: boolean;
}

export function reticulumSidecarEventRefreshActions(
  eventType: string,
): ReticulumSidecarRefreshActions {
  switch (eventType) {
    case 'announce.received':
    case 'peers_updated':
      return { peers: false, diagnostics: true, interfaces: false, peerPatches: true };
    case 'stack_restart_requested':
      return { peers: true, diagnostics: true, interfaces: false, peerPatches: false };
    case 'stats_update':
      return { peers: false, diagnostics: true, interfaces: false, peerPatches: false };
    case 'interface.state':
      return { peers: false, diagnostics: false, interfaces: true, peerPatches: false };
    default:
      return { peers: false, diagnostics: false, interfaces: false, peerPatches: false };
  }
}

/**
 * Leading + trailing coalesce for peer refresh.
 * - First call in a quiet window runs `onRefresh` immediately (leading).
 * - Further calls within the window reset a trailing timer so a final refresh
 *   runs after `coalesceMs` of quiet.
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

/**
 * Trailing-only coalesce — under load, skip the leading fire so we do not
 * double-fetch during announce storms.
 */
export function scheduleTrailingOnlyRefresh(opts: {
  timerRef: { current: ReturnType<typeof setTimeout> | null };
  onRefresh: () => void;
  coalesceMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): void {
  const coalesceMs = opts.coalesceMs ?? RETICULUM_PEER_REFRESH_STORM_COALESCE_MS;
  const setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;

  if (opts.timerRef.current != null) {
    clearTimeoutFn(opts.timerRef.current);
  }
  opts.timerRef.current = setTimeoutFn(() => {
    opts.timerRef.current = null;
    opts.onRefresh();
  }, coalesceMs);
}

/** True when `peers_updated` cannot be applied incrementally and needs a full dump. */
export function peersUpdatedRequiresFullRefresh(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return true;
  const p = payload as Record<string, unknown>;
  if (p.cleared === true) return true;
  if (typeof p.demoted_from_contacts === 'number') return true;
  if (Array.isArray(p.patches) && p.patches.length > 0) return false;
  if (Array.isArray(p.added) && p.added.length > 0) return false;
  // Probe / path-request single-hash events — rare; reconcile with a full dump.
  if (typeof p.hash === 'string' && p.hash.trim()) return true;
  return true;
}
