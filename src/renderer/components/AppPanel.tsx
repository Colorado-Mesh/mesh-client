/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MecpRebroadcastSettings } from '@/renderer/components/mecp/MecpRebroadcastSettings';
import { copyDebugSnapshotToClipboard } from '@/renderer/lib/debugSnapshot';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { exportSupportBundleToDisk } from '@/renderer/lib/exportSupportBundle';
import type { MessageClearRefreshOptions } from '@/renderer/lib/hydrateIdentityStoresFromDb';
import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';
import { parseDatabaseSchemaTooNewFromMessage } from '@/shared/databaseSchemaTooNew';
import type { SupportBundleMode } from '@/shared/support-bundle.types';

import type { LocationFilter } from '../App';
import {
  getAppSettingsRaw,
  mergeAppSetting,
  mergeAppSettingsPartial,
} from '../lib/appSettingsStorage';
import { formatCoordPair } from '../lib/coordUtils';
import { DEFAULT_APP_SETTINGS_SHARED } from '../lib/defaultAppSettings';
import { enabledProtocolsFrom, sanitizeHiddenProtocols } from '../lib/enabledProtocols';
import {
  applyFontScale,
  clampFontScale,
  DEFAULT_FONT_SCALE,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  loadFontScale,
  persistFontScale,
  resetFontScale,
} from '../lib/fontScale';
import type { OurPosition } from '../lib/gpsSource';
import { getIdentityIdForProtocol } from '../lib/identityByProtocol';
import { appPanelSettingsPersistPayload } from '../lib/meshcorePathHashMode';
import {
  DEFAULT_MESSAGE_RETENTION,
  MESSAGE_RETENTION_KEYS,
  MESSAGE_RETENTION_MAX_COUNT,
  MESSAGE_RETENTION_MIN_COUNT,
  type MessageRetentionSettings,
  parseMessageRetention,
} from '../lib/messageRetention';
import { getNodeStatus, haversineDistanceKm } from '../lib/nodeStatus';
import { parseStoredJson } from '../lib/parseStoredJson';
import { PROTOCOL_THEME } from '../lib/protocolTheme';
import { useRadioProvider } from '../lib/radio/providerFactory';
import { writeReduceMotion } from '../lib/reduceMotionPreference';
import { getActiveSavedLocation, useSavedLocations } from '../lib/savedLocations';
import { nodeRecordsToMeshNodeMap } from '../lib/storeRecordAdapters';
import {
  applyThemeColors,
  DEFAULT_THEME_COLORS,
  hasThemeSnapshot,
  isMessageActionsBarBgVisible,
  loadThemeColors,
  persistThemeColors,
  resetThemeColors,
  restoreThemeSnapshot,
  saveThemeSnapshot,
  setMessageActionsBarBgVisible,
  THEME_COLOR_PRESETS,
  THEME_TOKEN_META,
  type ThemeColorKey,
} from '../lib/themeColors';
import {
  accentThemeColors,
  applyThemeSurface,
  DEFAULT_THEME_SURFACE_ID,
  loadThemeSurfaceId,
  persistThemeSurfaceId,
  surfaceThemeColors,
  type ThemeAccent,
  type ThemeSurface,
  type ThemeSurfaceId,
} from '../lib/themePresets';
import { type MeshNode, type MeshProtocol, REGISTERED_MESH_PROTOCOLS } from '../lib/types';
import { useCoordFormatStore } from '../stores/coordFormatStore';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { useNodeStore } from '../stores/nodeStore';
import { usePositionHistoryStore } from '../stores/positionHistoryStore';
import { useReticulumPeerStore } from '../stores/reticulumPeerStore';
import { useTimeFormatStore } from '../stores/timeFormatStore';
import { ConfirmModal } from './ConfirmModal';
import { HelpTooltip } from './HelpTooltip';
import NotificationSoundSettings from './NotificationSoundSettings';
import SavedLocationsSection from './SavedLocationsSection';
import { ThemePicker } from './ThemePicker';
import { useToast } from './Toast';
import { buttonClassName, DANGER_ROW_CLASS } from './ui/Button';
import { INPUT_BOX_CLASS, SELECT_BOX_CLASS } from './ui/formClasses';

/** Sentinel for "clear all channels" so MeshCore DM (`channel_idx === -1`) does not collide with "All". */
const CLEAR_ALL_CHANNELS_VALUE = -999_999;

type DangerActionId =
  | 'resetDiagnostics'
  | 'clearGpsData'
  | 'clearPositionHistory'
  | 'deleteOldNodes'
  | 'pruneMqttOnlyNodes'
  | 'pruneUnnamedNodes'
  | 'pruneNoFixNodes'
  | 'pruneDistantNodes'
  | 'pruneOfflineNodes'
  | 'clearNodes'
  | 'deleteContactsNoPubkeys'
  | 'clearReticulumContacts'
  | 'clearMessages'
  | 'clearAllRepeaters'
  | 'clearAllData';

const NODE_PRUNE_ACTIONS: DangerActionId[] = [
  'deleteOldNodes',
  'pruneMqttOnlyNodes',
  'pruneUnnamedNodes',
  'pruneNoFixNodes',
  'pruneDistantNodes',
  'pruneOfflineNodes',
  'clearNodes',
  'clearAllData',
  'clearGpsData',
];

const MESSAGE_PRUNE_ACTIONS: DangerActionId[] = ['clearMessages', 'clearAllData'];

function readNodesMapForProtocol(protocol: MeshProtocol): Map<number, MeshNode> {
  const identityId = getIdentityIdForProtocol(protocol);
  if (!identityId) return new Map();
  const byId = useNodeStore.getState().nodes[identityId] ?? {};
  return nodeRecordsToMeshNodeMap(Object.values(byId));
}

function gpsIntervalLabel(t: (key: string) => string, secs: number): string {
  switch (secs) {
    case 0:
      return t('appPanel.gpsIntervalManual');
    case 900:
      return t('appPanel.gpsInterval15min');
    case 1800:
      return t('appPanel.gpsInterval30min');
    case 3600:
      return t('appPanel.gpsIntervalHour');
    case 7200:
      return t('appPanel.gpsInterval2hours');
    default:
      return String(secs);
  }
}

// ─── App settings (persisted) ────────────────────────────────────
interface AppSettings {
  autoPruneEnabled: boolean;
  autoPruneDays: number;
  pruneEmptyNamesEnabled: boolean;
  nodeCapEnabled: boolean;
  nodeCapCount: number;
  positionHistoryPruneEnabled: boolean;
  positionHistoryPruneDays: number;
  meshcoreAutoPruneEnabled: boolean;
  meshcoreAutoPruneDays: number;
  meshcoreContactCapEnabled: boolean;
  meshcoreContactCapCount: number;
  meshcoreDeleteNeverAdvertised: boolean;
  reticulumAutoPruneEnabled: boolean;
  reticulumAutoPruneDays: number;
  reticulumDestinationCapEnabled: boolean;
  reticulumDestinationCapCount: number;
  distanceFilterEnabled: boolean;
  distanceFilterMax: number;
  distanceUnit: 'miles' | 'km';
  coordinateFormat: 'decimal' | 'mgrs';
  filterMqttOnly: boolean;
  messageLimitEnabled: boolean;
  messageLimitCount: number;
  autoFloodAdvertIntervalHours: number;
  autoFloodAdvertType: 'flood' | 'zeroHop';
  meshcoreFloodScopeHashtag: string;
  meshcoreFloodScopePresets: string[];
  chatCompactMode: boolean;
  alwaysShowMessageActions: boolean;
  storeForwardAutoFetchHistory: boolean;
  storeForwardHistoryProfile: 'conservative' | 'aggressive';
  shareLocationSendWaypoint: boolean;
  shareMyLocation: boolean;
  reduceMotion: boolean;
  use24HourTime: boolean;
  meshcoreOpenWireCompatEnabled: boolean;
  meshcorePathHashMode: 0 | 1 | 2;
  rrcUnreadAllRoomMessages: boolean;
  mecpComposeEnabled: boolean;
  nodeSilenceAlertMinutes: number | null;
  nodeBatteryLowThreshold: number;
  notifyOnLinkDown: boolean;
  hiddenProtocols: MeshProtocol[];
}

const DEFAULT_SETTINGS: AppSettings = {
  ...DEFAULT_APP_SETTINGS_SHARED,
  filterMqttOnly: false,
  messageLimitEnabled: true,
  messageLimitCount: 1000,
  autoFloodAdvertIntervalHours: DEFAULT_APP_SETTINGS_SHARED.autoFloodAdvertIntervalHours,
};

function loadSettings(): AppSettings {
  const parsed = parseStoredJson<Partial<AppSettings>>(
    getAppSettingsRaw(),
    'AppPanel loadSettings',
  );
  if (!parsed) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    hiddenProtocols: sanitizeHiddenProtocols(parsed.hiddenProtocols),
  };
}

interface Props {
  protocol: MeshProtocol;
  logPanelVisible?: boolean;
  onLogPanelVisibleChange?: (visible: boolean) => void;
  nodes?: Map<number, MeshNode>;
  /** Live node count for display; danger-zone scans read the store on click. */
  nodeCount: number;
  messageCount: number;
  channels: { index: number; name: string }[];
  myNodeNum: number | null;
  onLocationFilterChange: (f: LocationFilter) => void;
  ourPosition?: OurPosition | null;
  onRefreshGps?: () => void;
  /** Re-resolve our position in the active runtime after the saved location changes. */
  onLocationChanged?: () => void;
  gpsLoading?: boolean;
  onGpsIntervalChange?: (secs: number) => void;
  onNodesPruned?: () => void;
  onMessagesPruned?: (opts?: MessageClearRefreshOptions) => void;
  /** The panel is on screen. It stays mounted once visited, so lists reload on each visit. */
  isActive?: boolean;
  onClearMeshcoreRepeaters?: () => Promise<void>;
  onAutoFloodAdvertIntervalChange?: (hours: number) => void;
  onAutoFloodAdvertTypeChange?: (type: 'flood' | 'zeroHop') => void;
  onChatCompactModeChange?: (compact: boolean) => void;
  onAlwaysShowMessageActionsChange?: (alwaysShow: boolean) => void;
  /** Protocols hidden from the switcher and skipped by autostart (App → Protocols). */
  onHiddenProtocolsChange?: (hidden: MeshProtocol[]) => void;
  /** Reticulum LXMF identity for DM-only message clear in Danger Zone. */
  reticulumIdentityId?: string | null;
  reticulumSidecarReady?: boolean;
}

interface PendingAction {
  actionId: DangerActionId;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  action: () => Promise<void>;
  messageClearMeta?: MessageClearRefreshOptions;
}

