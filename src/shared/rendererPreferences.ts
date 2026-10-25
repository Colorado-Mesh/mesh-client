const separatelyOwned =
  /^mesh-client:(?:rendererPreferences$|renderer-origin-migration$|deletedStorage:|durablePending:|incidentPending$|incidents$|lastRead(?:$|:)|roomsLastRead:|mecpBlockedSenders$|takRelayPrefs$|meshcoreIdentityEncPK$|credentialCompatibility:|(?:meshcore-key|meshtastic-dm-key)-backup|key-backup|diagnosticRowsSnapshot$|foreignLoraDetectionsSnapshot$|lastReticulumVacuumMs$)/;

/** Browser preferences, excluding native/secure/domain stores and their control journals. */
export function isRendererPreferenceKey(key: string): boolean {
  return key.startsWith('mesh-client:') && !separatelyOwned.test(key);
}

function parsePreferenceEnvelope(
  raw: string | null | undefined,
): { valueCount: number; resetBaseline: boolean } | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (!('values' in parsed)) return null;
    const values = parsed.values;
    if (values === null || typeof values !== 'object' || Array.isArray(values)) return null;
    return {
      valueCount: Object.keys(values).length,
      resetBaseline: 'resetBaseline' in parsed && parsed.resetBaseline === true,
    };
  } catch {
    // catch-no-log-ok malformed preference envelopes are treated as absent
    return null;
  }
}

/**
 * True when the canonical preference map has recorded at least one value.
 * An empty `values` object (e.g. after `localStorage.clear()` write-through) is not
 * established: origin repair may still restore exported preference keys.
 */
export function hasEstablishedRendererPreferenceValues(raw: string | null | undefined): boolean {
  const envelope = parsePreferenceEnvelope(raw);
  return envelope != null && envelope.valueCount > 0;
}

/**
 * Explicit Clear All Local Data writes an empty map with `resetBaseline: true` so a
 * replayed export cannot REPLACE it. A plain empty map from `localStorage.clear()`
 * write-through remains eligible for origin-repair replacement.
 */
export function isExplicitResetPreferenceBaseline(raw: string | null | undefined): boolean {
  const envelope = parsePreferenceEnvelope(raw);
  return envelope != null && envelope.resetBaseline && envelope.valueCount === 0;
}

/** Empty preference envelope written by `resetDurableRendererData`. */
export function explicitResetPreferenceBaselineJson(): string {
  return JSON.stringify({ legacyAliasesImported: true, values: {}, resetBaseline: true });
}

/** Parsed `values` object from a preference envelope, or null when absent/malformed. */
export function parseRendererPreferenceValues(
  raw: string | null | undefined,
): Record<string, unknown> | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (!('values' in parsed)) return null;
    const values = parsed.values;
    if (values === null || typeof values !== 'object' || Array.isArray(values)) return null;
    return values as Record<string, unknown>;
  } catch {
    // catch-no-log-ok malformed preference envelopes are treated as absent
    return null;
  }
}

/**
 * Gap-fill an existing preference envelope from a repaired/seeded one.
 * Existing values win on conflict so newer SQLite choices beat a replayed export; keys only
 * present in `incoming` (e.g. export markers lost after `localStorage.clear()` write-through)
 * are added. Explicit-reset baselines are never modified.
 */
export function mergeRendererPreferenceEnvelopes(
  existingRaw: string | null | undefined,
  incomingRaw: string,
): string {
  if (isExplicitResetPreferenceBaseline(existingRaw)) {
    return existingRaw ?? incomingRaw;
  }
  const incomingValues = parseRendererPreferenceValues(incomingRaw);
  if (incomingValues == null || Object.keys(incomingValues).length === 0) {
    return existingRaw ?? incomingRaw;
  }
  const existingValues = parseRendererPreferenceValues(existingRaw);
  if (existingValues == null || Object.keys(existingValues).length === 0) {
    return incomingRaw;
  }
  const values = { ...incomingValues, ...existingValues };
  let legacyAliasesImported = true;
  try {
    const parsed: unknown = JSON.parse(incomingRaw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      'legacyAliasesImported' in parsed &&
      typeof parsed.legacyAliasesImported === 'boolean'
    ) {
      legacyAliasesImported = parsed.legacyAliasesImported;
    }
  } catch {
    // catch-no-log-ok keep the default legacyAliasesImported flag when incoming JSON is odd
  }
  return JSON.stringify({ legacyAliasesImported, values });
}
