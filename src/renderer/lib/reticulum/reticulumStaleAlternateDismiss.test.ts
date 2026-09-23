// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dismissReticulumStaleAlternate,
  getReticulumStaleAlternateDismissVersion,
  isReticulumStaleAlternateDismissed,
  resetReticulumStaleAlternateDismissForTests,
  RETICULUM_STALE_ALTERNATE_DISMISS_MAX,
  RETICULUM_STALE_ALTERNATE_DISMISS_STORAGE_KEY,
  staleAlternateDismissKey,
  subscribeReticulumStaleAlternateDismiss,
} from '@/renderer/lib/reticulum/reticulumStaleAlternateDismiss';

const OPEN = 'd010ea4417f71ff4fd15a6182747aaec';
const ALT = 'e3359f1314aff4fb6261400a8202149b';
const OTHER_OPEN = '1b3f8c0a2efffc4e5f593423fb52b6f5';
const OTHER_ALT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('reticulumStaleAlternateDismiss', () => {
  beforeEach(() => {
    resetReticulumStaleAlternateDismissForTests();
  });

  afterEach(() => {
    resetReticulumStaleAlternateDismissForTests();
  });

  it('builds a canonical open:alternate key', () => {
    expect(staleAlternateDismissKey(OPEN.toUpperCase(), ` ${ALT} `)).toBe(`${OPEN}:${ALT}`);
    expect(staleAlternateDismissKey('nope', ALT)).toBeNull();
  });

  it('persists dismiss across cache reset (simulates remount / restart)', () => {
    expect(isReticulumStaleAlternateDismissed(OPEN, ALT)).toBe(false);
    expect(dismissReticulumStaleAlternate(OPEN, ALT)).toBe(true);
    expect(isReticulumStaleAlternateDismissed(OPEN, ALT)).toBe(true);

    const stored = localStorage.getItem(RETICULUM_STALE_ALTERNATE_DISMISS_STORAGE_KEY);
    expect(stored).toBeTruthy();
    // Drop in-memory cache + storage, then restore storage like a cold start
    resetReticulumStaleAlternateDismissForTests();
    localStorage.setItem(RETICULUM_STALE_ALTERNATE_DISMISS_STORAGE_KEY, stored!);
    expect(isReticulumStaleAlternateDismissed(OPEN, ALT)).toBe(true);
    expect(isReticulumStaleAlternateDismissed(OTHER_OPEN, OTHER_ALT)).toBe(false);
  });

  it('does not dismiss a different pair', () => {
    dismissReticulumStaleAlternate(OPEN, ALT);
    expect(isReticulumStaleAlternateDismissed(OTHER_OPEN, OTHER_ALT)).toBe(false);
    expect(isReticulumStaleAlternateDismissed(ALT, OPEN)).toBe(false);
  });

  it('notifies subscribers and bumps version', () => {
    const listener = vi.fn();
    const unsub = subscribeReticulumStaleAlternateDismiss(listener);
    const before = getReticulumStaleAlternateDismissVersion();
    dismissReticulumStaleAlternate(OPEN, ALT);
    expect(listener).toHaveBeenCalled();
    expect(getReticulumStaleAlternateDismissVersion()).toBeGreaterThan(before);
    unsub();
  });

  it('caps persisted keys at RETICULUM_STALE_ALTERNATE_DISMISS_MAX', () => {
    const pad = (n: number) => n.toString(16).padStart(32, '0');
    for (let i = 0; i < RETICULUM_STALE_ALTERNATE_DISMISS_MAX + 5; i++) {
      dismissReticulumStaleAlternate(pad(i), pad(i + 1000));
    }
    const raw = localStorage.getItem(RETICULUM_STALE_ALTERNATE_DISMISS_STORAGE_KEY);
    const parsed = JSON.parse(raw ?? '[]') as string[];
    expect(parsed).toHaveLength(RETICULUM_STALE_ALTERNATE_DISMISS_MAX);
    // Oldest dropped; newest kept
    expect(parsed[0]).toBe(`${pad(5)}:${pad(1005)}`);
    expect(parsed.at(-1)).toBe(
      `${pad(RETICULUM_STALE_ALTERNATE_DISMISS_MAX + 4)}:${pad(RETICULUM_STALE_ALTERNATE_DISMISS_MAX + 1004)}`,
    );
  });

  it('ignores corrupt storage entries', () => {
    localStorage.setItem(
      RETICULUM_STALE_ALTERNATE_DISMISS_STORAGE_KEY,
      JSON.stringify(['not-a-key', 42, `${OPEN}:${ALT}`]),
    );
    expect(isReticulumStaleAlternateDismissed(OPEN, ALT)).toBe(true);
  });
});
