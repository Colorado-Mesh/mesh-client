/* eslint-disable react-hooks/set-state-in-effect */
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { createUpdateMenuNotifyController } from '@/renderer/lib/updateMenuNotifyController';
import type { UpdateCheckingPayload } from '@/shared/electron-api.types';

import ChannelUtilizationChart from './components/ChannelUtilizationChart';
import ErrorBoundary from './components/ErrorBoundary';
import { HelpTooltip } from './components/HelpTooltip';
import LanguageSelector from './components/LanguageSelector';
import Sidebar from './components/Sidebar';
import { LinkIcon } from './components/SignalBars';
import SignalPropagation from './components/SignalPropagation';
import { ToastProvider, useToast } from './components/Toast';
import UpdateStatusIndicator from './components/UpdateStatusIndicator';
import { useContactGroups } from './hooks/useContactGroups';
import { useDevice } from './hooks/useDevice';
import { useMeshCore } from './hooks/useMeshCore';
import { useNodeStatusNotifier } from './hooks/useNodeStatusNotifier';
import { useTakServer } from './hooks/useTakServer';
import { ChatPanel, ConnectionPanel, LogPanel, NodeListPanel } from './lazyAppPanels';
import { ContactGroupsModal, NodeDetailModal } from './lazyModals';
import {
  AppPanel,
  DiagnosticsPanel,
  MapPanel,
  ModulePanel,
  PacketDistributionPanel,
  PeerGraphPanel,
  RadioPanel,
  RawPacketLogPanel,
  RepeatersPanel,
  RFHistogramsPanel,
  SecurityPanel,
  TakServerPanel,
  TelemetryPanel,
} from './lazyTabPanels';
import { getAppSettingsRaw } from './lib/appSettingsStorage';
import { playMessageNotification } from './lib/chatNotifications';
import {
  deviceHeaderVariant,
  headerDotClass,
  headerIconClass,
  headerTextClass,
  mqttHeaderVariant,
  takHeaderVariant,
} from './lib/connectionHeaderStatus';
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
  readMeshcoreIdentityAsync,
} from './lib/letsMeshJwt';
import { pubkeyToNodeId } from './lib/meshcoreUtils';
import { meshNodeStubForDetailModal } from './lib/meshNodeStubForDetail';
import { MESHTASTIC_OFFICIAL_PRESET_DEFAULTS } from './lib/meshtasticMqttTlsMigration';
import { fetchMessageRetention } from './lib/messageRetention';
import { nodeLabelForRawPacket } from './lib/nodeLongNameOrHex';
import { parseStoredJson } from './lib/parseStoredJson';
import type { ProtocolCapabilities } from './lib/radio/BaseRadioProvider';
import { useRadioProvider } from './lib/radio/providerFactory';
import { getStoredMeshProtocol, MESH_PROTOCOL_STORAGE_KEY } from './lib/storedMeshProtocol';
import { applyThemeColors, loadThemeColors } from './lib/themeColors';
import type { ChatMessage, DeviceState, MeshProtocol, MQTTSettings } from './lib/types';
import { useDiagnosticsStore } from './stores/diagnosticsStore';
import { useMapLayerStore } from './stores/mapLayerStore';
import { useMapViewportStore } from './stores/mapViewportStore';
import { usePathHistoryStore } from './stores/pathHistoryStore';
import { usePositionHistoryStore } from './stores/positionHistoryStore';

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
  'hasRawPacketLog', // Distribution
  'hasRawPacketLog', // Sniffer (keyboard help: Packet Sniffer)
  undefined, // RF
  undefined, // Graph
];

function deviceConnectionStatusLabel(
  t: ReturnType<typeof useTranslation>['t'],
  status: DeviceState['status'],
): string {
  switch (status) {
    case 'disconnected':
      return t('app.deviceStatus.disconnected');
    case 'connecting':
      return t('app.deviceStatus.connecting');
    case 'connected':
      return t('app.deviceStatus.connected');
    case 'configured':
      return t('app.deviceStatus.configured');
    case 'stale':
      return t('app.deviceStatus.stale');
    case 'reconnecting':
      return t('app.deviceStatus.reconnecting');
    default: {
      const _x: never = status;
      return _x;
    }
  }
}

/** Stable English tab slot ids (icons, shortcuts, chat badge) — not for display. */
const TAB_SLOT_IDS = [
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
  'Stats',
  'Sniffer',
  'RF',
  'Graph',
] as const;

const MAP_TAB_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Map');

function tabLabelKey(protocol: MeshProtocol, panelIndex: number): `tabs.${string}` {
  if (panelIndex === 2 && protocol === 'meshcore') return 'tabs.contacts';
  if (panelIndex === 5 && protocol === 'meshcore') return 'tabs.repeaters';
  return `tabs.${TAB_SLOT_IDS[panelIndex].toLowerCase()}`;
}

function tabIconSlotId(protocol: MeshProtocol, panelIndex: number): string {
  if (panelIndex === 5 && protocol === 'meshcore') return 'Repeaters';
  return TAB_SLOT_IDS[panelIndex];
}

function computeTabMappings(
  translate: ReturnType<typeof useTranslation>['t'],
  targetProtocol: MeshProtocol,
  targetCapabilities: ProtocolCapabilities,
) {
  const filtered: { label: string; slotId: string; panelIndex: number }[] = [];
  TAB_SLOT_IDS.forEach((_slot, panelIndex) => {
    const requiredCap = TAB_CAPABILITY_REQUIREMENTS[panelIndex];
    if (requiredCap !== undefined && !targetCapabilities[requiredCap]) return;
    filtered.push({
      label: translate(tabLabelKey(targetProtocol, panelIndex)),
      slotId: tabIconSlotId(targetProtocol, panelIndex),
      panelIndex,
    });
  });
  return {
    displayTabLabels: filtered.map((row) => row.label),
    tabSlotIds: filtered.map((row) => row.slotId),
    tabIndexToPanelIndex: filtered.map((row) => row.panelIndex),
  };
}

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
    console.debug('[App] readLogPanelVisible ' + errLikeToLogString(e));
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
    console.debug('[App] readPersistedUnread ' + errLikeToLogString(e));
    return 0;
  }
}

function persistUnread(protocol: 'meshtastic' | 'meshcore', count: number): void {
  try {
    const key = protocol === 'meshcore' ? MESHCORE_UNREAD_KEY : MESHTASTIC_UNREAD_KEY;
    const n = Math.max(0, Math.min(Math.floor(count) || 0, 99999));
    localStorage.setItem(key, String(n));
  } catch (e) {
    console.debug('[App] persistUnread quota/private mode ' + errLikeToLogString(e));
  }
}

function PanelSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full min-h-[12rem] items-center justify-center rounded-xl border border-gray-800 bg-gray-900/50"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">{t('app.loadingPanel')}</span>
      <div className="h-8 w-8 animate-pulse rounded-full bg-gray-700" aria-hidden />
    </div>
  );
}

function DialogLazyFallback() {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">{t('app.loadingDialog')}</span>
      <div className="h-10 w-10 animate-pulse rounded-full bg-gray-600" aria-hidden />
    </div>
  );
}

function TakStatusIcon({ variant }: { variant: ReturnType<typeof takHeaderVariant> }) {
  return (
    <svg
      aria-hidden="true"
      className={`h-4 w-4 ${headerIconClass(variant)}`}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8M3.05,13H1V11H3.05C3.5,6.83 6.83,3.5 11,3.05V1H13V3.05C17.17,3.5 20.5,6.83 20.95,11H23V13H20.95C20.5,17.17 17.17,20.5 13,20.95V23H11V20.95C6.83,20.5 3.5,17.17 3.05,13M12,5A7,7 0 0,0 5,12A7,7 0 0,0 12,19A7,7 0 0,0 19,12A7,7 0 0,0 12,5Z" />
    </svg>
  );
}

