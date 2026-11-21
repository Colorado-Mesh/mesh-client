import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateLegacyChatOrderScope } from '@/renderer/lib/chatOrderScope';

import { moveChatOrderId, reconcileChatOrder, useChatOrder } from './useChatOrder';

const items = [
  { id: '2', name: 'Zulu' },
  { id: '1', name: 'Alpha' },
  { id: '3', name: 'Beta' },
];

describe('chat display order', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  it('moves an entry before or after a drop target', () => {
    expect(moveChatOrderId(['a', 'b', 'c', 'd'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveChatOrderId(['a', 'b', 'c', 'd'], 'a', 'c', 'before')).toEqual(['b', 'a', 'c', 'd']);
    expect(moveChatOrderId(['a', 'b', 'c', 'd'], 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveChatOrderId(['a', 'b', 'c', 'd'], 'd', 'a', 'before')).toEqual(['d', 'a', 'b', 'c']);
  });
  it('returns null when a drop would not change the order', () => {
    expect(moveChatOrderId(['a', 'b', 'c'], 'b', 'b', 'after')).toBeNull();
    expect(moveChatOrderId(['a', 'b', 'c'], 'a', 'b', 'before')).toBeNull();
    expect(moveChatOrderId(['a', 'b', 'c'], 'b', 'a', 'after')).toBeNull();
    expect(moveChatOrderId(['a', 'b', 'c'], 'gone', 'a', 'before')).toBeNull();
    expect(moveChatOrderId(['a', 'b', 'c'], 'a', 'gone', 'after')).toBeNull();
  });
  it('keeps entries that are not on screen next to their neighbours', () => {
    // 'h' is archived and hidden; moving 'c' must not move it.
    expect(moveChatOrderId(['a', 'h', 'b', 'c'], 'c', 'b', 'before')).toEqual(['a', 'h', 'c', 'b']);
  });
  it('deduplicates saved ids, drops unavailable ones and appends new entries', () => {
    expect(reconcileChatOrder(items, ['3', '3', 'gone', '2'])).toEqual(['3', '2', '1']);
    expect(reconcileChatOrder([], ['2'])).toEqual([]);
  });
  it.each(['meshtastic', 'meshcore', 'reticulum'])(
    'persists %s order across remount and temporary disappearance',
    (protocol) => {
      const { result, rerender, unmount } = renderHook(
        ({ entries }) => useChatOrder(`${protocol}:42:channels`, entries),
        { initialProps: { entries: items } },
      );
      act(() => {
        result.current.save(['3', '1', '2']);
      });
      rerender({ entries: [] });
      expect(result.current.ids).toEqual([]);
      rerender({ entries: items });
      expect(result.current.ids).toEqual(['3', '1', '2']);
      unmount();
      const reloaded = renderHook(() => useChatOrder(`${protocol}:42:channels`, items));
      expect(reloaded.result.current.ids).toEqual(['3', '1', '2']);
    },
  );
  it('isolates protocol, radio, and surface and handles malformed storage', () => {
    localStorage.setItem(
      'mesh-client:chatOrder:meshcore:42:dms',
      JSON.stringify(['1', 5, null, '2']),
    );
    const { result, rerender } = renderHook(({ scope }) => useChatOrder(scope, items), {
      initialProps: { scope: 'meshcore:42:dms' },
    });
    expect(result.current.ids).toEqual(['1', '2', '3']);
    rerender({ scope: 'meshcore:43:dms' });
    expect(result.current.ids).toEqual(['2', '1', '3']);
    rerender({ scope: 'reticulum:42:dms' });
    expect(result.current.ids).toEqual(['2', '1', '3']);
  });
  it('reads a new scope once and keeps later renders in memory', () => {
    localStorage.setItem('mesh-client:chatOrder:after', JSON.stringify(['3', '1', '2']));
    const get = vi.spyOn(localStorage, 'getItem');
    try {
      const { result, rerender } = renderHook(({ scope }) => useChatOrder(scope, items), {
        initialProps: { scope: 'before' },
      });
      rerender({ scope: 'after' });
      const reads = get.mock.calls.filter(([key]) => key === 'mesh-client:chatOrder:after').length;
      rerender({ scope: 'after' });
      rerender({ scope: 'after' });
      expect(get.mock.calls.filter(([key]) => key === 'mesh-client:chatOrder:after')).toHaveLength(
        reads,
      );
      expect(reads).toBe(1);
      expect(result.current.ids).toEqual(['3', '1', '2']);
    } finally {
      get.mockRestore();
    }
  });
  it('migrates legacy :0: chat order when scope gains a node id', () => {
    localStorage.setItem(
      'mesh-client:chatOrder:meshcom:0:channels',
      JSON.stringify(['2', '1', '3']),
    );
    const scope = 'meshcom:99';
    migrateLegacyChatOrderScope('meshcom', '99');
    const { result } = renderHook(() => useChatOrder(`${scope}:channels`, items));
    expect(result.current.ids).toEqual(['2', '1', '3']);
    expect(localStorage.getItem('mesh-client:chatOrder:meshcom:0:channels')).toBeNull();
  });

  it('keeps pending in-memory order while scope is null without writing :0:', () => {
    const setItem = vi.spyOn(localStorage, 'setItem');
    const { result, rerender } = renderHook(
      ({ scope, entries }: { scope: string | null; entries: typeof items }) =>
        useChatOrder(scope, entries),
      { initialProps: { scope: null as string | null, entries: items } },
    );
    expect(result.current.orderingEnabled).toBe(true);
    act(() => {
      result.current.save(['3', '1', '2']);
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(result.current.ids).toEqual(['3', '1', '2']);
    rerender({ scope: 'meshcore:7:channels', entries: items });
    expect(result.current.ids).toEqual(['3', '1', '2']);
    expect(setItem).toHaveBeenCalledWith(
      'mesh-client:chatOrder:meshcore:7:channels',
      JSON.stringify(['3', '1', '2']),
    );
    setItem.mockRestore();
  });

  it('flushes the full pending sequence when scope resolves even if some ids are absent', () => {
    const setItem = vi.spyOn(localStorage, 'setItem');
    const { result, rerender } = renderHook(
      ({ scope, entries }: { scope: string | null; entries: typeof items }) =>
        useChatOrder(scope, entries),
      { initialProps: { scope: null as string | null, entries: items } },
    );
    act(() => {
      result.current.save(['3', '1', '2']);
    });
    rerender({ scope: 'meshcore:7:channels', entries: items.slice(0, 2) });
    expect(result.current.ids).toEqual(['1', '2']);
    expect(setItem).toHaveBeenCalledWith(
      'mesh-client:chatOrder:meshcore:7:channels',
      JSON.stringify(['3', '1', '2']),
    );
    rerender({ scope: 'meshcore:7:channels', entries: items });
    expect(result.current.ids).toEqual(['3', '1', '2']);
    setItem.mockRestore();
  });

  it('preserves absent entries in their prior slots while reordering visible entries', () => {
    localStorage.setItem('mesh-client:chatOrder:test', JSON.stringify(['2', '1', '3']));
    const { result, rerender } = renderHook(({ entries }) => useChatOrder('test', entries), {
      initialProps: { entries: items.slice(1) },
    });
    act(() => {
      result.current.save(['3', '1']);
    });
    rerender({ entries: items });
    expect(result.current.ids).toEqual(['2', '3', '1']);
  });
});
