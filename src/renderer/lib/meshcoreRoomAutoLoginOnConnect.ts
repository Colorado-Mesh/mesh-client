/** Probe fields used to decide whether a configured room should auto-login. */
export interface MeshcoreRoomAutoLoginTargetProbe {
  isRoom: boolean;
  hasCredential: boolean;
  hasPubKey: boolean;
  loggedIn: boolean;
  queued: boolean;
  autoLoginFailed: boolean;
}

/**
 * Rooms that should run connect auto-login. Skips logged-in, queued, failed, and
 * not-yet-hydrated contacts so overlapping triggers cannot stampede pathSync.
 */
export function selectMeshcoreRoomAutoLoginTargets(
  configuredIds: number[],
  probe: (nodeId: number) => MeshcoreRoomAutoLoginTargetProbe,
): number[] {
  return configuredIds.filter((nodeId) => {
    const p = probe(nodeId);
    return (
      p.isRoom && p.hasCredential && p.hasPubKey && !p.loggedIn && !p.queued && !p.autoLoginFailed
    );
  });
}

/**
 * Stable key of configured auto-login rooms that are present as Room contacts.
 * Changes when a room contact becomes available — not on unrelated node-list churn.
 */
export function meshcoreRoomAutoLoginReadyKey(
  configuredIds: number[],
  isRoom: (nodeId: number) => boolean,
): string {
  return configuredIds
    .filter((id) => isRoom(id))
    .sort((a, b) => a - b)
    .join(',');
}

let inFlight: Promise<void> | null = null;

/** True while a connect auto-login pass is running (including an empty target list). */
export function isMeshcoreRoomAutoLoginInFlight(): boolean {
  return inFlight != null;
}

/**
 * Collapse overlapping connect auto-login triggers onto one pass.
 * Later callers await the in-flight work instead of starting another pathSync.
 */
export function runMeshcoreRoomAutoLoginSingleFlight(run: () => Promise<void>): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Test / disconnect hook — does not abort an in-flight pass. */
export function resetMeshcoreRoomAutoLoginSingleFlight(): void {
  inFlight = null;
}
