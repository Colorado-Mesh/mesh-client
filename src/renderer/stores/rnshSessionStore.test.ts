import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRnshSessionStore } from './rnshSessionStore';

const DEST = 'a'.repeat(32);

describe('rnshSessionStore', () => {
  beforeEach(() => {
    useRnshSessionStore.getState().clearAll();
  });

  it('adds a session and focuses it, then removes it and clears focus', () => {
    const store = useRnshSessionStore.getState();
    store.addSession('s1', DEST);
    expect(useRnshSessionStore.getState().sessions.get('s1')?.status).toBe('connecting');
    expect(useRnshSessionStore.getState().focusedSessionId).toBe('s1');

    store.removeSession('s1');
    expect(useRnshSessionStore.getState().sessions.has('s1')).toBe(false);
    expect(useRnshSessionStore.getState().focusedSessionId).toBeNull();
  });

  it('keeps the first session focused when a second session is added', () => {
    const store = useRnshSessionStore.getState();
    store.addSession('s1', DEST);
    store.addSession('s2', DEST);
    expect(useRnshSessionStore.getState().focusedSessionId).toBe('s1');
  });

  it('applies status transitions from rnsh.status events', () => {
    const store = useRnshSessionStore.getState();
    store.addSession('s1', DEST);
    store.applyStatus('s1', 'active');
    expect(useRnshSessionStore.getState().sessions.get('s1')?.status).toBe('active');
  });

  it('applies rnsh.closed with return code and reason key', () => {
    const store = useRnshSessionStore.getState();
    store.addSession('s1', DEST);
    store.applyClosed('s1', 1, 'timeout');
    const session = useRnshSessionStore.getState().sessions.get('s1');
    expect(session?.status).toBe('closed');
    expect(session?.return_code).toBe(1);
    expect(session?.reason_key).toBe('timeout');
  });

  it('applies rnsh.error and sets the error message', () => {
    const store = useRnshSessionStore.getState();
    store.addSession('s1', DEST);
    store.applyError('s1', 'not_allowed', 'boom');
    const session = useRnshSessionStore.getState().sessions.get('s1');
    expect(session?.status).toBe('error');
    expect(session?.reason_key).toBe('not_allowed');
    expect(session?.error).toBe('boom');
  });

  it('seeds reconnectAttempts when adding a session after reconnect', () => {
    const store = useRnshSessionStore.getState();
    store.addSession('s2', DEST, { reconnectAttempts: 3 });
    expect(useRnshSessionStore.getState().sessions.get('s2')?.reconnectAttempts).toBe(3);
  });

  it('increments and resets reconnect attempts', () => {
    const store = useRnshSessionStore.getState();
    store.addSession('s1', DEST);
    expect(store.incrementReconnectAttempts('s1')).toBe(1);
    expect(store.incrementReconnectAttempts('s1')).toBe(2);
    store.resetReconnectAttempts('s1');
    expect(useRnshSessionStore.getState().sessions.get('s1')?.reconnectAttempts).toBe(0);
  });

  it('tracks disconnect intent so auto-reconnect can be suppressed', () => {
    const store = useRnshSessionStore.getState();
    store.addSession('s1', DEST);
    expect(useRnshSessionStore.getState().sessions.get('s1')?.disconnectIntent).toBe(false);
    store.setDisconnectIntent('s1', true);
    expect(useRnshSessionStore.getState().sessions.get('s1')?.disconnectIntent).toBe(true);
  });

  it('fans decoded stdout/stderr chunks out to subscribed listeners only', () => {
    const store = useRnshSessionStore.getState();
    store.addSession('s1', DEST);
    const listener = vi.fn();
    const unsubscribe = store.subscribeOutput('s1', listener);

    // "hi" base64-encoded
    store.applyOutput('s1', 'stdout', 'aGk=');
    expect(listener).toHaveBeenCalledTimes(1);
    const [chunk] = listener.mock.calls[0] as [{ stream: string; data: Uint8Array }];
    expect(chunk.stream).toBe('stdout');
    expect(new TextDecoder().decode(chunk.data)).toBe('hi');

    unsubscribe();
    store.applyOutput('s1', 'stdout', 'aGk=');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clearAll resets sessions, focus, and listeners', () => {
    const store = useRnshSessionStore.getState();
    store.addSession('s1', DEST);
    store.subscribeOutput('s1', vi.fn());
    store.clearAll();
    const state = useRnshSessionStore.getState();
    expect(state.sessions.size).toBe(0);
    expect(state.focusedSessionId).toBeNull();
    expect(state.outputListeners.size).toBe(0);
  });
});
