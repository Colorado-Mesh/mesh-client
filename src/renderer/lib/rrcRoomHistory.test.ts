import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRrcSessionStore } from '../stores/rrcSessionStore';
import {
  clearRrcRoomHistory,
  hydrateRrcRoomMessages,
  resetRrcRoomHistoryForTests,
} from './rrcRoomHistory';

const HUB = '28c7c1a68c735693aa8e6b8193ed44b2';

describe('rrcRoomHistory', () => {
  beforeEach(() => {
    resetRrcRoomHistoryForTests();
    useRrcSessionStore.getState().clearSession();
    vi.mocked(window.electronAPI.db.listRrcMessages).mockReset();
    vi.mocked(window.electronAPI.db.insertRrcMessage).mockReset();
    vi.mocked(window.electronAPI.db.deleteRrcMessagesByRoom).mockReset();
    vi.mocked(window.electronAPI.db.listRrcMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.insertRrcMessage).mockResolvedValue({ changes: 1 });
    vi.mocked(window.electronAPI.db.deleteRrcMessagesByRoom).mockResolvedValue({ changes: 0 });
  });

  it('hydrate merges rows and dedups against existing live messages', async () => {
    useRrcSessionStore.getState().applyStatus('active', HUB, 'Hub');
    useRrcSessionStore.getState().addMessage({
      id: 'live-1',
      room: 'lobby',
      kind: 'msg',
      body: 'live',
      timestamp: 200,
    });
    vi.mocked(window.electronAPI.db.listRrcMessages).mockResolvedValueOnce([
      {
        message_id: 'hist-1',
        hub_hash: HUB,
        room: 'lobby',
        sender_hash: null,
        nickname: 'alice',
        kind: 'msg',
        body: 'old',
        timestamp: 100,
      },
      {
        message_id: 'live-1',
        hub_hash: HUB,
        room: 'lobby',
        sender_hash: null,
        nickname: null,
        kind: 'msg',
        body: 'dup',
        timestamp: 200,
      },
    ]);

    await hydrateRrcRoomMessages(HUB, 'lobby');
    const list = useRrcSessionStore.getState().messages.get(`${HUB}::lobby`)!;
    expect(list.map((m) => m.id)).toEqual(['hist-1', 'live-1']);
    expect(list[1]?.body).toBe('live');

    // Second hydrate is a no-op (session cache).
    vi.mocked(window.electronAPI.db.listRrcMessages).mockClear();
    await hydrateRrcRoomMessages(HUB, 'lobby');
    expect(window.electronAPI.db.listRrcMessages).not.toHaveBeenCalled();
  });

  it('clearRrcRoomHistory deletes SQLite and memory', async () => {
    useRrcSessionStore.getState().applyStatus('active', HUB, 'Hub');
    useRrcSessionStore.getState().addMessage({
      id: 'm1',
      room: 'lobby',
      kind: 'msg',
      body: 'x',
      timestamp: 1,
    });
    await clearRrcRoomHistory(HUB, 'lobby');
    expect(window.electronAPI.db.deleteRrcMessagesByRoom).toHaveBeenCalledWith(HUB, 'lobby');
    expect(useRrcSessionStore.getState().messages.get(`${HUB}::lobby`)).toBeUndefined();
  });
});
