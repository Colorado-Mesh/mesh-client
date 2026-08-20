/**
 * Headless Reticulum RRC startup: hub auto-join + /list + room auto-join.
 * Mounted from App so RRC connects without opening the RRC panel.
 */
import { useEffect, useRef } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { RETICULUM_CONFIGURED_EVENT } from '@/renderer/lib/reticulum/reticulumConfiguredEvent';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import {
  isRrcHubAutoJoinBlocked,
  recordRrcHubAutoJoinFailure,
} from '@/renderer/lib/rrcHubAutoJoinBackoff';
import { isRrcHubDisconnectSuppressed } from '@/renderer/lib/rrcHubDisconnectSuppress';
import { loadRrcHubAutoJoin } from '@/renderer/lib/rrcHubPrefs';
import { isRrcHubLinked } from '@/renderer/lib/rrcHubSession';
import { resolveRrcJoinRoomName } from '@/renderer/lib/rrcRoomName';
import { loadRrcAutoJoinRooms } from '@/renderer/lib/rrcRoomPrefs';
import {
  MAX_RRC_HUB_SESSIONS,
  RRC_NICKNAME_STORAGE_KEY,
  useRrcSessionStore,
} from '@/renderer/stores/rrcSessionStore';
import { MS_PER_SECOND } from '@/shared/timeConstants';

/** While hubs still need linking, poll quickly so we do not miss the HTTP-ready window by 4s. */
export const RRC_AUTO_CONNECT_FAST_MS = MS_PER_SECOND / 2;
/** Steady poll once hubs are linked (or none configured). */
export const RRC_AUTO_CONNECT_STEADY_MS = 4 * MS_PER_SECOND;

export { RETICULUM_CONFIGURED_EVENT };
let hubAutoConnectBusy = false;

function isRrcHubLinkedNow(hub: string): boolean {
  const s = useRrcSessionStore.getState().sessionsByHub.get(hub);
  return !!s && isRrcHubLinked(s.status);
}

function pendingRrcAutoJoinHubs(): string[] {
  return loadRrcHubAutoJoin().filter(
    (hub) =>
      !isRrcHubLinkedNow(hub) &&
      !isRrcHubDisconnectSuppressed(hub) &&
      !isRrcHubAutoJoinBlocked(hub),
  );
}

/** Roll a hub session back to idle when a connect attempt fails mid-handshake. */
function clearRrcHubIfStillConnecting(hub: string, err: string): void {
  useRrcSessionStore.getState().setError(err, hub);
  const cur = useRrcSessionStore.getState().sessionsByHub.get(hub);
  if (cur?.status === 'connecting' || cur?.status === 'awaiting_welcome') {
    useRrcSessionStore.getState().clearHubSession(hub);
  }
}

/** Connect one hub. Returns false when the session cap blocks further attempts. */
async function connectRrcHubForAutoJoin(hub: string, nickname: string): Promise<boolean> {
  const session = useRrcSessionStore.getState();
  if (isRrcHubLinkedNow(hub)) return true;
  // Manual Disconnect suppress — do not clear; only explicit Connect clears it.
  if (isRrcHubDisconnectSuppressed(hub)) return true;
  if (!session.sessionsByHub.has(hub) && session.sessionsByHub.size >= MAX_RRC_HUB_SESSIONS) {
    return false;
  }
  if (!session.focusedHubHash) {
    useRrcSessionStore.getState().setFocusedHub(hub);
  }
  useRrcSessionStore.getState().applyStatus('connecting', hub, null);
  useRrcSessionStore.getState().setDisconnectIntent(false, hub);
  useRrcSessionStore.getState().setError(null, hub);

  try {
    const res = await window.electronAPI.reticulum.rrc.connect({ dest_hash: hub, nickname });
    if (!res.ok) {
      const err = res.error ?? 'connect failed';
      if (!/cancelled/i.test(err)) {
        recordRrcHubAutoJoinFailure(hub);
        clearRrcHubIfStillConnecting(hub, err);
      }
    }
  } catch (e: unknown) {
    const msg = errLikeToLogString(e);
    if (!/cancelled/i.test(msg)) {
      console.debug(`[useRrcStartupAutoConnect] hub connect failed: ${msg}`);
      recordRrcHubAutoJoinFailure(hub);
      clearRrcHubIfStillConnecting(hub, msg);
    }
  }
  return true;
}

/** Connect hubs marked for auto-join (no focus steal). Safe to call from panel + App. */
export async function runRrcHubAutoConnectBatch(nickname: string): Promise<void> {
  if (hubAutoConnectBusy) return;
  const pending = pendingRrcAutoJoinHubs();
  if (pending.length === 0) return;

  hubAutoConnectBusy = true;
  try {
    for (const hub of pending) {
      const canContinue = await connectRrcHubForAutoJoin(hub, nickname);
      if (!canContinue) break;
    }
  } finally {
    hubAutoConnectBusy = false;
  }
}

