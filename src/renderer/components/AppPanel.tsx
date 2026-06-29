/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { copyDebugSnapshotToClipboard } from '@/renderer/lib/debugSnapshot';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { MessageClearRefreshOptions } from '@/renderer/lib/hydrateIdentityStoresFromDb';
import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';
import { parseDatabaseSchemaTooNewFromMessage } from '@/shared/databaseSchemaTooNew';

import type { LocationFilter } from '../App';
import {
  getAppSettingsRaw,
  mergeAppSetting,
  mergeAppSettingsPartial,
} from '../lib/appSettingsStorage';
import { formatCoordPair } from '../lib/coordUtils';
import { DEFAULT_APP_SETTINGS_SHARED } from '../lib/defaultAppSettings';
import type { OurPosition } from '../lib/gpsSource';
import {
  DEFAULT_MESSAGE_RETENTION,
  fetchMessageRetention,
  MESSAGE_RETENTION_KEYS,
  MESSAGE_RETENTION_MAX_COUNT,
  MESSAGE_RETENTION_MIN_COUNT,
  type MessageRetentionSettings,
} from '../lib/messageRetention';
import { getNodeStatus, haversineDistanceKm } from '../lib/nodeStatus';
import { parseStoredJson } from '../lib/parseStoredJson';
import { useRadioProvider } from '../lib/radio/providerFactory';
import { writeReduceMotion } from '../lib/reduceMotionPreference';
import {
  applyThemeColors,
  DEFAULT_THEME_COLORS,
  loadThemeColors,
  persistThemeColors,
  resetThemeColors,
  THEME_COLOR_PRESETS,
  THEME_TOKEN_META,
  type ThemeColorKey,
} from '../lib/themeColors';
import type { MeshNode, MeshProtocol } from '../lib/types';
import { useCoordFormatStore } from '../stores/coordFormatStore';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { usePositionHistoryStore } from '../stores/positionHistoryStore';
import { HelpTooltip } from './HelpTooltip';
import { useToast } from './Toast';

const GPS_REFRESH_INTERVAL_LABELS: Record<number, string> = {
  0: 'Manual only',
  900: 'Every 15 min',
  1800: 'Every 30 min',
  3600: 'Every hour',
  7200: 'Every 2 hours',
};

/** Sentinel for "clear all channels" so MeshCore DM (`channel_idx === -1`) does not collide with "All". */
const CLEAR_ALL_CHANNELS_VALUE = -999_999;

// ─── Confirmation Modal ─────────────────────────────────────────
function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label={t('common.cancel')}
        className="absolute inset-0 cursor-pointer border-0 bg-black/60 p-0 backdrop-blur-sm"
        onClick={onCancel}
      />
      {/* Modal */}
      <div className="bg-deep-black relative mx-4 w-full max-w-sm space-y-4 rounded-xl border border-gray-600 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-gray-200">{title}</h3>
        <p className="text-muted text-sm leading-relaxed">{message}</p>
        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            aria-label={t('common.cancel')}
            className="bg-secondary-dark flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            aria-label={confirmLabel}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors ${
              danger ? 'bg-red-600 hover:bg-red-500' : 'bg-yellow-600 hover:bg-yellow-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
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
  chatCompactMode: boolean;
  storeForwardAutoFetchHistory: boolean;
  reduceMotion: boolean;
  meshcoreOpenWireCompatEnabled: boolean;
  meshcorePathHashMode: 0 | 1 | 2;
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
  nodes: Map<number, MeshNode>;
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
  deviceReportedPathHashMode?: 0 | 1 | 2 | null;
  isMeshcoreRadioConnected?: boolean;
  onApplyMeshcorePathHashMode?: (mode: 0 | 1 | 2) => Promise<void>;
}

