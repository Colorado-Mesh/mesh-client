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

/** BrowserWindow-shaped surface used to wire save listeners and restore. */
export interface PersistableWindow extends WindowStateSource, RestorableWindow {
  on(event: 'move' | 'resize' | 'close', listener: () => void): unknown;
}

export interface AttachWindowStatePersistenceOptions {
  initialState: WindowState;
  writeState: (state: WindowState) => void;
  /** Debounce for move/resize saves. Close always saves immediately. */
  debounceMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Parse a JSON object into a WindowState, or null when required fields are invalid. */
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

/** Read saved placement from disk, falling back to DEFAULT_WINDOW_STATE. */
export function readWindowState(statePath: string): WindowState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as unknown;
    return parseWindowState(raw) ?? DEFAULT_WINDOW_STATE;
  } catch {
    // catch-no-log-ok: a missing or unreadable file falls back to the default placement.
    return DEFAULT_WINDOW_STATE;
  }
}

/** Persist placement to disk; failures are ignored (non-critical). */
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

/** Re-apply maximized or full-screen after the window is created with normal bounds. */
export function restoreWindowState(win: RestorableWindow, state: WindowState): void {
  if (win.isDestroyed()) return;
  if (state.fullScreen) {
    win.setFullScreen(true);
  } else if (state.maximized) {
    win.maximize();
  }
}

/**
 * Register move/resize/close save listeners, then restore display state.
 * Listeners are attached before restore so the transition itself can be persisted.
 */
export function attachWindowStatePersistence(
  win: PersistableWindow,
  options: AttachWindowStatePersistenceOptions,
): { saveNow: () => void } {
  const debounceMs = options.debounceMs ?? 300;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const saveNow = () => {
    const state = captureWindowState(win);
    if (state) options.writeState(state);
  };
  const scheduleSave = () => {
    if (timer) clearTimeoutFn(timer);
    timer = setTimeoutFn(() => {
      timer = null;
      saveNow();
    }, debounceMs);
  };

  win.on('move', scheduleSave);
  win.on('resize', scheduleSave);
  win.on('close', () => {
    if (timer) clearTimeoutFn(timer);
    timer = null;
    saveNow();
  });
  restoreWindowState(win, options.initialState);
  return { saveNow };
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
