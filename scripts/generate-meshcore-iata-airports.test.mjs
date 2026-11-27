import { describe, expect, it } from 'vitest';

import { parseIataAirportsCsv, splitCsvLine } from './generate-meshcore-iata-airports.mjs';

describe('splitCsvLine', () => {
  it('splits plain columns', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps commas inside quotes', () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });
});

describe('parseIataAirportsCsv', () => {
  const csv = `code,icao,name,latitude,longitude,elevation,url,time_zone,city_code,country,city,state,county,type
DEN,KDEN,Denver International Airport,39.8561,-104.6737,5431,,America/Denver,DEN,US,Denver,Colorado,,AP
COS,KCOS,City of Colorado Springs Municipal Airport,38.8058,-104.7008,6187,,America/Denver,COS,US,Colorado Springs,Colorado,,AP
XXX,XXXX,Bad,0,0,,,,XXX,US,,,,AP
BAD,XBAD,Bad coords,999,0,,,,BAD,US,,,,AP
AB,KAB,Too short,1,2,,,,AB,US,,,,AP
`;

  it('keeps valid 3-letter airports with finite coords', () => {
    const rows = parseIataAirportsCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([
      'COS',
      'City of Colorado Springs Municipal Airport',
      'Colorado Springs',
      38.8058,
      -104.7008,
    ]);
    expect(rows[1]).toEqual(['DEN', 'Denver International Airport', 'Denver', 39.8561, -104.6737]);
  });
});
