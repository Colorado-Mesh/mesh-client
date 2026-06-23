/* eslint-disable react-hooks/set-state-in-effect */
/**
 * App mount effect graph (order-sensitive):
 * 1. Identity / connection hydration and startup DB prune (`useAppStartupDbPrune`)
 * 2. Protocol MQTT auto-launch and tab-scoped disconnect
 * 3. Unread + tray badge sync (`useAppTrayUnreadSync`)
 * 4. Power recovery (`usePowerRecovery` in AppShell)
 */
import { Crosshair } from 'lucide-react-motion';
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

import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '@/renderer/hooks/meshcore/meshcoreHookPreamble';
import { resolveInactiveChatNotificationType } from '@/renderer/lib/chatInactiveNotifications';
import {
  clearPersistedLastReadForProtocol,
  clearPersistedRoomsLastRead,
  ensureMeshcoreChatLastReadSanitized,
  getSanitizedMeshcoreChatLastRead,
  getSanitizedMeshcoreRoomsLastRead,
  loadMutedViews,
  loadPersistedLastReadInitial,
  removePersistedLastReadForChannel,
  subscribeMutedViewsChanged,
  subscribePersistedLastRead,
  subscribePersistedRoomsLastRead,
} from '@/renderer/lib/chatPanelProtocolStorage';
import { type ChatUnreadDmOptions, totalUnreadCount } from '@/renderer/lib/chatUnreadCounts';
import { setDebugSnapshotUiContext } from '@/renderer/lib/debugSnapshotUiContext';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { MessageClearRefreshOptions } from '@/renderer/lib/hydrateIdentityStoresFromDb';
import { MqttGlobeIcon } from '@/renderer/lib/icons/connectionIcons';
import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import { persistMeshcoreSelfNodeId } from '@/renderer/lib/meshcoreLastSelfNodeId';
import { resolveMeshcoreOwnNodeIdSet } from '@/renderer/lib/meshcoreOwnNodeIds';
import { totalRoomsUnreadCount } from '@/renderer/lib/meshcoreRoomsUnread';
import { meshtasticMqttOwnNodeIds } from '@/renderer/lib/meshtasticMqttIdentity';
import { remoteConfigChannelRetryRoute } from '@/renderer/lib/meshtasticRemoteAdminSnapshot';
import { Z_NODE_DETAIL_MODAL } from '@/renderer/lib/modalZIndex';
import { createUpdateMenuNotifyController } from '@/renderer/lib/updateMenuNotifyController';
import type { UpdateCheckingPayload } from '@/shared/electron-api.types';

