import type { OutboxEntry, OutboxEntryInput } from '@/shared/electron-api.types';

import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from './timeConstants';

/**
 * Scheduled send reuses the durable chat outbox (SQLite `chat_outbox`) with no schema change.
 * A scheduled row is a normal-priority `queued` row with `attemptCount === 0` and a
 * `nextRetryAt` wall-clock target: the existing drain already skips rows whose `nextRetryAt` is
 * in the future, so a row survives restart and fires once the time has passed and a link is
 * available. Any send attempt bumps `attemptCount` (or clears `nextRetryAt`), after which the row
 * is an ordinary retry/failed row — no separate state to keep in sync.
 */
export const SCHEDULED_SEND_MIN_LEAD_MS = 5 * MS_PER_SECOND;
export const SCHEDULED_SEND_MAX_HORIZON_MS = 30 * MS_PER_DAY;

export type ScheduledAtValidation = 'ok' | 'past' | 'tooFar' | 'invalid';

export function validateScheduledAt(
  scheduledAt: number,
  now: number = Date.now(),
): ScheduledAtValidation {
  if (!Number.isFinite(scheduledAt)) return 'invalid';
  if (scheduledAt < now + SCHEDULED_SEND_MIN_LEAD_MS) return 'past';
  if (scheduledAt > now + SCHEDULED_SEND_MAX_HORIZON_MS) return 'tooFar';
  return 'ok';
}

/** True for a not-yet-attempted scheduled outbox row (see module doc). */
export function isScheduledOutboxRow(
  row: Pick<OutboxEntry, 'status' | 'attemptCount' | 'nextRetryAt' | 'priority'>,
): boolean {
  return (
    row.priority === 'normal' &&
    row.status === 'queued' &&
    row.attemptCount === 0 &&
    row.nextRetryAt != null
  );
}

/** Wall-clock anchor for the outbox 24h drain age cap (scheduled rows age from their send time). */
export function outboxRowAgeAnchorMs(
  row: Pick<
    OutboxEntry,
    'status' | 'attemptCount' | 'nextRetryAt' | 'priority' | 'createdAt' | 'updatedAt'
  >,
): number {
  if (isScheduledOutboxRow(row) && row.nextRetryAt != null) return row.nextRetryAt;
  // After a manual retry / failed attempt the row is no longer "scheduled"; age from the later
  // of create vs last update so an old scheduledAt does not immediately hit the 24h drain cap.
  return Math.max(row.createdAt, row.updatedAt);
}

/** Turn a regular queue entry into a scheduled one. */
export function toScheduledEntry(entry: OutboxEntryInput, scheduledAt: number): OutboxEntryInput {
  return { ...entry, status: 'queued', error: null, nextRetryAt: scheduledAt };
}

/** Rows that belong to the same multi-part message as `row` (or just `row`). */
export function scheduledGroupRows(
  rows: readonly OutboxEntry[],
  row: Pick<OutboxEntry, 'id' | 'groupId'>,
): OutboxEntry[] {
  if (row.groupId == null) return rows.filter((r) => r.id === row.id);
  return rows.filter((r) => r.groupId === row.groupId);
}

/** Default value for a `datetime-local` input (`YYYY-MM-DDTHH:mm`, local time). */
export function toDateTimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse a `datetime-local` value as local time; NaN when empty/malformed. */
export function fromDateTimeLocalValue(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return Number.NaN;
  const [, y, mo, d, h, mi] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0, 0).getTime();
}

/** Quick-pick targets offered by the schedule dialog. */
export function schedulePresetTimes(now: number = Date.now()): {
  inFifteenMinutes: number;
  inOneHour: number;
  tomorrowMorning: number;
} {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return {
    inFifteenMinutes: now + 15 * MS_PER_MINUTE,
    inOneHour: now + MS_PER_HOUR,
    tomorrowMorning: tomorrow.getTime(),
  };
}