interface PendingAction {
  name: string;
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
  nodes,
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
  deviceReportedPathHashMode,
  isMeshcoreRadioConnected = false,
  onApplyMeshcorePathHashMode,
}: Props) {
  const [soundNotifEnabled, setSoundNotifEnabled] = useState(
    () => localStorage.getItem('mesh-client:notifMuted') !== '1',
  );
  useEffect(() => {
    localStorage.setItem('mesh-client:notifMuted', soundNotifEnabled ? '0' : '1');
  }, [soundNotifEnabled]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const { addToast } = useToast();
  const { t } = useTranslation();
  const clearDiagnostics = useDiagnosticsStore((s) => s.clearDiagnostics);
  const showPaths = usePositionHistoryStore((s) => s.showPaths);
  const setShowPaths = usePositionHistoryStore((s) => s.setShowPaths);
  const historyWindowHours = usePositionHistoryStore((s) => s.historyWindowHours);
  const setHistoryWindow = usePositionHistoryStore((s) => s.setHistoryWindow);
  const clearHistory = usePositionHistoryStore((s) => s.clearHistory);
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);

  const historyWindowOptionLabels = useMemo((): Record<number, string> => {
    return {
      1: t('appPanel.historyWindow1h'),
      4: t('appPanel.historyWindow4h'),
      24: t('appPanel.historyWindow24h'),
      72: t('appPanel.historyWindow3d'),
      168: t('appPanel.historyWindow7d'),
    };
  }, [t]);

  const { nodeStaleThresholdMs, nodeOfflineThresholdMs } = useRadioProvider(protocol);

  // ─── Node retention settings ────────────────────────────────
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [themeColors, setThemeColors] = useState<Record<ThemeColorKey, string>>(loadThemeColors);
  const [deleteAgeDays, setDeleteAgeDays] = useState(90);

  const commitThemeColor = useCallback((key: ThemeColorKey, hex: string) => {
    setThemeColors((prev) => {
      if (prev[key] === hex) return prev;
      const next = { ...prev, [key]: hex };
      applyThemeColors(next);
      persistThemeColors(next);
      return next;
    });
  }, []);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      mergeAppSettingsPartial(
        settings as unknown as Record<string, unknown>,
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
  };

  // ─── DB-backed message retention (issue #387) ─────────────────
  // Source of truth lives in SQLite (`app_settings` KV table). Hydrate on
  // mount; debounce writes through IPC. Two independent caps gated by the
  // currently selected protocol — pruning still runs for both tables on
  // startup (see App.tsx) since both stacks may be active simultaneously.
  const [retention, setRetention] = useState<MessageRetentionSettings>({
    ...DEFAULT_MESSAGE_RETENTION,
  });
  const lastSavedRetentionRef = useRef<MessageRetentionSettings>({ ...DEFAULT_MESSAGE_RETENTION });
  const retentionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMessageRetention()
      .then((loaded) => {
        if (cancelled) return;
        setRetention(loaded);
        lastSavedRetentionRef.current = loaded;
      })
      .catch((e: unknown) => {
        console.warn('[AppPanel] fetchMessageRetention failed ' + errLikeToLogString(e));
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
    (which: 'meshtastic' | 'meshcore', enabled: boolean) => {
      const previous = retention;
      const next = { ...previous, [`${which}Enabled`]: enabled };
      setRetention(next);
      const debouncedKey = which === 'meshtastic' ? 'meshtasticEnabled' : 'meshcoreEnabled';
      persistRetention(debouncedKey, enabled ? '1' : '0', previous);
    },
    [retention, persistRetention],
  );

  const updateRetentionCount = useCallback(
    (which: 'meshtastic' | 'meshcore', count: number) => {
      const clamped = Math.max(
        MESSAGE_RETENTION_MIN_COUNT,
        Math.min(MESSAGE_RETENTION_MAX_COUNT, Math.floor(count) || MESSAGE_RETENTION_MIN_COUNT),
      );
      const previous = retention;
      const next = { ...previous, [`${which}Count`]: clamped };
      setRetention(next);
      const stateKey = which === 'meshtastic' ? 'meshtasticCount' : 'meshcoreCount';

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
          setMsgChannels(rows.map((r) => r.channel));
        })
        .catch((e: unknown) => {
          console.debug('[AppPanel] getMeshcoreMessageChannels ' + errLikeToLogString(e));
        });
    } else {
      window.electronAPI.db
        .getMessageChannels()
        .then((rows) => {
          setMsgChannels(rows.map((r) => r.channel));
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
    const { name: actionName, action, messageClearMeta } = pendingAction;
    setPendingAction(null);
    try {
      await action();
      const nodeActions = [
        'Delete Old Nodes',
        'Prune MQTT-only Nodes',
        'Prune Unnamed Nodes',
        'Prune Zero Island Nodes',
        'Prune Distant Nodes',
        'Clear Nodes',
        'Clear All Data',
        'Clear GPS Data',
      ];
      const messageActions = ['Clear Messages', 'Clear All Data'];
      if (nodeActions.includes(actionName)) onNodesPruned?.();
      if (messageActions.includes(actionName)) {
        onMessagesPruned?.(messageClearMeta);
        loadMsgChannels();
      }
      addToast(t('appPanel.actionCompleted', { name: actionName }), 'success');
    } catch (err) {
      console.warn('[AppPanel] pending action failed ' + errLikeToLogString(err));
      addToast(
        t('appPanel.actionFailed', {
          message: err instanceof Error ? err.message : 'Unknown error',
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
                onClick={saveStaticPosition}
                aria-label={t('appPanel.saveStaticPosition')}
                className="bg-brand-green/20 text-brand-green hover:bg-brand-green/30 border-brand-green/40 flex-1 rounded border px-3 py-1.5 text-sm font-medium transition-colors"
              >
                {t('appPanel.saveStaticPosition')}
              </button>
              {hasStaticPosition && (
                <button
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
              disabled={hasStaticPosition}
              aria-label={`${t('appPanel.autoRefreshInterval')} ${GPS_REFRESH_INTERVAL_LABELS[gpsRefreshInterval] ?? gpsRefreshInterval}`}
              className={`bg-deep-black focus:border-brand-green rounded border border-gray-600 px-2 py-1 text-sm text-gray-200 focus:outline-none ${hasStaticPosition ? 'cursor-not-allowed opacity-40' : ''}`}
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
            onClick={() => onRefreshGps?.()}
            disabled={gpsLoading}
            aria-label={gpsLoading ? t('appPanel.gpsRefreshing') : t('appPanel.gpsRefreshNow')}
            className={`bg-secondary-dark rounded-lg px-4 py-2 text-sm font-medium text-gray-300 transition-colors ${gpsLoading ? 'cursor-not-allowed opacity-50' : 'hover:bg-gray-600'}`}
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
              aria-label={`Max distance: ${settings.distanceFilterMax}`}
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
              aria-label={`Unit: ${settings.distanceUnit}`}
              className="bg-deep-black focus:border-brand-green rounded border border-gray-600 px-2 py-1 text-sm text-gray-200 focus:outline-none disabled:opacity-40"
            >
              <option value="miles">{t('appPanel.distanceUnitMiles')}</option>
              <option value="km">{t('appPanel.distanceUnitKm')}</option>
            </select>
          </div>
          {settings.distanceFilterEnabled &&
            (() => {
              const homeNode = myNodeNum != null ? nodes.get(myNodeNum) : undefined;
              const homeHasLocation =
                homeNode?.latitude != null &&
                homeNode.latitude !== 0 &&
                homeNode.longitude != null &&
                homeNode.longitude !== 0;
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
        {protocol !== 'meshcore' && (
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
                aria-label={`Auto-prune nodes on startup, older than ${settings.autoPruneDays} days`}
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
                aria-label={`Cap total nodes, keep newest ${settings.nodeCapCount} nodes`}
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
                aria-label={`Auto-prune position history on startup, older than ${settings.positionHistoryPruneDays} days`}
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
                aria-label={`Auto-prune unheard contacts on startup, older than ${settings.meshcoreAutoPruneDays} days`}
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
                value={settings.meshcoreContactCapCount}
                onChange={(e) => {
                  updateSetting(
                    'meshcoreContactCapCount',
                    Math.max(1, parseInt(e.target.value) || 1),
                  );
                }}
                disabled={!settings.meshcoreContactCapEnabled}
                aria-labelledby="apppanel-meshcore-contact-cap-label"
                aria-label={`Cap total contacts, keep most recently seen ${settings.meshcoreContactCapCount} contacts`}
                className="bg-deep-black focus:border-brand-green w-24 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
              />
              <span className="text-sm text-gray-300">{t('common.contacts')}</span>
            </div>
          </div>
        )}

        {/* MeshCore Open wire compatibility (experimental) */}
        {protocol === 'meshcore' && (
          <div className="space-y-2">
            <h3 className="text-muted text-sm font-medium">
              {t('appPanel.meshcoreOpenWireExperimentalTitle')}
            </h3>
            <div className="space-y-3 rounded-lg border border-yellow-700 bg-yellow-900/30 px-4 py-3">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id="meshcoreOpenWireCompat"
                  checked={settings.meshcoreOpenWireCompatEnabled}
                  onChange={(e) => {
                    updateSetting('meshcoreOpenWireCompatEnabled', e.target.checked);
                  }}
                  aria-label={t('appPanel.meshcoreOpenWireCompatLabel')}
                  className="accent-brand-green mt-0.5"
                />
                <label
                  htmlFor="meshcoreOpenWireCompat"
                  className="flex-1 cursor-pointer text-sm text-yellow-100"
                >
                  {t('appPanel.meshcoreOpenWireCompatLabel')}
                </label>
              </div>
              <p className="text-xs leading-relaxed text-yellow-300/90">
                {t('appPanel.meshcoreOpenWireCompatHint')}
              </p>
            </div>
          </div>
        )}

        {protocol === 'meshcore' && (
          <div className="space-y-2">
            <h3 className="text-muted text-sm font-medium">
              {t('appPanel.meshcorePathHashExperimentalTitle')}
            </h3>
            <div className="space-y-3 rounded-lg border border-yellow-700 bg-yellow-900/30 px-4 py-3">
              <label htmlFor="meshcore-path-hash-mode" className="text-sm text-yellow-100">
                {t('appPanel.meshcorePathHashModeLabel')}
              </label>
              <select
                id="meshcore-path-hash-mode"
                value={settings.meshcorePathHashMode}
                onChange={(e) => {
                  const raw = Number.parseInt(e.target.value, 10);
                  if (raw !== 0 && raw !== 1 && raw !== 2) return;
                  updateSetting('meshcorePathHashMode', raw);
                  if (isMeshcoreRadioConnected && onApplyMeshcorePathHashMode) {
                    void onApplyMeshcorePathHashMode(raw).catch((err: unknown) => {
                      addToast(
                        t('appPanel.meshcorePathHashApplyFailed', {
                          message: err instanceof Error ? err.message : t('common.unknown'),
                        }),
                        'error',
                      );
                    });
                  }
                }}
                aria-label={t('appPanel.meshcorePathHashModeLabel')}
                className="bg-deep-black focus:border-brand-green w-full max-w-md rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none"
              >
                <option value={0}>{t('appPanel.meshcorePathHashMode1Byte')}</option>
                <option value={1}>{t('appPanel.meshcorePathHashMode2Byte')}</option>
                <option value={2}>{t('appPanel.meshcorePathHashMode3Byte')}</option>
              </select>
              {deviceReportedPathHashMode != null && isMeshcoreRadioConnected ? (
                <p className="text-xs text-yellow-200/90">
                  {t('appPanel.meshcorePathHashDeviceReported', {
                    mode:
                      deviceReportedPathHashMode === 0
                        ? t('appPanel.meshcorePathHashModeShort0')
                        : deviceReportedPathHashMode === 1
                          ? t('appPanel.meshcorePathHashModeShort1')
                          : t('appPanel.meshcorePathHashModeShort2'),
                  })}
                </p>
              ) : null}
              <p className="text-xs leading-relaxed text-yellow-300/90">
                {t('appPanel.meshcorePathHashModeHint')}
              </p>
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
              aria-label={`Limit messages loaded ${settings.messageLimitCount} messages`}
              className="bg-deep-black focus:border-brand-green w-24 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
            />
            <span className="text-sm text-gray-300">{t('common.messages')}</span>
          </div>
          {protocol !== 'meshcore' ? (
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
                aria-label={`Cap stored messages, keep newest ${retention.meshtasticCount} messages`}
                className="bg-deep-black focus:border-brand-green w-24 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none disabled:opacity-40"
              />
              <span className="text-sm text-gray-300">{t('common.messages')}</span>
            </div>
          ) : (
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
                aria-label={`Cap stored messages, keep newest ${retention.meshcoreCount} messages`}
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
          {protocol === 'meshtastic' && (
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
          )}
        </div>
      </div>

      {/* Data Management */}
      <div className="space-y-3">
        <h3 className="text-muted text-sm font-medium">{t('appPanel.dataManagementSection')}</h3>
        <p className="text-muted text-xs">{t('appPanel.dataManagementDesc')}</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          <button
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
                    message: err instanceof Error ? err.message : 'Unknown error',
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
                        message: err instanceof Error ? err.message : 'Unknown error',
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
        <details className="group bg-secondary-dark rounded-lg border border-gray-700">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium text-gray-200 hover:bg-gray-800/40 [&::-webkit-details-marker]:hidden">
            <span>{t('appPanel.colorScheme')}</span>
            <DetailsChevron className="text-muted h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-gray-700 px-4 pt-1 pb-4">
            <p className="text-muted text-xs">{t('appPanel.themeColorsApplyHint')}</p>
            {THEME_TOKEN_META.map((meta) => {
              const hex = themeColors[meta.key];
              return (
                <div
                  key={meta.key}
                  className="flex flex-wrap items-center gap-2 border-b border-gray-600/80 pb-2 last:border-0 last:pb-0"
                >
                  <span
                    className="h-6 w-6 shrink-0 rounded border border-gray-600"
                    style={{ backgroundColor: hex }}
                    title={hex}
                    aria-hidden="true"
                  />
                  <div
                    id={`theme-color-heading-${meta.key}`}
                    className="max-w-[9rem] min-w-[6.5rem] shrink-0"
                  >
                    <div className="text-sm font-medium text-gray-200">{meta.label}</div>
                    <div className="text-muted mt-0.5 text-[10px] leading-tight">
                      {meta.description}
                    </div>
                  </div>
                  <div
                    className="flex max-w-full min-w-0 flex-1 [scrollbar-width:thin] flex-nowrap gap-1 py-0.5"
                    role="group"
                    aria-labelledby={`theme-color-heading-${meta.key}`}
                  >
                    {THEME_COLOR_PRESETS.map((p) => {
                      const selected = p.hex === hex;
                      return (
                        <button
                          key={`${meta.key}-${p.hex}`}
                          type="button"
                          title={p.label}
                          aria-label={`${p.label} ${p.hex}`}
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
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => {
                resetThemeColors();
                setThemeColors({ ...DEFAULT_THEME_COLORS });
                addToast(t('appPanel.colorsReset'), 'success');
              }}
              aria-label={t('appPanel.resetAllColors')}
              className="bg-deep-black w-full rounded-lg border border-gray-600 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
            >
              {t('appPanel.resetAllColorsButton')}
            </button>
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
                    name: 'Reset Diagnostics',
                    title: 'Reset Diagnostics',
                    message:
                      'This will clear all routing anomalies, hop history, and packet stats. The engine will rebuild from new incoming packets. Continue?',
                    confirmLabel: 'Reset Diagnostics',
                    danger: true,
                    action: async () => {
                      await Promise.resolve();
                      clearDiagnostics();
                    },
                  });
                }}
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                Reset Diagnostics
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
                    name: 'Clear GPS Data',
                    title: 'Clear GPS Data',
                    message:
                      'This will remove stored GPS coordinates from all nodes. Nodes will remain but their positions will be blank until new data is received. Continue?',
                    confirmLabel: 'Clear GPS Data',
                    danger: true,
                    action: async () => {
                      await window.electronAPI.db.clearNodePositions();
                    },
                  });
                }}
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                Clear GPS Data
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
                    name: 'Clear Position History',
                    title: 'Clear Position History',
                    message:
                      'This will permanently delete all stored position history from the database. Movement trails will no longer be shown for past sessions. Continue?',
                    confirmLabel: 'Clear Position History',
                    danger: true,
                    action: async () => {
                      await Promise.resolve();
                      clearHistory();
                    },
                  });
                }}
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                Clear Position History
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
                  aria-label={`Delete nodes last heard more than ${deleteAgeDays} days`}
                  className="bg-deep-black w-20 rounded border border-red-800/60 px-2 py-1 text-right text-sm text-gray-200 focus:border-red-500 focus:outline-none"
                />
                <span className="text-sm text-gray-300">{t('common.days')}</span>
                <button
                  type="button"
                  aria-label={t('appPanel.deleteOldNodes')}
                  onClick={() => {
                    executeWithConfirmation({
                      name: 'Delete Old Nodes',
                      title: 'Delete Old Nodes',
                      message: `This will permanently delete all nodes that haven't been heard in the last ${deleteAgeDays} day${deleteAgeDays !== 1 ? 's' : ''}. They will be re-discovered when they broadcast again.`,
                      confirmLabel: 'Delete Old Nodes',
                      danger: true,
                      action: async () => {
                        await window.electronAPI.db.deleteNodesByAge(deleteAgeDays);
                      },
                    });
                  }}
                  className="rounded border border-red-800 bg-red-900/50 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-red-300 transition-colors hover:bg-red-900/70"
                >
                  Delete Old Nodes
                </button>
              </div>
              <button
                type="button"
                aria-label={t('appPanel.pruneMqttOnlyNodes')}
                onClick={() => {
                  executeWithConfirmation({
                    name: 'Prune MQTT-only Nodes',
                    title: 'Prune MQTT-only Nodes',
                    message:
                      'This will permanently delete all nodes discovered only via MQTT (never heard via RF). They will reappear if heard again via MQTT or RF.',
                    confirmLabel: 'Prune MQTT Nodes',
                    danger: true,
                    action: async () => {
                      await window.electronAPI.db.deleteNodesBySource('mqtt');
                    },
                  });
                }}
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-left text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                Prune MQTT-only Nodes
              </button>
              <button
                type="button"
                aria-label={t('appPanel.pruneUnnamedNodes')}
                onClick={() => {
                  executeWithConfirmation({
                    name: 'Prune Unnamed Nodes',
                    title: 'Prune Unnamed Nodes',
                    message:
                      'This will permanently delete nodes with no real long name: empty names, auto-generated !hex placeholders, Node-HEX fallbacks tied to the node id, and MQTT-only identities that never received UserInfo. Favorited nodes are kept. They will be re-discovered when they broadcast again.',
                    confirmLabel: 'Prune Unnamed Nodes',
                    danger: true,
                    action: async () => {
                      await window.electronAPI.db.deleteNodesWithoutLongname();
                    },
                  });
                }}
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-left text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                Prune Unnamed Nodes
              </button>
              <button
                type="button"
                aria-label={t('appPanel.pruneNoFixNodes')}
                onClick={() => {
                  const zeroIslandNodes = Array.from(nodes.values()).filter(
                    (n) => Math.abs(n.latitude ?? 0) < 0.5 && Math.abs(n.longitude ?? 0) < 0.5,
                  );
                  if (zeroIslandNodes.length === 0) {
                    addToast(t('appPanel.noNoFixNodes'), 'success');
                    return;
                  }
                  executeWithConfirmation({
                    name: 'Prune No-Fix / Zero Island Nodes',
                    title: 'Prune No-Fix / Zero Island Nodes',
                    message: `This will permanently delete ${zeroIslandNodes.length} node${zeroIslandNodes.length !== 1 ? 's' : ''} with null or near-zero coordinates (no GPS fix or Zero Island). This cannot be undone.`,
                    confirmLabel: `Delete ${zeroIslandNodes.length} Node${zeroIslandNodes.length !== 1 ? 's' : ''}`,
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
                    name: 'Prune Distant Nodes',
                    title: 'Prune Distant Nodes',
                    message: `This will permanently delete ${distantNodes.length} node${distantNodes.length !== 1 ? 's' : ''} beyond ${settings.distanceFilterMax} ${settings.distanceUnit} from your device. This cannot be undone.`,
                    confirmLabel: `Delete ${distantNodes.length} Node${distantNodes.length !== 1 ? 's' : ''}`,
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
                  const offlineNodes = Array.from(nodes.values()).filter(
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
                    name: 'Prune Offline Nodes',
                    title: 'Prune Offline Nodes',
                    message: `This will permanently delete ${offlineNodes.length} node${offlineNodes.length !== 1 ? 's' : ''} not heard in over ${offlineDays} day${offlineDays !== 1 ? 's' : ''}. This cannot be undone.`,
                    confirmLabel: `Delete ${offlineNodes.length} Node${offlineNodes.length !== 1 ? 's' : ''}`,
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
                aria-label={`Clear All Nodes (${nodes.size})`}
                onClick={() => {
                  executeWithConfirmation({
                    name: 'Clear Nodes',
                    title: 'Clear Nodes',
                    message: `This will permanently delete all ${nodes.size} locally stored nodes. They will be re-discovered when connected.`,
                    confirmLabel: `Clear ${nodes.size} Nodes`,
                    danger: true,
                    action: async () => {
                      await window.electronAPI.db.clearNodes();
                    },
                  });
                }}
                className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
              >
                Clear All Nodes ({nodes.size})
              </button>

              {/* MeshCore contacts cleanup */}
              {protocol === 'meshcore' && (
                <button
                  type="button"
                  aria-label={t('appPanel.deleteNodesWithoutPubkeys')}
                  onClick={() => {
                    executeWithConfirmation({
                      name: 'Delete Contacts Without Pubkeys',
                      title: 'Delete Contacts Without Pubkeys',
                      message:
                        'This will permanently delete all MeshCore contacts from the database that have no public key. Chat stub nodes (created from messages) will be excluded. This cannot be undone.',
                      confirmLabel: 'Delete',
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

            {/* Messages */}
            <div className="space-y-2 border-t border-red-900/50 pt-4">
              <div className="text-xs font-medium tracking-wide text-red-400/90 uppercase">
                {t('appPanel.messagesSection')}
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="apppanel-clear-channel" className="shrink-0 text-sm text-gray-400">
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
              <button
                type="button"
                aria-label={`Clear Messages (${messageCount})`}
                onClick={() => {
                  const isAll = clearChannelTarget === CLEAR_ALL_CHANNELS_VALUE;
                  const channelName = isAll ? '' : getChannelLabel(clearChannelTarget);
                  executeWithConfirmation({
                    name: 'Clear Messages',
                    title: 'Clear Messages',
                    message: isAll
                      ? `This will permanently delete all ${messageCount} locally stored messages across all channels. This cannot be undone.`
                      : `This will permanently delete all messages from ${channelName}. This cannot be undone.`,
                    confirmLabel: isAll ? `Clear ${messageCount} Messages` : `Clear ${channelName}`,
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
                Clear Messages ({messageCount})
              </button>
            </div>

            {/* MeshCore */}
            {onClearMeshcoreRepeaters && (
              <div className="space-y-2 border-t border-red-900/50 pt-4">
                <div className="text-xs font-medium tracking-wide text-red-400 uppercase">
                  MeshCore
                </div>
                <button
                  type="button"
                  aria-label={t('appPanel.clearAllRepeaters')}
                  onClick={() => {
                    executeWithConfirmation({
                      name: 'Clear All Repeaters',
                      title: 'Clear All Repeaters',
                      message:
                        'This will permanently remove all saved MeshCore repeaters from the local database. This cannot be undone.',
                      confirmLabel: 'Clear All Repeaters',
                      danger: true,
                      action: onClearMeshcoreRepeaters,
                    });
                  }}
                  className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
                >
                  Clear All Repeaters
                </button>
              </div>
            )}

            {/* Everything */}
            <div className="space-y-2 border-t border-red-900/50 pt-4">
              <div className="text-xs font-medium tracking-wide text-red-400 uppercase">
                Everything
              </div>
              <button
                type="button"
                aria-label={t('appPanel.clearAllLocalData')}
                onClick={() => {
                  executeWithConfirmation({
                    name: 'Clear All Data',
                    title: '⚠ Clear All Local Data',
                    message:
                      'This will permanently delete ALL local messages, nodes, and cached session data. This action CANNOT be undone.',
                    confirmLabel: 'Clear Everything',
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
                Clear All Local Data &amp; Cache
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
