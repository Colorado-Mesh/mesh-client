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
  meshcoreContactCapCount: 10000,
  meshcoreDeleteNeverAdvertised: true,
  /** Reticulum SQLite destination + in-memory peer cap / age prune (App tab). */
  reticulumAutoPruneEnabled: true,
  reticulumAutoPruneDays: 30,
  reticulumDestinationCapEnabled: true,
  reticulumDestinationCapCount: 10000,
  distanceFilterEnabled: false,
  distanceFilterMax: 500,
  distanceUnit: 'miles' as const,
  coordinateFormat: 'decimal' as const,
  autoFloodAdvertIntervalHours: 12,
  /** MeshCore auto-flood schedule: `flood` (multi-hop) or `zeroHop` (direct neighbors). */
  autoFloodAdvertType: 'flood' as 'flood' | 'zeroHop',
  /** Persisted MeshCore regional flood scope hashtag (empty = none). */
  meshcoreFloodScopeHashtag: '',
  /**
   * User-managed MeshCore flood-scope quick-picks for Radio/Chat.
   * Empty by default; first load may seed from `meshcoreFloodScopeHashtag`.
   */
  meshcoreFloodScopePresets: [] as string[],
  locale: 'en' as string,
  chatCompactMode: false,
  /** When true, disables non-essential UI motion (animated icons, decorative pulses). */
  reduceMotion: false,
  /** Auto-request Store & Forward chat history on RF connect (with cap/cooldown). */
  storeForwardAutoFetchHistory: true,
  /**
   * Store & Forward auto-history aggressiveness.
   * - conservative: longer offline gate / cooldown (default; busy-mesh friendly)
   * - aggressive: shorter gates / higher cap for spotty coverage catch-up
   */
  storeForwardHistoryProfile: 'conservative' as 'conservative' | 'aggressive',
  /** When sharing location in chat, also send a Meshtastic Waypoint packet (map pin). */
  shareLocationSendWaypoint: true,
  /** MeshCore Open wire: keyed replies, r: reactions, g: GIF send (experimental). */
  meshcoreOpenWireCompatEnabled: false,
  /** MeshCore companion path hash mode: 0 = 1-byte, 1 = 2-byte, 2 = 3-byte (firmware v1.14+). */
  meshcorePathHashMode: 0 as 0 | 1 | 2,
  /** Start Reticulum sidecar automatically when opening the Reticulum tab. */
  reticulumAutostart: false,
};
