/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { LocationFilter } from '../App';
import { getAppSettingsRaw, mergeAppSetting, setAppSettingsRaw } from '../lib/appSettingsStorage';
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

const HISTORY_WINDOW_LABELS: Record<number, string> = {
  1: '1 hour',
  4: '4 hours',
  24: '24 hours',
  72: '3 days',
  168: '7 days',
};

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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label="Cancel"
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
            aria-label="Cancel"
            className="bg-secondary-dark flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
          >
            Cancel
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
  onMessagesPruned?: () => void;
  onClearMeshcoreRepeaters?: () => Promise<void>;
  onAutoFloodAdvertIntervalChange?: (hours: number) => void;
}

interface PendingAction {
  name: string;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  action: () => Promise<void>;
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
}: Props) {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const { addToast } = useToast();
  const clearDiagnostics = useDiagnosticsStore((s) => s.clearDiagnostics);
  const showPaths = usePositionHistoryStore((s) => s.showPaths);
  const setShowPaths = usePositionHistoryStore((s) => s.setShowPaths);
  const historyWindowHours = usePositionHistoryStore((s) => s.historyWindowHours);
  const setHistoryWindow = usePositionHistoryStore((s) => s.setHistoryWindow);
  const clearHistory = usePositionHistoryStore((s) => s.clearHistory);
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);

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
      setAppSettingsRaw(JSON.stringify(settings));
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

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    mergeAppSetting(key, value, 'AppPanel updateSetting');
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
        console.warn('[AppPanel] fetchMessageRetention failed', e);
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
          console.error('[AppPanel] persist message retention failed', err);
          addToast('Failed to save message retention setting.', 'error');
          setRetention(previous);
        },
      );
    },
    [addToast],
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
        console.debug('[AppPanel] persist gps interval', e);
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
      addToast('Invalid latitude. Must be between -90 and 90.', 'error');
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      addToast('Invalid longitude. Must be between -180 and 180.', 'error');
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
      addToast('Static position saved.', 'success');
    } catch (e) {
      console.warn('[AppPanel] save static position failed', e);
      addToast('Failed to save static position.', 'error');
    }
  }, [staticLatInput, staticLonInput, addToast, onRefreshGps, onGpsIntervalChange]);

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
      addToast('Static position cleared.', 'success');
    } catch (e) {
      console.warn('[AppPanel] clear static position failed', e);
      addToast('Failed to clear static position.', 'error');
    }
  }, [addToast, onRefreshGps]);

  // ─── Message channel selection ──────────────────────────────
  const [msgChannels, setMsgChannels] = useState<number[]>([]);
  const [clearChannelTarget, setClearChannelTarget] = useState<number>(CLEAR_ALL_CHANNELS_VALUE);

  useEffect(() => {
    if (protocol === 'meshcore') {
      window.electronAPI.db
        .getMeshcoreMessageChannels()
        .then((rows) => {
          setMsgChannels(rows.map((r) => r.channel));
        })
        .catch((e: unknown) => {
          console.debug('[AppPanel] getMeshcoreMessageChannels', e);
        });
    } else {
      window.electronAPI.db
        .getMessageChannels()
        .then((rows) => {
          setMsgChannels(rows.map((r) => r.channel));
        })
        .catch((e: unknown) => {
          console.debug('[AppPanel] getMessageChannels', e);
        });
    }
  }, [protocol]);

  useEffect(() => {
    setClearChannelTarget(CLEAR_ALL_CHANNELS_VALUE);
  }, [protocol]);

  const getChannelLabel = useCallback(
    (ch: number) => {
      if (ch === -1) return 'Direct messages';
      const named = channels.find((c) => c.index === ch);
      return named ? `Channel ${ch} — ${named.name}` : `Channel ${ch}`;
    },
    [channels],
  );

  // ─── Confirmation flow ──────────────────────────────────────
  const executeWithConfirmation = useCallback((action: PendingAction) => {
    setPendingAction(action);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pendingAction) return;
    const actionName = pendingAction.name;
    setPendingAction(null);
    try {
      await pendingAction.action();
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
      if (messageActions.includes(actionName)) onMessagesPruned?.();
      addToast(`${actionName} completed successfully.`, 'success');
    } catch (err) {
      console.warn('[AppPanel] pending action failed', err);
      addToast(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  }, [pendingAction, addToast, onNodesPruned, onMessagesPruned]);

  return (
    <div className="w-full space-y-6">
      <h2 className="text-xl font-semibold text-gray-200">App Settings</h2>

      {/* Log panel visibility */}
      {onLogPanelVisibleChange && (
        <div className="space-y-2">
          <h3 className="text-muted text-sm font-medium">Log panel</h3>
          <div className="bg-secondary-dark rounded-lg p-4">
            <div className="flex items-center gap-2">
              <input
                id="log-panel-visible-checkbox"
                type="checkbox"
                checked={logPanelVisible}
                onChange={(e) => {
                  onLogPanelVisibleChange(e.target.checked);
                }}
                aria-label="Show log panel (right side)"
                className="rounded border-gray-600"
              />
              <label
                htmlFor="log-panel-visible-checkbox"
                className="cursor-pointer text-sm text-gray-300"
              >
                Show log panel (right side)
              </label>
            </div>
            <p className="text-muted mt-2 text-xs">
              When enabled, a live log stream appears on the right. Debug lines require the checkbox
              inside the log panel.
            </p>
          </div>
        </div>
      )}

      {/* Flood Advert schedule (MeshCore only) */}
      {protocol === 'meshcore' && (
        <div className="space-y-2">
          <h3 className="text-muted text-sm font-medium">Flood Advert</h3>
          <div className="bg-secondary-dark space-y-2 rounded-lg p-4">
            <label htmlFor="flood-advert-interval" className="text-sm text-gray-300">
              Automatically send a flood advert on a schedule:
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
              <option value={0}>Disabled</option>
              <option value={12}>Every 12 hours</option>
              <option value={24}>Every 24 hours</option>
            </select>
            <p className="text-muted text-xs">
              Sends a flood advert when connected and repeats at the chosen interval to keep your
              node visible on the mesh.
            </p>
          </div>
        </div>
      )}

      {/* GPS / Location */}
      <div className="space-y-3">
        <h3 className="text-muted text-sm font-medium">GPS / Location</h3>
        <div className="bg-secondary-dark space-y-4 rounded-lg p-4">
          {ourPosition && (
            <p className="text-brand-green text-xs">
              {ourPosition.source === 'device'
                ? `Device GPS: ${formatCoordPair(ourPosition.lat, ourPosition.lon, coordinateFormat)}`
                : ourPosition.source === 'static'
                  ? `Static position: ${formatCoordPair(ourPosition.lat, ourPosition.lon, coordinateFormat)}`
                  : ourPosition.source === 'browser'
                    ? `Browser location: ${formatCoordPair(ourPosition.lat, ourPosition.lon, coordinateFormat)}`
                    : `IP location (city-level): ${formatCoordPair(ourPosition.lat, ourPosition.lon, coordinateFormat)}`}
            </p>
          )}
          {!ourPosition && <p className="text-muted text-xs">No GPS position resolved yet.</p>}

          {/* Static position override */}
          <div className="space-y-2 border-t border-gray-700 pt-1">
            <p className="text-muted text-xs leading-relaxed">
              Set a precise static position. When saved, this overrides browser and IP-based
              location.
            </p>
            <div className="flex items-center gap-2">
              <label htmlFor="apppanel-static-lat" className="w-8 text-sm text-gray-300">
                Lat:
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
                placeholder="e.g. 40.12345"
                aria-label={`Lat: ${staticLatInput || 'e.g. 40.12345'}`}
                className="bg-deep-black focus:border-brand-green flex-1 rounded border border-gray-600 px-2 py-1 text-sm text-gray-200 focus:outline-none"
              />
              <label htmlFor="apppanel-static-lon" className="w-8 text-sm text-gray-300">
                Lon:
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
                placeholder="e.g. -105.12345"
                aria-label={`Lon: ${staticLonInput || 'e.g. -105.12345'}`}
                className="bg-deep-black focus:border-brand-green flex-1 rounded border border-gray-600 px-2 py-1 text-sm text-gray-200 focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={saveStaticPosition}
                aria-label="Save Static Position"
                className="bg-brand-green/20 text-brand-green hover:bg-brand-green/30 border-brand-green/40 flex-1 rounded border px-3 py-1.5 text-sm font-medium transition-colors"
              >
                Save Static Position
              </button>
              {hasStaticPosition && (
                <button
                  onClick={clearStaticPosition}
                  aria-label="Clear"
                  className="bg-secondary-dark rounded px-3 py-1.5 text-sm font-medium text-gray-400 transition-colors hover:bg-gray-600"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="apppanel-gps-interval" className="flex-1 text-sm text-gray-300">
              Auto-refresh interval:
            </label>
            <select
              id="apppanel-gps-interval"
              value={gpsRefreshInterval}
              onChange={(e) => {
                handleGpsIntervalChange(Number(e.target.value));
              }}
              disabled={hasStaticPosition}
              aria-label={`Auto-refresh interval: ${GPS_REFRESH_INTERVAL_LABELS[gpsRefreshInterval] ?? gpsRefreshInterval}`}
              className={`bg-deep-black focus:border-brand-green rounded border border-gray-600 px-2 py-1 text-sm text-gray-200 focus:outline-none ${hasStaticPosition ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              <option value={0}>Manual only</option>
              <option value={900}>Every 15 min</option>
              <option value={1800}>Every 30 min</option>
              <option value={3600}>Every hour</option>
              <option value={7200}>Every 2 hours</option>
            </select>
          </div>
          {hasStaticPosition && (
            <p className="text-muted text-xs">
              Auto-refresh is disabled while a static position is active.
            </p>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="apppanel-coord-format" className="flex-1 text-sm text-gray-300">
              Coordinate format:
            </label>
            <select
              id="apppanel-coord-format"
              value={settings.coordinateFormat}
              onChange={(e) => {
                const fmt = e.target.value as 'decimal' | 'mgrs';
                updateSetting('coordinateFormat', fmt);
                useCoordFormatStore.getState().setCoordinateFormat(fmt);
              }}
              aria-label={`Coordinate format: ${settings.coordinateFormat === 'mgrs' ? 'MGRS' : 'Decimal Degrees'}`}
              className="bg-deep-black focus:border-brand-green rounded border border-gray-600 px-2 py-1 text-sm text-gray-200 focus:outline-none"
            >
              <option value="decimal">Decimal Degrees</option>
              <option value="mgrs">MGRS</option>
            </select>
          </div>
          <button
            onClick={() => onRefreshGps?.()}
            disabled={gpsLoading}
            aria-label={gpsLoading ? 'Refreshing...' : 'Refresh Now'}
            className={`bg-secondary-dark rounded-lg px-4 py-2 text-sm font-medium text-gray-300 transition-colors ${gpsLoading ? 'cursor-not-allowed opacity-50' : 'hover:bg-gray-600'}`}
          >
            {gpsLoading ? 'Refreshing...' : 'Refresh Now'}
          </button>
        </div>
      </div>

      {/* Map & Node Filtering */}
      <div className="space-y-3">
        <h3 className="text-muted text-sm font-medium">Map &amp; Node Filtering</h3>
        <div className="bg-secondary-dark space-y-4 rounded-lg p-4">
          <p className="text-muted text-xs leading-relaxed">
            Hides nodes beyond a set distance from your device. Filtering is display-only — nodes
            remain in the database.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="distanceFilter"
              checked={settings.distanceFilterEnabled}
              onChange={(e) => {
                updateSetting('distanceFilterEnabled', e.target.checked);
              }}
              aria-label="Filter distant nodes from map and node list"
              className="accent-brand-green"
            />
            <label htmlFor="distanceFilter" className="cursor-pointer text-sm text-gray-300">
              Filter distant nodes from map and node list
            </label>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="apppanel-max-distance" className="text-sm text-gray-300">
              Max distance:
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
              Unit:
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
              <option value="miles">miles</option>
              <option value="km">km</option>
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
                  Your device has no GPS fix — filter is enabled but all nodes are shown.
                </p>
              ) : null;
            })()}
          <p className="text-muted text-xs">Note: Requires your device to have a valid GPS fix.</p>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="filterMqttOnly"
              checked={settings.filterMqttOnly}
              onChange={(e) => {
                updateSetting('filterMqttOnly', e.target.checked);
              }}
              aria-label="Hide MQTT-only nodes from map and node list"
              className="accent-brand-green"
            />
            <label htmlFor="filterMqttOnly" className="cursor-pointer text-sm text-gray-300">
              Hide MQTT-only nodes from map and node list
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
              aria-label="Show movement paths"
              className="accent-brand-green"
            />
            <label htmlFor="showMovementPaths" className="cursor-pointer text-sm text-gray-300">
              Show movement paths
            </label>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="apppanel-history-window" className="shrink-0 text-sm text-gray-400">
              Position history window:
            </label>
            <select
              id="apppanel-history-window"
              value={historyWindowHours}
              onChange={(e) => {
                setHistoryWindow(Number(e.target.value));
              }}
              aria-label={`Position history window: ${HISTORY_WINDOW_LABELS[historyWindowHours] ?? historyWindowHours}`}
              className="bg-deep-black focus:border-brand-green rounded border border-gray-600 px-2 py-1 text-sm text-gray-200 focus:outline-none"
            >
              <option value={1}>1 hour</option>
              <option value={4}>4 hours</option>
              <option value={24}>24 hours</option>
              <option value={72}>3 days</option>
              <option value={168}>7 days</option>
            </select>
          </div>
        </div>
      </div>

      {/* Retention & limits (config only — destructive actions are in Danger Zone below) */}
      <div className="space-y-3">
        <h3 className="text-muted text-sm font-medium">Retention &amp; limits</h3>

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
                aria-label="Auto-prune nodes on startup, older than"
                className="accent-brand-green"
              />
              <label
                id="apppanel-auto-prune-label"
                htmlFor="autoPrune"
                className="flex-1 cursor-pointer text-sm text-gray-300"
              >
                Auto-prune nodes on startup, older than
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
              <span className="text-sm text-gray-300">days</span>
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
                  aria-label="Remove unnamed nodes on startup"
                  className="accent-brand-green"
                />
                <label
                  htmlFor="pruneEmptyNames"
                  className="flex-1 cursor-pointer text-sm text-gray-300"
                >
                  Remove unnamed nodes on startup
                </label>
              </div>
              <p className="text-muted pl-6 text-xs">
                Includes MQTT-only placeholders that still use the default !hex ID; favorited nodes
                are kept.
              </p>
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
                aria-label="Cap total nodes, keep newest"
                className="accent-brand-green"
              />
              <label
                id="apppanel-node-cap-label"
                htmlFor="nodeCap"
                className="flex-1 cursor-pointer text-sm text-gray-300"
              >
                Cap total nodes, keep newest
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
              <span className="text-sm text-gray-300">nodes</span>
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
                aria-label="Auto-prune position history on startup, older than"
                className="accent-brand-green"
              />
              <label
                id="apppanel-position-history-prune-label"
                htmlFor="positionHistoryPrune"
                className="flex-1 cursor-pointer text-sm text-gray-300"
              >
                Auto-prune position history on startup, older than
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
              <span className="text-sm text-gray-300">days</span>
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
                  aria-label="Remove contacts that have never advertised on startup"
                  className="accent-brand-green"
                />
                <label
                  htmlFor="meshcoreDeleteNeverAdvertised"
                  className="flex-1 cursor-pointer text-sm text-gray-300"
                >
                  Remove contacts that have never advertised on startup
                </label>
              </div>
              <p className="text-muted pl-6 text-xs">
                Removes stale placeholder contacts with no advert history; favorited contacts are
                kept.
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
                aria-label="Auto-prune unheard contacts on startup, older than"
                className="accent-brand-green"
              />
              <label
                id="apppanel-meshcore-auto-prune-label"
                htmlFor="meshcoreAutoPrune"
                className="flex-1 cursor-pointer text-sm text-gray-300"
              >
                Auto-prune unheard contacts on startup, older than
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
              <span className="text-sm text-gray-300">days</span>
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
                aria-label="Cap total contacts, keep most recently seen"
                className="accent-brand-green"
              />
              <label
                id="apppanel-meshcore-contact-cap-label"
                htmlFor="meshcoreContactCap"
                className="flex-1 cursor-pointer text-sm text-gray-300"
              >
                Cap total contacts, keep most recently seen
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
              <span className="text-sm text-gray-300">contacts</span>
            </div>
          </div>
        )}

        {/* Messages: load limit (localStorage) + DB retention cap — single card (issue #387). */}
        <div className="bg-secondary-dark space-y-3 rounded-lg p-4">
          <p className="text-muted text-xs leading-relaxed">
            Limit how many messages load into memory for the UI, and cap how many rows stay in
            SQLite. Loading fewer keeps RAM down on busy networks; the database cap prunes older
            messages on app startup (stored per protocol).
          </p>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="messageLimit"
              checked={settings.messageLimitEnabled}
              onChange={(e) => {
                updateSetting('messageLimitEnabled', e.target.checked);
              }}
              aria-label="Limit messages loaded"
              className="accent-brand-green"
            />
            <label
              id="apppanel-message-limit-label"
              htmlFor="messageLimit"
              className="flex-1 cursor-pointer text-sm text-gray-300"
            >
              Limit messages loaded
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
            <span className="text-sm text-gray-300">messages</span>
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
                aria-label="Cap stored messages, keep newest"
                className="accent-brand-green"
              />
              <label
                id="apppanel-message-retention-meshtastic-label"
                htmlFor="messageRetentionMeshtastic"
                className="flex-1 cursor-pointer text-sm text-gray-300"
              >
                Cap stored messages, keep newest
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
              <span className="text-sm text-gray-300">messages</span>
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
                aria-label="Cap stored messages, keep newest"
                className="accent-brand-green"
              />
              <label
                id="apppanel-message-retention-meshcore-label"
                htmlFor="messageRetentionMeshcore"
                className="flex-1 cursor-pointer text-sm text-gray-300"
              >
                Cap stored messages, keep newest
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
              <span className="text-sm text-gray-300">messages</span>
            </div>
          )}
        </div>
      </div>

      {/* Data Management */}
      <div className="space-y-3">
        <h3 className="text-muted text-sm font-medium">Data Management</h3>
        <p className="text-muted text-xs">
          Export your local database (messages &amp; nodes) as a .db file, or import/merge another
          user's database into yours.
        </p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          <button
            aria-label="Export Database"
            onClick={async () => {
              try {
                console.debug('[AppPanel] exportDb');
                const path = await window.electronAPI.db.exportDb();
                if (path) {
                  addToast(`Exported to: ${path}`, 'success');
                }
              } catch (err) {
                console.warn('[AppPanel] export failed', err);
                addToast(
                  `Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                  'error',
                );
              }
            }}
            className="bg-secondary-dark rounded-lg px-4 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
          >
            Export Database
          </button>

          <button
            aria-label="Import & Merge"
            onClick={async () => {
              try {
                console.debug('[AppPanel] importDb');
                const result = await window.electronAPI.db.importDb();
                if (result) {
                  addToast(
                    `Merged: ${result.nodesAdded} new nodes, ${result.messagesAdded} new messages.`,
                    'success',
                  );
                }
              } catch (err) {
                console.warn('[AppPanel] import failed', err);
                addToast(
                  `Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                  'error',
                );
              }
            }}
            className="bg-secondary-dark rounded-lg px-4 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
          >
            Import &amp; Merge
          </button>
        </div>
      </div>

      {/* Appearance — collapsible; preset-only colors (no text input — Electron macOS menu warnings). */}
      <div className="space-y-2">
        <h3 className="text-muted text-sm font-medium">Appearance</h3>
        <details className="group bg-secondary-dark rounded-lg border border-gray-700">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium text-gray-200 hover:bg-gray-800/40 [&::-webkit-details-marker]:hidden">
            <span>Color scheme</span>
            <svg
              className="text-muted h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </summary>
          <div className="space-y-3 border-t border-gray-700 px-4 pt-1 pb-4">
            <p className="text-muted text-xs">
              Changes apply immediately and persist. Hover a token name for where it is used.
            </p>
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
                    className="max-w-[9rem] min-w-[6.5rem] shrink-0 text-sm font-medium text-gray-200"
                    title={meta.description}
                  >
                    {meta.label}
                  </div>
                  <div
                    className="flex max-w-full min-w-0 flex-1 flex-nowrap gap-1 py-0.5 [scrollbar-width:thin]"
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
                addToast('Colors reset to app defaults.', 'success');
              }}
              aria-label="Reset all colors to defaults"
              className="bg-deep-black w-full rounded-lg border border-gray-600 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
            >
              Reset all colors to defaults
            </button>
          </div>
        </details>
      </div>

      {/* Danger Zone — collapsible; same pattern as Appearance → Color scheme */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-red-400">Danger Zone</h3>
        <details className="group rounded-lg border border-red-900 bg-red-950/20">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium text-red-300 hover:bg-red-950/40 [&::-webkit-details-marker]:hidden">
            <span>Destructive actions</span>
            <svg
              className="text-muted h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </summary>
          <div className="space-y-4 border-t border-red-900/50 px-4 pt-1 pb-4">
            <p className="text-xs text-red-400/80">
              These actions are permanent and cannot be undone. Confirm each step carefully.
            </p>

            {/* Diagnostics (in-memory reset) */}
            <div className="space-y-2">
              <div className="text-xs font-medium tracking-wide text-red-400/90 uppercase">
                Diagnostics
              </div>
              <p className="text-muted text-xs leading-relaxed">
                Clears in-memory routing anomalies, hop history, and packet stats. Rebuilds from new
                packets.
              </p>
              <button
                type="button"
                aria-label="Reset Diagnostics"
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
                GPS positions
              </div>
              <p className="text-muted text-xs leading-relaxed">
                Removes stored GPS coordinates from all nodes without deleting nodes. Positions
                repopulate as new data arrives.
              </p>
              <button
                type="button"
                aria-label="Clear GPS Data"
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
                Position History
              </div>
              <p className="text-muted text-xs leading-relaxed">
                Clears all persisted movement trail data and the current in-memory path overlay. New
                positions will resume tracking immediately.
              </p>
              <button
                type="button"
                aria-label="Clear Position History"
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
                Nodes
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="apppanel-delete-age-days" className="text-sm text-gray-300">
                  Delete nodes last heard more than
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
                <span className="text-sm text-gray-300">days</span>
                <button
                  type="button"
                  aria-label="Delete Old Nodes"
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
                aria-label="Prune MQTT-only Nodes"
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
                aria-label="Prune Unnamed Nodes"
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
                aria-label="Prune No-Fix / Zero Island Nodes Removes nodes with null or near-zero coordinates (no GPS fix or at 0 deg N, 0 deg E)."
                onClick={() => {
                  const zeroIslandNodes = Array.from(nodes.values()).filter(
                    (n) => Math.abs(n.latitude ?? 0) < 0.5 && Math.abs(n.longitude ?? 0) < 0.5,
                  );
                  if (zeroIslandNodes.length === 0) {
                    addToast('No no-fix or zero-island nodes found.', 'success');
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
                <div className="font-medium">Prune No-Fix / Zero Island Nodes</div>
                <div className="mt-0.5 text-xs text-red-400/70">
                  Removes nodes with no GPS fix (null coords) or near 0°N, 0°E.
                </div>
              </button>
              <button
                type="button"
                aria-label="Prune Distant Nodes Beyond the distance threshold in Map & Node Filtering. Requires a valid GPS location."
                onClick={() => {
                  const homeNode = myNodeNum != null ? nodes.get(myNodeNum) : undefined;
                  const homeLat = homeNode?.latitude ?? ourPosition?.lat;
                  const homeLon = homeNode?.longitude ?? ourPosition?.lon;
                  const hasHome =
                    homeLat != null && homeLon != null && (homeLat !== 0 || homeLon !== 0);
                  if (!hasHome) {
                    addToast(
                      'No GPS position available. Use device node coordinates or enable GPS in the app.',
                      'error',
                    );
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
                    addToast('No nodes found beyond the distance threshold.', 'success');
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
                <div className="font-medium">Prune Distant Nodes</div>
                <div className="mt-0.5 text-xs text-red-400/70">
                  Beyond the distance threshold in Map &amp; Node Filtering. Requires a valid GPS
                  location.
                </div>
              </button>
              <button
                type="button"
                aria-label="Prune Offline Nodes that have not been heard within the offline threshold"
                onClick={() => {
                  const offlineNodes = Array.from(nodes.values()).filter(
                    (n) =>
                      n.node_id !== myNodeNum &&
                      !n.favorited &&
                      getNodeStatus(n.last_heard, nodeStaleThresholdMs, nodeOfflineThresholdMs) ===
                        'offline',
                  );
                  if (offlineNodes.length === 0) {
                    addToast('No offline nodes found.', 'success');
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
                <div className="font-medium">Prune Offline Nodes</div>
                <div className="mt-0.5 text-xs text-red-400/70">
                  Not heard in over {Math.round(nodeOfflineThresholdMs / (24 * 60 * 60 * 1000))}{' '}
                  days. Favorited nodes are excluded.
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
                  aria-label="Delete All Nodes Without Pubkeys"
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
                          `Deleted ${result.deleted} contacts. ${result.excludedStubCount} chat stub nodes excluded.`,
                          'success',
                        );
                      },
                    });
                  }}
                  className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-2.5 text-left text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70"
                >
                  <div className="font-medium">Delete Contacts Without Pubkeys</div>
                  <div className="mt-0.5 text-xs text-red-400/70">
                    Excludes chat stub nodes created from messages.
                  </div>
                </button>
              )}
            </div>

            {/* Messages */}
            <div className="space-y-2 border-t border-red-900/50 pt-4">
              <div className="text-xs font-medium tracking-wide text-red-400/90 uppercase">
                Messages
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="apppanel-clear-channel" className="shrink-0 text-sm text-gray-400">
                  Channel:
                </label>
                <select
                  id="apppanel-clear-channel"
                  value={clearChannelTarget}
                  onChange={(e) => {
                    setClearChannelTarget(parseInt(e.target.value, 10));
                  }}
                  aria-label="Channel:"
                  className="bg-deep-black flex-1 rounded-lg border border-red-800/60 px-3 py-1.5 text-sm text-gray-200 focus:border-red-500 focus:outline-none"
                >
                  <option value={CLEAR_ALL_CHANNELS_VALUE}>All Channels</option>
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
                  aria-label="Clear All Repeaters"
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
                aria-label="Clear All Local Data & Cache"
                onClick={() => {
                  executeWithConfirmation({
                    name: 'Clear All Data',
                    title: '⚠ Clear All Local Data',
                    message:
                      'This will permanently delete ALL local messages, nodes, and cached session data. This action CANNOT be undone.',
                    confirmLabel: 'Clear Everything',
                    danger: true,
                    action: async () => {
                      await window.electronAPI.db.clearMessages();
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
