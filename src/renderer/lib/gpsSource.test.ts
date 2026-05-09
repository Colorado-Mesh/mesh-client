import { describe, expect, it } from 'vitest';

import { resolveOurPosition } from './gpsSource';

describe('resolveOurPosition', () => {
  it('includes altitudeMeters on device branch when finite', async () => {
    const p = await resolveOurPosition(40.1, -105.1, undefined, undefined, 1600);
    expect(p).toEqual({
      lat: 40.1,
      lon: -105.1,
      source: 'device',
      altitudeMeters: 1600,
    });
  });

  it('omits altitude when deviceAlt is not finite', async () => {
    const p = await resolveOurPosition(40.1, -105.1, undefined, undefined, NaN);
    expect(p).toEqual({ lat: 40.1, lon: -105.1, source: 'device' });
    expect(p?.altitudeMeters).toBeUndefined();
  });

  it('includes sea-level altitude (0)', async () => {
    const p = await resolveOurPosition(40.1, -105.1, undefined, undefined, 0);
    expect(p?.altitudeMeters).toBe(0);
  });
});
