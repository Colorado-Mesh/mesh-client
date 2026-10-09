import { describe, expect, it } from 'vitest';

import { mt1StableUid, parseMt1Message, parseMt1Payload } from './mt1Tracker';

const FULL =
  'Rex K9: !MT1;u=A1B2C3D4;k=k9;la=36.123456;ln=-82.123456;s=1.2;c=90;a=512;st=30;q=1042;b=87';

describe('parseMt1Message', () => {
  it('parses every field of a full fix', () => {
    expect(parseMt1Message(FULL)).toEqual({
      callsign: 'Rex K9',
      id8: 'a1b2c3d4',
      role: 'k9',
      lat: 36.123456,
      lon: -82.123456,
      speed: 1.2,
      course: 90,
      altitude: 512,
      staleSec: 30,
      seq: 1042,
      battery: 87,
    });
  });

  it('accepts a minimal fix and falls back to the tracker id as callsign', () => {
    expect(parseMt1Payload('!MT1;u=0000beef;la=1.5;ln=2.5', '')).toEqual({
      callsign: '0000BEEF',
      id8: '0000beef',
      lat: 1.5,
      lon: 2.5,
    });
  });

  it('drops an unknown role and out-of-range optional fields', () => {
    const fix = parseMt1Payload('!MT1;u=a1b2c3d4;k=pilot;la=1;ln=2;c=400;b=150;s=-3', 'X');
    expect(fix).toEqual({ callsign: 'X', id8: 'a1b2c3d4', lat: 1, lon: 2 });
  });

  it.each([
    ['plain chat', 'hello there'],
    ['the wrong prefix', '!MT2;u=a1b2c3d4;la=1;ln=2'],
    ['no tracker id', '!MT1;la=1;ln=2'],
    ['a short tracker id', '!MT1;u=a1b2;la=1;ln=2'],
    ['no position', '!MT1;u=a1b2c3d4'],
    ['the (0, 0) placeholder', '!MT1;u=a1b2c3d4;la=0;ln=0'],
    ['an out-of-range latitude', '!MT1;u=a1b2c3d4;la=91;ln=2'],
    ['a non-numeric longitude', '!MT1;u=a1b2c3d4;la=1;ln=east'],
    ['too many fields', `!MT1;u=a1b2c3d4;la=1;ln=2;${'x=1;'.repeat(30)}`],
  ])('rejects %s', (_label, payload) => {
    expect(parseMt1Payload(payload, 'X')).toBeNull();
  });

  it('keeps the same uid when a tracker is renamed', () => {
    const a = parseMt1Message('Rex: !MT1;u=A1B2C3D4;la=1;ln=2')!;
    const b = parseMt1Message('Unit 9: !MT1;u=a1b2c3d4;la=1;ln=2')!;
    expect(mt1StableUid(a.id8)).toBe('meshtracker-a1b2c3d4');
    expect(mt1StableUid(b.id8)).toBe(mt1StableUid(a.id8));
  });
});
