import { beforeEach, describe, expect, it } from 'vitest';

import { useRrcSessionStore } from './rrcSessionStore';

describe('rrcSessionStore', () => {
  beforeEach(() => {
    useRrcSessionStore.getState().clearSession();
    useRrcSessionStore.getState().setNickname('tester');
    useRrcSessionStore.getState().setLocalIdentityHash('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
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
        sender_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        timestamp: 1,
      },
      { bumpUnread: true },
    );
    expect(useRrcSessionStore.getState().messagesForActiveRoom()).toHaveLength(0);
    expect(
      useRrcSessionStore
        .getState()
        .messages.get(useRrcSessionStore.getState().roomMessageKey('#lobby')!),
    ).toHaveLength(1);
    expect(useRrcSessionStore.getState().unreadByRoom.get('#lobby')).toBe(1);
    expect(useRrcSessionStore.getState().totalUnread()).toBe(1);
  });

  it('does not bump unread for self echo', () => {
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
        sender_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        timestamp: 1,
      },
      { bumpUnread: true },
    );
    expect(useRrcSessionStore.getState().unreadByRoom.get('#lobby')).toBeUndefined();
  });

  it('isolates messages across hubs with the same room name', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', '11111111111111111111111111111111', 'HubA');
    store.roomJoined('#lobby');
    store.setActiveRoom('#lobby');
    store.addMessage({
      id: 'a1',
      room: '#lobby',
      kind: 'msg',
      body: 'from A',
      timestamp: 1,
    });
    expect(store.messagesForActiveRoom()).toHaveLength(1);

    store.applyStatus('connecting', '22222222222222222222222222222222', 'HubB');
    store.applyStatus('active', '22222222222222222222222222222222', 'HubB');
    store.roomJoined('#lobby');
    store.setActiveRoom('#lobby');
    expect(useRrcSessionStore.getState().messagesForActiveRoom()).toHaveLength(0);
    useRrcSessionStore.getState().addMessage({
      id: 'b1',
      room: '#lobby',
      kind: 'msg',
      body: 'from B',
      timestamp: 2,
    });
    expect(useRrcSessionStore.getState().messagesForActiveRoom()).toHaveLength(1);
    expect(useRrcSessionStore.getState().messagesForActiveRoom()[0]?.body).toBe('from B');
  });

  it('dedupes by wire message id', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', '28c7c1a68c735693aa8e6b8193ed44b2', 'Community');
    store.roomJoined('#lobby');
    store.setActiveRoom('#lobby');
    store.addMessage({ id: 'same', room: '#lobby', kind: 'msg', body: 'hi', timestamp: 1 });
    store.addMessage({ id: 'same', room: '#lobby', kind: 'msg', body: 'hi', timestamp: 1 });
    expect(store.messagesForActiveRoom()).toHaveLength(1);
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

  it('stores listed rooms and topics from /list parse', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', '28c7c1a68c735693aa8e6b8193ed44b2', 'Community');
    store.setListedRooms([{ name: '#lobby', topic: 'hello' }, { name: '#general' }]);
    expect(useRrcSessionStore.getState().listedRooms).toHaveLength(2);
    store.roomJoined('#lobby');
    store.setRoomTopic('#lobby', 'updated');
    expect(useRrcSessionStore.getState().rooms.get('#lobby')?.topic).toBe('updated');
  });

  it('distinguishes forced part from voluntary part intent', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', '28c7c1a68c735693aa8e6b8193ed44b2', 'Community');
    store.roomJoined('#lobby');
    store.setActiveRoom('#lobby');
    store.addMessage({
      id: '1',
      room: '#lobby',
      kind: 'msg',
      body: 'hi',
      timestamp: 1,
    });
    store.markPartIntent('#lobby');
    expect(useRrcSessionStore.getState().partIntentRooms.has('#lobby')).toBe(true);
    store.roomParted('#lobby');
    expect(useRrcSessionStore.getState().rooms.has('#lobby')).toBe(false);
    expect(useRrcSessionStore.getState().partIntentRooms.has('#lobby')).toBe(false);

    store.roomJoined('#ops');
    store.setActiveRoom('#ops');
    store.addMessage({
      id: '2',
      room: '#ops',
      kind: 'msg',
      body: 'secret',
      timestamp: 2,
    });
    const key = useRrcSessionStore.getState().roomMessageKey('#ops')!;
    store.roomParted('#ops', { forced: true });
    expect(useRrcSessionStore.getState().rooms.has('#ops')).toBe(false);
    expect(useRrcSessionStore.getState().messages.get(key)?.[0]?.body).toBe('secret');
  });

  it('preserves /who roster when a later empty JOINED arrives', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', '28c7c1a68c735693aa8e6b8193ed44b2', 'Community');
    store.roomJoined('lobby', []);
    store.mergeRoomMembers(
      'lobby',
      [
        { identity_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nickname: 'Alice' },
        { identity_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', nickname: 'Bob' },
      ],
      'replace',
    );
    expect(useRrcSessionStore.getState().rooms.get('lobby')?.members).toHaveLength(2);
    // Peer join notify with empty body (rrcd include_joined_member_list=false)
    store.roomJoined('lobby', []);
    expect(useRrcSessionStore.getState().rooms.get('lobby')?.members).toHaveLength(2);
  });

  it('merges non-empty JOINED presence into existing roster', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', '28c7c1a68c735693aa8e6b8193ed44b2', 'Community');
    store.roomJoined('lobby', [
      { identity_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nickname: 'Alice' },
    ]);
    store.roomJoined('lobby', [
      { identity_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', nickname: 'Bob' },
    ]);
    const members = useRrcSessionStore.getState().rooms.get('lobby')?.members ?? [];
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.nickname).sort()).toEqual(['Alice', 'Bob']);
  });
});
