import { describe, expect, it } from 'vitest';

import {
  ENVIRONMENT_NODE_UPDATE_MARKER,
  environmentNodePatchFromReading,
  environmentReadingFromNodePatch,
  environmentReadingFromSnakeCase,
  sanitizeEnvironmentReading,
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

  it('round-trips readings through node patches', () => {
    const reading = { temperature: 20, relativeHumidity: 40, barometricPressure: 1013 };
    expect(environmentReadingFromNodePatch(environmentNodePatchFromReading(reading))).toEqual(
      reading,
    );
  });

  it('reads snake_case JSON telemetry', () => {
    expect(environmentReadingFromSnakeCase({ temperature: 18, relative_humidity: 55 })).toEqual({
      temperature: 18,
      relativeHumidity: 55,
    });
  });

  it('takes the node-update marker off the object', () => {
    const update: Record<string, unknown> = { node_id: 1, [ENVIRONMENT_NODE_UPDATE_MARKER]: 123 };
    expect(takeEnvironmentNodeUpdateMarker(update)).toBe(123);
    expect(ENVIRONMENT_NODE_UPDATE_MARKER in update).toBe(false);
    expect(takeEnvironmentNodeUpdateMarker({ node_id: 1 })).toBeUndefined();
  });
});
