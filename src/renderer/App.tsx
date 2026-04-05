import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import ErrorBoundary from './components/ErrorBoundary';
import { LinkIcon } from './components/SignalBars';
import Tabs from './components/Tabs';
import { ToastProvider, useToast } from './components/Toast';
import UpdateStatusIndicator from './components/UpdateStatusIndicator';
import { useContactGroups } from './hooks/useContactGroups';
import { useDevice } from './hooks/useDevice';
import { useMeshCore } from './hooks/useMeshCore';
import { useTakServer } from './hooks/useTakServer';
import { ChatPanel, ConnectionPanel, LogPanel, NodeListPanel } from './lazyAppPanels';
import {
  ContactGroupsModal,
  KeyboardShortcutsModal,
  NodeDetailModal,
  SearchModal,
} from './lazyModals';
import {
  AppPanel,
  DiagnosticsPanel,
  MapPanel,
  ModulePanel,
  RadioPanel,
  RepeatersPanel,
  SecurityPanel,
  TakServerPanel,
  TelemetryPanel,
} from './lazyTabPanels';
import { getAppSettingsRaw } from './lib/appSettingsStorage';
import { DEFAULT_APP_SETTINGS_SHARED } from './lib/defaultAppSettings';
import {
  fetchLatestMeshCoreRelease,
  fetchLatestMeshtasticRelease,
  type FirmwareCheckResult,
  MESHCORE_FIRMWARE_RELEASES_URL,
  MESHTASTIC_FIRMWARE_RELEASES_URL,
  parseMeshCoreBuildDate,
  semverGt,
} from './lib/firmwareCheck';
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
import { pubkeyToNodeId } from './lib/meshcoreUtils';
import { MESHTASTIC_OFFICIAL_PRESET_DEFAULTS } from './lib/meshtasticMqttTlsMigration';
import { parseStoredJson } from './lib/parseStoredJson';
import type { ProtocolCapabilities } from './lib/radio/BaseRadioProvider';
import { useRadioProvider } from './lib/radio/providerFactory';
import { getStoredMeshProtocol, MESH_PROTOCOL_STORAGE_KEY } from './lib/storedMeshProtocol';
import { applyThemeColors, loadThemeColors } from './lib/themeColors';
import type { ChatMessage, DeviceState, MeshProtocol, MQTTSettings, MQTTStatus } from './lib/types';
import { useDiagnosticsStore } from './stores/diagnosticsStore';

// Tabs (0-indexed) that are disabled in MeshCore mode
// Security tab (index 7) is hidden for MeshCore since PKI config is not supported
// These map tab index → required capability (undefined = always shown)
const TAB_CAPABILITY_REQUIREMENTS: (keyof ProtocolCapabilities | undefined)[] = [
  undefined, // Connection
  undefined, // Chat
  undefined, // Nodes
  undefined, // Map
  undefined, // Radio
  undefined, // Modules
  undefined, // Telemetry
  'hasSecurityPanel', // Security
  'hasTakPanel', // TAK
  undefined, // App
  undefined, // Diagnostics
];

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
  'Security',
  'TAK',
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
}

const MESHTASTIC_UNREAD_KEY = 'mesh-client:meshtasticChatUnread';
const MESHCORE_UNREAD_KEY = 'mesh-client:meshcoreChatUnread';
const LOG_PANEL_VISIBLE_KEY = 'mesh-client:logPanelVisible';
/** Legacy key (pre–footer indicator): `checkOnStartup` / `dismissedVersion` — removed on launch so updates always check on startup. */
const LEGACY_UPDATE_SETTINGS_KEY = 'mesh-client:updateSettings';

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

function PanelSkeleton() {
  return (
    <div
      className="flex h-full min-h-[12rem] items-center justify-center rounded-xl border border-gray-800 bg-gray-900/50"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading panel</span>
      <div className="h-8 w-8 animate-pulse rounded-full bg-gray-700" aria-hidden />
    </div>
  );
}

function DialogLazyFallback() {
  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading dialog</span>
      <div className="h-10 w-10 animate-pulse rounded-full bg-gray-600" aria-hidden />
    </div>
  );
}

function TakStatusIcon({ running }: { running: boolean }) {
  const color = running ? 'text-brand-green' : 'text-gray-400';
  return (
    <svg aria-hidden="true" className={`h-4 w-4 ${color}`} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8M3.05,13H1V11H3.05C3.5,6.83 6.83,3.5 11,3.05V1H13V3.05C17.17,3.5 20.5,6.83 20.95,11H23V13H20.95C20.5,17.17 17.17,20.5 13,20.95V23H11V20.95C6.83,20.5 3.5,17.17 3.05,13M12,5A7,7 0 0,0 5,12A7,7 0 0,0 12,19A7,7 0 0,0 19,12A7,7 0 0,0 12,5Z" />
    </svg>
  );
}

