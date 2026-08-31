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

  it('signature serializes 64-bit protobuf fields instead of throwing', () => {
    expect(() => meshtasticConfigSignature({ powermonEnables: 0n })).not.toThrow();
    expect(meshtasticConfigSignature({ powermonEnables: 12n })).toBe('{"powermonEnables":"12n"}');
  });

  it('signature distinguishes bigint values from their decimal strings', () => {
    expect(meshtasticConfigSignature({ v: 1n })).not.toBe(meshtasticConfigSignature({ v: '1' }));
  });

  it('signature is stable for equal slices', () => {
    const slice = { isPowerSaving: true, powermonEnables: 3n, sdsSecs: 0 };
    expect(meshtasticConfigSignature({ ...slice })).toBe(meshtasticConfigSignature({ ...slice }));
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