function readRrcNickname(): string {
  try {
    return localStorage.getItem(RRC_NICKNAME_STORAGE_KEY)?.trim() || 'mesh-client';
  } catch {
    // catch-no-log-ok: localStorage may throw in private browsing / quota errors
    return 'mesh-client';
  }
}

/**
 * Runs RRC hub auto-connect when the sidecar is up, and /list + room auto-join for active hubs.
 * Independent of RrcPanel mount.
 */
export function useRrcStartupAutoConnect(): void {
  const sessionsByHub = useRrcSessionStore((s) => s.sessionsByHub);
  const listSentForHubRef = useRef(new Set<string>());
  const roomAutoJoinDoneRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = (): void => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = (ms: number): void => {
      clearTimer();
      timer = setTimeout(() => {
        void tick();
      }, ms);
    };

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const running = await isReticulumSidecarRunning();
        if (cancelled) return;
        if (running) {
          await runRrcHubAutoConnectBatch(readRrcNickname());
        }
      } catch (e: unknown) {
        console.debug('[useRrcStartupAutoConnect] ' + errLikeToLogString(e));
      }
      if (cancelled) return;
      const pending = pendingRrcAutoJoinHubs();
      // Fast retry while waiting for live attach / first successful hub link.
      schedule(pending.length > 0 ? RRC_AUTO_CONNECT_FAST_MS : RRC_AUTO_CONNECT_STEADY_MS);
    };

    const onConfigured = (): void => {
      // Stack just became usable — do not wait for the next poll slot.
      void tick();
    };

    void tick();
    window.addEventListener(RETICULUM_CONFIGURED_EVENT, onConfigured);
    return () => {
      cancelled = true;
      clearTimer();
      window.removeEventListener(RETICULUM_CONFIGURED_EVENT, onConfigured);
    };
  }, []);

  useEffect(() => {
    for (const [hub, session] of sessionsByHub) {
      if (session.status !== 'active') continue;
      if (!listSentForHubRef.current.has(hub)) {
        listSentForHubRef.current.add(hub);
        void window.electronAPI.reticulum.rrc
          .send({
            hub_dest_hash: hub,
            body: '/list',
            type: 'msg',
          })
          .then((res) => {
            if (!res.ok) {
              listSentForHubRef.current.delete(hub);
              console.debug('[useRrcStartupAutoConnect] auto /list not ok ' + (res.error ?? ''));
            }
          })
          .catch((e: unknown) => {
            listSentForHubRef.current.delete(hub);
            console.debug('[useRrcStartupAutoConnect] auto /list ' + errLikeToLogString(e));
          });
      }
      if (!roomAutoJoinDoneRef.current.has(hub)) {
        roomAutoJoinDoneRef.current.add(hub);
        const roomsToJoin = loadRrcAutoJoinRooms(hub);
        const hubSession = useRrcSessionStore.getState().sessionsByHub.get(hub);
        let anyJoinFailed = false;
        const joinTasks = roomsToJoin.map((room) => {
          const resolved = resolveRrcJoinRoomName(room, {
            listed: hubSession?.listedRooms ?? [],
            joined: hubSession ? [...hubSession.rooms.values()] : [],
          });
          return window.electronAPI.reticulum.rrc
            .join({ hub_dest_hash: hub, room: resolved })
            .then((res) => {
              if (!res.ok) {
                anyJoinFailed = true;
                console.debug('[useRrcStartupAutoConnect] auto-join not ok ' + (res.error ?? ''));
              }
            })
            .catch((e: unknown) => {
              anyJoinFailed = true;
              console.debug('[useRrcStartupAutoConnect] auto-join ' + errLikeToLogString(e));
            });
        });
        void Promise.all(joinTasks)
          .then(() => {
            if (anyJoinFailed) roomAutoJoinDoneRef.current.delete(hub);
          })
          .catch((e: unknown) => {
            roomAutoJoinDoneRef.current.delete(hub);
            console.debug('[useRrcStartupAutoConnect] auto-join batch ' + errLikeToLogString(e));
          });
      }
    }
    for (const hub of listSentForHubRef.current) {
      if (!sessionsByHub.has(hub)) listSentForHubRef.current.delete(hub);
    }
    for (const hub of roomAutoJoinDoneRef.current) {
      if (!sessionsByHub.has(hub)) roomAutoJoinDoneRef.current.delete(hub);
    }
  }, [sessionsByHub]);
}
