/**
 * Local wall-clock recurrence for scheduled broadcasts.
 *
 * Candidates are built with `new Date(y, m, d, hh, mm, 0, 0)` so DST is whatever the
 * local Date constructor produces (e.g. spring-forward 02:30 → 03:30). Never add fixed
 * millisecond day lengths.
 */
import type { ScheduledBroadcastInterval } from '@/shared/scheduledBroadcastTypes';

export interface ScheduledBroadcastRule {
  interval: ScheduledBroadcastInterval;
  timeOfDayMin: number; // 0..1439
  weekday?: number | null; // 0=Sun .. 6=Sat, weekly/biweekly
  dayOfMonth?: number | null; // 1..31, monthly
  anchorYmd?: string | null; // 'YYYY-MM-DD', biweekly anchor week
}

const MAX_CANDIDATES = 1000;

function isFiniteMs(ms: number): boolean {
  return Number.isFinite(ms);
}

function splitTimeOfDay(timeOfDayMin: number): { hh: number; mm: number } | null {
  if (!Number.isInteger(timeOfDayMin) || timeOfDayMin < 0 || timeOfDayMin > 1439) return null;
  return { hh: Math.floor(timeOfDayMin / 60), mm: timeOfDayMin % 60 };
}

function ymdParts(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo - 1, d };
}

/** Monday-based ISO-like week key: days since a fixed Monday epoch (local). */
function mondayWeekIndex(ms: number): number {
  const d = new Date(ms);
  const day = d.getDay(); // 0=Sun
  const daysFromMonday = (day + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysFromMonday, 0, 0, 0, 0);
  return Math.floor(monday.getTime() / (7 * 24 * 60 * 60 * 1000));
}

function atLocal(y: number, m: number, d: number, hh: number, mm: number): number {
  return new Date(y, m, d, hh, mm, 0, 0).getTime();
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

/** First occurrence strictly after `afterMs`, in local time. */
export function computeNextDue(rule: ScheduledBroadcastRule, afterMs: number): number | null {
  if (!isFiniteMs(afterMs)) return null;
  const tod = splitTimeOfDay(rule.timeOfDayMin);
  if (!tod) return null;
  const { hh, mm } = tod;

  switch (rule.interval) {
    case 'hourly':
      return nextHourly(afterMs, mm);
    case 'daily':
      return nextDaily(afterMs, hh, mm);
    case 'weekly': {
      const weekday = rule.weekday;
      if (weekday == null || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
      return nextWeekly(afterMs, weekday, hh, mm);
    }
    case 'biweekly': {
      const weekday = rule.weekday;
      if (weekday == null || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
      const anchor = rule.anchorYmd ? ymdParts(rule.anchorYmd) : null;
      if (!anchor && rule.anchorYmd) return null;
      const anchorMs = anchor
        ? atLocal(anchor.y, anchor.m, anchor.d, 0, 0)
        : atLocal(
            new Date(afterMs).getFullYear(),
            new Date(afterMs).getMonth(),
            new Date(afterMs).getDate(),
            0,
            0,
          );
      return nextBiweekly(afterMs, weekday, hh, mm, anchorMs);
    }
    case 'monthly': {
      const dom = rule.dayOfMonth;
      if (dom == null || !Number.isInteger(dom) || dom < 1 || dom > 31) return null;
      return nextMonthly(afterMs, dom, hh, mm);
    }
    default:
      return null;
  }
}

/** Advance a stale due time to the next strictly-future occurrence (skip-missed). */
export function advancePastDue(
  rule: ScheduledBroadcastRule,
  dueAt: number,
  nowMs: number,
): number | null {
  if (!isFiniteMs(dueAt) || !isFiniteMs(nowMs)) return null;
  if (dueAt > nowMs) return dueAt;
  // Walk from dueAt so we skip every missed occurrence, not just one.
  let cursor = dueAt;
  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const next = computeNextDue(rule, cursor);
    if (next == null) return null;
    if (next > nowMs) return next;
    cursor = next;
  }
  return null;
}

/** First due time at or after `fromMs`. */
export function firstDueAt(rule: ScheduledBroadcastRule, fromMs: number): number | null {
  if (!isFiniteMs(fromMs)) return null;
  // computeNextDue is strictly after; try exact wall time on fromMs's calendar candidate first.
  const next = computeNextDue(rule, fromMs - 1);
  if (next == null) return null;
  if (next >= fromMs) return next;
  return computeNextDue(rule, fromMs);
}

function nextHourly(afterMs: number, minuteOfHour: number): number | null {
  const after = new Date(afterMs);
  let y = after.getFullYear();
  let m = after.getMonth();
  let d = after.getDate();
  let h = after.getHours();
  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const candidate = atLocal(y, m, d, h, minuteOfHour);
    if (candidate > afterMs) return candidate;
    h += 1;
    if (h > 23) {
      h = 0;
      const nextDay = new Date(y, m, d + 1);
      y = nextDay.getFullYear();
      m = nextDay.getMonth();
      d = nextDay.getDate();
    }
  }
  return null;
}

function nextDaily(afterMs: number, hh: number, mm: number): number | null {
  const after = new Date(afterMs);
  let y = after.getFullYear();
  let m = after.getMonth();
  let d = after.getDate();
  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const candidate = atLocal(y, m, d, hh, mm);
    if (candidate > afterMs) return candidate;
    const nextDay = new Date(y, m, d + 1);
    y = nextDay.getFullYear();
    m = nextDay.getMonth();
    d = nextDay.getDate();
  }
  return null;
}

function nextWeekly(afterMs: number, weekday: number, hh: number, mm: number): number | null {
  const after = new Date(afterMs);
  let y = after.getFullYear();
  let m = after.getMonth();
  let d = after.getDate();
  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const probe = new Date(y, m, d);
    if (probe.getDay() === weekday) {
      const candidate = atLocal(y, m, d, hh, mm);
      if (candidate > afterMs) return candidate;
    }
    const nextDay = new Date(y, m, d + 1);
    y = nextDay.getFullYear();
    m = nextDay.getMonth();
    d = nextDay.getDate();
  }
  return null;
}

function nextBiweekly(
  afterMs: number,
  weekday: number,
  hh: number,
  mm: number,
  anchorMs: number,
): number | null {
  const anchorWeek = mondayWeekIndex(anchorMs);
  const after = new Date(afterMs);
  let y = after.getFullYear();
  let m = after.getMonth();
  let d = after.getDate();
  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const probe = new Date(y, m, d);
    if (probe.getDay() === weekday) {
      const candidate = atLocal(y, m, d, hh, mm);
      if (candidate > afterMs) {
        const week = mondayWeekIndex(candidate);
        if (Math.abs(week - anchorWeek) % 2 === 0) return candidate;
      }
    }
    const nextDay = new Date(y, m, d + 1);
    y = nextDay.getFullYear();
    m = nextDay.getMonth();
    d = nextDay.getDate();
  }
  return null;
}

function nextMonthly(afterMs: number, dayOfMonth: number, hh: number, mm: number): number | null {
  const after = new Date(afterMs);
  let y = after.getFullYear();
  let m = after.getMonth();
  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const dim = daysInMonth(y, m);
    if (dayOfMonth <= dim) {
      const candidate = atLocal(y, m, dayOfMonth, hh, mm);
      // Skip months where Date overflows (should not if dayOfMonth <= dim).
      if (
        new Date(candidate).getFullYear() === y &&
        new Date(candidate).getMonth() === m &&
        new Date(candidate).getDate() === dayOfMonth &&
        candidate > afterMs
      ) {
        return candidate;
      }
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return null;
}
