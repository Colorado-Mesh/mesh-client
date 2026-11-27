// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SHELL_COMPACT_QUERY } from '../lib/bottomNav';
import { computeMobileViewport, DESKTOP_VIEWPORT, setMobileViewport } from '../lib/mobileViewport';
import { useShellCompact } from './useShellLayout';

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

describe('useShellCompact', () => {
  it.each([
    [true, [SHELL_COMPACT_QUERY]],
    [false, []],
  ])('desktop follows the unchanged media query (%s)', (expected, matching) => {
    stubMatchMedia(matching);
    const { result } = renderHook(() => useShellCompact());
    expect(result.current).toBe(expected);
  });

  it.each([
    ['phone', 412, 915, true],
    ['iPhone Duo unfolded portrait', 669, 900, true],
    ['iPhone Duo unfolded landscape', 867, 635, false],
    ['tablet landscape', 1280, 800, false],
  ])('mobile %s → bottom bar=%s', (_name, w, h, expected) => {
    stubMatchMedia([]);
    mobile(w, h);
    const { result } = renderHook(() => useShellCompact());
    expect(result.current).toBe(expected);
  });
});
