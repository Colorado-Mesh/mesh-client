import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initReduceMotionDefaultIfAbsent,
  readReduceMotion,
  subscribeReduceMotion,
  syncReduceMotionDatasetFromStorage,
  writeReduceMotion,
} from './reduceMotionPreference';

describe('reduceMotionPreference', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.reduceMotion;
  });

  it('defaults reduce motion to false', () => {
    expect(readReduceMotion()).toBe(false);
  });

  it('writes reduce motion and syncs dataset', () => {
    writeReduceMotion(true);
    expect(readReduceMotion()).toBe(true);
    expect(document.documentElement.dataset.reduceMotion).toBe('true');
    writeReduceMotion(false);
    expect(readReduceMotion()).toBe(false);
    expect(document.documentElement.dataset.reduceMotion).toBeUndefined();
  });

  it('notifies subscribers on write', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReduceMotion(listener);
    writeReduceMotion(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    writeReduceMotion(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('initReduceMotionDefaultIfAbsent seeds from OS only once', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    try {
      initReduceMotionDefaultIfAbsent();
      expect(readReduceMotion()).toBe(true);
      localStorage.removeItem('mesh-client:appSettings');
      initReduceMotionDefaultIfAbsent();
      expect(readReduceMotion()).toBe(false);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('syncReduceMotionDatasetFromStorage mirrors storage', () => {
    localStorage.setItem('mesh-client:appSettings', JSON.stringify({ reduceMotion: true }));
    syncReduceMotionDatasetFromStorage();
    expect(document.documentElement.dataset.reduceMotion).toBe('true');
  });
});
