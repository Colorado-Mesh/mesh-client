import { describe, expect, it } from 'vitest';

import {
  applyReticulumRnodePresetDefaults,
  forceApplyReticulumRnodePresetDefaults,
  getReticulumRnodeRfProfile,
  resolveReticulumRnodeCanonicalPresetId,
  reticulumRnodeParamsMatchProfile,
  reticulumRnodeProfilesByTier,
} from './reticulumRnodeRfProfiles';

describe('reticulumRnodeRfProfiles', () => {
  it('US coordinated is 914.875 MHz SF8', () => {
    const us = getReticulumRnodeRfProfile('rnode_us');
    expect(us?.frequency).toBe(914_875_000);
    expect(us?.bandwidth).toBe(125_000);
    expect(us?.spreading_factor).toBe(8);
  });

  it('legacy rnode_us915 aliases US coordinated frequency', () => {
    const legacy = getReticulumRnodeRfProfile('rnode_us915');
    expect(legacy?.frequency).toBe(914_875_000);
    expect(resolveReticulumRnodeCanonicalPresetId('rnode_us915')).toBe('rnode_us');
  });

  it('legacy rnode_eu868 uses 867.2 MHz fallback', () => {
    const eu = getReticulumRnodeRfProfile('rnode_eu868');
    expect(eu?.frequency).toBe(867_200_000);
    expect(resolveReticulumRnodeCanonicalPresetId('rnode_eu868')).toBe('rnode_eu_fallback');
  });

  it('includes global fallback profiles', () => {
    const fallbacks = reticulumRnodeProfilesByTier('fallback');
    expect(fallbacks.map((p) => p.id).sort()).toEqual(
      ['rnode_2g4_fallback', 'rnode_eu_fallback', 'rnode_eu_high_fallback'].sort(),
    );
    expect(getReticulumRnodeRfProfile('rnode_2g4_fallback')?.frequency).toBe(2_427_000_000);
  });

  it('matches params to profile', () => {
    const match = reticulumRnodeParamsMatchProfile({
      frequency: 914_875_000,
      bandwidth: 125_000,
      spreading_factor: 8,
      coding_rate: 5,
    });
    expect(match?.profile.id).toBe('rnode_us');
    expect(match?.tier).toBe('coordinated');
  });

  it('applyReticulumRnodePresetDefaults fills US fields', () => {
    const out = applyReticulumRnodePresetDefaults('rnode_us', {});
    expect(out.frequency).toBe(914_875_000);
    expect(out.spreading_factor).toBe(8);
  });

  it('forceApplyReticulumRnodePresetDefaults overwrites partial params', () => {
    const out = forceApplyReticulumRnodePresetDefaults('rnode_us915');
    expect(out?.frequency).toBe(914_875_000);
    expect(out?.txpower).toBe(17);
    expect(forceApplyReticulumRnodePresetDefaults('unknown_preset')).toBeNull();
  });
});
