const separatelyOwned =
  /^mesh-client:(?:rendererPreferences$|renderer-origin-migration$|deletedStorage:|durablePending:|incidentPending$|incidents$|lastRead(?:$|:)|roomsLastRead:|mecpBlockedSenders$|takRelayPrefs$|meshcoreIdentityEncPK$|credentialCompatibility:|(?:meshcore-key|meshtastic-dm-key)-backup|key-backup|diagnosticRowsSnapshot$|foreignLoraDetectionsSnapshot$|lastReticulumVacuumMs$)/;

/** Browser preferences, excluding native/secure/domain stores and their control journals. */
export function isRendererPreferenceKey(key: string): boolean {
  return key.startsWith('mesh-client:') && !separatelyOwned.test(key);
}

/**
 * True when the canonical preference map has recorded at least one value.
 * An empty `values` object (e.g. after `localStorage.clear()` write-through) is not
 * established: origin repair may still restore exported preference keys.
 */
export function hasEstablishedRendererPreferenceValues(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    if (!('values' in parsed)) return false;
    const values = parsed.values;
    return (
      values !== null &&
      typeof values === 'object' &&
      !Array.isArray(values) &&
      Object.keys(values).length > 0
    );
  } catch {
    // catch-no-log-ok malformed preference envelopes are treated as not established
    return false;
  }
}
