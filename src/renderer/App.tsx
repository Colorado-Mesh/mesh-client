import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import AppPanel from './components/AppPanel';
import ChatPanel from './components/ChatPanel';
import ConnectionPanel from './components/ConnectionPanel';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import ErrorBoundary from './components/ErrorBoundary';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal';
import LogPanel from './components/LogPanel';
import MapPanel from './components/MapPanel';
import ModulePanel from './components/ModulePanel';
import NodeDetailModal from './components/NodeDetailModal';
import NodeListPanel from './components/NodeListPanel';
import RadioPanel from './components/RadioPanel';
import RepeatersPanel from './components/RepeatersPanel';
import SearchModal from './components/SearchModal';
import { LinkIcon } from './components/SignalBars';
import Tabs from './components/Tabs';
import TelemetryPanel from './components/TelemetryPanel';
import { ToastProvider, useToast } from './components/Toast';
import UpdateBanner from './components/UpdateBanner';
import { useDevice } from './hooks/useDevice';
import { useMeshCore } from './hooks/useMeshCore';
import {
  validateLetsMeshManualCredentials,
  validateLetsMeshPresetConnect,
} from './lib/letsMeshConnectionGuards';
import {
  generateLetsMeshAuthToken,
  isLetsMeshSettings,
  letsMeshMqttUsernameFromIdentity,
  readMeshcoreIdentity,
} from './lib/letsMeshJwt';
import { parseStoredJson } from './lib/parseStoredJson';
import { useRadioProvider } from './lib/radio/providerFactory';
import { applyThemeColors, loadThemeColors } from './lib/themeColors';
import type { ChatMessage, DeviceState, MeshProtocol, MQTTSettings } from './lib/types';
import { useDiagnosticsStore } from './stores/diagnosticsStore';

const PROTOCOL_KEY = 'mesh-client:protocol';

// Tabs (0-indexed) that are disabled in MeshCore mode
// Tab 6 (Telemetry) re-enabled — capabilities-aware rendering handles battery/signal differences
// Tab 8 (Diagnostics) re-enabled — foreign LoRa detection works in both Meshtastic and MeshCore modes
const MESHCORE_DISABLED_TABS = new Set<number>([]);

const STATUS_COLOR: Record<string, string> = {
  disconnected: 'bg-red-500',
  connecting: 'bg-yellow-500 animate-pulse',
  connected: 'bg-blue-500',
  configured: 'bg-green-500',
  stale: 'bg-yellow-500 animate-pulse',
  reconnecting: 'bg-orange-500 animate-pulse',
};

const TAB_NAMES = [
  'Connection',
  'Chat',
  'Nodes',
  'Map',
  'Radio',
  'Modules',
  'Telemetry',
  'App',
  'Diagnostics',
];

export interface LocationFilter {
  enabled: boolean;
  maxDistance: number;
  unit: 'miles' | 'km';
  hideMqttOnly: boolean;
}

export interface UpdateState {
  phase: 'idle' | 'available' | 'downloading' | 'ready' | 'error' | 'up-to-date';
  version?: string;
  releaseUrl?: string;
  isPackaged?: boolean;
  isMac?: boolean;
  percent?: number;
  dismissed: boolean;
}

const MESHTASTIC_UNREAD_KEY = 'mesh-client:meshtasticChatUnread';
const MESHCORE_UNREAD_KEY = 'mesh-client:meshcoreChatUnread';
const LOG_PANEL_VISIBLE_KEY = 'mesh-client:logPanelVisible';
const UPDATE_SETTINGS_KEY = 'mesh-client:updateSettings';

function readUpdateSettings(): { checkOnStartup: boolean; dismissedVersion?: string } {
  try {
    const raw = localStorage.getItem(UPDATE_SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return {
      checkOnStartup: parsed.checkOnStartup !== false,
      dismissedVersion:
        typeof parsed.dismissedVersion === 'string' ? parsed.dismissedVersion : undefined,
    };
  } catch {
    // catch-no-log-ok localStorage JSON parse error — return safe defaults
    return { checkOnStartup: true };
  }
}

function saveUpdateSettings(patch: Partial<{ checkOnStartup: boolean; dismissedVersion: string }>) {
  try {
    const existing = readUpdateSettings();
    localStorage.setItem(UPDATE_SETTINGS_KEY, JSON.stringify({ ...existing, ...patch }));
  } catch {
    // catch-no-log-ok localStorage quota or private mode — silently skip
  }
}

function readLogPanelVisible(): boolean {
  try {
    return localStorage.getItem(LOG_PANEL_VISIBLE_KEY) === 'true';
  } catch (e) {
    console.debug('[App] readLogPanelVisible', e);
    return false;
  }
}

function readPersistedUnread(protocol: 'meshtastic' | 'meshcore'): number {
  try {
    const key = protocol === 'meshcore' ? MESHCORE_UNREAD_KEY : MESHTASTIC_UNREAD_KEY;
    const raw = localStorage.getItem(key);
    if (raw == null) return 0;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, 99999);
  } catch (e) {
    console.debug('[App] readPersistedUnread', e);
    return 0;
  }
}

function persistUnread(protocol: 'meshtastic' | 'meshcore', count: number): void {
  try {
    const key = protocol === 'meshcore' ? MESHCORE_UNREAD_KEY : MESHTASTIC_UNREAD_KEY;
    const n = Math.max(0, Math.min(Math.floor(count) || 0, 99999));
    localStorage.setItem(key, String(n));
  } catch (e) {
    console.debug('[App] persistUnread quota/private mode', e);
  }
}

