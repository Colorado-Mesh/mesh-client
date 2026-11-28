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
 *
 * Side column: on displays where the system keeps a column on one side for the status bar and
 * camera / Dynamic Island (iPhone Duo outer display, Duo Split View), Apple puts navigation in that
 * column with tabs at its bottom. WebViews cannot see it, so it is inferred from geometry: one
 * side inset at least a nav item wide, the other side small (a notched iPhone in landscape has
 * both), and a native occlusion rectangle inside the column. Without that rectangle the app keeps
 * the bottom bar.
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

/** A rectangle in CSS px, layout-viewport coordinates. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The system side column the bottom bar moves into (see the module comment). */
export interface SideColumn {
  /** Physical edge of the column. */
  edge: 'left' | 'right';
  /** Column width: the safe-area inset on that edge. */
  width: number;
  /** Navigation starts below the status bar and camera / Dynamic Island at the column top. */
  top: number;
  /** Bottom safe-area inset (home indicator). */
  bottom: number;
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
  /** Wide enough for desktop side panes (the inline node detail), whatever the navigation. */
  wide: boolean;
  /** The bottom bar sits vertically in the system side column (iPhone Duo). */
  sideColumn: SideColumn | null;
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
  wide: true,
  sideColumn: null,
  posture: 'flat',
  fold: null,
  keyboardOpen: false,
  keyboardInset: 0,
});

export const TWO_PANE_MIN_WIDTH = 640;
export const TWO_PANE_MIN_HEIGHT = 480;
export const NAV_RAIL_MIN_WIDTH = 840;
/** A side inset at least this wide can hold a navigation item (icon and label). */
export const SIDE_COLUMN_MIN_WIDTH = 60;
/** The opposite inset must stay this small (rules out notched phones in landscape). */
export const SIDE_COLUMN_OPPOSITE_MAX = 24;
/** Four sections and More at 56 px each, plus padding. */
export const SIDE_COLUMN_MIN_HEIGHT = 5 * 56 + 16;
/** Gap below the status / camera area before the first navigation item. */
const SIDE_COLUMN_TOP_GAP = 8;

export interface SideColumnInputs {
  viewportWidth: number;
  viewportHeight: number;
  insets: SafeAreaInsets;
  /** Native occlusion regions (camera, Dynamic Island) in CSS px. */
  occlusions: readonly ScreenRect[];
}

/** The system side column, when the geometry has one (see the module comment), else null. */
export function sideColumnFor(i: SideColumnInputs): SideColumn | null {
  const { left, right } = i.insets;
  let edge: SideColumn['edge'] | null = null;
  if (right >= SIDE_COLUMN_MIN_WIDTH && left <= SIDE_COLUMN_OPPOSITE_MAX) edge = 'right';
  else if (left >= SIDE_COLUMN_MIN_WIDTH && right <= SIDE_COLUMN_OPPOSITE_MAX) edge = 'left';
  if (!edge) return null;
  const width = edge === 'right' ? right : left;
  const stripLeft = edge === 'right' ? i.viewportWidth - width : 0;
  const stripRight = edge === 'right' ? i.viewportWidth : width;
  const inColumn = i.occlusions.filter(
    (r) => r.right > stripLeft && r.left < stripRight && r.top < i.viewportHeight / 2,
  );
  if (inColumn.length === 0) return null;
  const top = Math.ceil(Math.max(...inColumn.map((r) => r.bottom)) + SIDE_COLUMN_TOP_GAP);
  if (i.viewportHeight - top - i.insets.bottom < SIDE_COLUMN_MIN_HEIGHT) return null;
  return { edge, width, top, bottom: i.insets.bottom };
}

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
  /** Geometry for the system side column; omitted means none. */
  sideColumn?: SideColumnInputs;
  /** Side column before this update (kept while the keyboard is open). */
  previousSideColumn?: SideColumn | null;
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
  // The keyboard shortens the viewport; keep the column decision made before it opened.
  const sideColumn =
    i.keyboardOpen && i.previousSideColumn !== undefined
      ? i.previousSideColumn
      : i.sideColumn
        ? sideColumnFor(i.sideColumn)
        : null;
  const wide = i.usableWidth >= NAV_RAIL_MIN_WIDTH;
  const navRail = panes === 2 && wide && i.posture !== 'tabletop' && sideColumn === null;
  return {
    isMobile: true,
    usableWidth: i.usableWidth,
    usableHeight: i.usableHeight,
    widthClass,
    heightClass,
    panes,
    navRail,
    wide,
    sideColumn,
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
