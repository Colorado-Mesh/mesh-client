import { beforeEach, describe, expect, it } from 'vitest';

import { applyRrcWhoInboundNotice } from '@/renderer/lib/rrcWhoInbound';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

const hub = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function applyWho(body: string, clearWhoReplyPending?: (room: string, hubHash?: string) => void) {
  const session = useRrcSessionStore.getState();
  const hubSession = session.sessionsByHub.get(hub);
  return applyRrcWhoInboundNotice(body, hubSession?.rooms.keys() ?? [], {
    hubDestHash: hub,
    mergeRoomMembers: (room, members, mode, hubHash) => {
      useRrcSessionStore.getState().mergeRoomMembers(room, members, mode, hubHash);
    },
    consumeWhoTranscriptSlot: (room, hubHash) =>
      useRrcSessionStore.getState().consumeWhoTranscriptSlot(room, hubHash),
    clearWhoReplyPending,
  });
}

describe('applyRrcWhoInboundNotice', () => {
  beforeEach(() => {
    useRrcSessionStore.getState().clearSession();
  });

  it('replaces the joined-room roster and shows the first /who notice', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hub, 'Hub A');
    store.roomJoined('general');
    store.mergeRoomMembers(
      'general',
      [{ identity_hash: 'cccccccccccccccccccccccccccccccc', nickname: 'Alice' }],
      'replace',
      hub,
    );

    const result = applyWho('members in general: Bob (bbbbbbbbbbbb)');
    expect(result).toEqual({ action: 'transcript', room: 'general' });
    expect(useRrcSessionStore.getState().rooms.get('general')?.members).toEqual([
      { identity_hash: 'bbbbbbbbbbbb', nickname: 'Bob' },
    ]);
  });

  it('suppresses later /who notices via consumeWhoTranscriptSlot while updating roster', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hub, 'Hub A');
    store.roomJoined('general');

    expect(applyWho('members in general: Alice (aaaaaaaaaaaa)')).toEqual({
      action: 'transcript',
      room: 'general',
    });
    expect(applyWho('members in general: Bob (bbbbbbbbbbbb)')).toEqual({
      action: 'nicklist-only',
      room: 'general',
    });
    expect(useRrcSessionStore.getState().rooms.get('general')?.members).toEqual([
      { identity_hash: 'bbbbbbbbbbbb', nickname: 'Bob' },
    ]);
  });

  it('rejects /who for an unjoined room without merging or showing transcript', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hub, 'Hub A');
    store.roomJoined('general');

    expect(applyWho('members in evil: Eve (eeeeeeeeeeee)')).toEqual({ action: 'unjoined' });
    expect(useRrcSessionStore.getState().rooms.has('evil')).toBe(false);
    expect(useRrcSessionStore.getState().rooms.get('general')?.members ?? []).toEqual([]);
  });

  it('applies /who when joined rooms are a one-shot Map.keys() iterator', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hub, 'Hub A');
    store.roomJoined('general');
    const keys = useRrcSessionStore.getState().sessionsByHub.get(hub)?.rooms.keys() ?? [];
    // Intentionally pass the live iterator (same as production) — must not exhaust
    // before the join match.
    const result = applyRrcWhoInboundNotice('members in general: Carol (cccccccccccc)', keys, {
      hubDestHash: hub,
      mergeRoomMembers: (room, members, mode, hubHash) => {
        useRrcSessionStore.getState().mergeRoomMembers(room, members, mode, hubHash);
      },
      consumeWhoTranscriptSlot: (room, hubHash) =>
        useRrcSessionStore.getState().consumeWhoTranscriptSlot(room, hubHash),
    });
    expect(result).toEqual({ action: 'transcript', room: 'general' });
    expect(useRrcSessionStore.getState().rooms.get('general')?.members).toEqual([
      { identity_hash: 'cccccccccccc', nickname: 'Carol' },
    ]);
  });

  it('clears whoReplyPending on a parsed /who including empty roster', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hub, 'Hub A');
    store.roomJoined('general');
    store.markWhoReplyPending('general', hub);
    const cleared: string[] = [];
    expect(applyWho('members in general: (none)', (room) => cleared.push(room))).toEqual({
      action: 'transcript',
      room: 'general',
    });
    expect(cleared).toEqual(['general']);
  });

  it('clears whoReplyPending on parsed /who even when the room is unjoined', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hub, 'Hub A');
    store.roomJoined('general');
    const cleared: string[] = [];
    expect(applyWho('members in evil: Eve (eeeeeeeeeeee)', (room) => cleared.push(room))).toEqual({
      action: 'unjoined',
    });
    expect(cleared).toEqual(['evil']);
  });

  it('does not clear whoReplyPending for non-/who notices', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hub, 'Hub A');
    store.roomJoined('general');
    const cleared: string[] = [];
    expect(
      applyWho('room general: registered; mode=+r; topic=General chat', (room) =>
        cleared.push(room),
      ),
    ).toEqual({ action: 'skip' });
    expect(cleared).toEqual([]);
  });
});
