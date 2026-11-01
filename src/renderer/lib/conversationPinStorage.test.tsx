import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  conversationPrefsStorageKey,
  filterArchived,
  loadConversationPrefs,
  normalizeConversationPrefs,
  orderPinnedFirst,
  saveConversationPrefs,
  subscribeConversationPrefs,
  toggleArchived,
  togglePinned,
} from './conversationPinStorage';
import type { MeshProtocol } from './types';

const PROTOCOLS: MeshProtocol[] = ['meshtastic', 'meshcore', 'reticulum'];

describe('conversationPinStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each(PROTOCOLS)('persists pin/archive per identity for %s', (protocol) => {
    expect(
      saveConversationPrefs(protocol, 'id-a', { pinned: ['ch:1', 'dm:7'], archived: ['ch:2'] }),
    ).toBe(true);
    expect(loadConversationPrefs(protocol, 'id-a')).toEqual({
      pinned: ['ch:1', 'dm:7'],
      archived: ['ch:2'],
    });
    // Other identity and other protocols are untouched.
    expect(loadConversationPrefs(protocol, 'id-b')).toEqual({ pinned: [], archived: [] });
    for (const other of PROTOCOLS.filter((p) => p !== protocol)) {
      expect(loadConversationPrefs(other, 'id-a')).toEqual({ pinned: [], archived: [] });
    }
  });

  it('uses a distinct key from starred messages and mutes', () => {
    const key = conversationPrefsStorageKey('meshtastic', null);
    expect(key).toContain('conversationPins');
    expect(key).not.toContain('starred');
    expect(key).not.toContain('mutedViews');
    saveConversationPrefs('meshtastic', null, { pinned: ['ch:0'], archived: [] });
    expect(localStorage.getItem('mesh-client:starred:meshtastic')).toBeNull();
    expect(localStorage.getItem(key)).not.toBeNull();
  });

  it('removes the document when both lists are empty', () => {
    saveConversationPrefs('meshcore', null, { pinned: ['ch:0'], archived: [] });
    saveConversationPrefs('meshcore', null, { pinned: [], archived: [] });
    expect(localStorage.getItem(conversationPrefsStorageKey('meshcore', null))).toBeNull();
  });

  it('keeps pin and archive mutually exclusive', () => {
    const pinnedThenArchived = toggleArchived({ pinned: ['ch:1'], archived: [] }, 'ch:1');
    expect(pinnedThenArchived).toEqual({ pinned: [], archived: ['ch:1'] });
    const archivedThenPinned = togglePinned({ pinned: [], archived: ['ch:1'] }, 'ch:1');
    expect(archivedThenPinned).toEqual({ pinned: ['ch:1'], archived: [] });
    expect(togglePinned({ pinned: ['ch:1'], archived: [] }, 'ch:1').pinned).toEqual([]);
    expect(toggleArchived({ pinned: [], archived: ['ch:1'] }, 'ch:1').archived).toEqual([]);
  });

  it('normalizes corrupt documents', () => {
    expect(normalizeConversationPrefs(null)).toEqual({ pinned: [], archived: [] });
    expect(
      normalizeConversationPrefs({ pinned: ['a', 'a', 3, '', 'b'], archived: ['b', 'c'] }),
    ).toEqual({ pinned: ['a'], archived: ['b', 'c'] });
    localStorage.setItem(conversationPrefsStorageKey('meshtastic', null), '{not json');
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(loadConversationPrefs('meshtastic', null)).toEqual({ pinned: [], archived: [] });
  });

  it('returns false and leaves the stored document intact when the write throws', () => {
    saveConversationPrefs('meshtastic', null, { pinned: ['ch:1'], archived: [] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(
      saveConversationPrefs('meshtastic', null, { pinned: ['ch:1', 'ch:2'], archived: [] }),
    ).toBe(false);
    setItem.mockRestore();
    expect(loadConversationPrefs('meshtastic', null).pinned).toEqual(['ch:1']);
  });

  it('notifies subscribers after a successful save', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConversationPrefs(listener);
    saveConversationPrefs('reticulum', 'id-r', { pinned: ['dm:5'], archived: [] });
    expect(listener).toHaveBeenCalledWith('reticulum', 'id-r');
    unsubscribe();
    saveConversationPrefs('reticulum', 'id-r', { pinned: [], archived: [] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('orders pinned first in pin order and keeps the rest stable', () => {
    const items = ['ch:0', 'ch:1', 'ch:2', 'ch:3'];
    expect(orderPinnedFirst(items, (k) => k, ['ch:3', 'ch:1'])).toEqual([
      'ch:3',
      'ch:1',
      'ch:0',
      'ch:2',
    ]);
    expect(orderPinnedFirst(items, (k) => k, [])).toEqual(items);
  });

  it('hides archived unless shown or kept (open / unread)', () => {
    const items = ['ch:0', 'ch:1', 'ch:2'];
    const archived = ['ch:1', 'ch:2'];
    expect(filterArchived(items, (k) => k, archived, { showArchived: false })).toEqual(['ch:0']);
    expect(filterArchived(items, (k) => k, archived, { showArchived: true })).toEqual(items);
    expect(
      filterArchived(items, (k) => k, archived, {
        showArchived: false,
        keep: (k) => k === 'ch:2',
      }),
    ).toEqual(['ch:0', 'ch:2']);
  });
});
