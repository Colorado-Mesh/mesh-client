import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearReticulumProxyRateLimitBackoff,
  isReticulumProxyRateLimitBackoffActive,
  noteReticulumProxyErrorIfRateLimited,
  noteReticulumProxyRateLimitHit,
  resetReticulumProxyRateLimitBackoffForTests,
  reticulumProxyRateLimitBackoffRemainingMs,
} from '@/renderer/lib/reticulum/reticulumProxyRateLimitBackoff';

describe('reticulumProxyRateLimitBackoff', () => {
  afterEach(() => {
    resetReticulumProxyRateLimitBackoffForTests();
    vi.restoreAllMocks();
  });

  it('arms backoff on rate-limit hit and clears on success', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter factor 1.0
    const now = 1_000_000;
    const delay = noteReticulumProxyRateLimitHit('shared', now);
    expect(delay).toBeGreaterThan(0);
    expect(isReticulumProxyRateLimitBackoffActive('shared', now)).toBe(true);
    expect(reticulumProxyRateLimitBackoffRemainingMs('shared', now)).toBe(delay);
    expect(isReticulumProxyRateLimitBackoffActive('shared', now + delay + 1)).toBe(false);
    clearReticulumProxyRateLimitBackoff('shared');
    expect(isReticulumProxyRateLimitBackoffActive('shared', now)).toBe(false);
  });

  it('keeps shared and lxmfRecent buckets independent', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const now = 1_000_000;
    noteReticulumProxyRateLimitHit('lxmfRecent', now);
    expect(isReticulumProxyRateLimitBackoffActive('lxmfRecent', now)).toBe(true);
    expect(isReticulumProxyRateLimitBackoffActive('shared', now)).toBe(false);
    expect(isReticulumProxyRateLimitBackoffActive(undefined, now)).toBe(true);
    clearReticulumProxyRateLimitBackoff('lxmfRecent');
    expect(isReticulumProxyRateLimitBackoffActive(undefined, now)).toBe(false);
  });

  it('notes rate-limit errors on the shared bucket by default', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(noteReticulumProxyErrorIfRateLimited(new Error('boom'))).toBe(false);
    expect(
      noteReticulumProxyErrorIfRateLimited(new Error('reticulum:proxy: rate limit exceeded')),
    ).toBe(true);
    expect(isReticulumProxyRateLimitBackoffActive('shared')).toBe(true);
    expect(isReticulumProxyRateLimitBackoffActive('lxmfRecent')).toBe(false);
  });

  it('does not tight-loop — consecutive hits increase backoff', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const first = noteReticulumProxyRateLimitHit('shared', 0);
    const second = noteReticulumProxyRateLimitHit('shared', 0);
    expect(second).toBeGreaterThanOrEqual(first);
  });

  it('clear without bucket resets both', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    noteReticulumProxyRateLimitHit('shared', 0);
    noteReticulumProxyRateLimitHit('lxmfRecent', 0);
    clearReticulumProxyRateLimitBackoff();
    expect(isReticulumProxyRateLimitBackoffActive()).toBe(false);
  });
});
