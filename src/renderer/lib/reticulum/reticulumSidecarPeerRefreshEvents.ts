/**
 * Decide which sidecar refresh work a WS event should trigger.
 * Full path-table peer reloads are expensive (~3k–10k rows); only schedule them
 * for peer-relevant events, not high-frequency stats/interface chatter.
 */
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
