import { create } from 'zustand';

import type { RnshSessionStatus } from '@/shared/remote-types';

/** Max rnsh sessions tracked at once (soft cap; mirrors sidecar-side session bookkeeping). */
export const MAX_RNSH_SESSIONS = 8;

/** Default cap for auto-reconnect attempts after an unexpected `rnsh.closed` / `rnsh.error`. */
export const DEFAULT_RNSH_MAX_RECONNECT_ATTEMPTS = 5;

export type RnshOutputStream = 'stdout' | 'stderr';

export interface RnshOutputChunk {
  stream: RnshOutputStream;
  /** Raw UTF-8 bytes decoded from the base64 WS payload — feed straight into xterm `write()`. */
  data: Uint8Array;
}

export type RnshOutputListener = (chunk: RnshOutputChunk) => void;

export interface RnshSessionState {
  session_id: string;
  destination_hash: string;
  status: RnshSessionStatus;
  return_code: number | null;
  /** Last `rnsh.error` / `rnsh.closed` reason key (see `RemoteReasonKey`); raw sidecar value. */
  reason_key: string | null;
  error: string | null;
  reconnectAttempts: number;
  /** True once the user explicitly disconnected — suppresses auto-reconnect on `rnsh.closed`. */
  disconnectIntent: boolean;
  createdAt: number;
  updatedAt: number;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    // catch-no-log-ok malformed base64 from sidecar — render nothing rather than throw
    return new Uint8Array(0);
  }
}

interface RnshSessionStoreState {
  sessions: Map<string, RnshSessionState>;
  focusedSessionId: string | null;
  /** Per-session stdout/stderr fan-out — panels subscribe imperatively instead of storing scrollback in state. */
  outputListeners: Map<string, Set<RnshOutputListener>>;

  addSession: (sessionId: string, destinationHash: string) => void;
  removeSession: (sessionId: string) => void;
  setFocusedSession: (sessionId: string | null) => void;
  setDisconnectIntent: (sessionId: string, intent: boolean) => void;
  applyStatus: (sessionId: string, status: RnshSessionStatus, destinationHash?: string) => void;
  applyClosed: (sessionId: string, returnCode?: number | null, reasonKey?: string | null) => void;
  applyError: (sessionId: string, reasonKey: string, message: string) => void;
  applyOutput: (sessionId: string, stream: RnshOutputStream, base64Data: string) => void;
  subscribeOutput: (sessionId: string, listener: RnshOutputListener) => () => void;
  incrementReconnectAttempts: (sessionId: string) => number;
  resetReconnectAttempts: (sessionId: string) => void;
  getSession: (sessionId: string) => RnshSessionState | undefined;
  clearAll: () => void;
}

export const useRnshSessionStore = create<RnshSessionStoreState>((set, get) => ({
  sessions: new Map(),
  focusedSessionId: null,
  outputListeners: new Map(),

  addSession: (sessionId, destinationHash) => {
    set((s) => {
      const sessions = new Map(s.sessions);
      const now = Date.now();
      sessions.set(sessionId, {
        session_id: sessionId,
        destination_hash: destinationHash.toLowerCase(),
        status: 'connecting',
        return_code: null,
        reason_key: null,
        error: null,
        reconnectAttempts: 0,
        disconnectIntent: false,
        createdAt: now,
        updatedAt: now,
      });
      const focusedSessionId = s.focusedSessionId ?? sessionId;
      return { sessions, focusedSessionId };
    });
  },

  removeSession: (sessionId) => {
    set((s) => {
      const sessions = new Map(s.sessions);
      sessions.delete(sessionId);
      const outputListeners = new Map(s.outputListeners);
      outputListeners.delete(sessionId);
      const focusedSessionId =
        s.focusedSessionId === sessionId ? ([...sessions.keys()][0] ?? null) : s.focusedSessionId;
      return { sessions, outputListeners, focusedSessionId };
    });
  },

  setFocusedSession: (sessionId) => {
    set({ focusedSessionId: sessionId });
  },

  setDisconnectIntent: (sessionId, intent) => {
    set((s) => {
      const existing = s.sessions.get(sessionId);
      if (!existing) return {};
      const sessions = new Map(s.sessions);
      sessions.set(sessionId, { ...existing, disconnectIntent: intent });
      return { sessions };
    });
  },

  applyStatus: (sessionId, status, destinationHash) => {
    set((s) => {
      const existing = s.sessions.get(sessionId);
      if (!existing) return {};
      const sessions = new Map(s.sessions);
      sessions.set(sessionId, {
        ...existing,
        status,
        destination_hash: destinationHash?.toLowerCase() ?? existing.destination_hash,
        updatedAt: Date.now(),
      });
      return { sessions };
    });
  },

  applyClosed: (sessionId, returnCode, reasonKey) => {
    set((s) => {
      const existing = s.sessions.get(sessionId);
      if (!existing) return {};
      const sessions = new Map(s.sessions);
      sessions.set(sessionId, {
        ...existing,
        status: 'closed',
        return_code: returnCode ?? null,
        reason_key: reasonKey ?? null,
        updatedAt: Date.now(),
      });
      return { sessions };
    });
  },

  applyError: (sessionId, reasonKey, message) => {
    set((s) => {
      const existing = s.sessions.get(sessionId);
      if (!existing) return {};
      const sessions = new Map(s.sessions);
      sessions.set(sessionId, {
        ...existing,
        status: 'error',
        reason_key: reasonKey,
        error: message,
        updatedAt: Date.now(),
      });
      return { sessions };
    });
  },

  applyOutput: (sessionId, stream, base64Data) => {
    const listeners = get().outputListeners.get(sessionId);
    if (!listeners || listeners.size === 0) return;
    const data = decodeBase64ToBytes(base64Data);
    for (const listener of listeners) {
      listener({ stream, data });
    }
  },

  subscribeOutput: (sessionId, listener) => {
    set((s) => {
      const outputListeners = new Map(s.outputListeners);
      const set2 = new Set(outputListeners.get(sessionId));
      set2.add(listener);
      outputListeners.set(sessionId, set2);
      return { outputListeners };
    });
    return () => {
      set((s) => {
        const outputListeners = new Map(s.outputListeners);
        const set2 = outputListeners.get(sessionId);
        if (!set2) return {};
        const next = new Set(set2);
        next.delete(listener);
        if (next.size === 0) outputListeners.delete(sessionId);
        else outputListeners.set(sessionId, next);
        return { outputListeners };
      });
    };
  },

  incrementReconnectAttempts: (sessionId) => {
    let next = 0;
    set((s) => {
      const existing = s.sessions.get(sessionId);
      if (!existing) return {};
      next = existing.reconnectAttempts + 1;
      const sessions = new Map(s.sessions);
      sessions.set(sessionId, { ...existing, reconnectAttempts: next, updatedAt: Date.now() });
      return { sessions };
    });
    return next;
  },

  resetReconnectAttempts: (sessionId) => {
    set((s) => {
      const existing = s.sessions.get(sessionId);
      if (!existing || existing.reconnectAttempts === 0) return {};
      const sessions = new Map(s.sessions);
      sessions.set(sessionId, { ...existing, reconnectAttempts: 0 });
      return { sessions };
    });
  },

  getSession: (sessionId) => get().sessions.get(sessionId),

  clearAll: () => {
    set({ sessions: new Map(), focusedSessionId: null, outputListeners: new Map() });
  },
}));
