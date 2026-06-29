/**
 * Canonical defaults for keys stored in localStorage `mesh-client:appSettings`.
 * Used by AppPanel and App startup pruning so behavior matches when keys are absent.
 */
export const DEFAULT_APP_SETTINGS_SHARED = {
  autoPruneEnabled: true,
  autoPruneDays: 30,
  pruneEmptyNamesEnabled: true,
  nodeCapEnabled: true,
  nodeCapCount: 10000,
  positionHistoryPruneEnabled: true,
  positionHistoryPruneDays: 30,
  meshcoreAutoPruneEnabled: true,
  meshcoreAutoPruneDays: 30,
  meshcoreContactCapEnabled: true,
  meshcoreContactCapCount: 5000,
  meshcoreDeleteNeverAdvertised: true,
  distanceFilterEnabled: false,
  distanceFilterMax: 500,
  distanceUnit: 'miles' as const,
  coordinateFormat: 'decimal' as const,
  autoFloodAdvertIntervalHours: 12,
  /** MeshCore auto-flood schedule: `flood` (multi-hop) or `zeroHop` (direct neighbors). */
  autoFloodAdvertType: 'flood' as 'flood' | 'zeroHop',
  /** Persisted MeshCore regional flood scope hashtag (empty = none). */
  meshcoreFloodScopeHashtag: '',
  locale: 'en' as string,
  chatCompactMode: false,
  /** When true, disables non-essential UI motion (animated icons, decorative pulses). */
  reduceMotion: false,
  /** Auto-request Store & Forward chat history on RF connect (with cap/cooldown). */
  storeForwardAutoFetchHistory: true,
  /** MeshCore Open wire: keyed replies, r: reactions, g: GIF send (experimental). */
  meshcoreOpenWireCompatEnabled: false,
  /** MeshCore companion path hash mode: 0 = 1-byte, 1 = 2-byte, 2 = 3-byte (firmware v1.14+). */
  meshcorePathHashMode: 0 as 0 | 1 | 2,
};
