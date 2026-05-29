import { describe, expect, it } from 'vitest';

import {
  buildMeshtasticModuleApplyValue,
  mergeMeshtasticConfigApplyValue,
  meshtasticConfigSlice,
  stripMeshtasticProtobufMeta,
} from './meshtasticConfigApply';

describe('meshtasticConfigApply', () => {
  it('meshtasticConfigSlice returns empty object for non-records', () => {
    expect(meshtasticConfigSlice(null)).toEqual({});
    expect(meshtasticConfigSlice([])).toEqual({});
  });

  it('strips protobuf metadata', () => {
    expect(stripMeshtasticProtobufMeta({ $typeName: 'x', enabled: true })).toEqual({
      enabled: true,
    });
  });

  it('merge preserves hidden device fields and overlays UI', () => {
    const merged = mergeMeshtasticConfigApplyValue(
      {
        $typeName: 'meshtastic.ModuleConfig.TelemetryConfig',
        deviceUpdateInterval: 1800,
        healthMeasurementEnabled: true,
        powerUpdateInterval: 900,
      },
      { deviceUpdateInterval: 3600 },
    );

    expect(merged).toEqual({
      deviceUpdateInterval: 3600,
      healthMeasurementEnabled: true,
      powerUpdateInterval: 900,
    });
    expect(merged).not.toHaveProperty('$typeName');
  });

  it('merge with empty device slice uses UI overrides only', () => {
    expect(mergeMeshtasticConfigApplyValue({}, { enabled: true, baud: 115200 })).toEqual({
      enabled: true,
      baud: 115200,
    });
  });

  it('buildMeshtasticModuleApplyValue delegates to merge', () => {
    const merged = buildMeshtasticModuleApplyValue(
      'serial',
      { mode: 1, overrideConsoleSerialPort: true },
      { enabled: true, echo: false },
    );
    expect(merged).toEqual({
      mode: 1,
      overrideConsoleSerialPort: true,
      enabled: true,
      echo: false,
    });
  });
});
