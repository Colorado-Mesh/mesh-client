import { humanizeEnumName, MODEM_PRESET_OPTIONS, REGION_OPTIONS } from './protobufEnumOptions';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Display label for a `Config.LoRaConfig.RegionCode` wire value. */
export function meshtasticRegionLabel(value: number, t: Translate): string {
  const option = REGION_OPTIONS.find((o) => o.value === value);
  if (!option) return String(value);
  return (
    t(`radioPanel.regions.${option.enumName}.label`, { defaultValue: '' }) ||
    humanizeEnumName(option.enumName)
  );
}

/** Display label for a `Config.LoRaConfig.ModemPreset` wire value. */
export function meshtasticModemPresetLabel(value: number, t: Translate): string {
  const option = MODEM_PRESET_OPTIONS.find((o) => o.value === value);
  if (!option) return String(value);
  return (
    t(`radioPanel.modemPresets.${option.enumName}.label`, { defaultValue: '' }) ||
    humanizeEnumName(option.enumName)
  );
}

export function meshtasticRegionSelectOptions(t: Translate): { value: number; label: string }[] {
  return REGION_OPTIONS.map((o) => ({ value: o.value, label: meshtasticRegionLabel(o.value, t) }));
}

export function meshtasticModemPresetSelectOptions(
  t: Translate,
): { value: number; label: string }[] {
  return MODEM_PRESET_OPTIONS.map((o) => ({
    value: o.value,
    label: meshtasticModemPresetLabel(o.value, t),
  }));
}
