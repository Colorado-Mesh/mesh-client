import { describe, expect, it } from 'vitest';

import { assignCayenneTemperatureFields } from './meshcoreCayenneTemperature';

const LPP_TEMPERATURE = 103;

describe('assignCayenneTemperatureFields', () => {
  it('separates env (channel 0) from MCU (other channels)', () => {
    const fields = assignCayenneTemperatureFields(
      [
        { channel: 0, type: LPP_TEMPERATURE, value: 21.5 },
        { channel: 2, type: LPP_TEMPERATURE, value: 38.25 },
      ],
      LPP_TEMPERATURE,
    );
    expect(fields.temperature).toBe(21.5);
    expect(fields.mcuTemperature).toBe(38.25);
  });

  it('does not treat non-zero-only as env overwrite of MCU', () => {
    const fields = assignCayenneTemperatureFields(
      [{ channel: 1, type: LPP_TEMPERATURE, value: 40 }],
      LPP_TEMPERATURE,
    );
    expect(fields.temperature).toBeUndefined();
    expect(fields.mcuTemperature).toBe(40);
  });
});
