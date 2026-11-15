import { describe, expect, it } from 'vitest';

import {
  ENVIRONMENT_NODE_UPDATE_MARKER,
  ENVIRONMENT_READING_FIELDS,
  environmentNodePatchFromReading,
  environmentReadingCsvHeader,
  environmentReadingFromNodePatch,
  environmentReadingFromSnakeCase,
  sanitizeEnvironmentReading,
  serializeSparseNumberArray,
  takeEnvironmentNodeUpdateMarker,
} from './environmentTelemetry';

describe('environmentTelemetry helpers', () => {
  it('keeps only finite known fields and returns null when nothing is left', () => {
    expect(
      sanitizeEnvironmentReading({ temperature: 21.5, lux: Number.NaN, voltage: 3.7, co2: '400' }),
    ).toEqual({ temperature: 21.5 });
    expect(sanitizeEnvironmentReading({ voltage: 3.7 })).toBeNull();
    expect(sanitizeEnvironmentReading(null)).toBeNull();
  });

  it('keeps extended air-quality and weather fields', () => {
    expect(
      sanitizeEnvironmentReading({
        pm10Standard: 1,
        pm40Standard: 2,
        pm100Standard: 3,
        pmVocIdx: 4,
        pmNoxIdx: 5,
        windGust: 6,
        mcuTemperature: 35,
        rainfall1h: 0.2,
      }),
    ).toEqual({
      pm10Standard: 1,
      pm40Standard: 2,
      pm100Standard: 3,
      pmVocIdx: 4,
      pmNoxIdx: 5,
      windGust: 6,
      mcuTemperature: 35,
      rainfall1h: 0.2,
    });
  });

  it('sanitizes sparse ADC / one-wire arrays', () => {
    const reading = sanitizeEnvironmentReading({
      adcVoltages: [1.2, undefined, 3.4],
      oneWireTemperatures: [20, Number.NaN, 22],
    });
    expect(reading?.adcVoltages?.[0]).toBe(1.2);
    expect(reading?.adcVoltages?.[2]).toBe(3.4);
    expect(reading?.oneWireTemperatures?.[0]).toBe(20);
    expect(reading?.oneWireTemperatures?.[2]).toBe(22);
    expect(serializeSparseNumberArray(reading?.adcVoltages)).toContain('1.2');
  });

  it('round-trips readings through node patches', () => {
    const reading = {
      temperature: 20,
      relativeHumidity: 40,
      barometricPressure: 1013,
      pmVocIdx: 12,
    };
    expect(environmentReadingFromNodePatch(environmentNodePatchFromReading(reading))).toEqual(
      reading,
    );
  });

  it('reads snake_case JSON telemetry including new columns', () => {
    expect(
      environmentReadingFromSnakeCase({
        temperature: 18,
        relative_humidity: 55,
        pm_voc_idx: 9,
        mcu_temperature: 40,
        adc_voltages_json: '[1.1,null,2.2]',
      }),
    ).toEqual({
      temperature: 18,
      relativeHumidity: 55,
      pmVocIdx: 9,
      mcuTemperature: 40,
      adcVoltages: [1.1, undefined, 2.2],
    });
  });

  it('takes the node-update marker off the object', () => {
    const update: Record<string, unknown> = { node_id: 1, [ENVIRONMENT_NODE_UPDATE_MARKER]: 123 };
    expect(takeEnvironmentNodeUpdateMarker(update)).toBe(123);
    expect(ENVIRONMENT_NODE_UPDATE_MARKER in update).toBe(false);
    expect(takeEnvironmentNodeUpdateMarker({ node_id: 1 })).toBeUndefined();
  });

  it('derives CSV headers from the field list', () => {
    expect(environmentReadingCsvHeader('relativeHumidity')).toBe('env_relative_humidity');
    expect(ENVIRONMENT_READING_FIELDS).toContain('mcuTemperature');
    expect(ENVIRONMENT_READING_FIELDS).toContain('pmVocIdx');
  });
});
