import { describe, expect, it } from 'vitest';

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
