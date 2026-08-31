/**
 * Option lists derived from the generated `@meshtastic/protobufs` enum descriptors.
 *
 * Hardcoding these tables meant a protobufs bump silently left the UI behind (and, for
 * modem presets, mapped the wrong wire value to a label). Deriving them keeps regions,
 * presets, roles, rebroadcast modes and OLED types in step with the vendored schema.
 */
import { Config } from '@meshtastic/protobufs';

/** Minimal shape of a protobuf-es `GenEnum` descriptor; avoids depending on codegen internals. */
export interface ProtobufEnumDescriptor {
  readonly values: readonly {
    readonly name: string;
    readonly number: number;
    readonly deprecated: boolean;
  }[];
}

export interface ProtobufEnumOption {
  /** Wire value written to the radio. */
  value: number;
  /** Proto enum name (e.g. `EU_868`), used as the i18n key segment. */
  enumName: string;
  /** True when the proto marks the value `[deprecated = true]`. */
  deprecated: boolean;
}

/**
 * Enum values in declaration order. Deprecated values are kept so a radio already set to
 * one still shows its own setting; callers mark them in the label.
 */
export function protobufEnumOptions(descriptor: ProtobufEnumDescriptor): ProtobufEnumOption[] {
  return descriptor.values.map((value) => ({
    value: value.number,
    enumName: value.name,
    deprecated: value.deprecated,
  }));
}

export const REGION_OPTIONS: ProtobufEnumOption[] = protobufEnumOptions(
  Config.Config_LoRaConfig_RegionCodeSchema,
);

export const MODEM_PRESET_OPTIONS: ProtobufEnumOption[] = protobufEnumOptions(
  Config.Config_LoRaConfig_ModemPresetSchema,
);

export const DEVICE_ROLE_OPTIONS: ProtobufEnumOption[] = protobufEnumOptions(
  Config.Config_DeviceConfig_RoleSchema,
);

export const REBROADCAST_MODE_OPTIONS: ProtobufEnumOption[] = protobufEnumOptions(
  Config.Config_DeviceConfig_RebroadcastModeSchema,
);

export const OLED_TYPE_OPTIONS: ProtobufEnumOption[] = protobufEnumOptions(
  Config.Config_DisplayConfig_OledTypeSchema,
);

export const DISPLAY_UNIT_OPTIONS: ProtobufEnumOption[] = protobufEnumOptions(
  Config.Config_DisplayConfig_DisplayUnitsSchema,
);

/**
 * Title-cases a proto enum name for display when no curated label exists
 * (`SEEED_WIO_TRACKER_L1` -> `Seeed Wio Tracker L1`). Keeps digits attached to their word.
 */
export function humanizeEnumName(enumName: string): string {
  return enumName
    .toLowerCase()
    .split('_')
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
