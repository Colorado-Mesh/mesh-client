import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { advancePastDue, computeNextDue, firstDueAt } from './recurrence';

/** Fixed TZ for wall-clock assertions (America/Denver). */
describe('scheduledBroadcasts recurrence', () => {
  const prevTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'America/Denver';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it('hourly aligns to minute-of-hour strictly after afterMs', () => {
    // 2024-03-10 10:05 local → next :15 is 10:15
    const after = new Date(2024, 2, 10, 10, 5, 0, 0).getTime();
    const next = computeNextDue({ interval: 'hourly', timeOfDayMin: 15 }, after);
    expect(next).toBe(new Date(2024, 2, 10, 10, 15, 0, 0).getTime());
  });

  it('hourly rolls to next hour when minute already passed', () => {
    const after = new Date(2024, 2, 10, 10, 20, 0, 0).getTime();
    const next = computeNextDue({ interval: 'hourly', timeOfDayMin: 15 }, after);
    expect(next).toBe(new Date(2024, 2, 10, 11, 15, 0, 0).getTime());
  });

  it('daily crosses midnight', () => {
    const after = new Date(2024, 2, 10, 18, 0, 0, 0).getTime();
    const next = computeNextDue({ interval: 'daily', timeOfDayMin: 9 * 60 }, after);
    expect(next).toBe(new Date(2024, 2, 11, 9, 0, 0, 0).getTime());
  });

  it.each([0, 1, 2, 3, 4, 5, 6] as const)('weekly finds weekday %i', (weekday) => {
    const after = new Date(2024, 2, 10, 12, 0, 0, 0).getTime(); // Sun
    const next = computeNextDue({ interval: 'weekly', timeOfDayMin: 9 * 60, weekday }, after);
    expect(next).not.toBeNull();
    expect(new Date(next!).getDay()).toBe(weekday);
    expect(new Date(next!).getHours()).toBe(9);
  });

  it('biweekly respects even week parity from anchor', () => {
    // Anchor Mon 2024-03-04; after 10:00 same day → 09:00 missed → skip odd week Mar 11 → Mar 18
    const anchorYmd = '2024-03-04';
    const after = new Date(2024, 2, 4, 10, 0, 0, 0).getTime();
    const first = computeNextDue(
      { interval: 'biweekly', timeOfDayMin: 9 * 60, weekday: 1, anchorYmd },
      after,
    );
    expect(first).toBe(new Date(2024, 2, 18, 9, 0, 0, 0).getTime());

    const second = computeNextDue(
      { interval: 'biweekly', timeOfDayMin: 9 * 60, weekday: 1, anchorYmd },
      first!,
    );
    expect(second).toBe(new Date(2024, 3, 1, 9, 0, 0, 0).getTime());

    const third = computeNextDue(
      { interval: 'biweekly', timeOfDayMin: 9 * 60, weekday: 1, anchorYmd },
      second!,
    );
    expect(third).toBe(new Date(2024, 3, 15, 9, 0, 0, 0).getTime());
  });

  it('monthly 31st skips February and April', () => {
    const after = new Date(2024, 0, 31, 10, 0, 0, 0).getTime(); // Jan 31
    const next = computeNextDue(
      { interval: 'monthly', timeOfDayMin: 9 * 60, dayOfMonth: 31 },
      after,
    );
    // Feb has 29 in 2024 but we need day 31 → Mar 31
    expect(next).toBe(new Date(2024, 2, 31, 9, 0, 0, 0).getTime());
    const afterMar = computeNextDue(
      { interval: 'monthly', timeOfDayMin: 9 * 60, dayOfMonth: 31 },
      next!,
    );
    // April has 30 → May 31
    expect(afterMar).toBe(new Date(2024, 4, 31, 9, 0, 0, 0).getTime());
  });

  it('monthly 1st is straightforward', () => {
    const after = new Date(2024, 2, 15, 12, 0, 0, 0).getTime();
    const next = computeNextDue(
      { interval: 'monthly', timeOfDayMin: 8 * 60, dayOfMonth: 1 },
      after,
    );
    expect(next).toBe(new Date(2024, 3, 1, 8, 0, 0, 0).getTime());
  });

  it('DST spring-forward 02:30 resolves to shifted instant', () => {
    // US 2024 spring forward: Mar 10 02:00 → 03:00
    const after = new Date(2024, 2, 9, 12, 0, 0, 0).getTime();
    const next = computeNextDue({ interval: 'daily', timeOfDayMin: 2 * 60 + 30 }, after);
    expect(next).not.toBeNull();
    const d = new Date(next!);
    // Date constructor shifts nonexistent local time forward
    expect(d.getHours()).toBeGreaterThanOrEqual(2);
    expect(next).toBeGreaterThan(after);
  });

  it('fall-back does not double-fire the same wall time as two dues', () => {
    const after = new Date(2024, 10, 2, 0, 0, 0, 0).getTime(); // before Nov 3 fall-back
    const a = computeNextDue({ interval: 'daily', timeOfDayMin: 1 * 60 + 30 }, after);
    const b = computeNextDue({ interval: 'daily', timeOfDayMin: 1 * 60 + 30 }, a!);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b!).toBeGreaterThan(a!);
    // Next day after first fire
    expect(new Date(b!).getDate()).toBe(new Date(a!).getDate() + 1);
  });

  it('advancePastDue never returns a past value after clock jump forward', () => {
    const rule = { interval: 'daily' as const, timeOfDayMin: 9 * 60 };
    const due = new Date(2024, 2, 10, 9, 0, 0, 0).getTime();
    const now = new Date(2024, 2, 12, 10, 0, 0, 0).getTime();
    const advanced = advancePastDue(rule, due, now);
    expect(advanced).not.toBeNull();
    expect(advanced!).toBeGreaterThan(now);
  });

  it('advancePastDue returns dueAt when still in the future', () => {
    const rule = { interval: 'daily' as const, timeOfDayMin: 9 * 60 };
    const due = new Date(2024, 2, 15, 9, 0, 0, 0).getTime();
    const now = new Date(2024, 2, 10, 9, 0, 0, 0).getTime();
    expect(advancePastDue(rule, due, now)).toBe(due);
  });

  it('returns null for missing weekly weekday', () => {
    expect(computeNextDue({ interval: 'weekly', timeOfDayMin: 540 }, Date.now())).toBeNull();
  });

  it('returns null for non-finite afterMs', () => {
    expect(computeNextDue({ interval: 'daily', timeOfDayMin: 540 }, Number.NaN)).toBeNull();
  });

  it('returns null for out-of-range timeOfDayMin', () => {
    expect(computeNextDue({ interval: 'daily', timeOfDayMin: 2000 }, Date.now())).toBeNull();
  });

  it('firstDueAt returns at-or-after fromMs', () => {
    const from = new Date(2024, 2, 10, 9, 0, 0, 0).getTime();
    const due = firstDueAt({ interval: 'daily', timeOfDayMin: 9 * 60 }, from);
    expect(due).toBe(from);
  });
});
