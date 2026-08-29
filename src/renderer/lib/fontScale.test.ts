import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyFontScale,
  clampFontScale,
  DEFAULT_FONT_SCALE,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STORAGE_KEY,
  loadFontScale,
  persistFontScale,
  readAppliedFontScale,
  resetFontScale,
  subscribeAppliedFontScale,
} from './fontScale';

describe('fontScale', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.fontSize = '';
  });

  describe('clampFontScale', () => {
    it('clamps above the max and below the min', () => {
      expect(clampFontScale(3)).toBe(FONT_SCALE_MAX);
      expect(clampFontScale(0.1)).toBe(FONT_SCALE_MIN);
    });

    it('snaps to the nearest step without float drift', () => {
      expect(clampFontScale(1.13)).toBe(1.15);
      expect(clampFontScale(1.11)).toBe(1.1);
      expect(clampFontScale(0.9)).toBe(0.9);
    });

    it('falls back to the default for non-finite input', () => {
      expect(clampFontScale(Number.NaN)).toBe(DEFAULT_FONT_SCALE);
      expect(clampFontScale(Number.POSITIVE_INFINITY)).toBe(DEFAULT_FONT_SCALE);
    });
  });

  describe('loadFontScale', () => {
    it('returns the default when nothing is stored', () => {
      expect(loadFontScale()).toBe(DEFAULT_FONT_SCALE);
    });

    it('parses a stored value', () => {
      localStorage.setItem(FONT_SCALE_STORAGE_KEY, '1.25');
      expect(loadFontScale()).toBe(1.25);
    });

    it('clamps garbage and out-of-range stored values', () => {
      localStorage.setItem(FONT_SCALE_STORAGE_KEY, 'not-a-number');
      expect(loadFontScale()).toBe(DEFAULT_FONT_SCALE);

      localStorage.setItem(FONT_SCALE_STORAGE_KEY, '99');
      expect(loadFontScale()).toBe(FONT_SCALE_MAX);
    });
  });

  it('round-trips through localStorage', () => {
    persistFontScale(1.2);
    expect(localStorage.getItem(FONT_SCALE_STORAGE_KEY)).toBe('1.2');
    expect(loadFontScale()).toBe(1.2);
  });

  it('applies the scale as a root font-size percentage', () => {
    applyFontScale(1.25);
    expect(document.documentElement.style.fontSize).toBe('125%');

    applyFontScale(DEFAULT_FONT_SCALE);
    expect(document.documentElement.style.fontSize).toBe('100%');
  });

  describe('readAppliedFontScale', () => {
    it('returns the default when no scale has been applied', () => {
      expect(readAppliedFontScale()).toBe(DEFAULT_FONT_SCALE);
    });

    it('reads back the applied scale', () => {
      applyFontScale(1.35);
      expect(readAppliedFontScale()).toBe(1.35);
    });

    it('falls back to the default for a non-percentage or invalid value', () => {
      document.documentElement.style.fontSize = '18px';
      expect(readAppliedFontScale()).toBe(DEFAULT_FONT_SCALE);

      document.documentElement.style.fontSize = '0%';
      expect(readAppliedFontScale()).toBe(DEFAULT_FONT_SCALE);
    });
  });

  describe('subscribeAppliedFontScale', () => {
    it('notifies subscribers on every apply and stops after unsubscribe', () => {
      const listener = vi.fn();
      const unsubscribe = subscribeAppliedFontScale(listener);

      applyFontScale(1.2);
      applyFontScale(1.3);
      expect(listener).toHaveBeenCalledTimes(2);

      unsubscribe();
      applyFontScale(1.4);
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('reports the newly applied scale to the listener', () => {
      const seen: number[] = [];
      const unsubscribe = subscribeAppliedFontScale(() => {
        seen.push(readAppliedFontScale());
      });

      applyFontScale(1.45);
      unsubscribe();

      expect(seen).toEqual([1.45]);
    });
  });

  it('reset clears storage and restores the default root font-size', () => {
    persistFontScale(1.5);
    applyFontScale(1.5);

    resetFontScale();

    expect(localStorage.getItem(FONT_SCALE_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.style.fontSize).toBe('100%');
    expect(loadFontScale()).toBe(DEFAULT_FONT_SCALE);
  });
});
