import { describe, expect, it } from 'vitest';

import { buildGazetteerTsv } from './build-geo-gazetteer.mjs';

function cityLine({ name, ascii, lat, lon, country, admin1, population }) {
  const f = new Array(19).fill('');
  f[0] = '1';
  f[1] = name;
  f[2] = ascii;
  f[4] = String(lat);
  f[5] = String(lon);
  f[8] = country;
  f[10] = admin1;
  f[14] = String(population);
  return f.join('\t');
}

describe('buildGazetteerTsv', () => {
  it('joins admin1 names, blanks duplicate ascii names, rounds coords and sorts by population', () => {
    const admin1 = 'US.CO\tColorado\tColorado\t5417618\nDE.16\tBerlin\tBerlin\t2950157\n';
    const cities = [
      cityLine({
        name: 'Brighton',
        ascii: 'Brighton',
        lat: 39.98532,
        lon: -104.82053,
        country: 'US',
        admin1: 'CO',
        population: 37585,
      }),
      cityLine({
        name: 'Zürich',
        ascii: 'Zurich',
        lat: 47.36667,
        lon: 8.55,
        country: 'CH',
        admin1: '25',
        population: 341730,
      }),
      'malformed line',
    ].join('\n');

    const lines = buildGazetteerTsv(admin1, cities).trim().split('\n');
    expect(lines[0]).toBe('name\tascii\tcountry\tadmin1Code\tadmin1Name\tlat\tlon\tpopulation');
    expect(lines[1]).toBe('Zürich\tZurich\tCH\t25\t\t47.3667\t8.5500\t341730');
    expect(lines[2]).toBe('Brighton\t\tUS\tCO\tColorado\t39.9853\t-104.8205\t37585');
    expect(lines).toHaveLength(3);
  });
});
