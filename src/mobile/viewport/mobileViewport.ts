/**
 * Mobile viewport tracker: safe-area-aware usable size, keyboard inset, and fold geometry from
 * the native `MeshDevice` plugin (Jetpack WindowManager on Android; reserved regions on the
 * iPhone Duo). WebViews expose no fold API (Viewport Segments / Device Posture are disabled in
 * Android WebView and WKWebView), so fold data always comes from native.
 *
 * Publishes to `src/renderer/lib/mobileViewport.ts` and mirrors key values onto `<html>`:
 * `data-mobile-panes`, `data-mobile-width`, `data-mobile-posture`, `--mobile-keyboard-inset`,
 * `--mobile-fold-left|top|width|height`.
 */
import {
  computeMobileViewport,
  type DevicePosture,
  type FoldRect,
  getMobileViewport,
  setMobileViewport,
} from '../../renderer/lib/mobileViewport';
import { getPlugin, listenPlugin } from '../bridge/nativePlugins';

interface NativeFold {
  /** Bounds in CSS px (native divides by density). */
  left: number;
  top: number;
  right: number;
  bottom: number;
  orientation: 'vertical' | 'horizontal';
  state: 'flat' | 'half-opened';
  separating: boolean;
}

let fold: FoldRect | null = null;
let posture: DevicePosture = 'flat';
let probe: HTMLDivElement | null = null;
let keyboardInset = 0;
/** Keyboard state from @capacitor/keyboard (native resize shrinks the layout viewport itself). */
let nativeKeyboardOpen = false;
let scheduled = false;

function insets(): { top: number; right: number; bottom: number; left: number } {
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;top:0;left:0;' +
      'padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);' +
      'padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);';
    document.documentElement.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}

function applyNativeFolds(folds: NativeFold[]): void {
  const f = folds[0];
  if (!f) {
    fold = null;
    posture = 'flat';
  } else {
    fold = {
      left: f.left,
      top: f.top,
      width: Math.max(0, f.right - f.left),
      height: Math.max(0, f.bottom - f.top),
      orientation: f.orientation,
      separating: f.separating,
    };
    posture =
      f.state === 'half-opened' ? (f.orientation === 'horizontal' ? 'tabletop' : 'book') : 'flat';
  }
  schedule();
}

function update(): void {
  scheduled = false;
  const vv = window.visualViewport;
  const layoutH = window.innerHeight;
  const visibleH = vv ? vv.height : layoutH;
  // Keyboard: the visual viewport shrinks below the layout viewport (Android M139+, iOS).
  const visualInset = Math.max(0, Math.round(layoutH - visibleH - (vv?.offsetTop ?? 0)));
  // With `Keyboard.resize: 'native'` / adjustResize the layout viewport itself shrinks, so the
  // visual-viewport gap stays ~0; the Capacitor Keyboard events are the reliable signal there.
  // Native resize already removes the keyboard from the layout viewport, so the inset stays the
  // visual-viewport gap; the plugin only reports that the keyboard is open.
  keyboardInset = visualInset;
  const keyboardOpen = nativeKeyboardOpen || visualInset > 120;
  const ins = insets();
  const prev = getMobileViewport();
  const next = computeMobileViewport({
    // clientWidth excludes classic scrollbars, which can come and go during boot without a
    // resize event; innerWidth would leave a stale width class behind.
    usableWidth: Math.round(
      (document.documentElement.clientWidth || window.innerWidth) - ins.left - ins.right,
    ),
    usableHeight: Math.round((keyboardOpen ? layoutH : visibleH) - ins.top - ins.bottom),
    fold,
    posture,
    keyboardOpen,
    keyboardInset,
    previousPanes: prev.isMobile ? prev.panes : null,
  });
  setMobileViewport(next);
  const root = document.documentElement;
  root.dataset.mobilePanes = String(next.panes);
  root.dataset.mobileWidth = next.widthClass;
  root.dataset.mobilePosture = next.posture;
  root.dataset.mobileNav = next.navRail ? 'rail' : 'bar';
  root.style.setProperty('--mobile-keyboard-inset', `${keyboardInset}px`);
  if (fold) {
    root.style.setProperty('--mobile-fold-left', `${fold.left}px`);
    root.style.setProperty('--mobile-fold-top', `${fold.top}px`);
    root.style.setProperty('--mobile-fold-width', `${fold.width}px`);
    root.style.setProperty('--mobile-fold-height', `${fold.height}px`);
    root.dataset.mobileFold = fold.orientation;
  } else {
    for (const k of ['left', 'top', 'width', 'height'])
      root.style.removeProperty(`--mobile-fold-${k}`);
    delete root.dataset.mobileFold;
  }
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(update);
}

export function installMobileViewport(): void {
  // The layout viewport can change without a window `resize` (meta viewport applied after the
  // first measurement, WebView insets settling); observe the root element as well.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(schedule).observe(document.documentElement);
  }
  window.addEventListener('load', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  for (const [event, open] of [
    ['keyboardWillShow', true],
    ['keyboardDidShow', true],
    ['keyboardWillHide', false],
    ['keyboardDidHide', false],
  ] as const) {
    void listenPlugin('Keyboard', event, () => {
      nativeKeyboardOpen = open;
      schedule();
    }).catch((e: unknown) => {
      console.debug('[mobile] keyboard listener unavailable', e);
    });
  }
  const device = getPlugin('MeshDevice') as unknown as {
    getFoldState?: () => Promise<{ folds: NativeFold[] }>;
  };
  void device
    .getFoldState?.()
    .then((r) => {
      applyNativeFolds(r.folds);
    })
    .catch((e: unknown) => {
      console.debug('[mobile] fold state unavailable', e);
    });
  void listenPlugin('MeshDevice', 'foldChanged', (d) => {
    applyNativeFolds((d as { folds: NativeFold[] }).folds);
  }).catch((e: unknown) => {
    console.debug('[mobile] fold listener unavailable', e);
  });
  update();
}
