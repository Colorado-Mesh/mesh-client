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
    const now = 1_000_000;
    const delay = noteReticulumProxyRateLimitHit(now);
    expect(delay).toBeGreaterThan(0);
    expect(isReticulumProxyRateLimitBackoffActive(now)).toBe(true);
    expect(reticulumProxyRateLimitBackoffRemainingMs(now)).toBe(delay);
    expect(isReticulumProxyRateLimitBackoffActive(now + delay + 1)).toBe(false);
    clearReticulumProxyRateLimitBackoff();
    expect(isReticulumProxyRateLimitBackoffActive(now)).toBe(false);
  });

  it('notes rate-limit errors and ignores other errors', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(noteReticulumProxyErrorIfRateLimited(new Error('boom'))).toBe(false);
    expect(
      noteReticulumProxyErrorIfRateLimited(new Error('reticulum:proxy: rate limit exceeded')),
    ).toBe(true);
    expect(isReticulumProxyRateLimitBackoffActive()).toBe(true);
  });

  it('does not tight-loop — consecutive hits increase backoff', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = noteReticulumProxyRateLimitHit(0);
    const second = noteReticulumProxyRateLimitHit(0);
    expect(second).toBeGreaterThanOrEqual(first);
  });
});
