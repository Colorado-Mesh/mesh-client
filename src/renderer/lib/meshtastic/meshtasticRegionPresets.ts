/**
 * Firmware 2.8+ sends `FromRadio.region_presets` (`LoRaRegionPresetMap`) during want_config:
 * which modem presets are legal per region, the region default, and whether the band is
 * licensed-only (amateur). Regions missing from the map, or a missing map, are unrestricted.
 */

/** Key under `DeviceRecord.meshtasticConfigSlices` where the decoded map is stored. */
export const MESHTASTIC_REGION_PRESETS_SLICE_KEY = 'regionPresets';

export interface MeshtasticRegionPresetRule {
  allowedPresets: ReadonlySet<number>;
  defaultPreset: number;
  licensedOnly: boolean;
}

export type MeshtasticRegionPresetRules = ReadonlyMap<number, MeshtasticRegionPresetRule>;

function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function asInt(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null;
}

/** Decode a `LoRaRegionPresetMap` (bufbuild camelCase shape). Returns null when unusable. */
export function parseMeshtasticRegionPresetMap(raw: unknown): MeshtasticRegionPresetRules | null {
  const rec = asRecord(raw);
  if (!rec || !Array.isArray(rec.groups) || !Array.isArray(rec.regionGroups)) return null;

  const groups: (MeshtasticRegionPresetRule | null)[] = rec.groups.map((g) => {
    const group = asRecord(g);
    if (!group || !Array.isArray(group.presets)) return null;
    const presets = group.presets.map(asInt).filter((p): p is number => p !== null);
    if (presets.length === 0) return null;
    const defaultPreset = asInt(group.defaultPreset) ?? presets[0];
    return {
      allowedPresets: new Set(presets),
      defaultPreset,
      licensedOnly: group.licensedOnly === true,
    };
  });

  const rules = new Map<number, MeshtasticRegionPresetRule>();
  for (const rg of rec.regionGroups) {
    const entry = asRecord(rg);
    const region = asInt(entry?.region);
    const groupIndex = asInt(entry?.groupIndex);
    if (region === null || groupIndex === null) continue;
    const group = groups[groupIndex];
    if (group) rules.set(region, group);
  }
  return rules.size > 0 ? rules : null;
}

export function meshtasticRegionPresetRule(
  rules: MeshtasticRegionPresetRules | null,
  region: number,
): MeshtasticRegionPresetRule | null {
  return rules?.get(region) ?? null;
}

/** Presets offered for a region; keeps `currentPreset` visible even if the map disallows it. */
export function filterMeshtasticPresetsForRegion<T extends { value: number }>(
  options: readonly T[],
  rule: MeshtasticRegionPresetRule | null,
  currentPreset: number,
): T[] {
  if (!rule) return [...options];
  return options.filter((o) => rule.allowedPresets.has(o.value) || o.value === currentPreset);
}

/** Preset to switch to when the region changes; null when the current preset stays legal. */
export function meshtasticPresetAfterRegionChange(
  rule: MeshtasticRegionPresetRule | null,
  currentPreset: number,
): number | null {
  if (!rule || rule.allowedPresets.has(currentPreset)) return null;
  return rule.defaultPreset;
}
