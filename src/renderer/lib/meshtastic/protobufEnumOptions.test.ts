import { Config, Mesh } from '@meshtastic/protobufs';
import { describe, expect, it } from 'vitest';

import en from '@/renderer/locales/en/translation.json';

import { meshtasticHwModelName } from '../hardwareModels';
import {
  DEVICE_ROLE_OPTIONS,
  DISPLAY_UNIT_OPTIONS,
  humanizeEnumName,
  MODEM_PRESET_OPTIONS,
  OLED_TYPE_OPTIONS,
  type ProtobufEnumDescriptor,
  protobufEnumOptions,
  REBROADCAST_MODE_OPTIONS,
  REGION_OPTIONS,
} from './protobufEnumOptions';

const radioPanel = en.radioPanel as unknown as Record<
  string,
  Record<string, { label?: string; description?: string }>
>;

describe('protobufEnumOptions', () => {
  it('carries the wire value, proto name and deprecation flag', () => {
    const options = protobufEnumOptions({
      values: [
        { name: 'LONG_FAST', number: 0, deprecated: false },
        { name: 'LONG_SLOW', number: 1, deprecated: true },
      ],
    });
    expect(options).toEqual([
      { value: 0, enumName: 'LONG_FAST', deprecated: false },
      { value: 1, enumName: 'LONG_SLOW', deprecated: true },
    ]);
  });

  it('humanizes proto enum names', () => {
    expect(humanizeEnumName('SEEED_WIO_TRACKER_L2')).toBe('Seeed Wio Tracker L2');
    expect(humanizeEnumName('US')).toBe('Us');
  });
});

describe('modem preset wire values', () => {
  // Regression: the hardcoded list mapped 0-6 to Long Fast/Long Slow/Long Moderate/
  // Short Fast/Short Slow/Medium Fast/Medium Slow, so picking "Short Fast" wrote
  // MEDIUM_SLOW (3) to the radio.
  it('matches the generated enum rather than the old hardcoded order', () => {
    const byName = new Map(MODEM_PRESET_OPTIONS.map((o) => [o.enumName, o.value]));
    expect(byName.get('LONG_FAST')).toBe(0);
    expect(byName.get('MEDIUM_SLOW')).toBe(3);
    expect(byName.get('MEDIUM_FAST')).toBe(4);
    expect(byName.get('SHORT_SLOW')).toBe(5);
    expect(byName.get('SHORT_FAST')).toBe(6);
    expect(byName.get('LONG_MODERATE')).toBe(7);
  });

  it('keeps deprecated presets selectable but flagged', () => {
    const veryLongSlow = MODEM_PRESET_OPTIONS.find((o) => o.enumName === 'VERY_LONG_SLOW');
    expect(veryLongSlow).toMatchObject({ value: 2, deprecated: true });
  });
});

describe('region wire values', () => {
  // Regression: numeric i18n keys drifted at 13+, labeling LORA_24 (13) as "UA_433".
  it('matches the generated enum for values that used to drift', () => {
    const byName = new Map(REGION_OPTIONS.map((o) => [o.enumName, o.value]));
    expect(byName.get('LORA_24')).toBe(13);
    expect(byName.get('UA_433')).toBe(14);
    expect(byName.get('SG_923')).toBe(18);
    expect(byName.get('EU_866')).toBe(29);
  });
});

describe('device role wire values', () => {
  it('does not label the deprecated REPEATER slot as Client Base', () => {
    const byName = new Map(DEVICE_ROLE_OPTIONS.map((o) => [o.enumName, o]));
    expect(byName.get('REPEATER')).toMatchObject({ value: 4, deprecated: true });
    expect(byName.get('ROUTER_LATE')).toMatchObject({ value: 11 });
    expect(byName.get('CLIENT_BASE')).toMatchObject({ value: 12 });
    expect(radioPanel.deviceRoles.REPEATER.label).toBe('Repeater');
    expect(radioPanel.deviceRoles.CLIENT_BASE.label).toBe('Client Base');
  });
});

describe('protobuf enum drift', () => {
  const NAMESPACES = [
    { key: 'regions', options: REGION_OPTIONS, schema: Config.Config_LoRaConfig_RegionCodeSchema },
    {
      key: 'modemPresets',
      options: MODEM_PRESET_OPTIONS,
      schema: Config.Config_LoRaConfig_ModemPresetSchema,
    },
    {
      key: 'deviceRoles',
      options: DEVICE_ROLE_OPTIONS,
      schema: Config.Config_DeviceConfig_RoleSchema,
    },
    {
      key: 'rebroadcastModes',
      options: REBROADCAST_MODE_OPTIONS,
      schema: Config.Config_DeviceConfig_RebroadcastModeSchema,
    },
    {
      key: 'oledTypes',
      options: OLED_TYPE_OPTIONS,
      schema: Config.Config_DisplayConfig_OledTypeSchema,
    },
    {
      key: 'displayUnits',
      options: DISPLAY_UNIT_OPTIONS,
      schema: Config.Config_DisplayConfig_DisplayUnitsSchema,
    },
  ];

  it.each(NAMESPACES)('$key covers every generated enum value', ({ options, schema }) => {
    expect(options.map((o) => o.value)).toEqual(schema.values.map((v) => v.number));
  });

  it.each(NAMESPACES)('$key has an English label for every enum value', ({ key, options }) => {
    const missing = options
      .filter((option) => typeof radioPanel[key][option.enumName].label !== 'string')
      .map((option) => option.enumName);
    expect(missing).toEqual([]);
  });

  it.each([{ key: 'deviceRoles' }, { key: 'rebroadcastModes' }])(
    '$key has an English description for every enum value',
    ({ key }) => {
      const options = key === 'deviceRoles' ? DEVICE_ROLE_OPTIONS : REBROADCAST_MODE_OPTIONS;
      const missing = options
        .filter((option) => typeof radioPanel[key][option.enumName].description !== 'string')
        .map((option) => option.enumName);
      expect(missing).toEqual([]);
    },
  );

  it('resolves a name for every HardwareModel value', () => {
    const unnamed = (Mesh.HardwareModelSchema as ProtobufEnumDescriptor).values
      .map((value) => [value.name, meshtasticHwModelName(value.number)] as const)
      .filter((entry) => entry[1].startsWith('Unknown ('));
    expect(unnamed).toEqual([]);
  });
});
