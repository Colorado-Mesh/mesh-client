import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRrcSessionStore } from '../stores/rrcSessionStore';
import { persistRrcMessage } from './rrcMessagePersist';

const HUB = '28c7c1a68c735693aa8e6b8193ed44b2';

describe('rrcMessagePersist', () => {
  beforeEach(() => {
    useRrcSessionStore.getState().clearSession();
    vi.mocked(window.electronAPI.db.insertRrcMessage).mockReset();
    vi.mocked(window.electronAPI.db.insertRrcMessage).mockResolvedValue({ changes: 1 });
  });

  it('persistRrcMessage inserts via IPC', async () => {
    persistRrcMessage(HUB, {
      id: 'm1',
      room: 'Lobby',
      kind: 'msg',
      body: 'hello',
      timestamp: 123,
    });
    await vi.waitFor(() => {
      expect(window.electronAPI.db.insertRrcMessage).toHaveBeenCalledWith({
        message_id: 'm1',
        hub_hash: HUB,
        room: 'lobby',
        sender_hash: null,
        nickname: null,
        kind: 'msg',
        body: 'hello',
        timestamp: 123,
      });
    });
  });
});
