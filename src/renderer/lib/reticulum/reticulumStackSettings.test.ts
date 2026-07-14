import { describe, expect, it } from 'vitest';

import {
  coerceAnnounceIntervalSec,
  DEFAULT_ANNOUNCE_INTERVAL_SEC,
  parseReticulumStackSettingsPayload,
} from './reticulumStackSettings';

describe('parseReticulumStackSettingsPayload', () => {
  it('defaults announce_interval_sec to 3600 when absent', () => {
    expect(
      parseReticulumStackSettingsPayload({
        enable_transport: false,
        share_instance: true,
        loglevel: 4,
      }).announce_interval_sec,
    ).toBe(DEFAULT_ANNOUNCE_INTERVAL_SEC);
  });

  it('defaults share_instance to false when absent', () => {
    expect(parseReticulumStackSettingsPayload({ enable_transport: false }).share_instance).toBe(
      false,
    );
  });

  it('preserves explicit announce_interval_sec of 0', () => {
    expect(
      parseReticulumStackSettingsPayload({
        enable_transport: false,
        share_instance: true,
        loglevel: 4,
        announce_interval_sec: 0,
      }).announce_interval_sec,
    ).toBe(0);
  });
});

describe('coerceAnnounceIntervalSec', () => {
  it('returns explicit zero', () => {
    expect(coerceAnnounceIntervalSec(0)).toBe(0);
  });

  it('defaults absent values to 3600', () => {
    expect(coerceAnnounceIntervalSec(undefined)).toBe(DEFAULT_ANNOUNCE_INTERVAL_SEC);
  });
});
