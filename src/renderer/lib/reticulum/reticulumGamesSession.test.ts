// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/lib/i18n', () => ({
  default: { t: (key: string) => key },
}));

vi.mock('@/renderer/components/Toast', () => ({
  pushAppToast: vi.fn(),
}));

import { useReticulumGamesStore } from '@/renderer/stores/reticulumGamesStore';

import { markGamesSessionRead, openReticulumGameSession } from './reticulumGamesSession';

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 's1',
    identity_id: 'me',
    app_id: 'ttt',
    app_version: 1,
    contact_hash: 'a'.repeat(32),
    initiator: 'me',
    status: 'active',
    metadata: {},
    unread: 2,
    created_at: 1,
    updated_at: 10,
    last_action_at: 10,
    ...overrides,
  };
}

describe('markGamesSessionRead', () => {
  const markRead = vi.fn();

  beforeEach(() => {
    useReticulumGamesStore.getState().clear();
    markRead.mockReset();
    markRead.mockResolvedValue({ ok: true });
    Object.assign(window, {
      electronAPI: {
        reticulum: {
          games: { markRead },
        },
      },
    });
  });

  it('clears unread when the session revision is unchanged after markRead', async () => {
    useReticulumGamesStore.getState().upsertSession(makeSession());
    await markGamesSessionRead('s1');
    expect(markRead).toHaveBeenCalledWith('s1');
    expect(useReticulumGamesStore.getState().sessions[0]).toEqual(
      expect.objectContaining({ unread: 0 }),
    );
  });

  it('preserves unread when a games.update arrives during markRead', async () => {
    useReticulumGamesStore.getState().upsertSession(makeSession());
    markRead.mockImplementation(() => {
      useReticulumGamesStore.getState().applyGamesUpdate({
        app_id: 'ttt',
        session_id: 's1',
        direction: 'inbound',
        session: makeSession({ unread: 3, updated_at: 20, last_action_at: 20, status: 'active' }),
      });
      return Promise.resolve({ ok: true });
    });

    await markGamesSessionRead('s1');

    expect(useReticulumGamesStore.getState().sessions[0]).toEqual(
      expect.objectContaining({ updated_at: 20, unread: 3 }),
    );
  });
});

describe('openReticulumGameSession', () => {
  const listSessions = vi.fn();

  beforeEach(() => {
    useReticulumGamesStore.getState().clear();
    listSessions.mockReset();
    listSessions.mockResolvedValue({
      sessions: [makeSession({ session_id: 'a'.repeat(16) })],
    });
    Object.assign(window, {
      electronAPI: {
        reticulum: {
          games: { listSessions, markRead: vi.fn() },
        },
      },
    });
  });

  it('refreshes sessions and selects the target id', async () => {
    const id = 'a'.repeat(16);
    await expect(openReticulumGameSession(id)).resolves.toBe(true);
    expect(listSessions).toHaveBeenCalled();
    expect(useReticulumGamesStore.getState().selectedSessionId).toBe(id);
  });

  it('rejects invalid session ids', async () => {
    await expect(openReticulumGameSession('nope')).resolves.toBe(false);
    expect(listSessions).not.toHaveBeenCalled();
  });
});
