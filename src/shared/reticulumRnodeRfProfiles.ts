import profilesJson from './reticulumRnodeRfProfiles.json';

export type ReticulumRnodeRfProfileTier = 'coordinated' | 'fallback' | 'legacy';

export interface ReticulumRnodeRfProfile {
  id: string;
  tier: ReticulumRnodeRfProfileTier;
  label: string;
  region: string;
  frequency: number;
  bandwidth: number;
  spreading_factor: number;
  coding_rate: number;
  notes?: string;
  /** When set, legacy id should migrate to this canonical preset. */
  canonical_id?: string;
}

export interface ReticulumRnodeRfParams {
  frequency?: number | null;
  bandwidth?: number | null;
  spreading_factor?: number | null;
  coding_rate?: number | null;
}

export interface ReticulumRnodeRfProfileMatch {
  profile: ReticulumRnodeRfProfile;
  tier: ReticulumRnodeRfProfileTier;
}

const PROFILES: ReticulumRnodeRfProfile[] = (
  profilesJson as { profiles: ReticulumRnodeRfProfile[] }
).profiles;

const PROFILE_BY_ID = new Map(PROFILES.map((p) => [p.id, p]));

/** All known RNode RF profiles (coordinated, fallback, legacy). */
export function listReticulumRnodeRfProfiles(): readonly ReticulumRnodeRfProfile[] {
  return PROFILES;
}

export function getReticulumRnodeRfProfile(id: string): ReticulumRnodeRfProfile | undefined {
  return PROFILE_BY_ID.get(id);
}

export function reticulumRnodeProfilesByTier(
  tier: ReticulumRnodeRfProfileTier,
): ReticulumRnodeRfProfile[] {
  return PROFILES.filter((p) => p.tier === tier);
}

export function reticulumRnodeProfilesForRegion(regionId: string): ReticulumRnodeRfProfile[] {
  return PROFILES.filter((p) => p.tier === 'coordinated' && p.region === regionId);
}

function paramsEqual(a: ReticulumRnodeRfParams, profile: ReticulumRnodeRfProfile): boolean {
  return (
    a.frequency === profile.frequency &&
    a.bandwidth === profile.bandwidth &&
    a.spreading_factor === profile.spreading_factor &&
    (a.coding_rate ?? 5) === profile.coding_rate
  );
}

/** Match live/config params to a known profile, or null if custom. */
export function reticulumRnodeParamsMatchProfile(
  params: ReticulumRnodeRfParams,
): ReticulumRnodeRfProfileMatch | null {
  if (params.frequency == null || params.bandwidth == null || params.spreading_factor == null) {
    return null;
  }
  for (const profile of PROFILES) {
    if (paramsEqual(params, profile)) {
      return { profile, tier: profile.tier };
    }
  }
  return null;
}

/** Resolve legacy alias to canonical profile id when defined. */
export function resolveReticulumRnodeCanonicalPresetId(presetId: string): string {
  const profile = PROFILE_BY_ID.get(presetId);
  return profile?.canonical_id ?? presetId;
}

/** Apply preset defaults onto partial RF params (renderer + repair helpers). */
export function applyReticulumRnodePresetDefaults(
  presetId: string,
  params: ReticulumRnodeRfParams,
): ReticulumRnodeRfParams {
  const profile = PROFILE_BY_ID.get(presetId);
  if (!profile) {
    return params;
  }
  return {
    frequency: params.frequency ?? profile.frequency,
    bandwidth: params.bandwidth ?? profile.bandwidth,
    spreading_factor: params.spreading_factor ?? profile.spreading_factor,
    coding_rate: params.coding_rate ?? profile.coding_rate,
  };
}

/** Overwrite RF params from preset (edit/repair when preset changes or params deviate). */
export function forceApplyReticulumRnodePresetDefaults(
  presetId: string,
): (Required<ReticulumRnodeRfParams> & { txpower: number }) | null {
  const profile = PROFILE_BY_ID.get(presetId);
  if (!profile) {
    return null;
  }
  return {
    frequency: profile.frequency,
    bandwidth: profile.bandwidth,
    spreading_factor: profile.spreading_factor,
    coding_rate: profile.coding_rate,
    txpower: 17,
  };
}

/** Preset ids recognized for RNode INI expansion / repair. */
export const RETICULUM_RNODE_KNOWN_PRESET_IDS: readonly string[] = PROFILES.map((p) => p.id);
