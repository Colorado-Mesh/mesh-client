import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearDraft,
  draftsStorageKey,
  ensureMeshcoreChatLastReadSanitized,
  lastReadStorageKey,
  loadDraftsInitial,
  loadMutedViews,
  loadOpenDmTabsInitial,
  loadPersistedLastReadInitial,
  loadPersistedRoomsLastRead,
  loadStarred,
  mergeRoomLastReadWatermark,
  openDmTabsStorageKey,
  roomsLastReadStorageKey,
  sanitizeMeshcoreChatLastRead,
  sanitizeMeshcoreRoomsLastRead,
  saveDraft,
  saveMutedViews,
  savePersistedRoomsLastRead,
  saveStarred,
  type StarredMessage,
} from './chatPanelProtocolStorage';
import { computeChannelUnreadCounts } from './chatUnreadCounts';
import { effectiveMessageTimestampMs } from './nodeStatus';
import type { ChatMessage } from './types';

describe('chatPanelProtocolStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('migrates legacy openDmTabs only into meshtastic key', () => {
    localStorage.setItem('mesh-client:openDmTabs', JSON.stringify([0xabc]));
    const mt = loadOpenDmTabsInitial('meshtastic');
    expect(mt).toEqual([0xabc]);
    expect(localStorage.getItem(openDmTabsStorageKey('meshtastic'))).toBe(JSON.stringify([0xabc]));

    localStorage.clear();
    localStorage.setItem('mesh-client:openDmTabs', JSON.stringify([0xabc]));
    const mc = loadOpenDmTabsInitial('meshcore');
    expect(mc).toEqual([]);
    expect(localStorage.getItem(openDmTabsStorageKey('meshcore'))).toBeNull();
  });

  it('migrates legacy lastRead only into meshtastic key', () => {
    localStorage.setItem('mesh-client:lastRead', JSON.stringify({ 'ch:0': 1 }));
    const mt = loadPersistedLastReadInitial('meshtastic');
    expect(mt).toEqual({ 'ch:0': 1 });
    expect(localStorage.getItem(lastReadStorageKey('meshtastic'))).toBe(
      JSON.stringify({ 'ch:0': 1 }),
    );

    localStorage.clear();
    localStorage.setItem('mesh-client:lastRead', JSON.stringify({ 'ch:0': 1 }));
    const mc = loadPersistedLastReadInitial('meshcore');
    expect(mc).toEqual({});
    expect(localStorage.getItem(lastReadStorageKey('meshcore'))).toBeNull();
  });
});

describe('chatPanelProtocolStorage — drafts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns empty object when no drafts stored', () => {
    expect(loadDraftsInitial('meshtastic')).toEqual({});
  });

  it('saveDraft stores draft under the correct key', () => {
    saveDraft('meshtastic', 'ch:0', 'hello world');
    const raw = localStorage.getItem(draftsStorageKey('meshtastic'));
    expect(JSON.parse(raw!)).toEqual({ 'ch:0': 'hello world' });
  });

  it('saveDraft preserves existing drafts for other views', () => {
    saveDraft('meshtastic', 'ch:0', 'ch0 draft');
    saveDraft('meshtastic', 'ch:1', 'ch1 draft');
    expect(loadDraftsInitial('meshtastic')).toEqual({ 'ch:0': 'ch0 draft', 'ch:1': 'ch1 draft' });
  });

  it('clearDraft removes only the specified view key', () => {
    saveDraft('meshtastic', 'ch:0', 'ch0 draft');
    saveDraft('meshtastic', 'ch:1', 'ch1 draft');
    clearDraft('meshtastic', 'ch:0');
    expect(loadDraftsInitial('meshtastic')).toEqual({ 'ch:1': 'ch1 draft' });
  });

  it('clearDraft is a no-op when key does not exist', () => {
    saveDraft('meshtastic', 'ch:1', 'ch1 draft');
    clearDraft('meshtastic', 'ch:99');
    expect(loadDraftsInitial('meshtastic')).toEqual({ 'ch:1': 'ch1 draft' });
  });

  it('drafts are scoped per protocol', () => {
    saveDraft('meshtastic', 'ch:0', 'mt draft');
    saveDraft('meshcore', 'ch:0', 'mc draft');
    expect(loadDraftsInitial('meshtastic')['ch:0']).toBe('mt draft');
    expect(loadDraftsInitial('meshcore')['ch:0']).toBe('mc draft');
  });

  it('loadDraftsInitial ignores non-string values and corrupt JSON', () => {
    localStorage.setItem(
      draftsStorageKey('meshtastic'),
      JSON.stringify({ 'ch:0': 42, 'ch:1': 'ok' }),
    );
    expect(loadDraftsInitial('meshtastic')).toEqual({ 'ch:1': 'ok' });

    localStorage.setItem(draftsStorageKey('meshtastic'), 'not json{');
    expect(loadDraftsInitial('meshtastic')).toEqual({});
  });
});

