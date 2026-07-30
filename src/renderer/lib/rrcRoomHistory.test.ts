import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RRC_ROOM_HISTORY_LOAD_COUNT } from '@/renderer/lib/sessionMemoryCaps';

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

  it('passes RRC_ROOM_HISTORY_LOAD_COUNT as listRrcMessages third arg', async () => {
    await hydrateRrcRoomMessages(HUB, 'lobby');
    expect(window.electronAPI.db.listRrcMessages).toHaveBeenCalledWith(
      HUB,
      'lobby',
      RRC_ROOM_HISTORY_LOAD_COUNT,
    );
    expect(RRC_ROOM_HISTORY_LOAD_COUNT).toBe(500);
  });

  it('force:true reloads after an initial hydrate', async () => {
    vi.mocked(window.electronAPI.db.listRrcMessages).mockResolvedValue([]);
    await hydrateRrcRoomMessages(HUB, 'lobby');
    vi.mocked(window.electronAPI.db.listRrcMessages).mockClear();
    vi.mocked(window.electronAPI.db.listRrcMessages).mockResolvedValueOnce([
      {
        message_id: 'forced-1',
        hub_hash: HUB,
        room: 'lobby',
        sender_hash: null,
        nickname: null,
        kind: 'msg',
        body: 'reload',
        timestamp: 50,
      },
    ]);

    await hydrateRrcRoomMessages(HUB, 'lobby', { force: true });

    expect(window.electronAPI.db.listRrcMessages).toHaveBeenCalledTimes(1);
    const list = useRrcSessionStore.getState().messages.get(`${HUB}::lobby`)!;
    expect(list.map((m) => m.id)).toEqual(['forced-1']);
  });

  it('skips rows with invalid kind', async () => {
    vi.mocked(window.electronAPI.db.listRrcMessages).mockResolvedValueOnce([
      {
        message_id: 'bad-kind',
        hub_hash: HUB,
        room: 'lobby',
        sender_hash: null,
        nickname: null,
        kind: 'not-a-kind',
        body: 'skip me',
        timestamp: 10,
      },
      {
        message_id: 'good-1',
        hub_hash: HUB,
        room: 'lobby',
        sender_hash: null,
        nickname: null,
        kind: 'notice',
        body: 'keep',
        timestamp: 20,
      },
    ]);

    await hydrateRrcRoomMessages(HUB, 'lobby');
    const list = useRrcSessionStore.getState().messages.get(`${HUB}::lobby`)!;
    expect(list.map((m) => m.id)).toEqual(['good-1']);
    expect(list[0]?.kind).toBe('notice');
  });

  it('hydrate IPC failure does not leave hydrated key so next call retries', async () => {
    vi.mocked(window.electronAPI.db.listRrcMessages).mockRejectedValueOnce(new Error('db down'));
    await hydrateRrcRoomMessages(HUB, 'lobby');
    expect(useRrcSessionStore.getState().messages.get(`${HUB}::lobby`)).toBeUndefined();

    vi.mocked(window.electronAPI.db.listRrcMessages).mockResolvedValueOnce([
      {
        message_id: 'retry-1',
        hub_hash: HUB,
        room: 'lobby',
        sender_hash: null,
        nickname: null,
        kind: 'msg',
        body: 'after retry',
        timestamp: 1,
      },
    ]);
    await hydrateRrcRoomMessages(HUB, 'lobby');
    expect(window.electronAPI.db.listRrcMessages).toHaveBeenCalledTimes(2);
    expect(
      useRrcSessionStore
        .getState()
        .messages.get(`${HUB}::lobby`)
        ?.map((m) => m.id),
    ).toEqual(['retry-1']);
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

  it('clear still clears memory when delete rejects', async () => {
    useRrcSessionStore.getState().applyStatus('active', HUB, 'Hub');
    useRrcSessionStore.getState().addMessage({
      id: 'm1',
      room: 'lobby',
      kind: 'msg',
      body: 'x',
      timestamp: 1,
    });
    // Seed hydrate cache so a later hydrate would otherwise no-op without clear.
    await hydrateRrcRoomMessages(HUB, 'lobby');
    vi.mocked(window.electronAPI.db.deleteRrcMessagesByRoom).mockRejectedValueOnce(
      new Error('delete failed'),
    );

    await clearRrcRoomHistory(HUB, 'lobby');

    expect(useRrcSessionStore.getState().messages.get(`${HUB}::lobby`)).toBeUndefined();
    vi.mocked(window.electronAPI.db.listRrcMessages).mockClear();
    vi.mocked(window.electronAPI.db.listRrcMessages).mockResolvedValueOnce([]);
    await hydrateRrcRoomMessages(HUB, 'lobby');
    expect(window.electronAPI.db.listRrcMessages).toHaveBeenCalled();
  });

  it('clearHubSession drops hydrated keys for that hub only', async () => {
    const hubB = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    await hydrateRrcRoomMessages(HUB, 'lobby');
    await hydrateRrcRoomMessages(hubB, 'ops');
    vi.mocked(window.electronAPI.db.listRrcMessages).mockClear();

    useRrcSessionStore.getState().clearHubSession(HUB);

    await hydrateRrcRoomMessages(HUB, 'lobby');
    expect(window.electronAPI.db.listRrcMessages).toHaveBeenCalledWith(
      HUB,
      'lobby',
      RRC_ROOM_HISTORY_LOAD_COUNT,
    );
    vi.mocked(window.electronAPI.db.listRrcMessages).mockClear();
    await hydrateRrcRoomMessages(hubB, 'ops');
    expect(window.electronAPI.db.listRrcMessages).not.toHaveBeenCalled();
  });
});
