import { describe, expect, it } from 'vitest';

import type { OutboxEntry, OutboxEntryInput } from '@/shared/electron-api.types';

import {
  fromDateTimeLocalValue,
  isScheduledOutboxRow,
  outboxRowAgeAnchorMs,
  SCHEDULED_SEND_MAX_HORIZON_MS,
  SCHEDULED_SEND_MIN_LEAD_MS,
  scheduledGroupRows,
  schedulePresetTimes,
  toDateTimeLocalValue,
  toScheduledEntry,
  validateScheduledAt,
} from './scheduledSend';

function row(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 1,
    protocol: 'meshtastic',
    viewKey: 'ch:0',
    channel: 0,
    toNode: null,
    payload: 'hi',
    replyId: null,
    status: 'queued',
    error: null,
    attemptCount: 0,
    nextRetryAt: 2_000_000,
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    groupId: null,
    groupIndex: null,
    groupTotal: null,
    priority: 'normal',
    ...overrides,
  };
}

describe('scheduledSend', () => {
  it('recognizes only not-yet-attempted normal queued rows with a target time', () => {
    expect(isScheduledOutboxRow(row())).toBe(true);
    expect(isScheduledOutboxRow(row({ nextRetryAt: null }))).toBe(false);
    expect(isScheduledOutboxRow(row({ attemptCount: 1 }))).toBe(false);
    expect(isScheduledOutboxRow(row({ status: 'failed' }))).toBe(false);
    expect(isScheduledOutboxRow(row({ status: 'sending' }))).toBe(false);
    expect(isScheduledOutboxRow(row({ priority: 'emergency' }))).toBe(false);
  });

  it('ages scheduled rows from their send time, others from creation', () => {
    expect(outboxRowAgeAnchorMs(row())).toBe(2_000_000);
    expect(outboxRowAgeAnchorMs(row({ attemptCount: 1 }))).toBe(1_000_000);
  });

  it('validates the schedule window', () => {
    const now = 1_000_000;
    expect(validateScheduledAt(now + SCHEDULED_SEND_MIN_LEAD_MS, now)).toBe('ok');
    expect(validateScheduledAt(now + SCHEDULED_SEND_MIN_LEAD_MS - 1, now)).toBe('past');
    expect(validateScheduledAt(now - 1, now)).toBe('past');
    expect(validateScheduledAt(now + SCHEDULED_SEND_MAX_HORIZON_MS, now)).toBe('ok');
    expect(validateScheduledAt(now + SCHEDULED_SEND_MAX_HORIZON_MS + 1, now)).toBe('tooFar');
    expect(validateScheduledAt(Number.NaN, now)).toBe('invalid');
  });

  it('stamps a queue entry as scheduled', () => {
    const input: OutboxEntryInput = {
      protocol: 'reticulum',
      viewKey: 'dm:5',
      channel: 0,
      toNode: 5,
      payload: 'later',
      replyId: null,
      status: 'queued',
      error: 'x',
      nextRetryAt: null,
      groupId: null,
      groupIndex: null,
      groupTotal: null,
    };
    const scheduled = toScheduledEntry(input, 123);
    expect(scheduled).toMatchObject({ status: 'queued', error: null, nextRetryAt: 123 });
    expect(isScheduledOutboxRow({ ...scheduled, attemptCount: 0, priority: 'normal' })).toBe(true);
  });

  it('selects every part of a multi-part scheduled message', () => {
    const rows = [
      row({ id: 1, groupId: 'g' }),
      row({ id: 2, groupId: 'g' }),
      row({ id: 3, groupId: null }),
    ];
    expect(scheduledGroupRows(rows, rows[0]).map((r) => r.id)).toEqual([1, 2]);
    expect(scheduledGroupRows(rows, rows[2]).map((r) => r.id)).toEqual([3]);
  });

  it('round-trips datetime-local values in local time', () => {
    const ms = new Date(2030, 4, 6, 7, 8).getTime();
    expect(toDateTimeLocalValue(ms)).toBe('2030-05-06T07:08');
    expect(fromDateTimeLocalValue('2030-05-06T07:08')).toBe(ms);
    expect(Number.isNaN(fromDateTimeLocalValue(''))).toBe(true);
    expect(Number.isNaN(fromDateTimeLocalValue('nope'))).toBe(true);
  });

  it('offers future presets', () => {
    const now = new Date(2030, 0, 1, 20, 0).getTime();
    const presets = schedulePresetTimes(now);
    expect(presets.inFifteenMinutes).toBe(now + 15 * 60_000);
    expect(presets.inOneHour).toBe(now + 60 * 60_000);
    expect(presets.tomorrowMorning).toBe(new Date(2030, 0, 2, 9, 0).getTime());
  });
});
