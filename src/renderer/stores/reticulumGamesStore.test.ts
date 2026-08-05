import { beforeEach, describe, expect, it } from 'vitest';

import { useReticulumGamesStore } from './reticulumGamesStore';

function makeSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    session_id: 's1',
    identity_id: 'me',
    app_id: 'ttt',
    app_version: 1,
    contact_hash: 'a'.repeat(32),
    initiator: 'me',
    status: 'pending',
    metadata: {},
    unread: 1,
    created_at: 1,
    updated_at: 1,
    last_action_at: 1,
    ...overrides,
  };
}

describe('reticulumGamesStore', () => {
  beforeEach(() => {
    useReticulumGamesStore.getState().clear();
  });

  it('setSessions replaces the list and filters invalid rows', () => {
    useReticulumGamesStore.getState().setSessions([makeSession(), { not: 'a session' }, null]);
    expect(useReticulumGamesStore.getState().sessions).toHaveLength(1);
    expect(useReticulumGamesStore.getState().sessions[0].session_id).toBe('s1');
  });

  it('upsertSession inserts new and updates existing sessions', () => {
    const store = useReticulumGamesStore.getState();
    store.upsertSession(makeSession());
    expect(useReticulumGamesStore.getState().sessions).toHaveLength(1);

    store.upsertSession(makeSession({ status: 'active', last_action_at: 5 }));
    const sessions = useReticulumGamesStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('active');

    store.upsertSession(makeSession({ session_id: 's2', last_action_at: 10 }));
    expect(useReticulumGamesStore.getState().sessions).toHaveLength(2);
    // Sorted by last_action_at desc.
    expect(useReticulumGamesStore.getState().sessions[0].session_id).toBe('s2');
  });

  it('applyGamesUpdate upserts the session embedded in the WS payload', () => {
    useReticulumGamesStore.getState().applyGamesUpdate({
      app_id: 'ttt',
      session_id: 's1',
      direction: 'inbound',
      session: makeSession({ status: 'active' }),
    });
    const sessions = useReticulumGamesStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('active');
  });

  it('applyGamesUpdate ignores payloads with no session', () => {
    useReticulumGamesStore.getState().setSessions([makeSession()]);
    useReticulumGamesStore.getState().applyGamesUpdate({
      app_id: 'ttt',
      session_id: 's1',
      session: null,
      error: { code: 'not_your_turn' },
    });
    expect(useReticulumGamesStore.getState().sessions).toHaveLength(1);
  });

  it('applyActionResult clears actionBusy and stores the result', () => {
    useReticulumGamesStore.getState().setActionBusy(true);
    useReticulumGamesStore.getState().applyActionResult({
      app_id: 'ttt',
      session_id: 's1',
      ok: false,
      error: 'not_your_turn',
    });
    const state = useReticulumGamesStore.getState();
    expect(state.actionBusy).toBe(false);
    expect(state.lastActionResult?.ok).toBe(false);
    expect(state.lastActionResult?.error).toBe('not_your_turn');
  });

  it('selectSession clears lastActionResult when switching sessions', () => {
    useReticulumGamesStore.setState({
      lastActionResult: { app_id: 'ttt', session_id: 's1', ok: true },
    });
    useReticulumGamesStore.getState().selectSession('s2');
    expect(useReticulumGamesStore.getState().selectedSessionId).toBe('s2');
    expect(useReticulumGamesStore.getState().lastActionResult).toBeNull();
  });

  it('removeSession drops the row and clears selection if selected', () => {
    useReticulumGamesStore.getState().setSessions([makeSession()]);
    useReticulumGamesStore.getState().selectSession('s1');
    useReticulumGamesStore.getState().removeSession('s1');
    expect(useReticulumGamesStore.getState().sessions).toHaveLength(0);
    expect(useReticulumGamesStore.getState().selectedSessionId).toBeNull();
  });

  it('clear resets the whole store', () => {
    useReticulumGamesStore.getState().setSessions([makeSession()]);
    useReticulumGamesStore.getState().selectSession('s1');
    useReticulumGamesStore.getState().setActionBusy(true);
    useReticulumGamesStore.getState().clear();
    const state = useReticulumGamesStore.getState();
    expect(state.sessions).toHaveLength(0);
    expect(state.selectedSessionId).toBeNull();
    expect(state.actionBusy).toBe(false);
    expect(state.lastActionResult).toBeNull();
    expect(state.apps).toHaveLength(0);
    expect(state.status).toBeNull();
  });
});
