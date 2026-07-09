import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { formatRawPacketRelativeTime } from './formatRawPacketRelativeTime';

describe('formatRawPacketRelativeTime', () => {
  const t = ((key: string, opts?: { count?: number }) => {
    if (key === 'common.justNow') return 'Just now';
    if (key === 'common.secondsAgo') return `${opts?.count}s ago`;
    if (key === 'common.minutesAgo') return `${opts?.count}m ago`;
    if (key === 'common.hoursAgo') return `${opts?.count}h ago`;
    if (key === 'common.daysAgo') return `${opts?.count}d ago`;
    return key;
  }) as TFunction;

  const now = 1_710_000_000_000;

  it('shows seconds under one minute', () => {
    expect(formatRawPacketRelativeTime(now - 48_000, t, now)).toBe('48s ago');
  });

  it('shows minutes under one hour', () => {
    expect(formatRawPacketRelativeTime(now - 120_000, t, now)).toBe('2m ago');
  });
});
