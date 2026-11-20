import { describe, expect, it } from 'vitest';

import { parseMeshcomMheardText, parseMeshcomMhJson } from './meshcomMheard';

describe('meshcomMheard', () => {
  it('parses BLE TYP MH JSON', () => {
    expect(
      parseMeshcomMhJson({
        TYP: 'MH',
        CALL: 'oe9xyz-7',
        RSSI: -91,
        SNR: 6.5,
        DIST: 12.3,
        HW: 3,
      }),
    ).toMatchObject({
      callsign: 'OE9XYZ-7',
      rssi: -91,
      snr: 6.5,
      distanceKm: 12.3,
      hwId: 3,
    });
  });

  it('parses serial --mheard rows', () => {
    const stations = parseMeshcomMheardText(
      ['OE1ABC-1 -90 dBm SNR:5.0 DIST:1.2', 'DH1FR-2 -100 dBm', '--mheard'].join('\n'),
    );
    expect(stations.map((s) => s.callsign)).toEqual(['OE1ABC-1', 'DH1FR-2']);
    expect(stations[0]).toMatchObject({ rssi: -90, snr: 5, distanceKm: 1.2 });
  });
});
