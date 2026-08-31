import { describe, expect, it } from 'vitest';

import {
  buildMeshtasticModuleApplyValue,
  mergeMeshtasticConfigApplyValue,
  meshtasticConfigSignature,
  meshtasticConfigSlice,
  meshtasticConfigSliceHydrated,
  stripMeshtasticProtobufMeta,
} from './meshtasticConfigApply';

describe('meshtasticConfigApply', () => {
  it('meshtasticConfigSlice returns empty object for non-records', () => {
    expect(meshtasticConfigSlice(null)).toEqual({});
    expect(meshtasticConfigSlice([])).toEqual({});
  });

  it('meshtasticConfigSliceHydrated is false until slice has fields', () => {
    expect(meshtasticConfigSliceHydrated(null)).toBe(false);
    expect(meshtasticConfigSliceHydrated({})).toBe(false);
    expect(meshtasticConfigSliceHydrated({ role: 0 })).toBe(true);
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

  it('meshtasticConfigSignature stringifies bigint fields instead of throwing', () => {
    // PowerConfig.powermon_enables / RemoteHardwareConfig.gpio_mask decode as native bigint —
    // plain JSON.stringify throws "Do not know how to serialize a BigInt" on these.
    expect(() =>
      meshtasticConfigSignature({ powermonEnables: 42n, isPowerSaving: true }),
    ).not.toThrow();
    expect(meshtasticConfigSignature({ powermonEnables: 42n })).toBe(
      JSON.stringify({ powermonEnables: '42' }),
    );
  });

  it('meshtasticConfigSignature is stable across calls for unchanged input', () => {
    const cfg = { gpioMask: 255n, gpioValue: 0n, enabled: true };
    expect(meshtasticConfigSignature(cfg)).toBe(meshtasticConfigSignature({ ...cfg }));
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
