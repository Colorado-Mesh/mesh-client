const separatelyOwned =
  /^mesh-client:(?:rendererPreferences$|renderer-origin-migration$|deletedStorage:|durablePending:|incidentPending$|incidents$|lastRead(?:$|:)|roomsLastRead:|mecpBlockedSenders$|takRelayPrefs$|meshcoreIdentityEncPK$|credentialCompatibility:|(?:meshcore-key|meshtastic-dm-key)-backup|key-backup|diagnosticRowsSnapshot$|foreignLoraDetectionsSnapshot$|lastReticulumVacuumMs$)/;

/** Nested fields that must never be copied into the canonical preference recovery map. */
const preferenceCredentialField =
  /^(?:password|channelPsks|private_key|meshcore(?:Room|Repeater)Credential:.*)$/;

/** Preference keys whose values are structured records that may embed those fields. */
const preferenceCredentialBearingKey =
  /^mesh-client:(?:appSettings|adminSettings|mqttSettings(?::meshcore)?|mqttProfiles:meshtastic|meshcoreIdentity)$/;

function isPreferenceRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Browser preferences, excluding native/secure/domain stores and their control journals. */
export function isRendererPreferenceKey(key: string): boolean {
  return key.startsWith('mesh-client:') && !separatelyOwned.test(key);
}

/** Strip inline credential fields while retaining public nested preference data. */
export function withoutRendererPreferenceSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRendererPreferenceSecrets);
  if (!isPreferenceRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !preferenceCredentialField.test(key))
      .map(([key, child]) => [key, withoutRendererPreferenceSecrets(child)]),
  );
}

export function rendererPreferenceHasInlineCredentials(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(rendererPreferenceHasInlineCredentials);
  return (
    isPreferenceRecord(value) &&
    Object.entries(value).some(
      ([key, child]) =>
        preferenceCredentialField.test(key) || rendererPreferenceHasInlineCredentials(child),
    )
  );
}

/**
 * Public preference snapshot value for the recovery map, or null when a credential-bearing
 * key is missing/unusable. Never returns inline credential fields.
 */
export function sanitizeRendererPreferenceValue(key: string, raw: string): string | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (preferenceCredentialBearingKey.test(key)) {
      const valid =
        key === 'mesh-client:mqttProfiles:meshtastic'
          ? Array.isArray(value) && value.every(isPreferenceRecord)
          : isPreferenceRecord(value);
      if (!valid) return null;
    }
    return JSON.stringify(withoutRendererPreferenceSecrets(value));
  } catch {
    // catch-no-log-ok plain strings (names, addresses, theme colours) are valid preferences
    return preferenceCredentialBearingKey.test(key) ? null : raw;
  }
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
