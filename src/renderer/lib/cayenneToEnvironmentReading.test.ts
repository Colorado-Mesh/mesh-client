import { describe, expect, it } from 'vitest';

import {
  cayenneDecodedToEnvironmentReading,
  cayenneWireEntriesToEnvironmentReading,
} from './cayenneToEnvironmentReading';
import type { CayenneReading } from './meshtastic/cayenneLpp';

function reading(
  partial: Pick<CayenneReading, 'kind' | 'channel'> & { value: number },
): CayenneReading {
  return {
    channel: partial.channel,
    typeId: 0,
    kind: partial.kind,
    values: { value: partial.value },
    unit: '',
  };
}

describe('cayenneToEnvironmentReading', () => {
  it('maps Meshtastic decoded kinds and channel-0 vs MCU temperature', () => {
    expect(
      cayenneDecodedToEnvironmentReading([
        reading({ kind: 'temperature', channel: 0, value: 21 }),
        reading({ kind: 'temperature', channel: 1, value: 38 }),
        reading({ kind: 'humidity', channel: 0, value: 40 }),
        reading({ kind: 'barometer', channel: 0, value: 1013 }),
        reading({ kind: 'illuminance', channel: 0, value: 120 }),
        reading({ kind: 'direction', channel: 0, value: 90 }),
        reading({ kind: 'concentration', channel: 0, value: 420 }),
        reading({ kind: 'accelerometer', channel: 0, value: 1 }),
      ]),
    ).toEqual({
      temperature: 21,
      mcuTemperature: 38,
      relativeHumidity: 40,
      barometricPressure: 1013,
      lux: 120,
      windDirection: 90,
      co2: 420,
    });
  });

  it('maps MeshCore wire entries including lux', () => {
    expect(
      cayenneWireEntriesToEnvironmentReading([
        { channel: 0, type: 103, value: 19 },
        { channel: 2, type: 103, value: 41 },
        { channel: 0, type: 104, value: 33 },
        { channel: 0, type: 115, value: 1000 },
        { channel: 0, type: 101, value: 55 },
      ]),
    ).toEqual({
      temperature: 19,
      mcuTemperature: 41,
      relativeHumidity: 33,
      barometricPressure: 1000,
      lux: 55,
    });
  });

  it('returns null when nothing mappable is present', () => {
    expect(cayenneDecodedToEnvironmentReading([])).toBeNull();
    expect(
      cayenneDecodedToEnvironmentReading([reading({ kind: 'presence', channel: 0, value: 1 })]),
    ).toBeNull();
  });
});
