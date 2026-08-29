import { create } from 'zustand';

import {
  applyOptimisticChessMove,
  applyOptimisticFourInARowMove,
  applyOptimisticTttMove,
  restoreOptimisticBackup,
  snapshotSessionForOptimistic,
} from '@/renderer/lib/reticulum/reticulumGamesOptimistic';
import type {
  GamesActionResultEventPayload,
  GamesAppManifest,
  GameSession,
  GamesStatusResponse,
  GamesUpdateEventPayload,
} from '@/shared/games-types';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isGameSession(value: unknown): value is GameSession {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.session_id === 'string' &&
    v.session_id.length > 0 &&
    typeof v.identity_id === 'string' &&
    typeof v.app_id === 'string' &&
    isFiniteNumber(v.app_version) &&
    typeof v.contact_hash === 'string' &&
    typeof v.initiator === 'string' &&
    typeof v.status === 'string' &&
    !!v.metadata &&
    typeof v.metadata === 'object' &&
    !Array.isArray(v.metadata) &&
    isFiniteNumber(v.unread) &&
    isFiniteNumber(v.created_at) &&
    isFiniteNumber(v.updated_at) &&
    isFiniteNumber(v.last_action_at)
  );
}

function asGameSession(value: unknown): GameSession | null {
  return isGameSession(value) ? value : null;
}

function isGamesAppManifest(value: unknown): value is GamesAppManifest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.app_id === 'string' &&
    v.app_id.length > 0 &&
    isFiniteNumber(v.version) &&
    typeof v.display_name === 'string'
  );
}

function isGamesUpdatePayload(value: unknown): value is GamesUpdateEventPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.app_id === 'string' && typeof v.session_id === 'string';
}

interface ReticulumGamesStoreState {
  sessions: GameSession[];
  selectedSessionId: string | null;
  apps: GamesAppManifest[];
  status: GamesStatusResponse | null;
  actionBusy: boolean;
  lastActionResult: GamesActionResultEventPayload | null;
  /** session_id → pre-optimistic snapshot for rollback */
  optimisticBackup: Record<string, GameSession>;

  setSessions: (sessions: unknown) => void;
  upsertSession: (session: unknown) => void;
  removeSession: (sessionId: string) => void;
  applyGamesUpdate: (payload: unknown) => void;
  applyActionResult: (payload: unknown) => void;
  beginOptimisticMove: (
    sessionId: string,
    kind: 'ttt' | 'chess' | 'four_in_a_row',
    move: number | string,
  ) => boolean;
  clearOptimistic: (sessionId: string) => void;
  rollbackOptimistic: (sessionId: string) => void;
  setApps: (apps: unknown) => void;
  setStatus: (status: GamesStatusResponse | null) => void;
  selectSession: (sessionId: string | null) => void;
  setActionBusy: (busy: boolean) => void;
  clear: () => void;
}

function sortedSessions(sessions: GameSession[]): GameSession[] {
  return [...sessions].sort((a, b) => b.last_action_at - a.last_action_at);
}

function omitOptimistic(
  backup: Record<string, GameSession>,
  sessionId: string,
): Record<string, GameSession> {
  if (!(sessionId in backup)) return backup;
  return Object.fromEntries(Object.entries(backup).filter(([id]) => id !== sessionId));
}

function replaceSession(sessions: GameSession[], next: GameSession): GameSession[] {
  const idx = sessions.findIndex((row) => row.session_id === next.session_id);
  const copy = [...sessions];
  if (idx >= 0) {
    copy[idx] = next;
  } else {
    copy.push(next);
  }
  return sortedSessions(copy);
}

