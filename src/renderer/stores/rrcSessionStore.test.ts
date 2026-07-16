import { beforeEach, describe, expect, it } from 'vitest';

import { useRrcSessionStore } from './rrcSessionStore';

describe('rrcSessionStore', () => {
  beforeEach(() => {
    useRrcSessionStore.setState({ unreadByHub: new Map(), unreadByRoom: new Map() });
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
    expect(useRrcSessionStore.getState().unreadByRoom.get('lobby')).toBe(1);
    expect(useRrcSessionStore.getState().totalUnread()).toBe(1);
    expect(useRrcSessionStore.getState().unreadForHub('28c7c1a68c735693aa8e6b8193ed44b2')).toBe(1);
  });

  it('stashes hub unread across disconnect wipe', () => {
    const store = useRrcSessionStore.getState();
    const hub = '28c7c1a68c735693aa8e6b8193ed44b2';
    store.applyStatus('active', hub, 'Community');
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
    store.applyStatus('disconnected');
    expect(useRrcSessionStore.getState().unreadByRoom.size).toBe(0);
    expect(useRrcSessionStore.getState().unreadForHub(hub)).toBe(1);
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
    expect(useRrcSessionStore.getState().unreadByRoom.get('lobby')).toBeUndefined();
  });

  it('isolates messages across hubs with the same room name, and focus switch preserves both', () => {
    const hubA = '11111111111111111111111111111111';
    const hubB = '22222222222222222222222222222222';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'HubA');
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

    // Focus hub B (as RrcPanel.handleConnect does) before its own applyStatus arrives.
    store.setFocusedHub(hubB);
    store.applyStatus('connecting', hubB, 'HubB');
    store.applyStatus('active', hubB, 'HubB');
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

    // Switching focus back to hub A must not have lost its room or message history.
    useRrcSessionStore.getState().setFocusedHub(hubA);
    const back = useRrcSessionStore.getState();
    expect(back.rooms.has('#lobby')).toBe(true);
    expect(back.activeRoom).toBe('#lobby');
    expect(back.messagesForActiveRoom()).toHaveLength(1);
    expect(back.messagesForActiveRoom()[0]?.body).toBe('from A');

    // Hub B is untouched by the round-trip.
    expect(back.sessionsByHub.get(hubB)?.rooms.has('#lobby')).toBe(true);
    expect(back.sessionsByHub.get(hubB)?.status).toBe('active');
  });

  it('disconnecting one hub leaves the other connected', () => {
    const hubA = '11111111111111111111111111111111';
    const hubB = '22222222222222222222222222222222';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'HubA');
    store.roomJoined('#lobby');
    store.setFocusedHub(hubB);
    store.applyStatus('active', hubB, 'HubB');
    store.roomJoined('#ops');

    store.clearHubSession(hubA);

    const state = useRrcSessionStore.getState();
    expect(state.sessionsByHub.has(hubA)).toBe(false);
    expect(state.sessionsByHub.has(hubB)).toBe(true);
    // Hub B was not the removed hub, so focus and its mirror stay put.
    expect(state.focusedHubHash).toBe(hubB);
    expect(state.status).toBe('active');
    expect(state.rooms.has('#ops')).toBe(true);
  });

  it('applyStatus connecting for hub B does not wipe hub A', () => {
    const hubA = '11111111111111111111111111111111';
    const hubB = '22222222222222222222222222222222';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'HubA');
    store.roomJoined('#lobby');
    store.addMessage({ id: 'a1', room: '#lobby', kind: 'msg', body: 'from A', timestamp: 1 });

    // No setFocusedHub call here — a background WS `rrc.connected` for hub B must not steal focus.
    store.applyStatus('connecting', hubB, 'HubB');

    const state = useRrcSessionStore.getState();
    expect(state.focusedHubHash).toBe(hubA);
    expect(state.status).toBe('active');
    expect(state.hubName).toBe('HubA');
    expect(state.rooms.has('#lobby')).toBe(true);
    expect(state.messages.get(state.roomMessageKey('#lobby')!)).toHaveLength(1);
    expect(state.sessionsByHub.get(hubB)?.status).toBe('connecting');
    expect(state.sessionsByHub.get(hubA)?.rooms.has('#lobby')).toBe(true);
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
    expect(useRrcSessionStore.getState().partIntentRooms.has('lobby')).toBe(true);
    store.roomParted('#lobby');
    expect(useRrcSessionStore.getState().rooms.has('#lobby')).toBe(false);
    expect(useRrcSessionStore.getState().partIntentRooms.has('lobby')).toBe(false);

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

  it('coalesces #general and general into one joined room', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', '28c7c1a68c735693aa8e6b8193ed44b2', 'Community');
    store.roomJoined('#general', [
      { identity_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nickname: 'Alice' },
    ]);
    store.roomJoined('general', [
      { identity_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', nickname: 'Bob' },
    ]);
    const state = useRrcSessionStore.getState();
    expect(state.rooms.size).toBe(1);
    // Keep the first JOIN spelling so PART matches the wire room.
    expect(state.rooms.has('#general')).toBe(true);
    expect(state.rooms.get('#general')?.members).toHaveLength(2);
    store.setActiveRoom('general');
    expect(useRrcSessionStore.getState().activeRoom).toBe('#general');
  });

  it('preserves full hashes and nicks when /who replace uses prefixes', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', '28c7c1a68c735693aa8e6b8193ed44b2', 'Community');
    store.roomJoined('lobby');
    store.mergeRoomMembers(
      'lobby',
      [{ identity_hash: 'aabbccddeeff00112233445566778899', nickname: 'Alice' }],
      'merge',
    );
    store.mergeRoomMembers(
      'lobby',
      [
        { identity_hash: 'aabbccddeeff', nickname: 'Anonymous' },
        { identity_hash: 'bbbbbbbbbbbb', nickname: 'Bob' },
      ],
      'replace',
    );
    const members = useRrcSessionStore.getState().rooms.get('lobby')?.members ?? [];
    expect(members).toEqual([
      { identity_hash: 'aabbccddeeff00112233445566778899', nickname: 'Alice' },
      { identity_hash: 'bbbbbbbbbbbb', nickname: 'Bob' },
    ]);
  });
});
