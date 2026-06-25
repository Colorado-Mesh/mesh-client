import { describe, expect, it } from 'vitest';

import {
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  MS_PER_YEAR,
} from './timeConstants';

describe('timeConstants', () => {
  it('derives larger units from MS_PER_SECOND', () => {
    expect(MS_PER_MINUTE).toBe(60 * MS_PER_SECOND);
    expect(MS_PER_HOUR).toBe(60 * MS_PER_MINUTE);
    expect(MS_PER_DAY).toBe(24 * MS_PER_HOUR);
    expect(MS_PER_YEAR).toBe(365 * MS_PER_DAY);
  });
});
