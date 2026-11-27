/**
 * Mobile viewport state (window size class, pane mode, fold/posture, keyboard) for the mobile
 * app shell. Written by `mobile/src/viewport/mobileViewport.ts`; desktop never writes it, so
 * desktop readers always get `DESKTOP_VIEWPORT` and render the unchanged desktop layout.
 *
 * Breakpoints follow Material 3 window size classes (600 / 840 / 1200 / 1600 dp) with the
 * two-pane threshold from the foldable research brief: two panes need ≥ 640 px of usable width
 * (after safe-area insets) and ≥ 480 px of height, which covers the iPhone Duo inner display
 * in portrait (669 pt) and Android book-style foldables (690–836 dp), while the Duo outer
 * display (466 pt minus its 84 pt system column) stays single-pane.
 */
import { useSyncExternalStore } from 'react';

export type WindowWidthClass = 'compact' | 'medium' | 'expanded' | 'large' | 'extraLarge';
export type WindowHeightClass = 'compact' | 'medium' | 'expanded';
export type DevicePosture = 'flat' | 'book' | 'tabletop' | 'folded';

export interface FoldRect {
  /** CSS px relative to the layout viewport. */
  left: number;
  top: number;
  width: number;
  height: number;
  orientation: 'vertical' | 'horizontal';
  /** True when content on one side cannot be seen from the other (physical hinge / half open). */
  separating: boolean;
}

export interface MobileViewportState {
  isMobile: boolean;
  usableWidth: number;
  usableHeight: number;
  widthClass: WindowWidthClass;
  heightClass: WindowHeightClass;
  /** 1 = one pane at a time (stack); 2 = list + detail side by side. */
  panes: 1 | 2;
  /** Show the navigation rail (two-pane and wide) instead of the bottom bar. */
  navRail: boolean;
  posture: DevicePosture;
  fold: FoldRect | null;
  keyboardOpen: boolean;
  keyboardInset: number;
}

export const DESKTOP_VIEWPORT: MobileViewportState = Object.freeze({
  isMobile: false,
  usableWidth: 0,
  usableHeight: 0,
  widthClass: 'expanded',
  heightClass: 'expanded',
  panes: 2,
  navRail: true,
  posture: 'flat',
  fold: null,
  keyboardOpen: false,
  keyboardInset: 0,
});

export const TWO_PANE_MIN_WIDTH = 640;
export const TWO_PANE_MIN_HEIGHT = 480;
export const NAV_RAIL_MIN_WIDTH = 840;

export function widthClassFor(width: number): WindowWidthClass {
  if (width < 600) return 'compact';
  if (width < 840) return 'medium';
  if (width < 1200) return 'expanded';
  if (width < 1600) return 'large';
  return 'extraLarge';
}

export function heightClassFor(height: number): WindowHeightClass {
  if (height < 480) return 'compact';
  if (height < 900) return 'medium';
  return 'expanded';
}

export interface ViewportInputs {
  usableWidth: number;
  usableHeight: number;
  fold: FoldRect | null;
  posture: DevicePosture;
  keyboardOpen: boolean;
  keyboardInset: number;
  /** Pane mode in effect before this update (kept while the keyboard is open). */
  previousPanes: 1 | 2 | null;
}

/** Pure layout decision so it can be unit-tested across device geometries. */
export function computeMobileViewport(i: ViewportInputs): MobileViewportState {
  const widthClass = widthClassFor(i.usableWidth);
  const heightClass = heightClassFor(i.usableHeight);
  let panes: 1 | 2 =
    i.usableWidth >= TWO_PANE_MIN_WIDTH && i.usableHeight >= TWO_PANE_MIN_HEIGHT ? 2 : 1;
  // A vertical separating fold (book posture / Duo partially open) always splits into two panes.
  if (i.fold?.separating && i.fold.orientation === 'vertical' && i.usableWidth >= 560) panes = 2;
  // Tabletop: content above the fold, controls below — single column.
  if (i.posture === 'tabletop') panes = 1;
  // Freeze the pane mode while the keyboard is up so typing never collapses the layout.
  if (i.keyboardOpen && i.previousPanes !== null) panes = i.previousPanes;
  const navRail = panes === 2 && i.usableWidth >= NAV_RAIL_MIN_WIDTH && i.posture !== 'tabletop';
  return {
    isMobile: true,
    usableWidth: i.usableWidth,
    usableHeight: i.usableHeight,
    widthClass,
    heightClass,
    panes,
    navRail,
    posture: i.posture,
    fold: i.fold,
    keyboardOpen: i.keyboardOpen,
    keyboardInset: i.keyboardInset,
  };
}

let state: MobileViewportState = DESKTOP_VIEWPORT;
const subscribers = new Set<() => void>();

export function getMobileViewport(): MobileViewportState {
  return state;
}

export function setMobileViewport(next: MobileViewportState): void {
  const changed = (Object.keys(next) as (keyof MobileViewportState)[]).some(
    (k) => JSON.stringify(next[k]) !== JSON.stringify(state[k]),
  );
  if (!changed) return;
  state = next;
  for (const s of [...subscribers]) s();
}

export function subscribeMobileViewport(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/** React hook: current mobile viewport (desktop always gets the constant `DESKTOP_VIEWPORT`). */
export function useMobileViewport(): MobileViewportState {
  return useSyncExternalStore(subscribeMobileViewport, getMobileViewport, () => DESKTOP_VIEWPORT);
}
