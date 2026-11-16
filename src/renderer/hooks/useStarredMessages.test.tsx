import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadStarred, saveStarred, type StarredMessage } from '../lib/chatPanelProtocolStorage';
import { starredStorageKey, subscribeStarred, updateStarred } from '../lib/starredMessageStore';
import type { MeshProtocol } from '../lib/types';
import { useStarredMessages } from './useStarredMessages';

function star(starId: string, viewKey = 'ch:0'): StarredMessage {
  return {
    starId,
    timestamp: 1_700_000_000_000,
    payload: `payload ${starId}`,
    sender_name: 'Bob',
    sender_id: 22,
    viewKey,
    channel: 0,
    to: null,
    starredAt: 1_700_000_000_500,
  };
}

const ids = (list: readonly StarredMessage[]) => list.map((s) => s.starId);

describe('useStarredMessages', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each<MeshProtocol>(['meshtastic', 'meshcore', 'reticulum'])(
    'keeps two mounted views of %s on one stored list',
    (protocol) => {
      const chat = renderHook(() => useStarredMessages(protocol));
      const rooms = renderHook(() => useStarredMessages(protocol));

      act(() => {
        rooms.result.current.updateStarred((prev) => [...prev, star('room-1', 'room:8196')]);
      });
      expect(ids(chat.result.current.starred)).toEqual(['room-1']);

      act(() => {
        chat.result.current.updateStarred((prev) => [...prev, star('dm-1', 'dm:9')]);
      });
      act(() => {
        chat.result.current.updateStarred((prev) => prev.filter((s) => s.starId !== 'dm-1'));
      });
      expect(ids(chat.result.current.starred)).toEqual(['room-1']);
      expect(ids(rooms.result.current.starred)).toEqual(['room-1']);
      expect(ids(loadStarred(protocol))).toEqual(['room-1']);
    },
  );

  it('applies an update to the stored list, not to an older copy', () => {
    const view = renderHook(() => useStarredMessages('meshcore'));
    // Another writer saves without going through this view.
    saveStarred('meshcore', [star('other')]);
    act(() => {
      view.result.current.updateStarred((prev) => [...prev, star('mine')]);
    });
    expect(ids(loadStarred('meshcore'))).toEqual(['other', 'mine']);
    expect(ids(view.result.current.starred)).toEqual(['other', 'mine']);
  });

  it('does not write or notify when the update returns the list unchanged', () => {
    const notified: MeshProtocol[] = [];
    const unsubscribe = subscribeStarred((protocol) => notified.push(protocol));
    updateStarred('meshcore', (prev) => prev);
    expect(localStorage.getItem(starredStorageKey('meshcore'))).toBeNull();
    expect(notified).toEqual([]);
    unsubscribe();
  });

  it('notifies only the protocol that changed', () => {
    const meshtastic = renderHook(() => useStarredMessages('meshtastic'));
    const meshcore = renderHook(() => useStarredMessages('meshcore'));
    act(() => {
      updateStarred('meshcore', (prev) => [...prev, star('c-1')]);
    });
    expect(ids(meshcore.result.current.starred)).toEqual(['c-1']);
    expect(meshtastic.result.current.starred).toEqual([]);
  });

  it('re-reads the list when another window changes it', () => {
    const view = renderHook(() => useStarredMessages('meshcore'));
    localStorage.setItem(starredStorageKey('meshcore'), JSON.stringify([star('from-window')]));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: starredStorageKey('meshcore') }));
    });
    expect(ids(view.result.current.starred)).toEqual(['from-window']);
  });

  it('shows the list in the snapshot it rendered, not a later read of storage', () => {
    saveStarred('meshcore', [star('snapshot')]);
    const newer = JSON.stringify([star('newer')]);
    const realGetItem = localStorage.getItem.bind(localStorage);
    let newerServed = 0;
    // Another window writes after the snapshot read: any second read of the document during the
    // render (here, one made inside loadStarred) sees the newer list.
    const read = vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => {
      if (
        key === starredStorageKey('meshcore') &&
        (new Error().stack ?? '').includes('loadStarred')
      ) {
        newerServed += 1;
        return newer;
      }
      return realGetItem(key);
    });
    try {
      const view = renderHook(() => useStarredMessages('meshcore'));
      expect(read).toHaveBeenCalled();
      expect({ starred: ids(view.result.current.starred), newerServed }).toEqual({
        starred: ['snapshot'],
        newerServed: 0,
      });
    } finally {
      read.mockRestore();
    }
  });

  it('uses the key loadStarred reads', () => {
    updateStarred('reticulum', (prev) => [...prev, star('r-1')]);
    expect(localStorage.getItem(starredStorageKey('reticulum'))).toContain('r-1');
    expect(ids(loadStarred('reticulum'))).toEqual(['r-1']);
  });
});
