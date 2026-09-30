import { afterEach, describe, expect, it } from 'vitest';

import {
  clearRadioSelfPosition,
  readRadioSelfPosition,
  recordRadioSelfPosition,
} from './radioSelfPosition';

describe('radioSelfPosition', () => {
  afterEach(() => {
    clearRadioSelfPosition('meshtastic');
    clearRadioSelfPosition('meshcore');
  });

  it('records a valid fix per protocol', () => {
    recordRadioSelfPosition('meshtastic', 39.7, -104.9, 1600);
    expect(readRadioSelfPosition('meshtastic')).toMatchObject({
      lat: 39.7,
      lon: -104.9,
      altitudeMeters: 1600,
    });
    expect(readRadioSelfPosition('meshcore')).toBeNull();
  });

  it.each([
    [0, 0],
    [90, 0],
    [null, -104.9],
    [95, 10],
  ])('ignores no-fix / invalid coords (%s, %s)', (lat, lon) => {
    recordRadioSelfPosition('meshtastic', lat, lon);
    expect(readRadioSelfPosition('meshtastic')).toBeNull();
  });

  it('clear drops the fix', () => {
    recordRadioSelfPosition('meshcore', 39.7, -104.9);
    clearRadioSelfPosition('meshcore');
    expect(readRadioSelfPosition('meshcore')).toBeNull();
  });
});