describe('loadMutedViews / saveMutedViews', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns empty Set when nothing stored', () => {
    expect(loadMutedViews('meshtastic').size).toBe(0);
  });

  it('round-trips a set of view keys', () => {
    saveMutedViews('meshtastic', new Set(['ch:0', 'dm:12345']));
    const result = loadMutedViews('meshtastic');
    expect(result.has('ch:0')).toBe(true);
    expect(result.has('dm:12345')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('is scoped per protocol', () => {
    saveMutedViews('meshtastic', new Set(['ch:1']));
    expect(loadMutedViews('meshcore').size).toBe(0);
  });

  it('returns empty Set for corrupt JSON', () => {
    localStorage.setItem('mesh-client:mutedViews:meshtastic', 'not json{');
    expect(loadMutedViews('meshtastic').size).toBe(0);
  });

  it('returns empty Set when stored value is not an array of strings', () => {
    localStorage.setItem('mesh-client:mutedViews:meshtastic', JSON.stringify([1, 2, 3]));
    expect(loadMutedViews('meshtastic').size).toBe(0);
  });
});

function makeStarred(overrides: Partial<StarredMessage> = {}): StarredMessage {
  return {
    starId: 'id1',
    timestamp: 1_700_000_000_000,
    payload: 'hello',
    sender_name: 'Alice',
    sender_id: 0x12345678,
    viewKey: 'ch:0',
    channel: 0,
    to: null,
    starredAt: Date.now(),
    ...overrides,
  };
}

describe('loadStarred / saveStarred', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns empty array when nothing stored', () => {
    expect(loadStarred('meshtastic')).toEqual([]);
  });

  it('round-trips starred messages', () => {
    const items = [makeStarred({ starId: 'a' }), makeStarred({ starId: 'b' })];
    saveStarred('meshtastic', items);
    const loaded = loadStarred('meshtastic');
    expect(loaded).toHaveLength(2);
    expect(loaded.map((s) => s.starId)).toEqual(['a', 'b']);
  });

  it('is scoped per protocol', () => {
    saveStarred('meshtastic', [makeStarred()]);
    expect(loadStarred('meshcore')).toEqual([]);
  });

  it('returns empty array for corrupt JSON', () => {
    localStorage.setItem('mesh-client:starred:meshtastic', 'not json{');
    expect(loadStarred('meshtastic')).toEqual([]);
  });

  it('caps at STARRED_LIMIT (200) by dropping oldest starredAt', () => {
    const now = Date.now();
    const items: StarredMessage[] = Array.from({ length: 205 }, (_, i) =>
      makeStarred({ starId: String(i), starredAt: now + i }),
    );
    saveStarred('meshtastic', items);
    const loaded = loadStarred('meshtastic');
    expect(loaded).toHaveLength(200);
    // oldest entries (starredAt = now+0..now+4) should be dropped
    const ids = new Set(loaded.map((s) => s.starId));
    for (let i = 0; i < 5; i++) expect(ids.has(String(i))).toBe(false);
    for (let i = 5; i < 205; i++) expect(ids.has(String(i))).toBe(true);
  });

  it('does not cap when at exactly STARRED_LIMIT', () => {
    const items = Array.from({ length: 200 }, (_, i) => makeStarred({ starId: String(i) }));
    saveStarred('meshtastic', items);
    expect(loadStarred('meshtastic')).toHaveLength(200);
  });
});

