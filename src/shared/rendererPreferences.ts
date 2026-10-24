const separatelyOwned =
  /^mesh-client:(?:rendererPreferences$|renderer-origin-migration$|deletedStorage:|durablePending:|incidentPending$|incidents$|lastRead(?:$|:)|roomsLastRead:|mecpBlockedSenders$|takRelayPrefs$|meshcoreIdentityEncPK$|credentialCompatibility:|(?:meshcore-key|meshtastic-dm-key)-backup|key-backup|diagnosticRowsSnapshot$|foreignLoraDetectionsSnapshot$|lastReticulumVacuumMs$)/;

/** Browser preferences, excluding native/secure/domain stores and their control journals. */
export function isRendererPreferenceKey(key: string): boolean {
  return key.startsWith('mesh-client:') && !separatelyOwned.test(key);
}
