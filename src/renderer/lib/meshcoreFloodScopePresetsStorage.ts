/**
 * Persist user-managed MeshCore flood-scope quick-picks in app settings.
 *
 * Empty by default for new installs. On first read, seeds from the existing
 * radio-wide `meshcoreFloodScopeHashtag` when present so international users
 * keep their configured region without Colorado-specific hardcodes.
 */

import { getAppSettingsRaw, mergeAppSetting } from './appSettingsStorage';
import { normalizeMeshcoreFloodScopeHashtag } from './meshcoreFloodScope';
import { parseStoredJson } from './parseStoredJson';

export const MESHCORE_FLOOD_SCOPE_PRESETS_MAX = 20;

export const MESHCORE_FLOOD_SCOPE_PRESETS_SETTING_KEY = 'meshcoreFloodScopePresets';

/** True when the hashtag is non-empty after normalization (not '' or '#'). */
export function isValidMeshcoreFloodScopeHashtag(input: string): boolean {
  const normalized = normalizeMeshcoreFloodScopeHashtag(input);
  return normalized.length > 1;
}

/**
 * Normalize, drop invalids, dedupe (exact match, case-preserving), and cap.
 * First occurrence wins so order is stable.
 */
export function sanitizeMeshcoreFloodScopePresets(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const normalized = normalizeMeshcoreFloodScopeHashtag(entry);
    if (!isValidMeshcoreFloodScopeHashtag(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= MESHCORE_FLOOD_SCOPE_PRESETS_MAX) break;
  }
  return out;
}

function readAppSettingsRecord(parseContext: string): Record<string, unknown> {
  return parseStoredJson<Record<string, unknown>>(getAppSettingsRaw(), parseContext) ?? {};
}

/**
 * Load saved quick-picks. When the presets key is absent, seed once from
 * `meshcoreFloodScopeHashtag` (if valid) and persist the result.
 */
export function loadMeshcoreFloodScopePresets(): string[] {
  const settings = readAppSettingsRecord('loadMeshcoreFloodScopePresets');
  if (Object.hasOwn(settings, MESHCORE_FLOOD_SCOPE_PRESETS_SETTING_KEY)) {
    return sanitizeMeshcoreFloodScopePresets(settings[MESHCORE_FLOOD_SCOPE_PRESETS_SETTING_KEY]);
  }

  const seedRaw =
    typeof settings.meshcoreFloodScopeHashtag === 'string'
      ? settings.meshcoreFloodScopeHashtag
      : '';
  const seeded = sanitizeMeshcoreFloodScopePresets(seedRaw ? [seedRaw] : []);
  // Persist empty or seeded list so subsequent loads skip re-seeding.
  mergeAppSetting(
    MESHCORE_FLOOD_SCOPE_PRESETS_SETTING_KEY,
    seeded,
    'loadMeshcoreFloodScopePresets seed',
  );
  return seeded;
}

/** Persist a sanitized list (replaces the stored array). */
export function saveMeshcoreFloodScopePresets(presets: string[]): string[] {
  const sanitized = sanitizeMeshcoreFloodScopePresets(presets);
  mergeAppSetting(
    MESHCORE_FLOOD_SCOPE_PRESETS_SETTING_KEY,
    sanitized,
    'saveMeshcoreFloodScopePresets',
  );
  return sanitized;
}

/**
 * Prepend a hashtag (move to front if already present). Returns the new list.
 * No-op (returns current list) when the hashtag is invalid.
 */
export function rememberMeshcoreFloodScopePreset(
  current: readonly string[],
  hashtag: string,
): string[] {
  const normalized = normalizeMeshcoreFloodScopeHashtag(hashtag);
  if (!isValidMeshcoreFloodScopeHashtag(normalized)) {
    return sanitizeMeshcoreFloodScopePresets(current);
  }
  const without = current.filter((tag) => tag !== normalized);
  return saveMeshcoreFloodScopePresets([normalized, ...without]);
}

/** Remove a hashtag from the list. Returns the new list. */
export function removeMeshcoreFloodScopePreset(
  current: readonly string[],
  hashtag: string,
): string[] {
  const normalized = normalizeMeshcoreFloodScopeHashtag(hashtag);
  if (!normalized) {
    return sanitizeMeshcoreFloodScopePresets(current);
  }
  return saveMeshcoreFloodScopePresets(current.filter((tag) => tag !== normalized));
}
