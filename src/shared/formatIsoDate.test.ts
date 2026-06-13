// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatIsoDate, formatIsoDateTime } from './formatIsoDate';

/** 2026-04-12T20:15:30.456Z */
const SAMPLE_TS = Date.UTC(2026, 3, 12, 20, 15, 30, 456);

describe('formatIsoDate', () => {
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

  it('formats YYYY-MM-DD in local time (UTC)', () => {
    process.env.TZ = 'UTC';
    expect(formatIsoDate(SAMPLE_TS)).toBe('2026-04-12');
  });

  it('formats YYYY-MM-DD in local time (America/Los_Angeles)', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(formatIsoDate(SAMPLE_TS)).toBe('2026-04-12');
  });

  it('accepts Date objects', () => {
    process.env.TZ = 'UTC';
    expect(formatIsoDate(new Date(SAMPLE_TS))).toBe('2026-04-12');
  });
});

describe('formatIsoDateTime', () => {
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

  it('formats YYYY-MM-DD HH:mm in local time (UTC)', () => {
    process.env.TZ = 'UTC';
    expect(formatIsoDateTime(SAMPLE_TS)).toBe('2026-04-12 20:15');
  });

  it('formats YYYY-MM-DD HH:mm in local time (America/Los_Angeles)', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(formatIsoDateTime(SAMPLE_TS)).toBe('2026-04-12 13:15');
  });
});