import BootSequence from './components/BootSequence';
import ChannelUtilizationChart from './components/ChannelUtilizationChart';
import ConfigureNodeSelector from './components/ConfigureNodeSelector';
import ErrorBoundary from './components/ErrorBoundary';
import { HelpTooltip } from './components/HelpTooltip';
import LanguageSelector from './components/LanguageSelector';
import RemoteAdminErrorNotifier from './components/RemoteAdminErrorNotifier';
import Sidebar from './components/Sidebar';
import { LinkIcon } from './components/SignalBars';
import { ToastProvider, useToast } from './components/Toast';
import UpdateStatusIndicator from './components/UpdateStatusIndicator';
import { useActiveMeshIdentity } from './hooks/useActiveMeshIdentity';
import { useAppStartupDbPrune } from './hooks/useAppStartupDbPrune';
import { useAppTrayUnreadSync } from './hooks/useAppTrayUnreadSync';
import { useConnectionView } from './hooks/useConnectionView';
import { useContactGroups } from './hooks/useContactGroups';
import { useProtocolDbRefresh } from './hooks/useDbRefresh';
import { useDualProtocolPanelActions } from './hooks/useDualProtocolPanelActions';
import { useMeshcoreDistanceFilterHint } from './hooks/useMeshcoreDistanceFilterHint';
import { useMessages } from './hooks/useMessages';
import { useNodeStatusNotifier } from './hooks/useNodeStatusNotifier';
import { useNowMs } from './hooks/useNowMs';
import { usePowerRecovery } from './hooks/usePowerRecovery';
import {
  useProtocolConnect,
  useProtocolConnectionActions,
  useProtocolDisconnect,
} from './hooks/useProtocolConnection';
import { useProtocolFacade } from './hooks/useProtocolFacade';
import { useSendMessage } from './hooks/useSendMessage';
import { useSpellcheckReplaceSync } from './hooks/useSpellcheckReplaceSync';
import { useTakServer } from './hooks/useTakServer';
import { ChatPanel, ConnectionPanel, LogPanel, NodeListPanel } from './lazyAppPanels';
import { ContactGroupsModal, NodeDetailModal } from './lazyModals';
import {
  AdminPanel,
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
  RoomsPanel,
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
import { connectionDriver } from './lib/drivers/ConnectionDriver';
import {
  fetchLatestMeshCoreRelease,
  fetchLatestMeshtasticRelease,
  type FirmwareCheckResult,
  MESHCORE_FIRMWARE_RELEASES_URL,
  MESHTASTIC_FIRMWARE_RELEASES_URL,
  parseMeshCoreBuildDate,
  semverGt,
} from './lib/firmwareCheck';
import { loadLastConnection } from './lib/lastConnectionStorage';
import { generateLetsMeshAuthToken, readMeshcoreIdentityAsync } from './lib/letsMeshJwt';
import { meshcoreChatMessagesForDisplay } from './lib/meshcoreChannelText';
import {
  meshcoreRoomServerIdsFromNodes,
  repairMeshcoreHydratedMessages,
} from './lib/meshcoreDbCacheHydration';
import { syncMeshcoreDisplayReplyRepairs } from './lib/meshcoreStoreDedup';
import { pubkeyToNodeId } from './lib/meshcoreUtils';
import { meshNodeStubForDetailModal } from './lib/meshNodeStubForDetail';
import {
  shouldAutoLaunchMeshtasticMqtt,
  shouldMaintainMeshtasticMqttConnection,
} from './lib/meshtasticMqttLiveIngest';
import { tryAutoLaunchMqtt } from './lib/mqttAutoLaunch';
import { nodeLabelForRawPacket } from './lib/nodeLongNameOrHex';
import { ensureOfflineProtocolIdentities } from './lib/offlineProtocolIdentities';
import { parseStoredJson } from './lib/parseStoredJson';
import type { ProtocolCapabilities } from './lib/radio/BaseRadioProvider';
import { useRadioProvider } from './lib/radio/providerFactory';
import { repairMeshtasticReplyPreviews } from './lib/replyPreview';
import { logRfReconnectFailure, reconnectRfFromLastConnection } from './lib/rfReconnectHelper';
import { getStoredMeshProtocol, MESH_PROTOCOL_STORAGE_KEY } from './lib/storedMeshProtocol';
import {
  messageRecordsToChatMessages,
  nodeRecordsToMeshNodeMap,
  nodeRecordToMeshNode,
} from './lib/storeRecordAdapters';
import { applyThemeColors, loadThemeColors } from './lib/themeColors';
import type {
  ChatMessage,
  ConfigTargetContext,
  DeviceState,
  MeshNode,
  MeshProtocol,
} from './lib/types';
import { MeshcoreRuntimeProvider } from './runtime/MeshcoreRuntimeContext';
import { MeshtasticRuntimeProvider } from './runtime/MeshtasticRuntimeContext';
import { useMeshcoreRuntime } from './runtime/useMeshcoreRuntime';
import { useMeshtasticRuntime } from './runtime/useMeshtasticRuntime';
import { useDiagnosticsStore } from './stores/diagnosticsStore';
import { useIdentityStore } from './stores/identityStore';
import { useMapLayerStore } from './stores/mapLayerStore';
import { useMapViewportStore } from './stores/mapViewportStore';
import { useNodeStore } from './stores/nodeStore';
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
  undefined, // Admin
  'hasRoomServersPanel', // Rooms
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

import { TAB_SLOT_IDS, type TabIconSlotId } from '@/renderer/lib/tabSlotIds';

const MAP_TAB_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Map');
const ROOMS_PANEL_INDEX = TAB_SLOT_IDS.indexOf('Rooms');

function tabLabelKey(capabilities: ProtocolCapabilities, panelIndex: number): `tabs.${string}` {
  if (panelIndex === 2 && capabilities.nodeListTabUsesContactsLabel) return 'tabs.contacts';
  if (panelIndex === 5 && capabilities.modulesTabUsesRepeatersLabel) return 'tabs.repeaters';
  if (panelIndex === 7 && capabilities.hasRoomServersPanel) return 'tabs.rooms';
  return `tabs.${TAB_SLOT_IDS[panelIndex].toLowerCase()}`;
}

function tabIconSlotId(capabilities: ProtocolCapabilities, panelIndex: number): TabIconSlotId {
  if (panelIndex === 5 && capabilities.modulesTabUsesRepeatersLabel) return 'Repeaters';
  return TAB_SLOT_IDS[panelIndex];
}

function computeTabMappings(
  translate: ReturnType<typeof useTranslation>['t'],
  targetProtocol: MeshProtocol,
  targetCapabilities: ProtocolCapabilities,
) {
  const filtered: { label: string; slotId: TabIconSlotId; panelIndex: number }[] = [];
  TAB_SLOT_IDS.forEach((_slot, panelIndex) => {
    const requiredCap = TAB_CAPABILITY_REQUIREMENTS[panelIndex];
    if (requiredCap !== undefined && !targetCapabilities[requiredCap]) return;
    filtered.push({
      label: translate(tabLabelKey(targetCapabilities, panelIndex)),
      slotId: tabIconSlotId(targetCapabilities, panelIndex),
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
      className="fixed inset-0 flex items-center justify-center bg-black/40"
      style={{ zIndex: Z_NODE_DETAIL_MODAL }}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">{t('app.loadingDialog')}</span>
      <div className="h-10 w-10 animate-pulse rounded-full bg-gray-600" aria-hidden />
    </div>
  );
}

function TakStatusIcon({ variant }: { variant: ReturnType<typeof takHeaderVariant> }) {
  const trigger = useIconTrigger();
  return (
    <Crosshair
      aria-hidden
      className={`${ICON_MD} ${headerIconClass(variant)}`}
      trigger={trigger}
      size={16}
    />
  );
}

function HeaderMqttGlobeIcon({ variant }: { variant: ReturnType<typeof mqttHeaderVariant> }) {
  return <MqttGlobeIcon className={`${ICON_MD} ${headerIconClass(variant)}`} />;
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
  const meshtasticRuntime = useMeshtasticRuntime();
  const meshcoreRuntime = useMeshcoreRuntime();
  return (
    <MeshtasticRuntimeProvider value={meshtasticRuntime}>
      <MeshcoreRuntimeProvider value={meshcoreRuntime}>
        <AppContent meshtasticRuntime={meshtasticRuntime} meshcoreRuntime={meshcoreRuntime} />
      </MeshcoreRuntimeProvider>
    </MeshtasticRuntimeProvider>
  );
}

function AppContent({
  meshtasticRuntime,
  meshcoreRuntime,
}: {
  meshtasticRuntime: ReturnType<typeof useMeshtasticRuntime>;
  meshcoreRuntime: ReturnType<typeof useMeshcoreRuntime>;
}) {
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
  const [pendingRoomTarget, setPendingRoomTarget] = useState<number | null>(null);
  const [lastReadRevision, setLastReadRevision] = useState({ meshtastic: 0, meshcore: 0 });
  const [roomsLastReadRevision, setRoomsLastReadRevision] = useState(0);
  const [meshcoreMutedViewsRevision, setMeshcoreMutedViewsRevision] = useState(0);
  const [logPanelVisible, setLogPanelVisible] = useState(readLogPanelVisible);
  const prevMeshtasticMsgCountRef = useRef(0);
  const prevMeshcoreMsgCountRef = useRef(0);
  const isMeshtasticInitialRef = useRef(true);
  const isMeshcoreInitialRef = useRef(true);
  const mainViewportRef = useRef<HTMLDivElement>(null);
  const activePanelIndexRef = useRef(0);
  const scrollToTopChatRef = useRef<(() => void) | null>(null);
  const scrollToTopRoomsRef = useRef<(() => void) | null>(null);
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
  const [autoFloodAdvertType, setAutoFloodAdvertType] = useState<'flood' | 'zeroHop'>(() => {
    const parsed = parseStoredJson<{ autoFloodAdvertType?: string }>(
      getAppSettingsRaw(),
      'App autoFloodAdvertType init',
    );
    return parsed?.autoFloodAdvertType === 'zeroHop' ? 'zeroHop' : 'flood';
  });
  const [meshcoreFloodScopeHashtag, setMeshcoreFloodScopeHashtag] = useState(() => {
    const parsed = parseStoredJson<{ meshcoreFloodScopeHashtag?: string }>(
      getAppSettingsRaw(),
      'App meshcoreFloodScopeHashtag init',
    );
    return typeof parsed?.meshcoreFloodScopeHashtag === 'string'
      ? parsed.meshcoreFloodScopeHashtag
      : DEFAULT_APP_SETTINGS_SHARED.meshcoreFloodScopeHashtag;
  });

  // ─── Theme colors (localStorage overrides for @theme tokens) ─────
  useLayoutEffect(() => {
    applyThemeColors(loadThemeColors());
  }, []);

  useEffect(() => {
    void usePathHistoryStore.getState().loadAllFromDb();
  }, []);

  useLayoutEffect(() => {
    ensureOfflineProtocolIdentities();
  }, []);

  const [protocol, setProtocol] = useState<MeshProtocol>(() => getStoredMeshProtocol());

  const protocolConnect = useProtocolConnect();
  const protocolDisconnect = useProtocolDisconnect();
  const meshtasticConnection = useProtocolConnectionActions('meshtastic');
  const meshcoreConnection = useProtocolConnectionActions('meshcore');

  usePowerRecovery({
    meshtastic: {
      onPowerSuspend: meshtasticRuntime.onPowerSuspend,
      onPowerResume: meshtasticRuntime.onPowerResume,
    },
    meshcore: {
      onPowerSuspend: meshcoreRuntime.onPowerSuspend,
      onPowerResume: meshcoreRuntime.onPowerResume,
    },
  });
  useSpellcheckReplaceSync();

  const { meshtastic: meshtasticPanelActions, meshcore: meshcorePanelActions } =
    useDualProtocolPanelActions(meshtasticRuntime, meshcoreRuntime);
  const activeFacade = useProtocolFacade(protocol, {
    meshtastic: meshtasticPanelActions,
    meshcore: meshcorePanelActions,
  });
  const panelActions = activeFacade.panel.actions;
  const {
    meshtasticIdentityId,
    meshcoreIdentityId,
    focusedIdentityId,
    capabilities: activeProtocolCapabilities,
  } = useActiveMeshIdentity(protocol);
  const meshtasticNodesById = useNodeStore((s) =>
    meshtasticIdentityId ? s.nodes[meshtasticIdentityId] : undefined,
  );
  const meshcoreNodesById = useNodeStore((s) =>
    meshcoreIdentityId ? s.nodes[meshcoreIdentityId] : undefined,
  );
  const meshtasticStoreMessages = useMessages(meshtasticIdentityId);
  const meshcoreStoreMessages = useMessages(meshcoreIdentityId);
  const meshtasticUiMessages = useMemo(
    () => repairMeshtasticReplyPreviews(messageRecordsToChatMessages(meshtasticStoreMessages)),
    [meshtasticStoreMessages],
  );
  const meshcoreUiMessages = useMemo(() => {
    const mapped = meshcoreChatMessagesForDisplay(
      messageRecordsToChatMessages(meshcoreStoreMessages),
    );
    if (!meshcoreNodesById) return mapped;
    const roomIds = meshcoreRoomServerIdsFromNodes(
      Object.values(meshcoreNodesById).map(nodeRecordToMeshNode),
    );
    return repairMeshcoreHydratedMessages(mapped, roomIds, meshcoreRuntime.selfNodeId);
  }, [meshcoreStoreMessages, meshcoreNodesById, meshcoreRuntime.selfNodeId]);

  useEffect(() => {
    if (!meshcoreIdentityId) return;
    const timer = window.setTimeout(() => {
      syncMeshcoreDisplayReplyRepairs(
        meshcoreIdentityId,
        meshcoreStoreMessages,
        meshcoreUiMessages,
      );
    }, 500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [meshcoreIdentityId, meshcoreStoreMessages, meshcoreUiMessages]);
  const meshtasticUiNodes = useMemo(() => {
    if (!meshtasticNodesById) return new Map<number, MeshNode>();
    return nodeRecordsToMeshNodeMap(Object.values(meshtasticNodesById));
  }, [meshtasticNodesById]);
  const meshcoreUiNodes = useMemo(() => {
    if (!meshcoreNodesById) return new Map<number, MeshNode>();
    return nodeRecordsToMeshNodeMap(Object.values(meshcoreNodesById));
  }, [meshcoreNodesById]);

  const meshtasticDbRefresh = useProtocolDbRefresh('meshtastic', meshtasticIdentityId);
  const meshcoreDbRefresh = useProtocolDbRefresh('meshcore', meshcoreIdentityId);
  const { refreshAllFromDb: refreshMeshtasticAllFromDb } = meshtasticDbRefresh;
  const { refreshAllFromDb: refreshMeshcoreAllFromDb } = meshcoreDbRefresh;

  useEffect(() => {
    if (!meshtasticIdentityId) return;
    void refreshMeshtasticAllFromDb();
  }, [meshtasticIdentityId, refreshMeshtasticAllFromDb]);

  useEffect(() => {
    if (!meshcoreIdentityId) return;
    void refreshMeshcoreAllFromDb();
  }, [meshcoreIdentityId, refreshMeshcoreAllFromDb]);

  useEffect(() => {
    if (!meshcoreIdentityId) return;
    const selfNum = useIdentityStore.getState().identities[meshcoreIdentityId]?.selfNodeNum;
    if (selfNum != null && selfNum > 0) {
      persistMeshcoreSelfNodeId(selfNum);
    }
  }, [meshcoreIdentityId]);
  const sendMessage = useSendMessage(focusedIdentityId);
  const meshtasticConnectionView = useConnectionView(meshtasticIdentityId);
  const meshcoreConnectionView = useConnectionView(meshcoreIdentityId);

  useMeshcoreDistanceFilterHint(
    protocol,
    meshcoreUiNodes,
    meshcoreConnectionView.state.myNodeNum ?? 0,
    locationFilter.enabled,
  );

  const activeConnectionView = activeFacade.connectionView;
  const activeQueueFromStore = activeFacade.queue;
  const myNodeNumForQueue = activeConnectionView.state.myNodeNum;
  const sendingWindowMs = 30_000;
  const hasMeshtasticSendingRow = useMemo(
    () =>
      protocol === 'meshtastic' &&
      activeFacade.messages.some(
        (m) => m.status === 'sending' && (myNodeNumForQueue <= 0 || m.from === myNodeNumForQueue),
      ),
    [protocol, activeFacade.messages, myNodeNumForQueue],
  );
  const nowMs = useNowMs(hasMeshtasticSendingRow, 5_000);
  const hasLocalSendingMessage = useMemo(() => {
    if (!hasMeshtasticSendingRow || nowMs <= 0) return false;
    return activeFacade.messages.some(
      (m) =>
        m.status === 'sending' &&
        nowMs - m.timestamp <= sendingWindowMs &&
        (myNodeNumForQueue <= 0 || m.from === myNodeNumForQueue),
    );
  }, [hasMeshtasticSendingRow, nowMs, activeFacade.messages, myNodeNumForQueue, sendingWindowMs]);
  const handleSend = useCallback(
    (text: string, channel: number, destination?: number, replyId?: number) => {
      sendMessage(text, channel, destination, replyId != null ? String(replyId) : undefined);
    },
    [sendMessage],
  );
  const { status: takStatus, error: takError, takClientLoss } = useTakServer();
  const contactGroupsSelfId =
    protocol === 'meshcore'
      ? meshcoreRuntime.selfNodeId
      : protocol === 'meshtastic'
        ? meshtasticRuntime.selfNodeId
        : null;
  const contactGroups = useContactGroups(contactGroupsSelfId);
  const [showGroupsModal, setShowGroupsModal] = useState(false);
  /** Shared panel fields; Meshtastic-only access uses {@link meshtasticRuntime} directly. */
  const activeRuntime =
    protocol === 'meshcore'
      ? (meshcoreRuntime as unknown as typeof meshtasticRuntime)
      : meshtasticRuntime;
  const previousDeviceStatusRef = useRef(activeConnectionView.state.status);
  const activeTabRef = useRef(activeTab);
  const protocolRef = useRef(protocol);
  const lastMeshtasticTab = useRef(0);
  const lastMeshcoreTab = useRef(0);
  const lastMeshtasticPanel = useRef<number | null>(null);
  const lastMeshcorePanel = useRef<number | null>(null);
  const meshtasticMsgsRef = useRef(meshtasticUiMessages);
  const meshcoreMsgsRef = useRef(meshcoreUiMessages);
  const meshtasticMyNodeNumRef = useRef(meshtasticRuntime.state.myNodeNum);
  const meshcoreSelfIdRef = useRef(meshcoreRuntime.selfNodeId);
  const nodesForUi = protocol === 'meshcore' ? meshcoreUiNodes : meshtasticUiNodes;
  const activeUiMessages = protocol === 'meshcore' ? meshcoreUiMessages : meshtasticUiMessages;

  useEffect(() => {
    return subscribePersistedLastRead((changedProtocol) => {
      setLastReadRevision((prev) => ({
        ...prev,
        [changedProtocol]: prev[changedProtocol] + 1,
      }));
    });
  }, []);

  useEffect(() => {
    return subscribePersistedRoomsLastRead(() => {
      setRoomsLastReadRevision((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    return subscribeMutedViewsChanged((protocol) => {
      if (protocol === 'meshcore') {
        setMeshcoreMutedViewsRevision((n) => n + 1);
      }
    });
  }, []);

  const meshcoreLastReadSanitizedRef = useRef(false);
  useEffect(() => {
    if (!meshcoreIdentityId || meshcoreLastReadSanitizedRef.current) return;
    if (localStorage.getItem('mesh-client:lastReadSanitized:meshcore') === '1') {
      meshcoreLastReadSanitizedRef.current = true;
      return;
    }
    if (meshcoreUiMessages.length === 0) return;
    ensureMeshcoreChatLastReadSanitized(meshcoreUiMessages);
    meshcoreLastReadSanitizedRef.current = true;
    setLastReadRevision((prev) => ({ ...prev, meshcore: prev.meshcore + 1 }));
  }, [meshcoreIdentityId, meshcoreUiMessages]);

  const meshtasticOwnNodeIdSet = useMemo(() => {
    const ids = meshtasticMqttOwnNodeIds(
      meshtasticRuntime.selfNodeId,
      meshtasticRuntime.virtualNodeId,
      meshtasticRuntime.lastRfSelfNodeId,
    );
    return new Set(ids.filter((id) => id > 0));
  }, [
    meshtasticRuntime.selfNodeId,
    meshtasticRuntime.virtualNodeId,
    meshtasticRuntime.lastRfSelfNodeId,
  ]);

  const meshtasticOwnNodeIdSetRef = useRef(meshtasticOwnNodeIdSet);

  const meshcoreOwnNodeIdSet = useMemo(() => {
    const identitySelfNodeNum =
      meshcoreIdentityId != null
        ? useIdentityStore.getState().identities[meshcoreIdentityId]?.selfNodeNum
        : undefined;
    const connectionMyNodeNum =
      meshcoreIdentityId != null ? meshcoreConnectionView.state.myNodeNum : undefined;
    return resolveMeshcoreOwnNodeIdSet({
      runtimeSelfNodeId: meshcoreRuntime.selfNodeId,
      identitySelfNodeNum,
      connectionMyNodeNum,
    });
  }, [meshcoreConnectionView.state.myNodeNum, meshcoreIdentityId, meshcoreRuntime.selfNodeId]);

  const meshtasticChatUnread = useMemo(() => {
    void lastReadRevision.meshtastic;
    return totalUnreadCount(
      meshtasticUiMessages,
      loadPersistedLastReadInitial('meshtastic'),
      meshtasticOwnNodeIdSet,
      'meshtastic',
    );
  }, [lastReadRevision.meshtastic, meshtasticOwnNodeIdSet, meshtasticUiMessages]);

  const meshcoreChatLastRead = useMemo(() => {
    void lastReadRevision.meshcore;
    return getSanitizedMeshcoreChatLastRead(meshcoreUiMessages);
  }, [lastReadRevision.meshcore, meshcoreUiMessages]);

  const meshcoreChatUnreadDmOptions = useMemo(
    () => ({
      excludeDmPeer: (peer: number) => meshcoreUiNodes.get(peer)?.hw_model === 'Room',
    }),
    [meshcoreUiNodes],
  );
  const meshcoreOwnNodeIdSetRef = useRef(meshcoreOwnNodeIdSet);
  const meshcoreChatUnreadDmOptionsRef = useRef<ChatUnreadDmOptions>(meshcoreChatUnreadDmOptions);

  const meshcoreChatUnread = useMemo(() => {
    return totalUnreadCount(
      meshcoreUiMessages,
      meshcoreChatLastRead,
      meshcoreOwnNodeIdSet,
      'meshcore',
      meshcoreChatUnreadDmOptions,
    );
  }, [meshcoreChatLastRead, meshcoreChatUnreadDmOptions, meshcoreOwnNodeIdSet, meshcoreUiMessages]);

  const meshcoreRoomsUnread = useMemo(() => {
    void roomsLastReadRevision;
    void meshcoreMutedViewsRevision;
    const roomsLastRead = getSanitizedMeshcoreRoomsLastRead(meshcoreUiMessages);
    const rawCount = totalRoomsUnreadCount(
      meshcoreUiMessages,
      roomsLastRead,
      meshcoreOwnNodeIdSet,
      loadMutedViews('meshcore'),
    );
    const count =
      meshcoreRuntime.state.status === 'configured' || meshcoreOwnNodeIdSet.size > 0 ? rawCount : 0;
    return count;
  }, [
    meshcoreMutedViewsRevision,
    roomsLastReadRevision,
    meshcoreOwnNodeIdSet,
    meshcoreUiMessages,
    meshcoreRuntime.state.status,
  ]);

  /** Meshtastic + MeshCore nodes for Diagnostics (foreign MeshCore sender labels/links). */
  const nodesForDiagnostics = useMemo(() => {
    const merged = new Map(meshtasticUiNodes);
    for (const [id, node] of meshcoreUiNodes) {
      merged.set(id, node);
    }
    return merged;
  }, [meshtasticUiNodes, meshcoreUiNodes]);
  const rawPacketGetNodeLabel = useCallback(
    (id: number) => nodeLabelForRawPacket(nodesForUi.get(id), id, protocol),
    [nodesForUi, protocol],
  );
  const meshcorePublicKeyHexByNodeId = useMemo(() => {
    const m = new Map<number, string>();
    if (protocol !== 'meshcore') return m;
    const self = meshcoreRuntime.selfInfo;
    if (self?.publicKey?.length === 32) {
      m.set(
        pubkeyToNodeId(self.publicKey),
        Array.from(self.publicKey)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
      );
    }
    for (const c of meshcoreRuntime.meshcoreContactsForTelemetry) {
      m.set(
        pubkeyToNodeId(c.publicKey),
        Array.from(c.publicKey)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
      );
    }
    return m;
  }, [protocol, meshcoreRuntime.selfInfo, meshcoreRuntime.meshcoreContactsForTelemetry]);

  const capabilities = activeProtocolCapabilities;
  const nodeCountLabel = capabilities.nodeListTabUsesContactsLabel
    ? t('common.contacts')
    : t('common.nodes');
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
    meshtasticMsgsRef.current = meshtasticUiMessages;
    meshcoreMsgsRef.current = meshcoreUiMessages;
    meshtasticMyNodeNumRef.current = meshtasticRuntime.state.myNodeNum;
    meshtasticOwnNodeIdSetRef.current = meshtasticOwnNodeIdSet;
    meshcoreSelfIdRef.current = meshcoreRuntime.selfNodeId;
    meshcoreOwnNodeIdSetRef.current = meshcoreOwnNodeIdSet;
    meshcoreChatUnreadDmOptionsRef.current = meshcoreChatUnreadDmOptions;
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
    meshtasticUiMessages,
    meshtasticRuntime.state.myNodeNum,
    meshtasticOwnNodeIdSet,
    meshcoreUiMessages,
    meshcoreRuntime.selfNodeId,
    meshcoreOwnNodeIdSet,
    meshcoreChatUnreadDmOptions,
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
      const panel = activePanelIndexRef.current;
      if (panel === 1 || panel === ROOMS_PANEL_INDEX) {
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
    } else if (activePanelIndex === ROOMS_PANEL_INDEX && scrollToTopRoomsRef.current) {
      scrollToTopRoomsRef.current();
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
    runReanalysis(() => nodesForUi, activeConnectionView.state.myNodeNum, capabilities);
  }, [
    nodesForUi,
    activeConnectionView.state.myNodeNum,
    runReanalysis,
    ignoreMqttEnabled,
    envMode,
    capabilities,
  ]);

  useEffect(() => {
    const previousDeviceStatus = previousDeviceStatusRef.current;

    if (
      activeConnectionView.state.status === 'disconnected' &&
      previousDeviceStatus !== 'disconnected' &&
      telemetryNoticeDismissed
    ) {
      setTelemetryNoticeDismissed(false);
    }

    previousDeviceStatusRef.current = activeConnectionView.state.status;
  }, [activeConnectionView.state.status, telemetryNoticeDismissed]);

  const isConfigured = activeConnectionView.state.status === 'configured';
  const isOperational = isConfigured || activeConnectionView.state.status === 'stale';
  const isConnectedOrOperational =
    isOperational || activeConnectionView.state.status === 'connected';
  const hasLocalMeshtasticRadio =
    protocol === 'meshtastic' &&
    meshtasticConnectionView.state.myNodeNum > 0 &&
    meshtasticConnectionView.state.connectionType != null &&
    meshtasticConnectionView.state.status !== 'disconnected';
  const isRemoteConfigureTarget =
    protocol === 'meshtastic' && meshtasticRuntime.configureTargetNodeNum != null;
  const configTarget = useMemo((): ConfigTargetContext => {
    const remote = isRemoteConfigureTarget;
    return {
      mode: remote ? 'remote' : 'local',
      nodeNum: meshtasticRuntime.configureTargetNodeNum,
      isReady: !remote || meshtasticRuntime.remoteAdminStatus === 'ready',
      isLoading: meshtasticRuntime.remoteAdminStatus === 'loading',
      error: meshtasticRuntime.remoteAdminError,
      onRefresh:
        remote && meshtasticRuntime.configureTargetNodeNum != null
          ? () =>
              meshtasticPanelActions.refreshRemoteConfigSnapshot(
                meshtasticRuntime.configureTargetNodeNum!,
                'radio',
                {
                  force: true,
                },
              )
          : undefined,
    };
  }, [isRemoteConfigureTarget, meshtasticRuntime, meshtasticPanelActions]);
  const effectiveChannelConfigs = isRemoteConfigureTarget
    ? (activeRuntime.remoteConfigSnapshot?.channelConfigs ?? [])
    : activeRuntime.channelConfigs;
  const effectiveLoraConfig = isRemoteConfigureTarget
    ? (activeRuntime.remoteConfigSnapshot?.loraConfig ?? null)
    : activeRuntime.loraConfig;
  const effectiveModuleConfigs = isRemoteConfigureTarget
    ? (activeRuntime.remoteConfigSnapshot?.moduleConfigs ?? {})
    : activeRuntime.moduleConfigs;
  const effectiveMeshtasticConfigSlices = isRemoteConfigureTarget
    ? (activeRuntime.remoteConfigSnapshot?.configSlices ?? {})
    : activeRuntime.meshtasticConfigSlices;
  const effectiveSecurityConfig = isRemoteConfigureTarget
    ? (activeRuntime.remoteConfigSnapshot?.securityConfig ?? null)
    : activeRuntime.securityConfig;
  const effectiveDeviceOwner = isRemoteConfigureTarget
    ? (activeRuntime.remoteConfigSnapshot?.deviceOwner ?? null)
    : activeRuntime.deviceOwner;
  const effectiveDeviceFixedPosition = isRemoteConfigureTarget
    ? (activeRuntime.remoteConfigSnapshot?.deviceFixedPosition ?? null)
    : activeRuntime.deviceFixedPosition;
  const effectiveRemoteChannelFailedIndices = isRemoteConfigureTarget
    ? (activeRuntime.remoteConfigSnapshot?.failedChannelIndices ?? [])
    : undefined;
  const handleRetryRemoteChannelsTail = useCallback(() => {
    if (meshtasticRuntime.configureTargetNodeNum == null) return;
    const route = remoteConfigChannelRetryRoute(meshtasticRuntime.remoteConfigSnapshot ?? {});
    void meshtasticPanelActions.refreshRemoteConfigSnapshot(
      meshtasticRuntime.configureTargetNodeNum,
      route,
      {
        force: true,
      },
    );
  }, [meshtasticRuntime, meshtasticPanelActions]);
  const configureNodeSelector =
    capabilities.hasRemoteAdmin && hasLocalMeshtasticRadio ? (
      <div className="mb-4">
        <ConfigureNodeSelector
          nodes={nodesForUi}
          myNodeNum={meshtasticConnectionView.state.myNodeNum}
          configureTargetNodeNum={meshtasticRuntime.configureTargetNodeNum}
          onConfigureTargetChange={meshtasticPanelActions.setConfigureTargetNodeNum}
          remoteAdminStatus={meshtasticRuntime.remoteAdminStatus}
          remoteAdminError={meshtasticRuntime.remoteAdminError}
          remoteAdminSessionStatus={
            meshtasticRuntime.configureTargetNodeNum != null
              ? meshtasticPanelActions.getRemoteAdminSessionStatus(
                  meshtasticRuntime.configureTargetNodeNum,
                )
              : 'none'
          }
          isLocalRadioConnected={hasLocalMeshtasticRadio}
          getNodeName={meshtasticPanelActions.getNodeName}
          onRefresh={
            meshtasticRuntime.configureTargetNodeNum != null
              ? () =>
                  meshtasticPanelActions.refreshRemoteConfigSnapshot(
                    meshtasticRuntime.configureTargetNodeNum!,
                    'radio',
                    {
                      force: true,
                    },
                  )
              : undefined
          }
        />
      </div>
    ) : null;

  const configureTargetNodeNum = meshtasticRuntime.configureTargetNodeNum;
  const refreshRemoteConfigSnapshot = meshtasticPanelActions.refreshRemoteConfigSnapshot;

  useEffect(() => {
    if (!isRemoteConfigureTarget || configureTargetNodeNum == null) return;
    if (!hasLocalMeshtasticRadio) return;
    if (activePanelIndex === 5) {
      void refreshRemoteConfigSnapshot(configureTargetNodeNum, 'modules');
    } else if (activePanelIndex === 9) {
      void refreshRemoteConfigSnapshot(configureTargetNodeNum, 'security');
    }
  }, [
    activePanelIndex,
    configureTargetNodeNum,
    refreshRemoteConfigSnapshot,
    hasLocalMeshtasticRadio,
    isRemoteConfigureTarget,
  ]);

  const detailModalProtocol = useMemo((): MeshProtocol => {
    if (selectedNodeId == null) return protocol;
    if (meshcoreUiNodes.has(selectedNodeId)) return 'meshcore';
    return protocol;
  }, [selectedNodeId, protocol, meshcoreUiNodes]);

  const detailModalPanelActions =
    detailModalProtocol === 'meshcore' ? meshcorePanelActions : meshtasticPanelActions;

  const detailConnectionView = useMemo(
    () => (detailModalProtocol === 'meshcore' ? meshcoreConnectionView : meshtasticConnectionView),
    [detailModalProtocol, meshcoreConnectionView, meshtasticConnectionView],
  );
  const detailIsOperational = useMemo(
    () =>
      detailConnectionView.state.status === 'configured' ||
      detailConnectionView.state.status === 'stale',
    [detailConnectionView.state.status],
  );
  const detailIsConnectedOrOperational = useMemo(
    () => detailIsOperational || detailConnectionView.state.status === 'connected',
    [detailIsOperational, detailConnectionView.state.status],
  );

  const detailModalNodes = detailModalProtocol === 'meshcore' ? meshcoreUiNodes : nodesForUi;
  const detailHomeNode =
    detailModalProtocol === 'meshcore'
      ? (meshcoreUiNodes.get(meshcoreRuntime.selfNodeId) ?? null)
      : (nodesForUi.get(meshtasticConnectionView.state.myNodeNum) ?? null);
  const detailMyNodeNum =
    detailModalProtocol === 'meshcore'
      ? meshcoreRuntime.selfNodeId
      : meshtasticConnectionView.state.myNodeNum;

  const selectedNode = useMemo(() => {
    if (selectedNodeId == null) return null;
    const liveNode = meshcoreUiNodes.get(selectedNodeId) ?? nodesForUi.get(selectedNodeId);
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
  }, [selectedNodeId, nodesForUi, meshcoreUiNodes, selectedNodeHistoryPoints]);
  const selectedNodeHistory = useMemo(() => {
    if (selectedNodeId == null || !selectedNodeHistoryPoints) return undefined;
    return new Map([[selectedNodeId, selectedNodeHistoryPoints]]);
  }, [selectedNodeId, selectedNodeHistoryPoints]);

  const handleResend = useCallback(
    (msg: ChatMessage) => {
      sendMessage(
        msg.payload,
        msg.channel,
        msg.to ?? undefined,
        msg.replyId != null ? String(msg.replyId) : undefined,
      );
    },
    [sendMessage],
  );

  const traceRouteHops = useMemo(() => {
    if (!selectedNode) return undefined;
    if (capabilities.protocol !== 'meshtastic') return undefined;
    const result = activeRuntime.traceRouteResults.get(selectedNode.node_id);
    if (!result) return undefined;
    return [
      panelActions.getFullNodeLabel(activeConnectionView.state.myNodeNum) || 'Me',
      ...result.route.map((id) => panelActions.getFullNodeLabel(id)),
      panelActions.getFullNodeLabel(result.from),
    ];
  }, [
    selectedNode,
    panelActions,
    activeConnectionView.state.myNodeNum,
    capabilities.protocol,
    activeRuntime.traceRouteResults,
  ]);

  /** In meshcore mode, only show configured channels (key !== all zeros) in chat. */
  const chatChannels = useMemo(() => {
    if (capabilities.protocol !== 'meshcore') return activeRuntime.channels;
    const chs = activeRuntime.channels as {
      index: number;
      name: string;
      secret?: Uint8Array;
    }[];
    const toHex = (s: Uint8Array) =>
      Array.from(s)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const unconfiguredKey = '00000000000000000000000000000000';
    return chs
      .filter((ch) => ch.secret?.length === 16 && toHex(ch.secret) !== unconfiguredKey)
      .map((ch) => ({ index: ch.index, name: ch.name }));
  }, [capabilities.protocol, activeRuntime.channels]);

  const [chatTabVisited, setChatTabVisited] = useState(false);
  const [roomsTabVisited, setRoomsTabVisited] = useState(false);
  const [chatPanelFreeze, setChatPanelFreeze] = useState<{
    messages: typeof activeRuntime.messages;
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
        messages: activeUiMessages,
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
    setRoomsTabVisited(false);
    prevPanelIndexForChatFreezeRef.current = activePanelIndex;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- protocol-only reset; capture current panel for ref sync
  }, [protocol]);

  useEffect(() => {
    if (capabilities.hasRoomServersPanel && activePanelIndex === ROOMS_PANEL_INDEX) {
      setRoomsTabVisited(true);
    }
  }, [activePanelIndex, capabilities.hasRoomServersPanel]);

  const isChatPanelFrozen = chatTabVisited && activePanelIndex !== 1;
  const freeze = chatPanelFreeze;
  const chatMessagesForPanel = isChatPanelFrozen && freeze ? freeze.messages : activeUiMessages;
  const chatNodesForPanel = isChatPanelFrozen && freeze ? freeze.nodes : nodesForUi;
  const chatChannelsForPanel = isChatPanelFrozen && freeze ? freeze.channels : chatChannels;

  useEffect(() => {
    const liveResolvedMessageCount =
      protocol === 'meshcore' ? meshcoreStoreMessages.length : meshtasticStoreMessages.length;
    setDebugSnapshotUiContext({
      activePanelIndex,
      chatTabVisited,
      chatPanelFrozen: isChatPanelFrozen,
      frozenMessageCount: isChatPanelFrozen && freeze ? freeze.messages.length : null,
      liveResolvedMessageCount,
      activeProtocol: protocol,
    });
  }, [
    activePanelIndex,
    chatTabVisited,
    isChatPanelFrozen,
    freeze,
    protocol,
    meshcoreStoreMessages.length,
    meshtasticStoreMessages.length,
  ]);

  const handleDmTargetConsumed = useCallback(() => {
    setPendingDmTarget(null);
  }, []);

  const {
    refreshNodesFromDb: refreshMeshtasticNodesInStore,
    refreshMessagesFromDb: refreshMeshtasticMessagesInStore,
  } = meshtasticDbRefresh;
  const {
    refreshNodesFromDb: refreshMeshcoreNodesInStore,
    refreshMessagesFromDb: refreshMeshcoreMessagesInStore,
  } = meshcoreDbRefresh;

  const refreshNodesFromDb = useCallback(() => {
    if (protocol === 'meshtastic') {
      meshtasticPanelActions.refreshNodesFromDb();
      void refreshMeshtasticNodesInStore();
    } else {
      void meshcorePanelActions.refreshNodesFromDb();
      void refreshMeshcoreNodesInStore();
    }
  }, [
    protocol,
    meshtasticPanelActions,
    meshcorePanelActions,
    refreshMeshtasticNodesInStore,
    refreshMeshcoreNodesInStore,
  ]);

  const refreshMessagesFromDb = useCallback(
    (opts?: MessageClearRefreshOptions) => {
      const replace =
        opts?.replaceFromDb === true ||
        opts?.messagesMode === 'replace' ||
        opts?.clearedAll === true ||
        opts?.clearedChannel != null;
      const messagesMode = replace ? 'replace' : 'upsert';
      const replaceFromDb = replace;

      if (protocol === 'meshtastic') {
        meshtasticPanelActions.refreshMessagesFromDb({ replaceFromDb });
        void refreshMeshtasticMessagesInStore({ messagesMode });
      } else {
        void meshcorePanelActions.refreshMessagesFromDb({ replaceFromDb });
        void refreshMeshcoreMessagesInStore({ messagesMode });
      }

      if (opts?.clearedAll) {
        clearPersistedLastReadForProtocol(protocol);
        if (protocol === 'meshcore') {
          clearPersistedRoomsLastRead();
        }
      } else if (opts?.clearedChannel != null) {
        removePersistedLastReadForChannel(protocol, opts.clearedChannel);
        if (protocol === 'meshcore' && opts.clearedChannel === MESHCORE_ROOM_MESSAGE_CHANNEL) {
          clearPersistedRoomsLastRead();
        }
      }
    },
    [
      protocol,
      meshtasticPanelActions,
      meshcorePanelActions,
      refreshMeshtasticMessagesInStore,
      refreshMeshcoreMessagesInStore,
    ],
  );

  const postStartupPruneHydrateRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    postStartupPruneHydrateRef.current = () => {
      ensureOfflineProtocolIdentities();
      if (meshtasticIdentityId) void refreshMeshtasticAllFromDb();
      if (meshcoreIdentityId) void refreshMeshcoreAllFromDb();
    };
  }, [
    meshtasticIdentityId,
    meshcoreIdentityId,
    refreshMeshtasticAllFromDb,
    refreshMeshcoreAllFromDb,
  ]);

  useAppStartupDbPrune(
    useCallback(() => {
      postStartupPruneHydrateRef.current();
    }, []),
  );

  // Dual-mode: each protocol manages its own MQTT connection independently.
  // Meshtastic MQTT disconnects when switching to MeshCore without an RF radio.

  const hasMeshtasticRfDevice =
    meshtasticConnectionView.state.connectionType != null &&
    meshtasticConnectionView.state.status !== 'disconnected';

  useEffect(() => {
    if (shouldMaintainMeshtasticMqttConnection(protocol, hasMeshtasticRfDevice)) return;
    if (meshtasticConnectionView.mqttStatus === 'disconnected') return;
    void window.electronAPI.mqtt.disconnect('meshtastic').catch((e: unknown) => {
      console.debug('[App] Meshtastic MQTT disconnect on MeshCore tab ' + errLikeToLogString(e));
    });
  }, [protocol, hasMeshtasticRfDevice, meshtasticConnectionView.mqttStatus]);

  const prevProtocolForMqttAutostartRef = useRef<MeshProtocol>(protocol);

  // Connect Meshtastic MQTT when switching to the Meshtastic tab after startup skipped it.
  useEffect(() => {
    const prev = prevProtocolForMqttAutostartRef.current;
    prevProtocolForMqttAutostartRef.current = protocol;
    if (protocol !== 'meshtastic') return;
    if (prev === 'meshtastic') return;
    if (meshtasticConnectionView.mqttStatus !== 'disconnected') return;
    void tryAutoLaunchMqtt('meshtastic').catch((e: unknown) => {
      console.warn('[App] MQTT auto-launch on tab switch failed ' + errLikeToLogString(e));
    });
  }, [protocol, meshtasticConnectionView.mqttStatus]);

  // ─── MQTT auto-launch on startup ─────────────────────────────────
  // Launch MQTT for each protocol when autoLaunch is enabled. Meshtastic MQTT skips
  // startup when MeshCore is the stored tab unless auto-connect is enabled.
  useEffect(() => {
    for (const prot of ['meshtastic', 'meshcore'] as MeshProtocol[]) {
      if (prot === 'meshtastic' && !shouldAutoLaunchMeshtasticMqtt(getStoredMeshProtocol())) {
        if (getStoredMeshProtocol() === 'meshcore') {
          console.debug('[App] Meshtastic MQTT auto-launch skipped: stored protocol is meshcore');
        }
        continue;
      }
      void tryAutoLaunchMqtt(prot).catch((e: unknown) => {
        console.warn('[App] MQTT auto-launch connect failed ' + errLikeToLogString(e));
      });
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
    const count = meshtasticUiMessages.length;
    if (isMeshtasticInitialRef.current) {
      prevMeshtasticMsgCountRef.current = count;
      if (count > 0) isMeshtasticInitialRef.current = false;
      return;
    }
    const isActiveAndChatOpen =
      protocolRef.current === 'meshtastic' && activePanelIndexRef.current === 1 && !document.hidden;
    if (count > prevMeshtasticMsgCountRef.current && !isActiveAndChatOpen) {
      const newMsgs = meshtasticMsgsRef.current.slice(prevMeshtasticMsgCountRef.current);
      const mutedRaw = localStorage.getItem('mesh-client:mutedViews:meshtastic');
      const mutedViews: Set<string> = mutedRaw
        ? new Set(JSON.parse(mutedRaw) as string[])
        : new Set();
      const type = resolveInactiveChatNotificationType({
        newMessages: newMsgs,
        allMessages: meshtasticMsgsRef.current,
        protocol: 'meshtastic',
        ownNodeIds: meshtasticOwnNodeIdSetRef.current,
        ownSenderId: meshtasticMyNodeNumRef.current,
        mutedViews,
        notifGloballyMuted: localStorage.getItem('mesh-client:notifMuted') === '1',
      });
      if (type) playMessageNotification(type);
    }
    prevMeshtasticMsgCountRef.current = count;
  }, [meshtasticUiMessages.length]);

  // ─── Track MeshCore messages arriving while inactive ─────────────
  useEffect(() => {
    const count = meshcoreUiMessages.length;
    if (isMeshcoreInitialRef.current) {
      prevMeshcoreMsgCountRef.current = count;
      if (count > 0) isMeshcoreInitialRef.current = false;
      return;
    }
    const isActiveAndChatOpen =
      protocolRef.current === 'meshcore' && activePanelIndexRef.current === 1 && !document.hidden;
    if (count > prevMeshcoreMsgCountRef.current && !isActiveAndChatOpen) {
      const newMsgs = meshcoreMsgsRef.current.slice(prevMeshcoreMsgCountRef.current);
      const type = resolveInactiveChatNotificationType({
        newMessages: newMsgs,
        allMessages: meshcoreMsgsRef.current,
        protocol: 'meshcore',
        ownNodeIds: meshcoreOwnNodeIdSetRef.current,
        ownSenderId: meshcoreSelfIdRef.current,
        mutedViews: loadMutedViews('meshcore'),
        notifGloballyMuted: localStorage.getItem('mesh-client:notifMuted') === '1',
        dmOptions: meshcoreChatUnreadDmOptionsRef.current,
      });
      if (type) playMessageNotification(type);
    }
    prevMeshcoreMsgCountRef.current = count;
  }, [meshcoreUiMessages.length]);

  useAppTrayUnreadSync(meshtasticChatUnread, meshcoreChatUnread, meshcoreRoomsUnread);

  // ─── Auto flood advert (MeshCore) ────────────────────────────────
  const advertSentRef = useRef(false);

  useEffect(() => {
    if (protocol !== 'meshcore' || !isOperational || autoFloodAdvertIntervalHours <= 0) return;
    if (!meshcoreIdentityId || !connectionDriver.getHandle(meshcoreIdentityId)) return;

    const sendScheduledAdvert = () => {
      const action =
        autoFloodAdvertType === 'zeroHop'
          ? meshcorePanelActions.sendZeroHopAdvert
          : meshcorePanelActions.sendAdvert;
      void action().catch((e: unknown) => {
        console.warn('[App] auto flood advert failed', e instanceof Error ? e.message : e);
      });
    };

    if (!advertSentRef.current) {
      advertSentRef.current = true;
      sendScheduledAdvert();
    }

    const ms = autoFloodAdvertIntervalHours * 60 * 60 * 1000;
    const id = setInterval(sendScheduledAdvert, ms);

    return () => {
      clearInterval(id);
    };
  }, [
    protocol,
    isOperational,
    autoFloodAdvertIntervalHours,
    autoFloodAdvertType,
    meshcorePanelActions,
    meshcoreIdentityId,
  ]);

  // Manual reconnect from banner
  const reconnectInFlightRef = useRef(false);
  const handleReconnect = useCallback(() => {
    if (reconnectInFlightRef.current) return;
    reconnectInFlightRef.current = true;

    const lastStored = loadLastConnection(protocol);
    const lastType =
      activeConnectionView.state.connectionType ?? lastStored?.type ?? ('ble' as const);

    void protocolDisconnect(protocol)
      .then(() => {
        setTimeout(() => {
          const finish = () => {
            reconnectInFlightRef.current = false;
          };

          void reconnectRfFromLastConnection(protocol, lastType, {
            connectBleAutomatic: (bleDeviceId) =>
              protocol === 'meshtastic'
                ? meshtasticConnection.connectAutomatic('ble', undefined, undefined, bleDeviceId)
                : meshcoreConnection.connectAutomatic('ble', undefined, undefined, bleDeviceId),
            connectBleDirect: (bleDeviceId) =>
              protocolConnect(protocol, 'ble', undefined, bleDeviceId),
            connectSerialAutomatic: (serialPortId) =>
              protocol === 'meshtastic'
                ? meshtasticConnection.connectAutomatic('serial', undefined, serialPortId)
                : meshcoreConnection.connectAutomatic('serial', undefined, serialPortId),
            connectHttp: (httpAddress) => protocolConnect(protocol, 'http', httpAddress),
          })
            .catch((err: unknown) => {
              logRfReconnectFailure('[App] handleReconnect failed', err);
            })
            .finally(finish);
        }, 500);
      })
      .catch((err: unknown) => {
        reconnectInFlightRef.current = false;
        logRfReconnectFailure('[App] handleReconnect disconnect failed', err);
      });
  }, [
    activeConnectionView.state.connectionType,
    meshcoreConnection,
    meshtasticConnection,
    protocol,
    protocolConnect,
    protocolDisconnect,
  ]);

  const handleMessageNode = useCallback((nodeNum: number) => {
    setPendingDmTarget(nodeNum);
    setActiveTab(1); // Switch to Chat tab
  }, []);

  const handleOpenRoom = useCallback(
    (nodeNum: number) => {
      setPendingRoomTarget(nodeNum);
      const roomsSlotIndex = TAB_SLOT_IDS.indexOf('Rooms');
      const filteredIndex = meshcoreTabs.tabIndexToPanelIndex.findIndex(
        (panelIndex) => panelIndex === roomsSlotIndex,
      );
      if (filteredIndex >= 0) {
        setActiveTab(filteredIndex);
      }
    },
    [meshcoreTabs.tabIndexToPanelIndex],
  );

  const handleRoomTargetConsumed = useCallback(() => {
    setPendingRoomTarget(null);
  }, []);

  const handleLocationFilterChange = useCallback((f: LocationFilter) => {
    setLocationFilter(f);
  }, []);

  const handleChatCompactModeChange = useCallback((compact: boolean) => {
    setChatCompactMode(compact);
  }, []);

  const mqttLoss = activeRuntime.mqttConnectionLoss ?? false;
  const mqttVariant = mqttHeaderVariant(
    activeConnectionView.mqttStatus ?? 'disconnected',
    mqttLoss,
  );
  const deviceLoss = activeConnectionView.state.connectionLoss ?? false;
  const deviceVariant = deviceHeaderVariant(activeConnectionView.state.status, deviceLoss);
  const takServerError = !takStatus.running && !!(takStatus.error || takError);
  const takVariant = takHeaderVariant(takStatus.running, takServerError, takClientLoss);
  const legacyQueue = activeRuntime.queueStatus;
  const activeQueue =
    activeQueueFromStore ??
    (legacyQueue != null ? { free: legacyQueue.free, maxlen: legacyQueue.maxlen } : null);
  const rawQueueUsed = activeQueue ? activeQueue.maxlen - activeQueue.free : 0;
  const queueUsed =
    protocol === 'meshtastic' && rawQueueUsed === 1 && !hasLocalSendingMessage ? 0 : rawQueueUsed;
  const queueShowBadge = activeQueue != null;
  const queueColorClass =
    queueUsed <= 10
      ? 'bg-green-900/60 text-green-300 border border-green-700'
      : queueUsed <= 14
        ? 'bg-amber-900/60 text-amber-300 border border-amber-700'
        : 'bg-red-900/60 text-red-300 border border-red-700';
  const takStatusLabel =
    takClientLoss && takStatus.running
      ? t('app.takClientLost')
      : takStatus.running
        ? t('app.takRunning')
        : t('app.takStopped');
  const takStatusAriaLabel =
    takClientLoss && takStatus.running
      ? t('app.takClientLost')
      : takStatus.running
        ? t('app.takServerRunning')
        : t('app.takServerStopped');
  const mqttStatusLabel =
    activeConnectionView.mqttStatus === 'connected'
      ? t('app.mqttConnected')
      : activeConnectionView.mqttStatus === 'connecting'
        ? t('app.mqttConnecting')
        : activeConnectionView.mqttStatus === 'error' || mqttLoss
          ? t('app.mqttError')
          : t('app.mqttDisconnected');
  const deviceStatusLabel = deviceConnectionStatusLabel(t, activeConnectionView.state.status);
  const deviceStatusText = `${deviceStatusLabel}${activeConnectionView.state.connectionType ? ` (${activeConnectionView.state.connectionType.toUpperCase()})` : ''}`;

  return (
    <ToastProvider>
      {/* Global assertive live region for critical announcements */}
      <div aria-live="assertive" aria-atomic="true" className="sr-only" id="app-announcer" />
      {/* Passive notifications for inactive protocol activity */}
      <InactiveProtocolNotifier
        protocol={protocol}
        meshtasticMessages={meshtasticUiMessages}
        meshcoreMessages={meshcoreUiMessages}
      />
      {protocol === 'meshtastic' && (
        <RemoteAdminErrorNotifier
          status={meshtasticRuntime.remoteAdminStatus}
          errorKey={meshtasticRuntime.remoteAdminError}
        />
      )}
      {/* Firmware update check on connect */}
      <FirmwareUpdateNotifier
        meshtasticState={meshtasticRuntime.state}
        meshcoreState={meshcoreRuntime.state}
        protocol={protocol}
        onResult={handleFirmwareResult}
      />
      {signalPulseKey !== null && (
        <BootSequence
          key={signalPulseKey}
          phraseSeed={signalPulseKey}
          protocol={protocol}
          identityId={focusedIdentityId}
          onComplete={handleSignalPulseComplete}
        />
      )}
      <div className="bg-app-bg flex h-screen w-screen min-w-0 flex-col overflow-hidden">
        {/* Header - full width; sidebar + main start below */}
        <div
          role="banner"
          className={`bg-deep-black relative grid w-full grid-cols-[auto_minmax(0,1fr)] items-center border-b py-2 pr-4 ${
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
          <div className="flex min-w-0 items-center overflow-hidden">
            <div className="flex shrink-0 items-center pl-8">
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
                  {meshtasticChatUnread > 0 && protocol !== 'meshtastic' && (
                    <span className="bg-readable-green ml-1.5 inline-flex h-4 min-w-[1.1rem] animate-pulse items-center justify-center rounded-full px-0.5 text-[10px] font-bold text-white">
                      {meshtasticChatUnread > 99 ? '99+' : meshtasticChatUnread}
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
                  {meshcoreChatUnread > 0 && protocol !== 'meshcore' && (
                    <span className="ml-1.5 inline-flex h-4 min-w-[1.1rem] animate-pulse items-center justify-center rounded-full bg-cyan-600 px-0.5 text-[10px] font-bold text-white">
                      {meshcoreChatUnread > 99 ? '99+' : meshcoreChatUnread}
                    </span>
                  )}
                </button>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              {capabilities.hasTakPanel && (
                <div
                  role="group"
                  className="mr-3 flex shrink-0 items-center gap-1.5 border-r border-gray-700 pr-3"
                  title={takStatusAriaLabel}
                  aria-label={takStatusAriaLabel}
                >
                  <TakStatusIcon variant={takVariant} />
                  <span
                    aria-hidden="true"
                    className={`hidden text-xs lg:inline ${headerTextClass(takVariant)}`}
                  >
                    {takStatusLabel}
                  </span>
                </div>
              )}
              <div
                role="group"
                className="mr-3 flex shrink-0 items-center gap-1.5 border-r border-gray-700 pr-3"
                title={mqttStatusLabel}
                aria-label={mqttStatusLabel}
              >
                <HeaderMqttGlobeIcon variant={mqttVariant} />
                <span
                  aria-hidden="true"
                  className={`hidden text-xs lg:inline ${headerTextClass(mqttVariant)}`}
                >
                  {mqttStatusLabel}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2" title={deviceStatusText}>
                {isConnectedOrOperational && <LinkIcon className="h-4 w-4" aria-hidden="true" />}
                <div
                  className={`h-2.5 w-2.5 rounded-full ${headerDotClass(deviceVariant)}`}
                  aria-hidden="true"
                />
                <div
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  aria-label={deviceStatusText}
                >
                  <span
                    aria-hidden="true"
                    className={`hidden text-xs lg:inline ${headerTextClass(deviceVariant)}`}
                  >
                    {deviceStatusLabel}
                    {activeConnectionView.state.connectionType
                      ? ` (${activeConnectionView.state.connectionType.toUpperCase()})`
                      : ''}
                  </span>
                </div>
              </div>
              {activeConnectionView.state.myNodeNum > 0 &&
                (protocol !== 'meshcore' || activeConnectionView.state.status === 'configured') && (
                  <span
                    aria-label={t('app.nodeLabel', {
                      name:
                        protocol === 'meshcore'
                          ? meshcoreRuntime.deviceOwner?.longName?.trim() ||
                            panelActions.getPickerStyleNodeLabel(
                              activeConnectionView.state.myNodeNum,
                            )
                          : panelActions.getPickerStyleNodeLabel(
                              activeConnectionView.state.myNodeNum,
                            ),
                    })}
                    className="text-muted hidden shrink-0 text-xs xl:inline"
                  >
                    {t('app.nodeLabel', {
                      name:
                        protocol === 'meshcore'
                          ? meshcoreRuntime.deviceOwner?.longName?.trim() ||
                            panelActions.getPickerStyleNodeLabel(
                              activeConnectionView.state.myNodeNum,
                            )
                          : panelActions.getPickerStyleNodeLabel(
                              activeConnectionView.state.myNodeNum,
                            ),
                    })}
                  </span>
                )}
              {/* Queue status badge: 0–10 used = green, 11–14 = yellow, 15–16 = red */}
              {queueShowBadge && activeQueue && (
                <HelpTooltip
                  text={
                    protocol === 'meshcore'
                      ? t('app.meshcoreQueueTooltip')
                      : t('app.meshtasticQueueTooltip')
                  }
                >
                  <div
                    aria-label={`Q: ${queueUsed}/${activeQueue.maxlen}`}
                    className={`flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${queueColorClass}`}
                  >
                    Q: {queueUsed}/{activeQueue.maxlen}
                  </div>
                </HelpTooltip>
              )}
              <div className="shrink-0">
                <LanguageSelector />
              </div>
            </div>
          </div>
        </div>

        {/* Connection Status Banner */}
        <ConnectionBanner
          status={activeConnectionView.state.status}
          connectionLoss={deviceLoss}
          reconnectAttempt={activeConnectionView.state.reconnectAttempt}
          onReconnect={handleReconnect}
        />

        {/* Telemetry disabled notice */}
        {isOperational && activeRuntime.telemetryEnabled === false && !telemetryNoticeDismissed && (
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
              chatUnread={protocol === 'meshtastic' ? meshtasticChatUnread : meshcoreChatUnread}
              roomsUnread={protocol === 'meshcore' ? meshcoreRoomsUnread : 0}
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
                            state={meshtasticConnection.state}
                            onConnect={meshtasticConnection.connect}
                            onAutoConnect={meshtasticConnection.connectAutomatic}
                            onDisconnect={meshtasticConnection.disconnect}
                            mqttStatus={meshtasticConnection.mqttStatus}
                            myNodeLabel={
                              meshtasticRuntime.state.myNodeNum > 0
                                ? meshtasticRuntime.getPickerStyleNodeLabel(
                                    meshtasticRuntime.state.myNodeNum,
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
                            state={meshcoreConnection.state}
                            onConnect={meshcoreConnection.connect}
                            onAutoConnect={meshcoreConnection.connectAutomatic}
                            onDisconnect={meshcoreConnection.disconnect}
                            mqttStatus={meshcoreConnection.mqttStatus}
                            myNodeLabel={
                              meshcoreRuntime.state.myNodeNum > 0
                                ? meshcoreRuntime.getPickerStyleNodeLabel(
                                    meshcoreRuntime.state.myNodeNum,
                                  )
                                : undefined
                            }
                            protocol="meshcore"
                            ensureMeshcoreMqttIdentity={meshcoreRuntime.ensureMeshcoreMqttIdentity}
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
                            messagesForUnread={activeUiMessages}
                            channels={chatChannelsForPanel}
                            myNodeNum={activeRuntime.selfNodeId}
                            ownNodeIds={
                              protocol === 'meshtastic'
                                ? meshtasticMqttOwnNodeIds(
                                    activeRuntime.selfNodeId,
                                    meshtasticRuntime.virtualNodeId,
                                    meshtasticRuntime.lastRfSelfNodeId,
                                  )
                                : Array.from(meshcoreOwnNodeIdSet)
                            }
                            onSend={handleSend}
                            onReact={
                              protocol === 'meshtastic'
                                ? meshtasticPanelActions.sendReaction
                                : meshcoreRuntime.sendReaction
                            }
                            onResend={handleResend}
                            onNodeClick={setSelectedNodeId}
                            isConnected={
                              isOperational || activeConnectionView.mqttStatus === 'connected'
                            }
                            isMqttOnly={
                              !isOperational && activeConnectionView.mqttStatus === 'connected'
                            }
                            connectionType={activeConnectionView.state.connectionType}
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
                                    meshtasticPanelActions.requestStoreForwardHistory({
                                      manual: true,
                                    })
                                : undefined
                            }
                            waitingMessagesCount={
                              protocol === 'meshcore' ? meshcoreRuntime.waitingMessagesCount : 0
                            }
                            onSyncWaitingMessages={
                              protocol === 'meshcore'
                                ? () => void meshcoreRuntime.getWaitingMessages()
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
                            myNodeNum={activeRuntime.selfNodeId}
                            onNodeClick={(node) => {
                              setSelectedNodeId(node.node_id);
                            }}
                            mqttConnected={activeConnectionView.mqttStatus === 'connected'}
                            radioConnected={isConnectedOrOperational}
                            locationFilter={locationFilter}
                            onToggleFavorite={panelActions.setNodeFavorited}
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
                              capabilities.hasContactImportExport
                                ? meshcorePanelActions.importContacts
                                : undefined
                            }
                            meshcoreShowRefreshControl={
                              capabilities.hasContactImportExport
                                ? meshcoreContactsShowRefreshControl
                                : false
                            }
                            onRefreshContacts={
                              capabilities.hasContactImportExport
                                ? meshcorePanelActions.refreshContacts
                                : undefined
                            }
                            meshcoreShowPublicKeys={
                              capabilities.hasContactImportExport
                                ? meshcoreContactsShowPublicKeys
                                : false
                            }
                            meshcorePublicKeyHexByNodeId={
                              capabilities.hasContactImportExport
                                ? meshcorePublicKeyHexByNodeId
                                : undefined
                            }
                            onSendAdvert={
                              capabilities.hasContactImportExport
                                ? meshcorePanelActions.sendAdvert
                                : undefined
                            }
                            onOffloadContactsFromRadio={
                              capabilities.hasContactImportExport
                                ? meshcorePanelActions.offloadContactsFromRadio
                                : undefined
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
                              myNodeNum={activeRuntime.selfNodeId}
                              locationFilter={locationFilter}
                              ourPosition={activeRuntime.ourPosition}
                              onLocateMe={() =>
                                panelActions
                                  .refreshOurPosition()
                                  .then((p) => (p ? { lat: p.lat, lon: p.lon } : null))
                              }
                              waypoints={activeRuntime.waypoints}
                              onSendWaypoint={panelActions.sendWaypoint}
                              onDeleteWaypoint={panelActions.deleteWaypoint}
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
                            {configureNodeSelector}
                            <RadioPanel
                              configTarget={configTarget}
                              onSetConfig={panelActions.setConfig}
                              onCommit={panelActions.commitConfig}
                              onSetChannel={panelActions.setDeviceChannel}
                              onClearChannel={panelActions.clearChannel}
                              channelConfigs={effectiveChannelConfigs}
                              remoteChannelFailedIndices={effectiveRemoteChannelFailedIndices}
                              remoteChannelsTailStatus={
                                isRemoteConfigureTarget
                                  ? activeRuntime.remoteConfigChannelsTailStatus
                                  : undefined
                              }
                              onRetryRemoteChannelsTail={
                                isRemoteConfigureTarget ? handleRetryRemoteChannelsTail : undefined
                              }
                              meshtasticLoraConfig={
                                protocol === 'meshtastic' ? effectiveLoraConfig : undefined
                              }
                              meshtasticConfigSlices={
                                protocol === 'meshtastic'
                                  ? effectiveMeshtasticConfigSlices
                                  : undefined
                              }
                              onApplyChannelSet={
                                capabilities.hasChannelConfig
                                  ? meshtasticPanelActions.applyChannelSet
                                  : undefined
                              }
                              isConnected={isOperational}
                              deviceFixedPosition={effectiveDeviceFixedPosition}
                              ourPosition={activeRuntime.ourPosition}
                              onSendPositionToDevice={panelActions.sendPositionToDevice}
                              deviceOwner={effectiveDeviceOwner}
                              onSetOwner={panelActions.setOwner}
                              capabilities={capabilities}
                              meshcoreChannels={
                                protocol === 'meshcore' ? meshcoreRuntime.channels : undefined
                              }
                              onMeshcoreSetChannel={
                                capabilities.hasCompanionContactManagementConfig
                                  ? meshcorePanelActions.meshcoreSetChannel
                                  : undefined
                              }
                              onMeshcoreDeleteChannel={
                                capabilities.hasCompanionContactManagementConfig
                                  ? meshcorePanelActions.meshcoreDeleteChannel
                                  : undefined
                              }
                              onApplyLoraParams={
                                protocol === 'meshcore'
                                  ? meshcorePanelActions.setRadioParams
                                  : undefined
                              }
                              loraConfig={
                                protocol === 'meshcore' && meshcoreRuntime.selfInfo
                                  ? {
                                      freq: meshcoreRuntime.selfInfo.radioFreq,
                                      bw: meshcoreRuntime.selfInfo.radioBw,
                                      sf: meshcoreRuntime.selfInfo.radioSf,
                                      cr: meshcoreRuntime.selfInfo.radioCr,
                                      txPower: meshcoreRuntime.selfInfo.txPower,
                                    }
                                  : undefined
                              }
                              meshcoreSelfInfo={
                                protocol === 'meshcore' ? meshcoreRuntime.selfInfo : undefined
                              }
                              meshcoreContactsForTelemetry={
                                protocol === 'meshcore'
                                  ? meshcoreRuntime.meshcoreContactsForTelemetry
                                  : undefined
                              }
                              onApplyMeshcoreTelemetryPrivacy={
                                protocol === 'meshcore'
                                  ? meshcorePanelActions.applyMeshcoreTelemetryPrivacy
                                  : undefined
                              }
                              meshcoreAutoadd={
                                protocol === 'meshcore'
                                  ? meshcoreRuntime.meshcoreAutoadd
                                  : undefined
                              }
                              onApplyMeshcoreContactAutoAdd={
                                protocol === 'meshcore'
                                  ? meshcorePanelActions.applyMeshcoreContactAutoAdd
                                  : undefined
                              }
                              onRefreshMeshcoreAutoaddFromDevice={
                                protocol === 'meshcore'
                                  ? meshcorePanelActions.refreshMeshcoreAutoaddFromDevice
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
                                  ? meshcorePanelActions.clearAllMeshcoreContacts
                                  : undefined
                              }
                              onSendAdvert={
                                protocol === 'meshcore'
                                  ? meshcorePanelActions.sendAdvert
                                  : undefined
                              }
                              onSendZeroHopAdvert={
                                protocol === 'meshcore'
                                  ? meshcorePanelActions.sendZeroHopAdvert
                                  : undefined
                              }
                              onApplyMeshcoreFloodScopeHashtag={
                                protocol === 'meshcore'
                                  ? meshcorePanelActions.applyMeshcoreFloodScopeHashtag
                                  : undefined
                              }
                              meshcoreFloodScopeHashtag={
                                protocol === 'meshcore' ? meshcoreFloodScopeHashtag : ''
                              }
                              onMeshcoreFloodScopeHashtagChange={setMeshcoreFloodScopeHashtag}
                              onXmodemUpload={
                                protocol === 'meshtastic' &&
                                isOperational &&
                                !isRemoteConfigureTarget
                                  ? meshtasticPanelActions.xmodemUpload
                                  : undefined
                              }
                              onXmodemDownload={
                                protocol === 'meshtastic' &&
                                isOperational &&
                                !isRemoteConfigureTarget
                                  ? meshtasticPanelActions.xmodemDownload
                                  : undefined
                              }
                              onSyncClock={
                                protocol === 'meshcore' ? meshcorePanelActions.syncClock : undefined
                              }
                              onRefreshContacts={
                                protocol === 'meshcore'
                                  ? meshcorePanelActions.refreshContacts
                                  : undefined
                              }
                              onOffloadContactsFromRadio={
                                protocol === 'meshcore'
                                  ? meshcorePanelActions.offloadContactsFromRadio
                                  : undefined
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
                      {activePanelIndex === 5 && capabilities.modulesTabUsesRepeatersLabel ? (
                        <ErrorBoundary>
                          <Suspense fallback={<PanelSkeleton />}>
                            <RepeatersPanel
                              nodes={meshcoreUiNodes}
                              meshcoreNodeStatus={meshcoreRuntime.meshcoreNodeStatus}
                              meshcoreStatusErrors={meshcoreRuntime.meshcoreStatusErrors}
                              meshcoreTraceResults={meshcoreRuntime.meshcoreTraceResults}
                              meshcorePingErrors={meshcoreRuntime.meshcorePingErrors}
                              meshcoreCanPingTrace={meshcoreRuntime.meshcoreCanPingTrace}
                              onRequestRepeaterStatus={meshcorePanelActions.requestRepeaterStatus}
                              onPing={meshcorePanelActions.traceRoute}
                              onDeleteRepeater={meshcorePanelActions.deleteNode}
                              isConnected={isOperational}
                              onRequestNeighbors={meshcorePanelActions.requestNeighbors}
                              meshcoreNeighbors={meshcoreRuntime.meshcoreNeighbors}
                              meshcoreNeighborErrors={meshcoreRuntime.meshcoreNeighborErrors}
                              onRequestTelemetry={meshcorePanelActions.requestTelemetry}
                              meshcoreTelemetry={meshcoreRuntime.meshcoreNodeTelemetry}
                              meshcoreTelemetryErrors={meshcoreRuntime.meshcoreTelemetryErrors}
                              onSelectRepeater={(node) => {
                                setSelectedNodeId(node.node_id);
                              }}
                              onSendCliCommand={meshcorePanelActions.sendRepeaterCliCommand}
                              meshcoreCliHistories={meshcoreRuntime.meshcoreCliHistories}
                              meshcoreCliErrors={meshcoreRuntime.meshcoreCliErrors}
                              onClearCliHistory={meshcorePanelActions.clearCliHistory}
                              onToggleFavorite={meshcorePanelActions.setNodeFavorited}
                            />
                          </Suspense>
                        </ErrorBoundary>
                      ) : null}
                      {activePanelIndex === 5 && protocol !== 'meshcore' ? (
                        <ErrorBoundary>
                          <Suspense fallback={<PanelSkeleton />}>
                            {configureNodeSelector}
                            <ModulePanel
                              configTarget={configTarget}
                              moduleConfigs={effectiveModuleConfigs}
                              onSetModuleConfig={meshtasticPanelActions.setModuleConfig}
                              onSetCannedMessages={meshtasticPanelActions.setCannedMessages}
                              onSetRingtone={meshtasticPanelActions.setRingtone}
                              ringtone={activeRuntime.ringtone}
                              onCommit={meshtasticPanelActions.commitConfig}
                              isConnected={isOperational}
                              deviceNetwork={{
                                hasWifi: meshtasticConnectionView.state.deviceHasWifi,
                                hasEthernet: meshtasticConnectionView.state.deviceHasEthernet,
                              }}
                              storeForwardMessages={activeRuntime.storeForwardMessages}
                              rangeTestPackets={activeRuntime.rangeTestPackets}
                              serialMessages={activeRuntime.serialMessages}
                              remoteHardwareMessages={activeRuntime.remoteHardwareMessages}
                              ipTunnelMessages={
                                isRemoteConfigureTarget ? undefined : activeRuntime.ipTunnelMessages
                              }
                              audioMessages={
                                isRemoteConfigureTarget ? undefined : activeRuntime.audioMessages
                              }
                              simulatorPackets={
                                isRemoteConfigureTarget ? undefined : activeRuntime.simulatorPackets
                              }
                              privateMessages={
                                isRemoteConfigureTarget ? undefined : activeRuntime.privateMessages
                              }
                              pingResponses={
                                isRemoteConfigureTarget ? undefined : activeRuntime.pingResponses
                              }
                              hasAudio={capabilities.hasAudio}
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
                      className="h-full w-full min-w-0"
                    >
                      {activePanelIndex === 6 ? (
                        <ErrorBoundary>
                          <Suspense fallback={<PanelSkeleton />}>
                            <AdminPanel
                              configTarget={configTarget}
                              capabilities={capabilities}
                              isConnected={isOperational}
                              onReboot={panelActions.reboot}
                              onShutdown={panelActions.shutdown}
                              onFactoryReset={panelActions.factoryReset}
                              onResetNodeDb={panelActions.resetNodeDb}
                              onRebootOta={
                                protocol === 'meshtastic'
                                  ? meshtasticPanelActions.rebootOta
                                  : undefined
                              }
                              onEnterDfu={
                                protocol === 'meshtastic'
                                  ? meshtasticPanelActions.enterDfuMode
                                  : undefined
                              }
                              onFactoryResetConfig={
                                protocol === 'meshtastic'
                                  ? meshtasticPanelActions.factoryResetConfig
                                  : undefined
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
                      className="h-full w-full min-w-0"
                    >
                      {(activePanelIndex === ROOMS_PANEL_INDEX || roomsTabVisited) &&
                      protocol === 'meshcore' ? (
                        <ErrorBoundary>
                          <Suspense fallback={<PanelSkeleton />}>
                            <div
                              className="h-full w-full min-w-0"
                              hidden={activePanelIndex !== ROOMS_PANEL_INDEX}
                            >
                              <RoomsPanel
                                nodes={meshcoreUiNodes}
                                messages={meshcoreUiMessages}
                                myNodeNum={meshcoreRuntime.selfNodeId}
                                isConnected={isOperational}
                                connectionType={meshcoreConnectionView.state.connectionType}
                                isActive={activePanelIndex === ROOMS_PANEL_INDEX}
                                initialRoomTarget={pendingRoomTarget}
                                onInitialRoomConsumed={handleRoomTargetConsumed}
                                onLoginRoom={meshcorePanelActions.loginRoom}
                                onLoginAllSaved={meshcorePanelActions.loginAllSavedRooms}
                                onCancelRoomLogin={meshcorePanelActions.cancelRoomLogin}
                                onLeaveRoom={meshcorePanelActions.leaveRoom}
                                onSendRoomPost={meshcorePanelActions.sendRoomPost}
                                onSendRoomAdminCli={meshcorePanelActions.sendRoomAdminCliCommand}
                                meshcoreCliHistories={meshcoreRuntime.meshcoreCliHistories}
                                meshcoreCliErrors={meshcoreRuntime.meshcoreCliErrors}
                                onClearCliHistory={meshcorePanelActions.clearCliHistory}
                                onMessageNode={handleMessageNode}
                                onToggleFavorite={meshcorePanelActions.setNodeFavorited}
                                scrollToTopRef={scrollToTopRoomsRef}
                                outerScrollMetricsRootRef={mainViewportRef}
                                compactMode={chatCompactMode}
                              />
                            </div>
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
                            <TelemetryPanel
                              telemetry={activeRuntime.telemetry}
                              signalTelemetry={activeRuntime.signalTelemetry}
                              environmentTelemetry={activeRuntime.environmentTelemetry}
                              useFahrenheit={useFahrenheit}
                              onToggleFahrenheit={toggleFahrenheit}
                              onRefresh={panelActions.requestRefresh}
                              isConnected={isOperational}
                              capabilities={capabilities}
                              meshcorePacketStats={
                                protocol === 'meshcore' ? meshcoreRuntime.meshcoreLocalStats : null
                              }
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
                            {configureNodeSelector}
                            <SecurityPanel
                              configTarget={configTarget}
                              onSetConfig={panelActions.setConfig}
                              onCommit={panelActions.commitConfig}
                              isConnected={isOperational}
                              securityConfig={effectiveSecurityConfig}
                              protocol={protocol}
                              localNodeNum={
                                protocol === 'meshtastic'
                                  ? meshtasticConnectionView.state.myNodeNum
                                  : undefined
                              }
                              localNodeLabel={
                                protocol === 'meshtastic'
                                  ? (nodesForUi.get(meshtasticConnectionView.state.myNodeNum)
                                      ?.long_name ?? undefined)
                                  : meshcoreRuntime.selfInfo?.name
                              }
                              meshcorePublicKey={meshcoreRuntime.selfInfo?.publicKey ?? null}
                              meshcoreNodeId={
                                protocol === 'meshcore'
                                  ? meshcoreConnectionView.state.myNodeNum
                                  : undefined
                              }
                              onSignData={
                                protocol === 'meshcore' ? meshcorePanelActions.signData : undefined
                              }
                              onExportPrivateKey={
                                protocol === 'meshcore'
                                  ? meshcorePanelActions.exportPrivateKey
                                  : undefined
                              }
                              onImportPrivateKey={
                                protocol === 'meshcore'
                                  ? meshcorePanelActions.importPrivateKey
                                  : undefined
                              }
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
                            <TakServerPanel
                              atakMessages={activeRuntime.atakMessages}
                              capabilities={capabilities}
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
                      {activePanelIndex === 11 ? (
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
                              messageCount={activeUiMessages.length}
                              channels={activeRuntime.channels}
                              myNodeNum={activeRuntime.state.myNodeNum}
                              onLocationFilterChange={handleLocationFilterChange}
                              ourPosition={activeRuntime.ourPosition}
                              onRefreshGps={panelActions.refreshOurPosition}
                              gpsLoading={activeRuntime.gpsLoading}
                              onGpsIntervalChange={activeRuntime.updateGpsInterval}
                              onNodesPruned={refreshNodesFromDb}
                              onMessagesPruned={refreshMessagesFromDb}
                              onClearMeshcoreRepeaters={
                                protocol === 'meshcore'
                                  ? meshcorePanelActions.clearAllRepeaters
                                  : undefined
                              }
                              onAutoFloodAdvertIntervalChange={setAutoFloodAdvertIntervalHours}
                              onAutoFloodAdvertTypeChange={setAutoFloodAdvertType}
                              onChatCompactModeChange={handleChatCompactModeChange}
                            />
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
                      {activePanelIndex === 12 ? (
                        <ErrorBoundary>
                          <Suspense fallback={<PanelSkeleton />}>
                            <DiagnosticsPanel
                              nodes={nodesForDiagnostics}
                              meshcoreNodes={meshcoreUiNodes}
                              myNodeNum={activeRuntime.selfNodeId}
                              meshtasticListenerNodeId={
                                meshtasticRuntime.state.myNodeNum > 0
                                  ? meshtasticRuntime.state.myNodeNum
                                  : meshtasticRuntime.selfNodeId
                              }
                              onTraceRoute={panelActions.traceRoute}
                              isConnected={isOperational}
                              traceRouteResults={activeRuntime.traceRouteResults}
                              getFullNodeLabel={panelActions.getFullNodeLabel}
                              ourPosition={activeRuntime.ourPosition}
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
                      id="panel-13"
                      role="tabpanel"
                      aria-labelledby="tab-13"
                      hidden={activePanelIndex !== 13}
                      className="w-full min-w-0"
                    >
                      {activePanelIndex === 13 && capabilities.hasRawPacketLog ? (
                        <ErrorBoundary>
                          <Suspense fallback={<PanelSkeleton />}>
                            <div className="p-4">
                              {capabilities.protocol === 'meshcore' ? (
                                <PacketDistributionPanel
                                  variant="meshcore"
                                  packets={meshcoreRuntime.rawPackets}
                                  getNodeLabel={rawPacketGetNodeLabel}
                                />
                              ) : (
                                <PacketDistributionPanel
                                  variant="meshtastic"
                                  packets={meshtasticRuntime.rawPackets}
                                  getNodeLabel={rawPacketGetNodeLabel}
                                />
                              )}
                              {capabilities.protocol === 'meshtastic' && (
                                <ChannelUtilizationChart nodes={nodesForUi} />
                              )}
                            </div>
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
                    >
                      {activePanelIndex === 14 && capabilities.hasRawPacketLog ? (
                        <ErrorBoundary>
                          <Suspense fallback={<PanelSkeleton />}>
                            {capabilities.protocol === 'meshcore' ? (
                              <RawPacketLogPanel
                                variant="meshcore"
                                packets={meshcoreRuntime.rawPackets}
                                onClear={meshcorePanelActions.clearRawPackets}
                                getNodeLabel={rawPacketGetNodeLabel}
                                onNodeClick={setSelectedNodeId}
                                floodScopeHashtag={meshcoreFloodScopeHashtag}
                              />
                            ) : (
                              <RawPacketLogPanel
                                variant="meshtastic"
                                packets={meshtasticRuntime.rawPackets}
                                onClear={meshtasticPanelActions.clearRawPackets}
                                getNodeLabel={rawPacketGetNodeLabel}
                                onNodeClick={setSelectedNodeId}
                              />
                            )}
                          </Suspense>
                        </ErrorBoundary>
                      ) : null}
                    </div>
                    <div
                      id="panel-15"
                      role="tabpanel"
                      aria-labelledby="tab-15"
                      hidden={activePanelIndex !== 15}
                      className="w-full min-w-0"
                    >
                      {activePanelIndex === 15 ? (
                        <ErrorBoundary>
                          <Suspense fallback={<PanelSkeleton />}>
                            <RFHistogramsPanel nodes={nodesForUi} />
                          </Suspense>
                        </ErrorBoundary>
                      ) : null}
                    </div>
                    <div
                      id="panel-16"
                      role="tabpanel"
                      aria-labelledby="tab-16"
                      hidden={activePanelIndex !== 16}
                      className="w-full min-w-0"
                      style={{ height: 'calc(100vh - 140px)' }}
                    >
                      {activePanelIndex === 16 ? (
                        <ErrorBoundary>
                          <Suspense fallback={<PanelSkeleton />}>
                            <PeerGraphPanel
                              nodes={nodesForUi}
                              myNodeId={activeRuntime.selfNodeId}
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

            {showMainScrollTop &&
              activePanelIndex !== 1 &&
              activePanelIndex !== ROOMS_PANEL_INDEX && (
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
                    messageCount: activeUiMessages.length,
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
                ? meshcoreRuntime.deviceLogs
                : meshtasticRuntime.deviceLogs.map((d) => ({
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
            contacts={protocol === 'meshcore' ? meshcoreUiNodes : meshtasticUiNodes}
            selfNodeId={
              protocol === 'meshcore' ? meshcoreRuntime.selfNodeId : meshtasticRuntime.selfNodeId
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
            onRequestPosition={detailModalPanelActions.requestPosition}
            onTraceRoute={detailModalPanelActions.traceRoute}
            traceRouteHops={traceRouteHops}
            onDeleteNode={async (nodeNum) => {
              await detailModalPanelActions.deleteNode(nodeNum);
              setSelectedNodeId(null);
            }}
            onMessageNode={
              selectedNode?.node_id !== detailMyNodeNum && selectedNode?.hw_model !== 'Room'
                ? handleMessageNode
                : undefined
            }
            onOpenRoom={
              detailModalProtocol === 'meshcore' &&
              selectedNode?.hw_model === 'Room' &&
              selectedNode.node_id !== detailMyNodeNum
                ? handleOpenRoom
                : undefined
            }
            onLoginRoom={
              detailModalProtocol === 'meshcore' ? meshcorePanelActions.loginRoom : undefined
            }
            onToggleFavorite={detailModalPanelActions.setNodeFavorited}
            remoteAdminKey={
              detailModalProtocol === 'meshtastic' && selectedNode != null
                ? meshtasticRuntime.getRemoteAdminKeyForNode(selectedNode.node_id)
                : undefined
            }
            onSaveRemoteAdminKey={
              detailModalProtocol === 'meshtastic' && hasLocalMeshtasticRadio
                ? meshtasticRuntime.setRemoteAdminKeyForNode
                : undefined
            }
            hasRemoteAdminKey={
              detailModalProtocol === 'meshtastic' && selectedNode != null
                ? Boolean(meshtasticRuntime.getRemoteAdminKeyForNode(selectedNode.node_id))
                : false
            }
            onConfigureRemotely={
              detailModalProtocol === 'meshtastic' && hasLocalMeshtasticRadio
                ? (nodeNum) => {
                    meshtasticPanelActions.setConfigureTargetNodeNum(nodeNum);
                    setSelectedNodeId(null);
                    const radioTabIndex = meshtasticTabs.tabIndexToPanelIndex.findIndex(
                      (panelIndex) => panelIndex === TAB_SLOT_IDS.indexOf('Radio'),
                    );
                    if (radioTabIndex >= 0) {
                      setActiveTab(radioTabIndex);
                    }
                  }
                : undefined
            }
            isConnected={detailIsOperational}
            mqttConnected={detailConnectionView.mqttStatus === 'connected'}
            radioConnected={detailIsConnectedOrOperational}
            homeNode={detailHomeNode}
            neighborInfo={activeRuntime.neighborInfo}
            useFahrenheit={useFahrenheit}
            protocol={detailModalProtocol}
            meshcoreTraceResult={
              detailModalProtocol === 'meshcore' && selectedNode
                ? meshcoreRuntime.meshcoreTraceResults.get(selectedNode.node_id)
                : undefined
            }
            meshcorePingError={
              detailModalProtocol === 'meshcore' && selectedNode
                ? meshcoreRuntime.meshcorePingErrors.get(selectedNode.node_id)
                : undefined
            }
            meshcoreRepeaterStatus={
              detailModalProtocol === 'meshcore' && selectedNode
                ? meshcoreRuntime.meshcoreNodeStatus.get(selectedNode.node_id)
                : undefined
            }
            meshcoreStatusError={
              detailModalProtocol === 'meshcore' && selectedNode
                ? meshcoreRuntime.meshcoreStatusErrors.get(selectedNode.node_id)
                : undefined
            }
            onRequestRepeaterStatus={
              detailModalProtocol === 'meshcore'
                ? meshcorePanelActions.requestRepeaterStatus
                : undefined
            }
            meshcoreNodeTelemetry={
              detailModalProtocol === 'meshcore' && selectedNode
                ? meshcoreRuntime.meshcoreNodeTelemetry.get(selectedNode.node_id)
                : undefined
            }
            meshcoreTelemetryError={
              detailModalProtocol === 'meshcore' && selectedNode
                ? meshcoreRuntime.meshcoreTelemetryErrors.get(selectedNode.node_id)
                : undefined
            }
            onRequestTelemetry={
              detailModalProtocol === 'meshcore' ? meshcorePanelActions.requestTelemetry : undefined
            }
            meshcoreNeighbors={
              detailModalProtocol === 'meshcore' && selectedNode
                ? meshcoreRuntime.meshcoreNeighbors.get(selectedNode.node_id)
                : undefined
            }
            onRequestNeighbors={
              detailModalProtocol === 'meshcore' ? meshcorePanelActions.requestNeighbors : undefined
            }
            meshcoreNeighborError={
              detailModalProtocol === 'meshcore' && selectedNode
                ? meshcoreRuntime.meshcoreNeighborErrors.get(selectedNode.node_id)
                : undefined
            }
            paxCounterData={
              detailModalProtocol === 'meshtastic' ? activeRuntime.paxCounterData : undefined
            }
            detectionSensorEvents={
              detailModalProtocol === 'meshtastic' ? activeRuntime.detectionSensorEvents : undefined
            }
            mapReports={detailModalProtocol === 'meshtastic' ? activeRuntime.mapReports : undefined}
            onExportContact={
              detailModalProtocol === 'meshcore' ? meshcoreRuntime.exportContact : undefined
            }
            onShareContact={
              detailModalProtocol === 'meshcore' ? meshcoreRuntime.shareContact : undefined
            }
            meshcoreLocalStats={
              detailModalProtocol === 'meshcore' &&
              selectedNode?.node_id === meshcoreRuntime.state.myNodeNum
                ? meshcoreRuntime.meshcoreLocalStats
                : null
            }
            meshcoreManufacturerModel={
              detailModalProtocol === 'meshcore'
                ? meshcoreRuntime.state.manufacturerModel
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
  meshtasticMessages,
  meshcoreMessages,
}: {
  protocol: MeshProtocol;
  meshtasticMessages: ChatMessage[];
  meshcoreMessages: ChatMessage[];
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
      prevMeshtasticRef.current = meshtasticMessages.length;
      return;
    }
    const count = meshtasticMessages.length;
    if (isInitMeshtasticRef.current) {
      prevMeshtasticRef.current = count;
      if (count > 0) isInitMeshtasticRef.current = false;
      return;
    }
    if (count > prevMeshtasticRef.current) {
      const newMsgs = meshtasticMessages.slice(prevMeshtasticRef.current);
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
  }, [meshtasticMessages, protocol, addToast, t]);

  // Notify when MeshCore (inactive) gets new messages
  useEffect(() => {
    if (protocol === 'meshcore') {
      // Now active — reset tracking
      isInitMeshcoreRef.current = true;
      prevMeshcoreRef.current = meshcoreMessages.length;
      return;
    }
    const count = meshcoreMessages.length;
    if (isInitMeshcoreRef.current) {
      prevMeshcoreRef.current = count;
      if (count > 0) isInitMeshcoreRef.current = false;
      return;
    }
    if (count > prevMeshcoreRef.current) {
      const newMsgs = meshcoreMessages.slice(prevMeshcoreRef.current);
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
  }, [meshcoreMessages, protocol, addToast, t]);

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
  connectionLoss,
  reconnectAttempt,
  onReconnect,
}: {
  status: string;
  connectionLoss?: boolean;
  reconnectAttempt?: number;
  onReconnect: () => void;
}) {
  const { t } = useTranslation();

  if (status === 'disconnected' && connectionLoss) {
    return (
      <div className="flex items-center justify-between border-b border-red-700 bg-red-900/80 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-red-400">⚠</span>
          <span className="text-sm text-red-200">{t('connectionBanner.disconnectedLoss')}</span>
        </div>
        <button
          type="button"
          onClick={onReconnect}
          aria-label={t('connectionBanner.reconnect')}
          className="text-sm font-medium text-red-300 underline hover:text-red-100"
        >
          {t('connectionBanner.reconnect')}
        </button>
      </div>
    );
  }

  if (status === 'stale') {
    return (
      <div className="flex items-center justify-between border-b border-yellow-700 bg-yellow-900/80 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-yellow-400">⚠</span>
          <span className="text-sm text-yellow-200">{t('connectionBanner.staleLoss')}</span>
        </div>
        <button
          onClick={onReconnect}
          aria-label={t('connectionBanner.reconnect')}
          className="text-sm font-medium text-yellow-300 underline hover:text-yellow-100"
        >
          {t('connectionBanner.reconnect')}
        </button>
      </div>
    );
  }

  if (status === 'reconnecting') {
    return (
      <div className="flex items-center gap-2 border-b border-orange-700 bg-orange-900/80 px-4 py-2">
        <span className="inline-block animate-spin text-orange-400">⟳</span>
        <span className="animate-pulse text-sm text-orange-200">
          {t('connectionBanner.reconnectingAttempt', {
            attempt: reconnectAttempt ?? 1,
            max: 5,
          })}
        </span>
      </div>
    );
  }

  return null;
}
