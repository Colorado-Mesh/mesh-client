import { describe, expect, it } from 'vitest';

import {
  filterMeshtasticPresetsForRegion,
  meshtasticPresetAfterRegionChange,
  meshtasticRegionPresetRule,
  parseMeshtasticRegionPresetMap,
} from './meshtasticRegionPresets';

const US = 1;
const EU_868 = 3;
const ITU2_2M = 28;
const UNLISTED = 26;

const map = {
  groups: [
    { presets: [0, 3, 4, 5, 6, 7, 8, 9], defaultPreset: 0, licensedOnly: false },
    { presets: [12, 13], defaultPreset: 13, licensedOnly: false },
    { presets: [14, 15], defaultPreset: 14, licensedOnly: true },
  ],
  regionGroups: [
    { region: US, groupIndex: 0 },
    { region: EU_868, groupIndex: 1 },
    { region: ITU2_2M, groupIndex: 2 },
    { region: 99, groupIndex: 7 },
  ],
};

const options = [0, 3, 9, 12, 13, 14, 15].map((value) => ({ value, label: `P${value}` }));

describe('parseMeshtasticRegionPresetMap', () => {
  it('returns null when the map is absent or malformed', () => {
    expect(parseMeshtasticRegionPresetMap(undefined)).toBeNull();
    expect(parseMeshtasticRegionPresetMap({})).toBeNull();
    expect(parseMeshtasticRegionPresetMap({ groups: [], regionGroups: [] })).toBeNull();
  });

  it('maps regions to their preset group and skips dangling group indexes', () => {
    const rules = parseMeshtasticRegionPresetMap(map);
    expect(rules?.size).toBe(3);
    expect(meshtasticRegionPresetRule(rules, 99)).toBeNull();
    const eu = meshtasticRegionPresetRule(rules, EU_868);
    expect([...eu!.allowedPresets]).toEqual([12, 13]);
    expect(eu!.defaultPreset).toBe(13);
    expect(meshtasticRegionPresetRule(rules, ITU2_2M)?.licensedOnly).toBe(true);
  });
});

describe('filterMeshtasticPresetsForRegion', () => {
  const rules = parseMeshtasticRegionPresetMap(map);

  it('does not restrict when the map is missing', () => {
    expect(filterMeshtasticPresetsForRegion(options, null, 0)).toHaveLength(options.length);
  });

  it('does not restrict a region absent from the map', () => {
    const rule = meshtasticRegionPresetRule(rules, UNLISTED);
    expect(filterMeshtasticPresetsForRegion(options, rule, 0)).toHaveLength(options.length);
  });

  it('limits a restricted region and keeps the current preset visible', () => {
    const rule = meshtasticRegionPresetRule(rules, EU_868);
    expect(filterMeshtasticPresetsForRegion(options, rule, 13).map((o) => o.value)).toEqual([
      12, 13,
    ]);
    expect(filterMeshtasticPresetsForRegion(options, rule, 0).map((o) => o.value)).toEqual([
      0, 12, 13,
    ]);
  });
});

describe('meshtasticPresetAfterRegionChange', () => {
  const rules = parseMeshtasticRegionPresetMap(map);

  it('keeps a still-legal preset and switches an illegal one to the region default', () => {
    expect(meshtasticPresetAfterRegionChange(meshtasticRegionPresetRule(rules, US), 9)).toBeNull();
    expect(meshtasticPresetAfterRegionChange(meshtasticRegionPresetRule(rules, ITU2_2M), 0)).toBe(
      14,
    );
    expect(meshtasticPresetAfterRegionChange(null, 0)).toBeNull();
  });
});