export const useReticulumGamesStore = create<ReticulumGamesStoreState>((set, get) => ({
  sessions: [],
  selectedSessionId: null,
  apps: [],
  status: null,
  actionBusy: false,
  lastActionResult: null,
  optimisticBackup: {},

  setSessions: (sessions) => {
    const list = Array.isArray(sessions) ? sessions.filter(isGameSession) : [];
    set({ sessions: sortedSessions(list) });
  },

  upsertSession: (session) => {
    const next = asGameSession(session);
    if (!next) return;
    set((s) => ({ sessions: replaceSession(s.sessions, next) }));
  },

  removeSession: (sessionId) => {
    set((s) => ({
      sessions: s.sessions.filter((row) => row.session_id !== sessionId),
      selectedSessionId: s.selectedSessionId === sessionId ? null : s.selectedSessionId,
      optimisticBackup: omitOptimistic(s.optimisticBackup, sessionId),
    }));
  },

  applyGamesUpdate: (payload) => {
    if (!isGamesUpdatePayload(payload)) return;
    const session = asGameSession(payload.session);
    if (!session) return;
    set((s) => ({
      sessions: replaceSession(s.sessions, session),
      optimisticBackup: omitOptimistic(s.optimisticBackup, session.session_id),
    }));
  },

  applyActionResult: (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as GamesActionResultEventPayload;
    if (typeof p.session_id !== 'string') {
      set({ actionBusy: false, lastActionResult: p });
      return;
    }
    if (p.ok) {
      set((s) => ({
        actionBusy: false,
        lastActionResult: p,
        optimisticBackup: omitOptimistic(s.optimisticBackup, p.session_id),
      }));
      return;
    }
    // Failure: restore optimistic backup when present.
    set((s) => {
      const backup = s.optimisticBackup[p.session_id];
      if (!backup) {
        return { actionBusy: false, lastActionResult: p };
      }
      return {
        actionBusy: false,
        lastActionResult: p,
        sessions: replaceSession(s.sessions, restoreOptimisticBackup(backup)),
        optimisticBackup: omitOptimistic(s.optimisticBackup, p.session_id),
      };
    });
  },

  beginOptimisticMove: (sessionId, kind, move) => {
    const session = get().sessions.find((row) => row.session_id === sessionId);
    if (!session) return false;
    if (get().optimisticBackup[sessionId]) return false;
    const backup = snapshotSessionForOptimistic(session);
    const patched =
      kind === 'ttt' && typeof move === 'number'
        ? applyOptimisticTttMove(session, move)
        : kind === 'four_in_a_row' && typeof move === 'number'
          ? applyOptimisticFourInARowMove(session, move)
          : kind === 'chess' && typeof move === 'string'
            ? applyOptimisticChessMove(session, move)
            : null;
    if (!patched) return false;
    set((s) => ({
      sessions: replaceSession(s.sessions, patched),
      optimisticBackup: { ...s.optimisticBackup, [sessionId]: backup },
    }));
    return true;
  },

  clearOptimistic: (sessionId) => {
    set((s) => ({
      optimisticBackup: omitOptimistic(s.optimisticBackup, sessionId),
    }));
  },

  rollbackOptimistic: (sessionId) => {
    set((s) => {
      const backup = s.optimisticBackup[sessionId];
      if (!backup) return s;
      return {
        sessions: replaceSession(s.sessions, restoreOptimisticBackup(backup)),
        optimisticBackup: omitOptimistic(s.optimisticBackup, sessionId),
      };
    });
  },

  setApps: (apps) => {
    const list = Array.isArray(apps) ? apps.filter(isGamesAppManifest) : [];
    set({ apps: list });
  },

  setStatus: (status) => {
    set({ status });
  },

  selectSession: (sessionId) => {
    set((s) => ({
      selectedSessionId: sessionId,
      lastActionResult: sessionId === s.selectedSessionId ? s.lastActionResult : null,
    }));
  },

  setActionBusy: (busy) => {
    set({ actionBusy: busy });
  },

  clear: () => {
    set({
      sessions: [],
      selectedSessionId: null,
      apps: [],
      status: null,
      actionBusy: false,
      lastActionResult: null,
      optimisticBackup: {},
    });
  },
}));