export default function AppPanel({
  protocol,
  logPanelVisible = false,
  onLogPanelVisibleChange,
  nodes: nodesProp,
  nodeCount,
  messageCount,
  channels,
  myNodeNum,
  onLocationFilterChange,
  ourPosition,
  onRefreshGps,
  onLocationChanged,
  gpsLoading,
  onGpsIntervalChange,
  onNodesPruned,
  onMessagesPruned,
  isActive = true,
  onClearMeshcoreRepeaters,
  onAutoFloodAdvertIntervalChange,
  onAutoFloodAdvertTypeChange,
  onChatCompactModeChange,
  onAlwaysShowMessageActionsChange,
  onHiddenProtocolsChange,
  reticulumIdentityId = null,
  reticulumSidecarReady = false,
}: Props) {
  const [soundNotifEnabled, setSoundNotifEnabled] = useState(
    () => localStorage.getItem('mesh-client:notifMuted') !== '1',
  );
  useEffect(() => {
    localStorage.setItem('mesh-client:notifMuted', soundNotifEnabled ? '0' : '1');
  }, [soundNotifEnabled]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [supportBundleExporting, setSupportBundleExporting] = useState<SupportBundleMode | null>(
    null,
  );
  const [mecpExportBusy, setMecpExportBusy] = useState(false);
  const { addToast } = useToast();
  const { t } = useTranslation();
  const resolveNodes = useCallback(
    (): Map<number, MeshNode> => nodesProp ?? readNodesMapForProtocol(protocol),
    [nodesProp, protocol],
  );
  const homeNodeFromStore = useNodeStore((s) => {
    if (myNodeNum == null) return null;
    const identityId = getIdentityIdForProtocol(protocol);
    if (!identityId) return null;
    return s.nodes[identityId]?.[myNodeNum] ?? null;
  });
  const clearDiagnostics = useDiagnosticsStore((s) => s.clearDiagnostics);
  const showPaths = usePositionHistoryStore((s) => s.showPaths);
  const setShowPaths = usePositionHistoryStore((s) => s.setShowPaths);
  const historyWindowHours = usePositionHistoryStore((s) => s.historyWindowHours);
  const setHistoryWindow = usePositionHistoryStore((s) => s.setHistoryWindow);
  const clearHistory = usePositionHistoryStore((s) => s.clearHistory);
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  const reticulumContactCount = useReticulumPeerStore((s) => s.contacts.size);
  const clearAllReticulumContacts = useReticulumPeerStore((s) => s.clearAllContacts);

  const historyWindowOptionLabels = useMemo((): Record<number, string> => {
    return {
      1: t('appPanel.historyWindow1h'),
      4: t('appPanel.historyWindow4h'),
      24: t('appPanel.historyWindow24h'),
      72: t('appPanel.historyWindow3d'),
      168: t('appPanel.historyWindow7d'),
    };
  }, [t]);

  const { nodeStaleThresholdMs, nodeOfflineThresholdMs, hasReticulumInterfaceConfig, hasRrcPanel } =
    useRadioProvider(protocol);
  const isReticulumDmOnly = hasReticulumInterfaceConfig;

  // ─── Node retention settings ────────────────────────────────
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [themeColors, setThemeColors] = useState<Record<ThemeColorKey, string>>(loadThemeColors);
  const [themeSurfaceId, setThemeSurfaceId] = useState<ThemeSurfaceId>(loadThemeSurfaceId);
  const [hasSavedThemeSnapshot, setHasSavedThemeSnapshot] = useState<boolean>(hasThemeSnapshot);
  const [messageActionsBarBgVisible, setMessageActionsBarBgVisibleState] = useState<boolean>(
    isMessageActionsBarBgVisible(),
  );
  const [deleteAgeDays, setDeleteAgeDays] = useState(90);
  const [fontScale, setFontScale] = useState<number>(loadFontScale);

  const updateFontScale = useCallback((next: number) => {
    const clamped = clampFontScale(next);
    setFontScale(clamped);
    applyFontScale(clamped);
    persistFontScale(clamped);
  }, []);

  const handleResetFontScale = useCallback(() => {
    resetFontScale();
    setFontScale(DEFAULT_FONT_SCALE);
  }, []);

  const commitThemeColor = useCallback(
    (key: ThemeColorKey, hex: string) => {
      if (themeColors[key] === hex) return;
      const next = { ...themeColors, [key]: hex };
      // Prefer the clamped map applyThemeColors returns so readableGreen stays
      // contrast-safe in React state and localStorage (not only on :root).
      const applied = applyThemeColors(next);
      if (!applied) return;
      persistThemeColors(applied);
      setThemeColors(applied);
      // The contrast guards in themeColors.ts put the default back instead of applying an
      // unreadable accent or fill. Say so rather than let the pick silently snap back.
      if (applied.brandGreen !== next.brandGreen.toLowerCase()) {
        addToast(t('appPanel.themeAccentKept'), 'warning');
      } else if (applied.readableGreen !== next.readableGreen.toLowerCase()) {
        addToast(t('appPanel.themeFillKept'), 'warning');
      }
    },
    [addToast, t, themeColors],
  );

  const applyThemePalette = useCallback((next: Record<ThemeColorKey, string>) => {
    const applied = applyThemeColors(next);
    if (!applied) return;
    persistThemeColors(applied);
    setThemeColors(applied);
  }, []);

  // A surface replaces the neutral tokens and keeps the accent; an accent does the reverse.
  const handleThemeSurfaceSelect = useCallback(
    (surface: ThemeSurface) => {
      persistThemeSurfaceId(surface.id);
      applyThemeSurface(surface.id);
      setThemeSurfaceId(surface.id);
      applyThemePalette({ ...themeColors, ...surfaceThemeColors(surface) });
    },
    [applyThemePalette, themeColors],
  );

  const handleThemeAccentSelect = useCallback(
    (accent: ThemeAccent) => {
      applyThemePalette({ ...themeColors, ...accentThemeColors(accent) });
    },
    [applyThemePalette, themeColors],
  );

  const handleSaveThemeSnapshot = useCallback(() => {
    try {
      saveThemeSnapshot();
      setHasSavedThemeSnapshot(true);
      addToast(t('appPanel.themeSaved'), 'success');
    } catch (err) {
      console.warn('[AppPanel] saveThemeSnapshot failed ' + errLikeToLogString(err));
      addToast(t('appPanel.themeSaveFailed'), 'error');
    }
  }, [addToast, t]);

  const handleRestoreThemeSnapshot = useCallback(() => {
    try {
      const restored = restoreThemeSnapshot();
      setThemeColors(restored);
      setThemeSurfaceId(loadThemeSurfaceId());
      setMessageActionsBarBgVisibleState(isMessageActionsBarBgVisible());
      addToast(t('appPanel.themeRestored'), 'success');
    } catch (err) {
      console.warn('[AppPanel] restoreThemeSnapshot failed ' + errLikeToLogString(err));
      addToast(t('appPanel.themeRestoreFailed'), 'error');
    }
  }, [addToast, t]);

  const handleResetThemeColors = useCallback(() => {
    try {
      // resetThemeColors() persists and applies the messageActionsBarBg visibility
      // reset internally — just sync the React state mirrors here.
      resetThemeColors();
      setThemeColors({ ...DEFAULT_THEME_COLORS });
      setThemeSurfaceId(DEFAULT_THEME_SURFACE_ID);
      setMessageActionsBarBgVisibleState(false);
      addToast(t('appPanel.colorsReset'), 'success');
    } catch (err) {
      console.warn('[AppPanel] resetThemeColors failed ' + errLikeToLogString(err));
      addToast(t('appPanel.themeResetFailed'), 'error');
    }
  }, [addToast, t]);

  const handleExportSupportBundle = useCallback(
    async (mode: SupportBundleMode) => {
      if (supportBundleExporting) return;
      setSupportBundleExporting(mode);
      try {
        console.debug('[AppPanel] exportSupportBundle', mode);
        const exportPath = await exportSupportBundleToDisk(mode);
        if (exportPath) {
          addToast(t('appPanel.exportedTo', { path: exportPath }), 'success');
        }
      } catch (err) {
        console.warn('[AppPanel] support bundle export failed ' + errLikeToLogString(err));
        addToast(
          t('appPanel.exportSupportBundleFailed', {
            message: err instanceof Error ? err.message : t('appPanel.unknownError'),
          }),
          'error',
        );
      } finally {
        setSupportBundleExporting(null);
      }
    },
    [supportBundleExporting, addToast, t],
  );

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      mergeAppSettingsPartial(
        appPanelSettingsPersistPayload(settings as unknown as Record<string, unknown>),
        'AppPanel saveSettings',
      );
    }, 300);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [settings]);

  useEffect(() => {
    onLocationFilterChange({
      enabled: settings.distanceFilterEnabled,
      maxDistance: settings.distanceFilterMax,
      unit: settings.distanceUnit,
      hideMqttOnly: settings.filterMqttOnly,
    });
  }, [
    settings.distanceFilterEnabled,
    settings.distanceFilterMax,
    settings.distanceUnit,
    settings.filterMqttOnly,
    onLocationFilterChange,
  ]);

  useEffect(() => {
    onChatCompactModeChange?.(settings.chatCompactMode);
  }, [settings.chatCompactMode, onChatCompactModeChange]);

  useEffect(() => {
    onAlwaysShowMessageActionsChange?.(settings.alwaysShowMessageActions);
  }, [settings.alwaysShowMessageActions, onAlwaysShowMessageActionsChange]);

  useEffect(() => {
    onHiddenProtocolsChange?.(settings.hiddenProtocols);
  }, [settings.hiddenProtocols, onHiddenProtocolsChange]);

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    mergeAppSetting(key, value, 'AppPanel updateSetting');
    if (key === 'reduceMotion') {
      writeReduceMotion(Boolean(value));
      void window.electronAPI.appSettings
        .set('reduceMotion', value ? 'true' : 'false')
        .catch((err: unknown) => {
          console.warn('[AppPanel] reduceMotion persist failed ' + errLikeToLogString(err));
        });
    }
    if (key === 'use24HourTime') {
      void window.electronAPI.appSettings
        .set('use24HourTime', value ? 'true' : 'false')
        .catch((err: unknown) => {
          console.warn('[AppPanel] use24HourTime persist failed ' + errLikeToLogString(err));
        });
    }
  };

  // ─── DB-backed settings hydrate (message retention + 24h clock) ─
  // Source of truth lives in SQLite (`app_settings` KV table). One getAll()
  // on mount so tests that mockResolvedValueOnce still see retention keys.
  const [retention, setRetention] = useState<MessageRetentionSettings>({
    ...DEFAULT_MESSAGE_RETENTION,
  });
  const lastSavedRetentionRef = useRef<MessageRetentionSettings>({ ...DEFAULT_MESSAGE_RETENTION });
  const retentionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.appSettings
      .getAll()
      .then((raw) => {
        if (cancelled) return;
        const use24 = raw?.use24HourTime;
        if (use24 === 'true' || use24 === 'false') {
          const enabled = use24 === 'true';
          useTimeFormatStore.getState().hydrateFromSqlite(enabled);
          setSettings((prev) =>
            prev.use24HourTime === enabled ? prev : { ...prev, use24HourTime: enabled },
          );
        }
        const loaded = parseMessageRetention(raw);
        setRetention(loaded);
        lastSavedRetentionRef.current = loaded;
      })
      .catch((err: unknown) => {
        console.warn('[AppPanel] app settings hydrate failed ' + errLikeToLogString(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistRetention = useCallback(
    (
      key: keyof typeof MESSAGE_RETENTION_KEYS,
      value: string,
      previous: MessageRetentionSettings,
    ) => {
      const dbKey = MESSAGE_RETENTION_KEYS[key];
      window.electronAPI.appSettings.set(dbKey, value).then(
        () => {
          lastSavedRetentionRef.current = { ...lastSavedRetentionRef.current, [key]: value };
        },
        (err: unknown) => {
          console.error('[AppPanel] persist message retention failed ' + errLikeToLogString(err));
          addToast(t('appPanel.failedSaveRetention'), 'error');
          setRetention(previous);
        },
      );
    },
    [addToast, t],
  );

  const updateRetentionEnabled = useCallback(
    (which: 'meshtastic' | 'meshcore' | 'reticulum' | 'rrc', enabled: boolean) => {
      const previous = retention;
      const next = { ...previous, [`${which}Enabled`]: enabled };
      setRetention(next);
      persistRetention(`${which}Enabled` as const, enabled ? '1' : '0', previous);
    },
    [retention, persistRetention],
  );

  const updateRetentionCount = useCallback(
    (which: 'meshtastic' | 'meshcore' | 'reticulum' | 'rrc', count: number) => {
      const clamped = Math.max(
        MESSAGE_RETENTION_MIN_COUNT,
        Math.min(MESSAGE_RETENTION_MAX_COUNT, Math.floor(count) || MESSAGE_RETENTION_MIN_COUNT),
      );
      const previous = retention;
      const next = { ...previous, [`${which}Count`]: clamped };
      setRetention(next);
      const stateKey = `${which}Count` as const;

      if (retentionSaveTimerRef.current) clearTimeout(retentionSaveTimerRef.current);
      retentionSaveTimerRef.current = setTimeout(() => {
        persistRetention(stateKey, String(clamped), previous);
      }, 300);
    },
    [retention, persistRetention],
  );

  useEffect(() => {
    return () => {
      if (retentionSaveTimerRef.current) clearTimeout(retentionSaveTimerRef.current);
    };
  }, []);

  // ─── GPS refresh settings ────────────────────────────────────
  const [gpsRefreshInterval, setGpsRefreshInterval] = useState<number>(() => {
    const gpsParsed = parseStoredJson<{ refreshInterval?: number }>(
      localStorage.getItem('mesh-client:gpsSettings'),
      'AppPanel gps refresh interval state',
    );
    const val = gpsParsed?.refreshInterval ?? 0;
    return val > 0 ? val : 3600; // default 1 hour
  });

  const handleGpsIntervalChange = useCallback(
    (val: number) => {
      setGpsRefreshInterval(val);
      try {
        const existing =
          parseStoredJson<Record<string, unknown>>(
            localStorage.getItem('mesh-client:gpsSettings'),
            'AppPanel persist gps interval',
          ) ?? {};
        localStorage.setItem(
          'mesh-client:gpsSettings',
          JSON.stringify({ ...existing, refreshInterval: val }),
        );
      } catch (e) {
        console.debug('[AppPanel] persist gps interval ' + errLikeToLogString(e));
      }
      onGpsIntervalChange?.(val);
    },
    [onGpsIntervalChange],
  );

  // ─── Saved locations (static GPS) ────────────────────────────
  const savedLocations = useSavedLocations();
  const hasStaticPosition = savedLocations.activeId != null;

  const handleSavedLocationChanged = useCallback(() => {
    if (getActiveSavedLocation()) {
      setGpsRefreshInterval(0);
      onGpsIntervalChange?.(0);
    }
    if (onLocationChanged) onLocationChanged();
    else onRefreshGps?.();
  }, [onGpsIntervalChange, onLocationChanged, onRefreshGps]);

  // ─── Message channel selection ──────────────────────────────
  const [msgChannels, setMsgChannels] = useState<number[]>([]);
  const [clearChannelTarget, setClearChannelTarget] = useState<number>(CLEAR_ALL_CHANNELS_VALUE);

  const loadMsgChannels = useCallback(() => {
    if (protocol === 'meshcore') {
      window.electronAPI.db
        .getMeshcoreMessageChannels()
        .then((rows) => {
          setMsgChannels([...new Set(rows.map((r) => r.channel))].sort((a, b) => a - b));
        })
        .catch((e: unknown) => {
          console.debug('[AppPanel] getMeshcoreMessageChannels ' + errLikeToLogString(e));
        });
    } else {
      window.electronAPI.db
        .getMessageChannels()
        .then((rows) => {
          setMsgChannels([...new Set(rows.map((r) => r.channel))].sort((a, b) => a - b));
        })
        .catch((e: unknown) => {
          console.debug('[AppPanel] getMessageChannels ' + errLikeToLogString(e));
        });
    }
  }, [protocol]);

  // Reload on every visit: the list was read once, so channels that got messages after the first
  // visit never appeared in it (#1098).
  useEffect(() => {
    if (isActive) loadMsgChannels();
  }, [isActive, loadMsgChannels]);

  useEffect(() => {
    setClearChannelTarget(CLEAR_ALL_CHANNELS_VALUE);
  }, [protocol]);

  const getChannelLabel = useCallback(
    (ch: number) => {
      if (ch === -1) return t('radioPanel.directMessages');
      if (ch === -2) return t('appPanel.roomMessages');
      const named = channels.find((c) => c.index === ch);
      return named
        ? t('appPanel.channelOption', { index: ch, name: named.name })
        : t('appPanel.channelOptionUnnamed', { index: ch });
    },
    [channels, t],
  );

  // ─── Confirmation flow ──────────────────────────────────────
  const executeWithConfirmation = useCallback((action: PendingAction) => {
    setPendingAction(action);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pendingAction) return;
    const { actionId, action, messageClearMeta, title } = pendingAction;
    setPendingAction(null);
    try {
      await action();
      if (NODE_PRUNE_ACTIONS.includes(actionId)) onNodesPruned?.();
      if (MESSAGE_PRUNE_ACTIONS.includes(actionId)) {
        onMessagesPruned?.(messageClearMeta);
        loadMsgChannels();
      }
      addToast(
        t('appPanel.actionCompleted', {
          name: title,
        }),
        'success',
      );
    } catch (err) {
      console.warn('[AppPanel] pending action failed ' + errLikeToLogString(err));
      addToast(
        t('appPanel.actionFailed', {
          message: err instanceof Error ? err.message : t('appPanel.unknownError'),
        }),
        'error',
      );
    }
  }, [pendingAction, addToast, loadMsgChannels, onNodesPruned, onMessagesPruned, t]);

  return (
    <div className="w-full space-y-6">
      <h2 className="text-ink-200 text-xl font-semibold">{t('appPanel.title')}</h2>

      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <h3 className="text-muted text-sm font-medium">{t('appPanel.protocolsSection')}</h3>
          <HelpTooltip text={t('appPanel.protocolsEnabledDesc')} />
        </div>
        <div
          data-setting-anchor="app.protocols.enabled"
          className="bg-deep-black border-ink-800 space-y-2 rounded-xl border p-4"
        >
          {REGISTERED_MESH_PROTOCOLS.map((proto) => {
            const enabled = !settings.hiddenProtocols.includes(proto);
            const isLastEnabled =
              enabled && enabledProtocolsFrom(settings.hiddenProtocols).length === 1;
            const name = PROTOCOL_THEME[proto].displayName;
            const inputId = `protocol-enabled-${proto}`;
            return (
              <div key={proto} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={inputId}
                  checked={enabled}
                  disabled={isLastEnabled}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? settings.hiddenProtocols.filter((p) => p !== proto)
                      : [...settings.hiddenProtocols, proto];
                    updateSetting('hiddenProtocols', sanitizeHiddenProtocols(next));
                  }}
                  aria-label={t('appPanel.protocolEnabled', { name })}
                  title={isLastEnabled ? t('appPanel.protocolLastEnabled') : undefined}
                  className="accent-brand-green disabled:cursor-not-allowed"
                />
                <label
                  htmlFor={inputId}
                  className={`text-ink-300 text-sm ${isLastEnabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {name}
                </label>
                {isLastEnabled && <HelpTooltip text={t('appPanel.protocolLastEnabled')} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Log panel visibility */}
      {onLogPanelVisibleChange && (
        <div className="space-y-2">
          <h3 className="text-muted text-sm font-medium">{t('appPanel.logPanelSection')}</h3>
          <div
            data-setting-anchor="app.logPanel.showLogPanel"
            className="bg-deep-black border-ink-800 rounded-xl border p-4"
          >
            <div className="flex items-center gap-2">
              <input
                id="log-panel-visible-checkbox"
                type="checkbox"
                checked={logPanelVisible}
                onChange={(e) => {
                  onLogPanelVisibleChange(e.target.checked);
                }}
                aria-label={t('appPanel.showLogPanel')}
                className="border-ink-600 rounded"
              />
              <label
                htmlFor="log-panel-visible-checkbox"
                className="text-ink-300 cursor-pointer text-sm"
              >
                {t('appPanel.showLogPanel')}
              </label>
            </div>
            <p className="text-muted mt-2 text-xs">{t('appPanel.logPanelHelp')}</p>
          </div>
        </div>
      )}

      {/* Flood Advert schedule (MeshCore only) */}
      {protocol === 'meshcore' && (
        <div className="space-y-2">
          <h3 className="text-muted text-sm font-medium">{t('appPanel.floodAdvertSection')}</h3>
          <div className="bg-deep-black border-ink-800 space-y-2 rounded-xl border p-4">
            <label htmlFor="flood-advert-interval" className="text-ink-300 text-sm">
              {t('appPanel.floodAdvertScheduleLabel')}
            </label>
            <select
              data-setting-anchor="app.floodAdvert.schedule"
              id="flood-advert-interval"
              value={settings.autoFloodAdvertIntervalHours}
              onChange={(e) => {
                const hours = Number(e.target.value);
                setSettings((prev) => ({ ...prev, autoFloodAdvertIntervalHours: hours }));
                onAutoFloodAdvertIntervalChange?.(hours);
              }}
              className={`${SELECT_BOX_CLASS} w-full`}
            >
              <option value={0}>{t('common.disabled')}</option>
              <option value={12}>{t('appPanel.floodAdvertEvery12h')}</option>
              <option value={24}>{t('appPanel.floodAdvertEvery24h')}</option>
            </select>
            <p className="text-muted text-xs">{t('appPanel.floodAdvertHelp')}</p>
            <label htmlFor="flood-advert-type" className="text-ink-300 text-sm">
              {t('appPanel.floodAdvertTypeLabel')}
            </label>
            <select
              data-setting-anchor="app.floodAdvert.type"
              id="flood-advert-type"
              value={settings.autoFloodAdvertType}
              onChange={(e) => {
                const type = e.target.value === 'zeroHop' ? 'zeroHop' : 'flood';
                setSettings((prev) => ({ ...prev, autoFloodAdvertType: type }));
                onAutoFloodAdvertTypeChange?.(type);
              }}
              className={`${SELECT_BOX_CLASS} w-full`}
            >
              <option value="flood">{t('appPanel.floodAdvertTypeFlood')}</option>
              <option value="zeroHop">{t('appPanel.floodAdvertTypeZeroHop')}</option>
            </select>
          </div>
        </div>
      )}

      {/* GPS / Location */}
      <div className="space-y-3">
        <h3 className="text-muted text-sm font-medium">{t('appPanel.gpsSection')}</h3>
        <div className="bg-deep-black border-ink-800 space-y-4 rounded-xl border p-4">
          <div data-setting-anchor="app.gps.shareLocation" className="flex items-center gap-2">
            <input
              type="checkbox"
              id="shareMyLocation"
              checked={settings.shareMyLocation}
              onChange={(e) => {
                const enabled = e.target.checked;
                updateSetting('shareMyLocation', enabled);
                if (!enabled) {
                  handleGpsIntervalChange(0);
                }
              }}
              aria-label={t('appPanel.shareMyLocation')}
              className="accent-brand-green"
            />
            <label htmlFor="shareMyLocation" className="text-ink-300 cursor-pointer text-sm">
              {t('appPanel.shareMyLocation')}
            </label>
            <HelpTooltip text={t('appPanel.shareMyLocationHint')} />
          </div>
          {!settings.shareMyLocation && (
            <p className="text-muted text-xs">{t('appPanel.shareMyLocationOffInfo')}</p>
          )}
          {ourPosition && (
            <p className="text-brand-green text-xs">
              {ourPosition.source === 'device'
                ? t('appPanel.gpsSourceDevice', {
                    coords: formatCoordPair(ourPosition.lat, ourPosition.lon, coordinateFormat),
                  })
                : ourPosition.source === 'static'
                  ? t('appPanel.gpsSourceStatic', {
                      coords: formatCoordPair(ourPosition.lat, ourPosition.lon, coordinateFormat),
                    })
                  : ourPosition.source === 'browser'
                    ? t('appPanel.gpsSourceBrowser', {
                        coords: formatCoordPair(ourPosition.lat, ourPosition.lon, coordinateFormat),
                      })
                    : t('appPanel.gpsSourceIp', {
                        coords: formatCoordPair(ourPosition.lat, ourPosition.lon, coordinateFormat),
                      })}
            </p>
          )}
          {!ourPosition && <p className="text-muted text-xs">{t('appPanel.noGpsPositionYet')}</p>}

          <div data-setting-anchor="app.gps.savedLocations">
            <SavedLocationsSection onLocationChanged={handleSavedLocationChanged} />
          </div>

          <div data-setting-anchor="app.gps.refreshInterval" className="flex items-center gap-2">
            <label htmlFor="apppanel-gps-interval" className="text-ink-300 flex-1 text-sm">
              {t('appPanel.autoRefreshInterval')}
            </label>
            <select
              id="apppanel-gps-interval"
              value={gpsRefreshInterval}
              onChange={(e) => {
                handleGpsIntervalChange(Number(e.target.value));
              }}
              disabled={hasStaticPosition || !settings.shareMyLocation}
              aria-label={`${t('appPanel.autoRefreshInterval')} ${gpsIntervalLabel(t, gpsRefreshInterval)}`}
              className={`${SELECT_BOX_CLASS} ${hasStaticPosition || !settings.shareMyLocation ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              <option value={0}>{t('appPanel.gpsIntervalManual')}</option>
              <option value={900}>{t('appPanel.gpsInterval15min')}</option>
              <option value={1800}>{t('appPanel.gpsInterval30min')}</option>
              <option value={3600}>{t('appPanel.gpsIntervalHour')}</option>
              <option value={7200}>{t('appPanel.gpsInterval2hours')}</option>
            </select>
          </div>
          {hasStaticPosition && (
            <p className="text-muted text-xs">{t('appPanel.autoRefreshDisabledStatic')}</p>
          )}
          <div data-setting-anchor="app.gps.coordinateFormat" className="flex items-center gap-2">
            <label htmlFor="apppanel-coord-format" className="text-ink-300 flex-1 text-sm">
              {t('appPanel.coordinateFormat')}
            </label>
            <select
              id="apppanel-coord-format"
              value={settings.coordinateFormat}
              onChange={(e) => {
                const fmt = e.target.value as 'decimal' | 'mgrs';
                updateSetting('coordinateFormat', fmt);
                useCoordFormatStore.getState().setCoordinateFormat(fmt);
              }}
              aria-label={`${t('appPanel.coordinateFormat')} ${settings.coordinateFormat === 'mgrs' ? t('appPanel.coordFormatMgrs') : t('appPanel.coordFormatDecimal')}`}
              className={SELECT_BOX_CLASS}
            >
              <option value="decimal">{t('appPanel.coordFormatDecimal')}</option>
              <option value="mgrs">{t('appPanel.coordFormatMgrs')}</option>
            </select>
          </div>
          <button
            data-setting-anchor="app.gps.refreshNow"
            type="button"
            onClick={() => onRefreshGps?.()}
            disabled={gpsLoading || !settings.shareMyLocation}
            title={!settings.shareMyLocation ? t('appPanel.shareMyLocationOffInfo') : undefined}
            aria-label={gpsLoading ? t('appPanel.gpsRefreshing') : t('appPanel.gpsRefreshNow')}
            className={`bg-secondary-dark text-ink-300 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${gpsLoading || !settings.shareMyLocation ? 'cursor-not-allowed opacity-50' : 'hover:bg-ink-600'}`}
          >
            {gpsLoading ? t('appPanel.gpsRefreshing') : t('appPanel.gpsRefreshNow')}
          </button>
        </div>
      </div>

      {/* Map & Node Filtering */}
      <div className="space-y-3">
        <h3 className="text-muted text-sm font-medium">{t('appPanel.mapFilterSection')}</h3>
        <div className="bg-deep-black border-ink-800 space-y-4 rounded-xl border p-4">
          <p className="text-muted text-xs leading-relaxed">{t('appPanel.mapFilterDesc')}</p>
          <div data-setting-anchor="app.mapFilter.distantNodes" className="flex items-center gap-2">
            <input
              type="checkbox"
              id="distanceFilter"
              checked={settings.distanceFilterEnabled}
              onChange={(e) => {
                updateSetting('distanceFilterEnabled', e.target.checked);
              }}
              aria-label={t('appPanel.filterDistantNodes')}
              className="accent-brand-green"
            />
            <label htmlFor="distanceFilter" className="text-ink-300 cursor-pointer text-sm">
              {t('appPanel.filterDistantNodesCheckbox')}
            </label>
          </div>
          <div data-setting-anchor="app.mapFilter.maxDistance" className="flex items-center gap-2">
            <label htmlFor="apppanel-max-distance" className="text-ink-300 text-sm">
              {t('appPanel.maxDistanceLabel')}
            </label>
            <input
              id="apppanel-max-distance"
              type="number"
              min={1}
              value={settings.distanceFilterMax}
              onChange={(e) => {
                updateSetting('distanceFilterMax', Math.max(1, parseInt(e.target.value) || 1));
              }}
              disabled={!settings.distanceFilterEnabled}
              aria-label={t('appPanel.maxDistanceAria', { value: settings.distanceFilterMax })}
              className={`${INPUT_BOX_CLASS} w-24 text-right`}
            />
            <label htmlFor="apppanel-distance-unit" className="text-ink-300 text-sm">
              {t('appPanel.unitLabel')}
            </label>
            <select
              id="apppanel-distance-unit"
              value={settings.distanceUnit}
              onChange={(e) => {
                updateSetting('distanceUnit', e.target.value as 'miles' | 'km');
              }}
              disabled={!settings.distanceFilterEnabled}
              aria-label={t('appPanel.unitAria', {
                unit:
                  settings.distanceUnit === 'km'
                    ? t('appPanel.distanceUnitKm')
                    : t('appPanel.distanceUnitMiles'),
              })}
              className={SELECT_BOX_CLASS}
            >
              <option value="miles">{t('appPanel.distanceUnitMiles')}</option>
              <option value="km">{t('appPanel.distanceUnitKm')}</option>
            </select>
          </div>
          {settings.distanceFilterEnabled &&
            (() => {
              const homeHasLocation =
                homeNodeFromStore?.latitude != null &&
                homeNodeFromStore.latitude !== 0 &&
                homeNodeFromStore.longitude != null &&
                homeNodeFromStore.longitude !== 0;
              return !homeHasLocation ? (
                <p className="rounded border border-orange-700 bg-orange-900/30 px-2 py-1.5 text-xs text-orange-300">
                  {t('appPanel.noGpsFix')}
                </p>
              ) : null;
            })()}
          <p className="text-muted text-xs">{t('appPanel.requiresGpsFix')}</p>
          <div data-setting-anchor="app.mapFilter.hideMqttOnly" className="flex items-center gap-2">
            <input
              type="checkbox"
              id="filterMqttOnly"
              checked={settings.filterMqttOnly}
              onChange={(e) => {
                updateSetting('filterMqttOnly', e.target.checked);
              }}
              aria-label={t('appPanel.hideMqttOnlyNodes')}
              className="accent-brand-green"
            />
            <label htmlFor="filterMqttOnly" className="text-ink-300 cursor-pointer text-sm">
              {t('appPanel.hideMqttOnlyNodes')}
            </label>
          </div>
          <div
            data-setting-anchor="app.mapFilter.movementPaths"
            className="flex items-center gap-2"
          >
            <input
              type="checkbox"
              id="showMovementPaths"
              checked={showPaths}
              onChange={(e) => {
                setShowPaths(e.target.checked);
              }}
              aria-label={t('appPanel.showMovementPaths')}
              className="accent-brand-green"
            />
            <label htmlFor="showMovementPaths" className="text-ink-300 cursor-pointer text-sm">
              {t('appPanel.showMovementPaths')}
            </label>
          </div>
          <div
            data-setting-anchor="app.mapFilter.historyWindow"
            className="flex items-center gap-2"
          >
            <label htmlFor="apppanel-history-window" className="text-ink-400 shrink-0 text-sm">
              {t('appPanel.positionHistoryWindowLabel')}
            </label>
            <select
              id="apppanel-history-window"
              value={historyWindowHours}
              onChange={(e) => {
                setHistoryWindow(Number(e.target.value));
              }}
              aria-label={`${t('appPanel.positionHistoryWindowLabel')} ${historyWindowOptionLabels[historyWindowHours] ?? historyWindowHours}`}
              className={SELECT_BOX_CLASS}
            >
              <option value={1}>{t('appPanel.historyWindow1h')}</option>
              <option value={4}>{t('appPanel.historyWindow4h')}</option>
              <option value={24}>{t('appPanel.historyWindow24h')}</option>
              <option value={72}>{t('appPanel.historyWindow3d')}</option>
              <option value={168}>{t('appPanel.historyWindow7d')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Retention & limits (config only — destructive actions are in Danger Zone below) */}
      <div className="space-y-3">
        <h3 className="text-muted text-sm font-medium">{t('appPanel.retentionLimitsHeading')}</h3>

        {/* Meshtastic node retention */}
        {protocol === 'meshtastic' && (
          <div className="bg-deep-black border-ink-800 space-y-4 rounded-xl border p-4">
            {/* Auto-prune nodes on startup */}
            <div
              data-setting-anchor="app.retention.autoPruneNodes"
              className="flex items-center gap-2"
            >
              <input
                type="checkbox"
                id="autoPrune"
                checked={settings.autoPruneEnabled}
                onChange={(e) => {
                  updateSetting('autoPruneEnabled', e.target.checked);
                }}
                aria-label={t('appPanel.autoPruneNodesOlderThan')}
                className="accent-brand-green"
              />
              <label
                id="apppanel-auto-prune-label"
                htmlFor="autoPrune"
                className="text-ink-300 flex-1 cursor-pointer text-sm"
              >
                {t('appPanel.autoPruneNodesOlderThan')}
              </label>
              <input
                id="apppanel-auto-prune-days"
                type="number"
                min={1}
                value={settings.autoPruneDays}
                onChange={(e) => {
                  updateSetting('autoPruneDays', Math.max(1, parseInt(e.target.value) || 1));
                }}
                disabled={!settings.autoPruneEnabled}
                aria-labelledby="apppanel-auto-prune-label"
                aria-label={t('appPanel.autoPruneNodesOlderThanAria', {
                  days: settings.autoPruneDays,
                })}
                className={`${INPUT_BOX_CLASS} w-20 text-right`}
              />
              <span className="text-ink-300 text-sm">{t('common.days')}</span>
            </div>

            {/* Prune unnamed nodes on startup */}
            <div data-setting-anchor="app.retention.pruneUnnamedNodes" className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="pruneEmptyNames"
                  checked={settings.pruneEmptyNamesEnabled}
                  onChange={(e) => {
                    updateSetting('pruneEmptyNamesEnabled', e.target.checked);
                  }}
                  aria-label={t('appPanel.removeUnnamedNodes')}
                  className="accent-brand-green"
                />
                <label
                  htmlFor="pruneEmptyNames"
                  className="text-ink-300 flex-1 cursor-pointer text-sm"
                >
                  {t('appPanel.removeUnnamedNodesLabel')}
                </label>
              </div>
              <p className="text-muted pl-6 text-xs">{t('appPanel.unnamedNodesHint')}</p>
            </div>

            {/* Node cap */}
            <div data-setting-anchor="app.retention.nodeCap" className="flex items-center gap-2">
              <input
                type="checkbox"
                id="nodeCap"
                checked={settings.nodeCapEnabled}
                onChange={(e) => {
                  updateSetting('nodeCapEnabled', e.target.checked);
                }}
                aria-label={t('appPanel.capTotalNodes')}
                className="accent-brand-green"
              />
              <label
                id="apppanel-node-cap-label"
                htmlFor="nodeCap"
                className="text-ink-300 flex-1 cursor-pointer text-sm"
              >
                {t('appPanel.capTotalNodesLabel')}
              </label>
              <input
                id="apppanel-node-cap-count"
                type="number"
                min={1}
                value={settings.nodeCapCount}
                onChange={(e) => {
                  updateSetting('nodeCapCount', Math.max(1, parseInt(e.target.value) || 1));
                }}
                disabled={!settings.nodeCapEnabled}
                aria-labelledby="apppanel-node-cap-label"
                aria-label={t('appPanel.capTotalNodesCountAria', { count: settings.nodeCapCount })}
                className={`${INPUT_BOX_CLASS} w-24 text-right`}
              />
              <span className="text-ink-300 text-sm">{t('common.nodes')}</span>
            </div>

            {/* Position history prune */}
            <div
              data-setting-anchor="app.retention.positionHistoryPrune"
              className="flex items-center gap-2"
            >
              <input
                type="checkbox"
                id="positionHistoryPrune"
                checked={settings.positionHistoryPruneEnabled}
                onChange={(e) => {
                  updateSetting('positionHistoryPruneEnabled', e.target.checked);
                }}
                aria-label={t('appPanel.autoPrunePositionHistory')}
                className="accent-brand-green"
              />
              <label
                id="apppanel-position-history-prune-label"
                htmlFor="positionHistoryPrune"
                className="text-ink-300 flex-1 cursor-pointer text-sm"
              >
                {t('appPanel.autoPrunePositionHistoryLabel')}
              </label>
              <input
                id="apppanel-position-history-prune-days"
                type="number"
                min={1}
                value={settings.positionHistoryPruneDays}
                onChange={(e) => {
                  updateSetting(
                    'positionHistoryPruneDays',
                    Math.max(1, parseInt(e.target.value) || 1),
                  );
                }}
                disabled={!settings.positionHistoryPruneEnabled}
                aria-labelledby="apppanel-position-history-prune-label"
                aria-label={t('appPanel.autoPrunePositionHistoryDaysAria', {
                  days: settings.positionHistoryPruneDays,
                })}
                className={`${INPUT_BOX_CLASS} w-20 text-right`}
              />
              <span className="text-ink-300 text-sm">{t('common.days')}</span>
            </div>
          </div>
        )}

        {/* MeshCore contact retention */}
        {protocol === 'meshcore' && (
          <div className="bg-deep-black border-ink-800 space-y-4 rounded-xl border p-4">
            {/* Delete contacts that never advertised */}
            <div data-setting-anchor="app.retention.neverAdvertisedContacts" className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="meshcoreDeleteNeverAdvertised"
                  checked={settings.meshcoreDeleteNeverAdvertised}
                  onChange={(e) => {
                    updateSetting('meshcoreDeleteNeverAdvertised', e.target.checked);
                  }}
                  aria-label={t('appPanel.removeContactsNeverAdvertised')}
                  className="accent-brand-green"
                />
                <label
                  htmlFor="meshcoreDeleteNeverAdvertised"
                  className="text-ink-300 flex-1 cursor-pointer text-sm"
                >
                  {t('appPanel.meshcoreRemoveNeverAdvertisedLabel')}
                </label>
              </div>
              <p className="text-muted pl-6 text-xs">
                {t('appPanel.meshcoreRemoveNeverAdvertisedHint')}
              </p>
            </div>

            {/* Auto-prune contacts by age */}
            <div
              data-setting-anchor="app.retention.autoPruneContacts"
              className="flex items-center gap-2"
            >
              <input
                type="checkbox"
                id="meshcoreAutoPrune"
                checked={settings.meshcoreAutoPruneEnabled}
                onChange={(e) => {
                  updateSetting('meshcoreAutoPruneEnabled', e.target.checked);
                }}
                aria-label={t('appPanel.autoPruneUnheardContacts')}
                className="accent-brand-green"
              />
              <label
                id="apppanel-meshcore-auto-prune-label"
                htmlFor="meshcoreAutoPrune"
                className="text-ink-300 flex-1 cursor-pointer text-sm"
              >
                {t('appPanel.autoPruneUnheardContactsLabel')}
              </label>
              <input
                id="apppanel-meshcore-auto-prune-days"
                type="number"
                min={1}
                value={settings.meshcoreAutoPruneDays}
                onChange={(e) => {
                  updateSetting(
                    'meshcoreAutoPruneDays',
                    Math.max(1, parseInt(e.target.value) || 1),
                  );
                }}
                disabled={!settings.meshcoreAutoPruneEnabled}
                aria-labelledby="apppanel-meshcore-auto-prune-label"
                aria-label={t('appPanel.autoPruneUnheardContactsDaysAria', {
                  days: settings.meshcoreAutoPruneDays,
                })}
                className={`${INPUT_BOX_CLASS} w-20 text-right`}
              />
              <span className="text-ink-300 text-sm">{t('common.days')}</span>
            </div>

            {/* Contact cap */}
            <div data-setting-anchor="app.retention.contactCap" className="flex items-center gap-2">
              <input
                type="checkbox"
                id="meshcoreContactCap"
                checked={settings.meshcoreContactCapEnabled}
                onChange={(e) => {
                  updateSetting('meshcoreContactCapEnabled', e.target.checked);
                }}
                aria-label={t('appPanel.capTotalContacts')}
                className="accent-brand-green"
              />
              <label
                id="apppanel-meshcore-contact-cap-label"
                htmlFor="meshcoreContactCap"
                className="text-ink-300 flex-1 cursor-pointer text-sm"
              >
                {t('appPanel.capTotalContactsLabel')}
              </label>
              <input
                id="apppanel-meshcore-contact-cap-count"
                type="number"
                min={1}
                max={10000}
                value={settings.meshcoreContactCapCount}
                onChange={(e) => {
                  updateSetting(
                    'meshcoreContactCapCount',
                    Math.max(1, Math.min(10000, parseInt(e.target.value) || 1)),
                  );
                }}
                disabled={!settings.meshcoreContactCapEnabled}
                aria-labelledby="apppanel-meshcore-contact-cap-label"
                aria-label={t('appPanel.capTotalContactsCountAria', {
                  count: settings.meshcoreContactCapCount,
                })}
                className={`${INPUT_BOX_CLASS} w-24 text-right`}
              />
              <span className="text-ink-300 text-sm">{t('common.contacts')}</span>
            </div>
          </div>
        )}

        {/* Reticulum destination retention (SQLite contacts/meta + in-memory peer cap) */}
        {protocol === 'reticulum' && (
          <div className="bg-deep-black border-ink-800 space-y-4 rounded-xl border p-4">
            <p className="text-muted text-xs leading-relaxed">
              {t('appPanel.reticulumDestinationRetentionHint')}
            </p>
            <div
              data-setting-anchor="app.retention.autoPruneDestinations"
              className="flex items-center gap-2"
            >
              <input
                type="checkbox"
                id="reticulumAutoPrune"
                checked={settings.reticulumAutoPruneEnabled}
                onChange={(e) => {
                  updateSetting('reticulumAutoPruneEnabled', e.target.checked);
                }}
                aria-label={t('appPanel.reticulumAutoPruneDestinations')}
                className="accent-brand-green"
              />
              <label
                id="apppanel-reticulum-auto-prune-label"
                htmlFor="reticulumAutoPrune"
                className="text-ink-300 flex-1 cursor-pointer text-sm"
              >
                {t('appPanel.reticulumAutoPruneDestinationsLabel')}
              </label>
              <input
                id="apppanel-reticulum-auto-prune-days"
                type="number"
                min={1}
                value={settings.reticulumAutoPruneDays}
                onChange={(e) => {
                  updateSetting(
                    'reticulumAutoPruneDays',
                    Math.max(1, parseInt(e.target.value) || 1),
                  );
                }}
                disabled={!settings.reticulumAutoPruneEnabled}
                aria-labelledby="apppanel-reticulum-auto-prune-label"
                aria-label={t('appPanel.reticulumAutoPruneDestinationsDaysAria', {
                  days: settings.reticulumAutoPruneDays,
                })}
                className={`${INPUT_BOX_CLASS} w-20 text-right`}
              />
              <span className="text-ink-300 text-sm">{t('common.days')}</span>
            </div>
            <div
              data-setting-anchor="app.retention.destinationCap"
              className="flex items-center gap-2"
            >
              <input
                type="checkbox"
                id="reticulumDestinationCap"
                checked={settings.reticulumDestinationCapEnabled}
                onChange={(e) => {
                  updateSetting('reticulumDestinationCapEnabled', e.target.checked);
                }}
                aria-label={t('appPanel.reticulumCapDestinations')}
                className="accent-brand-green"
              />
              <label
                id="apppanel-reticulum-destination-cap-label"
                htmlFor="reticulumDestinationCap"
                className="text-ink-300 flex-1 cursor-pointer text-sm"
              >
                {t('appPanel.reticulumCapDestinationsLabel')}
              </label>
              <input
                id="apppanel-reticulum-destination-cap-count"
                type="number"
                min={1}
                max={100000}
                value={settings.reticulumDestinationCapCount}
                onChange={(e) => {
                  updateSetting(
                    'reticulumDestinationCapCount',
                    Math.max(1, Math.min(100000, parseInt(e.target.value) || 1)),
                  );
                }}
                disabled={!settings.reticulumDestinationCapEnabled}
                aria-labelledby="apppanel-reticulum-destination-cap-label"
                aria-label={t('appPanel.reticulumCapDestinationsCountAria', {
                  count: settings.reticulumDestinationCapCount,
                })}
                className={`${INPUT_BOX_CLASS} w-24 text-right`}
              />
              <span className="text-ink-300 text-sm">
                {t('appPanel.reticulumDestinationsUnit', {
                  count: settings.reticulumDestinationCapCount,
                })}
              </span>
            </div>
          </div>
        )}

        {/* Messages: load limit (localStorage) + DB retention cap — single card (issue #387). */}
        <div className="bg-deep-black border-ink-800 space-y-3 rounded-xl border p-4">
          <p className="text-muted text-xs leading-relaxed">
            {t('appPanel.messagesLoadLimitIntro')}
          </p>
          <div data-setting-anchor="app.retention.messageLimit" className="flex items-center gap-2">
            <input
              type="checkbox"
              id="messageLimit"
              checked={settings.messageLimitEnabled}
              onChange={(e) => {
                updateSetting('messageLimitEnabled', e.target.checked);
              }}
              aria-label={t('appPanel.limitMessagesLoaded')}
              className="accent-brand-green"
            />
            <label
              id="apppanel-message-limit-label"
              htmlFor="messageLimit"
              className="text-ink-300 flex-1 cursor-pointer text-sm"
            >
              {t('appPanel.limitMessagesLoadedLabel')}
            </label>
            <input
              id="apppanel-message-limit-count"
              type="number"
              min={1}
              max={10000}
              value={settings.messageLimitCount}
              onChange={(e) => {
                updateSetting(
                  'messageLimitCount',
                  Math.max(1, Math.min(10000, parseInt(e.target.value) || 1000)),
                );
              }}
              disabled={!settings.messageLimitEnabled}
              aria-labelledby="apppanel-message-limit-label"
              aria-label={t('appPanel.limitMessagesLoadedCountAria', {
                count: settings.messageLimitCount,
              })}
              className={`${INPUT_BOX_CLASS} w-24 text-right`}
            />
            <span className="text-ink-300 text-sm">{t('common.messages')}</span>
          </div>
          {protocol === 'meshcore' ? (
            <div
              data-setting-anchor="app.retention.meshcoreMessageCap"
              className="border-ink-700 flex items-center gap-2 border-t pt-2"
            >
              <input
                type="checkbox"
                id="messageRetentionMeshcore"
                checked={retention.meshcoreEnabled}
                onChange={(e) => {
                  updateRetentionEnabled('meshcore', e.target.checked);
                }}
                aria-label={t('appPanel.capStoredMessages')}
                className="accent-brand-green"
              />
              <label
                id="apppanel-message-retention-meshcore-label"
                htmlFor="messageRetentionMeshcore"
                className="text-ink-300 flex-1 cursor-pointer text-sm"
              >
                {t('appPanel.capStoredMessagesLabel')}
              </label>
              <input
                id="apppanel-message-retention-meshcore-count"
                type="number"
                min={MESSAGE_RETENTION_MIN_COUNT}
                max={MESSAGE_RETENTION_MAX_COUNT}
                value={retention.meshcoreCount}
                onChange={(e) => {
                  updateRetentionCount(
                    'meshcore',
                    parseInt(e.target.value, 10) || MESSAGE_RETENTION_MIN_COUNT,
                  );
                }}
                disabled={!retention.meshcoreEnabled}
                aria-labelledby="apppanel-message-retention-meshcore-label"
                aria-label={t('appPanel.capStoredMessagesCountAria', {
                  count: retention.meshcoreCount,
                })}
                className={`${INPUT_BOX_CLASS} w-24 text-right`}
              />
              <span className="text-ink-300 text-sm">{t('common.messages')}</span>
            </div>
          ) : protocol === 'reticulum' ? (
            <>
              <div
                data-setting-anchor="app.retention.reticulumMessageCap"
                className="border-ink-700 flex items-center gap-2 border-t pt-2"
              >
                <input
                  type="checkbox"
                  id="messageRetentionReticulum"
                  checked={retention.reticulumEnabled}
                  onChange={(e) => {
                    updateRetentionEnabled('reticulum', e.target.checked);
                  }}
                  aria-label={t('appPanel.capStoredMessages')}
                  className="accent-brand-green"
                />
                <label
                  id="apppanel-message-retention-reticulum-label"
                  htmlFor="messageRetentionReticulum"
                  className="text-ink-300 flex-1 cursor-pointer text-sm"
                >
                  {t('appPanel.capStoredMessagesLabel')}
                </label>
                <input
                  id="apppanel-message-retention-reticulum-count"
                  type="number"
                  min={MESSAGE_RETENTION_MIN_COUNT}
                  max={MESSAGE_RETENTION_MAX_COUNT}
                  value={retention.reticulumCount}
                  onChange={(e) => {
                    updateRetentionCount(
                      'reticulum',
                      parseInt(e.target.value, 10) || MESSAGE_RETENTION_MIN_COUNT,
                    );
                  }}
                  disabled={!retention.reticulumEnabled}
                  aria-labelledby="apppanel-message-retention-reticulum-label"
                  aria-label={t('appPanel.capStoredMessagesCountAria', {
                    count: retention.reticulumCount,
                  })}
                  className={`${INPUT_BOX_CLASS} w-24 text-right`}
                />
                <span className="text-ink-300 text-sm">{t('common.messages')}</span>
              </div>
              <div
                data-setting-anchor="app.retention.rrcMessageCap"
                className="border-ink-700 flex items-center gap-2 border-t pt-2"
              >
                <input
                  type="checkbox"
                  id="messageRetentionRrc"
                  checked={retention.rrcEnabled}
                  onChange={(e) => {
                    updateRetentionEnabled('rrc', e.target.checked);
                  }}
                  aria-label={t('appPanel.capStoredRrcMessages')}
                  className="accent-brand-green"
                />
                <label
                  id="apppanel-message-retention-rrc-label"
                  htmlFor="messageRetentionRrc"
                  className="text-ink-300 flex-1 cursor-pointer text-sm"
                >
                  {t('appPanel.capStoredRrcMessagesLabel')}
                </label>
                <input
                  id="apppanel-message-retention-rrc-count"
                  type="number"
                  min={MESSAGE_RETENTION_MIN_COUNT}
                  max={MESSAGE_RETENTION_MAX_COUNT}
                  value={retention.rrcCount}
                  onChange={(e) => {
                    updateRetentionCount(
                      'rrc',
                      Number.parseInt(e.target.value, 10) || MESSAGE_RETENTION_MIN_COUNT,
                    );
                  }}
                  disabled={!retention.rrcEnabled}
                  aria-labelledby="apppanel-message-retention-rrc-label"
                  aria-label={t('appPanel.capStoredRrcMessagesCountAria', {
                    count: retention.rrcCount,
                  })}
                  className={`${INPUT_BOX_CLASS} w-24 text-right`}
                />
                <span className="text-ink-300 text-sm">{t('common.messages')}</span>
              </div>
            </>
          ) : (
            <div
              data-setting-anchor="app.retention.meshtasticMessageCap"
              className="border-ink-700 flex items-center gap-2 border-t pt-2"
            >
              <input
                type="checkbox"
                id="messageRetentionMeshtastic"
                checked={retention.meshtasticEnabled}
                onChange={(e) => {
                  updateRetentionEnabled('meshtastic', e.target.checked);
                }}
                aria-label={t('appPanel.capStoredMessages')}
                className="accent-brand-green"
              />
              <label
                id="apppanel-message-retention-meshtastic-label"
                htmlFor="messageRetentionMeshtastic"
                className="text-ink-300 flex-1 cursor-pointer text-sm"
              >
                {t('appPanel.capStoredMessagesLabel')}
              </label>
              <input
                id="apppanel-message-retention-meshtastic-count"
                type="number"
                min={MESSAGE_RETENTION_MIN_COUNT}
                max={MESSAGE_RETENTION_MAX_COUNT}
                value={retention.meshtasticCount}
                onChange={(e) => {
                  updateRetentionCount(
                    'meshtastic',
                    parseInt(e.target.value, 10) || MESSAGE_RETENTION_MIN_COUNT,
                  );
                }}
                disabled={!retention.meshtasticEnabled}
                aria-labelledby="apppanel-message-retention-meshtastic-label"
                aria-label={t('appPanel.capStoredMessagesCountAria', {
                  count: retention.meshtasticCount,
                })}
                className={`${INPUT_BOX_CLASS} w-24 text-right`}
              />
              <span className="text-ink-300 text-sm">{t('common.messages')}</span>
            </div>
          )}
          <div
            data-setting-anchor="app.retention.compactMessages"
            className="border-ink-700 flex items-center gap-2 border-t pt-2"
          >
            <input
              type="checkbox"
              id="chatCompactMode"
              checked={settings.chatCompactMode}
              onChange={(e) => {
                updateSetting('chatCompactMode', e.target.checked);
              }}
              aria-label={t('appPanel.compactMessages')}
              className="accent-brand-green"
            />
            <label htmlFor="chatCompactMode" className="text-ink-300 cursor-pointer text-sm">
              {t('appPanel.compactMessages')}
            </label>
          </div>
          <div
            data-setting-anchor="app.retention.alwaysShowMessageActions"
            className="flex items-center gap-2"
          >
            <input
              type="checkbox"
              id="alwaysShowMessageActions"
              checked={settings.alwaysShowMessageActions}
              onChange={(e) => {
                updateSetting('alwaysShowMessageActions', e.target.checked);
              }}
              aria-label={t('appPanel.alwaysShowMessageActions')}
              className="accent-brand-green"
            />
            <label
              htmlFor="alwaysShowMessageActions"
              className="text-ink-300 cursor-pointer text-sm"
            >
              {t('appPanel.alwaysShowMessageActions')}
            </label>
            <HelpTooltip text={t('appPanel.alwaysShowMessageActionsDesc')} />
          </div>
          {protocol === 'meshtastic' && (
            <>
              <div
                data-setting-anchor="app.retention.storeForwardHistory"
                className="flex items-center gap-2 pt-2"
              >
                <input
                  type="checkbox"
                  id="storeForwardAutoFetchHistory"
                  checked={settings.storeForwardAutoFetchHistory}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    updateSetting('storeForwardAutoFetchHistory', enabled);
                    void window.electronAPI.appSettings
                      .set('storeForwardAutoFetchHistory', enabled ? 'true' : 'false')
                      .catch((err: unknown) => {
                        console.warn(
                          '[AppPanel] storeForwardAutoFetchHistory persist failed ' +
                            errLikeToLogString(err),
                        );
                      });
                  }}
                  aria-label={t('appPanel.storeForwardAutoFetchHistory')}
                  className="accent-brand-green"
                />
                <label
                  htmlFor="storeForwardAutoFetchHistory"
                  className="text-ink-300 cursor-pointer text-sm"
                >
                  {t('appPanel.storeForwardAutoFetchHistory')}
                </label>
                <HelpTooltip text={t('appPanel.storeForwardAutoFetchHistoryHint')} />
              </div>
              {settings.storeForwardAutoFetchHistory && (
                <div
                  data-setting-anchor="app.retention.storeForwardProfile"
                  className="flex flex-wrap items-center gap-2 pl-6"
                >
                  <label htmlFor="storeForwardHistoryProfile" className="text-ink-300 text-sm">
                    {t('appPanel.storeForwardHistoryProfileLabel')}
                  </label>
                  <select
                    id="storeForwardHistoryProfile"
                    value={settings.storeForwardHistoryProfile}
                    onChange={(e) => {
                      const value = e.target.value === 'aggressive' ? 'aggressive' : 'conservative';
                      updateSetting('storeForwardHistoryProfile', value);
                      void window.electronAPI.appSettings
                        .set('storeForwardHistoryProfile', value)
                        .catch((err: unknown) => {
                          console.warn(
                            '[AppPanel] storeForwardHistoryProfile persist failed ' +
                              errLikeToLogString(err),
                          );
                        });
                    }}
                    aria-label={t('appPanel.storeForwardHistoryProfileAria')}
                    className={SELECT_BOX_CLASS}
                  >
                    <option value="conservative">
                      {t('appPanel.storeForwardHistoryProfileConservative')}
                    </option>
                    <option value="aggressive">
                      {t('appPanel.storeForwardHistoryProfileAggressive')}
                    </option>
                  </select>
                  <HelpTooltip text={t('appPanel.storeForwardHistoryProfileHint')} />
                </div>
              )}
              <div
                data-setting-anchor="app.retention.shareLocationWaypoint"
                className="flex items-center gap-2"
              >
                <input
                  type="checkbox"
                  id="shareLocationSendWaypoint"
                  checked={settings.shareLocationSendWaypoint}
                  onChange={(e) => {
                    updateSetting('shareLocationSendWaypoint', e.target.checked);
                  }}
                  aria-label={t('appPanel.shareLocationSendWaypoint')}
                  className="accent-brand-green"
                />
                <label
                  htmlFor="shareLocationSendWaypoint"
                  className="text-ink-300 cursor-pointer text-sm"
                >
                  {t('appPanel.shareLocationSendWaypoint')}
                </label>
                <HelpTooltip text={t('appPanel.shareLocationSendWaypointHint')} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Support / Bug reports */}
      <div className="space-y-3">
        <h3 className="text-muted text-sm font-medium">{t('appPanel.supportSection')}</h3>
        <p className="text-muted text-xs">{t('appPanel.supportSectionDesc')}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div data-setting-anchor="app.support.exportForGitHub" className="space-y-2">
            <button
              type="button"
              aria-label={t('appPanel.exportForGitHub')}
              disabled={supportBundleExporting !== null}
              onClick={() => void handleExportSupportBundle('github')}
              className={buttonClassName('primary', 'md')}
            >
              {supportBundleExporting === 'github'
                ? t('common.loading')
                : t('appPanel.exportForGitHubButton')}
            </button>
            <p className="text-muted text-xs">{t('appPanel.exportForGitHubDesc')}</p>
          </div>
          <div data-setting-anchor="app.support.exportForDeveloper" className="space-y-2">
            <button
              type="button"
              aria-label={t('appPanel.exportForDeveloper')}
              disabled={supportBundleExporting !== null}
              onClick={() => void handleExportSupportBundle('developer')}
              className="bg-secondary-dark text-ink-300 hover:bg-ink-600 w-full rounded-lg px-4 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {supportBundleExporting === 'developer'
                ? t('common.loading')
                : t('appPanel.exportForDeveloperButton')}
            </button>
            <p className="text-xs text-orange-300">{t('appPanel.exportForDeveloperWarning')}</p>
          </div>
        </div>
      </div>

      {/* Data Management */}
      <div className="space-y-3">
        <h3 className="text-muted text-sm font-medium">{t('appPanel.dataManagementSection')}</h3>
        <p className="text-muted text-xs">{t('appPanel.dataManagementDesc')}</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          <button
            data-setting-anchor="app.data.exportDatabase"
            type="button"
            aria-label={t('appPanel.exportDatabase')}
            onClick={async () => {
              try {
                console.debug('[AppPanel] exportDb');
                const path = await window.electronAPI.db.exportDb();
                if (path) {
                  addToast(t('appPanel.exportedTo', { path }), 'success');
                }
              } catch (err) {
                console.warn('[AppPanel] export failed ' + errLikeToLogString(err));
                addToast(
                  t('appPanel.exportFailed', {
                    message: err instanceof Error ? err.message : t('appPanel.unknownError'),
                  }),
                  'error',
                );
              }
            }}
            className="bg-secondary-dark text-ink-300 hover:bg-ink-600 rounded-lg px-4 py-3 text-sm font-medium transition-colors"
          >
            {t('appPanel.exportDatabaseButton')}
          </button>

          <button
            data-setting-anchor="app.data.copyDebugSnapshot"
            type="button"
            aria-label={t('appPanel.copyDebugSnapshot')}
            onClick={async () => {
              try {
                const copied = await copyDebugSnapshotToClipboard();
                if (copied) {
                  addToast(t('appPanel.debugSnapshotCopied'), 'success');
                } else {
                  addToast(t('appPanel.debugSnapshotFailed'), 'error');
                }
              } catch (err) {
                console.warn('[AppPanel] debug snapshot failed ' + errLikeToLogString(err));
                addToast(t('appPanel.debugSnapshotFailed'), 'error');
              }
            }}
            className="bg-secondary-dark text-ink-300 hover:bg-ink-600 rounded-lg px-4 py-3 text-sm font-medium transition-colors"
          >
            {t('appPanel.copyDebugSnapshotButton')}
          </button>

          <button
            data-setting-anchor="app.data.importMerge"
            type="button"
            aria-label={t('appPanel.importMerge')}
            onClick={async () => {
              try {
                console.debug('[AppPanel] importDb');
                const result = await window.electronAPI.db.importDb();
                if (result) {
                  addToast(
                    t('appPanel.dbMerged', {
                      nodesAdded: result.nodesAdded,
                      messagesAdded: result.messagesAdded,
                    }),
                    'success',
                  );
                }
              } catch (err) {
                console.warn('[AppPanel] import failed ' + errLikeToLogString(err));
                const schemaTooNew =
                  err instanceof Error ? parseDatabaseSchemaTooNewFromMessage(err.message) : null;
                addToast(
                  schemaTooNew
                    ? t('appPanel.importSchemaTooNew', {
                        dbVersion: schemaTooNew.dbVersion,
                        appVersion: schemaTooNew.appVersion,
                      })
                    : t('appPanel.importFailed', {
                        message: err instanceof Error ? err.message : t('appPanel.unknownError'),
                      }),
                  'error',
                );
              }
            }}
            className="bg-secondary-dark text-ink-300 hover:bg-ink-600 rounded-lg px-4 py-3 text-sm font-medium transition-colors"
          >
            {t('appPanel.importMergeButton')}
          </button>
        </div>
      </div>

      {/* Appearance — collapsible; preset-only colors (no text input — Electron macOS menu warnings). */}
      <div className="space-y-2">
        <h3 className="text-muted text-sm font-medium">{t('appPanel.appearanceSection')}</h3>
        <div
          data-setting-anchor="app.appearance.reduceMotion"
          className="bg-deep-black border-ink-800 flex items-center gap-2 rounded-xl border px-4 py-3"
        >
          <input
            type="checkbox"
            id="reduceMotion"
            checked={settings.reduceMotion}
            onChange={(e) => {
              updateSetting('reduceMotion', e.target.checked);
            }}
            aria-label={t('appPanel.reduceMotion')}
            className="accent-brand-green"
          />
          <label htmlFor="reduceMotion" className="text-ink-300 cursor-pointer text-sm">
            {t('appPanel.reduceMotion')}
          </label>
          <HelpTooltip text={t('appPanel.reduceMotionDesc')} />
        </div>
        <div
          data-setting-anchor="app.appearance.use24HourTime"
          className="bg-deep-black border-ink-800 flex items-center gap-2 rounded-xl border px-4 py-3"
        >
          <input
            type="checkbox"
            id="use24HourTime"
            checked={settings.use24HourTime}
            onChange={(e) => {
              updateSetting('use24HourTime', e.target.checked);
              useTimeFormatStore.getState().setUse24HourTime(e.target.checked);
            }}
            aria-label={t('appPanel.use24HourTime')}
            className="accent-brand-green"
          />
          <label htmlFor="use24HourTime" className="text-ink-300 cursor-pointer text-sm">
            {t('appPanel.use24HourTime')}
          </label>
          <HelpTooltip text={t('appPanel.use24HourTimeDesc')} />
        </div>
        <div
          data-setting-anchor="app.appearance.fontSize"
          className="bg-deep-black border-ink-800 flex flex-col gap-2 rounded-xl border px-4 py-3"
        >
          <div className="flex items-center gap-2">
            <label htmlFor="fontScale" className="text-ink-300 cursor-pointer text-sm">
              {t('appPanel.fontSize')}
            </label>
            <HelpTooltip text={t('appPanel.fontSizeDesc')} />
            <span className="text-muted ml-auto text-xs" aria-live="polite">
              {Math.round(fontScale * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={t('appPanel.decreaseFontSize')}
              onClick={() => {
                updateFontScale(fontScale - FONT_SCALE_STEP);
              }}
              disabled={fontScale <= FONT_SCALE_MIN}
              className="border-ink-600 text-ink-300 hover:bg-ink-600 rounded border px-2 py-1 text-sm transition-colors disabled:opacity-40"
            >
              −
            </button>
            <input
              id="fontScale"
              type="range"
              min={FONT_SCALE_MIN}
              max={FONT_SCALE_MAX}
              step={FONT_SCALE_STEP}
              value={fontScale}
              aria-label={t('appPanel.fontSize')}
              onChange={(e) => {
                updateFontScale(Number.parseFloat(e.target.value));
              }}
              className="accent-brand-green flex-1"
            />
            <button
              type="button"
              aria-label={t('appPanel.increaseFontSize')}
              onClick={() => {
                updateFontScale(fontScale + FONT_SCALE_STEP);
              }}
              disabled={fontScale >= FONT_SCALE_MAX}
              className="border-ink-600 text-ink-300 hover:bg-ink-600 rounded border px-2 py-1 text-sm transition-colors disabled:opacity-40"
            >
              +
            </button>
            <button
              type="button"
              aria-label={t('appPanel.resetFontSizeAria')}
              onClick={handleResetFontScale}
              className="text-muted hover:text-ink-300 text-xs underline transition-colors"
            >
              {t('appPanel.resetFontSize')}
            </button>
          </div>
        </div>
        <div data-setting-anchor="app.appearance.themePresets">
          <ThemePicker
            colors={themeColors}
            surfaceId={themeSurfaceId}
            onSurfaceSelect={handleThemeSurfaceSelect}
            onAccentSelect={handleThemeAccentSelect}
          />
        </div>
        <details
          data-setting-anchor="app.appearance.colorScheme"
          className="group bg-deep-black border-secondary-dark rounded-lg border"
        >
          <summary className="text-ink-200 hover:bg-ink-800/40 flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span>{t('appPanel.colorScheme')}</span>
            <DetailsChevron className="text-muted h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-ink-700 space-y-3 border-t px-4 pt-1 pb-4">
            <p className="text-muted text-xs">{t('appPanel.themeColorsApplyHint')}</p>
            {THEME_TOKEN_META.map((meta) => {
              const hex = themeColors[meta.key];
              // messageActionsBarBg is hidden (opacity 0) until the "Show background"
              // checkbox is on — fade the preview swatch to match what's actually applied.
              const swatchOpacity =
                meta.key === 'messageActionsBarBg' && !messageActionsBarBgVisible ? 0.15 : 1;
              return (
                <div
                  key={meta.key}
                  className="border-ink-600/80 flex flex-wrap items-center gap-2 border-b pb-2 last:border-0 last:pb-0"
                >
                  <span
                    className="border-ink-600 h-6 w-6 shrink-0 rounded border"
                    style={{ backgroundColor: hex, opacity: swatchOpacity }}
                    title={hex}
                    aria-hidden="true"
                  />
                  <div
                    id={`theme-color-heading-${meta.key}`}
                    className="max-w-[9rem] min-w-[6.5rem] shrink-0"
                  >
                    <div className="text-ink-200 text-sm font-medium">{t(meta.labelKey)}</div>
                    <div className="text-muted text-2xs mt-0.5 leading-tight">
                      {t(meta.descriptionKey)}
                    </div>
                  </div>
                  <div
                    className="flex max-w-full min-w-0 flex-1 [scrollbar-width:thin] flex-nowrap gap-1 py-0.5"
                    role="group"
                    aria-labelledby={`theme-color-heading-${meta.key}`}
                  >
                    {THEME_COLOR_PRESETS.map((p) => {
                      const selected = p.hex === hex;
                      const presetLabel = t(p.labelKey);
                      return (
                        <button
                          key={`${meta.key}-${p.hex}`}
                          type="button"
                          title={presetLabel}
                          aria-label={`${presetLabel} ${p.hex}`}
                          aria-pressed={selected}
                          onClick={() => {
                            commitThemeColor(meta.key, p.hex);
                          }}
                          className={`focus:ring-brand-green/50 h-6 w-6 shrink-0 rounded border transition-transform hover:scale-110 focus:ring-2 focus:outline-none ${
                            selected
                              ? 'ring-brand-green ring-offset-deep-black ring-2 ring-offset-1'
                              : 'border-ink-600'
                          }`}
                          style={{ backgroundColor: p.hex }}
                        />
                      );
                    })}
                    {meta.key === 'messageActionsBarBg' && (
                      <label
                        data-setting-anchor="app.appearance.messageActionsBackground"
                        className="ml-2 flex items-center gap-1.5"
                      >
                        <input
                          type="checkbox"
                          checked={messageActionsBarBgVisible}
                          onChange={(e) => {
                            const newValue = e.target.checked;
                            setMessageActionsBarBgVisibleState(newValue);
                            setMessageActionsBarBgVisible(newValue);
                          }}
                          className="h-4 w-4"
                          aria-label={t('appPanel.messageActionsBarBgVisible')}
                        />
                        <span className="text-2xs text-ink-400">
                          {t('appPanel.messageActionsBarBgVisible')}
                        </span>
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
            <div data-setting-anchor="app.appearance.saveTheme" className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveThemeSnapshot}
                aria-label={t('appPanel.saveTheme')}
                className="bg-deep-black border-ink-600 text-ink-300 hover:bg-ink-700 flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
              >
                {t('appPanel.saveThemeButton')}
              </button>
              <button
                type="button"
                onClick={handleRestoreThemeSnapshot}
                disabled={!hasSavedThemeSnapshot}
                aria-label={t('appPanel.restoreTheme')}
                title={hasSavedThemeSnapshot ? undefined : t('appPanel.noSavedThemeTooltip')}
                className="bg-deep-black border-ink-600 text-ink-300 hover:bg-ink-700 flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('appPanel.restoreThemeButton')}
              </button>
              <button
                type="button"
                onClick={handleResetThemeColors}
                aria-label={t('appPanel.resetAllColors')}
                className="bg-deep-black border-ink-600 text-ink-300 hover:bg-ink-700 flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
              >
                {t('appPanel.resetAllColorsButton')}
              </button>
            </div>
          </div>
        </details>
      </div>

      {/* Notifications */}
      <div className="space-y-2">
        <h3 className="text-muted text-sm font-medium">{t('appPanel.notificationsSection')}</h3>
        <div data-setting-anchor="app.notifications.sound" className="flex items-center gap-3">
          <input
            type="checkbox"
            id="soundNotifications"
            checked={soundNotifEnabled}
            onChange={(e) => {
              setSoundNotifEnabled(e.target.checked);
            }}
            aria-label={t('appPanel.soundNotifications')}
            className="accent-brand-green h-4 w-4 rounded"
          />
          <label htmlFor="soundNotifications" className="text-ink-300 cursor-pointer text-sm">
            {t('appPanel.soundNotifications')}
          </label>
        </div>
        <div data-setting-anchor="app.notifications.sounds">
          <NotificationSoundSettings />
        </div>
        <div className="border-ink-700/60 space-y-2 border-t pt-2">
          <h4 className="text-muted text-xs font-medium">{t('appPanel.opsAlertsHeading')}</h4>
          <div
            data-setting-anchor="app.notifications.nodeSilenceAlert"
            className="flex flex-col gap-1"
          >
            <label htmlFor="nodeSilenceAlertMinutes" className="text-ink-300 text-sm">
              {t('appPanel.nodeSilenceAlertMinutes')}
            </label>
            <input
              id="nodeSilenceAlertMinutes"
              type="number"
              min={1}
              max={10080}
              placeholder={t('appPanel.nodeSilenceAlertMinutesPlaceholder')}
              aria-label={t('appPanel.nodeSilenceAlertMinutes')}
              value={settings.nodeSilenceAlertMinutes ?? ''}
              onChange={(e) => {
                const raw = e.target.value.trim();
                updateSetting(
                  'nodeSilenceAlertMinutes',
                  raw === '' ? null : Math.max(1, parseInt(raw, 10) || 1),
                );
              }}
              className={`${INPUT_BOX_CLASS} w-40`}
            />
            <p className="text-muted text-xs">{t('appPanel.nodeSilenceAlertMinutesHint')}</p>
          </div>
          <div data-setting-anchor="app.notifications.batteryLow" className="flex flex-col gap-1">
            <label htmlFor="nodeBatteryLowThreshold" className="text-ink-300 text-sm">
              {t('appPanel.nodeBatteryLowThreshold')}
            </label>
            <input
              id="nodeBatteryLowThreshold"
              type="number"
              min={1}
              max={100}
              aria-label={t('appPanel.nodeBatteryLowThreshold')}
              value={settings.nodeBatteryLowThreshold}
              onChange={(e) => {
                updateSetting(
                  'nodeBatteryLowThreshold',
                  Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 10)),
                );
              }}
              className={`${INPUT_BOX_CLASS} w-40`}
            />
          </div>
          <div data-setting-anchor="app.notifications.linkDown" className="flex items-center gap-3">
            <input
              type="checkbox"
              id="notifyOnLinkDown"
              checked={settings.notifyOnLinkDown}
              onChange={(e) => {
                updateSetting('notifyOnLinkDown', e.target.checked);
              }}
              aria-label={t('appPanel.notifyOnLinkDown')}
              className="accent-brand-green h-4 w-4 rounded"
            />
            <label htmlFor="notifyOnLinkDown" className="text-ink-300 cursor-pointer text-sm">
              {t('appPanel.notifyOnLinkDown')}
            </label>
          </div>
        </div>
        {hasRrcPanel && (
          <div data-setting-anchor="app.notifications.rrcUnreadAll" className="space-y-1">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="rrcUnreadAllRoomMessages"
                checked={settings.rrcUnreadAllRoomMessages}
                onChange={(e) => {
                  updateSetting('rrcUnreadAllRoomMessages', e.target.checked);
                }}
                aria-label={t('appPanel.rrcUnreadAllRoomMessages')}
                className="accent-brand-green h-4 w-4 rounded"
              />
              <label
                htmlFor="rrcUnreadAllRoomMessages"
                className="text-ink-300 cursor-pointer text-sm"
              >
                {t('appPanel.rrcUnreadAllRoomMessages')}
              </label>
            </div>
            <p className="text-muted pl-7 text-xs leading-relaxed">
              {t('appPanel.rrcUnreadAllRoomMessagesHint')}
            </p>
          </div>
        )}
      </div>

      <section
        className="space-y-3 rounded-lg border border-red-900/40 bg-red-950/10 p-4"
        aria-label={t('mecp.section.title')}
      >
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-red-200">{t('mecp.section.title')}</h3>
          <p className="text-muted text-xs leading-relaxed">{t('mecp.section.hint')}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <a
              href="https://mecp.radio/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-green text-xs underline-offset-2 hover:underline"
              aria-label={t('mecp.section.learnMore')}
            >
              {t('mecp.section.learnMore')}
            </a>
            <a
              href="https://github.com/xiang-dev-1/MECP"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted text-xs underline-offset-2 hover:underline"
              aria-label={t('mecp.section.protocolSource')}
            >
              {t('mecp.section.protocolSource')}
            </a>
          </div>
        </div>
        <div data-setting-anchor="app.mecp.showComposeButton" className="space-y-1">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="mecpComposeEnabled"
              checked={settings.mecpComposeEnabled}
              onChange={(e) => {
                updateSetting('mecpComposeEnabled', e.target.checked);
              }}
              aria-label={t('mecp.section.showComposeButton')}
              className="accent-brand-green h-4 w-4 rounded"
            />
            <label htmlFor="mecpComposeEnabled" className="text-ink-300 cursor-pointer text-sm">
              {t('mecp.section.showComposeButton')}
            </label>
          </div>
          <p className="text-muted pl-7 text-xs leading-relaxed">
            {t('mecp.section.showComposeButtonHint')}
          </p>
        </div>
        <button
          data-setting-anchor="app.mecp.exportLog"
          type="button"
          disabled={mecpExportBusy}
          className="border-ink-600 bg-ink-900/60 text-ink-200 hover:bg-ink-800 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
          aria-label={t('mecp.exportLog')}
          onClick={() => {
            if (mecpExportBusy) return;
            setMecpExportBusy(true);
            void window.electronAPI.mecp
              .exportReceivedLog()
              .then((res) => {
                if (res.success) {
                  addToast(
                    res.path
                      ? t('mecp.exportLogSuccessPath', { path: res.path })
                      : t('mecp.exportLogSuccess'),
                    'success',
                  );
                  return;
                }
                if (res.reason === 'empty') {
                  addToast(t('mecp.exportLogEmpty'), 'info');
                  return;
                }
                if (res.reason === 'cancelled') return;
                addToast(t('mecp.exportLogFailed'), 'error');
              })
              .catch((err: unknown) => {
                console.warn(
                  '[AppPanel] MECP export failed',
                  err instanceof Error ? err.message : err,
                );
                addToast(t('mecp.exportLogFailed'), 'error');
              })
              .finally(() => {
                setMecpExportBusy(false);
              });
          }}
        >
          {t('mecp.exportLog')}
        </button>
        <div data-setting-anchor="app.mecp.rebroadcast">
          <MecpRebroadcastSettings />
        </div>
      </section>

      {/* Danger Zone — collapsible; same pattern as Appearance → Color scheme */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-red-400">{t('appPanel.dangerZoneSection')}</h3>
        <details className="group rounded-lg border border-red-900 bg-red-950/20">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium text-red-300 hover:bg-red-950/40 [&::-webkit-details-marker]:hidden">
            <span>{t('appPanel.destructiveActions')}</span>
            <DetailsChevron className="text-muted h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-4 border-t border-red-900/50 px-4 pt-1 pb-4">
            <p className="text-xs text-red-400/80">{t('appPanel.dangerZoneIntro')}</p>

            {/* Diagnostics (in-memory reset) */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-red-400/90">
                {t('appPanel.dangerZoneDiagnosticsHeading')}
              </div>
              <p className="text-muted text-xs leading-relaxed">
                {t('appPanel.dangerZoneDiagnosticsDesc')}
              </p>
              <button
                data-setting-anchor="app.danger.resetDiagnostics"
                type="button"
                aria-label={t('appPanel.resetDiagnostics')}
                onClick={() => {
                  executeWithConfirmation({
                    actionId: 'resetDiagnostics',
                    title: t('appPanel.resetDiagnostics'),
                    message: t('appPanel.resetDiagnosticsConfirm'),
                    confirmLabel: t('appPanel.resetDiagnostics'),
                    danger: true,
                    action: async () => {
                      await Promise.resolve();
                      clearDiagnostics();
                    },
                  });
                }}
                className={buttonClassName('danger', 'md')}
              >
                {t('appPanel.resetDiagnostics')}
              </button>
            </div>

            <div className="space-y-2 border-t border-red-900/50 pt-4">
              <div className="text-xs font-medium text-red-400/90">
                {t('appPanel.dangerZoneGpsHeading')}
              </div>
              <p className="text-muted text-xs leading-relaxed">
                {t('appPanel.dangerZoneGpsDesc')}
              </p>
              <button
                data-setting-anchor="app.danger.clearGpsData"
                type="button"
                aria-label={t('appPanel.clearGpsData')}
                onClick={() => {
                  executeWithConfirmation({
                    actionId: 'clearGpsData',
                    title: t('appPanel.clearGpsData'),
                    message: t('appPanel.clearGpsDataConfirm'),
                    confirmLabel: t('appPanel.clearGpsData'),
                    danger: true,
                    action: async () => {
                      await window.electronAPI.db.clearNodePositions();
                    },
                  });
                }}
                className={buttonClassName('danger', 'md')}
              >
                {t('appPanel.clearGpsData')}
              </button>
            </div>

            <div className="space-y-2 border-t border-red-900/50 pt-4">
              <div className="text-xs font-medium text-red-400/90">
                {t('appPanel.dangerZonePositionHistoryHeading')}
              </div>
              <p className="text-muted text-xs leading-relaxed">
                {t('appPanel.dangerZonePositionHistoryDesc')}
              </p>
              <button
                data-setting-anchor="app.danger.clearPositionHistory"
                type="button"
                aria-label={t('appPanel.clearPositionHistory')}
                onClick={() => {
                  executeWithConfirmation({
                    actionId: 'clearPositionHistory',
                    title: t('appPanel.clearPositionHistory'),
                    message: t('appPanel.clearPositionHistoryConfirm'),
                    confirmLabel: t('appPanel.clearPositionHistory'),
                    danger: true,
                    action: async () => {
                      await Promise.resolve();
                      clearHistory();
                    },
                  });
                }}
                className={buttonClassName('danger', 'md')}
              >
                {t('appPanel.clearPositionHistory')}
              </button>
            </div>

            {/* Nodes */}
            <div className="space-y-3 border-t border-red-900/50 pt-4">
              <div className="text-xs font-medium text-red-400/90">
                {t('appPanel.dangerZoneNodesHeading')}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="apppanel-delete-age-days" className="text-ink-300 text-sm">
                  {t('appPanel.deleteNodesOlderThanLabel')}
                </label>
                <input
                  id="apppanel-delete-age-days"
                  type="number"
                  min={1}
                  value={deleteAgeDays}
                  onChange={(e) => {
                    setDeleteAgeDays(Math.max(1, parseInt(e.target.value) || 1));
                  }}
                  aria-label={t('appPanel.deleteNodesOlderThanAria', { days: deleteAgeDays })}
                  className="bg-app-bg text-body text-ink-200 h-8 w-20 rounded-lg border border-red-800/60 px-2.5 text-right focus:border-red-500 focus:outline-none pointer-coarse:h-10"
                />
                <span className="text-ink-300 text-sm">{t('common.days')}</span>
                <button
                  data-setting-anchor="app.danger.deleteOldNodes"
                  type="button"
                  aria-label={t('appPanel.deleteOldNodes')}
                  onClick={() => {
                    executeWithConfirmation({
                      actionId: 'deleteOldNodes',
                      title: t('appPanel.deleteOldNodes'),
                      message: t('appPanel.deleteOldNodesConfirm', {
                        days: deleteAgeDays,
                        count: deleteAgeDays,
                      }),
                      confirmLabel: t('appPanel.deleteOldNodes'),
                      danger: true,
                      action: async () => {
                        await window.electronAPI.db.deleteNodesByAge(deleteAgeDays);
                      },
                    });
                  }}
                  className={buttonClassName('danger', 'md')}
                >
                  {t('appPanel.deleteOldNodes')}
                </button>
              </div>
              <button
                data-setting-anchor="app.danger.pruneMqttOnlyNodes"
                type="button"
                aria-label={t('appPanel.pruneMqttOnlyNodes')}
                onClick={() => {
                  executeWithConfirmation({
                    actionId: 'pruneMqttOnlyNodes',
                    title: t('appPanel.pruneMqttOnlyNodes'),
                    message: t('appPanel.pruneMqttOnlyNodesConfirm'),
                    confirmLabel: t('appPanel.pruneMqttNodesConfirmLabel'),
                    danger: true,
                    action: async () => {
                      await window.electronAPI.db.deleteNodesBySource('mqtt');
                    },
                  });
                }}
                className={DANGER_ROW_CLASS}
              >
                {t('appPanel.pruneMqttOnlyNodes')}
              </button>
              <button
                data-setting-anchor="app.danger.pruneUnnamedNodes"
                type="button"
                aria-label={t('appPanel.pruneUnnamedNodes')}
                onClick={() => {
                  executeWithConfirmation({
                    actionId: 'pruneUnnamedNodes',
                    title: t('appPanel.pruneUnnamedNodes'),
                    message: t('appPanel.pruneUnnamedNodesConfirm'),
                    confirmLabel: t('appPanel.pruneUnnamedNodes'),
                    danger: true,
                    action: async () => {
                      await window.electronAPI.db.deleteNodesWithoutLongname();
                    },
                  });
                }}
                className={DANGER_ROW_CLASS}
              >
                {t('appPanel.pruneUnnamedNodes')}
              </button>
              <button
                data-setting-anchor="app.danger.pruneNoFixNodes"
                type="button"
                aria-label={t('appPanel.pruneNoFixNodes')}
                onClick={() => {
                  const zeroIslandNodes = Array.from(resolveNodes().values()).filter(
                    (n) => Math.abs(n.latitude ?? 0) < 0.5 && Math.abs(n.longitude ?? 0) < 0.5,
                  );
                  if (zeroIslandNodes.length === 0) {
                    addToast(t('appPanel.noNoFixNodes'), 'success');
                    return;
                  }
                  executeWithConfirmation({
                    actionId: 'pruneNoFixNodes',
                    title: t('appPanel.pruneNoFixNodesTitle'),
                    message: t('appPanel.pruneNoFixNodesConfirm', {
                      count: zeroIslandNodes.length,
                    }),
                    confirmLabel: t('appPanel.pruneNoFixDeleteConfirm', {
                      count: zeroIslandNodes.length,
                    }),
                    danger: true,
                    action: async () => {
                      await window.electronAPI.db.deleteNodesBatch(
                        zeroIslandNodes.map((n) => n.node_id),
                      );
                    },
                  });
                }}
                className={DANGER_ROW_CLASS}
              >
                <div className="font-medium">{t('appPanel.pruneNoFixNodesTitle')}</div>
                <div className="text-muted text-xs font-normal">
                  {t('appPanel.pruneNoFixSubtitle')}
                </div>
              </button>
              <button
                data-setting-anchor="app.danger.pruneDistantNodes"
                type="button"
                aria-label={t('appPanel.pruneDistantNodes')}
                onClick={() => {
                  const nodes = resolveNodes();
                  const homeNode = myNodeNum != null ? nodes.get(myNodeNum) : undefined;
                  const homeLat = homeNode?.latitude ?? ourPosition?.lat;
                  const homeLon = homeNode?.longitude ?? ourPosition?.lon;
                  const hasHome =
                    homeLat != null && homeLon != null && (homeLat !== 0 || homeLon !== 0);
                  if (!hasHome) {
                    addToast(t('appPanel.noGpsPosition'), 'error');
                    return;
                  }
                  const maxKm =
                    settings.distanceUnit === 'miles'
                      ? settings.distanceFilterMax * 1.60934
                      : settings.distanceFilterMax;
                  const distantNodes = Array.from(nodes.values()).filter((n) => {
                    if (n.node_id === myNodeNum) return false;
                    if (n.latitude == null || n.longitude == null) return false;
                    const d = haversineDistanceKm(homeLat, homeLon, n.latitude, n.longitude);
                    return d > maxKm;
                  });
                  if (distantNodes.length === 0) {
                    addToast(t('appPanel.noNodesAboveDistance'), 'success');
                    return;
                  }
                  executeWithConfirmation({
                    actionId: 'pruneDistantNodes',
                    title: t('appPanel.pruneDistantNodesTitle'),
                    message: t('appPanel.pruneDistantNodesConfirm', {
                      count: distantNodes.length,
                      distance: settings.distanceFilterMax,
                      unit: settings.distanceUnit,
                    }),
                    confirmLabel: t('appPanel.pruneDistantDeleteConfirm', {
                      count: distantNodes.length,
                    }),
                    danger: true,
                    action: async () => {
                      await window.electronAPI.db.deleteNodesBatch(
                        distantNodes.map((n) => n.node_id),
                      );
                    },
                  });
                }}
                className={DANGER_ROW_CLASS}
              >
                <div className="font-medium">{t('appPanel.pruneDistantNodesTitle')}</div>
                <div className="text-muted text-xs font-normal">
                  {t('appPanel.pruneDistantSubtitle')}
                </div>
              </button>
              <button
                data-setting-anchor="app.danger.pruneOfflineNodes"
                type="button"
                aria-label={t('appPanel.pruneOfflineNodes')}
                onClick={() => {
                  const offlineNodes = Array.from(resolveNodes().values()).filter(
                    (n) =>
                      n.node_id !== myNodeNum &&
                      !n.favorited &&
                      getNodeStatus(n.last_heard, nodeStaleThresholdMs, nodeOfflineThresholdMs) ===
                        'offline',
                  );
                  if (offlineNodes.length === 0) {
                    addToast(t('appPanel.noOfflineNodes'), 'success');
                    return;
                  }
                  const offlineDays = Math.round(nodeOfflineThresholdMs / (24 * 60 * 60 * 1000));
                  executeWithConfirmation({
                    actionId: 'pruneOfflineNodes',
                    title: t('appPanel.pruneOfflineNodesTitle'),
                    message: t('appPanel.pruneOfflineNodesConfirm', {
                      count: offlineNodes.length,
                      days: offlineDays,
                      daysLabel: offlineDays === 1 ? t('appPanel.daySingular') : t('common.days'),
                    }),
                    confirmLabel: t('appPanel.pruneOfflineDeleteConfirm', {
                      count: offlineNodes.length,
                    }),
                    danger: true,
                    action: async () => {
                      await window.electronAPI.db.deleteNodesBatch(
                        offlineNodes.map((n) => n.node_id),
                      );
                    },
                  });
                }}
                className={DANGER_ROW_CLASS}
              >
                <div className="font-medium">{t('appPanel.pruneOfflineNodesTitle')}</div>
                <div className="text-muted text-xs font-normal">
                  {t('appPanel.pruneOfflineSubtitle', {
                    days: Math.round(nodeOfflineThresholdMs / (24 * 60 * 60 * 1000)),
                  })}
                </div>
              </button>
              <button
                data-setting-anchor="app.danger.clearAllNodes"
                type="button"
                aria-label={t('appPanel.clearAllNodesButton', { count: nodeCount })}
                onClick={() => {
                  executeWithConfirmation({
                    actionId: 'clearNodes',
                    title: t('appPanel.clearAllNodesButton', { count: nodeCount }),
                    message: t('appPanel.clearNodesConfirm', { count: nodeCount }),
                    confirmLabel: t('appPanel.clearNodesConfirmLabel', { count: nodeCount }),
                    danger: true,
                    action: async () => {
                      await window.electronAPI.db.clearNodes();
                    },
                  });
                }}
                className={DANGER_ROW_CLASS}
              >
                {t('appPanel.clearAllNodesButton', { count: nodeCount })}
              </button>

              {/* MeshCore contacts cleanup */}
              {protocol === 'meshcore' && (
                <button
                  data-setting-anchor="app.danger.deleteContactsWithoutPubkeys"
                  type="button"
                  aria-label={t('appPanel.deleteNodesWithoutPubkeys')}
                  onClick={() => {
                    executeWithConfirmation({
                      actionId: 'deleteContactsNoPubkeys',
                      title: t('appPanel.deleteContactsNoPubkeysTitle'),
                      message: t('appPanel.deleteContactsNoPubkeysConfirm'),
                      confirmLabel: t('appPanel.deleteContactsNoPubkeysConfirmButton'),
                      danger: true,
                      action: async () => {
                        const result =
                          await window.electronAPI.db.deleteMeshcoreContactsWithoutPubkey();
                        addToast(
                          t('appPanel.deletedContactsNoPubkey', {
                            deleted: result.deleted,
                            excludedStubCount: result.excludedStubCount,
                          }),
                          'success',
                        );
                      },
                    });
                  }}
                  className={DANGER_ROW_CLASS}
                >
                  <div className="font-medium">{t('appPanel.deleteContactsNoPubkeysTitle')}</div>
                  <div className="text-muted text-xs font-normal">
                    {t('appPanel.deleteContactsWithoutPubkeysSubtitle')}
                  </div>
                </button>
              )}
            </div>

            {/* Reticulum contacts */}
            {protocol === 'reticulum' && (
              <div className="space-y-2 border-t border-red-900/50 pt-4">
                <div className="text-xs font-medium text-red-400/90">
                  {t('appPanel.dangerZoneReticulumHeading')}
                </div>
                <p className="text-muted text-xs leading-relaxed">
                  {t('appPanel.clearReticulumContactsDesc')}
                </p>
                <button
                  type="button"
                  data-setting-anchor="app.danger.clearReticulumContacts"
                  disabled={!reticulumSidecarReady}
                  aria-label={t('appPanel.clearReticulumContactsButton', {
                    count: reticulumContactCount,
                  })}
                  onClick={() => {
                    executeWithConfirmation({
                      actionId: 'clearReticulumContacts',
                      title: t('appPanel.clearReticulumContactsTitle'),
                      message: t('appPanel.clearReticulumContactsConfirm', {
                        count: reticulumContactCount,
                      }),
                      confirmLabel: t('appPanel.clearReticulumContactsConfirmButton', {
                        count: reticulumContactCount,
                      }),
                      danger: true,
                      action: async () => {
                        await clearAllReticulumContacts();
                      },
                    });
                  }}
                  className={DANGER_ROW_CLASS}
                >
                  <div className="font-medium">
                    {t('appPanel.clearReticulumContactsButton', {
                      count: reticulumContactCount,
                    })}
                  </div>
                </button>
              </div>
            )}

            {/* Messages */}
            <div className="space-y-2 border-t border-red-900/50 pt-4">
              <div className="text-xs font-medium text-red-400/90">
                {t('appPanel.messagesSection')}
              </div>
              {isReticulumDmOnly ? (
                <p className="text-muted text-xs leading-relaxed">
                  {t('appPanel.reticulumDmOnlyMessagesHint')}
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <label htmlFor="apppanel-clear-channel" className="text-ink-400 shrink-0 text-sm">
                    {t('appPanel.clearChannelLabel')}
                  </label>
                  <select
                    id="apppanel-clear-channel"
                    value={clearChannelTarget}
                    onChange={(e) => {
                      setClearChannelTarget(parseInt(e.target.value, 10));
                    }}
                    aria-label={t('common.channel')}
                    className="bg-app-bg text-body text-ink-200 h-8 flex-1 rounded-lg border border-red-800/60 px-2 focus:border-red-500 focus:outline-none pointer-coarse:h-10"
                  >
                    <option value={CLEAR_ALL_CHANNELS_VALUE}>
                      {t('appPanel.allChannelsOption')}
                    </option>
                    {msgChannels.map((ch) => (
                      <option key={ch} value={ch}>
                        {getChannelLabel(ch)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                data-setting-anchor="app.danger.clearMessages"
                type="button"
                aria-label={t('appPanel.clearMessagesCount', { count: messageCount })}
                onClick={() => {
                  if (isReticulumDmOnly) {
                    executeWithConfirmation({
                      actionId: 'clearMessages',
                      title: t('appPanel.clearReticulumMessagesTitle'),
                      message: t('appPanel.clearReticulumMessagesConfirm', { count: messageCount }),
                      confirmLabel: t('appPanel.clearReticulumMessagesConfirmButton', {
                        count: messageCount,
                      }),
                      danger: true,
                      messageClearMeta: {
                        clearedAll: true,
                        replaceFromDb: true,
                        messagesMode: 'replace',
                      },
                      action: async () => {
                        if (!reticulumIdentityId) return;
                        await window.electronAPI.db.clearReticulumMessages(reticulumIdentityId);
                      },
                    });
                    return;
                  }
                  const isAll = clearChannelTarget === CLEAR_ALL_CHANNELS_VALUE;
                  const channelName = isAll ? '' : getChannelLabel(clearChannelTarget);
                  executeWithConfirmation({
                    actionId: 'clearMessages',
                    title: t('appPanel.clearMessagesTitle'),
                    message: isAll
                      ? t('appPanel.clearMessagesAllConfirm', { count: messageCount })
                      : t('appPanel.clearMessagesChannelConfirm', { channel: channelName }),
                    confirmLabel: isAll
                      ? t('appPanel.clearMessagesAllConfirmLabel', { count: messageCount })
                      : t('appPanel.clearMessagesChannelConfirmLabel', { channel: channelName }),
                    danger: true,
                    messageClearMeta: isAll
                      ? { clearedAll: true, replaceFromDb: true, messagesMode: 'replace' }
                      : {
                          clearedChannel: clearChannelTarget,
                          replaceFromDb: true,
                          messagesMode: 'replace',
                        },
                    action: async () => {
                      if (protocol === 'meshcore') {
                        if (isAll) {
                          await window.electronAPI.db.clearMeshcoreMessages();
                        } else {
                          await window.electronAPI.db.clearMeshcoreMessagesByChannel(
                            clearChannelTarget,
                            myNodeNum ?? 0,
                          );
                        }
                      } else if (isAll) {
                        await window.electronAPI.db.clearMessages();
                      } else {
                        await window.electronAPI.db.clearMessagesByChannel(clearChannelTarget);
                      }
                    },
                  });
                }}
                className={buttonClassName('danger', 'md')}
              >
                {t('appPanel.clearMessagesCount', { count: messageCount })}
              </button>
            </div>

            {/* MeshCore */}
            {onClearMeshcoreRepeaters && (
              <div className="space-y-2 border-t border-red-900/50 pt-4">
                <div className="text-xs font-medium text-red-400">
                  {t('appPanel.dangerZoneMeshcoreHeading')}
                </div>
                <button
                  data-setting-anchor="app.danger.clearAllRepeaters"
                  type="button"
                  aria-label={t('appPanel.clearAllRepeaters')}
                  onClick={() => {
                    executeWithConfirmation({
                      actionId: 'clearAllRepeaters',
                      title: t('appPanel.clearAllRepeaters'),
                      message: t('appPanel.clearAllRepeatersConfirm'),
                      confirmLabel: t('appPanel.clearAllRepeaters'),
                      danger: true,
                      action: onClearMeshcoreRepeaters,
                    });
                  }}
                  className={buttonClassName('danger', 'md')}
                >
                  {t('appPanel.clearAllRepeaters')}
                </button>
              </div>
            )}

            {/* Everything */}
            <div className="space-y-2 border-t border-red-900/50 pt-4">
              <div className="text-xs font-medium text-red-400">
                {t('appPanel.dangerZoneEverythingHeading')}
              </div>
              <button
                data-setting-anchor="app.danger.clearAllLocalData"
                type="button"
                aria-label={t('appPanel.clearAllLocalData')}
                onClick={() => {
                  executeWithConfirmation({
                    actionId: 'clearAllData',
                    title: t('appPanel.clearAllLocalDataTitle'),
                    message: t('appPanel.clearAllLocalDataConfirm'),
                    confirmLabel: t('appPanel.clearEverythingConfirmButton'),
                    danger: true,
                    messageClearMeta: {
                      clearedAll: true,
                      replaceFromDb: true,
                      messagesMode: 'replace',
                    },
                    action: async () => {
                      if (protocol === 'meshcore') {
                        await window.electronAPI.db.clearMeshcoreMessages();
                        await window.electronAPI.db.clearMeshcoreContacts();
                      } else {
                        await window.electronAPI.db.clearMessages();
                      }
                      await window.electronAPI.db.clearNodes();
                      await window.electronAPI.clearSessionData();
                    },
                  });
                }}
                className={buttonClassName('danger', 'md')}
              >
                {t('appPanel.clearAllLocalData')}
              </button>
            </div>
          </div>
        </details>
      </div>

      {/* Confirmation Modal */}
      {pendingAction && (
        <ConfirmModal
          title={pendingAction.title}
          message={pendingAction.message}
          confirmLabel={pendingAction.confirmLabel}
          danger={pendingAction.danger}
          onConfirm={handleConfirm}
          onCancel={() => {
            setPendingAction(null);
          }}
        />
      )}
    </div>
  );
}
