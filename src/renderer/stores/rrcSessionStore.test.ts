import { beforeEach, describe, expect, it } from 'vitest';

import { useRrcSessionStore } from './rrcSessionStore';

describe('rrcSessionStore', () => {
  beforeEach(() => {
    useRrcSessionStore.getState().clearSession();
    useRrcSessionStore.getState().setNickname('tester');
  });

  it('appends messages and bumps unread for inactive rooms', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', '28c7c1a68c735693aa8e6b8193ed44b2', 'Community');
    store.roomJoined('#lobby');
    store.setActiveRoom('#other');
    store.addMessage(
      {
        id: '1',
        room: '#lobby',
        kind: 'msg',
        body: 'hi',
        timestamp: 1,
      },
      { bumpUnread: true },
    );
    expect(useRrcSessionStore.getState().messages.get('#lobby')).toHaveLength(1);
    expect(useRrcSessionStore.getState().unreadByRoom.get('#lobby')).toBe(1);
    expect(useRrcSessionStore.getState().totalUnread()).toBe(1);
  });

  it('clears session on disconnect', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', 'abc', 'Hub');
    store.roomJoined('#lobby');
    store.addMessage({
      id: '1',
      room: '#lobby',
      kind: 'msg',
      body: 'hi',
      timestamp: 1,
    });
    store.clearSession();
    expect(useRrcSessionStore.getState().status).toBe('disconnected');
    expect(useRrcSessionStore.getState().rooms.size).toBe(0);
    expect(useRrcSessionStore.getState().messages.size).toBe(0);
  });
});