function MqttGlobeIcon({ status }: { status: MQTTStatus }) {
  const color =
    status === 'connected'
      ? 'text-brand-green'
      : status === 'connecting'
        ? 'text-yellow-400'
        : status === 'error'
          ? 'text-red-400'
          : 'text-gray-400';
  return (
    <svg
      className={`h-4 w-4 ${color}`}
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
        getAppSettingsRaw(),
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
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: 'idle' });
  const [firmwareCheckState, setFirmwareCheckState] = useState<FirmwareCheckResult>({
    phase: 'idle',
  });
  const handleFirmwareResult = useCallback((r: FirmwareCheckResult) => {
    setFirmwareCheckState(r);
  }, []);
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

  const MESHCORE_CONTACTS_SHOW_KEYS_KEY = 'mesh-client:meshcoreContactsShowPublicKeys';
  const MESHCORE_CONTACTS_SHOW_REFRESH_KEY = 'mesh-client:meshcoreContactsShowRefreshControl';
  const [meshcoreContactsShowPublicKeys, setMeshcoreContactsShowPublicKeysState] = useState(() => {
    try {
      return localStorage.getItem(MESHCORE_CONTACTS_SHOW_KEYS_KEY) === 'true';
    } catch {
      // catch-no-log-ok localStorage read unavailable
      return false;
    }
  });
  const [meshcoreContactsShowRefreshControl, setMeshcoreContactsShowRefreshControlState] = useState(
    () => {
      try {
        return localStorage.getItem(MESHCORE_CONTACTS_SHOW_REFRESH_KEY) === 'true';
      } catch {
        // catch-no-log-ok localStorage read unavailable
        return false;
      }
    },
  );
  const onMeshcoreContactsShowPublicKeysChange = useCallback((value: boolean) => {
    setMeshcoreContactsShowPublicKeysState(value);
    try {
      localStorage.setItem(MESHCORE_CONTACTS_SHOW_KEYS_KEY, String(value));
    } catch {
      // catch-no-log-ok localStorage
    }
  }, []);
  const onMeshcoreContactsShowRefreshControlChange = useCallback((value: boolean) => {
    setMeshcoreContactsShowRefreshControlState(value);
    try {
      localStorage.setItem(MESHCORE_CONTACTS_SHOW_REFRESH_KEY, String(value));
    } catch {
      // catch-no-log-ok localStorage
    }
  }, []);

  // ─── Auto flood advert interval (MeshCore) ───────────────────────
  const [autoFloodAdvertIntervalHours, setAutoFloodAdvertIntervalHours] = useState(() => {
    const parsed = parseStoredJson<{ autoFloodAdvertIntervalHours?: number }>(
      getAppSettingsRaw(),
      'App autoFloodAdvertIntervalHours init',
    );
    return (
      parsed?.autoFloodAdvertIntervalHours ??
      DEFAULT_APP_SETTINGS_SHARED.autoFloodAdvertIntervalHours
    );
  });

  // ─── Theme colors (localStorage overrides for @theme tokens) ─────
  useLayoutEffect(() => {
    applyThemeColors(loadThemeColors());
  }, []);

  const [protocol, setProtocol] = useState<MeshProtocol>(() => getStoredMeshProtocol());

  const meshtasticDevice = useDevice();
  const meshcoreDevice = useMeshCore();
  const { status: takStatus } = useTakServer();
  const contactGroupsSelfId =
    protocol === 'meshcore'
      ? meshcoreDevice.selfNodeId
      : protocol === 'meshtastic'
        ? meshtasticDevice.selfNodeId
        : null;
  const contactGroups = useContactGroups(contactGroupsSelfId);
  const [showGroupsModal, setShowGroupsModal] = useState(false);
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

  const meshcorePublicKeyHexByNodeId = useMemo(() => {
    const m = new Map<number, string>();
    if (protocol !== 'meshcore') return m;
    const self = meshcoreDevice.selfInfo;
    if (self?.publicKey?.length === 32) {
      m.set(
        pubkeyToNodeId(self.publicKey),
        Array.from(self.publicKey)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
      );
    }
    for (const c of meshcoreDevice.meshcoreContactsForTelemetry) {
      m.set(
        pubkeyToNodeId(c.publicKey),
        Array.from(c.publicKey)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
      );
    }
    return m;
  }, [protocol, meshcoreDevice.selfInfo, meshcoreDevice.meshcoreContactsForTelemetry]);

  const capabilities = useRadioProvider(protocol);

  const { displayTabNames, tabIndexToPanelIndex } = useMemo(() => {
    const filtered: { name: string; panelIndex: number }[] = [];
    TAB_NAMES.forEach((name, panelIndex) => {
      const requiredCap = TAB_CAPABILITY_REQUIREMENTS[panelIndex];
      if (requiredCap === undefined || capabilities[requiredCap]) {
        filtered.push({
          name: panelIndex === 5 && protocol === 'meshcore' ? 'Repeaters' : name,
          panelIndex,
        });
      }
    });
    return {
      displayTabNames: filtered.map((t) => t.name),
      tabIndexToPanelIndex: filtered.map((t) => t.panelIndex),
    };
  }, [protocol, capabilities]);

  const activePanelIndex = tabIndexToPanelIndex[activeTab] ?? 0;

  // Reset activeTab if it's out of bounds (e.g., switching to meshcore while on Security tab)
  useEffect(() => {
    if (activeTab >= displayTabNames.length) {
      setActiveTab(0);
    }
  }, [activeTab, displayTabNames.length]);

  const handleProtocolChange = useCallback(
    (p: MeshProtocol) => {
      if (p === protocol) return;
      // Keep diagnostics scoped to the active protocol.
      useDiagnosticsStore.getState().clearDiagnostics();
      localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, p);
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
      device.sendMessage(msg.payload, msg.channel, msg.to ?? undefined, msg.replyId);
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
      .filter((ch) => ch.secret?.length === 16 && toHex(ch.secret) !== unconfiguredKey)
      .map((ch) => ({ index: ch.index, name: ch.name }));
  }, [protocol, device.channels]);

  const chatPanelFreezeRef = useRef<{
    messages: typeof device.messages;
    channels: typeof chatChannels;
    nodes: typeof nodesForUi;
  } | null>(null);
  const hasVisitedChatTabRef = useRef(false);

  useEffect(() => {
    hasVisitedChatTabRef.current = false;
    chatPanelFreezeRef.current = null;
  }, [protocol]);

  if (activePanelIndex === 1) {
    hasVisitedChatTabRef.current = true;
    chatPanelFreezeRef.current = {
      messages: device.messages,
      channels: chatChannels,
      nodes: nodesForUi,
    };
  }

  const isChatPanelFrozen = hasVisitedChatTabRef.current && activePanelIndex !== 1;
  const freeze = chatPanelFreezeRef.current;
  const chatMessagesForPanel = isChatPanelFrozen && freeze ? freeze.messages : device.messages;
  const chatNodesForPanel = isChatPanelFrozen && freeze ? freeze.nodes : nodesForUi;
  const chatChannelsForPanel = isChatPanelFrozen && freeze ? freeze.channels : chatChannels;

  const handleDmTargetConsumed = useCallback(() => {
    setPendingDmTarget(null);
  }, []);
  const handleOpenGlobalSearch = useCallback(() => {
    setSearchModalOpen(true);
  }, []);

  // ─── Startup pruning based on persisted app settings (protocol-aware) ─────
  const { refreshNodesFromDb } = device;
  useEffect(() => {
    const startupProtocol = getStoredMeshProtocol();
    const raw =
      parseStoredJson<Record<string, unknown>>(getAppSettingsRaw(), 'App startup node pruning') ??
      {};
    const s = { ...DEFAULT_APP_SETTINGS_SHARED, ...raw };
    const ops: Promise<unknown>[] = [];

    if (startupProtocol === 'meshtastic') {
      ops.push(
        // One-time migration: rename legacy "RF !xxxxxxxx" stub nodes to "!xxxxxxxx"
        window.electronAPI.db.migrateRfStubNodes().catch((e: unknown) => {
          console.warn('[App] startup migrateRfStubNodes failed', e);
        }),
        // Delete nodes with last_heard = never (placeholder stubs with no data)
        window.electronAPI.db.deleteNodesNeverHeard().catch((e: unknown) => {
          console.warn('[App] startup deleteNodesNeverHeard failed', e);
        }),
      );
      if (s.autoPruneEnabled) {
        const days =
          typeof s.autoPruneDays === 'number' && s.autoPruneDays > 0 ? s.autoPruneDays : 30;
        ops.push(
          window.electronAPI.db.deleteNodesByAge(days).catch((e: unknown) => {
            console.warn('[App] startup deleteNodesByAge failed', e);
          }),
        );
      }
      if (s.nodeCapEnabled) {
        const cap =
          typeof s.nodeCapCount === 'number' && s.nodeCapCount > 0 ? s.nodeCapCount : 10000;
        ops.push(
          window.electronAPI.db.pruneNodesByCount(cap).catch((e: unknown) => {
            console.warn('[App] startup pruneNodesByCount failed', e);
          }),
        );
      }
      if (s.pruneEmptyNamesEnabled) {
        ops.push(
          window.electronAPI.db.deleteNodesWithoutLongname().catch((e: unknown) => {
            console.warn('[App] startup deleteNodesWithoutLongname failed', e);
          }),
        );
      }
      if (s.positionHistoryPruneEnabled) {
        const days =
          typeof s.positionHistoryPruneDays === 'number' && s.positionHistoryPruneDays > 0
            ? s.positionHistoryPruneDays
            : 30;
        ops.push(
          window.electronAPI.db.prunePositionHistory(days).catch((e: unknown) => {
            console.warn('[App] startup prunePositionHistory failed', e);
          }),
        );
      }
    } else if (startupProtocol === 'meshcore') {
      if (s.meshcoreDeleteNeverAdvertised) {
        ops.push(
          window.electronAPI.db.deleteMeshcoreContactsNeverAdvertised().catch((e: unknown) => {
            console.warn('[App] startup deleteMeshcoreContactsNeverAdvertised failed', e);
          }),
        );
      }
      if (s.meshcoreAutoPruneEnabled) {
        const days =
          typeof s.meshcoreAutoPruneDays === 'number' && s.meshcoreAutoPruneDays > 0
            ? s.meshcoreAutoPruneDays
            : 30;
        ops.push(
          window.electronAPI.db.deleteMeshcoreContactsByAge(days).catch((e: unknown) => {
            console.warn('[App] startup deleteMeshcoreContactsByAge failed', e);
          }),
        );
      }
      if (s.meshcoreContactCapEnabled) {
        const cap =
          typeof s.meshcoreContactCapCount === 'number' && s.meshcoreContactCapCount > 0
            ? s.meshcoreContactCapCount
            : 5000;
        ops.push(
          window.electronAPI.db.pruneMeshcoreContactsByCount(cap).catch((e: unknown) => {
            console.warn('[App] startup pruneMeshcoreContactsByCount failed', e);
          }),
        );
      }
    }

    if (ops.length > 0) {
      void Promise.all(ops).then(() => {
        refreshNodesFromDb();
      });
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
          const base =
            prot === 'meshtastic'
              ? { ...MESHTASTIC_OFFICIAL_PRESET_DEFAULTS, ...settings }
              : settings;
          const connectSettings: MQTTSettings = {
            ...base,
            mqttTransportProtocol: prot === 'meshcore' ? 'meshcore' : 'meshtastic',
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
                  const { token, expiresAt } = await generateLetsMeshAuthToken(
                    identity,
                    connectSettings.server,
                  );
                  connectSettings.password = token;
                  connectSettings.tokenExpiresAt = expiresAt;
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
          void tryConnect().catch((e: unknown) => {
            console.warn('[App] MQTT auto-launch connect failed', e);
          });
        }
      } catch (e) {
        console.debug('[App] MQTT auto-launch startup', e);
      }
    }
  }, []);

  // ─── LetsMesh JWT proactive/reactive refresh ──────────────────────
  useEffect(() => {
    const off = window.electronAPI.mqtt.onRequestTokenRefresh((serverHost) => {
      const doRefresh = async () => {
        try {
          const identity = readMeshcoreIdentity();
          if (!identity?.private_key || !identity?.public_key) {
            console.warn('[App] token refresh requested but no identity available');
            return;
          }
          const { token, expiresAt } = await generateLetsMeshAuthToken(identity, serverHost);
          await window.electronAPI.mqtt.updateMeshcoreToken(token, expiresAt);
        } catch (e) {
          console.warn('[App] token refresh failed', e);
        }
      };
      void doRefresh();
    });
    return off;
  }, []);

  // ─── Auto-update event subscriptions ─────────────────────────────
  useEffect(() => {
    const offAvailable = window.electronAPI.update.onAvailable((info) => {
      setUpdateState({
        phase: 'available',
        version: info.version,
        releaseUrl: info.releaseUrl,
        isPackaged: info.isPackaged,
        isMac: info.isMac,
      });
    });
    const offNotAvailable = window.electronAPI.update.onNotAvailable(() => {
      setUpdateState((s) => ({ ...s, phase: 'up-to-date' }));
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

  // ─── Drop legacy update prefs (localStorage) — always check on startup below ───
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_UPDATE_SETTINGS_KEY);
    } catch {
      // catch-no-log-ok quota / private mode
    }
  }, []);

  // ─── Auto-check for updates on startup ────
  useEffect(() => {
    const t = setTimeout(() => {
      void window.electronAPI.update.check();
    }, 5000);
    return () => {
      clearTimeout(t);
    };
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
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleProtocolChange]);

  // ─── Keyboard shortcuts: Cmd/Ctrl+1-9, 0, A for tabs, ? for help ───────
  // Shortcuts map to fixed tab positions across protocols:
  // 1-9 = positions 0-8, 0 = position 9 (App), A = position 10 (Diagnostics)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const maxTab = displayTabNames.length - 1;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchModalOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        const targetIndex = parseInt(e.key, 10) - 1;
        if (targetIndex <= maxTab) {
          e.preventDefault();
          setActiveTab(targetIndex);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        const targetIndex = 9;
        if (targetIndex <= maxTab) {
          e.preventDefault();
          setActiveTab(targetIndex);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        const targetIndex = 10;
        if (targetIndex <= maxTab) {
          e.preventDefault();
          setActiveTab(targetIndex);
        }
      } else if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          setShowShortcuts(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [displayTabNames.length]);

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

  // ─── Auto flood advert (MeshCore) ────────────────────────────────
  const advertSentRef = useRef(false);

  useEffect(() => {
    if (protocol !== 'meshcore' || !isOperational || autoFloodAdvertIntervalHours <= 0) return;

    if (!advertSentRef.current) {
      advertSentRef.current = true;
      void meshcoreDevice.sendAdvert().catch((e: unknown) => {
        console.warn('[App] auto flood advert failed', e instanceof Error ? e.message : e);
      });
    }

    const ms = autoFloodAdvertIntervalHours * 60 * 60 * 1000;
    const id = setInterval(() => {
      void meshcoreDevice.sendAdvert().catch((e: unknown) => {
        console.warn('[App] auto flood advert failed', e instanceof Error ? e.message : e);
      });
    }, ms);

    return () => {
      clearInterval(id);
    };
  }, [protocol, isOperational, autoFloodAdvertIntervalHours, meshcoreDevice]);

  // Manual reconnect from banner
  const handleReconnect = useCallback(() => {
    const lastType = device.state.connectionType ?? 'ble';
    void device.disconnect().then(() => {
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
          device
            .connectAutomatic('ble', undefined, undefined, bleDeviceId)
            .catch((err: unknown) => {
              console.warn('[App] handleReconnect BLE auto-connect failed', err);
            });
          return;
        }
        device.connect(lastType).catch((err: unknown) => {
          console.warn('[App] handleReconnect connect failed', err);
        });
      }, 500);
    });
  }, [device, protocol]);

  const handleMessageNode = useCallback((nodeNum: number) => {
    setPendingDmTarget(nodeNum);
    setActiveTab(1); // Switch to Chat tab
  }, []);

  const handleLocationFilterChange = useCallback((f: LocationFilter) => {
    setLocationFilter(f);
  }, []);

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
      {/* Firmware update check on connect */}
      <FirmwareUpdateNotifier
        meshtasticState={meshtasticDevice.state}
        meshcoreState={meshcoreDevice.state}
        protocol={protocol}
        onResult={handleFirmwareResult}
      />
      <div className="flex h-screen flex-col">
        {/* Header */}
        <header
          className={`bg-deep-black relative flex flex-row items-center gap-2 border-b px-4 py-2 xl:grid xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] xl:items-center xl:gap-0 ${
            isConfigured
              ? protocol === 'meshcore'
                ? 'border-cyan-500/20'
                : 'border-brand-green/20'
              : 'border-gray-700'
          }`}
        >
          <div className="flex min-w-0 items-center gap-3 xl:justify-self-start">
            <h1 className="text-bright-green min-w-0 truncate text-lg font-bold tracking-wide">
              Colorado Mesh
            </h1>
            <span className="text-muted shrink-0 text-xs">Mesh Client</span>
          </div>

          <div className="flex min-w-0 flex-1 justify-center xl:flex-none xl:justify-self-center">
            {/* Protocol context switcher — centered in the gap (narrow) or viewport (xl+ grid) */}
            <div
              role="group"
              aria-label="Protocol switcher"
              className="flex shrink-0 items-center overflow-hidden rounded-full border border-gray-600 font-mono text-xs"
            >
              <button
                type="button"
                aria-pressed={protocol === 'meshtastic'}
                aria-label="Switch to Meshtastic"
                onClick={() => {
                  handleProtocolChange('meshtastic');
                }}
                className={`px-3 py-0.5 transition-colors ${
                  protocol === 'meshtastic'
                    ? 'bg-brand-green/20 text-brand-green'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-300'
                }`}
              >
                (M) Meshtastic
                {meshtasticUnread > 0 && protocol !== 'meshtastic' && (
                  <span className="bg-brand-green/30 text-brand-green ml-1.5 inline-flex h-4 min-w-[1.1rem] animate-pulse items-center justify-center rounded-full px-0.5 text-[10px] font-bold">
                    {meshtasticUnread > 99 ? '99+' : meshtasticUnread}
                  </span>
                )}
              </button>
              <div className="h-4 w-px bg-gray-600" aria-hidden="true" />
              <button
                type="button"
                aria-pressed={protocol === 'meshcore'}
                aria-label="Switch to MeshCore"
                onClick={() => {
                  handleProtocolChange('meshcore');
                }}
                className={`px-3 py-0.5 transition-colors ${
                  protocol === 'meshcore'
                    ? 'bg-cyan-600/20 text-cyan-400'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-300'
                }`}
              >
                (MC) MeshCore
                {meshcoreUnread > 0 && protocol !== 'meshcore' && (
                  <span className="ml-1.5 inline-flex h-4 min-w-[1.1rem] animate-pulse items-center justify-center rounded-full bg-cyan-600/30 px-0.5 text-[10px] font-bold text-cyan-400">
                    {meshcoreUnread > 99 ? '99+' : meshcoreUnread}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="flex min-w-0 shrink-0 items-center justify-end gap-2 xl:justify-self-end">
            {capabilities.hasTakPanel && (
              <div className="mr-3 flex items-center gap-1.5 border-r border-gray-700 pr-3">
                <TakStatusIcon running={takStatus.running} />
                <span
                  aria-label={`TAK server ${takStatus.running ? 'running' : 'stopped'}`}
                  className={`text-xs ${takStatus.running ? 'text-brand-green' : 'text-gray-400'}`}
                >
                  TAK {takStatus.running ? 'running' : 'stopped'}
                </span>
              </div>
            )}
            <div className="mr-3 flex items-center gap-1.5 border-r border-gray-700 pr-3">
              <MqttGlobeIcon status={device.mqttStatus ?? 'disconnected'} />
              <span
                aria-label={`MQTT ${device.mqttStatus ?? 'disconnected'}`}
                className={`text-xs ${
                  device.mqttStatus === 'connected'
                    ? 'text-brand-green'
                    : device.mqttStatus === 'connecting'
                      ? 'animate-pulse text-yellow-400'
                      : device.mqttStatus === 'error'
                        ? 'text-red-400'
                        : 'text-gray-400'
                }`}
              >
                MQTT {device.mqttStatus ?? 'disconnected'}
              </span>
            </div>
            {isConnectedOrOperational && <LinkIcon className="h-4 w-4" aria-hidden="true" />}
            <div
              className={`h-2.5 w-2.5 rounded-full ${statusColor}`}
              aria-hidden="true"
              title={device.state.status}
            />
            <div role="status" aria-live="polite" aria-atomic="true">
              <span
                aria-label={`${device.state.status}${device.state.connectionType ? ` (${device.state.connectionType.toUpperCase()})` : ''}`}
                className={`text-xs capitalize ${
                  device.state.status === 'connecting'
                    ? 'animate-pulse text-yellow-400'
                    : device.state.status === 'stale'
                      ? 'animate-pulse text-yellow-400'
                      : device.state.status === 'reconnecting'
                        ? 'animate-pulse text-orange-400'
                        : 'text-muted'
                }`}
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
                className="text-muted ml-2 text-xs whitespace-nowrap"
              >
                Node: {device.getPickerStyleNodeLabel(device.state.myNodeNum)}
              </span>
            )}
            {/* Queue status badge: 0–10 used = green, 11–14 = yellow, 15–16 = red */}
            {queueShowBadge && device.queueStatus && (
              <div
                aria-label={`Q: ${queueUsed}/${device.queueStatus.maxlen}`}
                className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${queueColorClass}`}
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
            className="flex items-center justify-between gap-3 border-b border-gray-700 bg-gray-900 px-4 py-2 text-sm"
          >
            <span className="text-gray-300">
              Telemetry is disabled on this device. Enabling device metrics helps the mesh and this
              app (diagnostics, battery, signal). Enable it in the Radio tab.
            </span>
            <button
              type="button"
              onClick={() => {
                setTelemetryNoticeDismissed(true);
              }}
              aria-label="Dismiss"
              className="shrink-0 rounded border border-gray-600 px-2 py-1 text-xs font-medium text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-300"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Tabs */}
            <nav aria-label="Application panels">
              <Tabs
                tabs={displayTabNames}
                active={activeTab}
                onChange={setActiveTab}
                chatUnread={protocol === 'meshtastic' ? meshtasticUnread : meshcoreUnread}
              />
            </nav>

            {/* Content */}
            <main className="min-h-0 flex-1 overflow-auto p-4">
              <ErrorBoundary>
                <div
                  id="panel-0"
                  role="tabpanel"
                  aria-labelledby="tab-0"
                  hidden={activePanelIndex !== 0}
                >
                  {/* Both panels are always mounted so each protocol auto-connects at startup */}
                  <Suspense fallback={<PanelSkeleton />}>
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
                        firmwareCheckState={
                          protocol === 'meshtastic' ? firmwareCheckState : undefined
                        }
                        onOpenFirmwareReleases={
                          protocol === 'meshtastic'
                            ? () => {
                                void window.electronAPI.update.openReleases(
                                  firmwareCheckState.releaseUrl ?? MESHTASTIC_FIRMWARE_RELEASES_URL,
                                );
                              }
                            : undefined
                        }
                      />
                    </div>
                    <div hidden={protocol !== 'meshcore'}>
                      <ConnectionPanel
                        state={meshcoreDevice.state}
                        onConnect={(type, addr, blePeripheralId) =>
                          meshcoreDevice.connect(
                            type === 'http' ? 'tcp' : type,
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
                        firmwareCheckState={
                          protocol === 'meshcore' ? firmwareCheckState : undefined
                        }
                        onOpenFirmwareReleases={
                          protocol === 'meshcore'
                            ? () => {
                                void window.electronAPI.update.openReleases(
                                  firmwareCheckState.releaseUrl ?? MESHCORE_FIRMWARE_RELEASES_URL,
                                );
                              }
                            : undefined
                        }
                      />
                    </div>
                  </Suspense>
                </div>
                {(activePanelIndex === 1 || hasVisitedChatTabRef.current) && (
                  <div
                    id="panel-1"
                    role="tabpanel"
                    aria-labelledby="tab-1"
                    hidden={activePanelIndex !== 1}
                  >
                    <Suspense fallback={<PanelSkeleton />}>
                      <ChatPanel
                        key={protocol}
                        messages={chatMessagesForPanel}
                        channels={chatChannelsForPanel}
                        myNodeNum={device.selfNodeId}
                        onSend={device.sendMessage}
                        onReact={device.sendReaction}
                        onResend={handleResend}
                        onNodeClick={setSelectedNodeId}
                        isConnected={isOperational || device.mqttStatus === 'connected'}
                        isMqttOnly={!isOperational && device.mqttStatus === 'connected'}
                        connectionType={device.state.connectionType}
                        nodes={chatNodesForPanel}
                        initialDmTarget={pendingDmTarget}
                        onDmTargetConsumed={handleDmTargetConsumed}
                        isActive={activePanelIndex === 1}
                        onGlobalSearch={handleOpenGlobalSearch}
                        protocol={protocol}
                      />
                    </Suspense>
                  </div>
                )}
                <div
                  id="panel-2"
                  role="tabpanel"
                  aria-labelledby="tab-2"
                  hidden={activePanelIndex !== 2}
                >
                  {activePanelIndex === 2 ? (
                    <Suspense fallback={<PanelSkeleton />}>
                      <NodeListPanel
                        nodes={nodesForUi}
                        myNodeNum={device.selfNodeId}
                        onNodeClick={(node) => {
                          setSelectedNodeId(node.node_id);
                        }}
                        mqttConnected={device.mqttStatus === 'connected'}
                        locationFilter={locationFilter}
                        onToggleFavorite={device.setNodeFavorited}
                        mode={protocol}
                        groups={contactGroups.groups}
                        selectedGroupId={contactGroups.selectedGroupId}
                        onGroupChange={contactGroups.setSelectedGroupId}
                        onManageGroups={
                          capabilities.hasUserManagedContactGroups
                            ? () => {
                                setShowGroupsModal(true);
                              }
                            : undefined
                        }
                        groupMemberIds={contactGroups.groupMemberIds}
                        contactGroupsEnabled={capabilities.hasUserManagedContactGroups}
                        onImportContacts={
                          protocol === 'meshcore' ? meshcoreDevice.importContacts : undefined
                        }
                        meshcoreShowRefreshControl={
                          protocol === 'meshcore' ? meshcoreContactsShowRefreshControl : false
                        }
                        onRefreshContacts={
                          protocol === 'meshcore' ? meshcoreDevice.refreshContacts : undefined
                        }
                        meshcoreShowPublicKeys={
                          protocol === 'meshcore' ? meshcoreContactsShowPublicKeys : false
                        }
                        meshcorePublicKeyHexByNodeId={
                          protocol === 'meshcore' ? meshcorePublicKeyHexByNodeId : undefined
                        }
                      />
                    </Suspense>
                  ) : null}
                </div>
                <div
                  id="panel-3"
                  role="tabpanel"
                  aria-labelledby="tab-3"
                  hidden={activePanelIndex !== 3}
                  className="h-full"
                >
                  {activePanelIndex === 3 ? (
                    <ErrorBoundary>
                      <Suspense fallback={<PanelSkeleton />}>
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
                          protocol={protocol}
                        />
                      </Suspense>
                    </ErrorBoundary>
                  ) : null}
                </div>
                <div
                  id="panel-4"
                  role="tabpanel"
                  aria-labelledby="tab-4"
                  hidden={activePanelIndex !== 4}
                >
                  {activePanelIndex === 4 ? (
                    <ErrorBoundary>
                      <Suspense fallback={<PanelSkeleton />}>
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
                          meshcoreSelfInfo={
                            protocol === 'meshcore' ? meshcoreDevice.selfInfo : undefined
                          }
                          meshcoreContactsForTelemetry={
                            protocol === 'meshcore'
                              ? meshcoreDevice.meshcoreContactsForTelemetry
                              : undefined
                          }
                          onApplyMeshcoreTelemetryPrivacy={
                            protocol === 'meshcore'
                              ? meshcoreDevice.applyMeshcoreTelemetryPrivacyPolicy
                              : undefined
                          }
                          meshcoreAutoadd={
                            protocol === 'meshcore' ? meshcoreDevice.meshcoreAutoadd : undefined
                          }
                          onApplyMeshcoreContactAutoAdd={
                            protocol === 'meshcore'
                              ? meshcoreDevice.applyMeshcoreContactAutoAdd
                              : undefined
                          }
                          onRefreshMeshcoreAutoaddFromDevice={
                            protocol === 'meshcore'
                              ? meshcoreDevice.refreshMeshcoreAutoaddFromDevice
                              : undefined
                          }
                          meshcoreContactsShowPublicKeys={
                            protocol === 'meshcore' ? meshcoreContactsShowPublicKeys : undefined
                          }
                          onMeshcoreContactsShowPublicKeysChange={
                            protocol === 'meshcore'
                              ? onMeshcoreContactsShowPublicKeysChange
                              : undefined
                          }
                          meshcoreContactsShowRefreshControl={
                            protocol === 'meshcore' ? meshcoreContactsShowRefreshControl : undefined
                          }
                          onMeshcoreContactsShowRefreshControlChange={
                            protocol === 'meshcore'
                              ? onMeshcoreContactsShowRefreshControlChange
                              : undefined
                          }
                          onClearAllMeshcoreContacts={
                            protocol === 'meshcore'
                              ? meshcoreDevice.clearAllMeshcoreContacts
                              : undefined
                          }
                          onSendAdvert={
                            protocol === 'meshcore' ? meshcoreDevice.sendAdvert : undefined
                          }
                          onSyncClock={
                            protocol === 'meshcore' ? meshcoreDevice.syncClock : undefined
                          }
                        />
                      </Suspense>
                    </ErrorBoundary>
                  ) : null}
                </div>
                <div
                  id="panel-5"
                  role="tabpanel"
                  aria-labelledby="tab-5"
                  hidden={activePanelIndex !== 5}
                >
                  {activePanelIndex === 5 && protocol === 'meshcore' ? (
                    <ErrorBoundary>
                      <Suspense fallback={<PanelSkeleton />}>
                        <RepeatersPanel
                          nodes={meshcoreDevice.nodes}
                          meshcoreNodeStatus={meshcoreDevice.meshcoreNodeStatus}
                          meshcoreStatusErrors={meshcoreDevice.meshcoreStatusErrors}
                          meshcoreTraceResults={meshcoreDevice.meshcoreTraceResults}
                          meshcorePingErrors={meshcoreDevice.meshcorePingErrors}
                          onRequestRepeaterStatus={meshcoreDevice.requestRepeaterStatus}
                          onPing={meshcoreDevice.traceRoute}
                          onDeleteRepeater={meshcoreDevice.deleteNode}
                          isConnected={isOperational}
                          onRequestNeighbors={meshcoreDevice.requestNeighbors}
                          meshcoreNeighbors={meshcoreDevice.meshcoreNeighbors}
                          meshcoreNeighborErrors={meshcoreDevice.meshcoreNeighborErrors}
                          onRequestTelemetry={meshcoreDevice.requestTelemetry}
                          meshcoreTelemetry={meshcoreDevice.meshcoreNodeTelemetry}
                          meshcoreTelemetryErrors={meshcoreDevice.meshcoreTelemetryErrors}
                          onSelectRepeater={(node) => {
                            setSelectedNodeId(node.node_id);
                          }}
                          onSendCliCommand={meshcoreDevice.sendRepeaterCliCommand}
                          meshcoreCliHistories={meshcoreDevice.meshcoreCliHistories}
                          meshcoreCliErrors={meshcoreDevice.meshcoreCliErrors}
                          onClearCliHistory={meshcoreDevice.clearCliHistory}
                        />
                      </Suspense>
                    </ErrorBoundary>
                  ) : null}
                  {activePanelIndex === 5 && protocol !== 'meshcore' ? (
                    <ErrorBoundary>
                      <Suspense fallback={<PanelSkeleton />}>
                        <ModulePanel
                          moduleConfigs={device.moduleConfigs}
                          onSetModuleConfig={device.setModuleConfig}
                          onSetCannedMessages={device.setCannedMessages}
                          onSetRingtone={device.setRingtone}
                          ringtone={device.ringtone}
                          onCommit={device.commitConfig}
                          isConnected={isOperational}
                          storeForwardMessages={device.storeForwardMessages}
                          rangeTestPackets={device.rangeTestPackets}
                          serialMessages={device.serialMessages}
                          remoteHardwareMessages={device.remoteHardwareMessages}
                          ipTunnelMessages={device.ipTunnelMessages}
                        />
                      </Suspense>
                    </ErrorBoundary>
                  ) : null}
                </div>
                <div
                  id="panel-6"
                  role="tabpanel"
                  aria-labelledby="tab-6"
                  hidden={activePanelIndex !== 6}
                >
                  {activePanelIndex === 6 ? (
                    <ErrorBoundary>
                      <Suspense fallback={<PanelSkeleton />}>
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
                      </Suspense>
                    </ErrorBoundary>
                  ) : null}
                </div>
                <div
                  id="panel-7"
                  role="tabpanel"
                  aria-labelledby="tab-7"
                  hidden={activePanelIndex !== 7}
                >
                  {activePanelIndex === 7 ? (
                    <ErrorBoundary>
                      <Suspense fallback={<PanelSkeleton />}>
                        <SecurityPanel
                          onSetConfig={device.setConfig}
                          onCommit={device.commitConfig}
                          isConnected={isOperational}
                          securityConfig={device.securityConfig}
                          protocol={protocol}
                          onSignData={protocol === 'meshcore' ? meshcoreDevice.signData : undefined}
                          onExportPrivateKey={
                            protocol === 'meshcore' ? meshcoreDevice.exportPrivateKey : undefined
                          }
                          onImportPrivateKey={
                            protocol === 'meshcore' ? meshcoreDevice.importPrivateKey : undefined
                          }
                        />
                      </Suspense>
                    </ErrorBoundary>
                  ) : null}
                </div>
                <div
                  id="panel-8"
                  role="tabpanel"
                  aria-labelledby="tab-8"
                  hidden={activePanelIndex !== 8}
                >
                  {activePanelIndex === 8 ? (
                    <ErrorBoundary>
                      <Suspense fallback={<PanelSkeleton />}>
                        <TakServerPanel
                          atakMessages={device.atakMessages}
                          capabilities={capabilities}
                        />
                      </Suspense>
                    </ErrorBoundary>
                  ) : null}
                </div>
                <div
                  id="panel-9"
                  role="tabpanel"
                  aria-labelledby="tab-9"
                  hidden={activePanelIndex !== 9}
                >
                  {activePanelIndex === 9 ? (
                    <ErrorBoundary>
                      <Suspense fallback={<PanelSkeleton />}>
                        <AppPanel
                          protocol={protocol}
                          logPanelVisible={logPanelVisible}
                          onLogPanelVisibleChange={(visible) => {
                            setLogPanelVisible(visible);
                            try {
                              localStorage.setItem(
                                LOG_PANEL_VISIBLE_KEY,
                                visible ? 'true' : 'false',
                              );
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
                          onAutoFloodAdvertIntervalChange={setAutoFloodAdvertIntervalHours}
                        />
                      </Suspense>
                    </ErrorBoundary>
                  ) : null}
                </div>
                <div
                  id="panel-10"
                  role="tabpanel"
                  aria-labelledby="tab-10"
                  hidden={activePanelIndex !== 10}
                >
                  {activePanelIndex === 10 ? (
                    <ErrorBoundary>
                      <Suspense fallback={<PanelSkeleton />}>
                        <DiagnosticsPanel
                          nodes={nodesForUi}
                          myNodeNum={device.selfNodeId}
                          onTraceRoute={device.traceRoute}
                          isConnected={isOperational}
                          traceRouteResults={device.traceRouteResults}
                          getFullNodeLabel={device.getFullNodeLabel}
                          ourPosition={device.ourPosition}
                          onNodeClick={(node) => {
                            setSelectedNodeId(node.node_id);
                          }}
                          capabilities={capabilities}
                        />
                      </Suspense>
                    </ErrorBoundary>
                  ) : null}
                </div>
              </ErrorBoundary>
            </main>

            {/* Footer — same centering idea as header: 1fr | auto | 1fr so middle stays true center */}
            <footer className="bg-deep-black text-muted grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-4 border-t border-gray-700 px-4 py-1.5 text-[11px]">
              <span className="min-w-0">
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
              <button
                type="button"
                onClick={() => {
                  setShowShortcuts(true);
                }}
                aria-label="Keyboard shortcuts (?)"
                aria-haspopup="dialog"
                title="Keyboard shortcuts (?)"
                className="inline-flex shrink-0 items-center gap-1 justify-self-center rounded-full border border-gray-600 px-3 py-0.5 font-mono text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-300"
              >
                Shortcuts
                <span className="font-mono text-[10px] text-gray-400" aria-hidden="true">
                  ?
                </span>
              </button>
              <span className="inline-flex flex-wrap items-center justify-end gap-2 justify-self-end text-right whitespace-nowrap tabular-nums">
                <span>
                  {nodesForUi.size} {nodeCountLabel} | {device.messages.length} messages
                </span>
                <UpdateStatusIndicator
                  updateState={updateState}
                  onCheck={() => {
                    setUpdateState({ phase: 'idle' });
                    void window.electronAPI.update.check();
                  }}
                  onDownload={() => window.electronAPI.update.download()}
                  onInstall={() => window.electronAPI.update.install()}
                  onViewRelease={() =>
                    window.electronAPI.update.openReleases(updateState.releaseUrl)
                  }
                />
              </span>
            </footer>
          </div>
        </div>

        {logPanelVisible && (
          <Suspense fallback={<DialogLazyFallback />}>
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
              onClose={() => {
                setLogPanelVisible(false);
                try {
                  localStorage.setItem(LOG_PANEL_VISIBLE_KEY, 'false');
                } catch (e) {
                  console.debug('[App] persist logPanelVisible', e);
                }
              }}
            />
          </Suspense>
        )}

        {/* Keyboard Shortcuts Modal */}
        {showShortcuts && (
          <Suspense fallback={<DialogLazyFallback />}>
            <KeyboardShortcutsModal
              onClose={() => {
                setShowShortcuts(false);
              }}
              tabNames={displayTabNames}
            />
          </Suspense>
        )}

        {/* Cross-channel Search Modal */}
        {searchModalOpen && (
          <Suspense fallback={<DialogLazyFallback />}>
            <SearchModal
              isOpen={searchModalOpen}
              onClose={() => {
                setSearchModalOpen(false);
              }}
              protocol={protocol}
              nodes={nodesForUi}
              channels={chatChannels}
              onNavigateToChannel={() => {
                setActiveTab(1);
              }}
            />
          </Suspense>
        )}

        {/* Contact Groups Modal */}
        {showGroupsModal && capabilities.hasUserManagedContactGroups && (
          <Suspense fallback={<DialogLazyFallback />}>
            <ContactGroupsModal
              groups={contactGroups.groups}
              contacts={protocol === 'meshcore' ? meshcoreDevice.nodes : meshtasticDevice.nodes}
              selfNodeId={
                protocol === 'meshcore' ? meshcoreDevice.selfNodeId : meshtasticDevice.selfNodeId
              }
              protocol={protocol}
              onClose={() => {
                setShowGroupsModal(false);
              }}
              onCreate={contactGroups.createGroup}
              onRename={contactGroups.updateGroup}
              onDelete={contactGroups.deleteGroup}
              onAddMember={contactGroups.addMember}
              onRemoveMember={contactGroups.removeMember}
              onLoadMembers={contactGroups.loadMembers}
              memberIds={contactGroups.groupMemberIds}
            />
          </Suspense>
        )}

        {/* Node Detail Modal — rendered outside main for proper z-indexing */}
        {selectedNodeId !== null && (
          <Suspense fallback={<DialogLazyFallback />}>
            <NodeDetailModal
              nodes={nodesForUi}
              node={selectedNode}
              onClose={() => {
                setSelectedNodeId(null);
              }}
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
              onRequestTelemetry={
                protocol === 'meshcore' ? meshcoreDevice.requestTelemetry : undefined
              }
              meshcoreNeighbors={
                protocol === 'meshcore' && selectedNode
                  ? meshcoreDevice.meshcoreNeighbors.get(selectedNode.node_id)
                  : undefined
              }
              onRequestNeighbors={
                protocol === 'meshcore' ? meshcoreDevice.requestNeighbors : undefined
              }
              meshcoreNeighborError={
                protocol === 'meshcore' && selectedNode
                  ? meshcoreDevice.meshcoreNeighborErrors.get(selectedNode.node_id)
                  : undefined
              }
              paxCounterData={protocol === 'meshtastic' ? device.paxCounterData : undefined}
              detectionSensorEvents={
                protocol === 'meshtastic' ? device.detectionSensorEvents : undefined
              }
              mapReports={protocol === 'meshtastic' ? device.mapReports : undefined}
              onExportContact={protocol === 'meshcore' ? meshcoreDevice.exportContact : undefined}
              onShareContact={protocol === 'meshcore' ? meshcoreDevice.shareContact : undefined}
            />
          </Suspense>
        )}
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

// ─── Firmware update check on device connect ──────────────────────
function FirmwareUpdateNotifier({
  meshtasticState,
  meshcoreState,
  protocol,
  onResult,
}: {
  meshtasticState: DeviceState;
  meshcoreState: DeviceState;
  protocol: MeshProtocol;
  onResult: (r: FirmwareCheckResult) => void;
}) {
  const { addToast } = useToast();
  const toastShownRef = useRef(false);
  const activeState = protocol === 'meshcore' ? meshcoreState : meshtasticState;

  useEffect(() => {
    const { status, firmwareVersion } = activeState;
    if (status !== 'configured' || !firmwareVersion) return;

    toastShownRef.current = false;
    onResult({ phase: 'checking' });
    let cancelled = false;

    const doCheck =
      protocol === 'meshcore'
        ? fetchLatestMeshCoreRelease().then((release) => {
            const deviceDate = parseMeshCoreBuildDate(firmwareVersion);
            const updateAvailable = deviceDate === null || deviceDate < release.publishedAt;
            return { updateAvailable, release };
          })
        : fetchLatestMeshtasticRelease().then((release) => {
            const updateAvailable = semverGt(release.version, firmwareVersion);
            return { updateAvailable, release };
          });

    doCheck
      .then(({ updateAvailable, release }) => {
        if (cancelled) return;
        onResult(
          updateAvailable
            ? {
                phase: 'update-available',
                latestVersion: release.version,
                releaseUrl: release.releaseUrl,
              }
            : {
                phase: 'up-to-date',
                latestVersion: release.version,
                releaseUrl: release.releaseUrl,
              },
        );
        if (updateAvailable && !toastShownRef.current) {
          toastShownRef.current = true;
          addToast(`Firmware update available: v${release.version}`, 'warning', 8000);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn(
          '[FirmwareUpdateNotifier] check failed:',
          err instanceof Error ? err.message : String(err),
        );
        onResult({ phase: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [activeState, protocol, onResult, addToast]);

  useEffect(() => {
    if (activeState.status === 'disconnected') {
      onResult({ phase: 'idle' });
      toastShownRef.current = false;
    }
  }, [activeState.status, onResult]);

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
      <div className="flex items-center justify-between border-b border-yellow-700 bg-yellow-900/80 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-yellow-400">⚠</span>
          <span className="text-sm text-yellow-200">
            Connection may be lost — no data received recently
          </span>
        </div>
        <button
          onClick={onReconnect}
          className="text-sm font-medium text-yellow-300 underline hover:text-yellow-100"
        >
          Reconnect
        </button>
      </div>
    );
  }

  if (status === 'reconnecting') {
    return (
      <div className="flex items-center gap-2 border-b border-orange-700 bg-orange-900/80 px-4 py-2">
        <span className="inline-block animate-spin text-orange-400">⟳</span>
        <span className="animate-pulse text-sm text-orange-200">
          Reconnecting... attempt {reconnectAttempt ?? 1}/5
        </span>
      </div>
    );
  }

  return null;
}
