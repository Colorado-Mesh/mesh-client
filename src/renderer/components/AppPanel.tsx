import { useCallback, useEffect, useRef, useState } from 'react';

import type { LocationFilter } from '../App';
import { getAppSettingsRaw, mergeAppSetting, setAppSettingsRaw } from '../lib/appSettingsStorage';
import { formatCoordPair } from '../lib/coordUtils';
import { DEFAULT_APP_SETTINGS_SHARED } from '../lib/defaultAppSettings';
import type { OurPosition } from '../lib/gpsSource';
import { haversineDistanceKm } from '../lib/nodeStatus';
import { parseStoredJson } from '../lib/parseStoredJson';
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
        className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-pointer border-0 p-0"
        onClick={onCancel}
      />
      {/* Modal */}
      <div className="relative bg-deep-black border border-gray-600 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6 space-y-4">
        <h3 className="text-lg font-semibold text-gray-200">{title}</h3>
        <p className="text-sm text-muted leading-relaxed">{message}</p>
        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            aria-label="Cancel"
            className="flex-1 px-4 py-2.5 bg-secondary-dark hover:bg-gray-600 text-gray-300 font-medium rounded-lg transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            aria-label={confirmLabel}
            className={`flex-1 px-4 py-2.5 font-medium rounded-lg transition-colors text-sm text-white ${
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
    <div className="max-w-5xl mx-auto space-y-6">
      <h2 className="text-xl font-semibold text-gray-200">App Settings</h2>

      {/* Log panel visibility */}
      {onLogPanelVisibleChange && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted">Log panel</h3>
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
                className="text-sm text-gray-300 cursor-pointer"
              >
                Show log panel (right side)
              </label>
            </div>
            <p className="text-xs text-muted mt-2">
              When enabled, a live log stream appears on the right. Debug lines require the checkbox
              inside the log panel.
            </p>
          </div>
        </div>
      )}

      {/* Flood Advert schedule (MeshCore only) */}
      {protocol === 'meshcore' && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted">Flood Advert</h3>
          <div className="bg-secondary-dark rounded-lg p-4 space-y-2">
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
              className="w-full px-3 py-2 bg-deep-black rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
            >
              <option value={0}>Disabled</option>
              <option value={12}>Every 12 hours</option>
              <option value={24}>Every 24 hours</option>
            </select>
            <p className="text-xs text-muted">
              Sends a flood advert when connected and repeats at the chosen interval to keep your
              node visible on the mesh.
            </p>
          </div>
        </div>
      )}

      {/* GPS / Location */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted">GPS / Location</h3>
        <div className="bg-secondary-dark rounded-lg p-4 space-y-4">
          {ourPosition && (
            <p className="text-xs text-brand-green">
              {ourPosition.source === 'device'
                ? `Device GPS: ${formatCoordPair(ourPosition.lat, ourPosition.lon, coordinateFormat)}`
                : ourPosition.source === 'static'
                  ? `Static position: ${formatCoordPair(ourPosition.lat, ourPosition.lon, coordinateFormat)}`
                  : ourPosition.source === 'browser'
                    ? `Browser location: ${formatCoordPair(ourPosition.lat, ourPosition.lon, coordinateFormat)}`
                    : `IP location (city-level): ${formatCoordPair(ourPosition.lat, ourPosition.lon, coordinateFormat)}`}
            </p>
          )}
          {!ourPosition && <p className="text-xs text-muted">No GPS position resolved yet.</p>}

          {/* Static position override */}
          <div className="space-y-2 pt-1 border-t border-gray-700">
            <p className="text-xs text-muted leading-relaxed">
              Set a precise static position. When saved, this overrides browser and IP-based
              location.
            </p>
            <div className="flex items-center gap-2">
              <label htmlFor="apppanel-static-lat" className="text-sm text-gray-300 w-8">
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
                className="flex-1 px-2 py-1 bg-deep-black border border-gray-600 rounded text-gray-200 text-sm focus:border-brand-green focus:outline-none"
              />
              <label htmlFor="apppanel-static-lon" className="text-sm text-gray-300 w-8">
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
                className="flex-1 px-2 py-1 bg-deep-black border border-gray-600 rounded text-gray-200 text-sm focus:border-brand-green focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={saveStaticPosition}
                aria-label="Save Static Position"
                className="flex-1 px-3 py-1.5 bg-brand-green/20 text-brand-green hover:bg-brand-green/30 border border-brand-green/40 rounded text-sm font-medium transition-colors"
              >
                Save Static Position
              </button>
              {hasStaticPosition && (
                <button
                  onClick={clearStaticPosition}
                  aria-label="Clear"
                  className="px-3 py-1.5 bg-secondary-dark text-gray-400 hover:bg-gray-600 rounded text-sm font-medium transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="apppanel-gps-interval" className="text-sm text-gray-300 flex-1">
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
              className={`px-2 py-1 bg-deep-black border border-gray-600 rounded text-gray-200 text-sm focus:border-brand-green focus:outline-none ${hasStaticPosition ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <option value={0}>Manual only</option>
              <option value={900}>Every 15 min</option>
              <option value={1800}>Every 30 min</option>
              <option value={3600}>Every hour</option>
              <option value={7200}>Every 2 hours</option>
            </select>
          </div>
          {hasStaticPosition && (
            <p className="text-xs text-muted">
              Auto-refresh is disabled while a static position is active.
            </p>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="apppanel-coord-format" className="text-sm text-gray-300 flex-1">
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
              className="px-2 py-1 bg-deep-black border border-gray-600 rounded text-gray-200 text-sm focus:border-brand-green focus:outline-none"
            >
              <option value="decimal">Decimal Degrees</option>
              <option value="mgrs">MGRS</option>
            </select>
          </div>
          <button
            onClick={() => onRefreshGps?.()}
            disabled={gpsLoading}
            aria-label={gpsLoading ? 'Refreshing...' : 'Refresh Now'}
            className={`px-4 py-2 bg-secondary-dark text-gray-300 rounded-lg text-sm font-medium transition-colors ${gpsLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-600'}`}
          >
            {gpsLoading ? 'Refreshing...' : 'Refresh Now'}
          </button>
        </div>
      </div>

      {/* Map & Node Filtering */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted">Map &amp; Node Filtering</h3>
        <div className="bg-secondary-dark rounded-lg p-4 space-y-4">
          <p className="text-xs text-muted leading-relaxed">
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
            <label htmlFor="distanceFilter" className="text-sm text-gray-300 cursor-pointer">
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
              className="w-24 px-2 py-1 bg-deep-black border border-gray-600 rounded text-gray-200 text-sm text-right focus:border-brand-green focus:outline-none disabled:opacity-40"
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
              className="px-2 py-1 bg-deep-black border border-gray-600 rounded text-gray-200 text-sm focus:border-brand-green focus:outline-none disabled:opacity-40"
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
                <p className="text-xs text-yellow-300 bg-yellow-900/30 border border-yellow-700 px-2 py-1.5 rounded">
                  Your device has no GPS fix — filter is enabled but all nodes are shown.
                </p>
              ) : null;
            })()}
          <p className="text-xs text-muted">Note: Requires your device to have a valid GPS fix.</p>
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
            <label htmlFor="filterMqttOnly" className="text-sm text-gray-300 cursor-pointer">
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
            <label htmlFor="showMovementPaths" className="text-sm text-gray-300 cursor-pointer">
              Show movement paths
            </label>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="apppanel-history-window" className="text-sm text-gray-400 shrink-0">
              Position history window:
            </label>
            <select
              id="apppanel-history-window"
              value={historyWindowHours}
              onChange={(e) => {
                setHistoryWindow(Number(e.target.value));
              }}
              aria-label={`Position history window: ${HISTORY_WINDOW_LABELS[historyWindowHours] ?? historyWindowHours}`}
              className="px-2 py-1 bg-deep-black border border-gray-600 rounded text-gray-200 text-sm focus:border-brand-green focus:outline-none"
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
        <h3 className="text-sm font-medium text-muted">Retention &amp; limits</h3>
        <div className="bg-secondary-dark rounded-lg p-4 space-y-4">
          {/* Auto-prune on startup */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="autoPrune"
              checked={settings.autoPruneEnabled}
              onChange={(e) => {
                updateSetting('autoPruneEnabled', e.target.checked);
              }}
              aria-label="Auto-prune on startup, older than"
              className="accent-brand-green"
            />
            <label
              id="apppanel-auto-prune-label"
              htmlFor="autoPrune"
              className="text-sm text-gray-300 flex-1 cursor-pointer"
            >
              Auto-prune on startup, older than
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
              aria-label={`Auto-prune on startup, older than ${settings.autoPruneDays} days`}
              className="w-20 px-2 py-1 bg-deep-black border border-gray-600 rounded text-gray-200 text-sm text-right focus:border-brand-green focus:outline-none disabled:opacity-40"
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
                className="text-sm text-gray-300 flex-1 cursor-pointer"
              >
                Remove unnamed nodes on startup
              </label>
            </div>
            <p className="text-xs text-muted pl-6">
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
              className="text-sm text-gray-300 flex-1 cursor-pointer"
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
              className="w-24 px-2 py-1 bg-deep-black border border-gray-600 rounded text-gray-200 text-sm text-right focus:border-brand-green focus:outline-none disabled:opacity-40"
            />
            <span className="text-sm text-gray-300">nodes</span>
          </div>
        </div>

        {/* Message limit */}
        <div className="bg-secondary-dark rounded-lg p-4 space-y-3">
          <p className="text-xs text-muted leading-relaxed">
            Limits how many messages are loaded from the database. Helps keep memory usage low on
            busy networks.
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
              className="text-sm text-gray-300 flex-1 cursor-pointer"
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
              className="w-24 px-2 py-1 bg-deep-black border border-gray-600 rounded text-gray-200 text-sm text-right focus:border-brand-green focus:outline-none disabled:opacity-40"
            />
            <span className="text-sm text-gray-300">messages</span>
          </div>
        </div>
      </div>

      {/* Data Management */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted">Data Management</h3>
        <p className="text-xs text-muted">
          Export your local database (messages &amp; nodes) as a .db file, or import/merge another
          user's database into yours.
        </p>
        <div className="grid grid-cols-2 gap-2">
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
            className="px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
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
            className="px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
          >
            Import &amp; Merge
          </button>
        </div>
      </div>

      {/* Appearance — collapsible; preset-only colors (no text input — Electron macOS menu warnings). */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted">Appearance</h3>
        <details className="group bg-secondary-dark rounded-lg border border-gray-700">
          <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-200 flex items-center justify-between gap-2 hover:bg-gray-800/40 rounded-lg list-none [&::-webkit-details-marker]:hidden">
            <span>Color scheme</span>
            <svg
              className="w-4 h-4 text-muted shrink-0 group-open:rotate-180 transition-transform"
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
          <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-700">
            <p className="text-xs text-muted">
              Changes apply immediately and persist. Hover a token name for where it is used.
            </p>
            {THEME_TOKEN_META.map((meta) => {
              const hex = themeColors[meta.key];
              return (
                <div
                  key={meta.key}
                  className="flex flex-wrap items-center gap-2 pb-2 border-b border-gray-600/80 last:border-0 last:pb-0"
                >
                  <span
                    className="w-6 h-6 rounded border border-gray-600 shrink-0"
                    style={{ backgroundColor: hex }}
                    title={hex}
                    aria-hidden="true"
                  />
                  <div
                    id={`theme-color-heading-${meta.key}`}
                    className="text-sm font-medium text-gray-200 shrink-0 min-w-[6.5rem] max-w-[9rem]"
                    title={meta.description}
                  >
                    {meta.label}
                  </div>
                  <div
                    className="flex flex-nowrap gap-1 overflow-x-auto max-w-full min-w-0 flex-1 py-0.5 [scrollbar-width:thin]"
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
                          className={`w-6 h-6 rounded border shrink-0 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-brand-green/50 ${
                            selected
                              ? 'ring-2 ring-brand-green ring-offset-1 ring-offset-secondary-dark'
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
              className="w-full px-3 py-2 bg-deep-black hover:bg-gray-700 text-gray-300 rounded-lg text-sm font-medium transition-colors border border-gray-600"
            >
              Reset all colors to defaults
            </button>
          </div>
        </details>
      </div>

      {/* Danger Zone — all destructive actions at bottom, red styling */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-red-400">Danger Zone</h3>
        <div className="border border-red-900 rounded-lg p-4 space-y-4 bg-red-950/20">
          <p className="text-xs text-red-400/80">
            These actions are permanent and cannot be undone. Confirm each step carefully.
          </p>

          {/* Diagnostics (in-memory reset) */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-red-400/90 uppercase tracking-wide">
              Diagnostics
            </div>
            <p className="text-xs text-muted leading-relaxed">
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
              className="w-full px-4 py-2.5 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded-lg text-sm font-medium transition-colors"
            >
              Reset Diagnostics
            </button>
          </div>

          <div className="border-t border-red-900/50 pt-4 space-y-2">
            <div className="text-xs font-medium text-red-400/90 uppercase tracking-wide">
              GPS positions
            </div>
            <p className="text-xs text-muted leading-relaxed">
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
              className="w-full px-4 py-2.5 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded-lg text-sm font-medium transition-colors"
            >
              Clear GPS Data
            </button>
          </div>

          <div className="border-t border-red-900/50 pt-4 space-y-2">
            <div className="text-xs font-medium text-red-400/90 uppercase tracking-wide">
              Position History
            </div>
            <p className="text-xs text-muted leading-relaxed">
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
              className="w-full px-4 py-2.5 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded-lg text-sm font-medium transition-colors"
            >
              Clear Position History
            </button>
          </div>

          {/* Nodes */}
          <div className="border-t border-red-900/50 pt-4 space-y-3">
            <div className="text-xs font-medium text-red-400/90 uppercase tracking-wide">Nodes</div>
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
                className="w-20 px-2 py-1 bg-deep-black border border-red-800/60 rounded text-gray-200 text-sm text-right focus:border-red-500 focus:outline-none"
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
                className="px-3 py-1.5 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded text-sm font-medium transition-colors whitespace-nowrap"
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
              className="w-full px-4 py-2.5 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded-lg text-sm font-medium transition-colors text-left"
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
                    'This will permanently delete nodes with no real long name: empty names, auto-generated !hex placeholders, and MQTT-only identities that never received UserInfo. Favorited nodes are kept. They will be re-discovered when they broadcast again.',
                  confirmLabel: 'Prune Unnamed Nodes',
                  danger: true,
                  action: async () => {
                    await window.electronAPI.db.deleteNodesWithoutLongname();
                  },
                });
              }}
              className="w-full px-4 py-2.5 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded-lg text-sm font-medium transition-colors text-left"
            >
              Prune Unnamed Nodes
            </button>
            <button
              type="button"
              aria-label="Prune Zero/Null Island Nodes Removes nodes at or near 0°N, 0°E (invalid GPS)."
              onClick={() => {
                const zeroIslandNodes = Array.from(nodes.values()).filter(
                  (n) => Math.abs(n.latitude ?? 0) < 0.5 && Math.abs(n.longitude ?? 0) < 0.5,
                );
                if (zeroIslandNodes.length === 0) {
                  addToast('No zero/null island nodes found.', 'success');
                  return;
                }
                executeWithConfirmation({
                  name: 'Prune Zero Island Nodes',
                  title: 'Prune Zero/Null Island Nodes',
                  message: `This will permanently delete ${zeroIslandNodes.length} node${zeroIslandNodes.length !== 1 ? 's' : ''} with coordinates at or near 0°N, 0°E (invalid GPS). This cannot be undone.`,
                  confirmLabel: `Delete ${zeroIslandNodes.length} Node${zeroIslandNodes.length !== 1 ? 's' : ''}`,
                  danger: true,
                  action: async () => {
                    await window.electronAPI.db.deleteNodesBatch(
                      zeroIslandNodes.map((n) => n.node_id),
                    );
                  },
                });
              }}
              className="w-full px-4 py-2.5 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded-lg text-sm font-medium transition-colors text-left"
            >
              <div className="font-medium">Prune Zero/Null Island Nodes</div>
              <div className="text-xs text-red-400/70 mt-0.5">
                Removes nodes at or near 0°N, 0°E (invalid GPS).
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
              className="w-full px-4 py-2.5 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded-lg text-sm font-medium transition-colors text-left"
            >
              <div className="font-medium">Prune Distant Nodes</div>
              <div className="text-xs text-red-400/70 mt-0.5">
                Beyond the distance threshold in Map &amp; Node Filtering. Requires a valid GPS
                location.
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
              className="w-full px-4 py-2.5 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded-lg text-sm font-medium transition-colors"
            >
              Clear All Nodes ({nodes.size})
            </button>
          </div>

          {/* Messages */}
          <div className="border-t border-red-900/50 pt-4 space-y-2">
            <div className="text-xs font-medium text-red-400/90 uppercase tracking-wide">
              Messages
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="apppanel-clear-channel" className="text-sm text-gray-400 shrink-0">
                Channel:
              </label>
              <select
                id="apppanel-clear-channel"
                value={clearChannelTarget}
                onChange={(e) => {
                  setClearChannelTarget(parseInt(e.target.value, 10));
                }}
                aria-label="Channel:"
                className="flex-1 px-3 py-1.5 bg-deep-black border border-red-800/60 rounded-lg text-gray-200 text-sm focus:border-red-500 focus:outline-none"
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
              className="w-full px-4 py-3 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded-lg text-sm font-medium transition-colors"
            >
              Clear Messages ({messageCount})
            </button>
          </div>

          {/* MeshCore */}
          {onClearMeshcoreRepeaters && (
            <div className="border-t border-red-900/50 pt-4 space-y-2">
              <div className="text-xs font-medium text-red-400 uppercase tracking-wide">
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
                className="w-full px-4 py-3 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded-lg text-sm font-medium transition-colors"
              >
                Clear All Repeaters
              </button>
            </div>
          )}

          {/* Everything */}
          <div className="border-t border-red-900/50 pt-4 space-y-2">
            <div className="text-xs font-medium text-red-400 uppercase tracking-wide">
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
              className="w-full px-4 py-3 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 rounded-lg text-sm font-medium transition-colors"
            >
              Clear All Local Data &amp; Cache
            </button>
          </div>
        </div>
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
