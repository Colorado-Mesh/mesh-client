import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useMediaQuery } from '@/renderer/hooks/useMediaQuery';
import { SHELL_COMPACT_QUERY } from '@/renderer/lib/bottomNav';

import {
  computeMobileViewport,
  DESKTOP_VIEWPORT,
  setMobileViewport,
} from '../../platform/mobileViewport';
import { NODE_DETAIL_PANE_QUERY } from './useMediaQuery';

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

function stubMatchMedia(matching: string[]) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      media: query,
      matches: matching.includes(query),
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

function mobile(width: number, height: number) {
  setMobileViewport(
    computeMobileViewport({
      usableWidth: width,
      usableHeight: height,
      fold: null,
      posture: 'flat',
      keyboardOpen: false,
      keyboardInset: 0,
      previousPanes: null,
    }),
  );
}

afterEach(() => {
  setMobileViewport(DESKTOP_VIEWPORT);
  if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
  else Reflect.deleteProperty(window, 'matchMedia');
});

describe('mobile useMediaQuery override', () => {
  it('the shell compact query is the mobile sentinel, not the desktop width query', () => {
    expect(SHELL_COMPACT_QUERY).toBe('(mesh-mobile: shell-compact)');
  });

  it.each([
    ['phone', 412, 915, true],
    ['iPhone Duo folded', 382, 644, true],
    ['iPhone Duo unfolded portrait', 669, 900, true],
    ['iPhone Duo unfolded landscape', 867, 635, false],
    ['tablet landscape', 1280, 800, false],
  ])('%s → bottom bar=%s', (_name, w, h, expected) => {
    stubMatchMedia([]);
    mobile(w, h);
    const { result } = renderHook(() => useMediaQuery(SHELL_COMPACT_QUERY));
    expect(result.current).toBe(expected);
  });

  it('the inline node detail pane follows the navigation rail', () => {
    stubMatchMedia([]);
    mobile(951, 640);
    expect(renderHook(() => useMediaQuery(NODE_DETAIL_PANE_QUERY)).result.current).toBe(true);
    mobile(669, 900);
    expect(renderHook(() => useMediaQuery(NODE_DETAIL_PANE_QUERY)).result.current).toBe(false);
  });

  it('other queries (and the desktop viewport) use window.matchMedia', () => {
    stubMatchMedia(['(prefers-reduced-motion: reduce)', SHELL_COMPACT_QUERY]);
    expect(renderHook(() => useMediaQuery('(prefers-reduced-motion: reduce)')).result.current).toBe(
      true,
    );
    expect(renderHook(() => useMediaQuery(SHELL_COMPACT_QUERY)).result.current).toBe(true);
    mobile(412, 915);
    expect(renderHook(() => useMediaQuery('(prefers-reduced-motion: reduce)')).result.current).toBe(
      true,
    );
  });
});
