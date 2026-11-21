import { describe, expect, it } from 'vitest';

import { getMeshcomCountryByCode, getMeshcomCountryById } from './meshcomCountryProfiles';

describe('meshcomCountryProfiles', () => {
  it('looks up by id and code', () => {
    expect(getMeshcomCountryById(0)?.code).toBe('EU');
    expect(getMeshcomCountryByCode('915')?.frequencyMhz).toBe(906.875);
  });
});
