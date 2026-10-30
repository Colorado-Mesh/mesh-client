import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileChatOrder, useChatOrder } from './useChatOrder';

const items = [
  { id: '2', name: 'Zulu' },
  { id: '1', name: 'Alpha' },
  { id: '3', name: 'Beta' },
];

describe('chat display order', () => {
  beforeEach(() => {
    localStorage.clear();
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
