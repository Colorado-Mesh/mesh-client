/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/purity, @typescript-eslint/no-confusing-void-expression */
import { create, toBinary } from '@bufbuild/protobuf';
import type { MeshDevice } from '@meshtastic/core';
import { Admin, Channel as ProtobufChannel, Config, Mesh, Portnums } from '@meshtastic/protobufs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  buildStoreForwardHistoryToRadioBytes,
  getLastSfHistoryFetchMs,
  MQTT_RECONNECT_BACKLOG_MS,
  mqttMessageTreatAsHistory,
  recordSfHistoryFetch,
  releaseStoreForwardHistoryRequest,
  reserveStoreForwardHistoryRequest,
  resolveAutoStoreForwardHistoryWindowMinutes,
  resolveStoreForwardServerFromObservedPackets,
  SF_AUTO_HISTORY_COOLDOWN_MS,
  SF_AUTO_HISTORY_MESSAGE_CAP,
  SF_AUTO_HISTORY_OFFLINE_MIN_MS,
  SF_MANUAL_HISTORY_MESSAGE_CAP,
  shouldAutoRequestStoreForwardHistoryOnHeartbeat,
  writeToRadioWithoutQueue,
} from '@/renderer/lib/meshtasticBacklogUtils';
import {
  hydrateLastRfSelfNodeIdFromAppSettings,
  loadPersistedLastRfSelfNodeId,
  mqttOnlyIdentitySource,
  resolveMeshtasticOutboundFromNodeId,
  resolveMqttOnlyFromNodeId,
} from '@/renderer/lib/meshtasticMqttIdentity';
import {
  buildMeshtasticMqttOnlyChannelState,
  loadMeshtasticMqttManualChannelPsks,
  meshtasticMqttChannelKeyEntries,
  meshtasticMqttChannelKeyEntriesFromManual,
  resolveMeshtasticMqttPublishFieldsForChannel,
  type ResolveMeshtasticMqttPublishOptions,
} from '@/renderer/lib/meshtasticMqttPublish';
import {
  type ApplyChannelSetResult,
  channelNameExists,
  countFreeChannelSlots,
  findNextFreeChannelSlot,
} from '@/shared/meshtasticChannelApply';
import {
  MESHTASTIC_CHANNEL_ROLE,
  type MeshtasticLoraConfig,
  type ParsedChannelSet,
} from '@/shared/meshtasticUrlEncoder';
import { isStoredMqttVirtualNodeId, randomMqttVirtualNodeId } from '@/shared/mqttVirtualNodeId';

import {
  formatMeshtasticNodeId,
  meshtasticShortNameAfterClearingDefault,
  preferNonEmptyTrimmedString,
} from '../../shared/nodeNameUtils';
import {
  MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG,
  meshtasticWireUint32AllowZero,
  sanitizeUnicodeReactionScalar,
} from '../../shared/reactionEmoji';
import {
  getAppSettingsRaw,
  mergeAppSetting,
  mergeAppSettingsPartial,
} from '../lib/appSettingsStorage';
import { MAX_IN_MEMORY_CHAT_MESSAGES, trimChatMessagesToMax } from '../lib/chatInMemoryBuffer';
import { getSerialPortFromMeshTransport, safeDisconnect } from '../lib/connection';
import { validateCoords } from '../lib/coordUtils';
import {
  getMergedNodesForForeignLoraDiagnostics,
  getMeshcoreDiagnosticsSelfNodeId,
} from '../lib/diagnosticsNodesRef';
import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import { matchForeignLoraFromMeshtasticLog } from '../lib/foreignLoraDetection';
import type { OurPosition } from '../lib/gpsSource';
import { readStoredStaticGps, resolveOurPosition } from '../lib/gpsSource';
import {
  hydrateMeshtasticMessagesFromDb,
  syncMeshtasticNodesMapToIdentityStore,
} from '../lib/hydrateIdentityStoresFromDb';
import { getIdentityIdForProtocol } from '../lib/identityByProtocol';
import type { MeshtasticIngestSession } from '../lib/ingest/meshtasticIngest';
import { rehydrateMeshtasticConnectionParamsFromStorage } from '../lib/lastConnectionStorage';
import { meshtasticTransportParams } from '../lib/meshIdentityBridge';
import { configureMeshtasticDeviceWithRetry } from '../lib/meshtastic/meshtasticConfigureRetry';
import {
  attachMeshtasticLegacyWireSubscriptions,
  type MeshtasticLegacyWireSubscriptionDeps,
} from '../lib/meshtastic/meshtasticLegacyWireSubscriptions';
import { normalizeMeshtasticMqttChatMessage } from '../lib/meshtastic/meshtasticMqttChatNormalize';
import { MeshtasticMqttClientProxyBridge } from '../lib/meshtastic/meshtasticMqttClientProxy';
import {
  isMeshtasticMqttProxyActive,
  mqttSettingsFromMeshtasticModuleConfig,
} from '../lib/meshtastic/meshtasticMqttModuleSettings';
import {
  meshtasticXmodemDownload,
  meshtasticXmodemUpload,
} from '../lib/meshtastic/meshtasticXmodemTransfer';
import { setRemoteAdminReadsActive } from '../lib/meshtasticBacklogUtils';
import { setMeshtasticConnectedMyNodeNum } from '../lib/meshtasticConnectedNodeRef';
import {
  loadMeshtasticMessagesFromDb,
  loadMeshtasticNodeMapFromDb,
  mergeMeshtasticDbHydrationWithLive,
} from '../lib/meshtasticDbCacheHydration';
import {
  findMeshtasticCrossTransportDuplicate,
  findMeshtasticStoreForwardDuplicate,
  mapMeshtasticCrossTransportUpgrade,
  meshtasticPacketDedupKey,
  meshtasticPacketIdsEqual,
  meshtasticStoreForwardContentMatch,
  normalizeMeshtasticPacketId,
} from '../lib/meshtasticMessageDedup';
import { shouldIngestMeshtasticMqttLive } from '../lib/meshtasticMqttLiveIngest';
import {
  createSerialTaskQueue,
  MeshtasticRemoteAdminClient,
  normalizeRemoteAdminError,
  type RemoteAdminSessionStatus,
  remoteConfigLoadingWatchdogMsForRoute,
  resolveMeshtasticDestPublicKeyBytes,
} from '../lib/meshtasticRemoteAdmin';
import {
  getMeshtasticRemoteAdminKeyForNode,
  isValidMeshtasticAdminKeyBase64,
  MESHTASTIC_REMOTE_ADMIN_KEY_SETTING_PREFIX,
  readMeshtasticRemoteAdminKeyMap,
  setMeshtasticRemoteAdminKeyForNode,
} from '../lib/meshtasticRemoteAdminKeyStorage';
import {
  fetchMeshtasticRemoteConfigChannelsTail,
  fetchMeshtasticRemoteConfigModules,
  fetchMeshtasticRemoteConfigOwner,
  fetchMeshtasticRemoteConfigSecurity,
  fetchMeshtasticRemoteConfigSnapshotRadio,
  mergeMeshtasticRemoteConfigSnapshots,
} from '../lib/meshtasticRemoteAdminSnapshot';
import { mergeMeshtasticTraceRouteIntoResultsMap } from '../lib/meshtasticTraceRouteLookupKeys';
import { consumeMqttUserDisconnect } from '../lib/mqttDisconnectIntent';
import { parseStoredJson } from '../lib/parseStoredJson';
import { MESHTASTIC_CAPABILITIES } from '../lib/radio/BaseRadioProvider';
import type { MeshtasticRawPacketEntry } from '../lib/rawPacketLogConstants';
import { reactionGlyphFromPicker } from '../lib/reactions';
import { enrichMeshtasticReplyPreviews, resolveMeshtasticWireReplyId } from '../lib/replyPreview';
import { rfConnectionTransportOpts } from '../lib/rfConnectionTypes';
import { registerMeshtasticSerialDisconnectTarget } from '../lib/serialDisconnectRouter';
import { escalateSerialReconnectExhaustion } from '../lib/serialPortRecovery';
import { loadLastSerialPortId } from '../lib/serialPortSignature';
import {
  clearMeshtasticOutboundTempId,
  registerMeshtasticSession,
  resolveMeshtasticOutboundStoreKey,
  trackMeshtasticOutboundTempId,
} from '../lib/sessions/meshtasticSession';
import { getStoredMeshProtocol } from '../lib/storedMeshProtocol';
import {
  chatMessageToMessageRecord,
  messageRecordsToChatMessages,
  messageRecordToChatMessage,
  neighborInfoEventsToRecordMap,
  nodeRecordsToMeshNodeMap,
  traceRouteEventsToResultsMap,
  waypointEventsToMeshWaypointMap,
} from '../lib/storeRecordAdapters';
import { delayUnlessSuspended } from '../lib/systemPowerState';
import { MESHTASTIC_POST_REBOOT_RECONNECT_DELAY_MS } from '../lib/timeConstants';
import { TransportManager } from '../lib/transport/TransportManager';
import type { StatusUpdateEvent } from '../lib/transport/types';
import type {
  ChatMessage,
  ConnectionType,
  DeviceState,
  EnvironmentTelemetryPoint,
  MeshNeighbor,
  MeshNode,
  MeshtasticRemoteConfigSnapshot,
  MeshWaypoint,
  MQTTStatus,
  NeighborInfoRecord,
  RemoteAdminStatus,
  RemoteConfigChannelsTailStatus,
  TelemetryPoint,
} from '../lib/types';
import {
  mirrorMqttStatusToConnection,
  setConnection,
  useConnectionStore,
} from '../stores/connectionStore';
import { useDeviceStore } from '../stores/deviceStore';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import {
  addMessage,
  renameMessageId,
  updateMessageMqttStatus,
  updateMessageStatus,
  upsertMessage,
  useMessageStore,
} from '../stores/messageStore';
import { patchNodeFavorited, useNodeStore } from '../stores/nodeStore';
import { usePositionHistoryStore } from '../stores/positionHistoryStore';

type ChannelType = Parameters<MeshDevice['setChannel']>[0];
type PositionType = Parameters<MeshDevice['setPosition']>[0];
type UserType = Parameters<MeshDevice['setOwner']>[0];
type WaypointType = Parameters<MeshDevice['sendWaypoint']>[0];
type RemoteConfigRoute = 'radio' | 'channelsTail' | 'owner' | 'security' | 'modules';

const BROADCAST_ADDR = 0xffffffff;

// ─── Connection watchdog thresholds (per transport) ────────────────
const BLE_STALE_THRESHOLD_MS = 90_000; // 90s — show warning
const BLE_DEAD_THRESHOLD_MS = 180_000; // 3min — trigger reconnect
const SERIAL_STALE_THRESHOLD_MS = 120_000; // 2min
const SERIAL_DEAD_THRESHOLD_MS = 180_000; // 3min — align with BLE/HTTP
// HTTP: align closer to BLE thresholds so WiFi behaves similarly for staleness/reconnect.
const HTTP_STALE_THRESHOLD_MS = 90_000; // 90s — show warning
const HTTP_DEAD_THRESHOLD_MS = 180_000; // 3min — trigger reconnect
const WATCHDOG_INTERVAL_MS = 15_000; // Check every 15s
const MAX_RECONNECT_ATTEMPTS = 5;

async function verifyMeshtasticRfLink(type: ConnectionType): Promise<boolean> {
  if (type !== 'ble') return true;
  if (typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('linux')) {
    return true;
  }
  try {
    return await window.electronAPI.isNobleBleConnected('meshtastic');
  } catch {
    // catch-no-log-ok Noble IPC may fail during teardown; treat as dead link
    return false;
  }
}

function getOrCreateVirtualNodeId(): number {
  const key = 'mesh-client:mqttVirtualNodeId';
  const existing = localStorage.getItem(key);
  if (existing) {
    const n = parseInt(existing, 10);
    if (isStoredMqttVirtualNodeId(n)) return n;
  }
  let id: number;
  if (typeof window !== 'undefined') {
    const buf = new Uint32Array(1);
    window.crypto.getRandomValues(buf);
    id = randomMqttVirtualNodeId(buf[0]);
  } else {
    id = randomMqttVirtualNodeId((Math.random() * 0xffffffff) >>> 0);
  }
  localStorage.setItem(key, String(id));
  return id;
}

function clearVirtualNodeId(): void {
  localStorage.removeItem('mesh-client:mqttVirtualNodeId');
}

export type RequestStoreForwardHistoryResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'no_server'
        | 'not_configured'
        | 'local_is_server'
        | 'send_failed'
        | 'cooldown'
        | 'offline_gate'
        | 'already_requested';
    };

const MQTT_ONLY_VIRTUAL_LONG_NAME = 'MQTT-only Virtual Address';
const ROLE_CLIENT = 0;
const ROLE_CLIENT_MUTE = 1;

function meshtasticMqttPublishOpts(
  mqttOnly: boolean,
): ResolveMeshtasticMqttPublishOptions | undefined {
  return mqttOnly ? { preferManualOverRadio: true } : undefined;
}

