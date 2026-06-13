import { describe, expect, it, vi } from 'vitest';

import { formatRelativeOrIsoDate, formatRelativeOrIsoDateTime } from './formatRelativeOrIsoDate';

const t = ((key: string, opts?: { count?: number }) => {
  if (key === 'common.never') return 'Never';
  if (key === 'common.justNow') return 'Just now';
  if (key === 'common.minutesAgo') return `${opts?.count}m ago`;
  if (key === 'common.hoursAgo') return `${opts?.count}h ago`;
  return key;
}) as Parameters<typeof formatRelativeOrIsoDate>[1];

describe('formatRelativeOrIsoDate', () => {
  it('returns never for zero timestamp', () => {
    expect(formatRelativeOrIsoDate(0, t)).toBe('Never');
  });

  it('returns ISO date when older than 24h', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T12:00:00Z'));
    const twoDaysAgo = Date.parse('2026-06-11T10:00:00Z');
    expect(formatRelativeOrIsoDate(twoDaysAgo, t)).toBe('2026-06-11');
    vi.useRealTimers();
  });
});

describe('formatRelativeOrIsoDateTime', () => {
  it('returns ISO datetime when older than 24h', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-13T12:00:00Z'));
    const twoDaysAgo = Date.parse('2026-06-11T10:30:00Z');
    expect(formatRelativeOrIsoDateTime(twoDaysAgo, t)).toMatch(/^2026-06-11 \d{2}:\d{2}$/);
    vi.useRealTimers();
  });
});