function MqttGlobeIcon({ connected }: { connected: boolean }) {
  return (
    <svg
      className={`w-4 h-4 ${connected ? 'text-brand-green' : 'text-gray-400'}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20M2 12h20" />
      <path d="M2 7h20M2 17h20" />
    </svg>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [locationFilter, setLocationFilter] = useState<LocationFilter>(() => {
    const s =
      parseStoredJson<Record<string, unknown>>(
        localStorage.getItem('mesh-client:adminSettings'),
        'App locationFilter initial state',
      ) ?? {};
    return {
      enabled: Boolean(s.distanceFilterEnabled),
      maxDistance: Number(s.distanceFilterMax) || 500,
      unit: s.distanceUnit === 'km' ? 'km' : 'miles',
      hideMqttOnly: Boolean(s.filterMqttOnly),
    };
  });
  const [pendingDmTarget, setPendingDmTarget] = useState<number | null>(null);
  const [meshtasticUnread, setMeshtasticUnread] = useState(() => readPersistedUnread('meshtastic'));
  const [meshcoreUnread, setMeshcoreUnread] = useState(() => readPersistedUnread('meshcore'));
  const [logPanelVisible, setLogPanelVisible] = useState(readLogPanelVisible);
  const prevMeshtasticMsgCountRef = useRef(0);
  const prevMeshcoreMsgCountRef = useRef(0);
  const isMeshtasticInitialRef = useRef(true);
  const isMeshcoreInitialRef = useRef(true);
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: 'idle', dismissed: false });
  const [telemetryNoticeDismissed, setTelemetryNoticeDismissed] = useState(false);
  const [useFahrenheit, setUseFahrenheit] = useState(
    () => localStorage.getItem('mesh-client:useFahrenheit') === 'true',
  );
  const toggleFahrenheit = useCallback(() => {
    setUseFahrenheit((prev) => {
      const next = !prev;
      localStorage.setItem('mesh-client:useFahrenheit', String(next));
      return next;
    });
  }, []);

  // ─── Theme colors (localStorage overrides for @theme tokens) ─────
  useLayoutEffect(() => {
    applyThemeColors(loadThemeColors());
  }, []);

  const [protocol, setProtocol] = useState<MeshProtocol>(
    () => (localStorage.getItem(PROTOCOL_KEY) as MeshProtocol) ?? 'meshtastic',
  );

  const meshtasticDevice = useDevice();
  const meshcoreDevice = useMeshCore();
  const device =
    protocol === 'meshcore'
      ? (meshcoreDevice as unknown as typeof meshtasticDevice)
      : meshtasticDevice;
  const activeTabRef = useRef(activeTab);
  const protocolRef = useRef(protocol);
  const meshtasticMsgsRef = useRef(meshtasticDevice.messages);
  const meshcoreMsgsRef = useRef(meshcoreDevice.messages);
  const meshtasticMyNodeNumRef = useRef(meshtasticDevice.state.myNodeNum);
  const meshcoreSelfIdRef = useRef(meshcoreDevice.selfNodeId);
  activeTabRef.current = activeTab;
  protocolRef.current = protocol;
  meshtasticMsgsRef.current = meshtasticDevice.messages;
  meshcoreMsgsRef.current = meshcoreDevice.messages;
  meshtasticMyNodeNumRef.current = meshtasticDevice.state.myNodeNum;
  meshcoreSelfIdRef.current = meshcoreDevice.selfNodeId;
  const nodesForUi = protocol === 'meshcore' ? meshcoreDevice.nodes : meshtasticDevice.nodes;
  const nodeCountLabel = protocol === 'meshcore' ? 'contacts' : 'nodes';

  const capabilities = useRadioProvider(protocol);

  const displayTabNames = useMemo(
    () => TAB_NAMES.map((name, i) => (protocol === 'meshcore' && i === 5 ? 'Repeaters' : name)),
    [protocol],
  );

  const handleProtocolChange = useCallback(
    (p: MeshProtocol) => {
      if (p === protocol) return;
      // Keep diagnostics scoped to the active protocol.
      useDiagnosticsStore.getState().clearDiagnostics();
      localStorage.setItem(PROTOCOL_KEY, p);
      setProtocol(p);
      // Dual-mode: both devices stay connected — no disconnect on switch.
    },
    [protocol],
  );

  const runReanalysis = useDiagnosticsStore((s) => s.runReanalysis);
  const ignoreMqttEnabled = useDiagnosticsStore((s) => s.ignoreMqttEnabled);
  const envMode = useDiagnosticsStore((s) => s.envMode);

  useEffect(() => {
    runReanalysis(device.getNodes, device.selfNodeId, capabilities);
  }, [
    device.nodes,
    device.selfNodeId,
    device.getNodes,
    runReanalysis,
    ignoreMqttEnabled,
    envMode,
    capabilities,
  ]);

  useEffect(() => {
    if (device.state.status === 'disconnected') {
      setTelemetryNoticeDismissed(false);
    }
  }, [device.state.status]);

  const isConfigured = device.state.status === 'configured';
  const isOperational = isConfigured || device.state.status === 'stale';
  const isConnectedOrOperational = isOperational || device.state.status === 'connected';
  const selectedNode = selectedNodeId ? (nodesForUi.get(selectedNodeId) ?? null) : null;

  const handleResend = useCallback(
    (msg: ChatMessage) => {
      device.sendMessage(msg.payload, msg.channel, msg.to ?? undefined);
    },
    [device],
  );

  const traceRouteHops = useMemo(() => {
    if (!selectedNode) return undefined;
    const result = device.traceRouteResults.get(selectedNode.node_id);
    if (!result) return undefined;
    return [
      device.getFullNodeLabel(device.state.myNodeNum) || 'Me',
      ...result.route.map((id) => device.getFullNodeLabel(id)),
      device.getFullNodeLabel(result.from),
    ];
  }, [selectedNode, device]);

  /** In meshcore mode, only show configured channels (key !== all zeros) in chat. */
  const chatChannels = useMemo(() => {
    if (protocol !== 'meshcore') return device.channels;
    const chs = device.channels as { index: number; name: string; secret?: Uint8Array }[];
    const toHex = (s: Uint8Array) =>
      Array.from(s)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const unconfiguredKey = '00000000000000000000000000000000';
    return chs
      .filter((ch) => ch.secret && ch.secret.length === 16 && toHex(ch.secret) !== unconfiguredKey)
      .map((ch) => ({ index: ch.index, name: ch.name }));
  }, [protocol, device.channels]);

  // ─── Startup node pruning based on persisted admin settings ─────
  const { refreshNodesFromDb } = device;
  useEffect(() => {
    const s =
      parseStoredJson<Record<string, unknown>>(
        localStorage.getItem('mesh-client:adminSettings'),
        'App startup node pruning',
      ) ?? {};
    const ops: Promise<unknown>[] = [
      // One-time migration: rename legacy "RF !xxxxxxxx" stub nodes to "!xxxxxxxx"
      window.electronAPI.db
        .migrateRfStubNodes()
        .catch((e) => console.warn('[App] startup migrateRfStubNodes failed', e)),
    ];
    if (s.autoPruneEnabled) {
      const days =
        typeof s.autoPruneDays === 'number' && s.autoPruneDays > 0 ? s.autoPruneDays : 30;
      ops.push(
        window.electronAPI.db
          .deleteNodesByAge(days)
          .catch((e) => console.warn('[App] startup deleteNodesByAge failed', e)),
      );
    }
    if (s.nodeCapEnabled !== false) {
      const cap = typeof s.nodeCapCount === 'number' && s.nodeCapCount > 0 ? s.nodeCapCount : 10000;
      ops.push(
        window.electronAPI.db
          .pruneNodesByCount(cap)
          .catch((e) => console.warn('[App] startup pruneNodesByCount failed', e)),
      );
    }
    if (s.pruneEmptyNamesEnabled) {
      ops.push(
        window.electronAPI.db
          .deleteNodesWithoutLongname()
          .catch((e) => console.warn('[App] startup deleteNodesWithoutLongname failed', e)),
      );
    }
    if (ops.length > 0) {
      void Promise.all(ops).then(() => refreshNodesFromDb());
    }
  }, [refreshNodesFromDb]);

  // Dual-mode: each protocol manages its own MQTT connection independently.
  // No automatic MQTT disconnect on context switch.

  // ─── MQTT auto-launch on startup ─────────────────────────────────
  // Run for both protocols so dual-mode auto-launches MQTT on each side independently.
  useEffect(() => {
    for (const prot of ['meshtastic', 'meshcore'] as MeshProtocol[]) {
      try {
        const key =
          prot === 'meshcore' ? 'mesh-client:mqttSettings:meshcore' : 'mesh-client:mqttSettings';
        const settings = parseStoredJson<MQTTSettings>(
          localStorage.getItem(key),
          'App MQTT auto-launch',
        );
        if (settings?.autoLaunch) {
          const connectSettings = {
            ...settings,
            mqttTransportProtocol: (prot === 'meshcore' ? 'meshcore' : 'meshtastic') as
              | 'meshcore'
              | 'meshtastic',
          };
          const tryConnect = async () => {
            if (prot === 'meshcore' && isLetsMeshSettings(connectSettings.server)) {
              const presetErr = validateLetsMeshPresetConnect(connectSettings);
              if (presetErr) {
                console.warn('[App] MQTT auto-launch skipped:', presetErr);
                return;
              }
              const identity = readMeshcoreIdentity();
              const hasFull = !!(identity?.private_key && identity?.public_key);
              if (hasFull) {
                try {
                  const u = letsMeshMqttUsernameFromIdentity(identity);
                  if (u) connectSettings.username = u;
                  connectSettings.password = await generateLetsMeshAuthToken(
                    identity,
                    connectSettings.server,
                  );
                } catch (e) {
                  console.warn('[App] LetsMesh auth token auto-launch generation failed', e);
                  return;
                }
              } else {
                if (!connectSettings.password?.trim()) {
                  console.warn(
                    '[App] MQTT auto-launch skipped: LetsMesh needs imported identity or password',
                  );
                  return;
                }
                const manualErr = validateLetsMeshManualCredentials(connectSettings);
                if (manualErr) {
                  console.warn('[App] MQTT auto-launch skipped:', manualErr);
                  return;
                }
              }
            }
            await window.electronAPI.mqtt.connect(connectSettings);
          };
          void tryConnect().catch((e) => console.warn('[App] MQTT auto-launch connect failed', e));
        }
      } catch (e) {
        console.debug('[App] MQTT auto-launch startup', e);
      }
    }
  }, []);

  // ─── Auto-update event subscriptions ─────────────────────────────
  useEffect(() => {
    const offAvailable = window.electronAPI.update.onAvailable((info) => {
      const { dismissedVersion } = readUpdateSettings();
      setUpdateState({
        phase: 'available',
        version: info.version,
        releaseUrl: info.releaseUrl,
        isPackaged: info.isPackaged,
        isMac: info.isMac,
        dismissed: dismissedVersion === info.version,
      });
    });
    const offNotAvailable = window.electronAPI.update.onNotAvailable(() => {
      setUpdateState((s) => ({ ...s, phase: 'up-to-date', dismissed: false }));
    });
    const offProgress = window.electronAPI.update.onProgress((info) => {
      setUpdateState((s) => ({ ...s, phase: 'downloading', percent: info.percent }));
    });
    const offDownloaded = window.electronAPI.update.onDownloaded(() => {
      setUpdateState((s) => ({ ...s, phase: 'ready' }));
    });
    const offError = window.electronAPI.update.onError(() => {
      setUpdateState((s) => ({ ...s, phase: 'error' }));
    });
    return () => {
      offAvailable();
      offNotAvailable();
      offProgress();
      offDownloaded();
      offError();
    };
  }, []);

  // ─── Auto-check for updates on startup (respects user preference) ────
  useEffect(() => {
    if (!readUpdateSettings().checkOnStartup) return;
    const t = setTimeout(() => window.electronAPI.update.check(), 5000);
    return () => clearTimeout(t);
  }, []);

  // ─── Keyboard shortcuts: Cmd/Ctrl+[ / ] to switch protocol ───────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === '[') {
        e.preventDefault();
        handleProtocolChange('meshtastic');
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === ']') {
        e.preventDefault();
        handleProtocolChange('meshcore');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleProtocolChange]);

  // ─── Keyboard shortcuts: Cmd/Ctrl+1-9 for tabs, ? for help ───────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchModalOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        setActiveTab(parseInt(e.key) - 1);
      } else if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          setShowShortcuts(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ─── Track Meshtastic messages arriving while inactive ──────────
  useEffect(() => {
    const count = meshtasticDevice.messages.length;
    if (isMeshtasticInitialRef.current) {
      prevMeshtasticMsgCountRef.current = count;
      if (count > 0) isMeshtasticInitialRef.current = false;
      return;
    }
    const isActiveAndChatOpen = protocolRef.current === 'meshtastic' && activeTabRef.current === 1;
    if (count > prevMeshtasticMsgCountRef.current && !isActiveAndChatOpen) {
      const newMsgs = meshtasticMsgsRef.current.slice(prevMeshtasticMsgCountRef.current);
      const realNew = newMsgs.filter(
        (m) => m.sender_id !== meshtasticMyNodeNumRef.current && !m.emoji && !m.isHistory,
      );
      if (realNew.length > 0) setMeshtasticUnread((prev) => prev + realNew.length);
    }
    prevMeshtasticMsgCountRef.current = count;
  }, [meshtasticDevice.messages.length]);

  // ─── Track MeshCore messages arriving while inactive ─────────────
  useEffect(() => {
    const count = meshcoreDevice.messages.length;
    if (isMeshcoreInitialRef.current) {
      prevMeshcoreMsgCountRef.current = count;
      if (count > 0) isMeshcoreInitialRef.current = false;
      return;
    }
    const isActiveAndChatOpen = protocolRef.current === 'meshcore' && activeTabRef.current === 1;
    if (count > prevMeshcoreMsgCountRef.current && !isActiveAndChatOpen) {
      const newMsgs = meshcoreMsgsRef.current.slice(prevMeshcoreMsgCountRef.current);
      const realNew = newMsgs.filter(
        (m) => m.sender_id !== meshcoreSelfIdRef.current && !m.emoji && !m.isHistory,
      );
      if (realNew.length > 0) setMeshcoreUnread((prev) => prev + realNew.length);
    }
    prevMeshcoreMsgCountRef.current = count;
  }, [meshcoreDevice.messages.length]);

  // ─── Clear active protocol's unread when Chat tab becomes active ──
  useEffect(() => {
    if (activeTab === 1) {
      if (protocol === 'meshtastic') setMeshtasticUnread(0);
      else setMeshcoreUnread(0);
    }
  }, [activeTab, protocol]);

  // ─── Persist unread + sync combined total to tray ────────────────
  useEffect(() => {
    persistUnread('meshtastic', meshtasticUnread);
  }, [meshtasticUnread]);

  useEffect(() => {
    persistUnread('meshcore', meshcoreUnread);
  }, [meshcoreUnread]);

  useEffect(() => {
    window.electronAPI.setTrayUnread(meshtasticUnread + meshcoreUnread);
  }, [meshtasticUnread, meshcoreUnread]);

  // Manual reconnect from banner
  const handleReconnect = useCallback(() => {
    const lastType = device.state.connectionType ?? 'ble';
    device.disconnect().then(() => {
      // Small delay before reconnecting
      setTimeout(() => {
        if (protocol === 'meshtastic' && lastType === 'ble') {
          const raw = localStorage.getItem('mesh-client:lastConnection:meshtastic');
          const parsed = parseStoredJson<{ bleDeviceId?: string }>(raw, 'App handleReconnect BLE');
          const bleDeviceId = parsed?.bleDeviceId;
          if (!bleDeviceId) {
            console.warn('[App] handleReconnect missing BLE peripheral ID');
            return;
          }
          device.connectAutomatic('ble', undefined, undefined, bleDeviceId).catch((err) => {
            console.warn('[App] handleReconnect BLE auto-connect failed', err);
          });
          return;
        }
        device.connect(lastType).catch((err) => {
          console.warn('[App] handleReconnect connect failed', err);
        });
      }, 500);
    });
  }, [device, protocol]);

  const handleMessageNode = useCallback((nodeNum: number) => {
    setPendingDmTarget(nodeNum);
    setActiveTab(1); // Switch to Chat tab
  }, []);

  const handleLocationFilterChange = useCallback((f: LocationFilter) => setLocationFilter(f), []);

  const statusColor = STATUS_COLOR[device.state.status] ?? 'bg-gray-500';

  const queueUsed = device.queueStatus ? device.queueStatus.maxlen - device.queueStatus.free : 0;
  const queueShowBadge = device.queueStatus != null && queueUsed > 0;
  const queueColorClass =
    queueUsed <= 10
      ? 'bg-green-900/60 text-green-300 border border-green-700'
      : queueUsed <= 14
        ? 'bg-amber-900/60 text-amber-300 border border-amber-700'
        : 'bg-red-900/60 text-red-300 border border-red-700';

  return (
    <ToastProvider>
      {/* Global assertive live region for critical announcements */}
      <div aria-live="assertive" aria-atomic="true" className="sr-only" id="app-announcer" />
      {/* Passive notifications for inactive protocol activity */}
      <InactiveProtocolNotifier
        protocol={protocol}
        meshtasticDevice={meshtasticDevice}
        meshcoreDevice={meshcoreDevice}
      />
      <div className="flex flex-col h-screen">
        {/* Header */}
        <header
          className={`relative flex items-center justify-between px-4 py-2 bg-deep-black border-b ${
            isConfigured
              ? protocol === 'meshcore'
                ? 'border-cyan-500/20'
                : 'border-brand-green/20'
              : 'border-gray-700'
          }`}
        >
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-bright-green tracking-wide">Colorado Mesh</h1>
            <span className="text-xs text-muted">Mesh Client</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Protocol context switcher */}
            <div
              role="group"
              aria-label="Protocol switcher"
              className="flex items-center rounded-full overflow-hidden border border-gray-600 text-xs font-mono"
            >
              <button
                type="button"
                aria-pressed={protocol === 'meshtastic'}
                aria-label="Switch to Meshtastic"
                onClick={() => handleProtocolChange('meshtastic')}
                className={`px-3 py-0.5 transition-colors ${
                  protocol === 'meshtastic'
                    ? 'bg-brand-green/20 text-brand-green'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                (M) Meshtastic
                {meshtasticUnread > 0 && protocol !== 'meshtastic' && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.1rem] h-4 px-0.5 rounded-full bg-brand-green/30 text-brand-green text-[10px] font-bold animate-pulse">
                    {meshtasticUnread > 99 ? '99+' : meshtasticUnread}
                  </span>
                )}
              </button>
              <div className="w-px h-4 bg-gray-600" aria-hidden="true" />
              <button
                type="button"
                aria-pressed={protocol === 'meshcore'}
                aria-label="Switch to MeshCore"
                onClick={() => handleProtocolChange('meshcore')}
                className={`px-3 py-0.5 transition-colors ${
                  protocol === 'meshcore'
                    ? 'bg-cyan-600/20 text-cyan-400'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                (MC) MeshCore
                {meshcoreUnread > 0 && protocol !== 'meshcore' && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.1rem] h-4 px-0.5 rounded-full bg-cyan-600/30 text-cyan-400 text-[10px] font-bold animate-pulse">
                    {meshcoreUnread > 99 ? '99+' : meshcoreUnread}
                  </span>
                )}
              </button>
            </div>
            <div className="flex items-center gap-1.5 mr-3 pr-3 border-r border-gray-700">
              <MqttGlobeIcon connected={device.mqttStatus === 'connected'} />
              <span
                aria-label={
                  device.mqttStatus === 'connected' ? 'MQTT connected' : 'MQTT disconnected'
                }
                className={`text-xs ${device.mqttStatus === 'connected' ? 'text-brand-green' : 'text-gray-500'}`}
              >
                MQTT {device.mqttStatus === 'connected' ? 'connected' : 'disconnected'}
              </span>
            </div>
            {isConnectedOrOperational && <LinkIcon className="w-4 h-4" aria-hidden="true" />}
            <div
              className={`w-2.5 h-2.5 rounded-full ${statusColor}`}
              aria-hidden="true"
              title={device.state.status}
            />
            <div role="status" aria-live="polite" aria-atomic="true">
              <span
                aria-label={`${device.state.status}${device.state.connectionType ? ` (${device.state.connectionType.toUpperCase()})` : ''}`}
                className="text-sm text-muted capitalize"
              >
                {device.state.status}
                {device.state.connectionType
                  ? ` (${device.state.connectionType.toUpperCase()})`
                  : ''}
              </span>
            </div>
            {device.state.myNodeNum > 0 && (
              <span
                aria-label={`Node: ${device.getPickerStyleNodeLabel(device.state.myNodeNum)}`}
                className="text-xs text-muted ml-2 whitespace-nowrap"
              >
                Node: {device.getPickerStyleNodeLabel(device.state.myNodeNum)}
              </span>
            )}
            {/* Queue status badge: 0–10 used = green, 11–14 = yellow, 15–16 = red */}
            {queueShowBadge && device.queueStatus && (
              <div
                aria-label={`Q: ${queueUsed}/${device.queueStatus.maxlen}`}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${queueColorClass}`}
                title={`Queue: ${queueUsed}/${device.queueStatus.maxlen} used`}
              >
                Q: {queueUsed}/{device.queueStatus.maxlen}
              </div>
            )}
          </div>
        </header>

        {/* Connection Status Banner */}
        <ConnectionBanner
          status={device.state.status}
          reconnectAttempt={device.state.reconnectAttempt}
          onReconnect={handleReconnect}
        />

        {/* Telemetry disabled notice */}
        {isOperational && device.telemetryEnabled === false && !telemetryNoticeDismissed && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-between gap-3 px-4 py-2 bg-gray-900 border-b border-gray-700 text-sm"
          >
            <span className="text-gray-300">
              Telemetry is disabled on this device. Enabling device metrics helps the mesh and this
              app (diagnostics, battery, signal). Enable it in the Radio tab.
            </span>
            <button
              type="button"
              onClick={() => setTelemetryNoticeDismissed(true)}
              aria-label="Dismiss"
              className="shrink-0 text-gray-500 hover:text-gray-300 transition-colors text-xs font-medium px-2 py-1 rounded border border-gray-600 hover:border-gray-500"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Update Notification Banner */}
        <UpdateBanner
          updateState={updateState}
          onDownload={() => window.electronAPI.update.download()}
          onInstall={() => window.electronAPI.update.install()}
          onViewRelease={() => window.electronAPI.update.openReleases(updateState.releaseUrl)}
          onDismiss={() => {
            setUpdateState((s) => {
              if (s.version) saveUpdateSettings({ dismissedVersion: s.version });
              return { ...s, dismissed: true };
            });
          }}
        />

        <div className="flex flex-1 min-h-0 flex-col">
          <div className="flex flex-col flex-1 min-w-0 min-h-0">
            {/* Tabs */}
            <Tabs
              tabs={displayTabNames}
              active={activeTab}
              onChange={setActiveTab}
              chatUnread={protocol === 'meshtastic' ? meshtasticUnread : meshcoreUnread}
              disabledTabs={protocol === 'meshcore' ? MESHCORE_DISABLED_TABS : undefined}
            />

            {/* Content */}
            <main className="flex-1 overflow-auto p-4 min-h-0">
              <ErrorBoundary>
                <div id="panel-0" role="tabpanel" aria-labelledby="tab-0" hidden={activeTab !== 0}>
                  {/* Both panels are always mounted so each protocol auto-connects at startup */}
                  <div hidden={protocol !== 'meshtastic'}>
                    <ConnectionPanel
                      state={meshtasticDevice.state}
                      onConnect={meshtasticDevice.connect}
                      onAutoConnect={meshtasticDevice.connectAutomatic}
                      onDisconnect={meshtasticDevice.disconnect}
                      mqttStatus={meshtasticDevice.mqttStatus}
                      myNodeLabel={
                        meshtasticDevice.state.myNodeNum > 0
                          ? meshtasticDevice.getPickerStyleNodeLabel(
                              meshtasticDevice.state.myNodeNum,
                            )
                          : undefined
                      }
                      protocol="meshtastic"
                      onProtocolChange={handleProtocolChange}
                    />
                  </div>
                  <div hidden={protocol !== 'meshcore'}>
                    <ConnectionPanel
                      state={meshcoreDevice.state as DeviceState}
                      onConnect={(type, addr, blePeripheralId) =>
                        meshcoreDevice.connect(
                          type === 'http' ? 'tcp' : (type as 'ble' | 'serial'),
                          addr,
                          blePeripheralId,
                        )
                      }
                      onAutoConnect={
                        meshcoreDevice.connectAutomatic as unknown as typeof meshtasticDevice.connectAutomatic
                      }
                      onDisconnect={meshcoreDevice.disconnect}
                      mqttStatus={meshcoreDevice.mqttStatus}
                      myNodeLabel={
                        meshcoreDevice.state.myNodeNum > 0
                          ? meshcoreDevice.getPickerStyleNodeLabel(meshcoreDevice.state.myNodeNum)
                          : undefined
                      }
                      protocol="meshcore"
                      onProtocolChange={handleProtocolChange}
                      onRefreshContacts={meshcoreDevice.refreshContacts}
                      onSendAdvert={meshcoreDevice.sendAdvert}
                      manualAddContacts={meshcoreDevice.manualAddContacts}
                      onToggleManualContacts={meshcoreDevice.toggleManualAddContacts}
                    />
                  </div>
                </div>
                <div id="panel-1" role="tabpanel" aria-labelledby="tab-1" hidden={activeTab !== 1}>
                  <ChatPanel
                    messages={device.messages}
                    channels={chatChannels}
                    myNodeNum={device.selfNodeId}
                    onSend={device.sendMessage}
                    onReact={device.sendReaction}
                    onResend={handleResend}
                    onNodeClick={setSelectedNodeId}
                    isConnected={isOperational || device.mqttStatus === 'connected'}
                    isMqttOnly={!isOperational && device.mqttStatus === 'connected'}
                    connectionType={device.state.connectionType}
                    nodes={nodesForUi}
                    initialDmTarget={pendingDmTarget}
                    onDmTargetConsumed={() => setPendingDmTarget(null)}
                    isActive={activeTab === 1}
                    onGlobalSearch={() => setSearchModalOpen(true)}
                  />
                </div>
                <div id="panel-2" role="tabpanel" aria-labelledby="tab-2" hidden={activeTab !== 2}>
                  {activeTab === 2 ? (
                    <NodeListPanel
                      nodes={nodesForUi}
                      myNodeNum={device.selfNodeId}
                      onNodeClick={(node) => setSelectedNodeId(node.node_id)}
                      mqttConnected={device.mqttStatus === 'connected'}
                      locationFilter={locationFilter}
                      onToggleFavorite={device.setNodeFavorited}
                      mode={protocol}
                    />
                  ) : null}
                </div>
                <div
                  id="panel-3"
                  role="tabpanel"
                  aria-labelledby="tab-3"
                  hidden={activeTab !== 3}
                  className="h-full"
                >
                  {activeTab === 3 ? (
                    <MapPanel
                      nodes={nodesForUi}
                      myNodeNum={device.selfNodeId}
                      locationFilter={locationFilter}
                      ourPosition={device.ourPosition}
                      onLocateMe={() =>
                        device
                          .refreshOurPosition()
                          .then((p) => (p ? { lat: p.lat, lon: p.lon } : null))
                      }
                      waypoints={device.waypoints}
                      onSendWaypoint={device.sendWaypoint}
                      onDeleteWaypoint={device.deleteWaypoint}
                    />
                  ) : null}
                </div>
                <div id="panel-4" role="tabpanel" aria-labelledby="tab-4" hidden={activeTab !== 4}>
                  {activeTab === 4 ? (
                    <RadioPanel
                      onSetConfig={device.setConfig}
                      onCommit={device.commitConfig}
                      onSetChannel={device.setDeviceChannel}
                      onClearChannel={device.clearChannel}
                      channelConfigs={device.channelConfigs}
                      isConnected={isOperational}
                      telemetryDeviceUpdateInterval={device.telemetryDeviceUpdateInterval}
                      onReboot={device.reboot}
                      onShutdown={device.shutdown}
                      onFactoryReset={device.factoryReset}
                      onResetNodeDb={device.resetNodeDb}
                      ourPosition={device.ourPosition}
                      onSendPositionToDevice={device.sendPositionToDevice}
                      deviceOwner={device.deviceOwner}
                      onSetOwner={
                        protocol === 'meshcore'
                          ? async (owner) => meshcoreDevice.setOwner(owner)
                          : device.setOwner
                      }
                      onRebootOta={device.rebootOta}
                      onEnterDfu={device.enterDfuMode}
                      onFactoryResetConfig={device.factoryResetConfig}
                      capabilities={capabilities}
                      meshcoreChannels={
                        protocol === 'meshcore' ? meshcoreDevice.channels : undefined
                      }
                      onMeshcoreSetChannel={
                        protocol === 'meshcore'
                          ? async (idx, name, secret) =>
                              meshcoreDevice.setMeshcoreChannel(idx, name, secret)
                          : undefined
                      }
                      onMeshcoreDeleteChannel={
                        protocol === 'meshcore'
                          ? async (idx) => meshcoreDevice.deleteMeshcoreChannel(idx)
                          : undefined
                      }
                      onApplyLoraParams={
                        protocol === 'meshcore'
                          ? async (p) => meshcoreDevice.setRadioParams(p)
                          : undefined
                      }
                      loraConfig={
                        protocol === 'meshcore' && meshcoreDevice.selfInfo
                          ? {
                              freq: meshcoreDevice.selfInfo.radioFreq,
                              bw: meshcoreDevice.selfInfo.radioBw,
                              sf: meshcoreDevice.selfInfo.radioSf,
                              cr: meshcoreDevice.selfInfo.radioCr,
                              txPower: meshcoreDevice.selfInfo.txPower,
                            }
                          : undefined
                      }
                    />
                  ) : null}
                </div>
                <div id="panel-5" role="tabpanel" aria-labelledby="tab-5" hidden={activeTab !== 5}>
                  {activeTab === 5 && protocol === 'meshcore' ? (
                    <RepeatersPanel
                      nodes={meshcoreDevice.nodes}
                      meshcoreNodeStatus={meshcoreDevice.meshcoreNodeStatus}
                      meshcoreTraceResults={meshcoreDevice.meshcoreTraceResults}
                      onRequestRepeaterStatus={meshcoreDevice.requestRepeaterStatus}
                      onPing={meshcoreDevice.traceRoute}
                      onImportRepeaters={meshcoreDevice.importRepeaters}
                      onDeleteRepeater={meshcoreDevice.deleteNode}
                      isConnected={isOperational}
                      onSendAdvert={meshcoreDevice.sendAdvert}
                      onSyncClock={meshcoreDevice.syncClock}
                      onReboot={meshcoreDevice.reboot}
                      onRequestNeighbors={meshcoreDevice.requestNeighbors}
                      meshcoreNeighbors={meshcoreDevice.meshcoreNeighbors}
                      onRequestTelemetry={meshcoreDevice.requestTelemetry}
                      meshcoreTelemetry={meshcoreDevice.meshcoreNodeTelemetry}
                      onSelectRepeater={(node) => setSelectedNodeId(node.node_id)}
                    />
                  ) : null}
                  {activeTab === 5 && protocol !== 'meshcore' ? (
                    <ModulePanel
                      moduleConfigs={device.moduleConfigs}
                      onSetModuleConfig={device.setModuleConfig}
                      onSetCannedMessages={device.setCannedMessages}
                      onCommit={device.commitConfig}
                      isConnected={isOperational}
                    />
                  ) : null}
                </div>
                <div id="panel-6" role="tabpanel" aria-labelledby="tab-6" hidden={activeTab !== 6}>
                  {activeTab === 6 ? (
                    <TelemetryPanel
                      telemetry={device.telemetry}
                      signalTelemetry={device.signalTelemetry}
                      environmentTelemetry={device.environmentTelemetry}
                      useFahrenheit={useFahrenheit}
                      onToggleFahrenheit={toggleFahrenheit}
                      onRefresh={device.requestRefresh}
                      isConnected={isOperational}
                      capabilities={capabilities}
                    />
                  ) : null}
                </div>
                <div id="panel-7" role="tabpanel" aria-labelledby="tab-7" hidden={activeTab !== 7}>
                  {activeTab === 7 ? (
                    <AppPanel
                      logPanelVisible={logPanelVisible}
                      onLogPanelVisibleChange={(visible) => {
                        setLogPanelVisible(visible);
                        try {
                          localStorage.setItem(LOG_PANEL_VISIBLE_KEY, visible ? 'true' : 'false');
                        } catch (e) {
                          console.debug('[App] persist logPanelVisible', e);
                        }
                      }}
                      nodes={nodesForUi}
                      messageCount={device.messages.length}
                      channels={device.channels}
                      myNodeNum={device.state.myNodeNum}
                      onLocationFilterChange={handleLocationFilterChange}
                      ourPosition={device.ourPosition}
                      onRefreshGps={device.refreshOurPosition}
                      gpsLoading={device.gpsLoading}
                      onGpsIntervalChange={device.updateGpsInterval}
                      onNodesPruned={device.refreshNodesFromDb}
                      onMessagesPruned={device.refreshMessagesFromDb}
                      onClearMeshcoreRepeaters={
                        protocol === 'meshcore' ? meshcoreDevice.clearAllRepeaters : undefined
                      }
                    />
                  ) : null}
                </div>
                <div id="panel-8" role="tabpanel" aria-labelledby="tab-8" hidden={activeTab !== 8}>
                  {activeTab === 8 ? (
                    <DiagnosticsPanel
                      nodes={nodesForUi}
                      myNodeNum={device.selfNodeId}
                      onTraceRoute={device.traceRoute}
                      isConnected={isOperational}
                      traceRouteResults={device.traceRouteResults}
                      getFullNodeLabel={device.getFullNodeLabel}
                      ourPosition={device.ourPosition}
                      onNodeClick={(node) => setSelectedNodeId(node.node_id)}
                      capabilities={capabilities}
                    />
                  ) : null}
                </div>
              </ErrorBoundary>
            </main>

            {/* Footer */}
            <footer className="px-4 py-1.5 bg-deep-black border-t border-gray-700 text-[11px] text-muted flex items-center justify-between shrink-0">
              <span>
                A Project by{' '}
                <a
                  href="https://coloradomesh.org/"
                  title="Colorado Mesh"
                  className="text-bright-green underline hover:opacity-80"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Colorado Mesh
                </a>
                . Join us on{' '}
                <a
                  href="https://discord.com/invite/McChKR5NpS"
                  title="Colorado Mesh Discord"
                  className="text-bright-green underline hover:opacity-80"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Discord
                </a>
                . Code on{' '}
                <a
                  href="https://github.com/Colorado-Mesh/mesh-client"
                  title="Colorado Mesh on GitHub"
                  className="text-bright-green underline hover:opacity-80"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </a>
                .
              </span>
              {/* Keyboard shortcuts — centered in footer */}
              <button
                onClick={() => setShowShortcuts(true)}
                aria-label="Shortcuts ?"
                aria-haspopup="dialog"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 bg-slate-800/40 text-gray-500 hover:text-gray-300 hover:border-slate-600 transition-colors text-[11px] font-medium"
                title="Keyboard shortcuts (?)"
              >
                Shortcuts{' '}
                <kbd
                  className="px-1 border border-slate-600 rounded bg-slate-700 text-slate-400 text-[10px] font-mono"
                  aria-hidden="true"
                >
                  ?
                </kbd>
              </button>
              <span>
                {nodesForUi.size} {nodeCountLabel} | {device.messages.length} messages
              </span>
            </footer>
          </div>
        </div>

        {logPanelVisible && (
          <LogPanel
            protocol={protocol}
            deviceLogs={
              protocol === 'meshcore'
                ? meshcoreDevice.deviceLogs
                : meshtasticDevice.deviceLogs.map((d) => ({
                    ts: d.time,
                    level:
                      d.level >= 40
                        ? 'error'
                        : d.level >= 30
                          ? 'warn'
                          : d.level >= 10
                            ? 'log'
                            : d.level > 0
                              ? 'debug'
                              : 'log',
                    source: d.source,
                    message: d.message,
                  }))
            }
            variant="overlay"
            onClose={() => setLogPanelVisible(false)}
          />
        )}

        {/* Keyboard Shortcuts Modal */}
        {showShortcuts && (
          <KeyboardShortcutsModal
            onClose={() => setShowShortcuts(false)}
            tabNames={displayTabNames}
          />
        )}

        {/* Cross-channel Search Modal */}
        <SearchModal
          isOpen={searchModalOpen}
          onClose={() => setSearchModalOpen(false)}
          protocol={protocol}
          nodes={nodesForUi}
          channels={chatChannels}
          onNavigateToChannel={() => {
            setActiveTab(1);
          }}
        />

        {/* Node Detail Modal — rendered outside main for proper z-indexing */}
        <NodeDetailModal
          nodes={nodesForUi}
          node={selectedNode}
          onClose={() => setSelectedNodeId(null)}
          onRequestPosition={device.requestPosition}
          onTraceRoute={device.traceRoute}
          traceRouteHops={traceRouteHops}
          onDeleteNode={async (nodeNum) => {
            await device.deleteNode(nodeNum);
            setSelectedNodeId(null);
          }}
          onMessageNode={
            selectedNode?.node_id !== device.state.myNodeNum ? handleMessageNode : undefined
          }
          onToggleFavorite={device.setNodeFavorited}
          isConnected={isOperational}
          homeNode={nodesForUi.get(device.state.myNodeNum) ?? null}
          neighborInfo={device.neighborInfo}
          useFahrenheit={useFahrenheit}
          protocol={protocol}
          meshcoreTraceResult={
            protocol === 'meshcore' && selectedNode
              ? meshcoreDevice.meshcoreTraceResults.get(selectedNode.node_id)
              : undefined
          }
          meshcoreRepeaterStatus={
            protocol === 'meshcore' && selectedNode
              ? meshcoreDevice.meshcoreNodeStatus.get(selectedNode.node_id)
              : undefined
          }
          onRequestRepeaterStatus={
            protocol === 'meshcore' ? meshcoreDevice.requestRepeaterStatus : undefined
          }
          meshcoreNodeTelemetry={
            protocol === 'meshcore' && selectedNode
              ? meshcoreDevice.meshcoreNodeTelemetry.get(selectedNode.node_id)
              : undefined
          }
          onRequestTelemetry={protocol === 'meshcore' ? meshcoreDevice.requestTelemetry : undefined}
          meshcoreNeighbors={
            protocol === 'meshcore' && selectedNode
              ? meshcoreDevice.meshcoreNeighbors.get(selectedNode.node_id)
              : undefined
          }
          onRequestNeighbors={protocol === 'meshcore' ? meshcoreDevice.requestNeighbors : undefined}
        />
      </div>
    </ToastProvider>
  );
}

