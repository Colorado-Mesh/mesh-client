import { describe, expect, it, vi } from 'vitest';

import {
  formatDisplayDateTime,
  formatDisplayTime,
  getDisplayTimeOptions,
} from './formatDisplayTime';

describe('getDisplayTimeOptions', () => {
  it('omits hour12 when use24Hour is false or omitted', () => {
    expect(getDisplayTimeOptions({ use24Hour: false })).toEqual({
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(getDisplayTimeOptions()).not.toHaveProperty('hour12');
  });

  it('sets hour12 false when use24Hour is true', () => {
    expect(getDisplayTimeOptions({ use24Hour: true })).toEqual({
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  });

  it('includes seconds when withSeconds is true', () => {
    expect(getDisplayTimeOptions({ use24Hour: true, withSeconds: true })).toEqual({
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  });
});

describe('formatDisplayTime', () => {
  it('formats with explicit 24-hour preference', () => {
    // 2024-01-15 15:30 local
    const ts = new Date(2024, 0, 15, 15, 30, 0).getTime();
    const s = formatDisplayTime(ts, { use24Hour: true });
    expect(s).toMatch(/15:30/);
    expect(s).not.toMatch(/PM|AM/i);
  });

  it('includes seconds when withSeconds is true', () => {
    const ts = new Date(2024, 0, 15, 15, 30, 45).getTime();
    const s = formatDisplayTime(ts, { use24Hour: true, withSeconds: true });
    expect(s).toMatch(/15:30:45/);
  });

  it('formats afternoon en-US without forcing hour12 when use24Hour is false', () => {
    const ts = new Date(2024, 0, 15, 15, 30, 0).getTime();
    const prev = process.env.LANG;
    process.env.LANG = 'en_US.UTF-8';
    try {
      // Explicit locale via spy on toLocaleTimeString to avoid CI locale skew.
      const spy = vi.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(function (
        this: Date,
        locales?: Intl.LocalesArgument,
        opts?: Intl.DateTimeFormatOptions,
      ) {
        return Intl.DateTimeFormat(locales ?? 'en-US', opts).format(this);
      });
      const s = formatDisplayTime(ts, { use24Hour: false });
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0]?.[1]).not.toHaveProperty('hour12');
      expect(s.length).toBeGreaterThan(0);
      spy.mockRestore();
    } finally {
      if (prev === undefined) delete process.env.LANG;
      else process.env.LANG = prev;
    }
  });
});

describe('formatDisplayDateTime', () => {
  it('includes a date portion and respects 24-hour preference', () => {
    const ts = new Date(2024, 0, 15, 15, 30, 0).getTime();
    const s = formatDisplayDateTime(ts, { use24Hour: true });
    expect(s).toMatch(/15/);
    expect(s).toMatch(/30/);
    expect(s).not.toMatch(/PM|AM/i);
  });
});
