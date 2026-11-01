import { describe, expect, it } from 'vitest';

import { cayenneSeriesKey, decodeCayenneLpp } from './cayenneLpp';

describe('decodeCayenneLpp', () => {
  it('decodes temperature, humidity, barometer and illuminance records', () => {
    const bytes = new Uint8Array([
      0x01,
      0x67,
      0x01,
      0x10, // ch1 temp 27.2 °C
      0x02,
      0x68,
      0x6b, // ch2 humidity 53.5 %
      0x03,
      0x73,
      0x27,
      0x74, // ch3 barometer 1010.0 hPa
      0x04,
      0x65,
      0x01,
      0x2c, // ch4 illuminance 300 lx
    ]);
    const { readings, truncated } = decodeCayenneLpp(bytes);
    expect(truncated).toBe(false);
    expect(readings.map((r) => [r.channel, r.kind, r.values.value, r.unit])).toEqual([
      [1, 'temperature', 27.2, '°C'],
      [2, 'humidity', 53.5, '%'],
      [3, 'barometer', 1010, 'hPa'],
      [4, 'illuminance', 300, 'lx'],
    ]);
  });

  it('decodes negative temperature (two’s complement)', () => {
    const { readings } = decodeCayenneLpp(new Uint8Array([0x01, 0x67, 0xff, 0x38]));
    expect(readings[0]?.values.value).toBe(-20);
  });

  it('decodes GPS with signed 24-bit lat/lon', () => {
    // lat 42.3519, lon -87.9094, alt 10.00 m (Cayenne docs example)
    const bytes = new Uint8Array([
      0x01, 0x88, 0x06, 0x76, 0x5f, 0xf2, 0x96, 0x0a, 0x00, 0x03, 0xe8,
    ]);
    const [gps] = decodeCayenneLpp(bytes).readings;
    expect(gps.kind).toBe('gps');
    expect(gps.values).toEqual({ lat: 42.3519, lon: -87.9094, alt: 10 });
  });

  it('decodes accelerometer / gyrometer vectors', () => {
    const accel = decodeCayenneLpp(
      new Uint8Array([0x01, 0x71, 0x04, 0xd2, 0xfb, 0x2e, 0x00, 0x00]),
    );
    expect(accel.readings[0]?.values).toEqual({ x: 1.234, y: -1.234, z: 0 });
    const gyro = decodeCayenneLpp(new Uint8Array([0x02, 0x86, 0x00, 0x64, 0x00, 0x00, 0xff, 0x9c]));
    expect(gyro.readings[0]?.values).toEqual({ x: 1, y: 0, z: -1 });
  });

  it('returns partial readings and truncated=true on unknown type', () => {
    const { readings, truncated } = decodeCayenneLpp(
      new Uint8Array([0x01, 0x67, 0x01, 0x10, 0x02, 0xee, 0x01]),
    );
    expect(readings).toHaveLength(1);
    expect(truncated).toBe(true);
  });

  it('flags a record that runs past the buffer', () => {
    const { readings, truncated } = decodeCayenneLpp(new Uint8Array([0x01, 0x67, 0x01]));
    expect(readings).toEqual([]);
    expect(truncated).toBe(true);
  });

  it('handles empty and header-only input without throwing', () => {
    expect(decodeCayenneLpp(new Uint8Array())).toEqual({ readings: [], truncated: false });
    expect(decodeCayenneLpp(new Uint8Array([0x01])).truncated).toBe(true);
  });

  it('honors a Uint8Array view with a non-zero byteOffset', () => {
    const backing = new Uint8Array([0xaa, 0xbb, 0x01, 0x67, 0x00, 0x64]);
    const { readings } = decodeCayenneLpp(backing.subarray(2));
    expect(readings[0]?.values.value).toBe(10);
  });

  it('builds stable series keys', () => {
    const [temp] = decodeCayenneLpp(new Uint8Array([0x05, 0x67, 0x00, 0x64])).readings;
    expect(cayenneSeriesKey(temp, 'value')).toBe('temperature#5');
    expect(cayenneSeriesKey(temp, 'x')).toBe('temperature#5.x');
  });
});