// ─── Passive notification monitor for the inactive protocol ──────
function InactiveProtocolNotifier({
  protocol,
  meshtasticDevice,
  meshcoreDevice,
}: {
  protocol: MeshProtocol;
  meshtasticDevice: ReturnType<typeof useDevice>;
  meshcoreDevice: ReturnType<typeof useMeshCore>;
}) {
  const { addToast } = useToast();
  const prevMeshtasticRef = useRef(0);
  const prevMeshcoreRef = useRef(0);
  const isInitMeshtasticRef = useRef(true);
  const isInitMeshcoreRef = useRef(true);

  // Notify when Meshtastic (inactive) gets new messages
  useEffect(() => {
    if (protocol === 'meshtastic') {
      // Now active — reset tracking so we don't toast on switch-back
      isInitMeshtasticRef.current = true;
      prevMeshtasticRef.current = meshtasticDevice.messages.length;
      return;
    }
    const count = meshtasticDevice.messages.length;
    if (isInitMeshtasticRef.current) {
      prevMeshtasticRef.current = count;
      if (count > 0) isInitMeshtasticRef.current = false;
      return;
    }
    if (count > prevMeshtasticRef.current) {
      const newMsgs = meshtasticDevice.messages.slice(prevMeshtasticRef.current);
      const realNew = newMsgs.filter((m) => !m.emoji && !m.isHistory);
      if (realNew.length > 0) {
        addToast(
          `Meshtastic: ${realNew.length} new message${realNew.length > 1 ? 's' : ''}`,
          'info',
          6000,
        );
      }
    }
    prevMeshtasticRef.current = count;
  }, [meshtasticDevice.messages, protocol, addToast]);

  // Notify when MeshCore (inactive) gets new messages
  useEffect(() => {
    if (protocol === 'meshcore') {
      // Now active — reset tracking
      isInitMeshcoreRef.current = true;
      prevMeshcoreRef.current = meshcoreDevice.messages.length;
      return;
    }
    const count = meshcoreDevice.messages.length;
    if (isInitMeshcoreRef.current) {
      prevMeshcoreRef.current = count;
      if (count > 0) isInitMeshcoreRef.current = false;
      return;
    }
    if (count > prevMeshcoreRef.current) {
      const newMsgs = meshcoreDevice.messages.slice(prevMeshcoreRef.current);
      const realNew = newMsgs.filter((m) => !m.emoji && !m.isHistory);
      if (realNew.length > 0) {
        addToast(
          `MeshCore: ${realNew.length} new message${realNew.length > 1 ? 's' : ''}`,
          'info',
          6000,
        );
      }
    }
    prevMeshcoreRef.current = count;
  }, [meshcoreDevice.messages, protocol, addToast]);

  return null;
}

// ─── Connection Status Banner ─────────────────────────────────────
function ConnectionBanner({
  status,
  reconnectAttempt,
  onReconnect,
}: {
  status: string;
  reconnectAttempt?: number;
  onReconnect: () => void;
}) {
  if (status === 'stale') {
    return (
      <div className="bg-yellow-900/80 border-b border-yellow-700 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-yellow-400">⚠</span>
          <span className="text-yellow-200 text-sm">
            Connection may be lost — no data received recently
          </span>
        </div>
        <button
          onClick={onReconnect}
          className="text-yellow-300 text-sm font-medium hover:text-yellow-100 underline"
        >
          Reconnect
        </button>
      </div>
    );
  }

  if (status === 'reconnecting') {
    return (
      <div className="bg-orange-900/80 border-b border-orange-700 px-4 py-2 flex items-center gap-2">
        <span className="text-orange-400 animate-spin inline-block">⟳</span>
        <span className="text-orange-200 text-sm animate-pulse">
          Reconnecting... attempt {reconnectAttempt ?? 1}/5
        </span>
      </div>
    );
  }

  return null;
}
