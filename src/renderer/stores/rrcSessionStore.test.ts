import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  migrateLegacyWhispersForHub,
  resetRrcLegacyWhispersMigrateForTests,
} from '@/renderer/lib/rrcLegacyWhispersMigrate';
import { clearRrcOpenDms, loadRrcOpenDms, saveRrcOpenDms } from '@/renderer/lib/rrcOpenDms';

import { useRrcSessionStore } from './rrcSessionStore';

describe('rrcSessionStore', () => {
  beforeEach(() => {
    useRrcSessionStore.setState({ unreadByHub: new Map(), unreadByRoom: new Map() });
    useRrcSessionStore.getState().clearSession();
    useRrcSessionStore.getState().setRrcPanelFocused(false);
    useRrcSessionStore.getState().setNickname('tester');
    useRrcSessionStore.getState().setLocalIdentityHash('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    vi.mocked(window.electronAPI.db.insertRrcMessage).mockClear();
    clearRrcOpenDms('28c7c1a68c735693aa8e6b8193ed44b2');
    clearRrcOpenDms('39d8d2b79d8467a4bb9f7c9204fe55c3');
  });

  it('migrates legacy [whispers] history into per-peer DMs once', async () => {
    const hubA = '28c7c1a68c735693aa8e6b8193ed44b2';
    const peerA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const selfHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    resetRrcLegacyWhispersMigrateForTests(hubA);
    clearRrcOpenDms(hubA);
    useRrcSessionStore.getState().setLocalIdentityHash(selfHash);
    useRrcSessionStore.getState().applyStatus('active', hubA, 'Hub A');
    vi.mocked(window.electronAPI.db.listRrcMessages).mockResolvedValue([
      {
        message_id: 'legacy-1',
        hub_hash: hubA,
        room: '[whispers]',
        sender_hash: peerA,
        nickname: 'Zeva',
        kind: 'notice',
        body: 'psst',
        timestamp: 10,
      },
    ]);
    vi.mocked(window.electronAPI.db.insertRrcMessage).mockResolvedValue({ changes: 1 });

    await migrateLegacyWhispersForHub(hubA);

    expect(useRrcSessionStore.getState().rooms.has(`@${peerA}`)).toBe(true);
    expect(loadRrcOpenDms(hubA)).toEqual([{ identity_hash: peerA, nickname: 'Zeva' }]);
    const key = useRrcSessionStore.getState().roomMessageKey(`@${peerA}`, hubA);
    expect(useRrcSessionStore.getState().messages.get(key ?? '')?.[0]?.body).toBe('psst');

    vi.mocked(window.electronAPI.db.listRrcMessages).mockClear();
    await migrateLegacyWhispersForHub(hubA);
    expect(window.electronAPI.db.listRrcMessages).not.toHaveBeenCalled();
  });

  it('opens and closes per-peer DMs without wiping message history', () => {
    const hubA = '28c7c1a68c735693aa8e6b8193ed44b2';
    const hubB = '39d8d2b79d8467a4bb9f7c9204fe55c3';
    const alice = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const bob = 'cccccccccccccccccccccccccccccccc';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.openDm({ identity_hash: alice, nickname: 'Alice' }, hubA, { focus: true });
    expect(useRrcSessionStore.getState().activeRoom).toBe(`@${alice}`);
    expect(useRrcSessionStore.getState().rooms.has(`@${alice}`)).toBe(true);

    store.addMessage({
      id: 'dm-1',
      room: `@${alice}`,
      kind: 'msg',
      body: 'hi Alice',
      sender_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      timestamp: 1,
      dst_hash: alice,
    });
    const key = useRrcSessionStore.getState().roomMessageKey(`@${alice}`, hubA);
    expect(useRrcSessionStore.getState().messages.get(key ?? '')?.length).toBe(1);

    store.openDm({ identity_hash: bob, nickname: 'Bob' }, hubA, { focus: false });
    expect(useRrcSessionStore.getState().rooms.has(`@${bob}`)).toBe(true);
    expect(useRrcSessionStore.getState().activeRoom).toBe(`@${alice}`);

    store.closeDm(`@${alice}`, hubA);
    expect(useRrcSessionStore.getState().rooms.has(`@${alice}`)).toBe(false);
    // History retained after leave.
    expect(useRrcSessionStore.getState().messages.get(key ?? '')?.length).toBe(1);

    // DMs on another hub stay isolated.
    store.applyStatus('active', hubB, 'Hub B');
    store.openDm({ identity_hash: bob, nickname: 'Bob' }, hubB, { focus: true });
    expect(useRrcSessionStore.getState().sessionsByHub.get(hubA)?.rooms.has(`@${bob}`)).toBe(true);
    expect(useRrcSessionStore.getState().sessionsByHub.get(hubB)?.rooms.has(`@${bob}`)).toBe(true);
  });

  it('restore with persist:false keeps newest-first open-DM storage order', () => {
    const hubA = '28c7c1a68c735693aa8e6b8193ed44b2';
    const alice = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const bob = 'cccccccccccccccccccccccccccccccc';
    const carol = 'dddddddddddddddddddddddddddddddd';
    // Newest-first as upsertRrcOpenDm would store after bob then alice then carol opens.
    saveRrcOpenDms(hubA, [
      { identity_hash: carol, nickname: 'Carol' },
      { identity_hash: bob, nickname: 'Bob' },
      { identity_hash: alice, nickname: 'Alice' },
    ]);
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    for (const dm of loadRrcOpenDms(hubA)) {
      store.openDm(dm, hubA, { focus: false, persist: false });
    }
    expect(loadRrcOpenDms(hubA).map((d) => d.identity_hash)).toEqual([carol, bob, alice]);
    expect(useRrcSessionStore.getState().rooms.has(`@${carol}`)).toBe(true);
    expect(useRrcSessionStore.getState().rooms.has(`@${bob}`)).toBe(true);
    expect(useRrcSessionStore.getState().rooms.has(`@${alice}`)).toBe(true);
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

  it('bumps unread for active room when RRC panel is not focused', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', '28c7c1a68c735693aa8e6b8193ed44b2', 'Community');
    store.roomJoined('#lobby');
    store.setActiveRoom('#lobby');
    store.setRrcPanelFocused(false);
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
    expect(useRrcSessionStore.getState().unreadByRoom.get('lobby')).toBe(1);
    expect(useRrcSessionStore.getState().totalUnread()).toBe(1);
  });

  it('does not bump unread for active room when RRC panel is focused', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', '28c7c1a68c735693aa8e6b8193ed44b2', 'Community');
    store.roomJoined('#lobby');
    store.setActiveRoom('#lobby');
    store.setRrcPanelFocused(true);
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
    expect(useRrcSessionStore.getState().unreadByRoom.get('lobby')).toBeUndefined();
    expect(useRrcSessionStore.getState().totalUnread()).toBe(0);
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

  it('removes peer PARTED members from nicklist (EX1 fanout)', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', '28c7c1a68c735693aa8e6b8193ed44b2', 'Community');
    store.roomJoined('lobby', [
      { identity_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nickname: 'Alice' },
      { identity_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', nickname: 'Bob' },
    ]);
    store.removeRoomMembers('lobby', [
      { identity_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', nickname: 'Bob' },
    ]);
    const members = useRrcSessionStore.getState().rooms.get('lobby')?.members ?? [];
    expect(members).toHaveLength(1);
    expect(members[0]?.nickname).toBe('Alice');
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

  it('drops departed nicks on authoritative /who replace', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', '28c7c1a68c735693aa8e6b8193ed44b2', 'Community');
    store.roomJoined('lobby');
    store.mergeRoomMembers(
      'lobby',
      [
        { identity_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nickname: 'Alice' },
        { identity_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', nickname: 'Bob' },
      ],
      'replace',
    );
    store.mergeRoomMembers(
      'lobby',
      [{ identity_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nickname: 'Alice' }],
      'replace',
    );
    expect(useRrcSessionStore.getState().rooms.get('lobby')?.members).toEqual([
      { identity_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nickname: 'Alice' },
    ]);
  });

  it('drops consecutive duplicate notice bodies', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', '28c7c1a68c735693aa8e6b8193ed44b2', 'Community');
    store.roomJoined('general');
    store.setActiveRoom('general');
    const notice = {
      room: 'general',
      kind: 'notice' as const,
      body: 'room general: registered; mode=+nrt; topic=(none)',
      timestamp: 1,
    };
    store.addMessage({ ...notice, id: 'a' });
    store.addMessage({ ...notice, id: 'b' });
    expect(
      useRrcSessionStore
        .getState()
        .messages.get(useRrcSessionStore.getState().roomMessageKey('general')!),
    ).toHaveLength(1);
  });

  it('refocuses and stashes unread when the focused hub is removed', () => {
    const store = useRrcSessionStore.getState();
    const hubA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const hubB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('#lobby');
    store.setActiveRoom('#other');
    store.addMessage(
      {
        id: '1',
        room: '#lobby',
        kind: 'msg',
        body: 'hi',
        sender_hash: 'cccccccccccccccccccccccccccccccc',
        timestamp: 1,
      },
      { bumpUnread: true },
    );
    store.applyStatus('active', hubB, 'Hub B');
    store.setFocusedHub(hubA);
    store.clearHubSession(hubA);
    const state = useRrcSessionStore.getState();
    expect(state.focusedHubHash).toBe(hubB);
    expect(state.sessionsByHub.has(hubA)).toBe(false);
    expect(state.sessionsByHub.get(hubB)?.status).toBe('active');
    expect(state.unreadForHub(hubA)).toBe(1);
  });

  it('routes background-hub room ops without changing the focused mirror', () => {
    const store = useRrcSessionStore.getState();
    const hubA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const hubB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('#alpha');
    store.setActiveRoom('#alpha');
    store.applyStatus('active', hubB, 'Hub B');
    store.roomJoined('#beta', undefined, hubB);
    store.setFocusedHub(hubA);
    store.setActiveRoom('#alpha');
    store.addMessage(
      {
        id: 'bg-1',
        room: '#beta',
        kind: 'msg',
        body: 'from B',
        sender_hash: 'cccccccccccccccccccccccccccccccc',
        timestamp: 1,
      },
      { bumpUnread: true, hubDestHash: hubB },
    );
    const state = useRrcSessionStore.getState();
    expect(state.focusedHubHash).toBe(hubA);
    expect(state.activeRoom).toBe('#alpha');
    expect(state.rooms.has('#alpha')).toBe(true);
    expect(state.sessionsByHub.get(hubB)?.rooms.has('#beta')).toBe(true);
    expect(state.unreadForHub(hubB)).toBe(1);
    expect(state.unreadForHub(hubA)).toBe(0);
  });

  it('persists new messages via IPC and merges history without duplicating ids', () => {
    const hub = '28c7c1a68c735693aa8e6b8193ed44b2';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hub, 'Community');
    store.roomJoined('#lobby');
    store.setActiveRoom('#lobby');
    store.addMessage({
      id: 'live-1',
      room: '#lobby',
      kind: 'msg',
      body: 'live',
      timestamp: 200,
    });
    expect(window.electronAPI.db.insertRrcMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: 'live-1', hub_hash: hub, room: 'lobby' }),
    );

    store.mergeHistoryMessages(hub, 'lobby', [
      { id: 'hist-1', room: 'lobby', kind: 'msg', body: 'old', timestamp: 100 },
      { id: 'live-1', room: 'lobby', kind: 'msg', body: 'live-dup', timestamp: 200 },
    ]);
    const list = useRrcSessionStore.getState().messages.get(`${hub}::lobby`)!;
    expect(list.map((m) => m.id)).toEqual(['hist-1', 'live-1']);
    expect(list[1]?.body).toBe('live');
  });

  it('shows the first /who NOTICE and suppresses later snapshots while updating roster', () => {
    const hub = '28c7c1a68c735693aa8e6b8193ed44b2';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hub, 'Community');
    store.roomJoined('general');
    store.setActiveRoom('general');
    store.mergeRoomMembers(
      'general',
      [{ identity_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nickname: 'Alice' }],
      'replace',
    );
    expect(store.consumeWhoTranscriptSlot('general')).toBe(true);
    store.addMessage({
      id: 'who-1',
      room: 'general',
      kind: 'notice',
      body: 'members in general: Alice (aaaaaaaaaaaa)',
      timestamp: 1,
    });
    store.mergeRoomMembers(
      'general',
      [{ identity_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', nickname: 'Bob' }],
      'replace',
    );
    expect(useRrcSessionStore.getState().consumeWhoTranscriptSlot('general')).toBe(false);
    const key = useRrcSessionStore.getState().roomMessageKey('general', hub)!;
    expect(useRrcSessionStore.getState().messages.get(key)).toHaveLength(1);
    expect(useRrcSessionStore.getState().rooms.get('general')?.members).toEqual([
      { identity_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', nickname: 'Bob' },
    ]);
  });

  it('resets /who gates on part for that room only', () => {
    const hub = '28c7c1a68c735693aa8e6b8193ed44b2';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hub, 'Community');
    store.roomJoined('general');
    store.roomJoined('lobby');
    expect(store.markWhoRequested('general')).toBe(true);
    expect(store.consumeWhoTranscriptSlot('general')).toBe(true);
    expect(store.markWhoRequested('lobby')).toBe(true);
    expect(store.consumeWhoTranscriptSlot('lobby')).toBe(true);
    store.roomParted('general');
    expect(useRrcSessionStore.getState().markWhoRequested('general')).toBe(true);
    expect(useRrcSessionStore.getState().consumeWhoTranscriptSlot('general')).toBe(true);
    expect(useRrcSessionStore.getState().markWhoRequested('lobby')).toBe(false);
    expect(useRrcSessionStore.getState().consumeWhoTranscriptSlot('lobby')).toBe(false);
  });

  it('keeps /who gates and rooms across reconnecting → active', () => {
    const hub = '28c7c1a68c735693aa8e6b8193ed44b2';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hub, 'Community');
    store.roomJoined('general');
    expect(store.markWhoRequested('general')).toBe(true);
    expect(store.consumeWhoTranscriptSlot('general')).toBe(true);
    store.applyStatus('reconnecting', hub);
    store.applyStatus('active', hub, 'Community');
    const session = useRrcSessionStore.getState().sessionsByHub.get(hub);
    expect(session?.rooms.has('general')).toBe(true);
    expect(session?.whoRequestedRooms.has('general')).toBe(true);
    expect(session?.whoTranscriptShownRooms.has('general')).toBe(true);
    expect(useRrcSessionStore.getState().markWhoRequested('general')).toBe(false);
    expect(useRrcSessionStore.getState().consumeWhoTranscriptSlot('general')).toBe(false);
  });

  it('drops /who gates on clearHubSession so a new connection can show one roster', () => {
    const hub = '28c7c1a68c735693aa8e6b8193ed44b2';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hub, 'Community');
    store.roomJoined('general');
    expect(store.markWhoRequested('general')).toBe(true);
    expect(store.consumeWhoTranscriptSlot('general')).toBe(true);
    store.clearHubSession(hub);
    store.applyStatus('active', hub, 'Community');
    expect(useRrcSessionStore.getState().markWhoRequested('general')).toBe(true);
    expect(useRrcSessionStore.getState().consumeWhoTranscriptSlot('general')).toBe(true);
  });

  it('keeps independent /who slots per hub and per room', () => {
    const hubA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const hubB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('general', undefined, hubA);
    expect(store.markWhoRequested('general', hubA)).toBe(true);
    expect(store.consumeWhoTranscriptSlot('general', hubA)).toBe(true);
    store.applyStatus('active', hubB, 'Hub B');
    store.roomJoined('general', undefined, hubB);
    expect(store.markWhoRequested('general', hubB)).toBe(true);
    expect(store.consumeWhoTranscriptSlot('general', hubB)).toBe(true);
    expect(store.markWhoRequested('general', hubA)).toBe(false);
    expect(store.consumeWhoTranscriptSlot('general', hubA)).toBe(false);
  });

  it('releaseWhoRequested allows a later auto /who', () => {
    const hub = '28c7c1a68c735693aa8e6b8193ed44b2';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hub, 'Community');
    store.roomJoined('general');
    expect(store.markWhoRequested('general')).toBe(true);
    expect(store.markWhoRequested('general')).toBe(false);
    store.releaseWhoRequested('general');
    expect(useRrcSessionStore.getState().markWhoRequested('general')).toBe(true);
  });

  it('shows a later /who NOTICE after reserveWhoTranscriptForce', () => {
    const hub = '28c7c1a68c735693aa8e6b8193ed44b2';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hub, 'Community');
    store.roomJoined('general');
    expect(store.consumeWhoTranscriptSlot('general')).toBe(true);
    expect(store.consumeWhoTranscriptSlot('general')).toBe(false);
    store.reserveWhoTranscriptForce('general');
    expect(useRrcSessionStore.getState().consumeWhoTranscriptSlot('general')).toBe(true);
    expect(useRrcSessionStore.getState().consumeWhoTranscriptSlot('general')).toBe(false);
  });

  it('releaseWhoTranscriptForce drops a pending forced snapshot', () => {
    const hub = '28c7c1a68c735693aa8e6b8193ed44b2';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hub, 'Community');
    store.roomJoined('general');
    expect(store.consumeWhoTranscriptSlot('general')).toBe(true);
    store.reserveWhoTranscriptForce('general');
    store.releaseWhoTranscriptForce('general');
    expect(useRrcSessionStore.getState().consumeWhoTranscriptSlot('general')).toBe(false);
  });
});
