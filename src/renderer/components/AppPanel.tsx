/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
import { useRadioProvider } from '../lib/radio/providerFactory';
import { writeReduceMotion } from '../lib/reduceMotionPreference';
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
import type { MeshNode, MeshProtocol } from '../lib/types';
import { useCoordFormatStore } from '../stores/coordFormatStore';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { useNodeStore } from '../stores/nodeStore';
import { usePositionHistoryStore } from '../stores/positionHistoryStore';
import { useReticulumPeerStore } from '../stores/reticulumPeerStore';
import { useTimeFormatStore } from '../stores/timeFormatStore';
import { ConfirmModal } from './ConfirmModal';
import { HelpTooltip } from './HelpTooltip';
import { useToast } from './Toast';

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
  return parsed ? { ...DEFAULT_SETTINGS, ...parsed } : DEFAULT_SETTINGS;
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
  gpsLoading?: boolean;
  onGpsIntervalChange?: (secs: number) => void;
  onNodesPruned?: () => void;
  onMessagesPruned?: (opts?: MessageClearRefreshOptions) => void;
  onClearMeshcoreRepeaters?: () => Promise<void>;
  onAutoFloodAdvertIntervalChange?: (hours: number) => void;
  onAutoFloodAdvertTypeChange?: (type: 'flood' | 'zeroHop') => void;
  onChatCompactModeChange?: (compact: boolean) => void;
  onAlwaysShowMessageActionsChange?: (alwaysShow: boolean) => void;
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
  gpsLoading,
  onGpsIntervalChange,
  onNodesPruned,
  onMessagesPruned,
  onClearMeshcoreRepeaters,
  onAutoFloodAdvertIntervalChange,
  onAutoFloodAdvertTypeChange,
  onChatCompactModeChange,
  onAlwaysShowMessageActionsChange,
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

  const commitThemeColor = useCallback((key: ThemeColorKey, hex: string) => {
    setThemeColors((prev) => {
      if (prev[key] === hex) return prev;
      const next = { ...prev, [key]: hex };
      // Prefer the clamped map applyThemeColors returns so readableGreen stays
      // contrast-safe in React state and localStorage (not only on :root).
      const applied = applyThemeColors(next);
      if (!applied) return prev;
      persistThemeColors(applied);
      return applied;
    });
  }, []);

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

  // ─── Static GPS position ─────────────────────────────────────
  const [staticLatInput, setStaticLatInput] = useState<string>(() => {
    const s =
      parseStoredJson<{ staticLat?: number }>(
        localStorage.getItem('mesh-client:gpsSettings'),
        'AppPanel staticLat state',
      ) ?? {};
    return typeof s.staticLat === 'number' ? s.staticLat.toFixed(5) : '';
  });
  const [staticLonInput, setStaticLonInput] = useState<string>(() => {
    const s =
      parseStoredJson<{ staticLon?: number }>(
        localStorage.getItem('mesh-client:gpsSettings'),
        'AppPanel staticLon state',
      ) ?? {};
    return typeof s.staticLon === 'number' ? s.staticLon.toFixed(5) : '';
  });
  const [hasStaticPosition, setHasStaticPosition] = useState<boolean>(() => {
    const s =
      parseStoredJson<{ staticLat?: number; staticLon?: number }>(
        localStorage.getItem('mesh-client:gpsSettings'),
        'AppPanel hasStaticPosition state',
      ) ?? {};
    return typeof s.staticLat === 'number' && typeof s.staticLon === 'number';
  });

  const saveStaticPosition = useCallback(() => {
    const lat = parseFloat(staticLatInput);
    const lon = parseFloat(staticLonInput);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      addToast(t('appPanel.invalidLatitude'), 'error');
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      addToast(t('appPanel.invalidLongitude'), 'error');
      return;
    }
    try {
      const existing =
        parseStoredJson<Record<string, unknown>>(
          localStorage.getItem('mesh-client:gpsSettings'),
          'AppPanel save static position',
        ) ?? {};
      localStorage.setItem(
        'mesh-client:gpsSettings',
        JSON.stringify({ ...existing, staticLat: lat, staticLon: lon, refreshInterval: 0 }),
      );
      setHasStaticPosition(true);
      setGpsRefreshInterval(0);
      onGpsIntervalChange?.(0);
      onRefreshGps?.();
      addToast(t('appPanel.staticPositionSaved'), 'success');
    } catch (e) {
      console.warn('[AppPanel] save static position failed ' + errLikeToLogString(e));
      addToast(t('appPanel.failedSavePosition'), 'error');
    }
  }, [staticLatInput, staticLonInput, addToast, onRefreshGps, onGpsIntervalChange, t]);

  const clearStaticPosition = useCallback(() => {
    try {
      const existing =
        parseStoredJson<Record<string, unknown>>(
          localStorage.getItem('mesh-client:gpsSettings'),
          'AppPanel clear static position',
        ) ?? {};
      delete existing.staticLat;
      delete existing.staticLon;
      const rest = existing;
      localStorage.setItem('mesh-client:gpsSettings', JSON.stringify(rest));
      setStaticLatInput('');
      setStaticLonInput('');
      setHasStaticPosition(false);
      onRefreshGps?.();
      addToast(t('appPanel.staticPositionCleared'), 'success');
    } catch (e) {
      console.warn('[AppPanel] clear static position failed ' + errLikeToLogString(e));
      addToast(t('appPanel.failedClearPosition'), 'error');
    }
  }, [addToast, onRefreshGps, t]);

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

  useEffect(() => {
    loadMsgChannels();
  }, [loadMsgChannels]);

  useEffect(() => {
    setClearChannelTarget(CLEAR_ALL_CHANNELS_VALUE);
  }, [protocol]);

  const getChannelLabel = useCallback(
    (ch: number) => {
      if (ch === -1) return t('radioPanel.directMessages');
      if (ch === -2) return t('appPanel.roomMessages');
      const named = channels.find((c) => c.index === ch);
      return named ? `Channel ${ch} — ${named.name}` : `Channel ${ch}`;
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
      <h2 className="text-xl font-semibold text-gray-200">{t('appPanel.title')}</h2>

      {/* Log panel visibility */}
      {onLogPanelVisibleChange && (
        <div className="space-y-2">
          <h3 className="text-muted text-sm font-medium">{t('appPanel.logPanelSection')}</h3>
          <div className="bg-secondary-dark rounded-lg p-4">
            <div className="flex items-center gap-2">
              <input
                id="log-panel-visible-checkbox"
                type="checkbox"
                checked={logPanelVisible}
                onChange={(e) => {
                  onLogPanelVisibleChange(e.target.checked);
                }}
                aria-label={t('appPanel.showLogPanel')}
                className="rounded border-gray-600"
              />
              <label
                htmlFor="log-panel-visible-checkbox"
                className="cursor-pointer text-sm text-gray-300"
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
          <div className="bg-secondary-dark space-y-2 rounded-lg p-4">
            <label htmlFor="flood-advert-interval" className="text-sm text-gray-300">
              {t('appPanel.floodAdvertScheduleLabel')}
            </label>
            <select
              id="flood-advert-interval"
              value={settings.autoFloodAdvertIntervalHours}
              onChange={(e) => {
                const hours = Number(e.target.value);
                setSettings((prev) => ({ ...prev, autoFloodAdvertIntervalHours: hours }));
                onAutoFloodAdvertIntervalChange?.(hours);
              }}
              className="bg-deep-black focus:border-brand-green w-full rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none"
            >
              <option value={0}>{t('common.disabled')}</option>
              <option value={12}>{t('appPanel.floodAdvertEvery12h')}</option>
              <option value={24}>{t('appPanel.floodAdvertEvery24h')}</option>
            </select>
            <p className="text-muted text-xs">{t('appPanel.floodAdvertHelp')}</p>
            <label htmlFor="flood-advert-type" className="text-sm text-gray-300">
              {t('appPanel.floodAdvertTypeLabel')}
            </label>
            <select
              id="flood-advert-type"
              value={settings.autoFloodAdvertType}
              onChange={(e) => {
                const type = e.target.value === 'zeroHop' ? 'zeroHop' : 'flood';
                setSettings((prev) => ({ ...prev, autoFloodAdvertType: type }));
                onAutoFloodAdvertTypeChange?.(type);
              }}
              className="bg-deep-black focus:border-brand-green w-full rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none"
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
        <div className="bg-secondary-dark space-y-4 rounded-lg p-4">
          <div className="flex items-center gap-2">
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
            <label htmlFor="shareMyLocation" className="cursor-pointer text-sm text-gray-300">
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

          {/* Static position override */}
          <div className="space-y-2 border-t border-gray-700 pt-1">
            <p className="text-muted text-xs leading-relaxed">{t('appPanel.staticPositionDesc')}</p>
            <div className="flex items-center gap-2">
              <label htmlFor="apppanel-static-lat" className="w-8 text-sm text-gray-300">
                {t('appPanel.latLabel')}
              </label>
              <input
                id="apppanel-static-lat"
                type="number"
                step="0.00001"
                min={-90}
                max={90}
                value={staticLatInput}
                onChange={(e) => {
                  setStaticLatInput(e.target.value);
                }}
                placeholder={t('appPanel.latPlaceholderExample')}
                aria-label={`${t('appPanel.latLabel')} ${staticLatInput || t('appPanel.latPlaceholderExample')}`}
                className="bg-deep-black focus:border-brand-green flex-1 rounded border border-gray-600 px-2 py-1 text-sm text-gray-200 focus:outline-none"
              />
              <label htmlFor="apppanel-static-lon" className="w-8 text-sm text-gray-300">
                {t('appPanel.lonLabel')}
              </label>
              <input
                id="apppanel-static-lon"
                type="number"
                step="0.00001"
                min={-180}
                max={180}
                value={staticLonInput}
                onChange={(e) => {
                  setStaticLonInput(e.target.value);
                }}
                placeholder={t('appPanel.lonPlaceholderExample')}
                aria-label={`${t('appPanel.lonLabel')} ${staticLonInput || t('appPanel.lonPlaceholderExample')}`}
                className="bg-deep-black focus:border-brand-green flex-1 rounded border border-gray-600 px-2 py-1 text-sm text-gray-200 focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveStaticPosition}
                aria-label={t('appPanel.saveStaticPosition')}
                className="bg-brand-green/20 text-brand-green hover:bg-brand-green/30 border-brand-green/40 flex-1 rounded border px-3 py-1.5 text-sm font-medium transition-colors"
              >
                {t('appPanel.saveStaticPosition')}
              </button>
              {hasStaticPosition && (
                <button
                  type="button"
                  onClick={clearStaticPosition}
                  aria-label={t('common.clear')}
                  className="bg-secondary-dark rounded px-3 py-1.5 text-sm font-medium text-gray-400 transition-colors hover:bg-gray-600"
                >
                  {t('common.clear')}
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="apppanel-gps-interval" className="flex-1 text-sm text-gray-300">
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
              className={`bg-deep-black focus:border-brand-green rounded border border-gray-600 px-2 py-1 text-sm text-gray-200 focus:outline-none ${hasStaticPosition || !settings.shareMyLocation ? 'cursor-not-allowed opacity-40' : ''}`}
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
          <div className="flex items-center gap-2">
            <label htmlFor="apppanel-coord-format" className="flex-1 text-sm text-gray-300">
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
              className="bg-deep-black focus:border-brand-green rounded border border-gray-600 px-2 py-1 text-sm text-gray-200 focus:outline-none"
            >
              <option value="decimal">{t('appPanel.coordFormatDecimal')}</option>
              <option value="mgrs">{t('appPanel.coordFormatMgrs')}</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => onRefreshGps?.()}
            disabled={gpsLoading || !settings.shareMyLocation}
            title={!settings.shareMyLocation ? t('appPanel.shareMyLocationOffInfo') : undefined}
            aria-label={gpsLoading ? t('appPanel.gpsRefreshing') : t('appPanel.gpsRefreshNow')}
            className={`bg-secondary-dark rounded-lg px-4 py-2 text-sm font-medium text-gray-300 transition-colors ${gpsLoading || !settings.shareMyLocation ? 'cursor-not-allowed opacity-50' : 'hover:bg-gray-600'}`}
          >
            {gpsLoading ? t('appPanel.gpsRefreshing') : t('appPanel.gpsRefreshNow')}
          </button>
        </div>
      </div>

      {/* Map & Node Filtering */}
      <div className="space-y-3">
        <h3 className="text-muted text-sm font-medium">{t('appPanel.mapFilterSection')}</h3>
        <div className="bg-secondary-dark space-y-4 rounded-lg p-4">
          <p className="text-muted text-xs leading-relaxed">{t('appPanel.mapFilterDesc')}</p>
          <div className="flex items-center gap-2">
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
            <label htmlFor="distanceFilter" className="cursor-pointer text-sm text-gray-300">
              {t('appPanel.filterDistantNodesCheckbox')}
            </label>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="apppanel-max-distance" className="text-sm text-gray-300">
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
              className="bg-deep-black focus:border-brand-green w-24 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
            />
            <label htmlFor="apppanel-distance-unit" className="text-sm text-gray-300">
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
              className="bg-deep-black focus:border-brand-green rounded border border-gray-600 px-2 py-1 text-sm text-gray-200 focus:outline-none disabled:opacity-40"
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
                <p className="rounded border border-yellow-700 bg-yellow-900/30 px-2 py-1.5 text-xs text-yellow-300">
                  {t('appPanel.noGpsFix')}
                </p>
              ) : null;
            })()}
          <p className="text-muted text-xs">{t('appPanel.requiresGpsFix')}</p>
          <div className="flex items-center gap-2">
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
            <label htmlFor="filterMqttOnly" className="cursor-pointer text-sm text-gray-300">
              {t('appPanel.hideMqttOnlyNodes')}
            </label>
          </div>
          <div className="flex items-center gap-2">
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
            <label htmlFor="showMovementPaths" className="cursor-pointer text-sm text-gray-300">
              {t('appPanel.showMovementPaths')}
            </label>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="apppanel-history-window" className="shrink-0 text-sm text-gray-400">
              {t('appPanel.positionHistoryWindowLabel')}
            </label>
            <select
              id="apppanel-history-window"
              value={historyWindowHours}
              onChange={(e) => {
                setHistoryWindow(Number(e.target.value));
              }}
              aria-label={`${t('appPanel.positionHistoryWindowLabel')} ${historyWindowOptionLabels[historyWindowHours] ?? historyWindowHours}`}
              className="bg-deep-black focus:border-brand-green rounded border border-gray-600 px-2 py-1 text-sm text-gray-200 focus:outline-none"
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
          <div className="bg-secondary-dark space-y-4 rounded-lg p-4">
            {/* Auto-prune nodes on startup */}
            <div className="flex items-center gap-2">
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
                className="flex-1 cursor-pointer text-sm text-gray-300"
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
                className="bg-deep-black focus:border-brand-green w-20 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
              />
              <span className="text-sm text-gray-300">{t('common.days')}</span>
            </div>

            {/* Prune unnamed nodes on startup */}
            <div className="space-y-1">
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
                  className="flex-1 cursor-pointer text-sm text-gray-300"
                >
                  {t('appPanel.removeUnnamedNodesLabel')}
                </label>
              </div>
              <p className="text-muted pl-6 text-xs">{t('appPanel.unnamedNodesHint')}</p>
            </div>

            {/* Node cap */}
            <div className="flex items-center gap-2">
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
                className="flex-1 cursor-pointer text-sm text-gray-300"
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
                className="bg-deep-black focus:border-brand-green w-24 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
              />
              <span className="text-sm text-gray-300">{t('common.nodes')}</span>
            </div>

            {/* Position history prune */}
            <div className="flex items-center gap-2">
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
                className="flex-1 cursor-pointer text-sm text-gray-300"
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
                className="bg-deep-black focus:border-brand-green w-20 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
              />
              <span className="text-sm text-gray-300">{t('common.days')}</span>
            </div>
          </div>
        )}

        {/* MeshCore contact retention */}
        {protocol === 'meshcore' && (
          <div className="bg-secondary-dark space-y-4 rounded-lg p-4">
            {/* Delete contacts that never advertised */}
            <div className="space-y-1">
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
                  className="flex-1 cursor-pointer text-sm text-gray-300"
                >
                  {t('appPanel.meshcoreRemoveNeverAdvertisedLabel')}
                </label>
              </div>
              <p className="text-muted pl-6 text-xs">
                {t('appPanel.meshcoreRemoveNeverAdvertisedHint')}
              </p>
            </div>

            {/* Auto-prune contacts by age */}
            <div className="flex items-center gap-2">
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
                className="flex-1 cursor-pointer text-sm text-gray-300"
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
                className="bg-deep-black focus:border-brand-green w-20 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
              />
              <span className="text-sm text-gray-300">{t('common.days')}</span>
            </div>

            {/* Contact cap */}
            <div className="flex items-center gap-2">
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
                className="flex-1 cursor-pointer text-sm text-gray-300"
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
                className="bg-deep-black focus:border-brand-green w-24 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
              />
              <span className="text-sm text-gray-300">{t('common.contacts')}</span>
            </div>
          </div>
        )}

        {/* Reticulum destination retention (SQLite contacts/meta + in-memory peer cap) */}
        {protocol === 'reticulum' && (
          <div className="bg-secondary-dark space-y-4 rounded-lg p-4">
            <p className="text-muted text-xs leading-relaxed">
              {t('appPanel.reticulumDestinationRetentionHint')}
            </p>
            <div className="flex items-center gap-2">
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
                className="flex-1 cursor-pointer text-sm text-gray-300"
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
                className="bg-deep-black focus:border-brand-green w-20 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
              />
              <span className="text-sm text-gray-300">{t('common.days')}</span>
            </div>
            <div className="flex items-center gap-2">
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
                className="flex-1 cursor-pointer text-sm text-gray-300"
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
                className="bg-deep-black focus:border-brand-green w-24 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
              />
              <span className="text-sm text-gray-300">
                {t('appPanel.reticulumDestinationsUnit', {
                  count: settings.reticulumDestinationCapCount,
                })}
              </span>
            </div>
          </div>
        )}

        {/* Messages: load limit (localStorage) + DB retention cap — single card (issue #387). */}
        <div className="bg-secondary-dark space-y-3 rounded-lg p-4">
          <p className="text-muted text-xs leading-relaxed">
            {t('appPanel.messagesLoadLimitIntro')}
          </p>
          <div className="flex items-center gap-2">
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
              className="flex-1 cursor-pointer text-sm text-gray-300"
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
              className="bg-deep-black focus:border-brand-green w-24 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
            />
            <span className="text-sm text-gray-300">{t('common.messages')}</span>
          </div>
          {protocol === 'meshcore' ? (
            <div className="flex items-center gap-2 border-t border-gray-700 pt-2">
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
                className="flex-1 cursor-pointer text-sm text-gray-300"
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
                className="bg-deep-black focus:border-brand-green w-24 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
              />
              <span className="text-sm text-gray-300">{t('common.messages')}</span>
            </div>
          ) : protocol === 'reticulum' ? (
            <>
              <div className="flex items-center gap-2 border-t border-gray-700 pt-2">
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
                  className="flex-1 cursor-pointer text-sm text-gray-300"
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
                  className="bg-deep-black focus:border-brand-green w-24 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
                />
                <span className="text-sm text-gray-300">{t('common.messages')}</span>
              </div>
              <div className="flex items-center gap-2 border-t border-gray-700 pt-2">
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
                  className="flex-1 cursor-pointer text-sm text-gray-300"
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
                  className="bg-deep-black focus:border-brand-green w-24 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
                />
                <span className="text-sm text-gray-300">{t('common.messages')}</span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 border-t border-gray-700 pt-2">
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
                className="flex-1 cursor-pointer text-sm text-gray-300"
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
                className="bg-deep-black focus:border-brand-green w-24 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
              />
              <span className="text-sm text-gray-300">{t('common.messages')}</span>
            </div>
          )}
          <div className="flex items-center gap-2 border-t border-gray-700 pt-2">
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
            <label htmlFor="chatCompactMode" className="cursor-pointer text-sm text-gray-300">
              {t('appPanel.compactMessages')}
            </label>
          </div>
          <div className="flex items-center gap-2">
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
              className="cursor-pointer text-sm text-gray-300"
            >
              {t('appPanel.alwaysShowMessageActions')}
            </label>
            <HelpTooltip text={t('appPanel.alwaysShowMessageActionsDesc')} />
          </div>
          {protocol === 'meshtastic' && (
            <>
              <div className="flex items-center gap-2 pt-2">
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
                  className="cursor-pointer text-sm text-gray-300"
                >
                  {t('appPanel.storeForwardAutoFetchHistory')}
                </label>
                <HelpTooltip text={t('appPanel.storeForwardAutoFetchHistoryHint')} />
              </div>
              {settings.storeForwardAutoFetchHistory && (
                <div className="flex flex-wrap items-center gap-2 pl-6">
                  <label htmlFor="storeForwardHistoryProfile" className="text-sm text-gray-300">
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
                    className="bg-secondary-dark rounded border border-slate-600 px-2 py-1 text-sm text-gray-200"
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
              <div className="flex items-center gap-2">
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
                  className="cursor-pointer text-sm text-gray-300"
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
          <div className="space-y-2">
            <button
              type="button"
              aria-label={t('appPanel.exportForGitHub')}
              disabled={supportBundleExporting !== null}
              onClick={() => void handleExportSupportBundle('github')}
              className="bg-readable-green hover:bg-readable-green/90 w-full rounded-lg px-4 py-3 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {supportBundleExporting === 'github'
                ? t('common.loading')
                : t('appPanel.exportForGitHubButton')}
            </button>
            <p className="text-muted text-xs">{t('appPanel.exportForGitHubDesc')}</p>
          </div>
          <div className="space-y-2">
            <button
              type="button"
              aria-label={t('appPanel.exportForDeveloper')}
              disabled={supportBundleExporting !== null}
              onClick={() => void handleExportSupportBundle('developer')}
              className="bg-secondary-dark w-full rounded-lg px-4 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {supportBundleExporting === 'developer'
                ? t('common.loading')
                : t('appPanel.exportForDeveloperButton')}
            </button>
            <p className="text-xs text-amber-300">{t('appPanel.exportForDeveloperWarning')}</p>
          </div>
        </div>
      </div>

      {/* Data Management */}
      <div className="space-y-3">
        <h3 className="text-muted text-sm font-medium">{t('appPanel.dataManagementSection')}</h3>
        <p className="text-muted text-xs">{t('appPanel.dataManagementDesc')}</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          <button
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
            className="bg-secondary-dark rounded-lg px-4 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
          >
            {t('appPanel.exportDatabaseButton')}
          </button>

          <button
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
            className="bg-secondary-dark rounded-lg px-4 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
          >
            {t('appPanel.copyDebugSnapshotButton')}
          </button>

          <button
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
            className="bg-secondary-dark rounded-lg px-4 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
          >
            {t('appPanel.importMergeButton')}
          </button>
        </div>
      </div>

      {/* Appearance — collapsible; preset-only colors (no text input — Electron macOS menu warnings). */}
      <div className="space-y-2">
        <h3 className="text-muted text-sm font-medium">{t('appPanel.appearanceSection')}</h3>
        <div className="bg-secondary-dark flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-3">
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
          <label htmlFor="reduceMotion" className="cursor-pointer text-sm text-gray-300">
            {t('appPanel.reduceMotion')}
          </label>
          <HelpTooltip text={t('appPanel.reduceMotionDesc')} />
        </div>
        <div className="bg-secondary-dark flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-3">
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
          <label htmlFor="use24HourTime" className="cursor-pointer text-sm text-gray-300">
            {t('appPanel.use24HourTime')}
          </label>
          <HelpTooltip text={t('appPanel.use24HourTimeDesc')} />
        </div>
        <div className="bg-secondary-dark flex flex-col gap-2 rounded-lg border border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <label htmlFor="fontScale" className="cursor-pointer text-sm text-gray-300">
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
              className="rounded border border-gray-600 px-2 py-1 text-sm text-gray-300 transition-colors hover:bg-gray-600 disabled:opacity-40"
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
              className="rounded border border-gray-600 px-2 py-1 text-sm text-gray-300 transition-colors hover:bg-gray-600 disabled:opacity-40"
            >
              +
            </button>
            <button
              type="button"
              aria-label={t('appPanel.resetFontSizeAria')}
              onClick={handleResetFontScale}
              className="text-muted text-xs underline transition-colors hover:text-gray-300"
            >
              {t('appPanel.resetFontSize')}
            </button>
          </div>
        </div>
        <details className="group bg-secondary-dark rounded-lg border border-gray-700">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium text-gray-200 hover:bg-gray-800/40 [&::-webkit-details-marker]:hidden">
            <span>{t('appPanel.colorScheme')}</span>
            <DetailsChevron className="text-muted h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-gray-700 px-4 pt-1 pb-4">
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
                  className="flex flex-wrap items-center gap-2 border-b border-gray-600/80 pb-2 last:border-0 last:pb-0"
                >
                  <span
                    className="h-6 w-6 shrink-0 rounded border border-gray-600"
                    style={{ backgroundColor: hex, opacity: swatchOpacity }}
                    title={hex}
                    aria-hidden="true"
                  />
                  <div
                    id={`theme-color-heading-${meta.key}`}
                    className="max-w-[9rem] min-w-[6.5rem] shrink-0"
                  >
                    <div className="text-sm font-medium text-gray-200">{t(meta.labelKey)}</div>
                    <div className="text-muted mt-0.5 text-[10px] leading-tight">
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
                              ? 'ring-brand-green ring-offset-secondary-dark ring-2 ring-offset-1'
                              : 'border-gray-600'
                          }`}
                          style={{ backgroundColor: p.hex }}
                        />
                      );
                    })}
                    {meta.key === 'messageActionsBarBg' && (
                      <label className="ml-2 flex items-center gap-1.5">
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
                        <span className="text-[10px] text-gray-400">
                          {t('appPanel.messageActionsBarBgVisible')}
                        </span>
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveThemeSnapshot}
                aria-label={t('appPanel.saveTheme')}
                className="bg-deep-black flex-1 rounded-lg border border-gray-600 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
              >
                {t('appPanel.saveThemeButton')}
              </button>
              <button
                type="button"
                onClick={handleRestoreThemeSnapshot}
                disabled={!hasSavedThemeSnapshot}
                aria-label={t('appPanel.restoreTheme')}
                title={hasSavedThemeSnapshot ? undefined : t('appPanel.noSavedThemeTooltip')}
                className="bg-deep-black disabled:hover:bg-deep-black flex-1 rounded-lg border border-gray-600 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('appPanel.restoreThemeButton')}
              </button>
              <button
                type="button"
                onClick={handleResetThemeColors}
                aria-label={t('appPanel.resetAllColors')}
                className="bg-deep-black flex-1 rounded-lg border border-gray-600 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
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
        <div className="flex items-center gap-3">
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
          <label htmlFor="soundNotifications" className="cursor-pointer text-sm text-gray-300">
            {t('appPanel.soundNotifications')}
          </label>
        </div>
        {hasRrcPanel && (
          <div className="space-y-1">
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
                className="cursor-pointer text-sm text-gray-300"
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
              <div className="text-xs font-medium tracking-wide text-red-400/90 uppercase">
                {t('appPanel.dangerZoneDiagnosticsHeading')}
              </div>
              <p className="text-muted text-xs leading-relaxed">
                {t('appPanel.dangerZoneDiagnosticsDesc')}
              </p>
              <button
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
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                {t('appPanel.resetDiagnostics')}
              </button>
            </div>

            <div className="space-y-2 border-t border-red-900/50 pt-4">
              <div className="text-xs font-medium tracking-wide text-red-400/90 uppercase">
                {t('appPanel.dangerZoneGpsHeading')}
              </div>
              <p className="text-muted text-xs leading-relaxed">
                {t('appPanel.dangerZoneGpsDesc')}
              </p>
              <button
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
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                {t('appPanel.clearGpsData')}
              </button>
            </div>

            <div className="space-y-2 border-t border-red-900/50 pt-4">
              <div className="text-xs font-medium tracking-wide text-red-400/90 uppercase">
                {t('appPanel.dangerZonePositionHistoryHeading')}
              </div>
              <p className="text-muted text-xs leading-relaxed">
                {t('appPanel.dangerZonePositionHistoryDesc')}
              </p>
              <button
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
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                {t('appPanel.clearPositionHistory')}
              </button>
            </div>

            {/* Nodes */}
            <div className="space-y-3 border-t border-red-900/50 pt-4">
              <div className="text-xs font-medium tracking-wide text-red-400/90 uppercase">
                {t('appPanel.dangerZoneNodesHeading')}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="apppanel-delete-age-days" className="text-sm text-gray-300">
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
                  className="bg-deep-black w-20 rounded border border-red-800/60 px-2 py-1 text-right text-sm text-gray-200 focus:border-red-500 focus:outline-none"
                />
                <span className="text-sm text-gray-300">{t('common.days')}</span>
                <button
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
                  className="rounded border border-red-800 bg-red-900/50 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-red-300 transition-colors hover:bg-red-900/70"
                >
                  {t('appPanel.deleteOldNodes')}
                </button>
              </div>
              <button
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
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-left text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                {t('appPanel.pruneMqttOnlyNodes')}
              </button>
              <button
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
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-left text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                {t('appPanel.pruneUnnamedNodes')}
              </button>
              <button
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
                    title: t('appPanel.pruneNoFixNodes'),
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
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-left text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                <div className="font-medium">{t('appPanel.pruneNoFixNodes')}</div>
                <div className="mt-0.5 text-xs text-red-400/70">
                  {t('appPanel.pruneNoFixSubtitle')}
                </div>
              </button>
              <button
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
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-left text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                <div className="font-medium">{t('appPanel.pruneDistantNodesTitle')}</div>
                <div className="mt-0.5 text-xs text-red-400/70">
                  {t('appPanel.pruneDistantSubtitle')}
                </div>
              </button>
              <button
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
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-left text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                <div className="font-medium">{t('appPanel.pruneOfflineNodesTitle')}</div>
                <div className="mt-0.5 text-xs text-red-400/70">
                  {t('appPanel.pruneOfflineSubtitle', {
                    days: Math.round(nodeOfflineThresholdMs / (24 * 60 * 60 * 1000)),
                  })}
                </div>
              </button>
              <button
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
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                {t('appPanel.clearAllNodesButton', { count: nodeCount })}
              </button>

              {/* MeshCore contacts cleanup */}
              {protocol === 'meshcore' && (
                <button
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
                  className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-left text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
                >
                  <div className="font-medium">{t('appPanel.deleteContactsNoPubkeysTitle')}</div>
                  <div className="mt-0.5 text-xs text-red-400/70">
                    {t('appPanel.deleteContactsWithoutPubkeysSubtitle')}
                  </div>
                </button>
              )}
            </div>

            {/* Reticulum contacts */}
            {protocol === 'reticulum' && (
              <div className="space-y-2 border-t border-red-900/50 pt-4">
                <div className="text-xs font-medium tracking-wide text-red-400/90 uppercase">
                  {t('appPanel.dangerZoneReticulumHeading')}
                </div>
                <p className="text-muted text-xs leading-relaxed">
                  {t('appPanel.clearReticulumContactsDesc')}
                </p>
                <button
                  type="button"
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
                  className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-left text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70 disabled:cursor-not-allowed disabled:opacity-40"
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
              <div className="text-xs font-medium tracking-wide text-red-400/90 uppercase">
                {t('appPanel.messagesSection')}
              </div>
              {isReticulumDmOnly ? (
                <p className="text-muted text-xs leading-relaxed">
                  {t('appPanel.reticulumDmOnlyMessagesHint')}
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="apppanel-clear-channel"
                    className="shrink-0 text-sm text-gray-400"
                  >
                    {t('appPanel.clearChannelLabel')}
                  </label>
                  <select
                    id="apppanel-clear-channel"
                    value={clearChannelTarget}
                    onChange={(e) => {
                      setClearChannelTarget(parseInt(e.target.value, 10));
                    }}
                    aria-label={t('common.channel')}
                    className="bg-deep-black flex-1 rounded-lg border border-red-800/60 px-3 py-1.5 text-sm text-gray-200 focus:border-red-500 focus:outline-none"
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
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                {t('appPanel.clearMessagesCount', { count: messageCount })}
              </button>
            </div>

            {/* MeshCore */}
            {onClearMeshcoreRepeaters && (
              <div className="space-y-2 border-t border-red-900/50 pt-4">
                <div className="text-xs font-medium tracking-wide text-red-400 uppercase">
                  {t('appPanel.dangerZoneMeshcoreHeading')}
                </div>
                <button
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
                  className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
                >
                  {t('appPanel.clearAllRepeaters')}
                </button>
              </div>
            )}

            {/* Everything */}
            <div className="space-y-2 border-t border-red-900/50 pt-4">
              <div className="text-xs font-medium tracking-wide text-red-400 uppercase">
                {t('appPanel.dangerZoneEverythingHeading')}
              </div>
              <button
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
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
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
