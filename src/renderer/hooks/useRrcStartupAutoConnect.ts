/**
 * Headless Reticulum RRC startup: hub auto-join + /list + room auto-join.
 * Mounted from App so RRC connects without opening the RRC panel.
 */
import { useEffect, useRef } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { loadRrcHubAutoJoin } from '@/renderer/lib/rrcHubPrefs';
import { isRrcHubLinked } from '@/renderer/lib/rrcHubSession';
import { resolveRrcJoinRoomName } from '@/renderer/lib/rrcRoomName';
import { loadRrcAutoJoinRooms } from '@/renderer/lib/rrcRoomPrefs';
import {
  MAX_RRC_HUB_SESSIONS,
  RRC_NICKNAME_STORAGE_KEY,
  useRrcSessionStore,
} from '@/renderer/stores/rrcSessionStore';

let hubAutoConnectBusy = false;

/** Connect hubs marked for auto-join (no focus steal). Safe to call from panel + App. */
export async function runRrcHubAutoConnectBatch(nickname: string): Promise<void> {
  if (hubAutoConnectBusy) return;
  const wanted = loadRrcHubAutoJoin();
  if (wanted.length === 0) return;

  const isLinked = (hub: string): boolean => {
    const s = useRrcSessionStore.getState().sessionsByHub.get(hub);
    return !!s && isRrcHubLinked(s.status);
  };

  const pending = wanted.filter((hub) => !isLinked(hub));
  if (pending.length === 0) return;

  hubAutoConnectBusy = true;
  try {
    for (const hub of pending) {
      const session = useRrcSessionStore.getState();
      if (isLinked(hub)) continue;
      if (!session.sessionsByHub.has(hub) && session.sessionsByHub.size >= MAX_RRC_HUB_SESSIONS) {
        break;
      }
      if (!session.focusedHubHash) {
        useRrcSessionStore.getState().setFocusedHub(hub);
      }
      useRrcSessionStore.getState().applyStatus('connecting', hub, null);
      useRrcSessionStore.getState().setDisconnectIntent(false, hub);
      useRrcSessionStore.getState().setError(null, hub);
      try {
        const res = await window.electronAPI.reticulum.rrc.connect({
          dest_hash: hub,
          nickname,
        });
        if (!res.ok) {
          const err = res.error ?? 'connect failed';
          if (/cancelled/i.test(err)) continue;
          useRrcSessionStore.getState().setError(err, hub);
          const cur = useRrcSessionStore.getState().sessionsByHub.get(hub);
          if (cur?.status === 'connecting' || cur?.status === 'awaiting_welcome') {
            useRrcSessionStore.getState().clearHubSession(hub);
          }
        }
      } catch (e: unknown) {
        const msg = errLikeToLogString(e);
        if (/cancelled/i.test(msg)) continue;
        console.debug(`[useRrcStartupAutoConnect] hub connect failed: ${msg}`);
        useRrcSessionStore.getState().setError(msg, hub);
        const cur = useRrcSessionStore.getState().sessionsByHub.get(hub);
        if (cur?.status === 'connecting' || cur?.status === 'awaiting_welcome') {
          useRrcSessionStore.getState().clearHubSession(hub);
        }
      }
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
    const tick = (): void => {
      void isReticulumSidecarRunning()
        .then((running) => {
          if (cancelled || !running) return;
          return runRrcHubAutoConnectBatch(readRrcNickname());
        })
        .catch((e: unknown) => {
          console.debug('[useRrcStartupAutoConnect] ' + errLikeToLogString(e));
        });
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
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
        void Promise.all(joinTasks).then(() => {
          if (anyJoinFailed) roomAutoJoinDoneRef.current.delete(hub);
        });
      }
    }
    for (const hub of [...listSentForHubRef.current]) {
      if (!sessionsByHub.has(hub)) listSentForHubRef.current.delete(hub);
    }
    for (const hub of [...roomAutoJoinDoneRef.current]) {
      if (!sessionsByHub.has(hub)) roomAutoJoinDoneRef.current.delete(hub);
    }
  }, [sessionsByHub]);
}
