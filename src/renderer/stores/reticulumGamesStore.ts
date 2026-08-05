import { create } from 'zustand';

import type {
  GamesActionResultEventPayload,
  GamesAppManifest,
  GameSession,
  GamesStatusResponse,
  GamesUpdateEventPayload,
} from '@/shared/games-types';

function isGameSession(value: unknown): value is GameSession {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.session_id === 'string' && v.session_id.length > 0;
}

function asGameSession(value: unknown): GameSession | null {
  return isGameSession(value) ? value : null;
}

interface ReticulumGamesStoreState {
  sessions: GameSession[];
  selectedSessionId: string | null;
  apps: GamesAppManifest[];
  status: GamesStatusResponse | null;
  actionBusy: boolean;
  lastActionResult: GamesActionResultEventPayload | null;

  setSessions: (sessions: unknown) => void;
  upsertSession: (session: unknown) => void;
  removeSession: (sessionId: string) => void;
  applyGamesUpdate: (payload: unknown) => void;
  applyActionResult: (payload: unknown) => void;
  setApps: (apps: unknown) => void;
  setStatus: (status: GamesStatusResponse | null) => void;
  selectSession: (sessionId: string | null) => void;
  setActionBusy: (busy: boolean) => void;
  clear: () => void;
}

function sortedSessions(sessions: GameSession[]): GameSession[] {
  return [...sessions].sort((a, b) => b.last_action_at - a.last_action_at);
}

export const useReticulumGamesStore = create<ReticulumGamesStoreState>((set) => ({
  sessions: [],
  selectedSessionId: null,
  apps: [],
  status: null,
  actionBusy: false,
  lastActionResult: null,

  setSessions: (sessions) => {
    const list = Array.isArray(sessions) ? sessions.filter(isGameSession) : [];
    set({ sessions: sortedSessions(list) });
  },

  upsertSession: (session) => {
    const next = asGameSession(session);
    if (!next) return;
    set((s) => {
      const idx = s.sessions.findIndex((row) => row.session_id === next.session_id);
      const sessions = [...s.sessions];
      if (idx >= 0) {
        sessions[idx] = next;
      } else {
        sessions.push(next);
      }
      return { sessions: sortedSessions(sessions) };
    });
  },

  removeSession: (sessionId) => {
    set((s) => ({
      sessions: s.sessions.filter((row) => row.session_id !== sessionId),
      selectedSessionId: s.selectedSessionId === sessionId ? null : s.selectedSessionId,
    }));
  },

  applyGamesUpdate: (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as GamesUpdateEventPayload;
    const session = asGameSession(p.session);
    if (!session) return;
    set((s) => {
      const idx = s.sessions.findIndex((row) => row.session_id === session.session_id);
      const sessions = [...s.sessions];
      if (idx >= 0) {
        sessions[idx] = session;
      } else {
        sessions.push(session);
      }
      return { sessions: sortedSessions(sessions) };
    });
  },

  applyActionResult: (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as GamesActionResultEventPayload;
    set({ actionBusy: false, lastActionResult: p });
  },

  setApps: (apps) => {
    const list = Array.isArray(apps)
      ? apps.filter(
          (a): a is GamesAppManifest =>
            !!a && typeof a === 'object' && typeof (a as GamesAppManifest).app_id === 'string',
        )
      : [];
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
    });
  },
}));
