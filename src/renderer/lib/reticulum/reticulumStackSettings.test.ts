import { describe, expect, it } from 'vitest';

import { parseReticulumStackSettingsPayload } from './reticulumStackSettings';

describe('parseReticulumStackSettingsPayload', () => {
  it('defaults announce_interval_sec to 3600 when absent', () => {
    expect(
      parseReticulumStackSettingsPayload({
        enable_transport: false,
        share_instance: true,
        loglevel: 4,
      }).announce_interval_sec,
    ).toBe(3600);
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