function MqttGlobeIcon({ variant }: { variant: ReturnType<typeof mqttHeaderVariant> }) {
  return (
    <svg
      className={`h-4 w-4 ${headerIconClass(variant)}`}
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

/** Header watermark graphic (collapsed sidebar shows mark; expanded hides via CSS). */
function ColoradoMeshWatermarkMark() {
  return (
    <svg
      className="cm-watermark-mark"
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="cmWmMtnGrad"
          x1="0"
          y1="0"
          x2="1"
          y2="0"
          gradientUnits="userSpaceOnUse"
          gradientTransform="matrix(510.141384,0,0,227.403089,280.365777,471.821953)"
        >
          <stop offset="0" stopColor="#83ff80" />
          <stop offset="1" stopColor="#101928" />
        </linearGradient>
        <linearGradient
          id="cmWmArcAlpha"
          x1="0"
          y1="0.5"
          x2="1"
          y2="0.5"
          gradientUnits="objectBoundingBox"
        >
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask
          id="cmWmArcMask"
          maskUnits="objectBoundingBox"
          maskContentUnits="objectBoundingBox"
          x="0"
          y="0"
          width="1"
          height="1"
        >
          <rect x="0" y="0" width="1" height="1" fill="url(#cmWmArcAlpha)" />
        </mask>
      </defs>
      <g className="cm-watermark-arches">
        <g transform="matrix(1.482714,0,0,2.228662,-282.713188,-686.490072)">
          <path
            d="M248,604C296.733,449.457 436.333,440.225 508.333,440.225"
            fill="none"
            className="cm-watermark-brand-stroke"
            strokeWidth="14"
            strokeLinecap="round"
            vectorEffect="nonScalingStroke"
            mask="url(#cmWmArcMask)"
          />
        </g>
        <g transform="matrix(-1.482714,0,0,2.124862,1291.713188,-642.794439)">
          <path
            d="M248,604C296.733,449.457 436.333,440.225 508.333,440.225"
            fill="none"
            className="cm-watermark-brand-stroke"
            strokeWidth="14"
            strokeLinecap="round"
            vectorEffect="nonScalingStroke"
            mask="url(#cmWmArcMask)"
          />
        </g>
      </g>
      <g transform="matrix(1.550828,0,0,1.550828,-296.433233,-165.128779)">
        <path
          d="M790.245,583.702C790.333,584.309 790.42,584.916 790.507,585.523C788.044,584.513 733.186,553.111 681.69,519.21C640.083,491.819 640.501,491.448 600.434,461.629C596.33,458.575 606.541,489.356 604.241,496.419C601.789,503.946 564.411,456.477 544.209,439.898C540.087,436.514 522.666,450.746 522.214,451.051C503.617,463.621 500.856,442.079 492.1,427.753C485.685,417.259 482.119,427.358 340.171,535.067C300.15,565.436 261.15,599.171 290.779,571.715C325.553,539.491 434.357,430.948 458.868,407.89C503.865,365.56 507.371,354.727 520.344,358.977C527.829,361.43 715.775,533.16 790.245,583.702Z"
          fill="url(#cmWmMtnGrad)"
          fillRule="evenodd"
        />
      </g>
      <g transform="matrix(0.451809,0,0,0.451809,273.173684,146.688318)">
        <circle cx="512" cy="332" r="38" className="cm-watermark-sun" />
      </g>
      <g transform="matrix(0.523438,0,0,0.523438,236.5,122.907726)">
        <circle
          cx="512"
          cy="332"
          r="64"
          fill="none"
          className="cm-watermark-brand-stroke"
          strokeWidth="12"
          vectorEffect="nonScalingStroke"
        />
      </g>
    </svg>
  );
}

export default function App() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('mesh-client:sidebarCollapsed') === 'true';
  });
  const handleSidebarToggle = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('mesh-client:sidebarCollapsed', String(next));
      return next;
    });
  }, []);
  const [signalPulseKey, setSignalPulseKey] = useState<number | null>(null);
  const handleSignalPulseComplete = useCallback(() => {
    setSignalPulseKey(null);
  }, []);
  const handleCollapsedWatermarkActivate = useCallback(() => {
    setSignalPulseKey((prev) => prev ?? Date.now());
  }, []);
  const [meshTubeLit, setMeshTubeLit] = useState(false);
  const [meshTubePhase, setMeshTubePhase] = useState<'idle' | 'flicker-on' | 'flicker-off'>('idle');
  const meshTubePhaseRef = useRef(meshTubePhase);
  const meshTubeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    meshTubePhaseRef.current = meshTubePhase;
  }, [meshTubePhase]);

  const handleMeshTubeToggle = useCallback(() => {
    if (meshTubePhase !== 'idle') return;
    if (!meshTubeLit) {
      setMeshTubePhase('flicker-on');
      meshTubeTimeoutRef.current = setTimeout(() => {
        meshTubeTimeoutRef.current = null;
        setMeshTubeLit(true);
        setMeshTubePhase('idle');
      }, 1500);
    } else {
      setMeshTubePhase('flicker-off');
      meshTubeTimeoutRef.current = setTimeout(() => {
        meshTubeTimeoutRef.current = null;
        setMeshTubeLit(false);
        setMeshTubePhase('idle');
      }, 1500);
    }
  }, [meshTubeLit, meshTubePhase]);

  useEffect(() => {
    return () => {
      if (meshTubeTimeoutRef.current) clearTimeout(meshTubeTimeoutRef.current);
    };
  }, []);

  // Reset mesh tube animation state when sidebar collapses - useLayoutEffect for synchronous DOM updates

  useLayoutEffect(() => {
    if (!sidebarCollapsed) return;
    if (meshTubeTimeoutRef.current) {
      clearTimeout(meshTubeTimeoutRef.current);
      meshTubeTimeoutRef.current = null;
    }
    const phase = meshTubePhaseRef.current;
    if (phase === 'flicker-on') setMeshTubeLit(false);
    if (phase === 'flicker-off') setMeshTubeLit(true);
    setMeshTubePhase('idle');
  }, [sidebarCollapsed]);

  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  // Stable array ref from Map.get — safe for React 19 useSyncExternalStore (not latestPositionHistoryPoint).
  const selectedNodeHistoryPoints = usePositionHistoryStore(
    useCallback(
      (s) => (selectedNodeId == null ? undefined : s.history.get(selectedNodeId)),
      [selectedNodeId],
    ),
  );
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
  const [chatCompactMode, setChatCompactMode] = useState<boolean>(() => {
    const s =
      parseStoredJson<Record<string, unknown>>(getAppSettingsRaw(), 'App chatCompactMode') ?? {};
    return Boolean(s.chatCompactMode);
  });
  const [pendingDmTarget, setPendingDmTarget] = useState<number | null>(null);
  const [meshtasticUnread, setMeshtasticUnread] = useState(() => readPersistedUnread('meshtastic'));
  const [meshcoreUnread, setMeshcoreUnread] = useState(() => readPersistedUnread('meshcore'));
  const [logPanelVisible, setLogPanelVisible] = useState(readLogPanelVisible);
  const prevMeshtasticMsgCountRef = useRef(0);
  const prevMeshcoreMsgCountRef = useRef(0);
  const isMeshtasticInitialRef = useRef(true);
  const isMeshcoreInitialRef = useRef(true);
  const mainViewportRef = useRef<HTMLDivElement>(null);
  const activePanelIndexRef = useRef(0);
  const scrollToTopChatRef = useRef<(() => void) | null>(null);
  const [showMainScrollTop, setShowMainScrollTop] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: 'idle' });
  const menuUpdateNotifyCtrl = useMemo(
    () =>
      createUpdateMenuNotifyController(t, (title, body) =>
        window.electronAPI.notify.show(title, body),
      ),
    [t],
  );
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

  useEffect(() => {
    void usePathHistoryStore.getState().loadAllFromDb();
  }, []);

  const [protocol, setProtocol] = useState<MeshProtocol>(() => getStoredMeshProtocol());

  const meshtasticDevice = useDevice();
  const meshcoreDevice = useMeshCore();
  const { status: takStatus, error: takError, takClientLoss } = useTakServer();
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
  const previousDeviceStatusRef = useRef(device.state.status);
  const activeTabRef = useRef(activeTab);
  const protocolRef = useRef(protocol);
  const lastMeshtasticTab = useRef(0);
  const lastMeshcoreTab = useRef(0);
  const lastMeshtasticPanel = useRef<number | null>(null);
  const lastMeshcorePanel = useRef<number | null>(null);
  const meshtasticMsgsRef = useRef(meshtasticDevice.messages);
  const meshcoreMsgsRef = useRef(meshcoreDevice.messages);
  const meshtasticMyNodeNumRef = useRef(meshtasticDevice.state.myNodeNum);
  const meshcoreSelfIdRef = useRef(meshcoreDevice.selfNodeId);
  const nodesForUi = protocol === 'meshcore' ? meshcoreDevice.nodes : meshtasticDevice.nodes;
  /** Meshtastic + MeshCore nodes for Diagnostics (foreign MeshCore sender labels/links). */
  const nodesForDiagnostics = useMemo(() => {
    const merged = new Map(meshtasticDevice.nodes);
    for (const [id, node] of meshcoreDevice.nodes) {
      merged.set(id, node);
    }
    return merged;
  }, [meshtasticDevice.nodes, meshcoreDevice.nodes]);
  const rawPacketGetNodeLabel = useCallback(
    (id: number) => nodeLabelForRawPacket(nodesForUi.get(id), id, protocol),
    [nodesForUi, protocol],
  );
  const nodeCountLabel = protocol === 'meshcore' ? t('common.contacts') : t('common.nodes');

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
  const meshtasticCapabilities = useRadioProvider('meshtastic');
  const meshcoreCapabilities = useRadioProvider('meshcore');

  useNodeStatusNotifier(nodesForUi, capabilities);

  const meshtasticTabs = useMemo(
    () => computeTabMappings(t, 'meshtastic', meshtasticCapabilities),
    [t, meshtasticCapabilities],
  );
  const meshcoreTabs = useMemo(
    () => computeTabMappings(t, 'meshcore', meshcoreCapabilities),
    [t, meshcoreCapabilities],
  );

  const { displayTabLabels, tabSlotIds, tabIndexToPanelIndex } = useMemo(() => {
    return protocol === 'meshcore' ? meshcoreTabs : meshtasticTabs;
  }, [protocol, meshtasticTabs, meshcoreTabs]);

  const activePanelIndex = tabIndexToPanelIndex[activeTab] ?? 0;
  const prevPanelIndexForChatFreezeRef = useRef(activePanelIndex);

  useEffect(() => {
    void useMapLayerStore.getState().hydrateFromDatabase();
  }, []);

  useEffect(() => {
    activeTabRef.current = activeTab;
    protocolRef.current = protocol;
    meshtasticMsgsRef.current = meshtasticDevice.messages;
    meshcoreMsgsRef.current = meshcoreDevice.messages;
    meshtasticMyNodeNumRef.current = meshtasticDevice.state.myNodeNum;
    meshcoreSelfIdRef.current = meshcoreDevice.selfNodeId;
    lastMeshtasticTab.current = protocol === 'meshtastic' ? activeTab : lastMeshtasticTab.current;
    lastMeshcoreTab.current = protocol === 'meshcore' ? activeTab : lastMeshcoreTab.current;
    lastMeshtasticPanel.current =
      protocol === 'meshtastic' ? activePanelIndex : lastMeshtasticPanel.current;
    lastMeshcorePanel.current =
      protocol === 'meshcore' ? activePanelIndex : lastMeshcorePanel.current;
    activePanelIndexRef.current = activePanelIndex;
  }, [
    activeTab,
    activePanelIndex,
    protocol,
    meshtasticDevice.messages,
    meshtasticDevice.state.myNodeNum,
    meshcoreDevice.messages,
    meshcoreDevice.selfNodeId,
  ]);

  // Reset activeTab if it's out of bounds (e.g., switching to meshcore while on Security tab)
  useEffect(() => {
    if (activeTab >= displayTabLabels.length) {
      const savedPanel =
        protocol === 'meshcore' ? lastMeshcorePanel.current : lastMeshtasticPanel.current;
      let next = 0;
      const targetTabs = protocol === 'meshcore' ? meshcoreTabs : meshtasticTabs;

      if (savedPanel != null) {
        const foundFilteredIndex = targetTabs.tabIndexToPanelIndex.findIndex(
          (p) => p === savedPanel,
        );
        if (foundFilteredIndex !== -1 && foundFilteredIndex < targetTabs.displayTabLabels.length) {
          next = foundFilteredIndex;
        }
      } else {
        const savedTab =
          protocol === 'meshcore' ? lastMeshcoreTab.current : lastMeshtasticTab.current;
        next = savedTab < targetTabs.displayTabLabels.length ? savedTab : 0;
      }

      setActiveTab(next);
    }
  }, [activeTab, displayTabLabels.length, protocol, meshtasticTabs, meshcoreTabs]);

  // Reset scroll position when switching tabs
  useEffect(() => {
    if (mainViewportRef.current) {
      mainViewportRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  useEffect(() => {
    const viewport = mainViewportRef.current;
    if (!viewport) return;
    const handleMainScroll = () => {
      if (activePanelIndexRef.current === 1) {
        setShowMainScrollTop(false);
      } else {
        setShowMainScrollTop(viewport.scrollTop > 200);
      }
    };
    handleMainScroll();
    viewport.addEventListener('scroll', handleMainScroll);
    return () => {
      viewport.removeEventListener('scroll', handleMainScroll);
    };
  }, []);

  const scrollMainToTop = useCallback(() => {
    if (activePanelIndex === 1 && scrollToTopChatRef.current) {
      scrollToTopChatRef.current();
    } else {
      mainViewportRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activePanelIndex]);

  const handleProtocolChange = useCallback(
    (newProtocol: MeshProtocol) => {
      if (newProtocol === protocol) return;

      const savedPanel =
        newProtocol === 'meshcore' ? lastMeshcorePanel.current : lastMeshtasticPanel.current;
      let targetTab = 0;

      if (savedPanel != null) {
        const targetTabs = newProtocol === 'meshcore' ? meshcoreTabs : meshtasticTabs;
        const foundFilteredIndex = targetTabs.tabIndexToPanelIndex.findIndex(
          (p) => p === savedPanel,
        );
        if (foundFilteredIndex !== -1 && foundFilteredIndex < targetTabs.displayTabLabels.length) {
          targetTab = foundFilteredIndex;
        }
      } else {
        const savedTab =
          newProtocol === 'meshcore' ? lastMeshcoreTab.current : lastMeshtasticTab.current;
        const targetTabs = newProtocol === 'meshcore' ? meshcoreTabs : meshtasticTabs;
        targetTab = savedTab < targetTabs.displayTabLabels.length ? savedTab : 0;
      }

      if (newProtocol === 'meshtastic') {
        lastMeshcoreTab.current = activeTab;
        lastMeshcorePanel.current = activePanelIndex;
        setActiveTab(targetTab);
      } else {
        lastMeshtasticTab.current = activeTab;
        lastMeshtasticPanel.current = activePanelIndex;
        setActiveTab(targetTab);
      }

      useDiagnosticsStore.getState().clearDiagnostics({ preserveForeignLora: true });
      localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, newProtocol);
      setProtocol(newProtocol);
    },
    [protocol, activeTab, activePanelIndex, meshtasticTabs, meshcoreTabs],
  );

  const handleShowOnMap = useCallback(
    (nodeId: number, lat: number, lon: number) => {
      useMapViewportStore.getState().requestFocus({ nodeId, lat, lon });
      setSelectedNodeId(null);
      const tabs = protocol === 'meshtastic' ? meshtasticTabs : meshcoreTabs;
      const mapTabIndex = tabs.tabIndexToPanelIndex.findIndex((idx) => idx === MAP_TAB_PANEL_INDEX);
      if (mapTabIndex >= 0) {
        setActiveTab(mapTabIndex);
      }
    },
    [protocol, meshtasticTabs, meshcoreTabs],
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
    const previousDeviceStatus = previousDeviceStatusRef.current;

    if (
      device.state.status === 'disconnected' &&
      previousDeviceStatus !== 'disconnected' &&
      telemetryNoticeDismissed
    ) {
      setTelemetryNoticeDismissed(false);
    }

    previousDeviceStatusRef.current = device.state.status;
  }, [device.state.status, telemetryNoticeDismissed]);

  const isConfigured = device.state.status === 'configured';
  const isOperational = isConfigured || device.state.status === 'stale';
  const isConnectedOrOperational = isOperational || device.state.status === 'connected';
  const detailModalProtocol = useMemo((): MeshProtocol => {
    if (selectedNodeId == null) return protocol;
    if (meshcoreDevice.nodes.has(selectedNodeId)) return 'meshcore';
    return protocol;
  }, [selectedNodeId, protocol, meshcoreDevice.nodes]);

  const detailModalNodes = detailModalProtocol === 'meshcore' ? meshcoreDevice.nodes : nodesForUi;
  const detailHomeNode =
    detailModalProtocol === 'meshcore'
      ? (meshcoreDevice.nodes.get(meshcoreDevice.selfNodeId) ?? null)
      : (nodesForUi.get(device.state.myNodeNum) ?? null);
  const detailMyNodeNum =
    detailModalProtocol === 'meshcore' ? meshcoreDevice.selfNodeId : device.state.myNodeNum;

  const selectedNode = useMemo(() => {
    if (selectedNodeId == null) return null;
    const liveNode = meshcoreDevice.nodes.get(selectedNodeId) ?? nodesForUi.get(selectedNodeId);
    if (liveNode) return liveNode;

    const fallback = meshNodeStubForDetailModal(selectedNodeId);
    const historyPoints = selectedNodeHistoryPoints;
    if (!historyPoints || historyPoints.length === 0) return fallback;

    let latest = historyPoints[0];
    for (let i = 1; i < historyPoints.length; i++) {
      if (historyPoints[i].t > latest.t) latest = historyPoints[i];
    }

    return {
      ...fallback,
      latitude: latest.lat,
      longitude: latest.lon,
      last_heard: Math.max(fallback.last_heard, Math.floor(latest.t / 1000)),
    };
  }, [selectedNodeId, nodesForUi, meshcoreDevice.nodes, selectedNodeHistoryPoints]);
  const selectedNodeHistory = useMemo(() => {
    if (selectedNodeId == null || !selectedNodeHistoryPoints) return undefined;
    return new Map([[selectedNodeId, selectedNodeHistoryPoints]]);
  }, [selectedNodeId, selectedNodeHistoryPoints]);

  const handleResend = useCallback(
    (msg: ChatMessage) => {
      device.sendMessage(msg.payload, msg.channel, msg.to ?? undefined, msg.replyId);
    },
    [device],
  );

  const traceRouteHops = useMemo(() => {
    if (!selectedNode) return undefined;
    if (protocol === 'meshcore') return undefined;
    const result = device.traceRouteResults.get(selectedNode.node_id);
    if (!result) return undefined;
    return [
      device.getFullNodeLabel(device.state.myNodeNum) || 'Me',
      ...result.route.map((id) => device.getFullNodeLabel(id)),
      device.getFullNodeLabel(result.from),
    ];
  }, [selectedNode, device, protocol]);

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

  const [chatTabVisited, setChatTabVisited] = useState(false);
  const [chatPanelFreeze, setChatPanelFreeze] = useState<{
    messages: typeof device.messages;
    channels: typeof chatChannels;
    nodes: typeof nodesForUi;
  } | null>(null);

  // Chat tab freeze: run BEFORE protocol reset on the same commit so protocol clear wins when both fire.
  useEffect(() => {
    const was = prevPanelIndexForChatFreezeRef.current;
    const now = activePanelIndex;
    prevPanelIndexForChatFreezeRef.current = now;

    if (now === 1) {
      setChatTabVisited(true);
    }

    if (was === 1 && now !== 1) {
      setChatPanelFreeze({
        messages: device.messages,
        channels: chatChannels,
        nodes: nodesForUi,
      });
    }
    // Intentionally only activePanelIndex: snapshot is taken on tab transition, not on every
    // messages/nodes identity change (that caused an infinite setState loop on Chat).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- freeze capture uses render snapshot at leave
  }, [activePanelIndex]);

  useEffect(() => {
    setChatTabVisited(false);
    setChatPanelFreeze(null);
    prevPanelIndexForChatFreezeRef.current = activePanelIndex;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- protocol-only reset; capture current panel for ref sync
  }, [protocol]);

  const isChatPanelFrozen = chatTabVisited && activePanelIndex !== 1;
  const freeze = chatPanelFreeze;
  const chatMessagesForPanel = isChatPanelFrozen && freeze ? freeze.messages : device.messages;
  const chatNodesForPanel = isChatPanelFrozen && freeze ? freeze.nodes : nodesForUi;
  const chatChannelsForPanel = isChatPanelFrozen && freeze ? freeze.channels : chatChannels;

  const handleDmTargetConsumed = useCallback(() => {
    setPendingDmTarget(null);
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
          console.warn('[App] startup migrateRfStubNodes failed ' + errLikeToLogString(e));
        }),
        // Delete nodes with last_heard = never (placeholder stubs with no data)
        window.electronAPI.db.deleteNodesNeverHeard().catch((e: unknown) => {
          console.warn('[App] startup deleteNodesNeverHeard failed ' + errLikeToLogString(e));
        }),
      );
      if (s.autoPruneEnabled) {
        const days =
          typeof s.autoPruneDays === 'number' && s.autoPruneDays > 0 ? s.autoPruneDays : 30;
        ops.push(
          window.electronAPI.db.deleteNodesByAge(days).catch((e: unknown) => {
            console.warn('[App] startup deleteNodesByAge failed ' + errLikeToLogString(e));
          }),
        );
      }
      if (s.nodeCapEnabled) {
        const cap =
          typeof s.nodeCapCount === 'number' && s.nodeCapCount > 0 ? s.nodeCapCount : 10000;
        ops.push(
          window.electronAPI.db.pruneNodesByCount(cap).catch((e: unknown) => {
            console.warn('[App] startup pruneNodesByCount failed ' + errLikeToLogString(e));
          }),
        );
      }
      if (s.pruneEmptyNamesEnabled) {
        ops.push(
          window.electronAPI.db.deleteNodesWithoutLongname().catch((e: unknown) => {
            console.warn(
              '[App] startup deleteNodesWithoutLongname failed ' + errLikeToLogString(e),
            );
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
            console.warn('[App] startup prunePositionHistory failed ' + errLikeToLogString(e));
          }),
        );
      }
    } else if (startupProtocol === 'meshcore') {
      if (s.meshcoreDeleteNeverAdvertised) {
        ops.push(
          window.electronAPI.db.deleteMeshcoreContactsNeverAdvertised().catch((e: unknown) => {
            console.warn(
              '[App] startup deleteMeshcoreContactsNeverAdvertised failed ' + errLikeToLogString(e),
            );
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
            console.warn(
              '[App] startup deleteMeshcoreContactsByAge failed ' + errLikeToLogString(e),
            );
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
            console.warn(
              '[App] startup pruneMeshcoreContactsByCount failed ' + errLikeToLogString(e),
            );
          }),
        );
      }
    }

    // Issue #387: DB-backed message retention. Two independent caps; prune
    // both tables on startup since both protocols may have data even if the
    // user is currently in the other one. Failures are best-effort: log and
    // continue so a transient DB lock doesn't block app startup.
    ops.push(
      fetchMessageRetention()
        .then((r) => {
          const innerOps: Promise<unknown>[] = [];
          if (r.meshtasticEnabled) {
            innerOps.push(
              window.electronAPI.db.pruneMessagesByCount(r.meshtasticCount).catch((e: unknown) => {
                console.warn('[App] startup pruneMessagesByCount failed ' + errLikeToLogString(e));
              }),
            );
          }
          if (r.meshcoreEnabled) {
            innerOps.push(
              window.electronAPI.db
                .pruneMeshcoreMessagesByCount(r.meshcoreCount)
                .catch((e: unknown) => {
                  console.warn(
                    '[App] startup pruneMeshcoreMessagesByCount failed ' + errLikeToLogString(e),
                  );
                }),
            );
          }
          return Promise.all(innerOps);
        })
        .catch((e: unknown) => {
          console.warn('[App] startup message retention prune failed ' + errLikeToLogString(e));
        }),
    );

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
                console.warn('[App] MQTT auto-launch skipped: ' + errLikeToLogString(presetErr));
                return;
              }
              const identity = await readMeshcoreIdentityAsync();
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
                  console.warn(
                    '[App] LetsMesh auth token auto-launch generation failed ' +
                      errLikeToLogString(e),
                  );
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
                  console.warn('[App] MQTT auto-launch skipped: ' + errLikeToLogString(manualErr));
                  return;
                }
              }
            }
            await window.electronAPI.mqtt.connect(connectSettings);
          };
          void tryConnect().catch((e: unknown) => {
            console.warn('[App] MQTT auto-launch connect failed ' + errLikeToLogString(e));
          });
        }
      } catch (e) {
        console.debug('[App] MQTT auto-launch startup ' + errLikeToLogString(e));
      }
    }
  }, []);

  // ─── LetsMesh JWT proactive/reactive refresh ──────────────────────
  useEffect(() => {
    const off = window.electronAPI.mqtt.onRequestTokenRefresh((serverHost) => {
      const doRefresh = async () => {
        try {
          const identity = await readMeshcoreIdentityAsync();
          if (!identity?.private_key || !identity?.public_key) {
            console.warn('[App] token refresh requested but no identity available');
            return;
          }
          const { token, expiresAt } = await generateLetsMeshAuthToken(identity, serverHost);
          await window.electronAPI.mqtt.updateMeshcoreToken(token, expiresAt);
        } catch (e) {
          console.warn('[App] token refresh failed ' + errLikeToLogString(e));
        }
      };
      void doRefresh();
    });
    return off;
  }, []);

  // ─── Auto-update event subscriptions ─────────────────────────────
  useEffect(() => {
    const offChecking = window.electronAPI.update.onChecking((payload?: UpdateCheckingPayload) => {
      menuUpdateNotifyCtrl.onChecking(payload);
      setUpdateState({ phase: 'idle' });
    });
    const offAvailable = window.electronAPI.update.onAvailable((info) => {
      setUpdateState({
        phase: 'available',
        version: info.version,
        releaseUrl: info.releaseUrl,
        isPackaged: info.isPackaged,
        isMac: info.isMac,
      });
      menuUpdateNotifyCtrl.flushSettled('available', { version: info.version });
    });
    const offNotAvailable = window.electronAPI.update.onNotAvailable(() => {
      setUpdateState((s) => ({ ...s, phase: 'up-to-date' }));
      menuUpdateNotifyCtrl.flushSettled('upToDate');
    });
    const offProgress = window.electronAPI.update.onProgress((info) => {
      setUpdateState((s) => ({ ...s, phase: 'downloading', percent: info.percent }));
    });
    const offDownloaded = window.electronAPI.update.onDownloaded(() => {
      setUpdateState((s) => ({ ...s, phase: 'ready' }));
    });
    const offError = window.electronAPI.update.onError((info) => {
      setUpdateState((s) => ({ ...s, phase: 'error' }));
      menuUpdateNotifyCtrl.flushSettled('error', { message: info.message });
    });
    return () => {
      offChecking();
      offAvailable();
      offNotAvailable();
      offProgress();
      offDownloaded();
      offError();
    };
  }, [menuUpdateNotifyCtrl]);

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
      void window.electronAPI.update.check().catch((e: unknown) => {
        console.warn('[App] update check failed ' + errLikeToLogString(e));
        setUpdateState((s) => ({ ...s, phase: 'error' }));
      });
    }, 5000);
    return () => {
      clearTimeout(t);
    };
  }, []);

  // ─── Track Meshtastic messages arriving while inactive ──────────
  useEffect(() => {
    const count = meshtasticDevice.messages.length;
    if (isMeshtasticInitialRef.current) {
      prevMeshtasticMsgCountRef.current = count;
      if (count > 0) isMeshtasticInitialRef.current = false;
      return;
    }
    const isActiveAndChatOpen =
      protocolRef.current === 'meshtastic' && activeTabRef.current === 1 && !document.hidden;
    if (count > prevMeshtasticMsgCountRef.current && !isActiveAndChatOpen) {
      const newMsgs = meshtasticMsgsRef.current.slice(prevMeshtasticMsgCountRef.current);
      const realNew = newMsgs.filter(
        (m) => m.sender_id !== meshtasticMyNodeNumRef.current && !m.emoji && !m.isHistory,
      );
      if (realNew.length > 0) {
        if (localStorage.getItem('mesh-client:notifMuted') !== '1') {
          const mutedRaw = localStorage.getItem('mesh-client:mutedViews:meshtastic');
          const mutedViews: Set<string> = mutedRaw
            ? new Set(JSON.parse(mutedRaw) as string[])
            : new Set();
          const myNum = meshtasticMyNodeNumRef.current;
          const audible = realNew.some((m) => {
            const peer = m.to != null ? (m.to === myNum ? m.sender_id : m.to) : null;
            const vk = peer != null ? `dm:${peer}` : `ch:${m.channel}`;
            return !mutedViews.has(vk);
          });
          if (audible) playMessageNotification();
        }
        queueMicrotask(() => {
          setMeshtasticUnread((prev) => prev + realNew.length);
        });
      }
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
    const isActiveAndChatOpen =
      protocolRef.current === 'meshcore' && activeTabRef.current === 1 && !document.hidden;
    if (count > prevMeshcoreMsgCountRef.current && !isActiveAndChatOpen) {
      const newMsgs = meshcoreMsgsRef.current.slice(prevMeshcoreMsgCountRef.current);
      const realNew = newMsgs.filter(
        (m) => m.sender_id !== meshcoreSelfIdRef.current && !m.emoji && !m.isHistory,
      );
      if (realNew.length > 0) {
        queueMicrotask(() => {
          setMeshcoreUnread((prev) => prev + realNew.length);
        });
      }
    }
    prevMeshcoreMsgCountRef.current = count;
  }, [meshcoreDevice.messages.length]);

  const clearChatUnreadForProtocol = useCallback((targetProtocol: MeshProtocol) => {
    if (targetProtocol === 'meshtastic') {
      setMeshtasticUnread(0);
    } else {
      setMeshcoreUnread(0);
    }
  }, []);

  // ─── Clear active protocol's unread when Chat panel becomes active ──
  useEffect(() => {
    if (activePanelIndex === 1) {
      queueMicrotask(() => {
        clearChatUnreadForProtocol(protocol);
      });
    }
  }, [activePanelIndex, clearChatUnreadForProtocol, protocol]);

  // If messages arrive while Chat is selected but the app is hidden/unfocused, the
  // active-panel effect above will not rerun when the user returns.
  useEffect(() => {
    const clearIfVisibleChatActive = () => {
      if (document.hidden || activePanelIndexRef.current !== 1) return;
      queueMicrotask(() => {
        clearChatUnreadForProtocol(protocolRef.current);
      });
    };

    const handleVisibilityChange = () => {
      clearIfVisibleChatActive();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', clearIfVisibleChatActive);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', clearIfVisibleChatActive);
    };
  }, [clearChatUnreadForProtocol]);

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
              console.warn(
                '[App] handleReconnect BLE auto-connect failed ' + errLikeToLogString(err),
              );
            });
          return;
        }
        device.connect(lastType).catch((err: unknown) => {
          console.warn('[App] handleReconnect connect failed ' + errLikeToLogString(err));
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

  const handleChatCompactModeChange = useCallback((compact: boolean) => {
    setChatCompactMode(compact);
  }, []);

  const mqttLoss = device.mqttConnectionLoss ?? false;
  const mqttVariant = mqttHeaderVariant(device.mqttStatus ?? 'disconnected', mqttLoss);
  const deviceLoss = device.state.connectionLoss ?? false;
  const deviceVariant = deviceHeaderVariant(device.state.status, deviceLoss);
  const takServerError = !takStatus.running && !!(takStatus.error || takError);
  const takVariant = takHeaderVariant(takStatus.running, takServerError, takClientLoss);
  const queueUsed = device.queueStatus ? device.queueStatus.maxlen - device.queueStatus.free : 0;
  const queueShowBadge = device.queueStatus != null;
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
      {signalPulseKey !== null && (
        <SignalPropagation
          key={signalPulseKey}
          phraseSeed={signalPulseKey}
          protocol={protocol}
          onComplete={handleSignalPulseComplete}
        />
      )}
      <div className="bg-app-bg flex h-screen w-screen min-w-0 flex-col overflow-hidden">
        {/* Header - full width; sidebar + main start below */}
        <div
          role="banner"
          className={`bg-deep-black relative flex w-full items-center border-b py-2 pr-4 ${
            isConfigured
              ? protocol === 'meshcore'
                ? 'border-cyan-500/20'
                : 'border-brand-green/20'
              : 'border-gray-700'
          }`}
        >
          <h1 className="sr-only">Mesh Client</h1>
          {/* Sidebar-area branding — top-left cell, matches sidebar width */}
          <div
            aria-hidden={false}
            className={`bg-deep-black -my-2 flex shrink-0 items-center justify-center self-stretch border-r border-slate-800 transition-[width] duration-300 select-none ${
              sidebarCollapsed ? 'w-16' : 'w-48'
            }`}
          >
            {sidebarCollapsed ? (
              <div className="cm-watermark cm-watermark-collapsed">
                <button
                  type="button"
                  className="m-0 inline-flex cursor-pointer appearance-none border-0 bg-transparent p-0"
                  aria-label={t('aria.playAnimation')}
                  onClick={handleCollapsedWatermarkActivate}
                >
                  <ColoradoMeshWatermarkMark />
                </button>
                <span className="cm-watermark-text" aria-hidden>
                  Colorado Mesh
                </span>
              </div>
            ) : (
              <button
                type="button"
                aria-busy={meshTubePhase !== 'idle'}
                aria-pressed={meshTubeLit}
                aria-label={
                  meshTubeLit ? 'Turn off Colorado Mesh sign' : 'Turn on Colorado Mesh sign'
                }
                className={[
                  'cm-watermark cm-watermark-expanded cm-watermark-mesh-tube',
                  meshTubePhase === 'flicker-on' && 'cm-watermark-mesh-tube--flicker-on',
                  meshTubePhase === 'flicker-off' && 'cm-watermark-mesh-tube--flicker-off',
                  meshTubeLit && meshTubePhase === 'idle' && 'cm-watermark-mesh-tube--lit',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={handleMeshTubeToggle}
              >
                <ColoradoMeshWatermarkMark />
                <span className="cm-watermark-text">Colorado Mesh</span>
              </button>
            )}
          </div>
          <div className="flex min-w-0 flex-1 justify-start pl-8">
            {/* Protocol context switcher — centered in the gap (narrow) or viewport (xl+ grid) */}
            <div
              role="group"
              aria-label={t('aria.protocolSwitcher')}
              className="flex shrink-0 items-center overflow-hidden rounded-full border border-gray-600 font-mono text-xs"
            >
              <button
                type="button"
                aria-pressed={protocol === 'meshtastic'}
                aria-label={t('aria.switchToMeshtastic')}
                onClick={() => {
                  handleProtocolChange('meshtastic');
                }}
                className={`px-3 py-0.5 transition-colors ${
                  protocol === 'meshtastic'
                    ? 'bg-brand-green/20 text-brand-green'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-300'
                }`}
              >
                Meshtastic
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
                aria-label={t('aria.switchToMeshCore')}
                onClick={() => {
                  handleProtocolChange('meshcore');
                }}
                className={`px-3 py-0.5 transition-colors ${
                  protocol === 'meshcore'
                    ? 'bg-cyan-600/20 text-cyan-400'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-300'
                }`}
              >
                MeshCore
                {meshcoreUnread > 0 && protocol !== 'meshcore' && (
                  <span className="ml-1.5 inline-flex h-4 min-w-[1.1rem] animate-pulse items-center justify-center rounded-full bg-cyan-600/30 px-0.5 text-[10px] font-bold text-cyan-400">
                    {meshcoreUnread > 99 ? '99+' : meshcoreUnread}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-2">
            {capabilities.hasTakPanel && (
              <div className="mr-3 flex items-center gap-1.5 border-r border-gray-700 pr-3">
                <TakStatusIcon variant={takVariant} />
                <span
                  aria-label={
                    takClientLoss && takStatus.running
                      ? t('app.takClientLost')
                      : takStatus.running
                        ? t('app.takServerRunning')
                        : t('app.takServerStopped')
                  }
                  className={`text-xs ${headerTextClass(takVariant)}`}
                >
                  {takClientLoss && takStatus.running
                    ? t('app.takClientLost')
                    : takStatus.running
                      ? t('app.takRunning')
                      : t('app.takStopped')}
                </span>
              </div>
            )}
            <div className="mr-3 flex items-center gap-1.5 border-r border-gray-700 pr-3">
              <MqttGlobeIcon variant={mqttVariant} />
              <span
                aria-label={
                  device.mqttStatus === 'connected'
                    ? t('app.mqttConnected')
                    : device.mqttStatus === 'connecting'
                      ? t('app.mqttConnecting')
                      : device.mqttStatus === 'error' || mqttLoss
                        ? t('app.mqttError')
                        : t('app.mqttDisconnected')
                }
                className={`text-xs ${headerTextClass(mqttVariant)}`}
              >
                {device.mqttStatus === 'connected'
                  ? t('app.mqttConnected')
                  : device.mqttStatus === 'connecting'
                    ? t('app.mqttConnecting')
                    : device.mqttStatus === 'error' || mqttLoss
                      ? t('app.mqttError')
                      : t('app.mqttDisconnected')}
              </span>
            </div>
            {isConnectedOrOperational && <LinkIcon className="h-4 w-4" aria-hidden="true" />}
            <div
              className={`h-2.5 w-2.5 rounded-full ${headerDotClass(deviceVariant)}`}
              aria-hidden="true"
              title={deviceConnectionStatusLabel(t, device.state.status)}
            />
            <div role="status" aria-live="polite" aria-atomic="true">
              <span
                aria-label={`${deviceConnectionStatusLabel(t, device.state.status)}${device.state.connectionType ? ` (${device.state.connectionType.toUpperCase()})` : ''}`}
                className={`text-xs ${headerTextClass(deviceVariant)}`}
              >
                {deviceConnectionStatusLabel(t, device.state.status)}
                {device.state.connectionType
                  ? ` (${device.state.connectionType.toUpperCase()})`
                  : ''}
              </span>
            </div>
            {device.state.myNodeNum > 0 && (
              <span
                aria-label={t('app.nodeLabel', {
                  name: device.getPickerStyleNodeLabel(device.state.myNodeNum),
                })}
                className="text-muted ml-2 text-xs whitespace-nowrap"
              >
                {t('app.nodeLabel', {
                  name: device.getPickerStyleNodeLabel(device.state.myNodeNum),
                })}
              </span>
            )}
            {/* Queue status badge: 0–10 used = green, 11–14 = yellow, 15–16 = red */}
            {queueShowBadge && device.queueStatus && (
              <HelpTooltip
                text={
                  protocol === 'meshcore'
                    ? t('app.meshcoreQueueTooltip')
                    : t('app.meshtasticQueueTooltip')
                }
              >
                <div
                  aria-label={`Q: ${queueUsed}/${device.queueStatus.maxlen}`}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${queueColorClass}`}
                >
                  Q: {queueUsed}/{device.queueStatus.maxlen}
                </div>
              </HelpTooltip>
            )}
            <LanguageSelector />
          </div>
        </div>

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
              aria-label={t('common.dismiss')}
              className="shrink-0 rounded border border-gray-600 px-2 py-1 text-xs font-medium text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-300"
            >
              {t('common.dismiss')}
            </button>
          </div>
        )}

        <div className="flex min-h-0 min-w-0 flex-1">
          {/* Sidebar - collapsible width on left */}
          <nav
            aria-label={t('aria.applicationPanels')}
            className={`bg-deep-black flex h-full min-h-0 shrink-0 flex-col border-r border-slate-800 transition-[width] duration-300 ${
              sidebarCollapsed ? 'w-16' : 'w-48'
            }`}
          >
            <Sidebar
              tabs={displayTabLabels}
              tabSlotIds={tabSlotIds}
              active={activeTab}
              onChange={setActiveTab}
              chatUnread={protocol === 'meshtastic' ? meshtasticUnread : meshcoreUnread}
              collapsed={sidebarCollapsed}
              onToggle={handleSidebarToggle}
            />
          </nav>

          {/* Main column: viewport + footer */}
          <main className="bg-app-bg flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {/* Main Viewport - scrollable panel area */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {/* Scroll container - no padding so scrollbars pin to viewport edges */}
              <div ref={mainViewportRef} className="bg-app-bg h-full w-full overflow-auto">
                {/* Content wrapper - padding lives here, not on the scroll container */}
                <div className="h-full min-h-full min-w-0 px-8 pt-8 pb-8">
                  <ErrorBoundary>
                    <div
                      id="panel-0"
                      role="tabpanel"
                      aria-labelledby="tab-0"
                      hidden={activePanelIndex !== 0}
                      className="w-full min-w-0"
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
                            firmwareCheckState={
                              protocol === 'meshtastic' ? firmwareCheckState : undefined
                            }
                            onOpenFirmwareReleases={
                              protocol === 'meshtastic'
                                ? () => {
                                    void window.electronAPI.update.openReleases(
                                      firmwareCheckState.releaseUrl ??
                                        MESHTASTIC_FIRMWARE_RELEASES_URL,
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
                            onAutoConnect={meshcoreDevice.connectAutomatic}
                            onDisconnect={meshcoreDevice.disconnect}
                            mqttStatus={meshcoreDevice.mqttStatus}
                            myNodeLabel={
                              meshcoreDevice.state.myNodeNum > 0
                                ? meshcoreDevice.getPickerStyleNodeLabel(
                                    meshcoreDevice.state.myNodeNum,
                                  )
                                : undefined
                            }
                            protocol="meshcore"
                            firmwareCheckState={
                              protocol === 'meshcore' ? firmwareCheckState : undefined
                            }
                            onOpenFirmwareReleases={
                              protocol === 'meshcore'
                                ? () => {
                                    void window.electronAPI.update.openReleases(
                                      firmwareCheckState.releaseUrl ??
                                        MESHCORE_FIRMWARE_RELEASES_URL,
                                    );
                                  }
                                : undefined
                            }
                          />
                        </div>
                      </Suspense>
                    </div>
                    {(activePanelIndex === 1 || chatTabVisited) && (
                      <div
                        id="panel-1"
                        role="tabpanel"
                        aria-labelledby="tab-1"
                        hidden={activePanelIndex !== 1}
                        className="h-full w-full min-w-0"
                      >
                        <Suspense fallback={<PanelSkeleton />}>
                          <ChatPanel
                            key={protocol}
                            messages={chatMessagesForPanel}
                            channels={chatChannelsForPanel}
                            myNodeNum={device.selfNodeId}
                            ownNodeIds={
                              protocol === 'meshtastic'
                                ? Array.from(
                                    new Set(
                                      [
                                        device.selfNodeId,
                                        meshtasticDevice.virtualNodeId,
                                        meshtasticDevice.lastRfSelfNodeId,
                                      ].filter((id) => id > 0),
                                    ),
                                  )
                                : [device.selfNodeId].filter((id) => id > 0)
                            }
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
                            protocol={protocol}
                            scrollToTopRef={scrollToTopChatRef}
                            outerScrollMetricsRootRef={mainViewportRef}
                            compactMode={chatCompactMode}
                            onFetchStoreForwardHistory={
                              protocol === 'meshtastic'
                                ? () =>
                                    meshtasticDevice.requestStoreForwardHistory({ manual: true })
                                : undefined
                            }
                          />
                        </Suspense>
                      </div>
                    )}
                    <div
                      id="panel-2"
                      role="tabpanel"
                      aria-labelledby="tab-2"
                      hidden={activePanelIndex !== 2}
                      className="w-full min-w-0"
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
                            onSendAdvert={
                              protocol === 'meshcore' ? meshcoreDevice.sendAdvert : undefined
                            }
                            meshcoreRadioOperational={isOperational}
                            onShowOnMap={handleShowOnMap}
                          />
                        </Suspense>
                      ) : null}
                    </div>
                    <div
                      id="panel-3"
                      role="tabpanel"
                      aria-labelledby="tab-3"
                      hidden={activePanelIndex !== 3}
                      className="h-full w-full min-w-0"
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
                              onNodeClick={setSelectedNodeId}
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
                      className="w-full min-w-0"
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
                              meshtasticLoraConfig={
                                protocol === 'meshtastic' ? device.loraConfig : undefined
                              }
                              onApplyChannelSet={
                                protocol === 'meshtastic' ? device.applyChannelSet : undefined
                              }
                              isConnected={isOperational}
                              telemetryDeviceUpdateInterval={device.telemetryDeviceUpdateInterval}
                              deviceFixedPosition={device.deviceFixedPosition}
                              onReboot={
                                protocol === 'meshcore'
                                  ? () => meshcoreDevice.reboot()
                                  : device.reboot
                              }
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
                                protocol === 'meshcore'
                                  ? meshcoreContactsShowRefreshControl
                                  : undefined
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
                      className="w-full min-w-0"
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
                              meshcoreCanPingTrace={meshcoreDevice.meshcoreCanPingTrace}
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
                              onToggleFavorite={meshcoreDevice.setNodeFavorited}
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
                      className="w-full min-w-0"
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
                              meshcorePacketStats={
                                protocol === 'meshcore' ? meshcoreDevice.meshcoreLocalStats : null
                              }
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
                      className="w-full min-w-0"
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
                              onSignData={
                                protocol === 'meshcore' ? meshcoreDevice.signData : undefined
                              }
                              onExportPrivateKey={
                                protocol === 'meshcore'
                                  ? meshcoreDevice.exportPrivateKey
                                  : undefined
                              }
                              onImportPrivateKey={
                                protocol === 'meshcore'
                                  ? meshcoreDevice.importPrivateKey
                                  : undefined
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
                      className="w-full min-w-0"
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
                      className="w-full min-w-0"
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
                                  console.debug(
                                    '[App] persist logPanelVisible ' + errLikeToLogString(e),
                                  );
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
                                protocol === 'meshcore'
                                  ? meshcoreDevice.clearAllRepeaters
                                  : undefined
                              }
                              onAutoFloodAdvertIntervalChange={setAutoFloodAdvertIntervalHours}
                              onChatCompactModeChange={handleChatCompactModeChange}
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
                      className="w-full min-w-0"
                    >
                      {activePanelIndex === 10 ? (
                        <ErrorBoundary>
                          <Suspense fallback={<PanelSkeleton />}>
                            <DiagnosticsPanel
                              nodes={nodesForDiagnostics}
                              meshcoreNodes={meshcoreDevice.nodes}
                              myNodeNum={device.selfNodeId}
                              meshtasticListenerNodeId={
                                meshtasticDevice.state.myNodeNum > 0
                                  ? meshtasticDevice.state.myNodeNum
                                  : meshtasticDevice.selfNodeId
                              }
                              onTraceRoute={device.traceRoute}
                              isConnected={isOperational}
                              traceRouteResults={device.traceRouteResults}
                              getFullNodeLabel={device.getFullNodeLabel}
                              ourPosition={device.ourPosition}
                              onNodeClick={(node) => {
                                setSelectedNodeId(node.node_id);
                              }}
                              capabilities={capabilities}
                              protocol={protocol}
                            />
                          </Suspense>
                        </ErrorBoundary>
                      ) : null}
                    </div>
                    <div
                      id="panel-11"
                      role="tabpanel"
                      aria-labelledby="tab-11"
                      hidden={activePanelIndex !== 11}
                      className="w-full min-w-0"
                    >
                      {activePanelIndex === 11 && capabilities.hasRawPacketLog ? (
                        <ErrorBoundary>
                          <Suspense fallback={<PanelSkeleton />}>
                            <div className="p-4">
                              {protocol === 'meshcore' ? (
                                <PacketDistributionPanel
                                  variant="meshcore"
                                  packets={meshcoreDevice.rawPackets}
                                  getNodeLabel={rawPacketGetNodeLabel}
                                />
                              ) : (
                                <PacketDistributionPanel
                                  variant="meshtastic"
                                  packets={meshtasticDevice.rawPackets}
                                  getNodeLabel={rawPacketGetNodeLabel}
                                />
                              )}
                              {protocol !== 'meshcore' && (
                                <ChannelUtilizationChart nodes={nodesForUi} protocol={protocol} />
                              )}
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                      ) : null}
                    </div>
                    <div
                      id="panel-12"
                      role="tabpanel"
                      aria-labelledby="tab-12"
                      hidden={activePanelIndex !== 12}
                      className="w-full min-w-0"
                    >
                      {activePanelIndex === 12 && capabilities.hasRawPacketLog ? (
                        <ErrorBoundary>
                          <Suspense fallback={<PanelSkeleton />}>
                            {protocol === 'meshcore' ? (
                              <RawPacketLogPanel
                                variant="meshcore"
                                packets={meshcoreDevice.rawPackets}
                                onClear={meshcoreDevice.clearRawPackets}
                                getNodeLabel={rawPacketGetNodeLabel}
                                onNodeClick={setSelectedNodeId}
                              />
                            ) : (
                              <RawPacketLogPanel
                                variant="meshtastic"
                                packets={meshtasticDevice.rawPackets}
                                onClear={meshtasticDevice.clearRawPackets}
                                getNodeLabel={rawPacketGetNodeLabel}
                                onNodeClick={setSelectedNodeId}
                              />
                            )}
                          </Suspense>
                        </ErrorBoundary>
                      ) : null}
                    </div>
                    <div
                      id="panel-13"
                      role="tabpanel"
                      aria-labelledby="tab-13"
                      hidden={activePanelIndex !== 13}
                      className="w-full min-w-0"
                    >
                      {activePanelIndex === 13 ? (
                        <ErrorBoundary>
                          <Suspense fallback={<PanelSkeleton />}>
                            <RFHistogramsPanel nodes={nodesForUi} />
                          </Suspense>
                        </ErrorBoundary>
                      ) : null}
                    </div>
                    <div
                      id="panel-14"
                      role="tabpanel"
                      aria-labelledby="tab-14"
                      hidden={activePanelIndex !== 14}
                      className="w-full min-w-0"
                      style={{ height: 'calc(100vh - 140px)' }}
                    >
                      {activePanelIndex === 14 ? (
                        <ErrorBoundary>
                          <Suspense fallback={<PanelSkeleton />}>
                            <PeerGraphPanel
                              nodes={nodesForUi}
                              myNodeId={device.selfNodeId}
                              onNodeClick={setSelectedNodeId}
                            />
                          </Suspense>
                        </ErrorBoundary>
                      ) : null}
                    </div>
                  </ErrorBoundary>
                </div>
              </div>
            </div>

            {showMainScrollTop && activePanelIndex !== 1 && (
              <button
                type="button"
                onClick={scrollMainToTop}
                className="bg-brand-green text-deep-black hover:bg-bright-green fixed right-28 bottom-12 z-50 rounded-full px-3 py-2 text-xs font-bold shadow-lg transition-colors"
                title={t('aria.backToTop')}
                aria-label={t('aria.backToTop')}
              >
                ↑ Top
              </button>
            )}

            {/* Footer - fixed height at bottom of Content Wrapper */}
            <footer className="text-muted bg-deep-black flex h-8 shrink-0 items-center justify-between border-t border-slate-800 px-4 text-[10px]">
              <span className="min-w-0">
                {t('app.footerSlogan')}{' '}
                <a
                  href="https://discord.com/invite/McChKR5NpS"
                  title="Colorado Mesh Discord"
                  className="text-slate-400 underline decoration-slate-600/80 underline-offset-2 transition-colors hover:text-slate-300"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('common.discord')}
                </a>
                {' • '}
                <a
                  href="https://github.com/Colorado-Mesh/mesh-client"
                  title="Colorado Mesh on GitHub"
                  className="text-slate-400 underline decoration-slate-600/80 underline-offset-2 transition-colors hover:text-slate-300"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('common.github')}
                </a>
                {' • '}
                <a
                  href="https://coloradomesh.org/"
                  title="Colorado Mesh website"
                  className="text-slate-400 underline decoration-slate-600/80 underline-offset-2 transition-colors hover:text-slate-300"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('common.website')}
                </a>
              </span>
              <span className="inline-flex flex-wrap items-center justify-end gap-2 justify-self-end text-right font-mono text-[10px] whitespace-nowrap tabular-nums">
                <span>
                  {t('app.footerStats', {
                    nodeCount: nodesForUi.size,
                    nodeLabel: nodeCountLabel,
                    messageCount: device.messages.length,
                  })}
                </span>
                <UpdateStatusIndicator
                  updateState={updateState}
                  onCheck={() => {
                    void window.electronAPI.update.check().catch((e: unknown) => {
                      console.warn('[App] update check failed ' + errLikeToLogString(e));
                      setUpdateState((s) => ({ ...s, phase: 'error' }));
                    });
                  }}
                  onDownload={() => window.electronAPI.update.download()}
                  onInstall={() => window.electronAPI.update.install()}
                  onViewRelease={() =>
                    window.electronAPI.update.openReleases(updateState.releaseUrl)
                  }
                />
              </span>
            </footer>
          </main>
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
                console.debug('[App] persist logPanelVisible ' + errLikeToLogString(e));
              }
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
            nodes={detailModalNodes}
            node={selectedNode}
            onClose={() => {
              setSelectedNodeId(null);
            }}
            onRequestPosition={device.requestPosition}
            onTraceRoute={
              detailModalProtocol === 'meshcore' ? meshcoreDevice.traceRoute : device.traceRoute
            }
            traceRouteHops={traceRouteHops}
            onDeleteNode={async (nodeNum) => {
              await device.deleteNode(nodeNum);
              setSelectedNodeId(null);
            }}
            onMessageNode={
              selectedNode?.node_id !== detailMyNodeNum ? handleMessageNode : undefined
            }
            onToggleFavorite={device.setNodeFavorited}
            isConnected={isOperational}
            homeNode={detailHomeNode}
            neighborInfo={device.neighborInfo}
            useFahrenheit={useFahrenheit}
            protocol={detailModalProtocol}
            meshcoreTraceResult={
              detailModalProtocol === 'meshcore' && selectedNode
                ? meshcoreDevice.meshcoreTraceResults.get(selectedNode.node_id)
                : undefined
            }
            meshcorePingError={
              detailModalProtocol === 'meshcore' && selectedNode
                ? meshcoreDevice.meshcorePingErrors.get(selectedNode.node_id)
                : undefined
            }
            meshcoreRepeaterStatus={
              detailModalProtocol === 'meshcore' && selectedNode
                ? meshcoreDevice.meshcoreNodeStatus.get(selectedNode.node_id)
                : undefined
            }
            onRequestRepeaterStatus={
              detailModalProtocol === 'meshcore' ? meshcoreDevice.requestRepeaterStatus : undefined
            }
            meshcoreNodeTelemetry={
              detailModalProtocol === 'meshcore' && selectedNode
                ? meshcoreDevice.meshcoreNodeTelemetry.get(selectedNode.node_id)
                : undefined
            }
            onRequestTelemetry={
              detailModalProtocol === 'meshcore' ? meshcoreDevice.requestTelemetry : undefined
            }
            meshcoreNeighbors={
              detailModalProtocol === 'meshcore' && selectedNode
                ? meshcoreDevice.meshcoreNeighbors.get(selectedNode.node_id)
                : undefined
            }
            onRequestNeighbors={
              detailModalProtocol === 'meshcore' ? meshcoreDevice.requestNeighbors : undefined
            }
            meshcoreNeighborError={
              detailModalProtocol === 'meshcore' && selectedNode
                ? meshcoreDevice.meshcoreNeighborErrors.get(selectedNode.node_id)
                : undefined
            }
            paxCounterData={
              detailModalProtocol === 'meshtastic' ? device.paxCounterData : undefined
            }
            detectionSensorEvents={
              detailModalProtocol === 'meshtastic' ? device.detectionSensorEvents : undefined
            }
            mapReports={detailModalProtocol === 'meshtastic' ? device.mapReports : undefined}
            onExportContact={
              detailModalProtocol === 'meshcore' ? meshcoreDevice.exportContact : undefined
            }
            onShareContact={
              detailModalProtocol === 'meshcore' ? meshcoreDevice.shareContact : undefined
            }
            meshcoreLocalStats={
              detailModalProtocol === 'meshcore' &&
              selectedNode?.node_id === meshcoreDevice.state.myNodeNum
                ? meshcoreDevice.meshcoreLocalStats
                : null
            }
            meshcoreManufacturerModel={
              detailModalProtocol === 'meshcore'
                ? meshcoreDevice.state.manufacturerModel
                : undefined
            }
            positionHistory={selectedNodeHistory}
            onShowOnMap={handleShowOnMap}
          />
        </Suspense>
      )}
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
  const { t } = useTranslation();
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
          t('toasts.newMessages', { protocol: 'Meshtastic', count: realNew.length }),
          'info',
          6000,
        );
      }
    }
    prevMeshtasticRef.current = count;
  }, [meshtasticDevice.messages, protocol, addToast, t]);

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
          t('toasts.newMessages', { protocol: 'MeshCore', count: realNew.length }),
          'info',
          6000,
        );
      }
    }
    prevMeshcoreRef.current = count;
  }, [meshcoreDevice.messages, protocol, addToast, t]);

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
  const { t } = useTranslation();
  const { addToast } = useToast();
  const toastShownRef = useRef(false);
  const activeState = protocol === 'meshcore' ? meshcoreState : meshtasticState;

  useEffect(() => {
    const { status, firmwareVersion } = activeState;
    if (status !== 'configured' || !firmwareVersion) return;

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
          addToast(t('toasts.firmwareAvailable', { version: release.version }), 'warning', 8000);
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
  }, [activeState, protocol, onResult, addToast, t]);

  useEffect(() => {
    if (activeState.status === 'disconnected') {
      onResult({ phase: 'idle' });
      toastShownRef.current = false;
    }
  }, [activeState.status, onResult, toastShownRef]);

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
