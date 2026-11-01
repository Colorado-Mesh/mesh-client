import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { conversationPrefsStorageKey } from '../lib/conversationPinStorage';
import type { MeshProtocol } from '../lib/types';
import { useConversationPins } from './useConversationPins';

describe('useConversationPins', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each<MeshProtocol>(['meshtastic', 'meshcore', 'reticulum'])(
    'pins and archives per conversation for %s and survives remount',
    (protocol) => {
      const first = renderHook(() => useConversationPins(protocol, 'id-1'));
      act(() => {
        expect(first.result.current.togglePin('ch:1')).toBe(true);
        expect(first.result.current.toggleArchive('dm:9')).toBe(true);
      });
      expect(first.result.current.pinned.has('ch:1')).toBe(true);
      expect(first.result.current.archived.has('dm:9')).toBe(true);
      first.unmount();

      // Simulated restart: a fresh hook reads the persisted document.
      const second = renderHook(() => useConversationPins(protocol, 'id-1'));
      expect(second.result.current.pinnedOrder).toEqual(['ch:1']);
      expect(second.result.current.archivedOrder).toEqual(['dm:9']);

      // A different identity does not see them.
      const other = renderHook(() => useConversationPins(protocol, 'id-2'));
      expect(other.result.current.pinned.size).toBe(0);
    },
  );

  it('keeps pin/archive exclusive and synchronizes mounted consumers', () => {
    const a = renderHook(() => useConversationPins('meshtastic', null));
    const b = renderHook(() => useConversationPins('meshtastic', null));
    act(() => {
      a.result.current.togglePin('ch:2');
    });
    expect(b.result.current.pinned.has('ch:2')).toBe(true);
    act(() => {
      b.result.current.toggleArchive('ch:2');
    });
    expect(a.result.current.pinned.has('ch:2')).toBe(false);
    expect(a.result.current.archived.has('ch:2')).toBe(true);
  });

  it('does not touch message starring storage', () => {
    localStorage.setItem('mesh-client:starred:meshtastic', '[]');
    const { result } = renderHook(() => useConversationPins('meshtastic', null));
    act(() => {
      result.current.togglePin('ch:0');
    });
    expect(localStorage.getItem('mesh-client:starred:meshtastic')).toBe('[]');
    expect(localStorage.getItem(conversationPrefsStorageKey('meshtastic', null))).toContain('ch:0');
  });

  it('reports failure and leaves state unchanged when storage rejects the write', () => {
    const { result } = renderHook(() => useConversationPins('meshcore', null));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    let ok = true;
    act(() => {
      ok = result.current.togglePin('ch:5');
    });
    setItem.mockRestore();
    expect(ok).toBe(false);
    expect(result.current.pinned.size).toBe(0);
  });
});
