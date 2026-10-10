import type { MeshProtocol } from '@/shared/meshProtocol';

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
  translationEnabled: false,
  translationReadLanguages: ['en'] as string[],
  translationTargetLanguage: 'en' as string,
  translationAutoEnabled: false,
  translationLibreEnabled: false,
  translationLibreUrl: '',
  chatCompactMode: false,
  /** Leave weather-bot posts out of channel views (they stay in the Weather view). */
  weatherFilterHideInChannels: false,
  /** Extra case-insensitive regex for weather posts (empty = defaults only). */
  weatherFilterPattern: '',
  /** Look up forecast places missing from the offline gazetteer via Open-Meteo (sends the place name). */
  weatherOnlinePlaceLookup: false,
  /** When true, chat/room message action bars (copy/reply/react/etc.) stay visible instead of hover-only. */
  alwaysShowMessageActions: false,
  /** When true, disables non-essential UI motion (animated icons, decorative pulses). */
  reduceMotion: false,
  /** When true, force wall-clock timestamps (chat, charts, etc.) to 24-hour format. */
  use24HourTime: false,
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
  /**
   * When false, mesh-client skips host GPS lookups and blocks all app-initiated location
   * transmission (Meshtastic, MeshCore). Static coords remain for local map only.
   */
  shareMyLocation: true,
  /** MeshCore Open wire: keyed replies, r: reactions, g: GIF send (experimental). */
  meshcoreOpenWireCompatEnabled: false,
  /** MeshCore companion path hash mode: 0 = 1-byte, 1 = 2-byte, 2 = 3-byte (firmware v1.14+). */
  meshcorePathHashMode: 0 as 0 | 1 | 2,
  /** When true, show the Chat MECP compose button (default off). */
  mecpComposeEnabled: false,
  /** Node silence alert threshold; null = use protocol capability defaults. */
  nodeSilenceAlertMinutes: null as number | null,
  /** Battery percent at or below which a watched node raises a low-battery alert. */
  nodeBatteryLowThreshold: 10,
  /** Alert when an RF link drops unexpectedly (not manual, not mid-reconnect). */
  notifyOnLinkDown: true,
  /**
   * Incident Command station mode: standing banner + window attention for unseen MAYDAY/URGENT
   * (default off; the one-shot siren/toast fires regardless).
   */
  mecpStandingAlertEnabled: false,
  /** Replay the MAYDAY/URGENT tone every N minutes while one is unseen; null = off. */
  mecpRepeatAlertMinutes: null as number | null,
  /**
   * Protocols the user does not use: hidden from the switcher and skipped by autostart.
   * Stored as a hidden list so newly registered protocols default to enabled.
   */
  hiddenProtocols: [] as MeshProtocol[],
};
