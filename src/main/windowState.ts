import fs from 'fs';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Last window placement plus the display state, so a maximized or full-screen quit
 * reopens the same way instead of falling back to the last normal bounds.
 */
export interface WindowState extends WindowBounds {
  maximized: boolean;
  fullScreen: boolean;
}

export const DEFAULT_WINDOW_STATE: WindowState = {
  x: 0,
  y: 0,
  width: 1200,
  height: 800,
  maximized: false,
  fullScreen: false,
};

export interface DisplayWorkArea {
  workArea: WindowBounds;
}

export interface WindowStateSource {
  isDestroyed(): boolean;
  isMaximized(): boolean;
  isFullScreen(): boolean;
  getNormalBounds(): WindowBounds;
}

export interface RestorableWindow {
  isDestroyed(): boolean;
  setFullScreen(flag: boolean): void;
  maximize(): void;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseWindowState(raw: unknown): WindowState | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const { x, y, width, height } = record;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height)
  ) {
    return null;
  }
  if (width <= 0 || height <= 0) return null;
  return {
    x,
    y,
    width,
    height,
    maximized: record.maximized === true,
    fullScreen: record.fullScreen === true,
  };
}

export function readWindowState(statePath: string): WindowState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as unknown;
    return parseWindowState(raw) ?? DEFAULT_WINDOW_STATE;
  } catch {
    // catch-no-log-ok: a missing or unreadable file falls back to the default placement.
    return DEFAULT_WINDOW_STATE;
  }
}

export function writeWindowState(statePath: string, state: WindowState): void {
  try {
    fs.writeFileSync(statePath, JSON.stringify(state), 'utf-8');
  } catch {
    // catch-no-log-ok: non-critical persistence failure
  }
}

/** Normal bounds survive a maximized, minimized or full-screen close. */
export function captureWindowState(win: WindowStateSource): WindowState | null {
  if (win.isDestroyed()) return null;
  return {
    ...win.getNormalBounds(),
    maximized: win.isMaximized(),
    fullScreen: win.isFullScreen(),
  };
}

export function restoreWindowState(win: RestorableWindow, state: WindowState): void {
  if (win.isDestroyed()) return;
  if (state.fullScreen) {
    win.setFullScreen(true);
  } else if (state.maximized) {
    win.maximize();
  }
}

/** A saved window is reused only when part of it overlaps a connected display. */
export function isWindowStateOnScreen(
  state: WindowBounds,
  displays: readonly DisplayWorkArea[],
): boolean {
  return displays.some(({ workArea }) => {
    return (
      state.x < workArea.x + workArea.width &&
      state.x + state.width > workArea.x &&
      state.y < workArea.y + workArea.height &&
      state.y + state.height > workArea.y
    );
  });
}
