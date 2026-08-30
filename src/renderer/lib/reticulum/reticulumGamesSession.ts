import { pushAppToast } from '@/renderer/components/Toast';
import i18n from '@/renderer/lib/i18n';
import { useReticulumGamesStore } from '@/renderer/stores/reticulumGamesStore';
import { GAMES_CMD, type GamesActionRequest, type GamesAppId } from '@/shared/games-types';

const DEST_HASH_RE = /^[0-9a-f]{32}$/;

export function normalizeGamesDestHash(hash: string): string | null {
  const v = hash.trim().toLowerCase();
  return DEST_HASH_RE.test(v) ? v : null;
}

/**
 * True when a failed action reason means the LRGP session passed its idle TTL
 * (~24h) and the protocol can no longer act on it. Matches the sidecar's stable
 * `session_expired` code as well as the older `dispatch_error: session expired`
 * wrapper so pre-fix sidecars are still recognized.
 */
export function isGamesSessionExpiredReason(reason: string | undefined): boolean {
  if (!reason) return false;
  const r = reason.toLowerCase();
  return r.includes('session_expired') || r.includes('session expired');
}

export async function refreshGamesStatus(): Promise<void> {
  try {
    const status = await window.electronAPI.reticulum.games.getStatus();
    useReticulumGamesStore.getState().setStatus(status);
  } catch (e) {
    console.debug('[reticulumGamesSession] getStatus failed', e);
  }
}

export async function refreshGamesApps(): Promise<void> {
  try {
    const res = await window.electronAPI.reticulum.games.listApps();
    const apps = 'apps' in res ? res.apps : undefined;
    useReticulumGamesStore.getState().setApps(apps);
  } catch (e) {
    console.debug('[reticulumGamesSession] listApps failed', e);
  }
}

export async function refreshGamesSessions(peer?: string): Promise<void> {
  try {
    const res = await window.electronAPI.reticulum.games.listSessions(peer);
    useReticulumGamesStore.getState().setSessions(res.sessions);
  } catch (e) {
    console.debug('[reticulumGamesSession] listSessions failed', e);
  }
}

export interface SendGamesActionOpts {
  destHash: string;
  appId: string;
  command: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
  /** When set, apply client optimistic board patch before IPC. */
  optimistic?:
    | { kind: 'ttt'; cellIndex: number }
    | { kind: 'four_in_a_row'; column: number }
    | { kind: 'chess'; uci: string };
}

/** Send an LRGP action over LXMF. Resolves `true` on success (`{ ok: true }`). */
export async function sendGamesAction(opts: SendGamesActionOpts): Promise<boolean> {
  const destHash = normalizeGamesDestHash(opts.destHash);
  if (!destHash) {
    pushAppToast(i18n.t('gamesPanel.errors.invalidPeerHash'), 'error');
    return false;
  }
  const store = useReticulumGamesStore.getState();
  const sessionId = opts.sessionId;
  let beganOptimistic = false;
  if (opts.optimistic && sessionId) {
    beganOptimistic =
      opts.optimistic.kind === 'ttt'
        ? store.beginOptimisticMove(sessionId, 'ttt', opts.optimistic.cellIndex)
        : opts.optimistic.kind === 'four_in_a_row'
          ? store.beginOptimisticMove(sessionId, 'four_in_a_row', opts.optimistic.column)
          : store.beginOptimisticMove(sessionId, 'chess', opts.optimistic.uci);
  }
  store.setActionBusy(true);
  try {
    const req: GamesActionRequest = {
      dest_hash: destHash,
      app_id: opts.appId,
      command: opts.command,
      session_id: opts.sessionId,
      payload: opts.payload,
    };
    const result = await window.electronAPI.reticulum.games.sendAction(req);
    if (!result.ok) {
      if (beganOptimistic && sessionId) {
        store.rollbackOptimistic(sessionId);
      }
      const reason = result.error ?? result.reason;
      if (isGamesSessionExpiredReason(reason)) {
        // The game is dead (idle >24h); the sidecar has flipped its stored
        // status to expired. Mirror that locally so the resign/draw controls
        // disappear immediately and the only remaining action is delete.
        if (sessionId) {
          const latest = useReticulumGamesStore.getState();
          const session = latest.sessions.find((row) => row.session_id === sessionId);
          if (session && session.status !== 'expired') {
            latest.upsertSession({ ...session, status: 'expired' });
          }
        }
        pushAppToast(i18n.t('gamesPanel.errors.sessionExpired'), 'error');
        return false;
      }
      pushAppToast(
        i18n.t('gamesPanel.errors.actionFailed', {
          reason: reason ?? i18n.t('gamesPanel.errors.unknownReason'),
        }),
        'error',
      );
      return false;
    }
    return true;
  } catch (e) {
    if (beganOptimistic && sessionId) {
      store.rollbackOptimistic(sessionId);
    }
    console.warn('[reticulumGamesSession] sendAction failed', e);
    pushAppToast(
      i18n.t('gamesPanel.errors.actionFailed', {
        reason: i18n.t('gamesPanel.errors.unknownReason'),
      }),
      'error',
    );
    return false;
  } finally {
    store.setActionBusy(false);
  }
}

export function sendGamesChallenge(destHash: string, appId: GamesAppId): Promise<boolean> {
  return sendGamesAction({ destHash, appId, command: GAMES_CMD.CHALLENGE });
}

export async function resendGamesAction(sessionId: string): Promise<boolean> {
  const store = useReticulumGamesStore.getState();
  store.setActionBusy(true);
  try {
    const result = await window.electronAPI.reticulum.games.resend(sessionId);
    const ok = result.ok;
    if (!ok) {
      pushAppToast(i18n.t('gamesPanel.errors.resendFailed'), 'error');
    }
    return ok;
  } catch (e) {
    console.warn('[reticulumGamesSession] resend failed', e);
    pushAppToast(i18n.t('gamesPanel.errors.resendFailed'), 'error');
    return false;
  } finally {
    store.setActionBusy(false);
  }
}

export async function markGamesSessionRead(sessionId: string): Promise<void> {
  try {
    const before = useReticulumGamesStore
      .getState()
      .sessions.find((row) => row.session_id === sessionId);
    const revision = before?.updated_at;
    await window.electronAPI.reticulum.games.markRead(sessionId);
    const state = useReticulumGamesStore.getState();
    const session = state.sessions.find((row) => row.session_id === sessionId);
    // Skip local unread clear when a newer games.update arrived during markRead.
    if (session && session.updated_at === revision && session.unread !== 0) {
      state.upsertSession({ ...session, unread: 0 });
    }
  } catch (e) {
    console.debug('[reticulumGamesSession] markRead failed', e);
  }
}

export async function deleteGamesSession(sessionId: string): Promise<void> {
  try {
    await window.electronAPI.reticulum.games.deleteSession(sessionId);
    useReticulumGamesStore.getState().removeSession(sessionId);
  } catch (e) {
    console.warn('[reticulumGamesSession] deleteSession failed', e);
    pushAppToast(i18n.t('gamesPanel.errors.deleteFailed'), 'error');
  }
}

/**
 * Select an LRGP session after refreshing the list (deep-link / notification entry).
 * Caller is responsible for switching protocol + Games tab.
 */
export async function openReticulumGameSession(sessionId: string): Promise<boolean> {
  const id = sessionId.trim().toLowerCase();
  if (!/^[0-9a-f]{16,64}$/.test(id)) return false;
  await refreshGamesSessions();
  useReticulumGamesStore.getState().selectSession(id);
  return true;
}