describe('sanitizeMeshcoreChatLastRead', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clamps client-clock watermark above newest device message timestamp', () => {
    const clientNow = 1_700_000_000_000;
    const deviceTs = clientNow - 60_000;
    const sanitized = sanitizeMeshcoreChatLastRead({ 'ch:0': clientNow }, [
      { sender_id: 2, channel: 0, timestamp: deviceTs },
    ]);
    expect(sanitized['ch:0']).toBe(deviceTs);
  });

  it('clamps inbound MeshCore DM lastRead using peer key, not recipient self id', () => {
    const selfId = 0x8412_3456;
    const peerId = 0xc609_4a15;
    localStorage.setItem('mesh-client:meshcoreLastSelfNodeId', String(selfId));
    const clientNow = 1_700_000_000_000;
    const deviceTs = clientNow - 60_000;
    const sanitized = sanitizeMeshcoreChatLastRead({ [`dm:${peerId}`]: clientNow }, [
      {
        sender_id: peerId,
        channel: -1,
        to: selfId,
        timestamp: deviceTs,
      },
    ]);
    expect(sanitized[`dm:${peerId}`]).toBe(deviceTs);
    expect(sanitized[`dm:${selfId}`]).toBeUndefined();
  });

  it('ensureMeshcoreChatLastReadSanitized persists once and sets flag', () => {
    const clientNow = 1_700_000_000_000;
    const deviceTs = clientNow - 60_000;
    localStorage.setItem(lastReadStorageKey('meshcore'), JSON.stringify({ 'ch:0': clientNow }));
    const result = ensureMeshcoreChatLastReadSanitized([
      { sender_id: 2, channel: 0, timestamp: deviceTs },
    ]);
    expect(result['ch:0']).toBe(deviceTs);
    expect(localStorage.getItem('mesh-client:lastReadSanitized:meshcore')).toBe('1');
    expect(JSON.parse(localStorage.getItem(lastReadStorageKey('meshcore'))!)).toEqual({
      'ch:0': deviceTs,
    });
  });

  it('counts message unread after sanitize fixes poisoned future lastRead watermark', () => {
    const nowMs = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    const poisonedLastRead = nowMs + 5 * 24 * 60 * 60 * 1000;
    const sanitized = sanitizeMeshcoreChatLastRead({ 'ch:0': poisonedLastRead }, [
      { sender_id: 2, channel: 0, timestamp: poisonedLastRead },
    ]);
    expect(sanitized['ch:0']).toBe(effectiveMessageTimestampMs(poisonedLastRead, nowMs));
    const newMsg: ChatMessage = {
      sender_id: 2,
      sender_name: 'Alice',
      payload: 'after fix',
      channel: 0,
      timestamp: nowMs + 5_000,
      status: 'acked',
    };
    const counts = computeChannelUnreadCounts([newMsg], sanitized, new Set([1]), 'meshcore');
    expect(counts.get(0)).toBe(1);
    vi.useRealTimers();
  });

  it('sanitizeMeshcoreRoomsLastRead clamps future room watermarks', () => {
    const nowMs = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    const futureTs = nowMs + 5 * 24 * 60 * 60 * 1000;
    const sanitized = sanitizeMeshcoreRoomsLastRead({ 0xabc: futureTs }, [
      { roomServerId: 0xabc, timestamp: futureTs },
    ]);
    expect(sanitized[0xabc]).toBe(effectiveMessageTimestampMs(futureTs, nowMs));
    vi.useRealTimers();
  });
});

describe('rooms last read storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips room last-read watermarks', () => {
    const merged = mergeRoomLastReadWatermark({}, 0xabc, 5000);
    savePersistedRoomsLastRead(merged);
    expect(loadPersistedRoomsLastRead()).toEqual({ 0xabc: 5000 });
    expect(localStorage.getItem(roomsLastReadStorageKey())).toBeTruthy();
  });

  it('mergeRoomLastReadWatermark only advances forward', () => {
    expect(mergeRoomLastReadWatermark({ 0xabc: 5000 }, 0xabc, 4000)).toEqual({ 0xabc: 5000 });
    expect(mergeRoomLastReadWatermark({ 0xabc: 5000 }, 0xabc, 6000)).toEqual({ 0xabc: 6000 });
  });
});
