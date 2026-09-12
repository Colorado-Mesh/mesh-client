/**
 * Align renderer RRC session status with sidecar `GET /rrc/status` truth.
 * Used after WS lag/reconnect and when send discovers a dead hub session.
 */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';
import type { RrcMultiSessionSnapshot, RrcSessionStatus } from '@/shared/rrc-types';

/** UI statuses that can look "still up" when the sidecar has already dropped. */
const STALE_CONNECTED_STATUSES: ReadonlySet<RrcSessionStatus> = new Set([
  'active',
  'awaiting_welcome',
]);

function normHub(hash: string): string {
  return hash.trim().toLowerCase();
}

/** Snapshot of per-hub generations before an async getStatus() round-trip. */
function captureHubGenerations(hubs: Iterable<string>): Map<string, number> {
  const store = useRrcSessionStore.getState();
  const out = new Map<string, number>();
  for (const raw of hubs) {
    const hub = normHub(raw);
    if (!hub) continue;
    const ui = store.sessionsByHub.get(hub);
    if (ui) out.set(hub, ui.generation);
  }
  return out;
}

function isHubGenerationCurrent(hub: string, expectedGeneration: number): boolean {
  const ui = useRrcSessionStore.getState().sessionsByHub.get(hub);
  return ui?.generation === expectedGeneration;
}

/**
 * Demote or clear UI hub sessions that disagree with the sidecar snapshot.
 * Does not promote disconnected UI hubs to active (events own that path).
 * When `expectedGenerations` is set, skip hubs whose generation advanced (or that
 * disappeared) while getStatus() was in flight.
 */
export function reconcileRrcSessionsFromSnapshot(
  snap: RrcMultiSessionSnapshot,
  opts?: { hubDestHash?: string; expectedGenerations?: ReadonlyMap<string, number> },
): void {
  const store = useRrcSessionStore.getState();
  const sideByHub = new Map<string, NonNullable<(typeof snap.sessions)[number]>>();
  for (const session of snap.sessions) {
    const hub = session.hub_dest_hash ? normHub(session.hub_dest_hash) : '';
    if (hub) sideByHub.set(hub, session);
  }

  const hubs = opts?.hubDestHash
    ? [normHub(opts.hubDestHash)]
    : opts?.expectedGenerations
      ? [...opts.expectedGenerations.keys()]
      : [...store.sessionsByHub.keys()];

  for (const hub of hubs) {
    if (!hub) continue;
    const expected = opts?.expectedGenerations?.get(hub);
    if (
      opts?.expectedGenerations &&
      (expected === undefined || !isHubGenerationCurrent(hub, expected))
    ) {
      continue;
    }
    const ui = store.sessionsByHub.get(hub);
    if (!ui) continue;
    if (ui.disconnectIntent) continue;
    if (!STALE_CONNECTED_STATUSES.has(ui.status)) continue;

    const side = sideByHub.get(hub);
    if (!side || side.status === 'disconnected') {
      store.clearHubSession(hub);
      continue;
    }
    if (side.status === 'reconnecting' || side.status === 'connecting') {
      store.applyStatus('reconnecting', hub, side.hub_name ?? undefined);
      if (side.error) store.setError(side.error, hub);
      continue;
    }
    if (side.status === 'awaiting_welcome') {
      store.applyStatus('awaiting_welcome', hub, side.hub_name ?? undefined);
      continue;
    }
    // side.status === 'active' — leave UI alone
  }
}

/**
 * After a dead-session send error: pull sidecar status and demote the hub.
 * If the snapshot still claims active (race / silent teardown), force reconnecting.
 * Skips when the hub's generation advanced while getStatus() was in flight.
 */
export async function reconcileRrcHubAfterDeadSend(
  hubDestHash: string,
  getStatus: () => Promise<RrcMultiSessionSnapshot> = () =>
    window.electronAPI.reticulum.rrc.getStatus(),
): Promise<void> {
  const hub = normHub(hubDestHash);
  if (!hub) return;
  const expectedGenerations = captureHubGenerations([hub]);
  const captured = expectedGenerations.get(hub);
  if (captured === undefined) return;
  try {
    const snap = await getStatus();
    if (!isHubGenerationCurrent(hub, captured)) return;
    reconcileRrcSessionsFromSnapshot(snap, { hubDestHash: hub, expectedGenerations });
    if (!isHubGenerationCurrent(hub, captured)) return;
    const ui = useRrcSessionStore.getState().sessionsByHub.get(hub);
    if (ui && STALE_CONNECTED_STATUSES.has(ui.status) && !ui.disconnectIntent) {
      useRrcSessionStore.getState().applyStatus('reconnecting', hub);
    }
  } catch (e: unknown) {
    // getStatus failed; still demote so the UI leaves Connected after a dead send.
    console.debug('[reconcileRrcHubAfterDeadSend] getStatus failed ' + errLikeToLogString(e));
    if (!isHubGenerationCurrent(hub, captured)) return;
    const ui = useRrcSessionStore.getState().sessionsByHub.get(hub);
    if (ui && STALE_CONNECTED_STATUSES.has(ui.status) && !ui.disconnectIntent) {
      useRrcSessionStore.getState().applyStatus('reconnecting', hub);
    }
  }
}

/** Fire-and-forget full multi-hub reconcile (WS lag / reconnect). */
export function scheduleRrcSessionStatusReconcile(
  reason: string,
  getStatus: () => Promise<RrcMultiSessionSnapshot> = () =>
    window.electronAPI.reticulum.rrc.getStatus(),
): Promise<void> {
  const expectedGenerations = captureHubGenerations(
    useRrcSessionStore.getState().sessionsByHub.keys(),
  );
  return getStatus()
    .then((snap) => {
      reconcileRrcSessionsFromSnapshot(snap, { expectedGenerations });
    })
    .catch((e: unknown) => {
      console.debug(
        '[reconcileRrcSessionsFromSnapshot] getStatus after ' +
          reason +
          ' failed ' +
          errLikeToLogString(e),
      );
    });
}
