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
 * Changes when a room contact becomes available or a pubkey hydrates — not on
 * unrelated node-list churn.
 */
export function meshcoreRoomAutoLoginReadyKey(
  configuredIds: number[],
  isRoom: (nodeId: number) => boolean,
  isPubKeyReady?: (nodeId: number) => boolean,
): string {
  return configuredIds
    .filter((id) => isRoom(id))
    .sort((a, b) => a - b)
    .map((id) => (isPubKeyReady?.(id) ? `${id}:pk` : String(id)))
    .join(',');
}

let inFlight: Promise<void> | null = null;
let pending = false;
let generation = 0;

/** True while a connect auto-login pass is running (including an empty target list). */
export function isMeshcoreRoomAutoLoginInFlight(): boolean {
  return inFlight != null;
}

/** Generation bumped on disconnect so a dying pass must not SendLogin on a new conn. */
export function meshcoreRoomAutoLoginGeneration(): number {
  return generation;
}

export function isMeshcoreRoomAutoLoginGenerationCurrent(gen: number): boolean {
  return gen === generation;
}

/**
 * Collapse overlapping connect auto-login triggers onto one pass.
 * Later callers mark the pass dirty and await it; when it finishes, targets are
 * re-selected so a Room that appeared mid-pathSync still logs in.
 */
function takeAutoLoginPending(): boolean {
  const queued = pending;
  pending = false;
  return queued;
}

function clearAutoLoginInFlightIfCurrent(p: Promise<void>): void {
  if (inFlight === p) inFlight = null;
}

export function runMeshcoreRoomAutoLoginSingleFlight(run: () => Promise<void>): Promise<void> {
  if (inFlight) {
    pending = true;
    return inFlight;
  }
  const slot: { current: Promise<void> | null } = { current: null };
  slot.current = (async () => {
    try {
      for (;;) {
        pending = false;
        await run();
        // Overlapping trigger (including reconnect during a dying pass) re-runs after this body.
        if (!takeAutoLoginPending()) return;
      }
    } finally {
      if (slot.current) clearAutoLoginInFlightIfCurrent(slot.current);
    }
  })();
  inFlight = slot.current;
  return slot.current;
}

/**
 * Disconnect hook — invalidates the in-flight pass. Does not abort radio work;
 * the pass must check {@link isMeshcoreRoomAutoLoginGenerationCurrent} after awaits.
 * Leaves the promise in place so a reconnect trigger joins it instead of overlapping pathSync.
 */
export function resetMeshcoreRoomAutoLoginSingleFlight(): void {
  generation += 1;
  pending = false;
}
