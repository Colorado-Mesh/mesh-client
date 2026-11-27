import { afterEach, describe, expect, it } from 'vitest';

import {
  computeMobileViewport,
  DESKTOP_VIEWPORT,
  type FoldRect,
  getMobileViewport,
  heightClassFor,
  NAV_RAIL_MIN_WIDTH,
  setMobileViewport,
  subscribeMobileViewport,
  TWO_PANE_MIN_HEIGHT,
  TWO_PANE_MIN_WIDTH,
  type ViewportInputs,
  widthClassFor,
} from './mobileViewport';

const base: ViewportInputs = {
  usableWidth: 400,
  usableHeight: 800,
  fold: null,
  posture: 'flat',
  keyboardOpen: false,
  keyboardInset: 0,
  previousPanes: null,
};

/**
 * Usable CSS-px sizes (after safe-area insets) from the foldable research brief:
 * iPhone Duo outer 466×678 pt minus its 84 pt trailing system column; inner 951×669 / 669×951.
 */
const DEVICES: { name: string; width: number; height: number; panes: 1 | 2; rail: boolean }[] = [
  { name: 'iPhone 17 portrait', width: 402, height: 814, panes: 1, rail: false },
  { name: 'iPhone Duo folded (outer)', width: 382, height: 644, panes: 1, rail: false },
  { name: 'iPhone Duo folded landscape', width: 594, height: 432, panes: 1, rail: false },
  { name: 'iPhone Duo unfolded portrait', width: 669, height: 835, panes: 2, rail: false },
  { name: 'iPhone Duo unfolded landscape', width: 867, height: 635, panes: 2, rail: true },
  { name: 'iPhone Duo Split View pane', width: 385, height: 571, panes: 1, rail: false },
  { name: 'Galaxy Z Flip cover', width: 361, height: 399, panes: 1, rail: false },
  { name: 'Galaxy Z Fold 5 inner', width: 690, height: 829, panes: 2, rail: false },
  { name: 'Pixel 9 Pro Fold outer', width: 412, height: 922, panes: 1, rail: false },
  { name: 'Pixel 9 Pro Fold inner', width: 836, height: 842, panes: 2, rail: false },
  { name: 'Pixel Tablet landscape', width: 1280, height: 800, panes: 2, rail: true },
  { name: 'phone landscape (short)', width: 800, height: 360, panes: 1, rail: false },
];

describe('computeMobileViewport', () => {
  it.each(DEVICES)('$name → $panes pane(s), rail=$rail', ({ width, height, panes, rail }) => {
    const v = computeMobileViewport({ ...base, usableWidth: width, usableHeight: height });
    expect(v.isMobile).toBe(true);
    expect(v.panes).toBe(panes);
    expect(v.navRail).toBe(rail);
  });

  it('uses the documented two-pane and rail thresholds', () => {
    expect(TWO_PANE_MIN_WIDTH).toBe(640);
    expect(TWO_PANE_MIN_HEIGHT).toBe(480);
    expect(NAV_RAIL_MIN_WIDTH).toBe(840);
    const atEdge = computeMobileViewport({ ...base, usableWidth: 640, usableHeight: 480 });
    expect(atEdge.panes).toBe(2);
    const below = computeMobileViewport({ ...base, usableWidth: 639, usableHeight: 480 });
    expect(below.panes).toBe(1);
  });

  it('splits at a separating vertical fold (book posture) even just under the width threshold', () => {
    const fold: FoldRect = {
      left: 300,
      top: 0,
      width: 0,
      height: 700,
      orientation: 'vertical',
      separating: true,
    };
    const v = computeMobileViewport({
      ...base,
      usableWidth: 600,
      usableHeight: 700,
      fold,
      posture: 'book',
    });
    expect(v.panes).toBe(2);
    expect(v.posture).toBe('book');
    expect(v.fold).toEqual(fold);
  });

  it('keeps a single column and no rail in tabletop posture', () => {
    const fold: FoldRect = {
      left: 0,
      top: 420,
      width: 840,
      height: 0,
      orientation: 'horizontal',
      separating: true,
    };
    const v = computeMobileViewport({
      ...base,
      usableWidth: 900,
      usableHeight: 840,
      fold,
      posture: 'tabletop',
    });
    expect(v.panes).toBe(1);
    expect(v.navRail).toBe(false);
  });

  it('freezes the pane mode while the keyboard is open', () => {
    const v = computeMobileViewport({
      ...base,
      usableWidth: 669,
      usableHeight: 420,
      keyboardOpen: true,
      keyboardInset: 380,
      previousPanes: 2,
    });
    expect(v.panes).toBe(2);
    expect(v.keyboardInset).toBe(380);
  });
});

describe('size classes', () => {
  it.each([
    [599, 'compact'],
    [600, 'medium'],
    [839, 'medium'],
    [840, 'expanded'],
    [1199, 'expanded'],
    [1200, 'large'],
    [1600, 'extraLarge'],
  ] as const)('width %i → %s', (w, cls) => {
    expect(widthClassFor(w)).toBe(cls);
  });

  it.each([
    [479, 'compact'],
    [480, 'medium'],
    [900, 'expanded'],
  ] as const)('height %i → %s', (h, cls) => {
    expect(heightClassFor(h)).toBe(cls);
  });
});

describe('mobile viewport store', () => {
  afterEach(() => {
    setMobileViewport(DESKTOP_VIEWPORT);
  });

  it('defaults to the desktop viewport (desktop layout unchanged)', () => {
    expect(getMobileViewport()).toBe(DESKTOP_VIEWPORT);
    expect(DESKTOP_VIEWPORT.isMobile).toBe(false);
  });

  it('notifies subscribers only when the state changes', () => {
    let calls = 0;
    const off = subscribeMobileViewport(() => {
      calls += 1;
    });
    const next = computeMobileViewport({ ...base });
    setMobileViewport(next);
    setMobileViewport({ ...next });
    off();
    expect(calls).toBe(1);
    expect(getMobileViewport().isMobile).toBe(true);
  });
});
