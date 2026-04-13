// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatLogFileTimestamp, formatLogTimeOfDay } from './formatLogTimestamp';

/** 2026-04-12T20:15:30.456Z */
const SAMPLE_TS = Date.UTC(2026, 3, 12, 20, 15, 30, 456);

describe('formatLogFileTimestamp', () => {
  let prevTz: string | undefined;

  beforeEach(() => {
    prevTz = process.env.TZ;
  });

  afterEach(() => {
    if (prevTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = prevTz;
    }
  });

  it('formats local wall time without Z (UTC)', () => {
    process.env.TZ = 'UTC';
    expect(formatLogFileTimestamp(SAMPLE_TS)).toBe('2026-04-12T20:15:30.456');
  });

  it('formats local wall time (America/Los_Angeles)', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(formatLogFileTimestamp(SAMPLE_TS)).toBe('2026-04-12T13:15:30.456');
  });
});

describe('formatLogTimeOfDay', () => {
  let prevTz: string | undefined;

  beforeEach(() => {
    prevTz = process.env.TZ;
  });

  afterEach(() => {
    if (prevTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = prevTz;
    }
  });

  it('formats HH:MM:SS.mmm in local time (UTC)', () => {
    process.env.TZ = 'UTC';
    expect(formatLogTimeOfDay(SAMPLE_TS)).toBe('20:15:30.456');
  });

  it('formats HH:MM:SS.mmm in local time (America/Los_Angeles)', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(formatLogTimeOfDay(SAMPLE_TS)).toBe('13:15:30.456');
  });

  it('keeps 12-character HH:MM:SS.mmm width', () => {
    process.env.TZ = 'UTC';
    expect(formatLogTimeOfDay(SAMPLE_TS).length).toBe(12);
  });
});
