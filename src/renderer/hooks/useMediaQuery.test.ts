import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMediaQuery } from './useMediaQuery';

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

function setMatchMedia(value: unknown) {
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value });
}

function installMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const matchMedia = vi.fn((query: string) => ({
    media: query,
    get matches() {
      return matches;
    },
    addEventListener: (_: 'change', cb: () => void) => listeners.add(cb),
    removeEventListener: (_: 'change', cb: () => void) => listeners.delete(cb),
  }));
  setMatchMedia(matchMedia);
  return {
    set(next: boolean) {
      matches = next;
      for (const cb of listeners) cb();
    },
    listeners,
  };
}

describe('useMediaQuery', () => {
  afterEach(() => {
    if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
    else Reflect.deleteProperty(window, 'matchMedia');
  });

  it('returns the current match and follows changes', () => {
    const media = installMatchMedia(false);
    const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 1280px)'));
    expect(result.current).toBe(false);
    act(() => {
      media.set(true);
    });
    expect(result.current).toBe(true);
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('is false when matchMedia is unavailable', () => {
    setMatchMedia(undefined);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1280px)'));
    expect(result.current).toBe(false);
  });
});
