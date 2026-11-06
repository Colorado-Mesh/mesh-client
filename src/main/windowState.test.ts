// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureWindowState,
  DEFAULT_WINDOW_STATE,
  isWindowStateOnScreen,
  parseWindowState,
  readWindowState,
  restoreWindowState,
  writeWindowState,
} from './windowState';

describe('window state file', () => {
  let dir: string;
  let statePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-window-state-'));
    statePath = path.join(dir, 'window-state.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips normal bounds and the maximized/full-screen flags', () => {
    writeWindowState(statePath, {
      x: 10,
      y: 20,
      width: 1300,
      height: 900,
      maximized: true,
      fullScreen: false,
    });
    expect(readWindowState(statePath)).toEqual({
      x: 10,
      y: 20,
      width: 1300,
      height: 900,
      maximized: true,
      fullScreen: false,
    });
  });

  it('treats a legacy file without display flags as a normal window', () => {
    fs.writeFileSync(statePath, JSON.stringify({ x: 4, y: 8, width: 1000, height: 700 }));
    expect(readWindowState(statePath)).toEqual({
      x: 4,
      y: 8,
      width: 1000,
      height: 700,
      maximized: false,
      fullScreen: false,
    });
  });

  it('falls back to defaults when the file is missing or unreadable', () => {
    expect(readWindowState(statePath)).toBe(DEFAULT_WINDOW_STATE);
    fs.writeFileSync(statePath, '{not json');
    expect(readWindowState(statePath)).toBe(DEFAULT_WINDOW_STATE);
  });
});

describe('parseWindowState', () => {
  it('keeps the display flags only when they are booleans', () => {
    expect(parseWindowState({ x: 0, y: 0, width: 800, height: 600, maximized: true })).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      maximized: true,
      fullScreen: false,
    });
    expect(
      parseWindowState({ x: 0, y: 0, width: 800, height: 600, maximized: 'yes', fullScreen: 1 }),
    ).toMatchObject({ maximized: false, fullScreen: false });
  });

  it.each([
    ['null', null],
    ['a string', 'window'],
    ['missing coordinates', { x: 1, y: 2, width: 800 }],
    ['non-finite coordinates', { x: Number.NaN, y: 0, width: 800, height: 600 }],
    ['a zero width', { x: 0, y: 0, width: 0, height: 600 }],
    ['a negative height', { x: 0, y: 0, width: 800, height: -1 }],
  ])('rejects %s', (_label, raw) => {
    expect(parseWindowState(raw)).toBeNull();
  });
});

describe('captureWindowState', () => {
  it('saves the normal bounds while maximized or full screen', () => {
    const win = {
      isDestroyed: () => false,
      isMaximized: () => true,
      isFullScreen: () => false,
      getNormalBounds: vi.fn(() => ({ x: 30, y: 40, width: 1100, height: 750 })),
    };
    expect(captureWindowState(win)).toEqual({
      x: 30,
      y: 40,
      width: 1100,
      height: 750,
      maximized: true,
      fullScreen: false,
    });
    expect(win.getNormalBounds).toHaveBeenCalledOnce();
  });

  it('does not read bounds from a destroyed window', () => {
    const win = {
      isDestroyed: () => true,
      isMaximized: vi.fn(() => false),
      isFullScreen: vi.fn(() => false),
      getNormalBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
    };
    expect(captureWindowState(win)).toBeNull();
    expect(win.getNormalBounds).not.toHaveBeenCalled();
  });
});

describe('restoreWindowState', () => {
  it('restores a maximized window', () => {
    const win = { isDestroyed: () => false, setFullScreen: vi.fn(), maximize: vi.fn() };
    restoreWindowState(win, { ...DEFAULT_WINDOW_STATE, maximized: true });
    expect(win.maximize).toHaveBeenCalledOnce();
    expect(win.setFullScreen).not.toHaveBeenCalled();
  });

  it('restores a full-screen window instead of only maximizing it', () => {
    const win = { isDestroyed: () => false, setFullScreen: vi.fn(), maximize: vi.fn() };
    restoreWindowState(win, { ...DEFAULT_WINDOW_STATE, maximized: true, fullScreen: true });
    expect(win.setFullScreen).toHaveBeenCalledWith(true);
    expect(win.maximize).not.toHaveBeenCalled();
  });

  it('leaves a normal window alone and skips a destroyed one', () => {
    const win = { isDestroyed: () => false, setFullScreen: vi.fn(), maximize: vi.fn() };
    restoreWindowState(win, DEFAULT_WINDOW_STATE);
    expect(win.maximize).not.toHaveBeenCalled();
    expect(win.setFullScreen).not.toHaveBeenCalled();

    const destroyed = { isDestroyed: () => true, setFullScreen: vi.fn(), maximize: vi.fn() };
    restoreWindowState(destroyed, { ...DEFAULT_WINDOW_STATE, maximized: true });
    expect(destroyed.maximize).not.toHaveBeenCalled();
  });
});

describe('isWindowStateOnScreen', () => {
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };

  it('accepts a window that overlaps a display', () => {
    expect(isWindowStateOnScreen({ x: 100, y: 100, width: 800, height: 600 }, [display])).toBe(
      true,
    );
  });

  it('rejects a window that is entirely off every display', () => {
    expect(isWindowStateOnScreen({ x: 4000, y: 100, width: 800, height: 600 }, [display])).toBe(
      false,
    );
  });
});