export function useMeshtasticRuntime() {
  const deviceRef = useRef<MeshDevice | null>(null);
  // Track own node number in a ref so event callbacks can access it
  // without relying on the private device.myNodeInfo property
  const myNodeNumRef = useRef<number>(0);
  // Use a ref for nodes so event callbacks always see the latest value
  const nodesRef = useRef<Map<number, MeshNode>>(new Map());
  // Track event unsubscribe functions for cleanup
  const unsubscribesRef = useRef<(() => void)[]>([]);
  /** Protocol ingress + ConnectionDriver handle registration (issues #375 / #377). */
  const meshtasticIngressDetachRef = useRef<(() => void) | null>(null);
  const meshtasticIngestSessionRef = useRef<MeshtasticIngestSession | null>(null);
  /** True when `connectionDriver.connect` opened the transport (serial/http). */
  const meshtasticDriverConnectedRef = useRef(false);
  /** Driver identity from connect until wire subscriptions bind the store identity. */
  const meshtasticPendingDriverIdentityRef = useRef<string | null>(null);
  const meshtasticIdentityIdRef = useRef<string | null>(null);
  const [meshtasticIdentityId, setMeshtasticIdentityId] = useState<string | null>(null);

  // ─── Connection watchdog refs ─────────────────────────────────
  const lastDataReceivedRef = useRef<number>(Date.now());
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const connectionParamsRef = useRef<{
    type: ConnectionType;
    httpAddress?: string;
    blePeripheralId?: string;
    lastSerialPortId?: string | null;
    serialPort?: SerialPort | null;
  } | null>(null);
  /** Cleared on successful connect; set when user explicitly disconnects (blocks auto-reconnect). */
  const meshtasticExplicitDisconnectRef = useRef(false);
  const isReconnectingRef = useRef<boolean>(false);
  const reconnectGenerationRef = useRef<number>(0);
  const postRebootRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postRebootRecoveryScheduledRef = useRef(false);
  const transportManagerRef = useRef<TransportManager | null>(null);
  const onStatusUpdateRef = useRef<(event: StatusUpdateEvent) => void>(() => {});
  // Tracks the tempId of an in-flight optimistic message (device path) so the echo can be skipped
  const pendingTempIdRef = useRef<number | undefined>(undefined);
  /** After device ack, optimistic `tempId` → RF `packet_id` so MQTT status callbacks still find the row. */
  const ackMeshPacketIdByTempIdRef = useRef<Map<number, number>>(new Map());
  const outboundSendByTempIdRef = useRef<
    Map<number, { sender_id: number; timestamp: number; payload: string; channel: number }>
  >(new Map());

  const meshtasticOutboundSendMatchesTempId = useCallback(
    (m: ChatMessage, tempId: number): boolean => {
      if (m.packetId === tempId) return true;
      const meta = outboundSendByTempIdRef.current.get(tempId);
      if (!meta) return false;
      return (
        m.sender_id === meta.sender_id &&
        m.channel === meta.channel &&
        m.payload === meta.payload &&
        Math.abs(m.timestamp - meta.timestamp) <= 120_000
      );
    },
    [],
  );
  // True while the device is in the configuring phase (replaying queued packets); messages
  // received during this window are historical and should not increment the unread counter.
  const isConfiguringRef = useRef<boolean>(false);
  const configureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── GPS tracking ─────────────────────────────────────────────
  const deviceGpsModeRef = useRef<number>(0); // 0=DISABLED,1=ENABLED,2=NOT_PRESENT
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshOurPositionRef = useRef<() => Promise<OurPosition | null>>(() =>
    Promise.resolve(null),
  );
  // ─── MQTT session tracking ────────────────────────────────────
  // Tracks current MQTT connection status in a ref for use in callbacks
  const mqttStatusRef = useRef<MQTTStatus>('disconnected');
  // Periodic NodeInfo broadcast when MQTT-only so other nodes see this client
  const mqttPresenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Initial 10-second delay before starting presence broadcasts — tracked so it can be cancelled on unmount
  const mqttPresenceInitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror channelConfigs state into a ref so MQTT callbacks don't have stale closures
  const channelConfigsRef = useRef<typeof channelConfigs>([]);
  // Nodes heard via RF this session — prevents MQTT-only flag from being set
  const rfHeardNodeIds = useRef<Set<number>>(new Set());
  const lastRfSelfNodeIdRef = useRef<number>(loadPersistedLastRfSelfNodeId());
  const virtualNodeIdRef = useRef<number>(getOrCreateVirtualNodeId());
  // Dedup map shared between RF and MQTT handlers
  const seenPacketIds = useRef<Map<string, number>>(new Map());
  /** Last time we sent a proactive NODEINFO_APP request for each node (debounce). */
  const lastNodeInfoRequestAtRef = useRef<Map<number, number>>(new Map());

  const [mqttStatus, setMqttStatus] = useState<MQTTStatus>('disconnected');
  const [mqttConnectionLoss, setMqttConnectionLoss] = useState(false);
  const [ourPosition, setOurPosition] = useState<OurPosition | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [deviceGpsMode, setDeviceGpsMode] = useState<number>(0);
  const [deviceFixedPosition, setDeviceFixedPosition] = useState<boolean | null>(null);
  const [telemetryDeviceUpdateInterval, setTelemetryDeviceUpdateInterval] = useState<number | null>(
    null,
  );

  const [state, setState] = useState<DeviceState>({
    status: 'disconnected',
    myNodeNum: 0,
    connectionType: null,
  });
  const [deviceOwner, setDeviceOwner] = useState<{
    longName: string;
    shortName: string;
    isLicensed: boolean;
  } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [nodes, setNodes] = useState<Map<number, MeshNode>>(new Map());
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const [signalTelemetry, setSignalTelemetry] = useState<TelemetryPoint[]>([]);
  const [environmentTelemetry, setEnvironmentTelemetry] = useState<EnvironmentTelemetryPoint[]>([]);
  const [traceRouteResults, setTraceRouteResults] = useState<
    Map<number, { route: number[]; from: number; timestamp: number }>
  >(new Map());
  const pendingTraceRequestsRef = useRef<Map<number, number>>(new Map());
  /** Outbound trace packet id (`traceRoute()` return) → user-requested destination node */
  const pendingTracePacketIdToTargetRef = useRef<Map<number, number>>(new Map());
  const [channels, setChannels] = useState<{ index: number; name: string }[]>([
    { index: 0, name: 'Primary' },
  ]);
  const [channelConfigs, setChannelConfigs] = useState<
    {
      index: number;
      name: string;
      role: number;
      psk: Uint8Array;
      uplinkEnabled: boolean;
      downlinkEnabled: boolean;
      positionPrecision: number;
    }[]
  >([]);

  const [queueStatus, setQueueStatus] = useState<{
    free: number;
    maxlen: number;
    res: number;
  } | null>(null);
  const [deviceLogs, setDeviceLogs] = useState<
    { message: string; time: number; source: string; level: number }[]
  >([]);
  const [rawPackets, setRawPackets] = useState<MeshtasticRawPacketEntry[]>([]);
  const [neighborInfo, setNeighborInfo] = useState<Map<number, NeighborInfoRecord>>(new Map());
  const [waypoints, setWaypoints] = useState<Map<number, MeshWaypoint>>(new Map());
  const [moduleConfigs, setModuleConfigs] = useState<Record<string, unknown>>({});
  const moduleConfigsRef = useRef(moduleConfigs);
  const mqttClientProxyBridgeRef = useRef<MeshtasticMqttClientProxyBridge | null>(null);
  const sfHistoryRequestedServersRef = useRef<Set<number>>(new Set());
  const lastRfDisconnectAtRef = useRef<number | null>(null);
  const lastSfHeartbeatServerRef = useRef<number | null>(null);
  const lastSfHeartbeatChannelRef = useRef(0);
  const lastSfHeartbeatPeriodRef = useRef(0);
  const deviceConfiguredRef = useRef(false);
  const mqttReconnectBacklogUntilRef = useRef(0);
  const [securityConfig, setSecurityConfig] = useState<{
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    adminKey: Uint8Array[];
    isManaged: boolean;
    serialEnabled: boolean;
    debugLogApiEnabled: boolean;
    adminChannelEnabled: boolean;
  } | null>(null);
  const [configureTargetNodeNum, setConfigureTargetNodeNumState] = useState<number | null>(null);
  const configureTargetNodeNumRef = useRef<number | null>(null);
  const configureTargetPersistRestoredRef = useRef(false);
  const skipLocalLoraConfigRef = useRef(false);
  const localLoraConfigTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [remoteAdminStatus, setRemoteAdminStatus] = useState<RemoteAdminStatus>('idle');
  const remoteAdminStatusRef = useRef<RemoteAdminStatus>('idle');
  const [remoteAdminError, setRemoteAdminError] = useState<string | undefined>();
  const [remoteConfigSnapshot, setRemoteConfigSnapshot] =
    useState<MeshtasticRemoteConfigSnapshot | null>(null);
  const remoteAdminClientRef = useRef<MeshtasticRemoteAdminClient | null>(null);
  const remoteConfigFetchGenerationRef = useRef(0);
  const remoteConfigLoadedRoutesRef = useRef<Set<RemoteConfigRoute>>(new Set());
  const remoteConfigInflightRoutesRef = useRef<Set<RemoteConfigRoute>>(new Set());
  const remoteConfigFetchChainRef = useRef(createSerialTaskQueue());
  const [remoteConfigChannelsTailStatus, setRemoteConfigChannelsTailStatus] =
    useState<RemoteConfigChannelsTailStatus>('idle');
  const [remoteAdminKeysByNode, setRemoteAdminKeysByNode] = useState<Record<string, string>>({});
  const remoteAdminKeysByNodeRef = useRef<Record<string, string>>({});
  const [loraConfig, setLoraConfig] = useState<MeshtasticLoraConfig | null>(null);
  const loraConfigRef = useRef<MeshtasticLoraConfig | null>(null);
  loraConfigRef.current = loraConfig;

  // ─── Additional packet type state ─────────────────────────────────
  const [remoteHardwareMessages, setRemoteHardwareMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [audioMessages, setAudioMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [detectionSensorEvents, setDetectionSensorEvents] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [pingResponses, setPingResponses] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }>
  >(new Map());
  const [ipTunnelMessages, setIpTunnelMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [paxCounterData, setPaxCounterData] = useState<
    Map<number, { from: number; count: number; timestamp: number }>
  >(new Map());
  const [serialMessages, setSerialMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [storeForwardMessages, setStoreForwardMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const storeForwardMessagesRef = useRef(storeForwardMessages);
  const [rangeTestPackets, setRangeTestPackets] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [zpsMessages, setZpsMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [simulatorPackets, setSimulatorPackets] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [atakMessages, setAtakMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());
  const [mapReports, setMapReports] = useState<
    Map<number, { from: number; data: unknown; timestamp: number }>
  >(new Map());
  const [privateMessages, setPrivateMessages] = useState<
    Map<number, { from: number; data: Uint8Array; timestamp: number }[]>
  >(new Map());

  const ensureNonConflictingVirtualNodeId = useCallback((): number => {
    let virtualId = virtualNodeIdRef.current;
    const conflictsWithKnownRfNode = (id: number): boolean => {
      const existing = nodesRef.current.get(id);
      return !!existing && existing.source === 'rf' && id !== myNodeNumRef.current;
    };
    if (conflictsWithKnownRfNode(virtualId)) {
      clearVirtualNodeId();
      do {
        virtualId = getOrCreateVirtualNodeId();
      } while (conflictsWithKnownRfNode(virtualId));
      virtualNodeIdRef.current = virtualId;
    }
    return virtualId;
  }, []);

  // Keep nodesRef in sync with state and identity-scoped nodeStore (App reads via useNodeStore).
  const updateNodes = useCallback(
    (updater: (prev: Map<number, MeshNode>) => Map<number, MeshNode>) => {
      setNodes((prev) => {
        const next = updater(prev);
        nodesRef.current = next;
        return next;
      });
    },
    [],
  );

  // Push runtime node map into identity-scoped Zustand after commit — never inside setState updaters.
  useEffect(() => {
    const storeId = meshtasticIdentityIdRef.current ?? meshtasticPendingDriverIdentityRef.current;
    if (!storeId) return;
    syncMeshtasticNodesMapToIdentityStore(storeId, nodes);
  }, [nodes, meshtasticIdentityId]);

  const ensureNodeExists = useCallback(
    (nodeNum: number, source: 'rf' | 'mqtt') => {
      if (nodesRef.current.has(nodeNum) || nodeNum === 0) return;
      updateNodes((prev) => {
        if (prev.has(nodeNum)) return prev;
        const created = createChatStubNode(nodeNum, source);
        const next = new Map(prev);
        next.set(nodeNum, created);
        void window.electronAPI.db.saveNode(created);
        return next;
      });
    },
    [updateNodes],
  );

  // Keep channelConfigsRef in sync so MQTT callbacks always see current config
  useEffect(() => {
    channelConfigsRef.current = channelConfigs;
  }, [channelConfigs]);

  const pushMqttChannelKeys = useCallback(() => {
    if (mqttStatusRef.current !== 'connected') return;
    let entries = meshtasticMqttChannelKeyEntries(channelConfigsRef.current);
    if (entries.length === 0) {
      entries = meshtasticMqttChannelKeyEntriesFromManual();
    }
    if (entries.length === 0) return;
    void window.electronAPI.mqtt.updateChannelKeys({ entries }).catch((e: unknown) => {
      console.warn('[useMeshtasticRuntime] mqtt.updateChannelKeys failed ' + errLikeToLogString(e));
    });
  }, []);

  useEffect(() => {
    void hydrateLastRfSelfNodeIdFromAppSettings().then((nodeNum) => {
      if (nodeNum > 0) lastRfSelfNodeIdRef.current = nodeNum;
    });
  }, []);

  useEffect(() => {
    pushMqttChannelKeys();
  }, [channelConfigs, mqttStatus, pushMqttChannelKeys]);

  // ─── Packet dedup helper (shared by RF and MQTT handlers) ──────
  const isDuplicate = useCallback((senderId: number, packetId: number): boolean => {
    const now = Date.now();
    const key = meshtasticPacketDedupKey(senderId, packetId);
    const expiry = seenPacketIds.current.get(key);
    if (expiry !== undefined && expiry > now) return true;
    seenPacketIds.current.set(key, now + 10 * 60 * 1000);
    // Periodic cleanup to prevent unbounded growth
    if (seenPacketIds.current.size > 5_000) {
      for (const [id, exp] of seenPacketIds.current) {
        if (exp < now) seenPacketIds.current.delete(id);
      }
    }
    return false;
  }, []);

  // Compact display name: short_name, truncated long_name, or hex ID
  const getNodeName = useCallback((nodeNum: number): string => {
    const node = nodesRef.current.get(nodeNum);
    if (node?.short_name) return node.short_name;
    if (node?.long_name)
      return node.long_name.length > 7 ? node.long_name.slice(0, 7) : node.long_name;
    return formatMeshtasticNodeId(nodeNum);
  }, []);

  // Picker-style label: "icon_XXXX" (same format as BLE picker). If short_name
  // already ends with _ + 4 hex digits, use it; else append _ + last 4 hex of node ID.
  const getPickerStyleNodeLabel = useCallback((nodeNum: number): string => {
    const node = nodesRef.current.get(nodeNum);
    const fourHex = nodeNum.toString(16).slice(-4);
    if (node?.short_name) {
      if (/_[0-9a-fA-F]{4}$/.test(node.short_name)) return node.short_name;
      return `${node.short_name}_${fourHex}`;
    }
    if (node?.long_name)
      return node.long_name.length > 7
        ? `${node.long_name.slice(0, 7)}_${fourHex}`
        : `${node.long_name}_${fourHex}`;
    return formatMeshtasticNodeId(nodeNum);
  }, []);

  // Extended label: short_name + hex suffix, long_name, or hex fallback.
  // Used in the header for the connected node display.
  const getFullNodeLabel = useCallback((nodeNum: number): string => {
    const node = nodesRef.current.get(nodeNum);
    const hexId = formatMeshtasticNodeId(nodeNum);
    if (node?.short_name) {
      // Avoid double-appending hex if short_name already contains it
      return node.short_name.includes(hexId) ? node.short_name : `${node.short_name} ${hexId}`;
    }
    if (node?.long_name) return node.long_name;
    return hexId;
  }, []);

  // ─── Mark data as freshly received ────────────────────────────
  const touchLastData = useCallback(() => {
    lastDataReceivedRef.current = Date.now();
    // If we were in "stale" state, recover to "configured"
    setState((s) => {
      if (s.status === 'stale') {
        console.debug('[useMeshtasticRuntime] watchdog: recovered from stale → configured');
        return { ...s, status: 'configured', lastDataReceived: Date.now() };
      }
      return s;
    });
  }, []);

  /** Meshtastic `DeviceMetrics.batteryLevel`: 0–100; values above 100 mean USB powered (protobuf). */
  const applyOwnNodeBatteryFromDeviceMetrics = useCallback((batteryLevel: number) => {
    const charging = batteryLevel > 100;
    const pct = Math.min(100, batteryLevel);
    setState((s) => ({ ...s, batteryPercent: pct, batteryCharging: charging }));
  }, []);

  // ─── Helper: clean up all event subscriptions ───────────────────
  const cleanupSubscriptions = useCallback(() => {
    if (meshtasticIngestSessionRef.current) {
      meshtasticIngestSessionRef.current.detach();
      meshtasticIngestSessionRef.current = null;
    }
    if (meshtasticIngressDetachRef.current) {
      try {
        meshtasticIngressDetachRef.current();
      } catch (e) {
        console.debug(
          '[useMeshtasticRuntime] ingress detach error (ignored) ' + errLikeToLogString(e),
        );
      }
      meshtasticIngressDetachRef.current = null;
    }
    meshtasticIdentityIdRef.current = null;
    meshtasticDriverConnectedRef.current = false;
    setMeshtasticIdentityId(null);
    for (const unsub of unsubscribesRef.current) {
      try {
        unsub();
      } catch (e) {
        console.debug(
          '[useMeshtasticRuntime] unsubscribe error (ignored) ' + errLikeToLogString(e),
        );
      }
    }
    unsubscribesRef.current = [];
    ackMeshPacketIdByTempIdRef.current.clear();
    outboundSendByTempIdRef.current.clear();
  }, []);

  const clearConfigureTimeout = useCallback(() => {
    if (configureTimeoutRef.current) {
      clearTimeout(configureTimeoutRef.current);
      configureTimeoutRef.current = null;
    }
  }, []);

  // ─── Watchdog: get thresholds per transport type ──────────────
  const getThresholds = useCallback(() => {
    const type = connectionParamsRef.current?.type;
    switch (type) {
      case 'ble':
        return { stale: BLE_STALE_THRESHOLD_MS, dead: BLE_DEAD_THRESHOLD_MS };
      case 'serial':
        return { stale: SERIAL_STALE_THRESHOLD_MS, dead: SERIAL_DEAD_THRESHOLD_MS };
      case 'http':
        return { stale: HTTP_STALE_THRESHOLD_MS, dead: HTTP_DEAD_THRESHOLD_MS };
      default:
        return { stale: 90_000, dead: 180_000 };
    }
  }, []);

  // ─── Watchdog: stop watchdog ──────────────────────────────────
  const stopWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  // ─── GPS interval management ───────────────────────────────────
  const stopGpsInterval = useCallback(() => {
    if (gpsIntervalRef.current) {
      clearInterval(gpsIntervalRef.current);
      gpsIntervalRef.current = null;
    }
  }, []);

  const startGpsInterval = useCallback(() => {
    stopGpsInterval();
    try {
      const gpsParsed = parseStoredJson<{ refreshInterval?: number }>(
        localStorage.getItem('mesh-client:gpsSettings'),
        'useMeshtasticRuntime startGpsInterval',
      );
      const intervalSecs = gpsParsed?.refreshInterval ?? 0;
      if (intervalSecs > 0) {
        gpsIntervalRef.current = setInterval(() => {
          // Dual-protocol: avoid host IP/geo refresh churn while MeshCore is the active UI protocol.
          if (getStoredMeshProtocol() !== 'meshtastic') return;
          refreshOurPositionRef.current().catch((err: unknown) => {
            console.error(
              '[useMeshtasticRuntime] GPS interval refresh error: ' + errLikeToLogString(err),
            );
          });
        }, intervalSecs * 1000);
      }
    } catch {
      // catch-no-log-ok localStorage read for GPS interval setting — ignore parse errors
    }
  }, [stopGpsInterval]);

  // ─── Forward declarations for mutual recursion ────────────────
  const handleConnectionLostRef = useRef<() => void>(() => {});
  const attemptReconnectRef = useRef<() => Promise<void>>(async () => {});
  const schedulePostCommitRebootRecoveryRef = useRef<(source?: string) => void>(() => {});
  const clearPostCommitRebootRecoveryRef = useRef<() => void>(() => {});

  const clearPostCommitRebootRecovery = useCallback(() => {
    if (postRebootRecoveryTimerRef.current != null) {
      clearTimeout(postRebootRecoveryTimerRef.current);
      postRebootRecoveryTimerRef.current = null;
    }
    postRebootRecoveryScheduledRef.current = false;
  }, []);

  const schedulePostCommitRebootRecovery = useCallback(
    (source = 'unknown') => {
      const params = connectionParamsRef.current;
      if (!params || (params.type !== 'ble' && params.type !== 'serial')) return;
      if (isReconnectingRef.current) return;
      if (source !== 'DeviceRestarting' && postRebootRecoveryScheduledRef.current) return;

      postRebootRecoveryScheduledRef.current = true;
      deviceConfiguredRef.current = false;
      isConfiguringRef.current = true;
      meshtasticIngestSessionRef.current?.setConfiguring(true);
      stopWatchdog();
      stopGpsInterval();

      console.warn(
        `[useMeshtasticRuntime] post-commit reboot recovery scheduled (${source}) — ` +
          `transport reset in ${MESHTASTIC_POST_REBOOT_RECONNECT_DELAY_MS}ms`,
      );

      if (postRebootRecoveryTimerRef.current != null) {
        clearTimeout(postRebootRecoveryTimerRef.current);
      }
      postRebootRecoveryTimerRef.current = setTimeout(() => {
        postRebootRecoveryTimerRef.current = null;
        postRebootRecoveryScheduledRef.current = false;
        if (!connectionParamsRef.current) return;
        handleConnectionLostRef.current();
      }, MESHTASTIC_POST_REBOOT_RECONNECT_DELAY_MS);
    },
    [stopWatchdog, stopGpsInterval],
  );

  clearPostCommitRebootRecoveryRef.current = clearPostCommitRebootRecovery;
  schedulePostCommitRebootRecoveryRef.current = schedulePostCommitRebootRecovery;

  // ─── Watchdog: start monitoring data freshness ────────────────
  const startWatchdog = useCallback(() => {
    if (watchdogRef.current) return;
    watchdogRef.current = setInterval(() => {
      if (isReconnectingRef.current) return;
      const elapsed = Date.now() - lastDataReceivedRef.current;
      const { stale, dead } = getThresholds();
      const transport = connectionParamsRef.current?.type ?? 'unknown';
      if (elapsed > dead) {
        console.warn(
          `[useMeshtasticRuntime] watchdog: ${transport} dead for ${elapsed}ms, triggering reconnect`,
        );
        handleConnectionLostRef.current();
      } else if (elapsed > stale) {
        console.warn(`[useMeshtasticRuntime] watchdog: ${transport} stale for ${elapsed}ms`);
        setState((s) => {
          if (s.status === 'configured' || s.status === 'connected') {
            return { ...s, status: 'stale', lastDataReceived: lastDataReceivedRef.current };
          }
          return s;
        });
      }
    }, WATCHDOG_INTERVAL_MS);
  }, [getThresholds]);

  useEffect(() => {
    moduleConfigsRef.current = moduleConfigs;
  }, [moduleConfigs]);

  useEffect(() => {
    mqttClientProxyBridgeRef.current = new MeshtasticMqttClientProxyBridge({
      isProxyActive: () => isMeshtasticMqttProxyActive(moduleConfigsRef.current),
      isDeviceConfigured: () => deviceConfiguredRef.current,
      publishToBroker: async (args) => {
        await window.electronAPI.mqtt.publishProxy(args);
      },
      writeToRadio: async (bytes) => {
        const device = deviceRef.current;
        if (!device) throw new Error('No Meshtastic device for MQTT proxy downlink');
        await writeToRadioWithoutQueue(device, bytes);
      },
    });
    return () => {
      mqttClientProxyBridgeRef.current?.clearPending();
      mqttClientProxyBridgeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isMeshtasticMqttProxyActive(moduleConfigs)) return;
    if (!deviceRef.current || state.status !== 'configured') return;
    const settings = mqttSettingsFromMeshtasticModuleConfig(moduleConfigs);
    if (!settings) return;
    if (mqttStatusRef.current === 'connected' || mqttStatusRef.current === 'connecting') return;
    void window.electronAPI.mqtt.connect(settings).catch((e: unknown) => {
      console.warn(
        '[useMeshtasticRuntime] MQTT proxy gateway connect failed ' + errLikeToLogString(e),
      );
    });
  }, [moduleConfigs, state.status]);

  useEffect(() => {
    configureTargetNodeNumRef.current = configureTargetNodeNum;
  }, [configureTargetNodeNum]);

  useEffect(() => {
    remoteAdminStatusRef.current = remoteAdminStatus;
  }, [remoteAdminStatus]);

  useEffect(() => {
    remoteAdminKeysByNodeRef.current = remoteAdminKeysByNode;
  }, [remoteAdminKeysByNode]);

  useEffect(() => {
    if (state.status !== 'configured') return;
    const map = readMeshtasticRemoteAdminKeyMap();
    setRemoteAdminKeysByNode(map);
    remoteAdminKeysByNodeRef.current = map;
  }, [state.status]);

  useEffect(() => {
    if (state.status !== 'configured') return;
    void window.electronAPI.appSettings
      .getAll()
      .then((all) => {
        const partial: Record<string, string> = {};
        for (const [key, value] of Object.entries(all)) {
          if (
            key.startsWith(MESHTASTIC_REMOTE_ADMIN_KEY_SETTING_PREFIX) &&
            typeof value === 'string' &&
            value.trim() !== ''
          ) {
            partial[key] = value;
          }
        }
        if (Object.keys(partial).length === 0) return;
        mergeAppSettingsPartial(partial, 'useMeshtasticRuntime hydrate remote admin keys');
        const map = readMeshtasticRemoteAdminKeyMap();
        setRemoteAdminKeysByNode(map);
        remoteAdminKeysByNodeRef.current = map;
      })
      .catch((e: unknown) => {
        console.warn(
          '[useMeshtasticRuntime] hydrate remote admin keys failed ' + errLikeToLogString(e),
        );
      });
  }, [state.status]);

  useEffect(() => {
    remoteAdminClientRef.current = new MeshtasticRemoteAdminClient(
      () => deviceRef.current,
      () => myNodeNumRef.current,
      (nodeNum) =>
        resolveMeshtasticDestPublicKeyBytes({
          publicKeyHex: nodesRef.current.get(nodeNum)?.public_key_hex,
          adminKeyBase64: remoteAdminKeysByNodeRef.current[String(nodeNum)],
        }),
    );
    return () => {
      remoteAdminClientRef.current?.dispose();
      remoteAdminClientRef.current = null;
    };
  }, []);

  useEffect(() => {
    storeForwardMessagesRef.current = storeForwardMessages;
  }, [storeForwardMessages]);

  // ─── MQTT event subscriptions (independent of RF device) ──────
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.mqtt) {
      console.error(
        '[useMeshtasticRuntime] electronAPI.mqtt unavailable — preload not loaded; MQTT subscriptions skipped',
      );
      return;
    }

    const offlineMeshtasticId = getIdentityIdForProtocol('meshtastic');
    if (offlineMeshtasticId && !meshtasticIdentityIdRef.current) {
      meshtasticIdentityIdRef.current = offlineMeshtasticId;
      setMeshtasticIdentityId(offlineMeshtasticId);
    }

    const unsubStatus = api.mqtt.onStatus(({ status: s, protocol }) => {
      if (protocol !== 'meshtastic') return;
      const prev = mqttStatusRef.current;
      mqttStatusRef.current = s;
      setMqttStatus(s);
      mirrorMqttStatusToConnection(meshtasticIdentityIdRef.current, s);
      if (s === 'connected') {
        setMqttConnectionLoss(false);
        if (prev !== 'connected') {
          mqttReconnectBacklogUntilRef.current = Date.now() + MQTT_RECONNECT_BACKLOG_MS;
        }
        pushMqttChannelKeys();
      } else if (consumeMqttUserDisconnect()) {
        setMqttConnectionLoss(false);
      } else if (prev === 'connected') {
        setMqttConnectionLoss(true);
      }
      if (s !== 'connected') {
        setMessages((prev) =>
          prev.map((m) =>
            m.mqttStatus === 'sending' ? { ...m, mqttStatus: 'failed' as const } : m,
          ),
        );
      }
      if (s === 'connected' && !deviceRef.current) {
        rfHeardNodeIds.current.clear();
        startGpsInterval();
        const mqttOnlyState = buildMeshtasticMqttOnlyChannelState();
        if (mqttOnlyState.channelConfigs.length > 0) {
          const mqttOnlyConfigs = mqttOnlyState.channelConfigs.map((c) => ({
            index: c.index,
            name: c.name,
            role: c.role,
            psk: c.psk,
            uplinkEnabled: c.uplinkEnabled ?? true,
            downlinkEnabled: c.downlinkEnabled ?? true,
            positionPrecision: c.positionPrecision ?? 0,
          }));
          setChannels(mqttOnlyState.channels);
          setChannelConfigs(mqttOnlyConfigs);
          channelConfigsRef.current = mqttOnlyConfigs;
          pushMqttChannelKeys();
        }
        const persistedLastRf = loadPersistedLastRfSelfNodeId();
        if (persistedLastRf > 0) lastRfSelfNodeIdRef.current = persistedLastRf;
        const virtualId = ensureNonConflictingVirtualNodeId();
        const mqttOnlyId = resolveMqttOnlyFromNodeId(lastRfSelfNodeIdRef.current, virtualId);
        myNodeNumRef.current = mqttOnlyId;
        setState((prev) => ({ ...prev, myNodeNum: mqttOnlyId }));
        console.debug(
          `[useMeshtasticRuntime] MQTT-only identity: from=!${mqttOnlyId.toString(16).padStart(8, '0')} source=${mqttOnlyIdentitySource(lastRfSelfNodeIdRef.current)}`,
        );
        updateNodes((prev) => {
          const updated = new Map(prev);
          if (lastRfSelfNodeIdRef.current > 0 && mqttOnlyId === lastRfSelfNodeIdRef.current) {
            const staleVirtualId = virtualNodeIdRef.current;
            if (staleVirtualId !== mqttOnlyId) {
              updated.delete(staleVirtualId);
              void window.electronAPI.db.deleteNode(staleVirtualId).catch((e: unknown) => {
                console.debug(
                  '[useMeshtasticRuntime] deleteNode stale virtual ' + errLikeToLogString(e),
                );
              });
            }
            const existing = updated.get(mqttOnlyId) ?? emptyNode(mqttOnlyId);
            const rfNode: MeshNode = {
              ...existing,
              node_id: mqttOnlyId,
              role: existing.role ?? ROLE_CLIENT,
              hops_away: 0,
              via_mqtt: true,
              heard_via_mqtt: true,
              heard_via_mqtt_only: true,
            };
            updated.set(mqttOnlyId, rfNode);
            void window.electronAPI.db.saveNode(rfNode);
            return updated;
          }
          const existing = updated.get(virtualId) ?? emptyNode(virtualId);
          const virtualNode: MeshNode = {
            ...existing,
            node_id: virtualId,
            long_name: MQTT_ONLY_VIRTUAL_LONG_NAME,
            role: ROLE_CLIENT,
            hops_away: 0,
            source: 'mqtt',
            via_mqtt: true,
            heard_via_mqtt: true,
            heard_via_mqtt_only: true,
          };
          updated.set(virtualId, virtualNode);
          void window.electronAPI.db.saveNode(virtualNode);
          return updated;
        });
        // Periodic NodeInfo broadcast so other nodes see this client (every 5 min)
        if (mqttPresenceIntervalRef.current) clearInterval(mqttPresenceIntervalRef.current);
        const sendPresence = () => {
          if (deviceRef.current || mqttStatusRef.current !== 'connected') {
            if (mqttPresenceIntervalRef.current) {
              clearInterval(mqttPresenceIntervalRef.current);
              mqttPresenceIntervalRef.current = null;
            }
            return;
          }
          const presenceFrom = resolveMqttOnlyFromNodeId(
            lastRfSelfNodeIdRef.current,
            virtualNodeIdRef.current,
          );
          const selfNode = nodesRef.current.get(presenceFrom);
          const useRealIdentity =
            lastRfSelfNodeIdRef.current > 0 && presenceFrom === lastRfSelfNodeIdRef.current;
          const presenceMqtt = resolveMeshtasticMqttPublishFieldsForChannel(
            0,
            channelConfigsRef.current,
            loadMeshtasticMqttManualChannelPsks(),
            meshtasticMqttPublishOpts(true),
          );
          if (!presenceMqtt.channelName) return;
          window.electronAPI.mqtt
            .publishNodeInfo({
              from: presenceFrom,
              longName:
                useRealIdentity && selfNode?.long_name
                  ? selfNode.long_name
                  : MQTT_ONLY_VIRTUAL_LONG_NAME,
              shortName: useRealIdentity && selfNode?.short_name ? selfNode.short_name : 'MQTT',
              channelName: presenceMqtt.channelName,
              pskBase64: presenceMqtt.pskBase64,
              publishJsonMirror: presenceMqtt.publishJsonMirror,
            })
            .catch((e: unknown) => {
              console.warn(
                '[useMeshtasticRuntime] MQTT presence publish failed ' + errLikeToLogString(e),
              );
            });
        };
        if (mqttPresenceInitTimerRef.current) clearTimeout(mqttPresenceInitTimerRef.current);
        // Announce immediately so early MQTT-only messages are not dropped by peers awaiting node identity.
        sendPresence();
        mqttPresenceInitTimerRef.current = setTimeout(sendPresence, 10_000);
        mqttPresenceIntervalRef.current = setInterval(sendPresence, 5 * 60 * 1000);
      } else if (s !== 'connected') {
        if (!deviceRef.current) {
          myNodeNumRef.current = 0;
          setMeshtasticConnectedMyNodeNum(0);
          setState((prev) => ({ ...prev, myNodeNum: 0 }));
        }
        if (mqttPresenceIntervalRef.current) {
          clearInterval(mqttPresenceIntervalRef.current);
          mqttPresenceIntervalRef.current = null;
        }
      }
    });

    const unsubNode = window.electronAPI.mqtt.onNodeUpdate((rawNode) => {
      if (!shouldIngestMeshtasticMqttLive(getStoredMeshProtocol(), !!deviceRef.current)) {
        return;
      }
      const nodeUpdate = rawNode as Partial<MeshNode> & {
        node_id: number;
        from_mqtt?: boolean;
        protocol?: 'meshtastic' | 'meshcore';
        positionWarning?: string | null;
        neighbors?: MeshNeighbor[];
        portnum?: number;
      };
      if (!nodeUpdate.node_id) return;

      // Record noisy portnums from MQTT for diagnostics
      if (nodeUpdate.portnum != null) {
        useDiagnosticsStore.getState().recordNoisePort(nodeUpdate.node_id, nodeUpdate.portnum);
      }

      // Skip if protocol doesn't match current mode (backward compat: no protocol = process)
      if (nodeUpdate.protocol && nodeUpdate.protocol !== getStoredMeshProtocol()) {
        return;
      }

      // Handle neighbor info from MQTT
      if (nodeUpdate.neighbors && nodeUpdate.neighbors.length > 0) {
        setNeighborInfo((prev) => {
          const existing = prev.get(nodeUpdate.node_id);
          // Only merge if no RF neighbor info exists
          if (existing && existing.neighbors.length > 0) {
            return prev;
          }
          const updated = new Map(prev);
          updated.set(nodeUpdate.node_id, {
            nodeId: nodeUpdate.node_id,
            neighbors: nodeUpdate.neighbors ?? [],
            timestamp: Date.now(),
          });
          return updated;
        });
      }

      updateNodes((prev) => {
        const existing = prev.get(nodeUpdate.node_id) ?? emptyNode(nodeUpdate.node_id);
        const heardViaRF = rfHeardNodeIds.current.has(nodeUpdate.node_id);
        const isActiveVirtualIdentity =
          !deviceRef.current && nodeUpdate.node_id === virtualNodeIdRef.current;
        const updated = new Map(prev);
        const node: MeshNode = {
          ...existing,
          ...nodeUpdate,
          heard_via_mqtt_only: isActiveVirtualIdentity ? true : !heardViaRF,
          via_mqtt: true,
          heard_via_mqtt: true,
          source: isActiveVirtualIdentity ? 'mqtt' : heardViaRF ? 'rf' : 'mqtt',
          last_heard: nodeUpdate.last_heard ?? Date.now(),
          long_name: preferNonEmptyTrimmedString(nodeUpdate.long_name, existing.long_name, {
            nodeId: nodeUpdate.node_id,
          }),
          // Explicitly handle role to ensure it's properly updated from MQTT
          role: nodeUpdate.role ?? existing.role,
          // MeshCore routing info: derive hops from path if needed
          hops: nodeUpdate.hops ?? (nodeUpdate.path ? nodeUpdate.path.length : existing.hops),
          path: nodeUpdate.path ?? existing.path,
        };
        // Ensure hops_away is updated for UI consistency
        node.hops_away = node.hops ?? nodeUpdate.hops_away ?? existing.hops_away;

        // Don't overwrite RF signal data with MQTT-sourced node data
        if (!heardViaRF) {
          // MQTT-only: suppress device-local RF metrics; hops_away from binary MQTT is valid
          node.snr = existing.snr;
          node.rssi = existing.rssi;
        }
        // Validate position if the update includes coords
        if (nodeUpdate.latitude != null || nodeUpdate.longitude != null) {
          const lat = nodeUpdate.latitude ?? 0;
          const lon = nodeUpdate.longitude ?? 0;
          const r = validateCoords(lat, lon);
          if (!r.valid) {
            node.latitude = existing.latitude;
            node.longitude = existing.longitude;
            node.lastPositionWarning = r.warning;
          } else {
            node.lastPositionWarning = undefined;
          }
        }
        // Apply positionWarning emitted by mqtt-manager (bad coords, no position change)
        if (nodeUpdate.positionWarning) {
          node.lastPositionWarning = nodeUpdate.positionWarning;
        } else if (nodeUpdate.positionWarning === null) {
          node.lastPositionWarning = undefined;
        }
        node.short_name = meshtasticShortNameAfterClearingDefault(
          node.long_name ?? '',
          node.short_name ?? '',
          node.node_id,
        );
        updated.set(nodeUpdate.node_id, node);
        void window.electronAPI.db.saveNode(node);
        return updated;
      });
      const updatedMqttNode = nodesRef.current.get(nodeUpdate.node_id);
      if (updatedMqttNode && getStoredMeshProtocol() === 'meshtastic') {
        useDiagnosticsStore
          .getState()
          .processNodeUpdate(
            updatedMqttNode,
            nodesRef.current.get(myNodeNumRef.current) ?? null,
            myNodeNumRef.current,
            MESHTASTIC_CAPABILITIES,
          );
      }
      if (nodeUpdate.latitude != null && nodeUpdate.longitude != null) {
        if (validateCoords(nodeUpdate.latitude, nodeUpdate.longitude).valid) {
          usePositionHistoryStore
            .getState()
            .recordPosition(nodeUpdate.node_id, nodeUpdate.latitude, nodeUpdate.longitude);
        }
      }
    });

    const unsubMsg = window.electronAPI.mqtt.onMessage((rawMsg) => {
      if (!shouldIngestMeshtasticMqttLive(getStoredMeshProtocol(), !!deviceRef.current)) {
        return;
      }
      const msg = normalizeMeshtasticMqttChatMessage(rawMsg);
      if (!msg) return;

      if (msg.sender_id) {
        ensureNodeExists(msg.sender_id, 'mqtt');
      }
      // Record MQTT path before dedup check (captures all copies, new and duplicate). Skip packetId 0 (no unique id per protobuf).
      const rawPacketId = Number(msg.packetId);
      const packetId = rawPacketId >>> 0;
      if (
        getStoredMeshProtocol() === 'meshtastic' &&
        msg.sender_id &&
        Number.isInteger(rawPacketId) &&
        packetId !== 0
      ) {
        useDiagnosticsStore.getState().recordPacketPath(packetId, msg.sender_id, {
          transport: 'mqtt',
          timestamp: Date.now(),
        });
      }

      // Packet ID dedup (catches our own uplink echoes)
      if (packetId !== 0 && isDuplicate(msg.sender_id, packetId)) {
        if (getStoredMeshProtocol() === 'meshtastic') {
          useDiagnosticsStore.getState().recordDuplicate(msg.sender_id);
        }
        const storeId = meshtasticIdentityIdRef.current;
        // Upgrade receivedVia to 'both' if this packet was already saved via RF
        setMessages((prev) =>
          prev.map((m) =>
            meshtasticPacketIdsEqual(m.packetId, packetId) && m.receivedVia === 'rf'
              ? { ...m, receivedVia: 'both' as const, packetId }
              : m,
          ),
        );
        if (storeId) {
          const storeMsgs = messageRecordsToChatMessages(
            Object.values(useMessageStore.getState().messages[storeId] ?? {}),
          );
          for (const m of storeMsgs) {
            if (meshtasticPacketIdsEqual(m.packetId, packetId) && m.receivedVia === 'rf') {
              upsertMessage(
                storeId,
                chatMessageToMessageRecord({ ...m, receivedVia: 'both', packetId }),
              );
            }
          }
        }
        meshtasticIngestSessionRef.current?.markPacketSeen(packetId);
        if (packetId !== 0) void window.electronAPI.db.updateMessageReceivedVia(packetId);
        return;
      }

      const normalizedPacketId = normalizeMeshtasticPacketId(msg.packetId);
      const mqttTreatAsBacklog = mqttMessageTreatAsHistory(
        Date.now(),
        mqttReconnectBacklogUntilRef.current,
      );
      const mqttMsg: ChatMessage = {
        ...msg,
        ...(normalizedPacketId !== undefined ? { packetId: normalizedPacketId } : {}),
        receivedVia: 'mqtt',
        isHistory: mqttTreatAsBacklog || undefined,
      };
      const mqttWithPreviews = enrichMeshtasticReplyPreviews(
        mqttMsg,
        messagesRef.current,
        getNodeName,
      );

      const storeId = meshtasticIdentityIdRef.current;
      const storeMsgs = storeId
        ? messageRecordsToChatMessages(
            Object.values(useMessageStore.getState().messages[storeId] ?? {}),
          )
        : [];
      const dedupSource = storeMsgs.length > 0 ? storeMsgs : messagesRef.current;

      const crossDup = findMeshtasticCrossTransportDuplicate(dedupSource, mqttWithPreviews);
      if (crossDup) {
        setMessages((prev) => {
          const { messages: next, matched } = mapMeshtasticCrossTransportUpgrade(
            prev,
            mqttWithPreviews,
          );
          if (!matched) return prev;
          return next;
        });
        if (storeId) {
          const { messages: storeNext, matched } = mapMeshtasticCrossTransportUpgrade(
            storeMsgs,
            mqttWithPreviews,
          );
          if (matched) {
            for (const m of storeNext) {
              if (m.receivedVia === 'both') {
                upsertMessage(storeId, chatMessageToMessageRecord(m));
              }
            }
          }
        }
        const pid =
          normalizedPacketId !== undefined && normalizedPacketId !== 0
            ? normalizedPacketId
            : normalizeMeshtasticPacketId(crossDup.packetId);
        if (pid !== undefined && pid !== 0) {
          isDuplicate(mqttWithPreviews.sender_id, pid); // registers as seen to suppress future duplicates
          meshtasticIngestSessionRef.current?.markPacketSeen(pid);
          void window.electronAPI.db.updateMessageReceivedVia(pid);
        }
        return;
      }

      const sfDup = mqttWithPreviews.viaStoreForward
        ? findMeshtasticStoreForwardDuplicate(dedupSource, mqttWithPreviews)
        : undefined;
      if (sfDup) {
        setMessages((prev) =>
          prev.map((m) =>
            meshtasticStoreForwardContentMatch(m, mqttWithPreviews)
              ? { ...m, viaStoreForward: true }
              : m,
          ),
        );
        if (storeId) {
          for (const row of Object.values(useMessageStore.getState().messages[storeId] ?? {})) {
            const chat = messageRecordToChatMessage(row);
            if (meshtasticStoreForwardContentMatch(chat, mqttWithPreviews)) {
              upsertMessage(
                storeId,
                chatMessageToMessageRecord({ ...chat, viaStoreForward: true }),
              );
              break;
            }
          }
        }
        return;
      }

      setMessages((prev) => {
        const isDup = prev.some(
          (m) =>
            m.sender_id === mqttWithPreviews.sender_id &&
            m.timestamp === mqttWithPreviews.timestamp &&
            m.payload === mqttWithPreviews.payload &&
            m.channel === mqttWithPreviews.channel &&
            (m.to ?? undefined) === (mqttWithPreviews.to ?? undefined),
        );
        if (isDup) return prev;
        return trimChatMessagesToMax([...prev, mqttWithPreviews], MAX_IN_MEMORY_CHAT_MESSAGES);
      });
      if (storeId) {
        upsertMessage(storeId, chatMessageToMessageRecord(mqttWithPreviews));
      }
      void window.electronAPI.db.saveMessage(mqttWithPreviews);
    });

    const unsubBrokerRaw = window.electronAPI.mqtt.onBrokerRaw((payload) => {
      if (!isMeshtasticMqttProxyActive(moduleConfigsRef.current)) return;
      void mqttClientProxyBridgeRef.current?.handleBrokerRaw(
        payload.topic,
        payload.payload,
        payload.retained,
      );
    });

    const unsubTraceRouteMqtt = window.electronAPI.mqtt.onTraceRouteReply((payload) => {
      if (payload.protocol !== 'meshtastic') return;
      if (!shouldIngestMeshtasticMqttLive(getStoredMeshProtocol(), !!deviceRef.current)) {
        return;
      }
      const rd = {
        route: payload.route as readonly number[],
        routeBack: payload.routeBack as readonly number[],
      };
      setTraceRouteResults((prev) =>
        mergeMeshtasticTraceRouteIntoResultsMap(
          prev,
          payload.meshFrom,
          rd,
          undefined,
          undefined,
          undefined,
        ),
      );
    });

    return () => {
      unsubStatus();
      unsubNode();
      unsubMsg();
      unsubBrokerRaw();
      unsubTraceRouteMqtt();
      if (mqttPresenceInitTimerRef.current) {
        clearTimeout(mqttPresenceInitTimerRef.current);
        mqttPresenceInitTimerRef.current = null;
      }
      if (mqttPresenceIntervalRef.current) {
        clearInterval(mqttPresenceIntervalRef.current);
        mqttPresenceIntervalRef.current = null;
      }
    };
  }, [
    updateNodes,
    isDuplicate,
    startGpsInterval,
    ensureNodeExists,
    getNodeName,
    ensureNonConflictingVirtualNodeId,
    state.myNodeNum,
    pushMqttChannelKeys,
  ]);

  // Cleanup on unmount — stop all intervals and subscriptions
  useEffect(() => {
    return () => {
      cleanupSubscriptions();
      clearConfigureTimeout();
      stopWatchdog();
      stopGpsInterval();
      isReconnectingRef.current = false;
      const device = deviceRef.current;
      deviceRef.current = null;
      if (device) {
        safeDisconnect(device).catch((e: unknown) => {
          console.debug('[useMeshtasticRuntime] unmount safeDisconnect ' + errLikeToLogString(e));
        });
      }
    };
  }, [cleanupSubscriptions, clearConfigureTimeout, stopWatchdog, stopGpsInterval]);

  const applyMeshtasticForeignLoraFromLog = useCallback((message: string) => {
    if (myNodeNumRef.current === 0) return;
    const match = matchForeignLoraFromMeshtasticLog(message);
    if (!match) return;
    const meshcoreSelfId = getMeshcoreDiagnosticsSelfNodeId();
    const senderId = match.packetClass === 'meshcore' ? match.senderId : undefined;
    let displayName: string | undefined;
    if (match.packetClass === 'meshcore' && meshcoreSelfId > 0 && senderId === meshcoreSelfId) {
      const selfNode = getMergedNodesForForeignLoraDiagnostics(nodesRef.current).get(
        meshcoreSelfId,
      );
      displayName = selfNode?.long_name ?? selfNode?.short_name;
    }
    useDiagnosticsStore
      .getState()
      .recordForeignLora(
        myNodeNumRef.current,
        match.packetClass,
        match.rssi,
        match.snr,
        senderId,
        () => getMergedNodesForForeignLoraDiagnostics(nodesRef.current),
        'meshtastic-rf',
        undefined,
        displayName,
      );
  }, []);

  const requestStoreForwardHistoryRef = useRef<
    (options?: {
      serverNodeId?: number;
      manual?: boolean;
    }) => Promise<RequestStoreForwardHistoryResult>
  >(() => Promise.resolve({ ok: false, code: 'no_server' }));

  const requestStoreForwardHistory = useCallback(
    async (options?: {
      serverNodeId?: number;
      manual?: boolean;
    }): Promise<RequestStoreForwardHistoryResult> => {
      const manual = options?.manual === true;
      let serverNodeId = options?.serverNodeId ?? lastSfHeartbeatServerRef.current;
      let heartbeatPeriod = lastSfHeartbeatPeriodRef.current;

      if (serverNodeId == null || manual) {
        const resolved = resolveStoreForwardServerFromObservedPackets(
          storeForwardMessagesRef.current,
          serverNodeId ?? lastSfHeartbeatServerRef.current,
        );
        if (resolved) {
          serverNodeId = resolved.serverNodeId;
          if (resolved.heartbeatPeriod > 0) {
            heartbeatPeriod = resolved.heartbeatPeriod;
          }
        }
      }

      if (serverNodeId == null) {
        if (!manual) {
          console.debug(
            '[useMeshtasticRuntime] Store & Forward history skipped: no server node yet',
          );
        }
        return { ok: false, code: 'no_server' };
      }

      const myNode = myNodeNumRef.current;
      const activeDevice = deviceRef.current;
      if (!myNode || !activeDevice || !deviceConfiguredRef.current) {
        if (!manual) {
          console.debug(
            '[useMeshtasticRuntime] Store & Forward history skipped: radio not configured',
          );
        }
        return { ok: false, code: 'not_configured' };
      }

      const sfCfg = moduleConfigsRef.current.storeForward as { isServer?: boolean } | undefined;
      if (sfCfg?.isServer === true) {
        return { ok: false, code: 'local_is_server' };
      }

      const now = Date.now();
      const channel = lastSfHeartbeatChannelRef.current;

      if (!manual) {
        const alreadyRequested = sfHistoryRequestedServersRef.current.has(serverNodeId);
        const settings = parseStoredJson<Record<string, unknown>>(
          getAppSettingsRaw(),
          'useMeshtasticRuntime storeForwardAutoFetchHistory',
        );
        const sfAuto = settings?.storeForwardAutoFetchHistory;
        const autoFetchEnabled = sfAuto !== false && sfAuto !== 'false';
        if (
          !shouldAutoRequestStoreForwardHistoryOnHeartbeat({
            heartbeatSecondary: 0,
            connectedIsStoreForwardServer: false,
            alreadyRequestedServer: alreadyRequested,
            deviceConfigured: true,
            autoFetchEnabled,
            now,
            lastFetchMs: getLastSfHistoryFetchMs(serverNodeId),
            lastDisconnectMs: lastRfDisconnectAtRef.current,
          })
        ) {
          if (!autoFetchEnabled) {
            return { ok: false, code: 'no_server' };
          }
          const cooldownMs = SF_AUTO_HISTORY_COOLDOWN_MS;
          const offlineMinMs = SF_AUTO_HISTORY_OFFLINE_MIN_MS;
          const lastFetchMs = getLastSfHistoryFetchMs(serverNodeId);
          if (lastFetchMs != null && now - lastFetchMs < cooldownMs) {
            return { ok: false, code: 'cooldown' };
          }
          if (
            lastRfDisconnectAtRef.current != null &&
            now - lastRfDisconnectAtRef.current < offlineMinMs
          ) {
            return { ok: false, code: 'offline_gate' };
          }
          return { ok: false, code: 'no_server' };
        }
        if (
          !reserveStoreForwardHistoryRequest(sfHistoryRequestedServersRef.current, serverNodeId)
        ) {
          return { ok: false, code: 'already_requested' };
        }
      }

      const packetId = (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0;
      const toRadioBytes = buildStoreForwardHistoryToRadioBytes({
        from: myNode,
        to: serverNodeId,
        channel,
        packetId,
        windowMinutes: resolveAutoStoreForwardHistoryWindowMinutes(heartbeatPeriod),
        messageCap: manual ? SF_MANUAL_HISTORY_MESSAGE_CAP : SF_AUTO_HISTORY_MESSAGE_CAP,
      });

      try {
        await writeToRadioWithoutQueue(activeDevice, toRadioBytes);
        recordSfHistoryFetch(serverNodeId, now);
        console.debug(
          `[useMeshtasticRuntime] Store & Forward CLIENT_HISTORY sent to 0x${serverNodeId.toString(16)} ch=${channel} manual=${manual}`,
        );
        return { ok: true };
      } catch (e: unknown) {
        if (!manual) {
          releaseStoreForwardHistoryRequest(sfHistoryRequestedServersRef.current, serverNodeId);
        }
        console.error(
          '[useMeshtasticRuntime] Store & Forward history request failed ' + errLikeToLogString(e),
        );
        return { ok: false, code: 'send_failed' };
      }
    },
    [],
  );

  useEffect(() => {
    requestStoreForwardHistoryRef.current = requestStoreForwardHistory;
  }, [requestStoreForwardHistory]);

  /** All transports use `ConnectionDriver.connect`; legacy handlers stay in `wireSubscriptions`. */
  const openMeshtasticTransport = useCallback(
    async (
      type: ConnectionType,
      fields: {
        httpAddress?: string;
        blePeripheralId?: string;
        lastSerialPortId?: string | null;
      },
    ): Promise<{ device: MeshDevice; driverIdentityId: string }> => {
      const transportOpts = rfConnectionTransportOpts(type, fields);
      const params = meshtasticTransportParams(transportOpts.type, {
        peripheralId: transportOpts.type === 'ble' ? transportOpts.blePeripheralId : undefined,
        portSignature:
          transportOpts.type === 'serial'
            ? (transportOpts.lastSerialPortId ?? undefined)
            : undefined,
        host: transportOpts.type === 'http' ? transportOpts.httpAddress : undefined,
      });
      const identityId = await connectionDriver.connect('meshtastic', params);
      meshtasticDriverConnectedRef.current = true;
      const device = connectionDriver.getHandle(identityId) as MeshDevice | null;
      if (!device) {
        meshtasticDriverConnectedRef.current = false;
        await connectionDriver.disconnect(identityId).catch((e: unknown) => {
          console.debug(
            '[useMeshtasticRuntime] openMeshtasticTransport rollback ' + errLikeToLogString(e),
          );
        });
        throw new Error('[useMeshtasticRuntime] ConnectionDriver.connect returned no handle');
      }
      return { device, driverIdentityId: identityId };
    },
    [],
  );

  // ─── Wire up all event subscriptions for a device ─────────────
  const meshtasticLegacyWireSubscriptionDeps = useMemo<MeshtasticLegacyWireSubscriptionDeps>(
    () => ({
      channelConfigsRef,
      configureTargetNodeNumRef,
      configureTargetPersistRestoredRef,
      configureTimeoutRef,
      connectionParamsRef,
      deviceConfiguredRef,
      deviceGpsModeRef,
      deviceRef,
      handleConnectionLostRef,
      schedulePostCommitRebootRecoveryRef,
      clearPostCommitRebootRecoveryRef,
      isConfiguringRef,
      lastDataReceivedRef,
      lastNodeInfoRequestAtRef,
      lastRfDisconnectAtRef,
      lastRfSelfNodeIdRef,
      lastSfHeartbeatChannelRef,
      lastSfHeartbeatPeriodRef,
      lastSfHeartbeatServerRef,
      localLoraConfigTimerRef,
      meshtasticIdentityIdRef,
      meshtasticIngestSessionRef,
      meshtasticIngressDetachRef,
      messagesRef,
      mqttStatusRef,
      myNodeNumRef,
      nodesRef,
      pendingTempIdRef,
      pendingTracePacketIdToTargetRef,
      pendingTraceRequestsRef,
      refreshOurPositionRef,
      remoteAdminClientRef,
      remoteAdminStatusRef,
      requestStoreForwardHistoryRef,
      rfHeardNodeIds,
      sfHistoryRequestedServersRef,
      skipLocalLoraConfigRef,
      loraConfigRef,
      unsubscribesRef,
      virtualNodeIdRef,
      touchLastData,
      applyOwnNodeBatteryFromDeviceMetrics,
      getNodeName,
      updateNodes,
      startWatchdog,
      stopWatchdog,
      cleanupSubscriptions,
      startGpsInterval,
      stopGpsInterval,
      isDuplicate,
      ensureNodeExists,
      clearConfigureTimeout,
      applyMeshtasticForeignLoraFromLog,
      emptyNode,
      setMeshtasticIdentityId,
      setState,
      setQueueStatus,
      setDeviceLogs,
      setTraceRouteResults,
      setNeighborInfo,
      setWaypoints,
      setModuleConfigs,
      setSecurityConfig,
      setLoraConfig,
      setConfigureTargetNodeNumState,
      setRemoteConfigSnapshot,
      setRemoteAdminStatus,
      setRemoteAdminError,
      setMessages,
      setTelemetry,
      setSignalTelemetry,
      setEnvironmentTelemetry,
      setDeviceOwner,
      setChannels,
      setChannelConfigs,
      setDeviceGpsMode,
      setDeviceFixedPosition,
      setTelemetryDeviceUpdateInterval,
      setRawPackets,
      setRemoteHardwareMessages,
      setAudioMessages,
      setDetectionSensorEvents,
      setPingResponses,
      setIpTunnelMessages,
      setPaxCounterData,
      setSerialMessages,
      setStoreForwardMessages,
      setRangeTestPackets,
      setZpsMessages,
      setSimulatorPackets,
      setAtakMessages,
      setMapReports,
      setPrivateMessages,
      mqttClientProxyBridgeRef,
    }),
    [
      touchLastData,
      applyOwnNodeBatteryFromDeviceMetrics,
      getNodeName,
      updateNodes,
      startWatchdog,
      stopWatchdog,
      cleanupSubscriptions,
      startGpsInterval,
      stopGpsInterval,
      isDuplicate,
      ensureNodeExists,
      clearConfigureTimeout,
      applyMeshtasticForeignLoraFromLog,
    ],
  );

  const wireSubscriptions = useCallback(
    (device: MeshDevice, type: ConnectionType, opts?: { driverIdentityId?: string }) => {
      attachMeshtasticLegacyWireSubscriptions(
        device,
        type,
        opts,
        meshtasticLegacyWireSubscriptionDeps,
      );
    },
    [meshtasticLegacyWireSubscriptionDeps],
  );

  // ─── Connection lost handler ──────────────────────────────────
  const handleConnectionLost = useCallback(() => {
    reconnectGenerationRef.current += 1;
    if (!isReconnectingRef.current) {
      console.warn('[useMeshtasticRuntime] Connection lost — initiating reconnect');
      isReconnectingRef.current = true;
    } else {
      console.warn(
        '[useMeshtasticRuntime] Connection lost during reconnect — restarting reconnect cycle',
      );
    }

    void (async () => {
      clearPostCommitRebootRecovery();
      deviceConfiguredRef.current = false;
      // Clean up existing connection before reconnect (BlueZ needs GATT fully torn down).
      clearConfigureTimeout();
      const staleDevice = deviceRef.current;
      cleanupSubscriptions();
      stopWatchdog();
      stopGpsInterval();
      const driverIdentity =
        meshtasticIdentityIdRef.current ?? meshtasticPendingDriverIdentityRef.current;
      deviceRef.current = null;
      meshtasticDriverConnectedRef.current = false;
      meshtasticPendingDriverIdentityRef.current = null;
      if (staleDevice) {
        await safeDisconnect(staleDevice).catch((e: unknown) => {
          console.debug(
            '[useMeshtasticRuntime] handleConnectionLost safeDisconnect ' + errLikeToLogString(e),
          );
        });
      }
      if (driverIdentity) {
        await connectionDriver.disconnect(driverIdentity).catch((e: unknown) => {
          console.debug(
            '[useMeshtasticRuntime] handleConnectionLost driver disconnect ' +
              errLikeToLogString(e),
          );
        });
      }
      void attemptReconnectRef.current();
    })();
  }, [
    clearConfigureTimeout,
    cleanupSubscriptions,
    stopWatchdog,
    stopGpsInterval,
    clearPostCommitRebootRecovery,
  ]);

  // Keep the ref in sync
  handleConnectionLostRef.current = handleConnectionLost;

  // ─── Reconnection with exponential backoff ────────────────────
  const attemptReconnect = useCallback(async () => {
    const params = connectionParamsRef.current;
    if (!params) {
      isReconnectingRef.current = false;
      setState((s) => ({
        ...s,
        status: 'disconnected',
        connectionType: null,
        connectionLoss: false,
        batteryPercent: undefined,
        batteryCharging: undefined,
      }));
      return;
    }

    if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      isReconnectingRef.current = false;
      reconnectAttemptRef.current = 0;
      cleanupSubscriptions();
      stopWatchdog();
      stopGpsInterval();
      const exhaustedParams = connectionParamsRef.current;
      const exhaustedSerialPort =
        exhaustedParams?.type === 'serial' ? (exhaustedParams.serialPort ?? null) : null;
      if (exhaustedParams?.type === 'serial') {
        await escalateSerialReconnectExhaustion(exhaustedSerialPort);
      }
      deviceRef.current = null;
      meshtasticDriverConnectedRef.current = false;
      meshtasticPendingDriverIdentityRef.current = null;
      setState((s) => ({
        ...s,
        status: 'disconnected',
        connectionType: exhaustedParams?.type === 'serial' ? 'serial' : null,
        connectionLoss: true,
        serialNeedsReselect: exhaustedParams?.type === 'serial',
        batteryPercent: undefined,
        batteryCharging: undefined,
      }));
      return;
    }

    // Capture the current generation so stale attempts can be detected
    const generation = reconnectGenerationRef.current;

    reconnectAttemptRef.current++;
    setState((s) => ({
      ...s,
      status: 'reconnecting',
      connectionLoss: true,
      reconnectAttempt: reconnectAttemptRef.current,
    }));

    const delay = Math.min(2000 * Math.pow(2, reconnectAttemptRef.current - 1), 32000);
    console.debug(
      `[useMeshtasticRuntime] reconnect: waiting ${delay}ms before attempt ${reconnectAttemptRef.current}/${MAX_RECONNECT_ATTEMPTS}`,
    );
    const delayResult = await delayUnlessSuspended(delay, () =>
      !isReconnectingRef.current ? true : reconnectGenerationRef.current !== generation,
    );
    if (delayResult === 'aborted') return;
    if (delayResult === 'suspended') {
      isReconnectingRef.current = false;
      setState((s) => ({
        ...s,
        status: 'disconnected',
        connectionLoss: true,
      }));
      return;
    }

    // Check if user manually disconnected or started a new connection during the wait
    if (!isReconnectingRef.current || reconnectGenerationRef.current !== generation) return;

    let opened: Awaited<ReturnType<typeof openMeshtasticTransport>> | undefined;
    try {
      opened = await openMeshtasticTransport(params.type, {
        httpAddress: params.httpAddress,
        blePeripheralId: params.blePeripheralId,
        lastSerialPortId: params.lastSerialPortId,
      });
      deviceRef.current = opened.device;
      wireSubscriptions(opened.device, params.type, {
        driverIdentityId: opened.driverIdentityId,
      });
      await configureMeshtasticDeviceWithRetry(opened.device, {
        logTag: 'useMeshtasticRuntime reconnect',
      });

      if (reconnectGenerationRef.current !== generation) {
        throw new Error('Reconnect superseded during configure');
      }
      if (!(await verifyMeshtasticRfLink(params.type))) {
        throw new Error('RF link lost after reconnect configure');
      }

      // Success
      console.debug(
        `[useMeshtasticRuntime] Reconnect succeeded on attempt ${reconnectAttemptRef.current}`,
      );
      if (params.type === 'serial' && connectionParamsRef.current && opened?.device) {
        connectionParamsRef.current.serialPort = getSerialPortFromMeshTransport(
          opened.device.transport,
        );
      }
      reconnectAttemptRef.current = 0;
      isReconnectingRef.current = false;
      setState((s) => ({
        ...s,
        serialNeedsReselect: false,
        connectionLoss: false,
      }));
    } catch (err) {
      const failedDriverIdentity =
        opened?.driverIdentityId ??
        meshtasticIdentityIdRef.current ??
        meshtasticPendingDriverIdentityRef.current;
      deviceRef.current = null;
      meshtasticDriverConnectedRef.current = false;
      meshtasticPendingDriverIdentityRef.current = null;
      if (failedDriverIdentity) {
        await connectionDriver.disconnect(failedDriverIdentity).catch((e: unknown) => {
          console.debug(
            '[useMeshtasticRuntime] reconnect failure driver disconnect ' + errLikeToLogString(e),
          );
        });
      }
      console.warn(
        `[useMeshtasticRuntime] Reconnect attempt ${reconnectAttemptRef.current} failed:` +
          ' ' +
          errLikeToLogString(err),
      );
      // Retry
      void attemptReconnectRef.current();
    }
  }, [
    wireSubscriptions,
    openMeshtasticTransport,
    cleanupSubscriptions,
    stopWatchdog,
    stopGpsInterval,
  ]);

  const onPowerSuspend = useCallback(() => {
    reconnectGenerationRef.current += 1;
    isReconnectingRef.current = false;
  }, []);

  const onPowerResume = useCallback(() => {
    if (!connectionParamsRef.current) {
      if (meshtasticExplicitDisconnectRef.current) {
        console.debug('[useMeshtasticRuntime] power resume — skip reconnect (user disconnect)');
        return;
      }
      const rehydrated = rehydrateMeshtasticConnectionParamsFromStorage();
      if (!rehydrated) {
        console.debug('[useMeshtasticRuntime] power resume — skip reconnect (no stored session)');
        return;
      }
      connectionParamsRef.current = rehydrated;
      console.debug(
        '[useMeshtasticRuntime] power resume — rehydrated reconnect params from storage',
      );
    }
    console.debug('[useMeshtasticRuntime] power resume — resetting reconnect budget');
    reconnectAttemptRef.current = 0;
    reconnectGenerationRef.current += 1;
    isReconnectingRef.current = false;
    handleConnectionLostRef.current();
  }, []);

  useEffect(() => {
    return window.electronAPI.onNobleBleDisconnected((sessionId) => {
      if (sessionId !== 'meshtastic') return;
      if (!connectionParamsRef.current) {
        if (meshtasticExplicitDisconnectRef.current) {
          console.debug(
            '[useMeshtasticRuntime] Noble BLE disconnected — skip reconnect (user disconnect)',
          );
          return;
        }
        const rehydrated = rehydrateMeshtasticConnectionParamsFromStorage();
        if (!rehydrated) {
          console.debug(
            '[useMeshtasticRuntime] Noble BLE disconnected — skip reconnect (no stored session)',
          );
          return;
        }
        connectionParamsRef.current = rehydrated;
        console.debug(
          '[useMeshtasticRuntime] Noble BLE disconnected — rehydrated reconnect params from storage',
        );
      }
      console.warn('[useMeshtasticRuntime] Noble BLE disconnected');
      handleConnectionLostRef.current();
    });
  }, []);

  // Keep the ref in sync
  attemptReconnectRef.current = attemptReconnect;

  const prepareRfConnect = useCallback(
    async (
      type: ConnectionType,
      httpAddress?: string,
      blePeripheralId?: string,
      lastSerialPortId?: string | null,
    ): Promise<void> => {
      clearConfigureTimeout();
      clearPostCommitRebootRecovery();
      deviceConfiguredRef.current = false;
      if (deviceRef.current || meshtasticDriverConnectedRef.current) {
        cleanupSubscriptions();
        stopWatchdog();
        const driverIdentity =
          meshtasticIdentityIdRef.current ?? meshtasticPendingDriverIdentityRef.current;
        deviceRef.current = null;
        meshtasticDriverConnectedRef.current = false;
        meshtasticPendingDriverIdentityRef.current = null;
        if (driverIdentity) {
          await connectionDriver.disconnect(driverIdentity).catch((e: unknown) => {
            console.debug(
              '[useMeshtasticRuntime] prepareRfConnect driver disconnect ' + errLikeToLogString(e),
            );
          });
        }
      }
      const resolvedSerialPortId =
        type === 'serial' ? (lastSerialPortId ?? loadLastSerialPortId()) : undefined;
      connectionParamsRef.current = {
        type,
        httpAddress,
        blePeripheralId,
        lastSerialPortId: resolvedSerialPortId,
        serialPort: null,
      };
      meshtasticExplicitDisconnectRef.current = false;
      reconnectAttemptRef.current = 0;
      isReconnectingRef.current = false;
      reconnectGenerationRef.current++;
      setState((s) => ({
        ...s,
        status: 'connecting',
        connectionType: type,
        connectionLoss: false,
        serialNeedsReselect: false,
        batteryPercent: undefined,
        batteryCharging: undefined,
      }));
    },
    [clearConfigureTimeout, cleanupSubscriptions, stopWatchdog, clearPostCommitRebootRecovery],
  );

  const applyMeshtasticNodesToUi = useCallback(
    (driverIdentityId: string, nodeMap: Map<number, MeshNode>) => {
      nodesRef.current = nodeMap;
      setNodes(nodeMap);
      syncMeshtasticNodesMapToIdentityStore(driverIdentityId, nodeMap);
    },
    [],
  );

  const attachRfSession = useCallback(
    async (driverIdentityId: string, type: ConnectionType, device?: MeshDevice): Promise<void> => {
      meshtasticDriverConnectedRef.current = true;
      meshtasticPendingDriverIdentityRef.current = driverIdentityId;
      const activeDevice =
        device ?? (connectionDriver.getHandle(driverIdentityId) as MeshDevice | null);
      if (!activeDevice) {
        throw new Error(
          '[useMeshtasticRuntime] attachRfSession: ConnectionDriver returned no handle',
        );
      }
      deviceRef.current = activeDevice;
      if (type === 'serial' && connectionParamsRef.current) {
        connectionParamsRef.current.serialPort = getSerialPortFromMeshTransport(
          activeDevice.transport,
        );
      }
      wireSubscriptions(activeDevice, type, { driverIdentityId });

      // Show persisted nodes immediately while NodeDB configure replays over BLE/serial.
      const dbCacheStart = performance.now();
      let dbCacheNodeCount = 0;
      try {
        const cachedNodes = await loadMeshtasticNodeMapFromDb();
        dbCacheNodeCount = cachedNodes.size;
        applyMeshtasticNodesToUi(driverIdentityId, cachedNodes);
      } catch (e) {
        console.warn(
          '[useMeshtasticRuntime] attachRfSession db cache hydrate failed ' + errLikeToLogString(e),
        );
      }
      console.debug(
        `[useMeshtasticRuntime] attachRfSession dbCache→UI ${Math.round(performance.now() - dbCacheStart)}ms (${dbCacheNodeCount} nodes)`,
      );

      void (async () => {
        try {
          const fromDb = await loadMeshtasticMessagesFromDb();
          for (const m of fromDb) {
            if (m.packetId && m.sender_id) {
              seenPacketIds.current.set(
                meshtasticPacketDedupKey(m.sender_id, m.packetId),
                Date.now() + 10 * 60 * 1000,
              );
            }
          }
          setMessages((prev) => mergeMeshtasticDbHydrationWithLive(prev, fromDb));
          await hydrateMeshtasticMessagesFromDb(driverIdentityId);
        } catch (e) {
          console.warn(
            '[useMeshtasticRuntime] attachRfSession message cache hydrate failed ' +
              errLikeToLogString(e),
          );
        }
      })();

      await configureMeshtasticDeviceWithRetry(activeDevice, {
        logTag: 'useMeshtasticRuntime attachRfSession',
      });
    },
    [applyMeshtasticNodesToUi, wireSubscriptions],
  );

  const handleRfConnectFailure = useCallback(
    async (driverIdentityId?: string, reason?: unknown): Promise<void> => {
      clearConfigureTimeout();
      console.error(
        '[useMeshtasticRuntime] Connection failed: ' +
          errLikeToLogString(reason ?? new Error('unknown connection failure')),
      );
      isReconnectingRef.current = false;
      reconnectGenerationRef.current += 1;
      cleanupSubscriptions();
      stopWatchdog();
      deviceRef.current = null;
      const identityToDisconnect =
        driverIdentityId ??
        meshtasticIdentityIdRef.current ??
        meshtasticPendingDriverIdentityRef.current;
      if (identityToDisconnect) {
        await connectionDriver.disconnect(identityToDisconnect).catch((e: unknown) => {
          console.debug(
            '[useMeshtasticRuntime] handleRfConnectFailure driver disconnect ' +
              errLikeToLogString(e),
          );
        });
      }
      meshtasticPendingDriverIdentityRef.current = null;
      meshtasticDriverConnectedRef.current = false;
      setState({
        status: 'disconnected',
        myNodeNum: 0,
        connectionType: null,
        batteryPercent: undefined,
        batteryCharging: undefined,
      });
    },
    [clearConfigureTimeout, cleanupSubscriptions, stopWatchdog],
  );

  const finalizeDriverDisconnect = useCallback(
    async (opts?: { disconnectDriver?: boolean }) => {
      const disconnectDriver = opts?.disconnectDriver !== false;
      clearConfigureTimeout();
      clearPostCommitRebootRecovery();
      deviceConfiguredRef.current = false;
      const driverIdentity =
        meshtasticDriverConnectedRef.current &&
        (meshtasticIdentityIdRef.current ?? meshtasticPendingDriverIdentityRef.current)
          ? (meshtasticIdentityIdRef.current ?? meshtasticPendingDriverIdentityRef.current)
          : null;
      cleanupSubscriptions();
      stopWatchdog();
      stopGpsInterval();
      isReconnectingRef.current = false;
      reconnectAttemptRef.current = 0;
      reconnectGenerationRef.current++;
      connectionParamsRef.current = null;

      const device = deviceRef.current;
      deviceRef.current = null;
      if (disconnectDriver && driverIdentity) {
        await connectionDriver.disconnect(driverIdentity).catch((e: unknown) => {
          console.debug('[useMeshtasticRuntime] driver disconnect ' + errLikeToLogString(e));
        });
      } else if (!disconnectDriver && device) {
        await safeDisconnect(device).catch((e: unknown) => {
          console.debug('[useMeshtasticRuntime] finalize safeDisconnect ' + errLikeToLogString(e));
        });
      } else if (disconnectDriver && device && !driverIdentity) {
        await safeDisconnect(device);
      }
      meshtasticDriverConnectedRef.current = false;
      meshtasticPendingDriverIdentityRef.current = null;
      setState({
        status: 'disconnected',
        myNodeNum: 0,
        connectionType: null,
        connectionLoss: false,
        batteryPercent: undefined,
        batteryCharging: undefined,
      });
      setConfigureTargetNodeNumState(null);
      configureTargetNodeNumRef.current = null;
      configureTargetPersistRestoredRef.current = false;
      setRemoteConfigSnapshot(null);
      setRemoteAdminStatus('idle');
      setRemoteAdminError(undefined);
      remoteAdminClientRef.current?.resetEditState();
      remoteAdminClientRef.current?.sessionStore.clear();
    },
    [
      cleanupSubscriptions,
      stopWatchdog,
      stopGpsInterval,
      clearConfigureTimeout,
      clearPostCommitRebootRecovery,
    ],
  );
  const connect = useCallback(
    async (type: ConnectionType, httpAddress?: string, blePeripheralId?: string) => {
      const serialPortId = type === 'serial' ? loadLastSerialPortId() : undefined;
      await prepareRfConnect(type, httpAddress, blePeripheralId, serialPortId);
      let opened: Awaited<ReturnType<typeof openMeshtasticTransport>> | undefined;
      try {
        console.debug('[useMeshtasticRuntime] connect', type, httpAddress ?? blePeripheralId);
        opened = await openMeshtasticTransport(type, {
          httpAddress,
          blePeripheralId,
          lastSerialPortId: serialPortId,
        });
        await attachRfSession(opened.driverIdentityId, type, opened.device);
      } catch (err) {
        await handleRfConnectFailure(opened?.driverIdentityId, err);
        throw err;
      }
    },
    [prepareRfConnect, attachRfSession, handleRfConnectFailure, openMeshtasticTransport],
  );

  /**
   * Like connect(), but for auto-connect paths that don't require a user gesture.
   * @param lastSerialPortId - Stored portId from previous manual selection (serial only).
   * @param blePeripheralId - Noble peripheral ID from previous BLE selection (BLE only).
   */
  const connectAutomatic = useCallback(
    async (
      type: ConnectionType,
      httpAddress?: string,
      lastSerialPortId?: string | null,
      blePeripheralId?: string,
    ) => {
      await prepareRfConnect(type, httpAddress, blePeripheralId, lastSerialPortId);
      let opened: Awaited<ReturnType<typeof openMeshtasticTransport>> | undefined;
      try {
        console.debug(
          '[useMeshtasticRuntime] connectAutomatic',
          type,
          httpAddress ?? blePeripheralId,
        );
        opened = await openMeshtasticTransport(type, {
          httpAddress,
          blePeripheralId,
          lastSerialPortId,
        });
        await attachRfSession(opened.driverIdentityId, type, opened.device);
      } catch (err) {
        await handleRfConnectFailure(opened?.driverIdentityId, err);
        throw err;
      }
    },
    [prepareRfConnect, attachRfSession, handleRfConnectFailure, openMeshtasticTransport],
  );

  const disconnect = useCallback(async () => {
    meshtasticExplicitDisconnectRef.current = true;
    await finalizeDriverDisconnect({ disconnectDriver: true });
  }, [finalizeDriverDisconnect]);

  // ─── TransportManager status handler ─────────────────────────────────────
  // Defined as useCallback so it's stable; stored in a ref so TransportManager
  // always calls the latest version without needing re-initialization.
  const handleTransportStatus = useCallback(
    (event: StatusUpdateEvent) => {
      const { tempId, transport, status, finalPacketId, error } = event;
      const identityId = meshtasticIdentityIdRef.current;
      const tempIdStr = String(tempId);

      if (transport === 'device') {
        if (status === 'acked') {
          const resolvedPid =
            finalPacketId !== undefined
              ? (meshtasticWireUint32AllowZero(finalPacketId) ?? tempId)
              : tempId;
          if (finalPacketId !== undefined && myNodeNumRef.current > 0) {
            isDuplicate(myNodeNumRef.current, resolvedPid);
          }
          if (resolvedPid !== tempId) {
            ackMeshPacketIdByTempIdRef.current.set(tempId, resolvedPid);
          }
          const resolvedIdStr = String(resolvedPid);
          const storeKeyBeforeAck = resolveMeshtasticOutboundStoreKey(tempId, tempIdStr);
          setMessages((prev) =>
            prev.map((m) =>
              meshtasticOutboundSendMatchesTempId(m, tempId)
                ? {
                    ...m,
                    status: 'acked' as const,
                    ...(resolvedPid !== tempId ? { packetId: resolvedPid } : {}),
                  }
                : m,
            ),
          );
          if (identityId) {
            if (resolvedPid !== tempId) {
              renameMessageId(identityId, storeKeyBeforeAck, resolvedIdStr);
            }
            trackMeshtasticOutboundTempId(tempId, resolvedIdStr);
            updateMessageStatus(identityId, resolvedIdStr, 'acked');
          }
          outboundSendByTempIdRef.current.delete(tempId);
          const ackSenderId = messagesRef.current.find((m) =>
            meshtasticOutboundSendMatchesTempId(m, tempId),
          )?.sender_id;
          void (
            resolvedPid !== tempId
              ? window.electronAPI.db.updateMessagePacketId(tempId, resolvedPid, ackSenderId)
              : Promise.resolve()
          )
            .then(() => window.electronAPI.db.updateMessageStatus(resolvedPid, 'acked'))
            .catch((err: unknown) => {
              console.error(
                '[useMeshtasticRuntime] device ack DB update failed:',
                err instanceof Error ? err.message : String(err),
              );
            });
        } else {
          // failed
          setMessages((prev) =>
            prev.map((m) =>
              meshtasticOutboundSendMatchesTempId(m, tempId)
                ? { ...m, status: 'failed' as const, error }
                : m,
            ),
          );
          if (identityId) {
            const storeKey = resolveMeshtasticOutboundStoreKey(tempId, tempIdStr);
            updateMessageStatus(identityId, storeKey, 'failed', error);
            clearMeshtasticOutboundTempId(tempId);
          }
          outboundSendByTempIdRef.current.delete(tempId);
          void window.electronAPI.db.updateMessageStatus(tempId, 'failed', error);
        }
      } else {
        // mqtt — read current device status from state so the DB update is consistent
        const rowPacketId = ackMeshPacketIdByTempIdRef.current.get(tempId) ?? tempId;
        const rowPacketIdStr = String(rowPacketId);
        const storeMessageId = resolveMeshtasticOutboundStoreKey(tempId, rowPacketIdStr);
        setMessages((prev) => {
          const existing = prev.find((m) => m.packetId === rowPacketId);
          if (status !== 'sending' && existing) {
            const deviceStatus = existing.status ?? 'acked';
            void window.electronAPI.db.updateMessageStatus(
              rowPacketId,
              deviceStatus,
              existing.error,
              status,
            );
          }
          return prev.map((m) => (m.packetId === rowPacketId ? { ...m, mqttStatus: status } : m));
        });
        if (identityId) {
          updateMessageMqttStatus(identityId, storeMessageId, status);
          if (status === 'acked' || status === 'failed') {
            clearMeshtasticOutboundTempId(tempId);
          }
        }
      }
    },
    [isDuplicate, meshtasticOutboundSendMatchesTempId],
  );

  // Keep the ref in sync so TransportManager always invokes the latest handler
  onStatusUpdateRef.current = handleTransportStatus;

  const sendMessage = useCallback(
    (text: string, channel = 0, destination?: number, replyId?: number) => {
      const hasMqtt = mqttStatusRef.current === 'connected';
      if (!deviceRef.current && !hasMqtt) throw new Error('Not connected');

      const from = resolveMeshtasticOutboundFromNodeId({
        hasDevice: !!deviceRef.current,
        myNodeNum: myNodeNumRef.current,
        lastRfSelfNodeId: lastRfSelfNodeIdRef.current,
        virtualNodeId: virtualNodeIdRef.current,
      });
      if (!deviceRef.current && myNodeNumRef.current !== from) {
        myNodeNumRef.current = from;
        setState((prev) => ({ ...prev, myNodeNum: from }));
      }
      const tempId = Math.floor(Math.random() * 0xffffffff);

      let wireReplyId: number | undefined;
      if (replyId != null) {
        const identityIdForReply = meshtasticIdentityIdRef.current;
        const storeMsgsForReply = identityIdForReply
          ? messageRecordsToChatMessages(
              Object.values(useMessageStore.getState().messages[identityIdForReply] ?? {}),
            )
          : messagesRef.current;
        wireReplyId = resolveMeshtasticWireReplyId(storeMsgsForReply, replyId);
        if (wireReplyId == null || wireReplyId === 0) {
          throw new Error(
            'Reply requires the message RF packet id (wait for send ack or refresh chat).',
          );
        }
      }

      // Determine initial MQTT display state (TransportManager will confirm/update asynchronously)
      const chCfg = channelConfigsRef.current.find((c) => c.index === channel);
      const shouldUplink = !deviceRef.current
        ? hasMqtt && from > 0 // MQTT-only: uplink when connected with a valid sender id
        : !!(from > 0 && chCfg?.uplinkEnabled && hasMqtt);

      const msg: ChatMessage = enrichMeshtasticReplyPreviews(
        {
          sender_id: from,
          sender_name: getNodeName(from),
          payload: text,
          channel,
          timestamp: Date.now(),
          packetId: tempId,
          receivedVia: deviceRef.current ? ('rf' as const) : ('mqtt' as const),
          status: deviceRef.current ? ('sending' as const) : undefined,
          mqttStatus: shouldUplink ? ('sending' as const) : undefined,
          to: destination != null && destination >>> 0 !== BROADCAST_ADDR ? destination : undefined,
          replyId: wireReplyId,
        },
        messagesRef.current,
        getNodeName,
      );
      outboundSendByTempIdRef.current.set(tempId, {
        sender_id: from,
        timestamp: msg.timestamp,
        payload: text,
        channel,
      });
      setMessages((prev) => trimChatMessagesToMax([...prev, msg], MAX_IN_MEMORY_CHAT_MESSAGES));
      void window.electronAPI.db.saveMessage(msg);
      const identityId = meshtasticIdentityIdRef.current;
      if (identityId) {
        trackMeshtasticOutboundTempId(tempId, String(tempId));
        addMessage(identityId, chatMessageToMessageRecord(msg));
      }

      // For device path: track this tempId so the RF echo can be suppressed (avoids duplicate)
      if (deviceRef.current) {
        pendingTempIdRef.current = tempId;
      }

      // Lazy-init TransportManager (stable deps are all refs)
      transportManagerRef.current ??= new TransportManager({
        deviceRef,
        myNodeNumRef,
        mqttStatusRef,
        channelConfigsRef,
        isDuplicate,
        onStatusUpdateRef,
      });
      transportManagerRef.current.sendMessage(
        text,
        channel,
        destination,
        wireReplyId,
        tempId,
        from,
      );
    },
    [getNodeName, isDuplicate],
  );

  const clearRemoteAdminLoadingIfNoForegroundInflight = (): void => {
    const hasForegroundInflight = [...remoteConfigInflightRoutesRef.current].some(
      (r) => r !== 'channelsTail' && r !== 'owner',
    );
    if (!hasForegroundInflight && remoteAdminStatusRef.current === 'loading') {
      setRemoteAdminStatus('idle');
    }
  };

  const setRemoteAdminKeyForNode = useCallback(
    async (nodeNum: number, adminKeyBase64: string | null) => {
      try {
        const map = await setMeshtasticRemoteAdminKeyForNode(nodeNum, adminKeyBase64);
        setRemoteAdminKeysByNode(map);
        remoteAdminKeysByNodeRef.current = map;
      } catch (e) {
        const msg = normalizeRemoteAdminError(e);
        console.warn(
          '[useMeshtasticRuntime] setRemoteAdminKeyForNode failed ' + errLikeToLogString(e),
        );
        throw new Error(msg);
      }
    },
    [],
  );

  const getRemoteAdminKeyForNode = useCallback((nodeNum: number): string | undefined => {
    return (
      remoteAdminKeysByNodeRef.current[String(nodeNum >>> 0)] ??
      getMeshtasticRemoteAdminKeyForNode(nodeNum)
    );
  }, []);

  const enqueueRemoteConfigFetch = useCallback((task: () => Promise<void>): Promise<void> => {
    return remoteConfigFetchChainRef.current.enqueue(task);
  }, []);

  const refreshRemoteConfigSnapshot = useCallback(
    async (
      destNodeNum: number,
      route: RemoteConfigRoute = 'radio',
      options?: { force?: boolean },
    ) => {
      const client = remoteAdminClientRef.current;
      if (!client || !deviceRef.current) {
        setRemoteAdminStatus('error');
        setRemoteAdminError('remoteAdmin.errors.noLocalRadio');
        return;
      }
      const destNode = nodesRef.current.get(destNodeNum);
      const configuredAdminKey = getRemoteAdminKeyForNode(destNodeNum);
      if (!configuredAdminKey || !isValidMeshtasticAdminKeyBase64(configuredAdminKey)) {
        setRemoteAdminStatus('error');
        setRemoteAdminError('remoteAdmin.errors.noAdminKeyConfigured');
        return;
      }
      const destPublicKey = resolveMeshtasticDestPublicKeyBytes({
        publicKeyHex: destNode?.public_key_hex,
        adminKeyBase64: configuredAdminKey,
      });
      if (!destPublicKey) {
        setRemoteAdminStatus('error');
        setRemoteAdminError('remoteAdmin.errors.noRemotePublicKey');
        return;
      }
      if (state.status !== 'configured') return;
      if (!options?.force && remoteConfigLoadedRoutesRef.current.has(route)) return;
      if (remoteConfigInflightRoutesRef.current.has(route)) return;

      await enqueueRemoteConfigFetch(async () => {
        if (!options?.force && remoteConfigLoadedRoutesRef.current.has(route)) return;
        if (remoteConfigInflightRoutesRef.current.has(route)) return;

        const generation = remoteConfigFetchGenerationRef.current;
        const isBackgroundRoute = route === 'channelsTail' || route === 'owner';
        remoteConfigInflightRoutesRef.current.add(route);
        if (route === 'channelsTail') {
          setRemoteConfigChannelsTailStatus('loading');
        }
        if (!isBackgroundRoute) {
          setRemoteAdminStatus('loading');
          setRemoteAdminError(undefined);
        }

        const applyIfCurrent = (): boolean =>
          generation === remoteConfigFetchGenerationRef.current &&
          configureTargetNodeNumRef.current === destNodeNum;

        let loadingWatchdogFired = false;
        let modulesPartialApplied = false;
        let loadingWatchdogId: ReturnType<typeof setTimeout> | undefined;
        const foregroundRoute = !isBackgroundRoute ? route : null;
        if (foregroundRoute != null) {
          loadingWatchdogId = setTimeout(() => {
            if (!applyIfCurrent()) return;
            if (remoteAdminStatusRef.current !== 'loading') return;
            loadingWatchdogFired = true;
            remoteConfigInflightRoutesRef.current.delete(route);
            remoteAdminClientRef.current?.resetEditState(new Error('remoteAdmin.errors.timeout'));
            if (foregroundRoute === 'modules' && modulesPartialApplied) {
              remoteConfigLoadedRoutesRef.current.add(route);
              setRemoteAdminStatus('ready');
              setRemoteAdminError('remoteAdmin.errors.moduleConfigPartial');
            } else {
              setRemoteAdminStatus('error');
              setRemoteAdminError('remoteAdmin.errors.timeout');
            }
          }, remoteConfigLoadingWatchdogMsForRoute(foregroundRoute));
        }

        setRemoteAdminReadsActive(true);
        try {
          if (loadingWatchdogFired) return;
          const applyPartial = (partial: Partial<MeshtasticRemoteConfigSnapshot>): void => {
            if (!applyIfCurrent()) return;
            setRemoteConfigSnapshot((prev) =>
              prev == null
                ? { moduleConfigs: {}, ...partial }
                : mergeMeshtasticRemoteConfigSnapshots(prev, partial),
            );
          };

          let routeResult: Partial<MeshtasticRemoteConfigSnapshot>;
          if (route === 'radio') {
            routeResult = await fetchMeshtasticRemoteConfigSnapshotRadio(client, destNodeNum);
          } else if (route === 'channelsTail') {
            routeResult = await fetchMeshtasticRemoteConfigChannelsTail(client, destNodeNum);
          } else if (route === 'owner') {
            routeResult = await fetchMeshtasticRemoteConfigOwner(client, destNodeNum);
          } else if (route === 'security') {
            routeResult = await fetchMeshtasticRemoteConfigSecurity(client, destNodeNum);
          } else {
            routeResult = await fetchMeshtasticRemoteConfigModules(client, destNodeNum, {
              onPartial: (partial) => {
                modulesPartialApplied = Object.keys(partial.moduleConfigs ?? {}).length > 0;
                applyPartial(partial);
              },
            });
          }

          if (loadingWatchdogFired) return;
          if (!applyIfCurrent()) {
            clearRemoteAdminLoadingIfNoForegroundInflight();
            return;
          }
          applyPartial(routeResult);
          remoteConfigLoadedRoutesRef.current.add(route);
          if (route === 'channelsTail') {
            const tailFailed = (routeResult.failedChannelIndices?.length ?? 0) > 0;
            setRemoteConfigChannelsTailStatus(tailFailed ? 'partial' : 'ready');
          }
          setRemoteAdminStatus('ready');
          setRemoteAdminError(
            routeResult.loraConfigFetchError ??
              (route === 'modules' && modulesPartialApplied
                ? undefined
                : routeResult.primaryChannelConfigFetchFailed ||
                    routeResult.channelConfigFetchFailed
                  ? 'remoteAdmin.errors.channelConfigPartial'
                  : undefined),
          );

          if (route === 'radio') {
            void enqueueRemoteConfigFetch(async () => {
              const backgroundRoutes: {
                route: Extract<RemoteConfigRoute, 'channelsTail' | 'owner'>;
                fetch: () => Promise<Partial<MeshtasticRemoteConfigSnapshot>>;
              }[] = [
                {
                  route: 'channelsTail',
                  fetch: () => fetchMeshtasticRemoteConfigChannelsTail(client, destNodeNum),
                },
                {
                  route: 'owner',
                  fetch: () => fetchMeshtasticRemoteConfigOwner(client, destNodeNum),
                },
              ];
              for (const background of backgroundRoutes) {
                if (!applyIfCurrent()) return;
                if (remoteConfigLoadedRoutesRef.current.has(background.route)) continue;
                if (remoteConfigInflightRoutesRef.current.has(background.route)) continue;
                remoteConfigInflightRoutesRef.current.add(background.route);
                if (background.route === 'channelsTail') {
                  setRemoteConfigChannelsTailStatus('loading');
                }
                setRemoteAdminReadsActive(true);
                try {
                  const partial = await background.fetch();
                  if (!applyIfCurrent()) return;
                  applyPartial(partial);
                  remoteConfigLoadedRoutesRef.current.add(background.route);
                  if (background.route === 'channelsTail') {
                    const tailFailed = (partial.failedChannelIndices?.length ?? 0) > 0;
                    setRemoteConfigChannelsTailStatus(tailFailed ? 'partial' : 'ready');
                  }
                } catch (e) {
                  if (!applyIfCurrent()) return;
                  if (background.route === 'channelsTail') {
                    setRemoteConfigChannelsTailStatus('partial');
                  }
                  console.warn(
                    '[useMeshtasticRuntime] remote config background fetch failed ' +
                      errLikeToLogString(e),
                  );
                } finally {
                  setRemoteAdminReadsActive(false);
                  remoteConfigInflightRoutesRef.current.delete(background.route);
                }
              }
            });
          }
        } catch (e) {
          if (loadingWatchdogFired) return;
          if (!applyIfCurrent()) {
            clearRemoteAdminLoadingIfNoForegroundInflight();
            return;
          }
          if (isBackgroundRoute) {
            if (route === 'channelsTail') {
              setRemoteConfigChannelsTailStatus('partial');
            }
            console.warn(
              '[useMeshtasticRuntime] remote config background fetch failed ' +
                errLikeToLogString(e),
            );
            return;
          }
          const msg = normalizeRemoteAdminError(e);
          setRemoteAdminStatus('error');
          setRemoteAdminError(msg);
          console.warn(
            '[useMeshtasticRuntime] remote config fetch failed ' + errLikeToLogString(e),
          );
        } finally {
          setRemoteAdminReadsActive(false);
          if (loadingWatchdogId != null) clearTimeout(loadingWatchdogId);
          remoteConfigInflightRoutesRef.current.delete(route);
        }
      });
    },
    [enqueueRemoteConfigFetch, getRemoteAdminKeyForNode, state.status],
  );

  useEffect(() => {
    if (configureTargetNodeNum == null) return;
    if (state.status !== 'configured') return;
    void refreshRemoteConfigSnapshot(configureTargetNodeNum, 'radio');
  }, [configureTargetNodeNum, state.status, refreshRemoteConfigSnapshot]);

  const runRemoteAdminOp = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T> => {
      const run = async (): Promise<T> => {
        try {
          return await operation();
        } catch (e) {
          const msg = normalizeRemoteAdminError(e);
          setRemoteAdminStatus('error');
          setRemoteAdminError(msg);
          console.warn(
            '[useMeshtasticRuntime] remote admin operation failed ' + errLikeToLogString(e),
          );
          throw e;
        }
      };
      if (configureTargetNodeNumRef.current != null) {
        return new Promise<T>((resolve, reject) => {
          void enqueueRemoteConfigFetch(async () => {
            try {
              resolve(await run());
            } catch (e) {
              // catch-no-log-ok reject propagates to caller; run() already logged the failure
              reject(e instanceof Error ? e : new Error(String(e)));
            }
          });
        });
      }
      return run();
    },
    [enqueueRemoteConfigFetch],
  );

  const setConfigureTargetNodeNum = useCallback((nodeNum: number | null) => {
    const prevTarget = configureTargetNodeNumRef.current;
    const normalized =
      nodeNum != null && nodeNum > 0 && nodeNum !== myNodeNumRef.current ? nodeNum : null;
    setConfigureTargetNodeNumState(normalized);
    configureTargetNodeNumRef.current = normalized;
    if (normalized != null) {
      skipLocalLoraConfigRef.current = true;
      if (localLoraConfigTimerRef.current != null) {
        clearTimeout(localLoraConfigTimerRef.current);
        localLoraConfigTimerRef.current = undefined;
      }
    } else {
      skipLocalLoraConfigRef.current = false;
    }
    const persistValue = normalized == null ? '' : String(normalized);
    mergeAppSetting(
      'meshtasticConfigureTargetNodeNum',
      persistValue,
      'useMeshtasticRuntime setConfigureTargetNodeNum',
    );
    void window.electronAPI.appSettings
      .set('meshtasticConfigureTargetNodeNum', persistValue)
      .catch((e: unknown) => {
        console.warn(
          '[useMeshtasticRuntime] meshtasticConfigureTargetNodeNum persist failed ' +
            errLikeToLogString(e),
        );
      });
    if (normalized == null) {
      remoteConfigFetchGenerationRef.current += 1;
      remoteConfigLoadedRoutesRef.current.clear();
      remoteConfigInflightRoutesRef.current.clear();
      remoteAdminClientRef.current?.resetEditState();
      setRemoteConfigSnapshot(null);
      setRemoteConfigChannelsTailStatus('idle');
      setRemoteAdminStatus('idle');
      setRemoteAdminError(undefined);
      remoteAdminClientRef.current?.sessionStore.clear();
      return;
    }
    if (prevTarget !== normalized) {
      remoteConfigFetchGenerationRef.current += 1;
      remoteConfigLoadedRoutesRef.current.clear();
      remoteConfigInflightRoutesRef.current.clear();
      remoteAdminClientRef.current?.resetEditState();
      remoteAdminClientRef.current?.sessionStore.clear();
      setRemoteConfigChannelsTailStatus('idle');
      setRemoteAdminStatus('loading');
      setRemoteAdminError(undefined);
    }
  }, []);

  useEffect(() => {
    if (configureTargetPersistRestoredRef.current) return;
    if (state.status !== 'configured') return;
    configureTargetPersistRestoredRef.current = true;

    // Radio / Security / Modules configure dropdown always starts on local radio after startup.
    const settings = parseStoredJson<Record<string, unknown>>(
      getAppSettingsRaw(),
      'useMeshtasticRuntime meshtasticConfigureTargetNodeNum startup',
    );
    const raw = settings?.meshtasticConfigureTargetNodeNum;
    if (
      configureTargetNodeNumRef.current != null ||
      (raw != null && raw !== '' && raw !== 'null')
    ) {
      setConfigureTargetNodeNumState(null);
      configureTargetNodeNumRef.current = null;
      remoteConfigLoadedRoutesRef.current.clear();
      remoteConfigInflightRoutesRef.current.clear();
      remoteConfigFetchGenerationRef.current += 1;
      setRemoteConfigSnapshot(null);
      setRemoteConfigChannelsTailStatus('idle');
      setRemoteAdminStatus('idle');
      setRemoteAdminError(undefined);
      remoteAdminClientRef.current?.resetEditState();
      remoteAdminClientRef.current?.sessionStore.clear();
      if (raw != null && raw !== '' && raw !== 'null') {
        mergeAppSetting(
          'meshtasticConfigureTargetNodeNum',
          '',
          'useMeshtasticRuntime startup default local configure target',
        );
        void window.electronAPI.appSettings
          .set('meshtasticConfigureTargetNodeNum', '')
          .catch(() => {
            // catch-no-log-ok best-effort clear persisted remote target on startup
          });
      }
      console.debug('[useMeshtasticRuntime] configure target defaulted to local radio on startup');
    }
  }, [state.status]);

  const setConfig = useCallback(
    async (config: unknown) => {
      const dest = configureTargetNodeNumRef.current;
      const client = remoteAdminClientRef.current;
      if (dest != null && client) {
        await runRemoteAdminOp(() => client.setRemoteConfig(dest, config));
        return;
      }
      if (!deviceRef.current) return;
      // `config` is typed as `unknown` at the call site; cast required to satisfy the SDK's
      // setConfig overload. `as any` keeps the React Compiler memoization analysis intact.
      await deviceRef.current.setConfig(config as any);
    },
    [runRemoteAdminOp],
  );

  const commitConfig = useCallback(async () => {
    const dest = configureTargetNodeNumRef.current;
    const client = remoteAdminClientRef.current;
    if (dest != null && client) {
      await runRemoteAdminOp(() => client.commitRemoteEdit(dest));
      await refreshRemoteConfigSnapshot(dest, 'radio', { force: true });
      return;
    }
    if (!deviceRef.current) return;
    await deviceRef.current.commitEditSettings();
  }, [refreshRemoteConfigSnapshot, runRemoteAdminOp]);

  const setDeviceChannel = useCallback(
    async (args: {
      index: number;
      role: number;
      settings: {
        name: string;
        psk: Uint8Array;
        uplinkEnabled: boolean;
        downlinkEnabled: boolean;
        positionPrecision: number;
      };
    }) => {
      const dest = configureTargetNodeNumRef.current;
      const client = remoteAdminClientRef.current;
      const channel = create(ProtobufChannel.ChannelSchema, {
        index: args.index,
        role: args.role,
        settings: create(ProtobufChannel.ChannelSettingsSchema, {
          name: args.settings.name,
          psk: args.settings.psk,
          uplinkEnabled: args.settings.uplinkEnabled,
          downlinkEnabled: args.settings.downlinkEnabled,
          moduleSettings: create(ProtobufChannel.ModuleSettingsSchema, {
            positionPrecision: args.settings.positionPrecision,
          }),
        }),
      }) as ChannelType;
      if (dest != null && client) {
        await runRemoteAdminOp(() => client.setRemoteChannel(dest, channel));
        return;
      }
      if (!deviceRef.current) return;
      await deviceRef.current.setChannel(channel);
    },
    [runRemoteAdminOp],
  );

  const clearChannel = useCallback(
    async (index: number) => {
      const dest = configureTargetNodeNumRef.current;
      const client = remoteAdminClientRef.current;
      if (dest != null && client) {
        const channel = create(ProtobufChannel.ChannelSchema, {
          index,
          role: ProtobufChannel.Channel_Role.DISABLED,
        });
        await runRemoteAdminOp(() => client.setRemoteChannel(dest, channel));
        return;
      }
      if (!deviceRef.current) return;
      await deviceRef.current.clearChannel(index);
    },
    [runRemoteAdminOp],
  );

  const applyChannelSet = useCallback(
    async (
      parsed: ParsedChannelSet,
      options?: { applyLora?: boolean },
    ): Promise<ApplyChannelSetResult> => {
      if (!deviceRef.current) {
        throw new Error('Not connected to a device');
      }

      const applyLora =
        options?.applyLora ?? (parsed.mode === 'replace' && parsed.loraConfig != null);

      const skipped: ApplyChannelSetResult['skipped'] = [];
      let appliedCount = 0;

      if (parsed.mode === 'replace') {
        for (let i = 0; i < parsed.settings.length; i++) {
          const settings = parsed.settings[i];
          if (!settings) continue;
          await setDeviceChannel({
            index: i,
            role: i === 0 ? MESHTASTIC_CHANNEL_ROLE.PRIMARY : MESHTASTIC_CHANNEL_ROLE.SECONDARY,
            settings,
          });
          appliedCount++;
        }
        for (let i = parsed.settings.length; i < 8; i++) {
          await clearChannel(i);
        }
      } else {
        const slotSnapshot = () =>
          channelConfigsRef.current.map((c) => ({
            index: c.index,
            role: c.role,
            name: c.name,
          }));
        const toApply: typeof parsed.settings = [];
        for (const settings of parsed.settings) {
          if (!settings.name) {
            skipped.push({ name: '', reason: 'empty_name' });
            continue;
          }
          if (channelNameExists(slotSnapshot(), settings.name)) {
            skipped.push({ name: settings.name, reason: 'duplicate_name' });
            continue;
          }
          toApply.push(settings);
        }
        const freeSlots = countFreeChannelSlots(slotSnapshot());
        if (toApply.length > freeSlots) {
          throw new Error(
            `Need ${toApply.length} free channel slots but only ${freeSlots} available`,
          );
        }
        const reserved = new Set<number>();
        for (const settings of toApply) {
          const freeIndex = findNextFreeChannelSlot(slotSnapshot(), reserved);
          if (freeIndex === null) {
            throw new Error('No free channel slots');
          }
          reserved.add(freeIndex);
          await setDeviceChannel({
            index: freeIndex,
            role: MESHTASTIC_CHANNEL_ROLE.SECONDARY,
            settings,
          });
          appliedCount++;
        }
      }

      if (applyLora && parsed.loraConfig) {
        await setConfig(
          create(Config.ConfigSchema, {
            payloadVariant: { case: 'lora', value: parsed.loraConfig },
          }),
        );
      }
      await commitConfig();
      return { appliedCount, skipped };
    },
    [setDeviceChannel, clearChannel, setConfig, commitConfig],
  );

  const setOwner = useCallback(
    async (owner: { longName: string; shortName: string; isLicensed: boolean }) => {
      const dest = configureTargetNodeNumRef.current;
      const client = remoteAdminClientRef.current;
      const user = create(Mesh.UserSchema, {
        longName: owner.longName,
        shortName: owner.shortName,
        isLicensed: owner.isLicensed,
      }) as UserType;
      if (dest != null && client) {
        await runRemoteAdminOp(() => client.setRemoteOwner(dest, user));
        return;
      }
      if (!deviceRef.current) return;
      await deviceRef.current.setOwner(user);
    },
    [runRemoteAdminOp],
  );

  const reboot = useCallback(
    async (delay: number) => {
      const dest = configureTargetNodeNumRef.current;
      const client = remoteAdminClientRef.current;
      if (dest != null && client) {
        await runRemoteAdminOp(() => client.remoteReboot(dest, delay));
        return;
      }
      if (!deviceRef.current) return;
      await deviceRef.current.reboot(delay);
    },
    [runRemoteAdminOp],
  );

  const shutdown = useCallback(
    async (delay: number) => {
      const dest = configureTargetNodeNumRef.current;
      const client = remoteAdminClientRef.current;
      if (dest != null && client) {
        await runRemoteAdminOp(() => client.remoteShutdown(dest, delay));
        return;
      }
      if (!deviceRef.current) return;
      await deviceRef.current.shutdown(delay);
    },
    [runRemoteAdminOp],
  );

  const factoryReset = useCallback(async () => {
    const dest = configureTargetNodeNumRef.current;
    const client = remoteAdminClientRef.current;
    if (dest != null && client) {
      await runRemoteAdminOp(() => client.remoteFactoryResetDevice(dest));
      return;
    }
    if (!deviceRef.current) return;
    await deviceRef.current.factoryResetDevice();
  }, [runRemoteAdminOp]);

  const resetNodeDb = useCallback(
    async (preserveFavorites = false) => {
      const dest = configureTargetNodeNumRef.current;
      const client = remoteAdminClientRef.current;
      if (dest != null && client) {
        await runRemoteAdminOp(() => client.remoteResetNodeDb(dest, preserveFavorites));
        return;
      }
      if (!deviceRef.current) return;
      await deviceRef.current.resetNodes();
    },
    [runRemoteAdminOp],
  );

  const rebootOta = useCallback(async (delay = 2) => {
    if (!deviceRef.current) return;
    await deviceRef.current.rebootOta(delay);
  }, []);

  const enterDfuMode = useCallback(async () => {
    if (!deviceRef.current) return;
    await deviceRef.current.enterDfuMode();
  }, []);

  const xmodemUpload = useCallback(async () => {
    if (!deviceRef.current) throw new Error('Not connected to radio');
    const picked = await window.electronAPI.meshtasticXmodem.pickUploadFile();
    if (!picked) return;
    await meshtasticXmodemUpload(deviceRef.current, picked.filename, picked.data);
  }, []);

  const xmodemDownload = useCallback(async (filename: string) => {
    if (!deviceRef.current) throw new Error('Not connected to radio');
    const trimmed = filename.trim();
    if (!trimmed) throw new Error('Filename required');
    const data = await meshtasticXmodemDownload(deviceRef.current, trimmed);
    await window.electronAPI.meshtasticXmodem.saveDownloadFile(trimmed, data);
  }, []);

  const factoryResetConfig = useCallback(async () => {
    const dest = configureTargetNodeNumRef.current;
    const client = remoteAdminClientRef.current;
    if (dest != null && client) {
      await runRemoteAdminOp(() => client.remoteFactoryResetConfig(dest));
      return;
    }
    if (!deviceRef.current) return;
    await deviceRef.current.factoryResetConfig();
  }, [runRemoteAdminOp]);

  const sendWaypoint = useCallback(
    async (wp: Omit<MeshWaypoint, 'from' | 'timestamp'>, dest = 0xffffffff, channel = 0) => {
      if (!deviceRef.current) return;
      const waypoint = create(Mesh.WaypointSchema, {
        id: wp.id,
        latitudeI: Math.round(wp.latitude * 1e7),
        longitudeI: Math.round(wp.longitude * 1e7),
        name: wp.name,
        description: wp.description ?? '',
        icon: wp.icon ?? 0,
        lockedTo: wp.lockedTo ?? 0,
        expire: wp.expire ?? 0,
      }) as WaypointType;
      await deviceRef.current.sendWaypoint(waypoint, dest, channel);

      const chCfg = channelConfigsRef.current.find((c) => c.index === channel);
      const fromNum = resolveMeshtasticOutboundFromNodeId({
        hasDevice: !!deviceRef.current,
        myNodeNum: myNodeNumRef.current,
        lastRfSelfNodeId: lastRfSelfNodeIdRef.current,
        virtualNodeId: virtualNodeIdRef.current,
      });
      if (mqttStatusRef.current === 'connected' && fromNum > 0 && chCfg?.uplinkEnabled) {
        const sendWpMqtt = resolveMeshtasticMqttPublishFieldsForChannel(
          channel,
          channelConfigsRef.current,
          loadMeshtasticMqttManualChannelPsks(),
          meshtasticMqttPublishOpts(!deviceRef.current),
        );
        if (sendWpMqtt.channelName) {
          void window.electronAPI.mqtt
            .publishWaypoint({
              from: fromNum,
              to: dest >>> 0,
              channel,
              channelName: sendWpMqtt.channelName,
              pskBase64: sendWpMqtt.pskBase64,
              publishJsonMirror: sendWpMqtt.publishJsonMirror,
              waypoint: {
                id: wp.id,
                latitudeI: Math.round(wp.latitude * 1e7),
                longitudeI: Math.round(wp.longitude * 1e7),
                name: wp.name,
                description: wp.description ?? '',
                icon: wp.icon ?? 0,
                lockedTo: wp.lockedTo ?? 0,
                expire: wp.expire ?? 0,
              },
            })
            .catch((e: unknown) => {
              console.debug(
                '[useMeshtasticRuntime] MQTT publishWaypoint failed ' + errLikeToLogString(e),
              );
            });
        }
      }
    },
    [],
  );

  const deleteWaypoint = useCallback(async (id: number) => {
    if (!deviceRef.current) return;
    const waypoint = create(Mesh.WaypointSchema, { id, expire: 1 }) as WaypointType;
    await deviceRef.current.sendWaypoint(waypoint, 0xffffffff, 0);

    const chCfg = channelConfigsRef.current.find((c) => c.index === 0);
    const fromNum = resolveMeshtasticOutboundFromNodeId({
      hasDevice: !!deviceRef.current,
      myNodeNum: myNodeNumRef.current,
      lastRfSelfNodeId: lastRfSelfNodeIdRef.current,
      virtualNodeId: virtualNodeIdRef.current,
    });
    if (mqttStatusRef.current === 'connected' && fromNum > 0 && chCfg?.uplinkEnabled) {
      const delWpMqtt = resolveMeshtasticMqttPublishFieldsForChannel(
        0,
        channelConfigsRef.current,
        loadMeshtasticMqttManualChannelPsks(),
        meshtasticMqttPublishOpts(!deviceRef.current),
      );
      if (delWpMqtt.channelName) {
        void window.electronAPI.mqtt
          .publishWaypoint({
            from: fromNum,
            to: BROADCAST_ADDR,
            channel: 0,
            channelName: delWpMqtt.channelName,
            pskBase64: delWpMqtt.pskBase64,
            publishJsonMirror: delWpMqtt.publishJsonMirror,
            waypoint: {
              id,
              latitudeI: 0,
              longitudeI: 0,
              name: '',
              description: '',
              icon: 0,
              lockedTo: 0,
              expire: 1,
            },
          })
          .catch((e: unknown) => {
            console.debug(
              '[useMeshtasticRuntime] MQTT publishWaypoint (delete) failed ' +
                errLikeToLogString(e),
            );
          });
      }
    }
  }, []);

  const setModuleConfig = useCallback(
    async (config: unknown) => {
      const dest = configureTargetNodeNumRef.current;
      const client = remoteAdminClientRef.current;
      if (dest != null && client) {
        await runRemoteAdminOp(() => client.setRemoteModuleConfig(dest, config));
        return;
      }
      if (!deviceRef.current) return;
      // setModuleConfig/setCannedMessages/sendPacket exist at runtime but are not in @meshtastic/js
      // SDK types; `as any` is required because `as unknown as T` breaks the React Compiler's
      // memoization analysis inside useCallback.
      await (deviceRef.current as any).setModuleConfig(config);
    },
    [runRemoteAdminOp],
  );

  const setCannedMessages = useCallback(
    async (messages: string[]) => {
      const dest = configureTargetNodeNumRef.current;
      const client = remoteAdminClientRef.current;
      if (dest != null && client) {
        await runRemoteAdminOp(() => client.setRemoteCannedMessages(dest, messages.join('\n')));
        return;
      }
      if (!deviceRef.current) return;
      await (deviceRef.current as any).setCannedMessages({ messages: messages.join('\n') });
    },
    [runRemoteAdminOp],
  );

  const [ringtone, setRingtoneState] = useState<string>('');

  const setRingtone = useCallback(
    async (ringtoneStr: string) => {
      const dest = configureTargetNodeNumRef.current;
      const client = remoteAdminClientRef.current;
      if (dest != null && client) {
        await runRemoteAdminOp(() => client.setRemoteRingtone(dest, ringtoneStr));
        setRingtoneState(ringtoneStr);
        return;
      }
      if (!deviceRef.current) return;
      const msg = create(Admin.AdminMessageSchema, {
        payloadVariant: { case: 'setRingtoneMessage', value: ringtoneStr },
      });
      await (deviceRef.current as any).sendPacket(
        toBinary(Admin.AdminMessageSchema, msg),
        Portnums.PortNum.ADMIN_APP,
        'self',
      );
      setRingtoneState(ringtoneStr);
    },
    [runRemoteAdminOp],
  );

  const getRemoteAdminSessionStatus = useCallback((nodeNum: number): RemoteAdminSessionStatus => {
    return remoteAdminClientRef.current?.sessionStore.getStatus(nodeNum) ?? 'none';
  }, []);

  const requestPosition = useCallback(async (nodeNum: number) => {
    if (!deviceRef.current) return;
    await deviceRef.current.requestPosition(nodeNum);
  }, []);

  const traceRoute = useCallback(async (nodeNum: number) => {
    if (!deviceRef.current) return;
    pendingTraceRequestsRef.current.set(nodeNum, Date.now());
    const packetId = await deviceRef.current.traceRoute(nodeNum);
    pendingTracePacketIdToTargetRef.current.set(packetId >>> 0, nodeNum);
  }, []);

  const deleteNode = useCallback(
    async (nodeId: number) => {
      const activeVirtualNodeId = virtualNodeIdRef.current;
      if (nodeId === activeVirtualNodeId && mqttStatusRef.current === 'connected') {
        throw new Error('Cannot delete active MQTT identity while MQTT is connected');
      }
      if (nodeId === activeVirtualNodeId) {
        clearVirtualNodeId();
        virtualNodeIdRef.current = getOrCreateVirtualNodeId();
      }
      await window.electronAPI.db.deleteNode(nodeId);
      console.debug(
        `[useMeshtasticRuntime] deleteNode: removed 0x${nodeId.toString(16).toUpperCase()} from memory`,
      );
      updateNodes((prev) => {
        const updated = new Map(prev);
        updated.delete(nodeId);
        return updated;
      });
    },
    [updateNodes],
  );

  const refreshNodesFromDb = useCallback(() => {
    void loadMeshtasticNodeMapFromDb()
      .then((nodeMap) => {
        console.debug(`[useMeshtasticRuntime] refreshNodesFromDb: loaded ${nodeMap.size} nodes`);
        nodesRef.current = nodeMap;
        setNodes(nodeMap);
        const storeId =
          meshtasticIdentityIdRef.current ?? meshtasticPendingDriverIdentityRef.current;
        if (storeId) syncMeshtasticNodesMapToIdentityStore(storeId, nodeMap);
      })
      .catch((err: unknown) => {
        console.error('[useMeshtasticRuntime] Failed to refresh nodes: ' + errLikeToLogString(err));
      });
  }, []);

  const refreshMessagesFromDb = useCallback((opts?: { replaceFromDb?: boolean }) => {
    void loadMeshtasticMessagesFromDb()
      .then((fromDb) => {
        console.debug(
          `[useMeshtasticRuntime] refreshMessagesFromDb: loaded ${fromDb.length} messages`,
        );
        for (const m of fromDb) {
          if (m.packetId && m.sender_id) {
            seenPacketIds.current.set(
              meshtasticPacketDedupKey(m.sender_id, m.packetId),
              Date.now() + 10 * 60 * 1000,
            );
          }
        }
        setMessages((prev) => mergeMeshtasticDbHydrationWithLive(prev, fromDb, opts));
        const storeId =
          meshtasticIdentityIdRef.current ?? meshtasticPendingDriverIdentityRef.current;
        if (storeId) {
          void hydrateMeshtasticMessagesFromDb(storeId, opts?.replaceFromDb ? 'replace' : 'upsert');
        }
      })
      .catch((err: unknown) => {
        console.error(
          '[useMeshtasticRuntime] Failed to refresh messages: ' + errLikeToLogString(err),
        );
      });
  }, []);

  const setNodeFavorited = useCallback(
    async (nodeId: number, favorited: boolean) => {
      await window.electronAPI.db.setNodeFavorited(nodeId, favorited);
      const storeId = getIdentityIdForProtocol('meshtastic');
      if (storeId) {
        patchNodeFavorited(storeId, nodeId, favorited);
      }
      updateNodes((prev) => {
        const updated = new Map(prev);
        const existing = updated.get(nodeId);
        if (existing) updated.set(nodeId, { ...existing, favorited });
        return updated;
      });
    },
    [updateNodes],
  );

  const refreshOurPosition = useCallback(async (): Promise<OurPosition | null> => {
    // Dual-protocol: Meshtastic hook stays mounted when user switches to MeshCore; skip GPS work
    // so we do not overwrite Meshtastic state or call getGpsFix / IP while MeshCore is active.
    if (getStoredMeshProtocol() !== 'meshtastic') {
      return null;
    }
    setGpsLoading(true);
    try {
      const myNode = nodesRef.current.get(myNodeNumRef.current);
      const storedStatic = readStoredStaticGps();
      const staticLat = storedStatic?.lat;
      const staticLon = storedStatic?.lon;
      // When a static position is set, don't let device coords override it
      const devLat = storedStatic != null ? undefined : myNode?.latitude;
      const devLon = storedStatic != null ? undefined : myNode?.longitude;
      const devAlt = storedStatic != null ? undefined : myNode?.altitude;
      const pos = await resolveOurPosition(devLat, devLon, staticLat, staticLon, devAlt);
      setOurPosition(pos);
      if (getStoredMeshProtocol() === 'meshtastic') {
        useDiagnosticsStore.getState().setOurPositionSource(pos?.source ?? null);
      }

      if (pos) {
        const hasDevice = !!deviceRef.current;
        const selfNodeId =
          hasDevice && myNodeNumRef.current > 0
            ? myNodeNumRef.current
            : mqttStatusRef.current === 'connected'
              ? virtualNodeIdRef.current
              : 0;
        if (selfNodeId > 0) {
          const isVirtualNode = !hasDevice && selfNodeId === virtualNodeIdRef.current;
          updateNodes((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(selfNodeId) ?? emptyNode(selfNodeId);
            const node: MeshNode = {
              ...existing,
              node_id: selfNodeId,
              latitude: pos.lat,
              longitude: pos.lon,
              last_heard: Date.now(),
              lastPositionWarning: undefined,
              ...(isVirtualNode
                ? { long_name: MQTT_ONLY_VIRTUAL_LONG_NAME, role: ROLE_CLIENT, hops_away: 0 }
                : {}),
            };
            updated.set(selfNodeId, node);
            if (!isVirtualNode) void window.electronAPI.db.saveNode(node);
            return updated;
          });
        }

        const isClientMute = nodesRef.current.get(myNodeNumRef.current)?.role === ROLE_CLIENT_MUTE;
        const wouldSendWithoutMute =
          deviceRef.current &&
          (pos.source === 'static' || (pos.source === 'browser' && deviceGpsModeRef.current === 2));
        const shouldSendToDevice = !isClientMute && wouldSendWithoutMute;

        if (shouldSendToDevice && deviceRef.current) {
          deviceRef.current
            .setPosition(
              create(Mesh.PositionSchema, {
                latitudeI: Math.round(pos.lat * 1e7),
                longitudeI: Math.round(pos.lon * 1e7),
                time: Math.floor(Date.now() / 1000),
              }) as PositionType,
            )
            .catch((e: unknown) => {
              console.debug(
                '[useMeshtasticRuntime] setPosition non-fatal ' + errLikeToLogString(e),
              );
            });
        }
      }
      return pos;
    } finally {
      setGpsLoading(false);
    }
  }, [updateNodes]);

  // Keep ref in sync so intervals/callbacks always call the latest version
  refreshOurPositionRef.current = refreshOurPosition;

  // Resolve position on app startup regardless of device connection
  useEffect(() => {
    void refreshOurPositionRef.current();
  }, []);

  const sendPositionToDevice = useCallback(async (lat: number, lon: number, alt?: number) => {
    if (!deviceRef.current) return;
    if (nodesRef.current.get(myNodeNumRef.current)?.role === ROLE_CLIENT_MUTE) return;
    await deviceRef.current.setPosition(
      create(Mesh.PositionSchema, {
        latitudeI: Math.round(lat * 1e7),
        longitudeI: Math.round(lon * 1e7),
        altitude: alt ?? 0,
        time: Math.floor(Date.now() / 1000),
      }) as PositionType,
    );
  }, []);

  const updateGpsInterval = useCallback(
    (secs: number) => {
      stopGpsInterval();
      if (secs > 0) {
        gpsIntervalRef.current = setInterval(() => {
          refreshOurPositionRef.current().catch((err: unknown) => {
            console.error(
              '[useMeshtasticRuntime] GPS interval refresh error: ' + errLikeToLogString(err),
            );
          });
        }, secs * 1000);
      }
    },
    [stopGpsInterval],
  );

  const requestRefresh = useCallback(async () => {
    if (!deviceRef.current) return;
    await deviceRef.current.configure();
  }, []);

  const sendReaction = useCallback(
    (glyph: string, replyId: number, channel: number): Promise<void> => {
      const hasMqtt = mqttStatusRef.current === 'connected';
      if (!deviceRef.current && !hasMqtt) return Promise.reject(new Error('Not connected'));
      const from = resolveMeshtasticOutboundFromNodeId({
        hasDevice: !!deviceRef.current,
        myNodeNum: myNodeNumRef.current,
        lastRfSelfNodeId: lastRfSelfNodeIdRef.current,
        virtualNodeId: virtualNodeIdRef.current,
      });
      if (!deviceRef.current && myNodeNumRef.current !== from) {
        myNodeNumRef.current = from;
        setState((prev) => ({ ...prev, myNodeNum: from }));
      }
      const identityId = meshtasticIdentityIdRef.current;
      const storeMsgs = identityId
        ? messageRecordsToChatMessages(
            Object.values(useMessageStore.getState().messages[identityId] ?? {}),
          )
        : messagesRef.current;
      const repliedMsg =
        storeMsgs.find((m) => m.packetId === replyId) ??
        storeMsgs.find((m) => m.timestamp === replyId) ??
        null;
      const wireReplyId = repliedMsg?.packetId;
      if (wireReplyId == null || wireReplyId === 0) {
        return Promise.reject(
          new Error(
            'Tapback requires the message RF packet id (wait for send ack or refresh chat).',
          ),
        );
      }
      const replyTargetsMqttOnly = repliedMsg?.receivedVia === 'mqtt';
      if (hasMqtt && replyTargetsMqttOnly) {
        return Promise.reject(
          new Error(
            'Tapbacks to MQTT-origin messages are not currently supported. Send a normal reply instead.',
          ),
        );
      }
      const parsed = reactionGlyphFromPicker(glyph);
      if (!parsed) {
        return Promise.reject(new Error('Invalid reaction emoji'));
      }
      const tapPayload = parsed.glyph;
      const safeScalar = sanitizeUnicodeReactionScalar(parsed.scalar);
      if (safeScalar === undefined) {
        return Promise.reject(new Error('Invalid reaction emoji'));
      }

      const msg: ChatMessage = {
        sender_id: from,
        sender_name: getNodeName(from),
        payload: tapPayload,
        channel,
        timestamp: Date.now(),
        emoji: safeScalar,
        replyId: wireReplyId,
      };

      if (identityId) {
        const reactionTempId = (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0;
        upsertMessage(identityId, {
          id: String(reactionTempId),
          from,
          senderName: getNodeName(from),
          to: BROADCAST_ADDR,
          payload: tapPayload,
          channelIndex: channel,
          timestamp: msg.timestamp,
          status: 'sending',
          tapback: true,
          replyTo: String(wireReplyId),
        });
        trackMeshtasticOutboundTempId(reactionTempId, String(reactionTempId));
        void window.electronAPI.db
          .saveMessage({ ...msg, packetId: reactionTempId })
          .catch((e: unknown) => {
            console.debug(
              '[useMeshtasticRuntime] sendReaction saveMessage failed ' + errLikeToLogString(e),
            );
          });
      } else {
        // Legacy runtime-only path (no identity store yet)
        setMessages((prev) => {
          const isDup = prev.some(
            (m) =>
              m.emoji === safeScalar &&
              m.replyId === wireReplyId &&
              m.sender_id === from &&
              m.payload === tapPayload,
          );
          if (isDup) return prev;
          return trimChatMessagesToMax([...prev, msg], MAX_IN_MEMORY_CHAT_MESSAGES);
        });
        void window.electronAPI.db.saveMessage(msg);
      }

      // Device transport — mesh.proto: `emoji` is a boolean flag; the glyph is UTF-8 in `payload`.
      if (deviceRef.current) {
        deviceRef.current
          .sendText(
            tapPayload,
            'broadcast',
            true,
            channel,
            wireReplyId,
            MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG,
          )
          .then(() => {})
          .catch((e: unknown) => {
            console.warn(
              '[useMeshtasticRuntime] sendReaction device sendText failed ' + errLikeToLogString(e),
            );
          });
      } else if (hasMqtt) {
        const reactionMqtt = resolveMeshtasticMqttPublishFieldsForChannel(
          channel,
          channelConfigsRef.current,
          loadMeshtasticMqttManualChannelPsks(),
          meshtasticMqttPublishOpts(true),
        );
        if (!reactionMqtt.channelName) {
          return Promise.reject(new Error('No MQTT channel configured for reaction'));
        }
        return window.electronAPI.mqtt
          .publish({
            text: tapPayload,
            from,
            channel,
            destination: BROADCAST_ADDR,
            channelName: reactionMqtt.channelName,
            pskBase64: reactionMqtt.pskBase64,
            emoji: MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG,
            replyId: wireReplyId,
            publishJsonMirror: reactionMqtt.publishJsonMirror,
          })
          .then((packetId) => {
            isDuplicate(from, packetId);
          });
      }

      return Promise.resolve();
    },
    [getNodeName, isDuplicate],
  );

  const sendStatusEvents = useCallback(() => {
    const activeStatuses = ['connected', 'configured', 'stale', 'reconnecting'];
    if (activeStatuses.includes(state.status)) {
      window.electronAPI.notifyDeviceConnected();
    } else if (state.status === 'disconnected') {
      window.electronAPI.notifyDeviceDisconnected();
    }
  }, [state.status]);

  useEffect(() => {
    sendStatusEvents();
  }, [sendStatusEvents]);

  useEffect(() => {
    if (state.status === 'disconnected') {
      setTelemetryDeviceUpdateInterval(null);
    }
  }, [state.status]);

  const telemetryEnabled =
    telemetryDeviceUpdateInterval === null ? null : telemetryDeviceUpdateInterval > 0;

  const selfNodeId =
    state.myNodeNum > 0
      ? state.myNodeNum
      : mqttStatus === 'connected'
        ? resolveMqttOnlyFromNodeId(lastRfSelfNodeIdRef.current, virtualNodeIdRef.current)
        : 0;
  const virtualNodeId = virtualNodeIdRef.current;

  const getNodes = useCallback(() => nodesRef.current, []);

  const clearRawPackets = useCallback(() => {
    setRawPackets([]);
  }, []);

  // Read identity-scoped store slices synchronously (no zustand subscribe here — App
  // subscribes via useMessages/useNodes; legacy setState still triggers re-renders).
  const meshtasticDeviceRecord = useDeviceStore((s) =>
    meshtasticIdentityId ? s.devices[meshtasticIdentityId] : undefined,
  );
  const meshtasticNodesFromStore = useNodeStore((s) =>
    meshtasticIdentityId ? s.nodes[meshtasticIdentityId] : undefined,
  );
  const meshtasticTraceRoutesFromStore = useNodeStore((s) =>
    meshtasticIdentityId ? s.traceRoutes[meshtasticIdentityId] : undefined,
  );
  const meshtasticWaypointsFromStore = useNodeStore((s) =>
    meshtasticIdentityId ? s.waypoints[meshtasticIdentityId] : undefined,
  );
  const meshtasticNeighborInfoFromStore = useNodeStore((s) =>
    meshtasticIdentityId ? s.neighborInfo[meshtasticIdentityId] : undefined,
  );
  const meshtasticConnectionFromStore = useConnectionStore((s) =>
    meshtasticIdentityId ? s.connections[meshtasticIdentityId] : undefined,
  );
  const meshtasticMessagesFromStore = useMessageStore((s) =>
    meshtasticIdentityId ? s.messages[meshtasticIdentityId] : undefined,
  );

  const resolvedMessages = useMemo(() => {
    if (!meshtasticIdentityId) return messages;
    if (!meshtasticMessagesFromStore) return messages;
    const fromStore = messageRecordsToChatMessages(Object.values(meshtasticMessagesFromStore));
    return fromStore.length > 0 ? fromStore : messages;
  }, [meshtasticIdentityId, messages, meshtasticMessagesFromStore]);

  const resolvedNodes = useMemo(() => {
    if (!meshtasticIdentityId) return nodes;
    if (!meshtasticNodesFromStore) return nodes;
    const fromStore = nodeRecordsToMeshNodeMap(Object.values(meshtasticNodesFromStore));
    return fromStore.size > 0 ? fromStore : nodes;
  }, [meshtasticIdentityId, nodes, meshtasticNodesFromStore]);

  const resolvedTraceRouteResults = useMemo(() => {
    if (!meshtasticIdentityId) return traceRouteResults;
    const traceRoutesFromStore = meshtasticTraceRoutesFromStore ?? [];
    if (traceRoutesFromStore.length === 0) return traceRouteResults;
    return traceRouteEventsToResultsMap(traceRoutesFromStore);
  }, [meshtasticIdentityId, traceRouteResults, meshtasticTraceRoutesFromStore]);

  const resolvedWaypoints = useMemo(() => {
    if (!meshtasticIdentityId) return waypoints;
    const waypointsFromStore = meshtasticWaypointsFromStore ?? {};
    if (Object.keys(waypointsFromStore).length === 0) return waypoints;
    return waypointEventsToMeshWaypointMap(waypointsFromStore);
  }, [meshtasticIdentityId, waypoints, meshtasticWaypointsFromStore]);

  const resolvedNeighborInfo = useMemo(() => {
    if (!meshtasticIdentityId) return neighborInfo;
    const neighborInfoFromStore = meshtasticNeighborInfoFromStore ?? {};
    if (Object.keys(neighborInfoFromStore).length === 0) return neighborInfo;
    return neighborInfoEventsToRecordMap(neighborInfoFromStore);
  }, [meshtasticIdentityId, neighborInfo, meshtasticNeighborInfoFromStore]);

  const resolvedQueueStatus = useMemo(() => {
    if (!meshtasticIdentityId) return queueStatus;
    const conn = meshtasticConnectionFromStore;
    if (conn?.queueFree != null && conn.queueMax != null) {
      return { free: conn.queueFree, maxlen: conn.queueMax, res: 0 };
    }
    return queueStatus;
  }, [meshtasticIdentityId, queueStatus, meshtasticConnectionFromStore]);

  const resolvedChannels = useMemo(() => {
    if (!meshtasticIdentityId) return channels;
    if (meshtasticDeviceRecord?.channels.length) return meshtasticDeviceRecord.channels;
    return channels;
  }, [meshtasticIdentityId, channels, meshtasticDeviceRecord]);

  const resolvedChannelConfigs = useMemo(() => {
    if (!meshtasticIdentityId) return channelConfigs;
    if (meshtasticDeviceRecord?.channelConfigs.length) return meshtasticDeviceRecord.channelConfigs;
    return channelConfigs;
  }, [meshtasticIdentityId, channelConfigs, meshtasticDeviceRecord]);

  const resolvedModuleConfigs = useMemo(() => {
    if (!meshtasticIdentityId) return moduleConfigs;
    if (meshtasticDeviceRecord && Object.keys(meshtasticDeviceRecord.moduleConfigs).length > 0) {
      return meshtasticDeviceRecord.moduleConfigs;
    }
    return moduleConfigs;
  }, [meshtasticIdentityId, moduleConfigs, meshtasticDeviceRecord]);

  const resolvedMeshtasticConfigSlices = useMemo(() => {
    if (!meshtasticIdentityId) return {};
    return meshtasticDeviceRecord?.meshtasticConfigSlices ?? {};
  }, [meshtasticIdentityId, meshtasticDeviceRecord]);

  const resolvedDeviceLogs = useMemo(() => {
    if (!meshtasticIdentityId) return deviceLogs;
    if (meshtasticDeviceRecord?.deviceLogs.length) return meshtasticDeviceRecord.deviceLogs;
    return deviceLogs;
  }, [meshtasticIdentityId, deviceLogs, meshtasticDeviceRecord]);

  const resolvedRawPackets = useMemo(() => {
    if (!meshtasticIdentityId) return rawPackets;
    if (meshtasticDeviceRecord?.rawPackets.length) return meshtasticDeviceRecord.rawPackets;
    return rawPackets;
  }, [meshtasticIdentityId, rawPackets, meshtasticDeviceRecord]);

  useEffect(() => {
    if (!meshtasticIdentityId) return;
    setConnection(meshtasticIdentityId, {
      status: state.status,
      connectionLoss: state.connectionLoss,
      serialNeedsReselect: state.serialNeedsReselect,
      myNodeNum: state.myNodeNum,
      connectionType: state.connectionType,
      reconnectAttempt: state.reconnectAttempt,
      lastDataReceivedAt: state.lastDataReceived ? new Date(state.lastDataReceived) : undefined,
      firmwareVersion: state.firmwareVersion,
      manufacturerModel: state.manufacturerModel,
      batteryPercent: state.batteryPercent,
      batteryCharging: state.batteryCharging,
      mqttStatus,
    });
  }, [meshtasticIdentityId, state, mqttStatus]);

  useEffect(() => {
    registerMeshtasticSerialDisconnectTarget({
      isSerialConnected: () => connectionParamsRef.current?.type === 'serial',
      onDisconnected: () => handleConnectionLostRef.current(),
    });
    return () => registerMeshtasticSerialDisconnectTarget(null);
  }, []);

  useEffect(() => {
    registerMeshtasticSession({
      prepareRfConnect,
      attachRfSession,
      handleRfConnectFailure,
      finalizeDriverDisconnect,
      connectAutomatic,
      sendChatMessage: sendMessage,
    });
    return () => registerMeshtasticSession(null);
  }, [
    prepareRfConnect,
    attachRfSession,
    handleRfConnectFailure,
    finalizeDriverDisconnect,
    connectAutomatic,
    sendMessage,
  ]);

  return useMemo(
    () => ({
      state,
      mqttStatus,
      mqttConnectionLoss,
      messages: resolvedMessages,
      nodes: resolvedNodes,
      telemetry,
      signalTelemetry,
      environmentTelemetry,
      channels: resolvedChannels,
      channelConfigs: resolvedChannelConfigs,
      loraConfig,
      traceRouteResults: resolvedTraceRouteResults,
      ourPosition,
      selfNodeId,
      virtualNodeId,
      lastRfSelfNodeId: lastRfSelfNodeIdRef.current,
      deviceGpsMode,
      deviceFixedPosition,
      telemetryEnabled,
      telemetryDeviceUpdateInterval,
      connect,
      connectAutomatic,
      disconnect,
      onPowerSuspend,
      onPowerResume,
      prepareRfConnect,
      attachRfSession,
      handleRfConnectFailure,
      finalizeDriverDisconnect,
      sendMessage,
      sendReaction,
      setConfig,
      commitConfig,
      setDeviceChannel,
      clearChannel,
      applyChannelSet,
      reboot,
      shutdown,
      factoryReset,
      resetNodeDb,
      requestPosition,
      traceRoute,
      deleteNode,
      setNodeFavorited,
      refreshNodesFromDb,
      refreshMessagesFromDb,
      requestRefresh,
      gpsLoading,
      refreshOurPosition,
      sendPositionToDevice,
      updateGpsInterval,
      getNodeName,
      getPickerStyleNodeLabel,
      getFullNodeLabel,
      getNodes,
      deviceOwner,
      setOwner,
      queueStatus: resolvedQueueStatus,
      deviceLogs: resolvedDeviceLogs,
      rawPackets: resolvedRawPackets,
      clearRawPackets,
      neighborInfo: resolvedNeighborInfo,
      waypoints: resolvedWaypoints,
      rebootOta,
      enterDfuMode,
      xmodemUpload,
      xmodemDownload,
      factoryResetConfig,
      sendWaypoint,
      deleteWaypoint,
      moduleConfigs: resolvedModuleConfigs,
      meshtasticConfigSlices: resolvedMeshtasticConfigSlices,
      setModuleConfig,
      setCannedMessages,
      ringtone,
      setRingtone,
      securityConfig,
      remoteAdminKeysByNode,
      getRemoteAdminKeyForNode,
      setRemoteAdminKeyForNode,
      getRemoteAdminSessionStatus,
      configureTargetNodeNum,
      setConfigureTargetNodeNum,
      remoteAdminStatus,
      remoteAdminError,
      remoteConfigSnapshot,
      remoteConfigChannelsTailStatus,
      refreshRemoteConfigSnapshot,
      // ─── Additional packet type state ───────────────────────────────
      remoteHardwareMessages,
      audioMessages,
      detectionSensorEvents,
      pingResponses,
      ipTunnelMessages,
      paxCounterData,
      serialMessages,
      storeForwardMessages,
      requestStoreForwardHistory,
      rangeTestPackets,
      zpsMessages,
      simulatorPackets,
      atakMessages,
      mapReports,
      privateMessages,
      /** Identity id for protocol-scoped stores; null when disconnected. */
      identityId: meshtasticIdentityId,
    }),
    [
      state,
      mqttStatus,
      mqttConnectionLoss,
      resolvedMessages,
      resolvedNodes,
      telemetry,
      signalTelemetry,
      environmentTelemetry,
      resolvedChannels,
      resolvedChannelConfigs,
      loraConfig,
      resolvedTraceRouteResults,
      ourPosition,
      selfNodeId,
      virtualNodeId,
      deviceGpsMode,
      deviceFixedPosition,
      telemetryEnabled,
      telemetryDeviceUpdateInterval,
      connect,
      connectAutomatic,
      disconnect,
      onPowerSuspend,
      onPowerResume,
      prepareRfConnect,
      attachRfSession,
      handleRfConnectFailure,
      finalizeDriverDisconnect,
      sendMessage,
      sendReaction,
      setConfig,
      commitConfig,
      setDeviceChannel,
      clearChannel,
      applyChannelSet,
      reboot,
      shutdown,
      factoryReset,
      resetNodeDb,
      requestPosition,
      traceRoute,
      deleteNode,
      setNodeFavorited,
      refreshNodesFromDb,
      refreshMessagesFromDb,
      requestRefresh,
      gpsLoading,
      refreshOurPosition,
      sendPositionToDevice,
      updateGpsInterval,
      getNodeName,
      getPickerStyleNodeLabel,
      getFullNodeLabel,
      getNodes,
      deviceOwner,
      setOwner,
      resolvedQueueStatus,
      resolvedDeviceLogs,
      resolvedRawPackets,
      clearRawPackets,
      resolvedNeighborInfo,
      resolvedWaypoints,
      rebootOta,
      enterDfuMode,
      xmodemUpload,
      xmodemDownload,
      factoryResetConfig,
      sendWaypoint,
      deleteWaypoint,
      resolvedModuleConfigs,
      resolvedMeshtasticConfigSlices,
      setModuleConfig,
      setCannedMessages,
      ringtone,
      setRingtone,
      securityConfig,
      remoteAdminKeysByNode,
      getRemoteAdminKeyForNode,
      setRemoteAdminKeyForNode,
      getRemoteAdminSessionStatus,
      configureTargetNodeNum,
      setConfigureTargetNodeNum,
      remoteAdminStatus,
      remoteAdminError,
      remoteConfigSnapshot,
      remoteConfigChannelsTailStatus,
      refreshRemoteConfigSnapshot,
      remoteHardwareMessages,
      audioMessages,
      detectionSensorEvents,
      pingResponses,
      ipTunnelMessages,
      paxCounterData,
      serialMessages,
      storeForwardMessages,
      requestStoreForwardHistory,
      rangeTestPackets,
      zpsMessages,
      simulatorPackets,
      atakMessages,
      mapReports,
      privateMessages,
      meshtasticIdentityId,
    ],
  );
}

export function emptyNode(nodeId: number): MeshNode {
  return {
    node_id: nodeId,
    short_name: '',
    long_name: '',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: 0,
    latitude: null,
    longitude: null,
    role: undefined,
  };
}

export {
  computeNodeInfoLastHeardMs,
  mergeMeshtasticUserPacketLastHeard,
} from '../lib/meshtasticLastHeard';

export function createChatStubNode(nodeId: number, source: 'rf' | 'mqtt'): MeshNode {
  const base = emptyNode(nodeId);
  return {
    ...base,
    long_name: '',
    short_name: '',
    source,
    heard_via_mqtt_only: source === 'mqtt',
    last_heard: Date.now(),
  };
}

export type MeshtasticRuntime = ReturnType<typeof useMeshtasticRuntime>;
