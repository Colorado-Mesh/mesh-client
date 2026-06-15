import type { Connection } from '@liamcottle/meshcore.js';
import { CayenneLpp } from '@liamcottle/meshcore.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/* eslint-disable @typescript-eslint/no-confusing-void-expression */
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  isMeshcoreOffloadAbortError,
  type MeshcoreOffloadFromRadioOptions,
  throwIfMeshcoreOffloadAborted,
} from '@/renderer/lib/meshcoreOffload';

import { withTimeout } from '../../shared/withTimeout';
import {
  buildMeshcoreNodeMapFromDb,
  contactToDbRow,
  findMeshcoreCrossTransportDuplicate,
  formatStructuredLogDetail,
  INITIAL_STATE,
  isMeshcoreRoomChatMessage,
  MANUAL_CONTACTS_KEY,
  mapMeshcoreCrossTransportUpgrade,
  mapMeshcoreDbRowsToChatMessages,
  MAX_ENV_TELEMETRY_POINTS,
  MAX_TELEMETRY_POINTS,
  mergeMeshcoreContactsFromDbIntoNodeMap,
  mergeMeshcoreDbHydrationWithLive,
  mergeStubNodesFromMeshcoreMessages,
  MESHCORE_DEVICE_QUERY_APP_VER,
  MESHCORE_DM_ACK_TIMEOUT_MIN_MS,
  MESHCORE_INIT_TIMEOUT_MS,
  MESHCORE_NEIGHBORS_TIMEOUT_MS,
  MESHCORE_PING_NO_ROUTE_ERROR_DISPLAY_MS,
  MESHCORE_PING_NO_ROUTE_ERROR_MSG,
  MESHCORE_RESPONSE_DEVICE_INFO,
  MESHCORE_ROOM_MESSAGE_CHANNEL,
  MESHCORE_SEND_FLOOD_ADVERT_TIMEOUT_MS,
  MESHCORE_STATUS_TIMEOUT_MS,
  MESHCORE_TELEMETRY_TIMEOUT_MS,
  MESHCORE_TRACE_PRIME_WAIT_MS,
  MESHCORE_TRACE_TIMEOUT_MS,
  meshcoreContactRawFromDevice,
  meshcoreDmAckKeyU32,
  meshcoreFullPubKeyBytesFromContactDbHex,
  meshcoreMessageDedupeKey,
  meshcorePendingDmAckMapKeys,
  meshcorePingNoRouteErrorExpiryUpdate,
  type MeshcoreSavedNodeHopRow,
  meshcoreTraceRouteRejectReason,
  messageToDbRow,
  normalizeMeshCoreError,
  type PendingDmAckEntry,
  persistMeshcoreMessageSenderRepairs,
  registerMeshcorePubKeysFromContactDbRows,
  resolveMeshcoreNodePubKey,
  serializeErrorLike,
  waitForMeshcorePath129ForNode,
} from '../hooks/meshcore/meshcoreHookPreamble';
import {
  attachMeshcoreLegacyConnEvents,
  syncMeshcoreDmAckToMessageStore,
} from '../hooks/meshcore/meshcoreLegacyConnEvents';
import type { MeshcoreLegacyConnEventsCtx } from '../hooks/meshcore/meshcoreLegacyConnEventsCtx';
import { openMeshCoreTransport } from '../hooks/openMeshCoreTransport';
import { getAppSettingsRaw, mergeAppSettingsPartial } from '../lib/appSettingsStorage';
import {
  classifyMeshcoreBleTimeoutStage,
  MESHCORE_SETUP_ABORT_MESSAGE,
} from '../lib/bleConnectErrors';
import { MAX_IN_MEMORY_CHAT_MESSAGES, trimChatMessagesToMax } from '../lib/chatInMemoryBuffer';
import { setMeshcoreDiagnosticsNodes } from '../lib/diagnosticsNodesRef';
import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import type { OurPosition } from '../lib/gpsSource';
import { hasStoredStaticGps, readStoredStaticGps, resolveOurPosition } from '../lib/gpsSource';
import {
  loadMeshcoreMessagesForHydration,
  loadMeshcoreSavedHopRowsForHydration,
  syncMeshcoreNodesMapToIdentityStore,
} from '../lib/hydrateIdentityStoresFromDb';
import { getIdentityIdForProtocol } from '../lib/identityByProtocol';
import { attachMeshcoreIngest } from '../lib/ingest/meshcoreIngest';
import { repairMeshcoreChannelSenderIdsInStore } from '../lib/ingest/meshcoreSenderRepair';
import { resolveLastBlePeripheralId } from '../lib/lastConnectionStorage';
import { tryPersistMeshcoreIdentityFromRadioExport } from '../lib/letsMeshJwt';
import { ensureMeshcoreChatSenderInNodeStore } from '../lib/meshcore/meshcoreChatSenderNode';
import type {
  CayenneLppEntry,
  DeviceLogEntry,
  MeshCoreConnection,
  MeshcoreContactDbRow,
  MeshCoreContactRaw,
  MeshcoreMessageDbRow,
  MeshCoreNeighborEntry,
  MeshCoreNeighborResult,
  MeshCoreNodeTelemetry,
  MeshCorePacketStatsData,
  MeshCoreRadioStatsData,
  MeshCoreRepeaterStatus,
  MeshCoreSelfInfo,
  MeshCoreStatsResponse,
  MeshcoreTraceResultEntry,
  RxPacketEntry,
} from '../lib/meshcore/meshcoreHookTypes';
import { refreshMeshcoreOutPathAfterPathUpdated } from '../lib/meshcore/meshcorePathUpdatedRuntime';
import {
  clearMeshcorePubKeyRegistry,
  copyMeshcorePubKeyRegistryToRefs,
  registerMeshcorePubKey,
  replaceMeshcorePubKeyRegistry,
  setMeshcorePubKeyRegistryRefSync,
} from '../lib/meshcore/meshcorePubKeyRegistry';
import {
  findMeshcoreDmReplyParent,
  formatMeshcoreWireReplyPrefix,
  MESHCORE_TXT_TYPE_PLAIN,
  meshcoreChatMessagesForDisplay,
  normalizeMeshcoreIncomingText,
  parseMeshcoreChannelIncomingFromThread,
  resolveMeshcoreChannelMessageSender,
} from '../lib/meshcoreChannelText';
import {
  buildGetAutoaddConfigFrame,
  buildSetAutoaddConfigFrame,
  mergeAutoaddConfigByte,
  type MeshcoreAutoaddWireState,
  meshcoreCoerceRadioRxFrame,
  parseAutoaddConfigResponse,
} from '../lib/meshcoreContactAutoAdd';
import { queueLenFromMeshCoreCoreStatsRaw } from '../lib/meshcoreCoreStatsQueue';
import {
  meshcoreRoomServerIdsFromContacts,
  meshcoreRoomServerIdsFromNodes,
  repairMeshcoreHydratedMessages,
} from '../lib/meshcoreDbCacheHydration';
import { setMeshcoreDmAckPendingImpl } from '../lib/meshcoreDmAckDelivery';
import { awaitDualNobleBleMeshtasticSettle } from '../lib/meshcoreDualNobleBleInit';
import { applyMeshcoreFloodScope } from '../lib/meshcoreFloodScope';
import {
  buildMeshcoreGetNeighboursRequest,
  parseMeshcoreGetNeighboursResponse,
} from '../lib/meshcoreGetNeighboursBinary';
import { persistMeshcoreSelfNodeId } from '../lib/meshcoreLastSelfNodeId';
import { meshcoreRepeaterTryLogin } from '../lib/meshcoreRepeaterSession';
import {
  clearMeshcoreRoomAutoLoginFailure,
  getMeshcoreRoomAutoLoginFailure,
} from '../lib/meshcoreRoomAutoLoginFailure';
import {
  getMeshcoreRoomCredential,
  listMeshcoreRoomCredentialNodeIds,
  MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX,
  setMeshcoreRoomCredential,
} from '../lib/meshcoreRoomCredentialStorage';
import { syncMeshcoreRoomContactPathBeforeLogin } from '../lib/meshcoreRoomLoginPathSync';
import { resolveMeshcoreRoomLoginRouteBytes } from '../lib/meshcoreRoomLoginRouteResolve';
import { applyMeshcoreRoomLoginFailure } from '../lib/meshcoreRoomSavedSecrets';
import {
  meshcoreRoomPostSendErrorMessage,
  sendMeshcoreRoomPostWithSentWait,
} from '../lib/meshcoreRoomSentWait';
import {
  MESHCORE_ROOM_LOGIN_NO_ROUTE_MESSAGE,
  MESHCORE_ROOM_LOGIN_PATH_SYNC_FAILED_MESSAGE,
  meshcoreCancelRoomLogin,
  meshcoreClearAllRoomSessions,
  meshcoreGetRoomSession,
  meshcoreIsRoomLoggedIn,
  meshcoreIsRoomLoginAbortError,
  meshcoreRoomCanAdmin,
  meshcoreRoomCanPost,
  meshcoreRoomEffectiveGuestPassword,
  meshcoreRoomLogin,
  meshcoreRoomLoginErrorIsAuthFailure,
  meshcoreRoomLoginErrorIsNoRoute,
  meshcoreRoomLogout,
  meshcoreRoomLogoutFailureMessage,
  meshcoreRoomTryRelogin,
  meshcoreTryRemoteServerLogin,
} from '../lib/meshcoreRoomSession';
import { pickMostOverdueRoom, type RoomSyncSchedulerNode } from '../lib/meshcoreRoomSyncScheduler';
import {
  getMeshcoreRoomSyncConfig,
  listMeshcoreRoomAutoLoginOnConnectNodeIds,
  listMeshcoreRoomSyncEnabledNodeIds,
  MESHCORE_ROOM_SYNC_SETTING_PREFIX,
  setMeshcoreRoomLastPostAt,
  setMeshcoreRoomSyncConfig,
  touchMeshcoreRoomLastSyncAt,
} from '../lib/meshcoreRoomSyncStorage';
import {
  meshcoreMessageStoreId,
  meshcoreSortedStorePrior,
  upsertMeshcoreMessageWithDedup,
} from '../lib/meshcoreStoreDedup';
import {
  buildMeshcoreSetOtherParamsFrame,
  enrichMeshCoreSelfInfo,
  packMeshcoreTelemetryModesByte,
} from '../lib/meshcoreTelemetryPrivacy';
import {
  type MeshcoreTracePathMuxConnection,
  runMeshcoreTracePathMultiplexed,
} from '../lib/meshcoreTracePathMultiplex';
import {
  coerceMeshcoreExportPrivateKeyResult,
  CONTACT_TYPE_LABELS,
  isMeshcoreTransportStatusChatLine,
  mergeHwModelOnContactUpdate,
  mergeMeshcoreChatStubNodes,
  MESHCORE_CHANNEL_NAME_MAX_LEN,
  MESHCORE_CONTACTS_WARNING_THRESHOLD,
  MESHCORE_COORD_SCALE,
  MESHCORE_MAX_CONTACTS,
  MESHCORE_RPC_SNR_RAW_TO_DB,
  meshcoreAppendRepeaterAuthHint,
  meshcoreConnectionImpliesUsbPower,
  meshcoreContactToMeshNode,
  meshcoreIsChatStubNodeId,
  meshcoreIsSyntheticPlaceholderPubKeyHex,
  meshcoreManufacturerModelFromDeviceQuery,
  meshcoreMergeChannelDisplayNameOntoNode,
  meshcoreMergeContactHopsAwayFromPrevious,
  meshcoreMilliVoltsToApproximateBatteryPercent,
  meshcoreMinimalNodeFromAdvertEvent,
  meshcoreScaledAdvLatLonToDeg,
  meshcoreSliceContactOutPathForTrace,
  meshcoreSyntheticPlaceholderPubKeyHex,
  meshcoreTelemetryGpsAltitudeMeters,
  meshcoreTracePathLenToHops,
  minimalMeshcoreChatNode,
  pubkeyToNodeId,
  resolveMeshcoreRoomLoginHopsAway,
} from '../lib/meshcoreUtils';
import {
  bindMeshcoreIngress,
  finalizeMeshcoreDriverIdentity,
  meshcoreTransportParams,
} from '../lib/meshIdentityBridge';
import { consumeMqttUserDisconnect } from '../lib/mqttDisconnectIntent';
import {
  effectiveMessageTimestampMs,
  lastHeardToUnixSeconds,
  mergeMeshcoreLastHeardFromAdvert,
} from '../lib/nodeStatus';
import { getOfflineIdentityIdForProtocol } from '../lib/offlineProtocolIdentities';
import { parseStoredJson } from '../lib/parseStoredJson';
import { reactionGlyphFromPicker } from '../lib/reactions';
import {
  type CliHistoryEntry,
  createRepeaterCommandService,
  type RepeaterCommandService,
} from '../lib/repeaterCommandService';
import { createRepeaterRemoteRpcQueue } from '../lib/repeaterRemoteRpcQueue';
import { LAST_SERIAL_PORT_KEY } from '../lib/serialPortSignature';
import { registerMeshcoreSession } from '../lib/sessions/meshcoreSession';
import { getStoredMeshProtocol } from '../lib/storedMeshProtocol';
import { messageRecordsToChatMessages, nodeRecordsToMeshNodeMap } from '../lib/storeRecordAdapters';
import { delayUnlessSuspended } from '../lib/systemPowerState';
import {
  MESHCORE_ROOM_LOGIN_ROUTE_RESOLVE_MAX_MS,
  MESHCORE_ROOM_LOGIN_TOTAL_TIMEOUT_MS,
  MESHCORE_ROOM_SYNC_MIN_MESH_TX_SPACING_MS,
  MESHCORE_ROOM_SYNC_ROUTE_RESOLVE_FAST_MS,
  MESHCORE_ROOM_SYNC_TICK_MS,
  MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
} from '../lib/timeConstants';
import type {
  ChatMessage,
  DeviceState,
  EnvironmentTelemetryPoint,
  IdentityId,
  MeshCoreLocalStats,
  MeshNode,
  MQTTStatus,
  TelemetryPoint,
} from '../lib/types';
import { mirrorMqttStatusToConnection, setConnection } from '../stores/connectionStore';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { updateMessageStatus, useMessageStore } from '../stores/messageStore';
import {
  patchMeshcoreNodeLastHeardAt,
  patchNodeFavorited,
  useNodeStore,
} from '../stores/nodeStore';
import { computePathHash, usePathHistoryStore } from '../stores/pathHistoryStore';
import { useRepeaterSignalStore } from '../stores/repeaterSignalStore';

export {
  MESHCORE_PING_NO_ROUTE_ERROR_DISPLAY_MS,
  MESHCORE_PING_NO_ROUTE_ERROR_MSG,
  meshcorePingNoRouteErrorExpiryUpdate,
  serializeErrorLike,
} from '../hooks/meshcore/meshcoreHookPreamble';
export type {
  CayenneLppEntry,
  MeshCoreContactRaw,
  MeshCoreNeighborEntry,
  MeshCoreNeighborResult,
  MeshCoreNodeTelemetry,
  MeshCoreRepeaterStatus,
  MeshCoreSelfInfo,
  RxPacketEntry,
} from '../lib/meshcore/meshcoreHookTypes';
export type { CliHistoryEntry } from '../lib/repeaterCommandService';

const MESHCORE_MAX_RECONNECT_ATTEMPTS = 5;

async function verifyMeshcoreRfLink(rfType: 'ble' | 'serial' | 'tcp'): Promise<boolean> {
  if (rfType !== 'ble') return true;
  if (typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('linux')) {
    return true;
  }
  try {
    return await window.electronAPI.isNobleBleConnected('meshcore');
  } catch {
    // catch-no-log-ok Noble IPC may fail during teardown; treat as dead link
    return false;
  }
}

export function useMeshcoreRuntime() {
  const [state, setState] = useState<DeviceState>(INITIAL_STATE);
  const [queueStatus, setQueueStatus] = useState<{
    free: number;
    maxlen: number;
    res: number;
  } | null>(null);
  const [nodes, setNodes] = useState<Map<number, MeshNode>>(new Map());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [channels, setChannels] = useState<{ index: number; name: string; secret: Uint8Array }[]>(
    [],
  );
  const [selfInfo, setSelfInfo] = useState<MeshCoreSelfInfo | null>(null);
  const [meshcoreContactsForTelemetry, setMeshcoreContactsForTelemetry] = useState<
    MeshCoreContactRaw[]
  >([]);
  const [meshcoreAutoadd, setMeshcoreAutoadd] = useState<MeshcoreAutoaddWireState | null>(null);
  const [ourPosition, setOurPosition] = useState<OurPosition | null>(null);
  const [deviceLogs, setDeviceLogs] = useState<DeviceLogEntry[]>([]);
  const [rawPackets, setRawPackets] = useState<RxPacketEntry[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const [signalTelemetry, setSignalTelemetry] = useState<TelemetryPoint[]>([]);
  const [meshcoreTraceResults, setMeshcoreTraceResults] = useState<
    Map<number, MeshcoreTraceResultEntry>
  >(new Map());
  const meshcoreTraceResultsRef = useRef<Map<number, MeshcoreTraceResultEntry>>(new Map());
  const [meshcoreNodeStatus, setMeshcoreNodeStatus] = useState<Map<number, MeshCoreRepeaterStatus>>(
    new Map(),
  );
  const [meshcoreNodeTelemetry, setMeshcoreNodeTelemetry] = useState<
    Map<number, MeshCoreNodeTelemetry>
  >(new Map());
  const [meshcoreTelemetryErrors, setMeshcoreTelemetryErrors] = useState<Map<number, string>>(
    new Map(),
  );
  const [meshcoreStatusErrors, setMeshcoreStatusErrors] = useState<Map<number, string>>(new Map());
  const [meshcorePingErrors, setMeshcorePingErrors] = useState<Map<number, string>>(new Map());
  const [meshcoreNeighbors, setMeshcoreNeighbors] = useState<Map<number, MeshCoreNeighborResult>>(
    new Map(),
  );
  const [meshcoreNeighborErrors, setMeshcoreNeighborErrors] = useState<Map<number, string>>(
    new Map(),
  );
  const [meshcoreCliHistories, setMeshcoreCliHistories] = useState<Map<number, CliHistoryEntry[]>>(
    new Map(),
  );
  const [meshcoreCliErrors, setMeshcoreCliErrors] = useState<Map<number, string>>(new Map());
  const [manualAddContacts, setManualAddContacts] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MANUAL_CONTACTS_KEY) === 'true';
    } catch {
      // catch-no-log-ok localStorage read error — return safe default
      return false;
    }
  });
  const [environmentTelemetry, setEnvironmentTelemetry] = useState<EnvironmentTelemetryPoint[]>([]);
  const [mqttStatus, setMqttStatus] = useState<MQTTStatus>('disconnected');
  const [mqttConnectionLoss, setMqttConnectionLoss] = useState(false);
  const [waitingMessagesCount, setWaitingMessagesCount] = useState(0);
  const mqttStatusRef = useRef<MQTTStatus>('disconnected');

  const connRef = useRef<MeshCoreConnection | null>(null);
  const meshcoreConnectTypeRef = useRef<'ble' | 'serial' | 'tcp'>('ble');
  const meshcoreIngressDetachRef = useRef<(() => void) | null>(null);
  const meshcoreIngestDetachRef = useRef<(() => void) | null>(null);
  const meshcoreIdentityIdRef = useRef<string | null>(null);
  /** Driver identity from connect until initConn binds the store identity. */
  const meshcorePendingDriverIdentityRef = useRef<string | null>(null);
  const meshcoreDriverConnectedRef = useRef(false);
  const [meshcoreIdentityId, setMeshcoreIdentityId] = useState<string | null>(null);
  const bleConnectInProgressRef = useRef(false);
  const meshcoreConnectionParamsRef = useRef<{
    rfType: 'ble' | 'serial' | 'tcp';
    httpAddress?: string;
    blePeripheralId?: string;
    serialPortId?: string | null;
  } | null>(null);
  const meshcoreReconnectAttemptRef = useRef(0);
  const meshcoreReconnectGenerationRef = useRef(0);
  const meshcoreIsReconnectingRef = useRef(false);
  const handleMeshcoreConnectionLostRef = useRef<() => void>(() => {});
  const attemptMeshcoreReconnectRef = useRef<() => Promise<void>>(async () => {});
  /** Incremented on `disconnect()` so in-flight `initConn` can abort instead of timing out. */
  const meshcoreSetupGenerationRef = useRef(0);
  // Map pubKeyPrefix (6-byte hex) → nodeId for DM routing
  const pubKeyPrefixMapRef = useRef<Map<string, number>>(new Map());
  // Full pubKey → nodeId for sending
  const pubKeyMapRef = useRef<Map<number, Uint8Array>>(new Map());
  // nodeId → outPath bytes (sliced to outPathLen) for tracePath calls
  const outPathMapRef = useRef<Map<number, Uint8Array>>(new Map());
  // nodeId → nickname (from JSON import or DB)
  const nicknameMapRef = useRef<Map<number, string>>(new Map());
  // Stable ref to current nodes so event listeners don't form stale closures
  const nodesRef = useRef<Map<number, MeshNode>>(new Map());
  /** Skip mount DB hydration commit when live ingest/import ran before async reload finishes. */
  const skipMountDbHydrationCommitRef = useRef(false);
  /** SQLite hydration snapshot set synchronously before `setNodes` so initConn can merge hops when `nodesRef` has not flushed yet. */
  const meshcoreLastPersistedNodesRef = useRef<Map<number, MeshNode>>(new Map());
  /** Mount DB load — initConn awaits this so an immediate connect does not skip persisted hop counts. */
  /** Same baseline as initConn: avoid empty `nodesRef` during contact rebuilds (debounced 129 / refresh). */
  const meshcorePreviousNodesBaselineForBuild = useCallback(
    () => (nodesRef.current.size > 0 ? nodesRef.current : meshcoreLastPersistedNodesRef.current),
    [],
  );
  const messagesRef = useRef<ChatMessage[]>([]);
  const mqttPlaceholderSavedRef = useRef<Set<number>>(new Set());
  const rawPacketsRef = useRef<RxPacketEntry[]>([]);
  // Stable ref to own node ID so event listeners don't form stale closures
  const myNodeNumRef = useRef<number>(0);
  // Pending ACK tracking: CRC key (raw and/or u32) → shared entry for one in-flight DM
  const pendingAcksRef = useRef<Map<number, PendingDmAckEntry>>(new Map());
  const selfInfoRef = useRef<MeshCoreSelfInfo | null>(null);
  /** Post-connect GPS refresh; assigned to {@link refreshOurPositionNoop} below (initConn runs earlier in the hook). */
  const refreshOurPositionMeshCoreRef = useRef<() => Promise<OurPosition | null>>(() =>
    Promise.resolve(null),
  );
  /** Post-connect self telemetry (altitude); assigned to {@link requestTelemetry} below. */
  const requestTelemetryMeshCoreRef = useRef<(nodeId: number) => Promise<void>>(async () => {});
  /** Throttle LetsMesh packet-logger publishes (event 136 can be very frequent). */
  const lastPacketLogAtRef = useRef(0);
  /** Rate-limit debug logs when optional packet-logger IPC publish fails. */
  const lastPacketLogPublishFailureLogAtRef = useRef(0);
  const meshcoreHookMountedRef = useRef(true);
  const repeaterCommandServiceRef = useRef<RepeaterCommandService | null>(null);
  const repeaterRemoteRpcRef = useRef(createRepeaterRemoteRpcQueue());
  const lastMeshcoreRoomSyncTxAtRef = useRef(0);
  const roomSyncSchedulerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roomSyncSchedulerInFlightRef = useRef(false);
  /** NodeIds that already logged a scheduler no-route warn this session (subsequent → debug). */
  const roomSyncSchedulerWarnedNodesRef = useRef(new Set<number>());
  const meshcoreRoomReconnectSyncRef = useRef<() => void>(() => {});
  const triggerRoomAutoLoginRef = useRef<() => void>(() => {});
  /** Debounced contacts refresh after path updates (event 129). */
  const meshcoreContactsRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** NodeIds that fired event 129 since last debounced contacts refresh (for path history recording). */
  const meshcorePathUpdatePendingRef = useRef<Set<number>>(new Set());
  /** Session-scoped: nodeIds that received PathUpdated (129) this connection (Ping/trace gating). */
  const meshcoreSessionPathUpdatedNodeIdsRef = useRef<Set<number>>(new Set());
  /** Bumps when {@link meshcoreSessionPathUpdatedNodeIdsRef} gains a node so UI re-evaluates Ping enablement. */
  const [meshcorePingRouteReadyEpoch, setMeshcorePingRouteReadyEpoch] = useState(0);
  /** Periodic poll for waiting messages when event 131 may have been missed. */
  const meshcoreWaitingMessagesPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Stable ref to the current connection's processWaitingMessages fn (set by setupEventListeners). */
  const processWaitingMessagesRef = useRef<(() => Promise<void>) | null>(null);
  /** Previous txAirSecs value for calculating channel utilization delta. */
  const prevTxAirSecsRef = useRef<number | null>(null);
  /** Previous timestamp for calculating channel utilization delta. */
  const prevStatsTimestampRef = useRef<number | null>(null);
  /** Periodic poll for local radio stats (see MESHCORE_STATS_POLL_MS in stats effect). */
  const meshcoreStatsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Auto-expire {@link MESHCORE_PING_NO_ROUTE_ERROR_MSG} after {@link MESHCORE_PING_NO_ROUTE_ERROR_DISPLAY_MS}. */
  const meshcorePingNoRouteExpiryTimersRef = useRef<Map<number, number>>(new Map());

  const clearMeshcorePingNoRouteExpiryTimer = useCallback((nodeId: number) => {
    const t = meshcorePingNoRouteExpiryTimersRef.current.get(nodeId);
    if (t != null) {
      clearTimeout(t);
      meshcorePingNoRouteExpiryTimersRef.current.delete(nodeId);
    }
  }, []);

  /** Fetch and update local radio stats (core, radio, packet). Called by requestRefresh and on connect. */
  const fetchAndUpdateLocalStats = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) return;
    let coreStats: Awaited<ReturnType<MeshCoreConnection['getStatsCore']>>;
    try {
      coreStats = await conn.getStatsCore();
    } catch {
      // catch-no-log-ok getStatsCore optional on some transports
      return;
    }

    const core = coreStats.data;
    // STATS CORE queue_len = PacketManager outbound total (MeshCore stats_binary_frames.md).
    // Do not merge conn.getStatus(self): companion CMD_SEND_STATUS_REQ resolves the pubkey via
    // lookupContactByPubKey; self is often not a contact row, so the request fails with NOT_FOUND.
    const queueLenCapped = Math.min(
      queueLenFromMeshCoreCoreStatsRaw(coreStats.raw, core.queueLen),
      256,
    );
    if (queueLenCapped >= 250) {
      const raw = coreStats.raw;
      const rawHex =
        raw != null && raw.length > 0
          ? Array.from(raw)
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('')
          : 'none';
      console.debug(
        `[useMeshcoreRuntime] high queue depth=${queueLenCapped} meshcoreJsParsed=${core.queueLen} rawLen=${raw?.length ?? 0} rawHex=${rawHex}`,
      );
    }
    setQueueStatus({ free: 256 - queueLenCapped, maxlen: 256, res: 0 });
    const now = Date.now();
    setSelfInfo((prev) => (prev ? { ...prev, batteryMilliVolts: core.batteryMilliVolts } : prev));

    if (core.batteryMilliVolts > 0) {
      const batteryLevel = meshcoreMilliVoltsToApproximateBatteryPercent(core.batteryMilliVolts);
      const voltage = core.batteryMilliVolts / 1000;
      setTelemetry((prev) =>
        [...prev, { timestamp: now, voltage, batteryLevel }].slice(-MAX_TELEMETRY_POINTS),
      );
    }

    let radioStats: Awaited<ReturnType<MeshCoreConnection['getStatsRadio']>>;
    let packetStats: Awaited<ReturnType<MeshCoreConnection['getStatsPackets']>>;
    try {
      [radioStats, packetStats] = await Promise.all([conn.getStatsRadio(), conn.getStatsPackets()]);
    } catch {
      // catch-no-log-ok getStatsRadio/getStatsPackets optional
      return;
    }

    const radio = radioStats.data;
    const packet = packetStats.data;

    let channelUtilization: number | undefined;
    let airUtilTx: number | undefined;

    if (prevTxAirSecsRef.current !== null && prevStatsTimestampRef.current !== null) {
      const deltaTxAirSecs = radio.txAirSecs - prevTxAirSecsRef.current;
      const deltaTimeSecs = (now - prevStatsTimestampRef.current) / 1000;
      if (deltaTimeSecs > 0 && deltaTxAirSecs >= 0) {
        airUtilTx = (deltaTxAirSecs / deltaTimeSecs) * 100;
        channelUtilization = airUtilTx;
      }
    }

    prevTxAirSecsRef.current = radio.txAirSecs;
    prevStatsTimestampRef.current = now;

    const localStats: MeshCoreLocalStats = {
      batteryMilliVolts: core.batteryMilliVolts,
      uptimeSecs: core.uptimeSecs,
      queueLen: queueLenCapped,
      noiseFloor: radio.noiseFloor,
      lastRssi: radio.lastRssi,
      lastSnr: radio.lastSnr,
      txAirSecs: radio.txAirSecs,
      rxAirSecs: radio.rxAirSecs,
      recv: packet.recv,
      sent: packet.sent,
      nSentFlood: packet.nSentFlood,
      nSentDirect: packet.nSentDirect,
      nRecvFlood: packet.nRecvFlood,
      nRecvDirect: packet.nRecvDirect,
      nRecvErrors: packet.nRecvErrors ?? undefined,
      channelUtilization,
      airUtilTx,
    };

    const myNodeId = myNodeNumRef.current || state.myNodeNum;
    if (myNodeId > 0) {
      setNodes((prev) => {
        const updated = new Map(prev);
        const node = prev.get(myNodeId);
        const fallbackName =
          selfInfoRef.current?.name?.trim() || `Node-${myNodeId.toString(16).toUpperCase()}`;
        updated.set(myNodeId, {
          ...(node ?? {
            node_id: myNodeId,
            long_name: fallbackName,
            short_name: '',
            hw_model: 'Unknown',
            battery: meshcoreMilliVoltsToApproximateBatteryPercent(core.batteryMilliVolts) ?? 0,
            snr: radio.lastSnr,
            rssi: radio.lastRssi,
            last_heard: Math.floor(now / 1000),
            latitude: null,
            longitude: null,
            hops_away: 0,
          }),
          voltage: core.batteryMilliVolts / 1000,
          channel_utilization: channelUtilization ?? node?.channel_utilization,
          air_util_tx: airUtilTx ?? node?.air_util_tx,
          meshcore_local_stats: localStats,
        });
        return updated;
      });
    }
  }, [state.myNodeNum]);

  const buildNodesFromContactsRef = useRef<
    | ((
        contacts: MeshCoreContactRaw[],
        opts?: {
          self?: MeshCoreSelfInfo | null;
          myNodeId?: number;
          previousNodes?: Map<number, MeshNode>;
        },
      ) => Promise<Map<number, MeshNode>>)
    | null
  >(null);

  const addCliHistoryEntry = useCallback((nodeId: number, entry: CliHistoryEntry) => {
    setMeshcoreCliHistories((prev) => {
      const next = new Map(prev);
      const existing = next.get(nodeId) ?? [];
      const updated = [...existing, entry];
      if (updated.length > 100) {
        next.set(nodeId, updated.slice(-100));
      } else {
        next.set(nodeId, updated);
      }
      return next;
    });
  }, []);

  const clearCliHistory = useCallback((nodeId: number) => {
    setMeshcoreCliHistories((prev) => {
      const next = new Map(prev);
      next.delete(nodeId);
      return next;
    });
  }, []);

  useEffect(() => {
    meshcoreHookMountedRef.current = true;
    const pingNoRouteTimers = meshcorePingNoRouteExpiryTimersRef.current;
    return () => {
      meshcoreHookMountedRef.current = false;
      if (meshcoreWaitingMessagesPollRef.current) {
        clearInterval(meshcoreWaitingMessagesPollRef.current);
        meshcoreWaitingMessagesPollRef.current = null;
      }
      if (meshcoreStatsPollRef.current) {
        clearInterval(meshcoreStatsPollRef.current);
        meshcoreStatsPollRef.current = null;
      }
      pingNoRouteTimers.forEach((timerId) => {
        clearTimeout(timerId);
      });
      pingNoRouteTimers.clear();
    };
  }, []);

  useEffect(() => {
    selfInfoRef.current = selfInfo;
  }, [selfInfo]);

  useEffect(() => {
    nodesRef.current = nodes;
    setMeshcoreDiagnosticsNodes(nodes, myNodeNumRef.current);
  }, [nodes, state.myNodeNum]);

  // Push runtime node map into identity-scoped Zustand after commit (mirrors Meshtastic #375 path).
  useEffect(() => {
    const storeId =
      meshcoreIdentityIdRef.current ?? meshcorePendingDriverIdentityRef.current ?? null;
    if (!storeId) return;
    syncMeshcoreNodesMapToIdentityStore(storeId, nodes);
  }, [nodes, meshcoreIdentityId]);

  useEffect(() => {
    meshcoreTraceResultsRef.current = meshcoreTraceResults;
  }, [meshcoreTraceResults]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    rawPacketsRef.current = rawPackets;
  }, [rawPackets]);

  useEffect(() => {
    myNodeNumRef.current = state.myNodeNum;
  }, [state.myNodeNum]);

  // Start stats polling when connected
  useEffect(() => {
    if (state.status === 'configured') {
      const MESHCORE_STATS_POLL_MS = 30 * 1_000;
      if (meshcoreStatsPollRef.current) clearInterval(meshcoreStatsPollRef.current);
      meshcoreStatsPollRef.current = setInterval(() => {
        if (!meshcoreHookMountedRef.current) return;
        void fetchAndUpdateLocalStats().catch((e: unknown) => {
          console.warn('[useMeshcoreRuntime] periodic stats poll failed ' + errLikeToLogString(e));
        });
      }, MESHCORE_STATS_POLL_MS);

      // Initial stats fetch on connect
      void fetchAndUpdateLocalStats().catch((e: unknown) => {
        console.warn('[useMeshcoreRuntime] initial stats fetch failed ' + errLikeToLogString(e));
      });
    }
    return () => {
      if (meshcoreStatsPollRef.current) {
        clearInterval(meshcoreStatsPollRef.current);
        meshcoreStatsPollRef.current = null;
      }
    };
  }, [state.status, state.myNodeNum, fetchAndUpdateLocalStats]);

  useEffect(() => {
    if (state.status !== 'configured') return;
    void window.electronAPI.appSettings
      .getAll()
      .then((all) => {
        const partial: Record<string, string> = {};
        for (const [key, value] of Object.entries(all)) {
          if (typeof value !== 'string' || value.trim() === '') continue;
          if (
            key.startsWith(MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX) ||
            key.startsWith(MESHCORE_ROOM_SYNC_SETTING_PREFIX)
          ) {
            partial[key] = value;
          }
        }
        if (Object.keys(partial).length === 0) return;
        mergeAppSettingsPartial(partial, 'useMeshcoreRuntime hydrate room settings');
        triggerRoomAutoLoginRef.current();
      })
      .catch((e: unknown) => {
        console.warn('[useMeshcoreRuntime] hydrate room settings failed ' + errLikeToLogString(e));
      });
  }, [state.status]);

  useEffect(() => {
    mqttStatusRef.current = mqttStatus;
  }, [mqttStatus]);

  useEffect(() => {
    return window.electronAPI.mqtt.onStatus(({ status: s, protocol }) => {
      if (protocol !== 'meshcore') return;
      const prev = mqttStatusRef.current;
      const st = s;
      mqttStatusRef.current = st;
      setMqttStatus(st);
      mirrorMqttStatusToConnection(meshcoreIdentityIdRef.current, st);
      if (st === 'connected') {
        setMqttConnectionLoss(false);
      } else if (consumeMqttUserDisconnect()) {
        setMqttConnectionLoss(false);
      } else if (prev === 'connected') {
        setMqttConnectionLoss(true);
      }
    });
  }, []);

  /** Reload MeshCore contacts + hop counts from SQLite (mount, and after disconnect). */
  const reloadMeshcoreNodesFromDb = useCallback(
    async (opts?: { hydrateMessages?: boolean; beforeCommit?: () => boolean }) => {
      const [rows, dbMsgs, savedNodes] = await Promise.all([
        window.electronAPI.db.getMeshcoreContacts(),
        loadMeshcoreMessagesForHydration(),
        loadMeshcoreSavedHopRowsForHydration(),
      ]);
      if (opts?.beforeCommit && !opts.beforeCommit()) return;

      const dbContacts = rows as MeshcoreContactDbRow[];
      const meshcoreRows = dbMsgs;
      const mappedPreview = mapMeshcoreDbRowsToChatMessages(meshcoreRows);
      const initial = buildMeshcoreNodeMapFromDb(dbContacts, savedNodes, mappedPreview);
      for (const row of dbContacts) {
        if (row.nickname) nicknameMapRef.current.set(row.node_id, row.nickname);
        const hex = row.public_key.replace(/\s/g, '');
        if (!meshcoreIsSyntheticPlaceholderPubKeyHex(hex) && hex.length >= 12) {
          const pairs = hex.match(/.{2}/g);
          if (!pairs) continue;
          const bytes = new Uint8Array(pairs.map((b) => parseInt(b, 16)));
          pubKeyMapRef.current.set(row.node_id, bytes);
          const prefix = hex.slice(0, 12);
          pubKeyPrefixMapRef.current.set(prefix, row.node_id);
        }
      }
      const mapped = repairMeshcoreHydratedMessages(
        mappedPreview,
        meshcoreRoomServerIdsFromNodes(initial.values()),
        myNodeNumRef.current,
      );
      void persistMeshcoreMessageSenderRepairs(meshcoreRows, mapped);
      const mergedInitial = mergeStubNodesFromMeshcoreMessages(initial, mapped);
      if (opts?.beforeCommit && !opts.beforeCommit()) return;

      meshcoreLastPersistedNodesRef.current = new Map(mergedInitial);

      setNodes(mergedInitial);
      const storeId =
        meshcoreIdentityIdRef.current ??
        meshcorePendingDriverIdentityRef.current ??
        getOfflineIdentityIdForProtocol('meshcore');
      if (storeId) {
        syncMeshcoreNodesMapToIdentityStore(storeId, mergedInitial);
      }
      if (opts?.hydrateMessages && mapped.length > 0) {
        setMessages((prev) => mergeMeshcoreDbHydrationWithLive(prev, mapped));
      }
    },
    [],
  );

  useEffect(() => {
    queueMicrotask(() => {
      void reloadMeshcoreNodesFromDb({
        hydrateMessages: true,
        beforeCommit: () => !skipMountDbHydrationCommitRef.current && nodesRef.current.size === 0,
      }).catch((e: unknown) => {
        console.warn('[useMeshcoreRuntime] initial db reload failed ' + errLikeToLogString(e));
      });
    });
  }, [reloadMeshcoreNodesFromDb]);

  // Mirror self radio battery into the home MeshNode (node list + node detail); refreshContacts rebuilds from selfInfo
  useEffect(() => {
    const myId = state.myNodeNum;
    const mV = selfInfo?.batteryMilliVolts;
    if (myId <= 0 || mV == null || !Number.isFinite(mV)) return;
    const voltage = mV / 1000;
    const battery = meshcoreMilliVoltsToApproximateBatteryPercent(mV) ?? 0;
    queueMicrotask(() => {
      setNodes((prev) => {
        const existing = prev.get(myId);
        if (!existing) return prev;
        if (existing.voltage === voltage && existing.battery === battery) return prev;
        const next = new Map(prev);
        next.set(myId, { ...existing, voltage, battery });
        return next;
      });
    });
  }, [state.myNodeNum, selfInfo?.batteryMilliVolts]);

  // Connection panel: meshcore.js exposes only millivolts—no charging bit (unlike Meshtastic batteryLevel > 100).
  // We set batteryCharging from transport: USB serial usually means VBUS. BLE/TCP cannot detect wall charging.
  useEffect(() => {
    const mV = selfInfo?.batteryMilliVolts;
    if (mV == null || !Number.isFinite(mV)) {
      queueMicrotask(() => {
        setState((prev) => {
          if (prev.batteryPercent === undefined && prev.batteryCharging === undefined) return prev;
          return { ...prev, batteryPercent: undefined, batteryCharging: undefined };
        });
      });
      return;
    }
    const pct = meshcoreMilliVoltsToApproximateBatteryPercent(mV);
    const charging = meshcoreConnectionImpliesUsbPower(state.connectionType);
    queueMicrotask(() => {
      setState((prev) => {
        if (prev.batteryPercent === pct && prev.batteryCharging === charging) return prev;
        return { ...prev, batteryPercent: pct, batteryCharging: charging };
      });
    });
  }, [selfInfo?.batteryMilliVolts, state.connectionType]);

  const addMessage = useCallback((msg: ChatMessage): string | undefined => {
    const storeId = meshcoreIdentityIdRef.current;
    let result: {
      inserted: boolean;
      storeUpdated: boolean;
      message: ChatMessage;
      canonicalId: string;
    };
    if (storeId) {
      result = upsertMeshcoreMessageWithDedup(storeId, msg);
    } else {
      let inserted = false;
      flushSync(() => {
        setMessages((prev) => {
          const incomingKey = meshcoreMessageDedupeKey(msg);
          if (prev.some((m) => meshcoreMessageDedupeKey(m) === incomingKey)) {
            return prev;
          }
          const crossTransportDup = findMeshcoreCrossTransportDuplicate(prev, msg);
          if (crossTransportDup) {
            const { messages: next, matched } = mapMeshcoreCrossTransportUpgrade(prev, msg);
            if (matched) return next;
            return prev;
          }
          inserted = true;
          return trimChatMessagesToMax([...prev, msg], MAX_IN_MEMORY_CHAT_MESSAGES);
        });
      });
      result = {
        inserted,
        storeUpdated: inserted,
        message: msg,
        canonicalId: meshcoreMessageStoreId(msg),
      };
    }

    const incomingKey = meshcoreMessageDedupeKey(result.message);
    if (storeId) {
      flushSync(() => {
        setMessages((prev) => {
          const exactDup = prev.some((m) => meshcoreMessageDedupeKey(m) === incomingKey);
          if (exactDup) {
            if (!result.inserted) {
              return prev.map((m) =>
                meshcoreMessageDedupeKey(m) === incomingKey
                  ? { ...m, receivedVia: result.message.receivedVia }
                  : m,
              );
            }
            return prev;
          }
          if (!result.inserted) {
            const crossDup = findMeshcoreCrossTransportDuplicate(prev, msg);
            if (crossDup) {
              const { messages: next, matched } = mapMeshcoreCrossTransportUpgrade(prev, msg);
              if (matched) return next;
            }
            return prev;
          }
          return trimChatMessagesToMax([...prev, result.message], MAX_IN_MEMORY_CHAT_MESSAGES);
        });
      });
    }

    if (result.inserted || result.storeUpdated) {
      const skipSendingRoomPersist =
        result.message.status === 'sending' && isMeshcoreRoomChatMessage(result.message);
      if (!skipSendingRoomPersist) {
        void window.electronAPI.db
          .saveMeshcoreMessage(messageToDbRow(result.message))
          .catch((e: unknown) => {
            console.warn('[useMeshcoreRuntime] saveMeshcoreMessage error ' + errLikeToLogString(e));
          });
      }
    }
    return storeId ? result.canonicalId : undefined;
  }, []);

  useEffect(() => {
    return window.electronAPI.mqtt.onMeshcoreChat((raw: unknown) => {
      const m = raw as {
        text?: string;
        channelIdx?: number;
        senderName?: string;
        senderNodeId?: number;
        timestamp?: number;
      };
      if (typeof m.text !== 'string' || m.channelIdx == null) return;
      if (isMeshcoreTransportStatusChatLine(m.text)) {
        return;
      }
      const ts = effectiveMessageTimestampMs(m.timestamp ?? Date.now());
      const tsSec = Math.floor(ts / 1000);
      const fromNodeId =
        m.senderNodeId != null && Number.isFinite(m.senderNodeId) ? m.senderNodeId >>> 0 : 0;
      const resolved = resolveMeshcoreChannelMessageSender({
        rawText: m.text,
        fromNodeId,
        recordSenderName: m.senderName,
        nodes: nodesRef.current,
      });
      const resolvedId = resolved.senderId;
      const displayName = resolved.displayName;
      const storeId = meshcoreIdentityIdRef.current;
      if (resolvedId !== 0) {
        if (storeId) {
          ensureMeshcoreChatSenderInNodeStore(storeId, resolvedId, {
            lastHeardAtMs: ts,
            displayName: m.senderName ?? displayName,
            source: 'mqtt',
            heardViaMqtt: true,
          });
        }
        setNodes((prev) => {
          const next = new Map(prev);
          const existing = next.get(resolvedId);
          const merged: MeshNode = existing
            ? meshcoreMergeChannelDisplayNameOntoNode(
                {
                  ...existing,
                  short_name: '',
                  last_heard: Math.max(existing.last_heard ?? 0, tsSec),
                  heard_via_mqtt: true,
                },
                m.senderName ?? displayName,
              )
            : minimalMeshcoreChatNode(resolvedId, displayName, tsSec, 'mqtt');
          next.set(resolvedId, merged);
          return next;
        });
      }
      if (
        !meshcoreIsChatStubNodeId(resolvedId) &&
        !pubKeyMapRef.current.has(resolvedId) &&
        !mqttPlaceholderSavedRef.current.has(resolvedId)
      ) {
        mqttPlaceholderSavedRef.current.add(resolvedId);
        void window.electronAPI.db
          .saveMeshcoreContact({
            node_id: resolvedId,
            public_key: meshcoreSyntheticPlaceholderPubKeyHex(resolvedId),
            adv_name: m.senderName ?? displayName,
            contact_type: 1,
            last_advert: tsSec,
            nickname: null,
            on_radio: 0,
          })
          .catch((e: unknown) => {
            console.warn(
              '[useMeshcoreRuntime] saveMeshcoreContact (mqtt chat) error ' + errLikeToLogString(e),
            );
          });
      }
      const normProbe = normalizeMeshcoreIncomingText(m.text);
      const rawForBuild = normProbe.senderName ? m.text : `${displayName}: ${m.text}`;
      const prior = storeId ? meshcoreSortedStorePrior(storeId) : messagesRef.current;
      addMessage(
        parseMeshcoreChannelIncomingFromThread(prior, {
          rawText: rawForBuild,
          senderId: resolvedId,
          displayName,
          channel: m.channelIdx,
          timestamp: ts,
          receivedVia: 'mqtt',
        }),
      );
    });
  }, [addMessage]);

  const buildNodesFromContacts = useCallback(
    async (
      contacts: MeshCoreContactRaw[],
      opts?: {
        self?: MeshCoreSelfInfo | null;
        myNodeId?: number;
        /** Prior UI node map so `last_heard` from live events is preserved when device sends `lastAdvert: 0`. */
        previousNodes?: Map<number, MeshNode>;
        /** If true, save contacts with on_radio=1. */
        contactsFromRadio?: boolean;
        /** Skip SQLite merge (show radio contacts immediately; merge in background). */
        deferDbMerge?: boolean;
        /** Skip path-history writes during large radio contact sync. */
        deferPathHistory?: boolean;
      },
    ): Promise<Map<number, MeshNode>> => {
      const prevSnap = opts?.previousNodes ?? new Map<number, MeshNode>();
      const nextNodes = new Map<number, MeshNode>();
      pubKeyMapRef.current.clear();
      pubKeyPrefixMapRef.current.clear();
      outPathMapRef.current.clear();
      // Persisted hop counts from `nodes` are the source of truth across app restarts and
      // contact-table cleanups. Pre-fetch so each contact merge can fall back when the radio
      // reports no outPath and prevSnap has no entry yet.
      const savedHopsByNodeId = new Map<number, number>();
      try {
        const savedRows = (await window.electronAPI.db.getNodes()) as {
          node_id: number;
          hops?: number | null;
          hops_away?: number | null;
        }[];
        for (const r of savedRows) {
          const h = r.hops ?? r.hops_away;
          if (h != null && Number.isFinite(h)) savedHopsByNodeId.set(r.node_id, h);
        }
      } catch (e) {
        console.warn(
          '[useMeshcoreRuntime] buildNodesFromContacts: getNodes for hops fallback ' +
            errLikeToLogString(e),
        );
      }
      const pendingDbRows: ReturnType<typeof contactToDbRow>[] = [];
      for (const contact of contacts) {
        const base = meshcoreContactToMeshNode(contact);
        const last_heard = mergeMeshcoreLastHeardFromAdvert(
          contact.lastAdvert,
          prevSnap.get(base.node_id)?.last_heard,
        );
        const prevNode = prevSnap.get(base.node_id);
        const slicedPath = meshcoreSliceContactOutPathForTrace(contact.outPath, contact.outPathLen);
        const effectivePrevHops = prevNode?.hops_away ?? savedHopsByNodeId.get(base.node_id);
        const hopsAway = meshcoreMergeContactHopsAwayFromPrevious(
          base.hops_away,
          effectivePrevHops,
          slicedPath.length,
        );
        const node: MeshNode = { ...base, last_heard, hops_away: hopsAway };
        if (prevNode?.channel_utilization != null) {
          node.channel_utilization = prevNode.channel_utilization;
        }
        if (prevNode?.air_util_tx != null) {
          node.air_util_tx = prevNode.air_util_tx;
        }
        if (prevNode?.meshcore_local_stats != null) {
          node.meshcore_local_stats = prevNode.meshcore_local_stats;
        }
        const mergedHwModel = mergeHwModelOnContactUpdate(prevNode?.hw_model, node.hw_model);
        if (mergedHwModel !== node.hw_model) {
          node.hw_model = mergedHwModel;
        }
        nextNodes.set(node.node_id, node);
        pubKeyMapRef.current.set(node.node_id, contact.publicKey);
        outPathMapRef.current.set(node.node_id, slicedPath);
        const contactPathBytes = slicedPath.length > 0 ? Array.from(slicedPath) : [];
        if (!opts?.deferPathHistory && contactPathBytes.length > 0) {
          const pathHash = computePathHash(contactPathBytes);
          const existing = usePathHistoryStore.getState().records.get(node.node_id) ?? [];
          if (!existing.some((r) => r.pathHash === pathHash)) {
            const hops = node.hops_away ?? Math.max(0, contactPathBytes.length - 1);
            usePathHistoryStore
              .getState()
              .recordPathUpdated(node.node_id, contactPathBytes, hops, false);
          }
        }
        const prefix = Array.from(contact.publicKey.slice(0, 6))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        pubKeyPrefixMapRef.current.set(prefix, node.node_id);
        // Save with on_radio=1 when contacts came from radio
        const now = new Date().toISOString();
        const onRadio = opts?.contactsFromRadio ? 1 : 0;
        const prevHopsAway = prevNode?.hops_away;
        const hopsToSave = hopsAway ?? prevHopsAway ?? undefined;
        const dbRow = contactToDbRow(contact, undefined, onRadio, now, hopsToSave);
        pendingDbRows.push(dbRow);
      }
      replaceMeshcorePubKeyRegistry(
        contacts
          .map((contact): [number, Uint8Array] => [
            pubkeyToNodeId(contact.publicKey),
            contact.publicKey,
          ])
          .filter(([id]) => id !== 0),
      );
      copyMeshcorePubKeyRegistryToRefs(pubKeyMapRef.current, pubKeyPrefixMapRef.current);
      if (pendingDbRows.length > 0) {
        void window.electronAPI.db.saveMeshcoreContactsBatch(pendingDbRows).catch((e: unknown) => {
          console.warn(
            '[useMeshcoreRuntime] saveMeshcoreContactsBatch error ' + errLikeToLogString(e),
          );
        });
      }
      if (!opts?.deferDbMerge) {
        try {
          await mergeMeshcoreContactsFromDbIntoNodeMap(nextNodes, prevSnap, {
            pubKeyByNodeId: pubKeyMapRef.current,
            pubKeyPrefixByHex: pubKeyPrefixMapRef.current,
            nicknameByNodeId: nicknameMapRef.current,
          });
        } catch (e) {
          console.warn('[useMeshcoreRuntime] loadContactsFromDb error ' + errLikeToLogString(e));
        }
      }

      for (const [nodeId, node] of nextNodes) {
        const nick = nicknameMapRef.current.get(nodeId);
        if (nick) nextNodes.set(nodeId, { ...node, long_name: nick, short_name: '' });
      }

      const myNodeId = opts?.myNodeId ?? 0;
      const self = opts?.self;
      if (myNodeId > 0 && self) {
        const selfNode = nextNodes.get(myNodeId);
        const hexFallback = `Node-${myNodeId.toString(16).toUpperCase()}`;
        const selfNameTrimmed = typeof self.name === 'string' ? self.name.trim() : '';
        const displayLongName = selfNameTrimmed || selfNode?.long_name || hexFallback;
        const displayShortName = '';
        const selfMv = self.batteryMilliVolts;
        const fromSelfBattery =
          selfMv != null && Number.isFinite(selfMv)
            ? {
                voltage: selfMv / 1000,
                battery: meshcoreMilliVoltsToApproximateBatteryPercent(selfMv),
              }
            : null;
        const fromSelfAdv = meshcoreScaledAdvLatLonToDeg(self.advLat ?? 0, self.advLon ?? 0);
        const storedStatic = hasStoredStaticGps() ? readStoredStaticGps() : null;
        if (selfNode) {
          nextNodes.set(myNodeId, {
            ...selfNode,
            long_name: displayLongName,
            short_name: displayShortName,
            hops_away: 0,
            latitude: storedStatic?.lat ?? fromSelfAdv.lat ?? selfNode.latitude ?? null,
            longitude: storedStatic?.lon ?? fromSelfAdv.lon ?? selfNode.longitude ?? null,
            ...(fromSelfBattery ?? {}),
          });
        } else {
          nextNodes.set(myNodeId, {
            node_id: myNodeId,
            long_name: displayLongName,
            short_name: displayShortName,
            hw_model: CONTACT_TYPE_LABELS[self.type] ?? 'Unknown',
            battery: fromSelfBattery?.battery ?? 0,
            snr: 0,
            rssi: 0,
            last_heard: Math.floor(Date.now() / 1000),
            latitude: storedStatic?.lat ?? fromSelfAdv.lat,
            longitude: storedStatic?.lon ?? fromSelfAdv.lon,
            hops_away: 0,
            ...(fromSelfBattery?.voltage != null ? { voltage: fromSelfBattery.voltage } : {}),
          });
        }
      }

      for (const [nodeId, tr] of meshcoreTraceResultsRef.current) {
        if (myNodeId > 0 && nodeId === myNodeId) continue;
        const existing = nextNodes.get(nodeId);
        if (existing) {
          const traceHops = meshcoreTracePathLenToHops(tr.pathLen);
          nextNodes.set(nodeId, {
            ...existing,
            hops_away: traceHops,
          });
        }
      }

      // Final fallback: nodes still missing hops_away after radio/contact/trace merges fall back
      // to persisted `nodes` rows. Critical when `meshcore_contacts` is sparse (off-radio cleanup).
      for (const [nodeId, node] of nextNodes) {
        if (node.hops_away !== undefined) continue;
        const savedHops = savedHopsByNodeId.get(nodeId);
        if (savedHops != null) {
          nextNodes.set(nodeId, { ...node, hops_away: savedHops });
        }
      }

      return nextNodes;
    },
    [],
  );

  useEffect(() => {
    buildNodesFromContactsRef.current = buildNodesFromContacts;
  }, [buildNodesFromContacts]);

  const resolveMeshcoreStoreIdentityId = useCallback((): string | null => {
    return (
      meshcoreIdentityIdRef.current ??
      meshcorePendingDriverIdentityRef.current ??
      getOfflineIdentityIdForProtocol('meshcore')
    );
  }, []);

  const applyMeshcoreNodesToUi = useCallback(
    (nodeMap: Map<number, MeshNode>) => {
      const mergedForStore = mergeMeshcoreChatStubNodes(nodesRef.current, nodeMap);
      // Keep ref in sync before connect-time side effects (room auto-login filters on hw_model).
      nodesRef.current = mergedForStore;
      setNodes(mergedForStore);
      const storeId = resolveMeshcoreStoreIdentityId();
      if (storeId) syncMeshcoreNodesMapToIdentityStore(storeId, mergedForStore);
    },
    [resolveMeshcoreStoreIdentityId],
  );

  const deferMeshcoreDbContactMerge = useCallback(
    async (nodeMap: Map<number, MeshNode>, prevSnap: Map<number, MeshNode>) => {
      try {
        await mergeMeshcoreContactsFromDbIntoNodeMap(nodeMap, prevSnap, {
          pubKeyByNodeId: pubKeyMapRef.current,
          pubKeyPrefixByHex: pubKeyPrefixMapRef.current,
          nicknameByNodeId: nicknameMapRef.current,
        });
        for (const [nodeId, node] of nodeMap) {
          const nick = nicknameMapRef.current.get(nodeId);
          if (nick) nodeMap.set(nodeId, { ...node, long_name: nick, short_name: '' });
        }
        applyMeshcoreNodesToUi(nodeMap);
      } catch (e) {
        console.warn(
          '[useMeshcoreRuntime] deferred db contact merge failed ' + errLikeToLogString(e),
        );
      }
    },
    [applyMeshcoreNodesToUi],
  );

  const handleMeshcorePathUpdatedFromIngest = useCallback(
    (nodeId: number, publicKey: Uint8Array, isNewContact: boolean) => {
      registerMeshcorePubKey(nodeId, publicKey);
      copyMeshcorePubKeyRegistryToRefs(pubKeyMapRef.current, pubKeyPrefixMapRef.current);
      if (!meshcoreSessionPathUpdatedNodeIdsRef.current.has(nodeId)) {
        meshcoreSessionPathUpdatedNodeIdsRef.current.add(nodeId);
        setMeshcorePingRouteReadyEpoch((e) => e + 1);
      }
      const nowSec = Math.floor(Date.now() / 1000);
      if (isNewContact) {
        setNodes((prev) => {
          const built = meshcoreMinimalNodeFromAdvertEvent(publicKey, { nowSec });
          if (!built) return prev;
          const nick = nicknameMapRef.current.get(nodeId);
          const nodeWithNick = nick
            ? { ...built.node, long_name: nick, short_name: '' }
            : built.node;
          const next = new Map(prev);
          next.set(nodeId, nodeWithNick);
          return next;
        });
      } else {
        setNodes((prev) => {
          const existing = prev.get(nodeId);
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(nodeId, {
            ...existing,
            last_heard: Math.max(existing.last_heard ?? 0, nowSec),
          });
          return next;
        });
      }
      meshcorePathUpdatePendingRef.current.add(nodeId);
      const conn = connRef.current;
      if (conn) {
        void refreshMeshcoreOutPathAfterPathUpdated(
          conn,
          nodeId,
          outPathMapRef.current,
          meshcorePathUpdatePendingRef.current,
        );
      }
    },
    [],
  );

  /** Returned by {@link setupEventListeners}; run before `conn.close()` or replacing the connection. */
  const meshcoreConnEventListenersTeardownRef = useRef<(() => void) | null>(null);
  const teardownMeshcoreConnEventListeners = useCallback(
    (opts?: { driverDisconnect?: boolean; driverIdentityId?: string }) => {
      if (meshcoreIngestDetachRef.current) {
        meshcoreIngestDetachRef.current();
        meshcoreIngestDetachRef.current = null;
      }
      const driverIdentity =
        opts?.driverIdentityId ??
        (meshcoreDriverConnectedRef.current
          ? (meshcoreIdentityIdRef.current ?? meshcorePendingDriverIdentityRef.current)
          : null);
      const shouldDriverDisconnect = opts?.driverDisconnect !== false;
      if (driverIdentity && shouldDriverDisconnect) {
        meshcoreDriverConnectedRef.current = false;
        meshcorePendingDriverIdentityRef.current = null;
        void connectionDriver.disconnect(driverIdentity).catch((e: unknown) => {
          console.debug('[useMeshcoreRuntime] driver disconnect ' + errLikeToLogString(e));
        });
      } else if (meshcoreIngressDetachRef.current) {
        try {
          meshcoreIngressDetachRef.current();
        } catch (e) {
          console.debug('[useMeshcoreRuntime] ingress detach error ' + errLikeToLogString(e));
        }
        meshcoreIngressDetachRef.current = null;
      }
      meshcoreIdentityIdRef.current = null;
      meshcorePendingDriverIdentityRef.current = null;
      setMeshcoreIdentityId(null);
      clearMeshcorePubKeyRegistry();
      meshcoreConnEventListenersTeardownRef.current?.();
      meshcoreConnEventListenersTeardownRef.current = null;
    },
    [],
  );

  const getRemoteAdminKeyForNode = useCallback((nodeNum: number): string | undefined => {
    void nodeNum;
    return undefined;
  }, []);

  const setRemoteAdminKeyForNode = useCallback((nodeNum: number, key: string): Promise<void> => {
    void nodeNum;
    void key;
    // Meshtastic-only remote admin; MeshCore has no equivalent.
    return Promise.resolve();
  }, []);

  const meshcoreLegacyConnEventsCtx = useMemo<MeshcoreLegacyConnEventsCtx>(
    () => ({
      meshcoreIdentityIdRef,
      connRef,
      lastPacketLogAtRef,
      lastPacketLogPublishFailureLogAtRef,
      meshcoreContactsRefreshTimerRef,
      meshcoreHookMountedRef,
      meshcorePathUpdatePendingRef,
      meshcoreSessionPathUpdatedNodeIdsRef,
      meshcoreWaitingMessagesPollRef,
      messagesRef,
      mqttStatusRef,
      myNodeNumRef,
      nicknameMapRef,
      nodesRef,
      outPathMapRef,
      pendingAcksRef,
      processWaitingMessagesRef,
      pubKeyMapRef,
      pubKeyPrefixMapRef,
      rawPacketsRef,
      repeaterCommandServiceRef,
      selfInfoRef,
      buildNodesFromContactsRef,
      setDeviceLogs,
      setMeshcoreAutoadd,
      setMeshcoreContactsForTelemetry,
      setMeshcorePingRouteReadyEpoch,
      setMessages,
      setNodes,
      setQueueStatus,
      setRawPackets,
      setSignalTelemetry,
      setState,
      setWaitingMessagesCount,
      addMessage,
      addCliHistoryEntry,
      teardownMeshcoreConnEventListeners,
      meshcorePreviousNodesBaselineForBuild,
      handleConnectionLostRef: handleMeshcoreConnectionLostRef,
    }),
    [
      addMessage,
      addCliHistoryEntry,
      teardownMeshcoreConnEventListeners,
      meshcorePreviousNodesBaselineForBuild,
    ],
  );

  useEffect(() => {
    return window.electronAPI.onNobleBleDisconnected((sessionId) => {
      if (sessionId !== 'meshcore') return;
      if (!meshcoreConnectionParamsRef.current) return;
      handleMeshcoreConnectionLostRef.current();
    });
  }, []);

  const setupEventListeners = useCallback(
    (conn: MeshCoreConnection) => attachMeshcoreLegacyConnEvents(conn, meshcoreLegacyConnEventsCtx),
    [meshcoreLegacyConnEventsCtx],
  );

  /** Reject promptly when `disconnect()` bumps `meshcoreSetupGenerationRef` (avoids hanging on getChannels, etc.). */
  const awaitUnlessMeshcoreSetupCancelled = useCallback(
    async <T>(setupGen: number, promise: Promise<T>): Promise<T> => {
      if (meshcoreSetupGenerationRef.current !== setupGen) {
        throw new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError');
      }
      return new Promise<T>((resolve, reject) => {
        const id = setInterval(() => {
          if (meshcoreSetupGenerationRef.current !== setupGen) {
            clearInterval(id);
            reject(new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError'));
          }
        }, 50);
        promise.then(
          (v) => {
            clearInterval(id);
            if (meshcoreSetupGenerationRef.current !== setupGen) {
              reject(new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError'));
            } else {
              resolve(v);
            }
          },
          (e: unknown) => {
            clearInterval(id);
            reject(
              e instanceof Error ? e : new Error(serializeErrorLike(e) || 'Connection failed'),
            );
          },
        );
      });
    },
    [],
  );

  const refreshMeshcoreAutoaddFromDevice = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) return;
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => {
        conn.off('rx', onRx);
        reject(new Error('Timed out waiting for auto-add config'));
      }, 5000);
      const onRx = (data: unknown) => {
        const frame = meshcoreCoerceRadioRxFrame(data);
        const parsed = frame && parseAutoaddConfigResponse(frame);
        if (!parsed) return;
        window.clearTimeout(t);
        conn.off('rx', onRx);
        setMeshcoreAutoadd(parsed);
        resolve();
      };
      conn.on('rx', onRx);
      void conn.sendToRadioFrame(buildGetAutoaddConfigFrame()).catch((e: unknown) => {
        window.clearTimeout(t);
        conn.off('rx', onRx);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }, []);

  /** Shared post-connection handshake: wire events, fetch self info, contacts, channels. */
  const initConn = useCallback(
    async (conn: MeshCoreConnection, setupGen: number, opts?: { driverIdentityId?: string }) => {
      connRef.current = conn;
      meshcoreConnEventListenersTeardownRef.current ??= setupEventListeners(conn);

      // meshcore.js runs deviceQuery(SupportedCompanionProtocolVersion) from onConnected() on the next
      // macrotask; register before any await so we capture that DeviceInfo (manufacturer string, build date).
      conn.once(MESHCORE_RESPONSE_DEVICE_INFO, (response: unknown) => {
        setState((prev) => {
          const next = { ...prev };
          const r = response as { firmware_build_date?: string };
          if (typeof r?.firmware_build_date === 'string' && r.firmware_build_date.trim()) {
            next.firmwareVersion = r.firmware_build_date.trim();
          }
          const mm = meshcoreManufacturerModelFromDeviceQuery(response);
          if (mm) next.manufacturerModel = mm;
          return next;
        });
      });

      // Load persisted messages in background (not required for contact/repeater list).
      void (async () => {
        try {
          const dbMsgs = await awaitUnlessMeshcoreSetupCancelled(
            setupGen,
            loadMeshcoreMessagesForHydration(),
          );
          if (dbMsgs.length > 0) {
            const contactRows =
              (await window.electronAPI.db.getMeshcoreContacts()) as MeshcoreContactDbRow[];
            const mapped = repairMeshcoreHydratedMessages(
              mapMeshcoreDbRowsToChatMessages(dbMsgs),
              meshcoreRoomServerIdsFromContacts(contactRows),
              myNodeNumRef.current,
            );
            setNodes((prev) => mergeStubNodesFromMeshcoreMessages(prev, mapped));
            setMessages((prev) => mergeMeshcoreDbHydrationWithLive(prev, mapped));
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          console.warn('[useMeshcoreRuntime] loadMessagesFromDb error ' + errLikeToLogString(e));
        }
      })();

      const initConnPerfStart = performance.now();
      const driverStoreId = opts?.driverIdentityId ?? resolveMeshcoreStoreIdentityId();
      if (driverStoreId) {
        meshcoreIdentityIdRef.current = driverStoreId;
        setMeshcoreIdentityId(driverStoreId);
      }

      const getSelfInfoStart = performance.now();
      const selfInfoPromise = awaitUnlessMeshcoreSetupCancelled(setupGen, conn.getSelfInfo(5000));
      const getContactsStart = performance.now();
      const contactsPromise = awaitUnlessMeshcoreSetupCancelled(
        setupGen,
        (async () => {
          if (meshcoreConnectTypeRef.current === 'ble') {
            await awaitDualNobleBleMeshtasticSettle();
          }
          return withTimeout(conn.getContacts(), MESHCORE_INIT_TIMEOUT_MS, 'getContacts');
        })(),
      );
      const channelsPromise = awaitUnlessMeshcoreSetupCancelled(
        setupGen,
        withTimeout(conn.getChannels(), MESHCORE_INIT_TIMEOUT_MS, 'getChannels'),
      );
      void (async () => {
        try {
          const rawChannels = await channelsPromise;
          setChannels(
            rawChannels.map((c) => ({ index: c.channelIdx, name: c.name, secret: c.secret })),
          );
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          console.warn('[useMeshcoreRuntime] getChannels error ' + errLikeToLogString(e));
        }
      })();

      // Show persisted contacts immediately while the radio contact dump runs over BLE.
      const dbCacheStart = performance.now();
      let dbCacheNodeCount = 0;
      if (driverStoreId) {
        try {
          const [rows, dbMsgs, savedNodes] = await Promise.all([
            window.electronAPI.db.getMeshcoreContacts(),
            loadMeshcoreMessagesForHydration(),
            window.electronAPI.db.getNodes(),
          ]);
          const contactRows = rows as MeshcoreContactDbRow[];
          registerMeshcorePubKeysFromContactDbRows(contactRows);
          copyMeshcorePubKeyRegistryToRefs(pubKeyMapRef.current, pubKeyPrefixMapRef.current);
          const mapped = repairMeshcoreHydratedMessages(
            mapMeshcoreDbRowsToChatMessages(dbMsgs),
            meshcoreRoomServerIdsFromContacts(contactRows),
            myNodeNumRef.current,
          );
          const cachedNodes = buildMeshcoreNodeMapFromDb(
            contactRows,
            savedNodes as MeshcoreSavedNodeHopRow[],
            mapped,
          );
          dbCacheNodeCount = cachedNodes.size;
          meshcoreLastPersistedNodesRef.current = new Map(cachedNodes);
          applyMeshcoreNodesToUi(cachedNodes);
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
          console.warn(
            '[useMeshcoreRuntime] initConn db cache hydrate failed ' + errLikeToLogString(e),
          );
        }
      }
      const dbCacheMs = Math.round(performance.now() - dbCacheStart);
      console.debug(
        `[useMeshcoreRuntime] initConn dbCache→UI ${dbCacheMs}ms (${dbCacheNodeCount} nodes)`,
      );

      const rawInfo = await selfInfoPromise;
      const getSelfInfoMs = Math.round(performance.now() - getSelfInfoStart);
      console.debug(`[useMeshcoreRuntime] initConn getSelfInfo ${getSelfInfoMs}ms`);
      const info = enrichMeshCoreSelfInfo(rawInfo);
      setSelfInfo(info);
      setState((prev) => ({ ...prev, status: 'connected' }));

      const myNodeId = pubkeyToNodeId(info.publicKey);
      persistMeshcoreSelfNodeId(myNodeId);
      setState((prev) => ({
        ...prev,
        myNodeNum: myNodeId,
        status: 'configured',
        connectionLoss: false,
      }));
      if (getStoredMeshProtocol() === 'meshcore') {
        useDiagnosticsStore.getState().migrateForeignLoraFromZero(myNodeId);
      }

      const transportType = meshcoreConnectTypeRef.current;
      const discovery = { myNodeNum: myNodeId, publicKey: info.publicKey };
      let identityId = opts?.driverIdentityId ?? null;
      if (identityId) {
        if (meshcoreIngressDetachRef.current) {
          meshcoreIngressDetachRef.current();
          meshcoreIngressDetachRef.current = null;
        }
        finalizeMeshcoreDriverIdentity(
          identityId,
          meshcoreTransportParams(transportType, {}),
          discovery,
        );
        meshcoreIdentityIdRef.current = identityId;
        setMeshcoreIdentityId(identityId);
      } else {
        if (meshcoreIngressDetachRef.current) {
          meshcoreIngressDetachRef.current();
        }
        // MeshCore protocol ingress covers advert/DM/channel only; waiting messages,
        // stats, MQTT, and repeater RPCs stay in this hook until fully protocol-scoped (#375 / #377).
        const ingress = bindMeshcoreIngress(
          conn as unknown as Connection,
          transportType,
          {},
          discovery,
        );
        meshcoreIngressDetachRef.current = ingress.detach;
        identityId = ingress.identityId;
        meshcoreIdentityIdRef.current = identityId;
        setMeshcoreIdentityId(identityId);
      }
      if (meshcoreIngestDetachRef.current) {
        meshcoreIngestDetachRef.current();
      }
      if (identityId) {
        meshcoreIngestDetachRef.current = attachMeshcoreIngest(identityId, {
          onPathUpdated: handleMeshcorePathUpdatedFromIngest,
        });
        setConnection(identityId, {
          status: 'configured',
          connectionType: transportType === 'tcp' ? 'http' : transportType,
          myNodeNum: myNodeId,
        });
      }

      const contactsRaw = await contactsPromise;
      const getContactsMs = Math.round(performance.now() - getContactsStart);
      console.debug(
        `[useMeshcoreRuntime] initConn getContacts ${getContactsMs}ms (total ${Math.round(performance.now() - initConnPerfStart)}ms)`,
      );
      // Reconcile radio truth: clear stale flags before re-marking contacts seen on-device.
      try {
        await window.electronAPI.db.markAllMeshcoreContactsOffRadio();
      } catch (e) {
        console.warn(
          '[useMeshcoreRuntime] initConn markAllMeshcoreContactsOffRadio failed ' +
            errLikeToLogString(e),
        );
      }
      const contacts = contactsRaw.map(meshcoreContactRawFromDevice);
      setMeshcoreContactsForTelemetry(contacts);
      const previousNodesBaseline = meshcorePreviousNodesBaselineForBuild();
      const newNodes = await awaitUnlessMeshcoreSetupCancelled(
        setupGen,
        buildNodesFromContacts(contacts, {
          self: info,
          myNodeId,
          previousNodes: previousNodesBaseline,
          contactsFromRadio: true,
          deferDbMerge: true,
          deferPathHistory: true,
        }),
      );
      applyMeshcoreNodesToUi(newNodes);
      if (identityId) {
        repairMeshcoreChannelSenderIdsInStore(identityId);
      }
      const contactsToUiMs = Math.round(performance.now() - initConnPerfStart);
      console.debug(
        `[useMeshcoreRuntime] initConn contacts→UI ${contactsToUiMs}ms (${newNodes.size} nodes)`,
      );
      triggerRoomAutoLoginRef.current();
      void deferMeshcoreDbContactMerge(newNodes, previousNodesBaseline);

      // MQTT identity, firmware, channels — deferred so Repeaters/Contacts populate first.
      void (async () => {
        try {
          const rawExport = await awaitUnlessMeshcoreSetupCancelled(
            setupGen,
            withTimeout(conn.exportPrivateKey(), 10_000, 'exportPrivateKey'),
          );
          const privBytes = coerceMeshcoreExportPrivateKeyResult(rawExport);
          void tryPersistMeshcoreIdentityFromRadioExport(info.publicKey, privBytes);
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          console.debug(
            '[useMeshcoreRuntime] exportPrivateKey for MQTT identity cache skipped ' +
              errLikeToLogString(e),
          );
        }

        try {
          const deviceInfo = await conn.deviceQuery(MESHCORE_DEVICE_QUERY_APP_VER);
          setState((prev) => {
            const next = { ...prev };
            if (deviceInfo?.firmware_build_date) {
              next.firmwareVersion = deviceInfo.firmware_build_date;
            }
            const mm = meshcoreManufacturerModelFromDeviceQuery(deviceInfo);
            if (mm) {
              next.manufacturerModel = mm;
            }
            return next;
          });
        } catch {
          // catch-no-log-ok deviceQuery optional for firmware string
        }
      })();

      // Re-resolve map/App GPS after nodesRef picks up getSelfInfo advert coords (same tick as setNodes is too early).
      requestAnimationFrame(() => {
        queueMicrotask(() => {
          void refreshOurPositionMeshCoreRef.current().catch((e: unknown) => {
            console.debug(
              '[useMeshcoreRuntime] post-connect refreshOurPosition ' + errLikeToLogString(e),
            );
          });
          void requestTelemetryMeshCoreRef.current(myNodeId).catch((e: unknown) => {
            console.debug(
              '[useMeshcoreRuntime] post-connect self telemetry (altitude) ' +
                errLikeToLogString(e),
            );
          });
        });
      });

      // Post-init side-effects — run sequentially to avoid shared Ok/Err listener races
      // with user-initiated commands (e.g. config import right after connect).
      // Apply saved manual contacts preference
      try {
        const savedManual = localStorage.getItem(MANUAL_CONTACTS_KEY) === 'true';
        if (savedManual) {
          await awaitUnlessMeshcoreSetupCancelled(setupGen, conn.setManualAddContacts());
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        console.warn(
          '[useMeshcoreRuntime] setManualAddContacts (init) error ' + errLikeToLogString(e),
        );
      }

      await awaitUnlessMeshcoreSetupCancelled(
        setupGen,
        conn.syncDeviceTime().catch((e: unknown) => {
          console.warn('[useMeshcoreRuntime] syncDeviceTime error ' + errLikeToLogString(e));
        }),
      );
      await awaitUnlessMeshcoreSetupCancelled(
        setupGen,
        conn
          .getBatteryVoltage()
          .then(({ batteryMilliVolts }) => {
            setSelfInfo((prev) => (prev ? { ...prev, batteryMilliVolts } : prev));
          })
          .catch((e: unknown) => {
            console.warn('[useMeshcoreRuntime] getBatteryVoltage error ' + errLikeToLogString(e));
          }),
      );

      await awaitUnlessMeshcoreSetupCancelled(
        setupGen,
        refreshMeshcoreAutoaddFromDevice().catch((e: unknown) => {
          console.warn(
            '[useMeshcoreRuntime] refreshMeshcoreAutoaddFromDevice (init) error ' +
              errLikeToLogString(e),
          );
        }),
      );

      try {
        const settingsRaw = getAppSettingsRaw();
        const settings = parseStoredJson<{ meshcoreFloodScopeHashtag?: string }>(
          settingsRaw,
          'initConn meshcoreFloodScopeHashtag',
        );
        const floodHashtag =
          typeof settings?.meshcoreFloodScopeHashtag === 'string'
            ? settings.meshcoreFloodScopeHashtag
            : '';
        if (floodHashtag) {
          await awaitUnlessMeshcoreSetupCancelled(
            setupGen,
            applyMeshcoreFloodScope(conn, floodHashtag),
          );
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        console.warn(
          '[useMeshcoreRuntime] initConn reapply flood scope failed ' + errLikeToLogString(e),
        );
      }

      // Proactively fetch any messages that queued while disconnected.
      // Mirrors what event 131 does, but covers reconnects where the event was missed.
      try {
        await processWaitingMessagesRef.current?.();
      } catch (e) {
        console.warn(
          '[useMeshcoreRuntime] initConn: proactive getWaitingMessages failed ' +
            errLikeToLogString(e),
        );
      }

      // Periodic safety-net poll in case the device never re-sends event 131.
      const MESHCORE_WAITING_MESSAGES_POLL_MS = 5 * 60 * 1_000;
      if (meshcoreWaitingMessagesPollRef.current)
        clearInterval(meshcoreWaitingMessagesPollRef.current);
      meshcoreWaitingMessagesPollRef.current = setInterval(() => {
        if (!meshcoreHookMountedRef.current) return;
        void processWaitingMessagesRef.current?.().catch((e: unknown) => {
          console.warn(
            '[useMeshcoreRuntime] periodic getWaitingMessages failed ' + errLikeToLogString(e),
          );
        });
      }, MESHCORE_WAITING_MESSAGES_POLL_MS);

      meshcoreRoomReconnectSyncRef.current();
    },
    [
      awaitUnlessMeshcoreSetupCancelled,
      applyMeshcoreNodesToUi,
      buildNodesFromContacts,
      deferMeshcoreDbContactMerge,
      handleMeshcorePathUpdatedFromIngest,
      meshcorePreviousNodesBaselineForBuild,
      refreshMeshcoreAutoaddFromDevice,
      resolveMeshcoreStoreIdentityId,
      setupEventListeners,
    ],
  );

  const prepareRfConnect = useCallback(
    async (type: 'ble' | 'serial' | 'tcp'): Promise<void> => {
      if (type === 'ble' && bleConnectInProgressRef.current) {
        throw new Error(
          'Bluetooth connection already in progress. Wait for it to finish or cancel, then try again.',
        );
      }
      const driverIdentity = meshcoreDriverConnectedRef.current
        ? (meshcoreIdentityIdRef.current ?? meshcorePendingDriverIdentityRef.current)
        : null;
      const staleConn = connRef.current;
      connRef.current = null;
      if (driverIdentity) {
        meshcoreDriverConnectedRef.current = false;
        meshcorePendingDriverIdentityRef.current = null;
        teardownMeshcoreConnEventListeners({
          driverDisconnect: true,
          driverIdentityId: driverIdentity,
        });
      } else if (staleConn) {
        teardownMeshcoreConnEventListeners({ driverDisconnect: false });
        await staleConn.close().catch((e: unknown) => {
          console.debug('[useMeshcoreRuntime] prepareRfConnect close ' + errLikeToLogString(e));
        });
      }
      meshcoreConnectTypeRef.current = type;
      setState({
        status: 'connecting',
        myNodeNum: 0,
        connectionType: type === 'tcp' ? 'http' : type,
        connectionLoss: false,
      });
      if (type === 'ble') bleConnectInProgressRef.current = true;
    },
    [teardownMeshcoreConnEventListeners],
  );

  const attachRfSession = useCallback(
    async (driverIdentityId: string, type: 'ble' | 'serial' | 'tcp'): Promise<void> => {
      const setupGen = meshcoreSetupGenerationRef.current;
      meshcoreDriverConnectedRef.current = true;
      meshcorePendingDriverIdentityRef.current = driverIdentityId;
      const conn = connectionDriver.getHandle(driverIdentityId) as MeshCoreConnection | null;
      if (!conn) {
        throw new Error(
          '[useMeshcoreRuntime] attachRfSession: ConnectionDriver returned no handle',
        );
      }
      if (meshcoreSetupGenerationRef.current !== setupGen) {
        meshcoreDriverConnectedRef.current = false;
        await connectionDriver.disconnect(driverIdentityId).catch((e: unknown) => {
          console.debug(
            '[useMeshcoreRuntime] attachRfSession abort disconnect ' + errLikeToLogString(e),
          );
        });
        throw new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError');
      }
      connRef.current = conn;
      meshcoreConnEventListenersTeardownRef.current ??= setupEventListeners(conn);
      await initConn(conn, setupGen, { driverIdentityId });
      if (type === 'serial') {
        const portId = localStorage.getItem(LAST_SERIAL_PORT_KEY);
        const nodeName = selfInfoRef.current?.name?.trim() || null;
        if (portId && nodeName) {
          try {
            const key = 'mesh-client:serialPortNodeNames';
            const cache =
              parseStoredJson<Record<string, string>>(
                localStorage.getItem(key),
                'useMeshcoreRuntime serialPortNodeNames cache',
              ) ?? {};
            cache[portId] = nodeName;
            localStorage.setItem(key, JSON.stringify(cache));
          } catch {
            // catch-no-log-ok localStorage write for serial port node name cache — non-critical
          }
        }
      }
    },
    [initConn, setupEventListeners],
  );

  const handleRfConnectFailure = useCallback(
    (type: 'ble' | 'serial' | 'tcp', driverIdentityId?: string): Promise<void> => {
      setState({ status: 'disconnected', myNodeNum: 0, connectionType: null });
      teardownMeshcoreConnEventListeners({
        driverDisconnect: true,
        driverIdentityId,
      });
      connRef.current = null;
      if (type === 'ble') bleConnectInProgressRef.current = false;
      return Promise.resolve();
    },
    [teardownMeshcoreConnEventListeners],
  );

  const finalizeDriverDisconnect = useCallback(
    async (opts?: { disconnectDriver?: boolean }) => {
      const disconnectDriver = opts?.disconnectDriver !== false;
      meshcoreSetupGenerationRef.current += 1;
      const ackEntries = new Set(pendingAcksRef.current.values());
      for (const e of ackEntries) {
        clearTimeout(e.timeoutId);
      }
      pendingAcksRef.current.clear();
      repeaterCommandServiceRef.current?.clear();

      const usedDriverConnect = meshcoreDriverConnectedRef.current;
      teardownMeshcoreConnEventListeners({ driverDisconnect: disconnectDriver });
      if (!usedDriverConnect) {
        try {
          await connRef.current?.close();
        } catch (e) {
          console.warn(
            '[useMeshcoreRuntime] finalizeDriverDisconnect close ' + errLikeToLogString(e),
          );
        }
      }
      connRef.current = null;
      meshcoreSessionPathUpdatedNodeIdsRef.current = new Set();
      setMeshcorePingRouteReadyEpoch((e) => e + 1);
      pubKeyMapRef.current.clear();
      pubKeyPrefixMapRef.current.clear();
      outPathMapRef.current.clear();
      nicknameMapRef.current.clear();
      setMessages([]);
      try {
        await reloadMeshcoreNodesFromDb({ hydrateMessages: false });
      } catch (e: unknown) {
        console.warn(
          '[useMeshcoreRuntime] finalizeDriverDisconnect rehydrate failed ' + errLikeToLogString(e),
        );
        setNodes(new Map());
      }
      setChannels([]);
      setSelfInfo(null);
      setMeshcoreContactsForTelemetry([]);
      setMeshcoreAutoadd(null);
      setDeviceLogs([]);
      setTelemetry([]);
      setSignalTelemetry([]);
      setMeshcoreTraceResults(new Map());
      setMeshcoreNodeStatus(new Map());
      setMeshcoreNodeTelemetry(new Map());
      setMeshcoreTelemetryErrors(new Map());
      setMeshcoreNeighbors(new Map());
      setMeshcoreCliHistories(new Map());
      setMeshcoreCliErrors(new Map());
      meshcoreClearAllRoomSessions();
      setEnvironmentTelemetry([]);
      setState(INITIAL_STATE);
      if (meshcoreStatsPollRef.current) {
        clearInterval(meshcoreStatsPollRef.current);
        meshcoreStatsPollRef.current = null;
      }
      if (roomSyncSchedulerRef.current) {
        clearInterval(roomSyncSchedulerRef.current);
        roomSyncSchedulerRef.current = null;
      }
      prevTxAirSecsRef.current = null;
      prevStatsTimestampRef.current = null;
      bleConnectInProgressRef.current = false;
    },
    [teardownMeshcoreConnEventListeners, reloadMeshcoreNodesFromDb],
  );

  const attemptMeshcoreReconnect = useCallback(async () => {
    const params = meshcoreConnectionParamsRef.current;
    if (!params) {
      meshcoreIsReconnectingRef.current = false;
      return;
    }

    if (meshcoreReconnectAttemptRef.current >= MESHCORE_MAX_RECONNECT_ATTEMPTS) {
      meshcoreIsReconnectingRef.current = false;
      meshcoreReconnectAttemptRef.current = 0;
      setState((s) => ({
        ...s,
        status: 'disconnected',
        connectionType: null,
        connectionLoss: true,
      }));
      return;
    }

    const generation = meshcoreReconnectGenerationRef.current;
    meshcoreReconnectAttemptRef.current += 1;
    setState((s) => ({
      ...s,
      status: 'reconnecting',
      connectionLoss: true,
      reconnectAttempt: meshcoreReconnectAttemptRef.current,
    }));

    const delay = Math.min(2000 * Math.pow(2, meshcoreReconnectAttemptRef.current - 1), 32_000);
    console.debug(
      `[useMeshcoreRuntime] reconnect: waiting ${delay}ms before attempt ${meshcoreReconnectAttemptRef.current}/${MESHCORE_MAX_RECONNECT_ATTEMPTS}`,
    );
    const delayResult = await delayUnlessSuspended(delay, () =>
      !meshcoreIsReconnectingRef.current
        ? true
        : meshcoreReconnectGenerationRef.current !== generation,
    );
    if (delayResult === 'aborted') return;
    if (delayResult === 'suspended') {
      meshcoreIsReconnectingRef.current = false;
      setState((s) => ({
        ...s,
        status: 'disconnected',
        connectionLoss: true,
      }));
      return;
    }
    if (
      !meshcoreIsReconnectingRef.current ||
      meshcoreReconnectGenerationRef.current !== generation
    ) {
      return;
    }

    let opened: Awaited<ReturnType<typeof openMeshCoreTransport>> | undefined;
    try {
      await prepareRfConnect(params.rfType);
      opened = await openMeshCoreTransport(params.rfType, {
        blePeripheralId: params.blePeripheralId,
        host: params.rfType === 'tcp' ? (params.httpAddress ?? 'localhost') : undefined,
        portSignature: params.rfType === 'serial' ? (params.serialPortId ?? undefined) : undefined,
      });
      await attachRfSession(opened.driverIdentityId, params.rfType);
      if (meshcoreReconnectGenerationRef.current !== generation) {
        throw new Error('MeshCore reconnect superseded during attach');
      }
      if (!(await verifyMeshcoreRfLink(params.rfType))) {
        throw new Error('RF link lost after MeshCore reconnect attach');
      }
      console.debug(
        `[useMeshcoreRuntime] Reconnect succeeded on attempt ${meshcoreReconnectAttemptRef.current}`,
      );
      meshcoreReconnectAttemptRef.current = 0;
      meshcoreIsReconnectingRef.current = false;
    } catch (err) {
      if (opened?.driverIdentityId) {
        await connectionDriver.disconnect(opened.driverIdentityId).catch((e: unknown) => {
          console.debug(
            '[useMeshcoreRuntime] reconnect failure driver disconnect ' + errLikeToLogString(e),
          );
        });
      }
      console.warn(
        `[useMeshcoreRuntime] Reconnect attempt ${meshcoreReconnectAttemptRef.current} failed: ` +
          errLikeToLogString(err),
      );
      void attemptMeshcoreReconnectRef.current();
    }
  }, [attachRfSession, prepareRfConnect]);

  attemptMeshcoreReconnectRef.current = attemptMeshcoreReconnect;

  const handleMeshcoreConnectionLost = useCallback(() => {
    if (!meshcoreConnectionParamsRef.current) return;
    meshcoreReconnectGenerationRef.current += 1;
    if (!meshcoreIsReconnectingRef.current) {
      console.warn('[useMeshcoreRuntime] Connection lost — initiating reconnect');
      meshcoreIsReconnectingRef.current = true;
    } else {
      console.warn(
        '[useMeshcoreRuntime] Connection lost during reconnect — restarting reconnect cycle',
      );
    }

    void (async () => {
      meshcoreSetupGenerationRef.current += 1;
      const driverIdentity =
        meshcoreIdentityIdRef.current ?? meshcorePendingDriverIdentityRef.current;
      teardownMeshcoreConnEventListeners({ driverDisconnect: true });
      connRef.current = null;
      meshcoreDriverConnectedRef.current = false;
      meshcorePendingDriverIdentityRef.current = null;
      if (driverIdentity) {
        await connectionDriver.disconnect(driverIdentity).catch((e: unknown) => {
          console.debug(
            '[useMeshcoreRuntime] handleMeshcoreConnectionLost driver disconnect ' +
              errLikeToLogString(e),
          );
        });
      }
      void attemptMeshcoreReconnectRef.current();
    })();
  }, [teardownMeshcoreConnEventListeners]);

  handleMeshcoreConnectionLostRef.current = handleMeshcoreConnectionLost;

  const onPowerSuspend = useCallback(() => {
    meshcoreReconnectGenerationRef.current += 1;
    meshcoreIsReconnectingRef.current = false;
  }, []);

  const onPowerResume = useCallback(() => {
    if (!meshcoreConnectionParamsRef.current) return;
    console.debug('[useMeshcoreRuntime] power resume — resetting reconnect budget');
    meshcoreReconnectAttemptRef.current = 0;
    meshcoreReconnectGenerationRef.current += 1;
    meshcoreIsReconnectingRef.current = false;
    handleMeshcoreConnectionLostRef.current();
  }, []);

  const connect = useCallback(
    async (type: 'ble' | 'serial' | 'tcp', tcpHost?: string, blePeripheralId?: string) => {
      await prepareRfConnect(type);

      /** Linux MeshCore uses renderer Web Bluetooth (not Noble IPC) — timeout copy must match. */
      const meshcoreBleLinuxWebBluetooth =
        type === 'ble' && navigator.userAgent.toLowerCase().includes('linux');

      let opened: Awaited<ReturnType<typeof openMeshCoreTransport>> | undefined;
      try {
        if (type === 'ble' && !meshcoreBleLinuxWebBluetooth && !blePeripheralId) {
          throw new Error('BLE peripheral ID required');
        }
        opened = await openMeshCoreTransport(type, {
          blePeripheralId,
          host: type === 'tcp' ? (tcpHost ?? 'localhost') : undefined,
        });
        await attachRfSession(opened.driverIdentityId, type);
        meshcoreConnectionParamsRef.current = {
          rfType: type,
          httpAddress: type === 'tcp' ? tcpHost : undefined,
          blePeripheralId: type === 'ble' ? blePeripheralId : undefined,
          serialPortId: type === 'serial' ? localStorage.getItem(LAST_SERIAL_PORT_KEY) : undefined,
        };
        meshcoreReconnectAttemptRef.current = 0;
        meshcoreIsReconnectingRef.current = false;
        meshcoreReconnectGenerationRef.current += 1;
      } catch (err) {
        const isSetupAbort =
          err instanceof DOMException &&
          err.name === 'AbortError' &&
          err.message === MESHCORE_SETUP_ABORT_MESSAGE;
        if (isSetupAbort) {
          await handleRfConnectFailure(type, opened?.driverIdentityId);
          throw err;
        }
        const rawMessage = serializeErrorLike(err) || 'Connection failed';
        const safeMessage = rawMessage.trim() || 'Connection failed';
        const isAlreadyInProgress = /already in progress|Connection already in progress/i.test(
          safeMessage,
        );
        const isMissingServices = /could not find all requested services/i.test(safeMessage);
        const isPeripheralInUse = /already in use by the/i.test(safeMessage);
        const bleTimeoutStage =
          type === 'ble' ? classifyMeshcoreBleTimeoutStage(safeMessage) : 'unknown';
        const isBleConnectTimeout = bleTimeoutStage !== 'unknown';
        // When err is missing (e.g. library rejected with no reason), use a BLE-specific hint if we were connecting via BLE
        const fallbackMessage =
          type === 'ble' && err == null
            ? 'BLE connection failed (no error details from device). Try again or use Serial/USB.'
            : 'Connection failed';
        const displayMessage = safeMessage !== 'Connection failed' ? safeMessage : fallbackMessage;
        const timeoutMessage = meshcoreBleLinuxWebBluetooth
          ? bleTimeoutStage === 'protocol-handshake'
            ? 'MeshCore handshake timed out (Web Bluetooth). The radio may need a PIN paired with Linux first: use Remove & Re-pair Device and enter the PIN shown on the device, or pair with bluetoothctl, then tap Connect again.'
            : 'Bluetooth connection timed out while opening MeshCore over Web Bluetooth. Retry, keep the device awake, power-cycle BLE on the radio, or use Serial/TCP.'
          : bleTimeoutStage === 'protocol-handshake'
            ? 'Bluetooth connected but MeshCore protocol handshake did not complete before disconnect/timeout. Retry, keep the device awake and nearby, power-cycle BLE, or use Serial/TCP.'
            : 'Bluetooth connection timed out while opening MeshCore over Noble IPC. Retry, power-cycle BLE on the device, or use Serial/TCP.';
        const normalizedErr = new Error(
          isAlreadyInProgress
            ? 'Bluetooth connection already in progress. Wait for it to finish or try Serial/USB instead.'
            : isMissingServices
              ? 'Device does not support the MeshCore BLE protocol. Make sure the device is running MeshCore firmware.'
              : isPeripheralInUse
                ? 'This device is already connected via Meshtastic BLE. Disconnect it first before connecting as MeshCore.'
                : isBleConnectTimeout
                  ? timeoutMessage
                  : displayMessage,
        );
        if (isBleConnectTimeout) {
          console.warn(
            meshcoreBleLinuxWebBluetooth
              ? `[useMeshcoreRuntime] connect: BLE Web Bluetooth timed out ${formatStructuredLogDetail(
                  {
                    stage: bleTimeoutStage,
                  },
                )}`
              : `[useMeshcoreRuntime] connect: BLE Noble IPC timed out; advise retry, BLE power-cycle, or Serial/TCP fallback ${formatStructuredLogDetail(
                  { stage: bleTimeoutStage },
                )}`,
          );
        }
        const errForLog = serializeErrorLike(err) || '(no error object)';
        console.error(
          `[useMeshcoreRuntime] connect error ${formatStructuredLogDetail({
            userMessage: normalizedErr.message,
            raw: errForLog,
            bleTimeoutStage: isBleConnectTimeout ? bleTimeoutStage : null,
          })}`,
        );
        await handleRfConnectFailure(type, opened?.driverIdentityId);
        throw normalizedErr;
      } finally {
        if (type === 'ble') bleConnectInProgressRef.current = false;
      }
    },
    [prepareRfConnect, attachRfSession, handleRfConnectFailure],
  );

  /**
   * Gesture-free reconnect — called on startup when a last connection is remembered.
   * Serial: uses navigator.serial.getPorts() to find the previously granted port by ID.
   * HTTP: delegates to connect() directly.
   * BLE: requires a user gesture, not supported here.
   */
  const connectAutomatic = useCallback(
    async (
      type: 'ble' | 'serial' | 'http',
      httpAddress?: string,
      lastSerialPortId?: string | null,
      blePeripheralId?: string,
    ) => {
      if (type === 'ble') {
        const resolvedBleId = blePeripheralId ?? resolveLastBlePeripheralId('meshcore');
        if (!resolvedBleId) {
          throw new Error('No BLE device remembered for MeshCore auto-connect');
        }
        await connect('ble', undefined, resolvedBleId);
        return;
      }
      if (type === 'serial') {
        await prepareRfConnect('serial');
        let opened: Awaited<ReturnType<typeof openMeshCoreTransport>> | undefined;
        try {
          opened = await openMeshCoreTransport('serial', {
            portSignature: lastSerialPortId,
          });
          await attachRfSession(opened.driverIdentityId, 'serial');
          meshcoreConnectionParamsRef.current = {
            rfType: 'serial',
            serialPortId: lastSerialPortId ?? localStorage.getItem(LAST_SERIAL_PORT_KEY),
          };
          meshcoreReconnectAttemptRef.current = 0;
          meshcoreIsReconnectingRef.current = false;
        } catch (err) {
          const isSetupAbort =
            err instanceof DOMException &&
            err.name === 'AbortError' &&
            err.message === MESHCORE_SETUP_ABORT_MESSAGE;
          if (!isSetupAbort) {
            console.error(
              '[useMeshcoreRuntime] connectAutomatic serial error',
              serializeErrorLike(err) || err,
            );
          }
          await handleRfConnectFailure('serial', opened?.driverIdentityId);
          throw err;
        }
      } else if (type === 'http') {
        let addr = httpAddress;
        if (!addr?.trim()) {
          try {
            const raw = localStorage.getItem('mesh-client:lastConnection:meshcore');
            const parsed = raw
              ? (JSON.parse(raw) as { type?: string; httpAddress?: string })
              : null;
            if (
              parsed?.type === 'http' &&
              typeof parsed.httpAddress === 'string' &&
              parsed.httpAddress.trim()
            ) {
              addr = parsed.httpAddress;
            }
          } catch {
            // catch-no-log-ok corrupt lastConnection JSON
          }
        }
        await connect('tcp', addr);
      }
      // BLE: requires user gesture — not supported for auto-connect
    },
    [prepareRfConnect, attachRfSession, handleRfConnectFailure, connect],
  );

  const disconnect = useCallback(async () => {
    meshcoreConnectionParamsRef.current = null;
    meshcoreIsReconnectingRef.current = false;
    meshcoreReconnectAttemptRef.current = 0;
    meshcoreReconnectGenerationRef.current += 1;
    await finalizeDriverDisconnect({ disconnectDriver: true });
  }, [finalizeDriverDisconnect]);

  const sendMessage = useCallback(
    async (text: string, channelIdx: number, destNodeId?: number, replyId?: number) => {
      if (destNodeId !== undefined) {
        if (!connRef.current) {
          throw new Error('Not connected to device');
        }
        const pubKey = pubKeyMapRef.current.get(destNodeId);
        if (!pubKey) {
          throw new Error(
            'Cannot send DM: no encryption key for this contact. Wait for a full contact exchange, refresh contacts, or remove name-only stubs.',
          );
        }
        const sentAt = Date.now();
        let textToSend = text;
        let replyField: number | undefined;
        if (replyId != null && text.trim()) {
          const parent = findMeshcoreDmReplyParent(messagesRef.current, {
            peerNodeId: destNodeId,
            myNodeId: myNodeNumRef.current,
            replyKey: replyId,
          });
          if (parent) {
            textToSend = `${formatMeshcoreWireReplyPrefix(parent.sender_name, replyId)} ${text}`;
            replyField = replyId;
          }
        }
        // Optimistically add own message with 'sending' status (DM uses channel -1, not UI sendChannel)
        const tempMsg: ChatMessage = {
          sender_id: myNodeNumRef.current,
          sender_name: selfInfo?.name ?? 'Me',
          payload: text,
          channel: -1,
          timestamp: sentAt,
          status: 'sending',
          to: destNodeId,
          replyId: replyField,
        };
        setMessages((prev) =>
          trimChatMessagesToMax([...prev, tempMsg], MAX_IN_MEMORY_CHAT_MESSAGES),
        );

        // Calculate dynamic timeout based on hop count for multi-hop paths
        const destNode = nodesRef.current.get(destNodeId);
        const hopsAway = destNode?.hops_away ?? 0;
        const hopBasedTimeoutMs = 3000 + hopsAway * 2500; // 3s base + 2.5s per hop

        try {
          const result = await connRef.current.sendTextMessage(pubKey, textToSend);
          void fetchAndUpdateLocalStats().catch((e: unknown) => {
            console.warn(
              '[useMeshcoreRuntime] fetchAndUpdateLocalStats (DM send) error ' +
                errLikeToLogString(e),
            );
          });
          const ackCrc = result?.expectedAckCrc;
          // Use max of: firmware estimate, hop-based calculation, minimum floor
          const estTimeout = Math.max(
            result?.estTimeout ?? 30_000,
            hopBasedTimeoutMs,
            MESHCORE_DM_ACK_TIMEOUT_MIN_MS,
          );

          if (ackCrc !== undefined) {
            const ackKey = meshcoreDmAckKeyU32(ackCrc);
            const pendingMapKeys = meshcorePendingDmAckMapKeys(ackCrc);
            // Update the temp message with the real packetId
            setMessages((prev) =>
              prev.map((m) =>
                m === tempMsg || (m.timestamp === sentAt && m.status === 'sending')
                  ? { ...m, sender_id: myNodeNumRef.current, packetId: ackKey }
                  : m,
              ),
            );
            // Persist the outgoing DM with packet_id for status tracking
            void window.electronAPI.db
              .saveMeshcoreMessage({
                sender_id: myNodeNumRef.current || null,
                sender_name: selfInfo?.name ?? 'Me',
                payload: text,
                channel_idx: -1,
                timestamp: sentAt,
                status: 'sending',
                packet_id: ackKey,
                reply_id: replyField ?? null,
                to_node: destNodeId,
              })
              .catch((e: unknown) => {
                console.warn(
                  '[useMeshcoreRuntime] saveMeshcoreMessage (outgoing) error ' +
                    errLikeToLogString(e),
                );
              });

            // Capture outbound path for delivery outcome attribution
            const outPathRaw = outPathMapRef.current.get(destNodeId);
            const sendPathBytes = outPathRaw && outPathRaw.length > 0 ? Array.from(outPathRaw) : [];
            const sendPathHash = sendPathBytes.length > 0 ? computePathHash(sendPathBytes) : '';
            if (sendPathBytes.length > 0) {
              usePathHistoryStore
                .getState()
                .recordPathUpdated(destNodeId, sendPathBytes, hopsAway, false);
            }

            // Schedule failure timeout
            const timeoutId = setTimeout(() => {
              for (const k of pendingMapKeys) {
                pendingAcksRef.current.delete(k);
              }
              if (sendPathHash) {
                usePathHistoryStore.getState().recordOutcome(destNodeId, sendPathHash, false);
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.packetId != null &&
                  meshcoreDmAckKeyU32(m.packetId) === ackKey &&
                  m.status === 'sending'
                    ? { ...m, status: 'failed' as const }
                    : m,
                ),
              );
              void window.electronAPI.db
                .updateMeshcoreMessageStatus(ackKey, 'failed')
                .catch((e: unknown) => {
                  console.warn(
                    '[useMeshcoreRuntime] updateMeshcoreMessageStatus (timeout) error ' +
                      errLikeToLogString(e),
                  );
                });
            }, estTimeout);
            const pendingEntry: PendingDmAckEntry = {
              timeoutId,
              mapKeys: pendingMapKeys,
              canonicalPacketIdU32: ackKey,
              destNodeId,
              pathHash: sendPathHash,
            };
            for (const k of pendingMapKeys) {
              pendingAcksRef.current.set(k, pendingEntry);
            }
          } else {
            // No ackCrc — mark as acked immediately
            setMessages((prev) =>
              prev.map((m) =>
                m === tempMsg || (m.timestamp === sentAt && m.status === 'sending')
                  ? { ...m, sender_id: myNodeNumRef.current, status: 'acked' as const }
                  : m,
              ),
            );
            void window.electronAPI.db
              .saveMeshcoreMessage({
                sender_id: myNodeNumRef.current || null,
                sender_name: selfInfo?.name ?? 'Me',
                payload: text,
                channel_idx: -1,
                timestamp: sentAt,
                status: 'acked',
                reply_id: replyField ?? null,
                to_node: destNodeId,
              })
              .catch((e: unknown) => {
                console.warn(
                  '[useMeshcoreRuntime] saveMeshcoreMessage (outgoing-no-ack) error ' +
                    errLikeToLogString(e),
                );
              });
          }
        } catch (e) {
          console.warn('[useMeshcoreRuntime] sendTextMessage error ' + errLikeToLogString(e));
          setMessages((prev) =>
            prev.map((m) =>
              m === tempMsg || (m.timestamp === sentAt && m.status === 'sending')
                ? { ...m, status: 'failed' as const }
                : m,
            ),
          );
        }
      } else {
        const sentAt = Date.now();
        let textToSend = text;
        let replyField: number | undefined;
        if (replyId != null && text.trim()) {
          const parent = messagesRef.current.find(
            (m) =>
              !m.to &&
              m.channel === channelIdx &&
              (m.packetId === replyId || m.timestamp === replyId) &&
              !(m.emoji != null && m.replyId != null),
          );
          if (parent) {
            const parentKey = parent.packetId ?? parent.timestamp;
            textToSend = `${formatMeshcoreWireReplyPrefix(parent.sender_name, parentKey)} ${text}`;
            replyField = replyId;
          }
        }
        try {
          const channelConn = connRef.current;
          if (channelConn) {
            await channelConn.sendChannelTextMessage(channelIdx, textToSend);
            void fetchAndUpdateLocalStats().catch((e: unknown) => {
              console.warn(
                '[useMeshcoreRuntime] fetchAndUpdateLocalStats (channel send) error ' +
                  errLikeToLogString(e),
              );
            });
            addMessage({
              sender_id: myNodeNumRef.current,
              sender_name: selfInfo?.name ?? 'Me',
              payload: text,
              channel: channelIdx,
              timestamp: sentAt,
              status: 'acked',
              replyId: replyField,
            });
            if (mqttStatusRef.current === 'connected') {
              void window.electronAPI.mqtt
                .publishMeshcorePacketLog({
                  origin: selfInfo?.name ?? 'mesh-client',
                  snr: 0,
                  rssi: 0,
                  direction: 'tx',
                })
                .catch((e: unknown) => {
                  console.warn(
                    '[useMeshcoreRuntime] publishMeshcorePacketLog (sent via RF) error ' +
                      errLikeToLogString(e),
                  );
                });
            }
          } else if (mqttStatusRef.current === 'connected') {
            await window.electronAPI.mqtt.publishMeshcore({
              text: textToSend,
              channelIdx,
              senderNodeId: myNodeNumRef.current || undefined,
              senderName: selfInfo?.name,
              timestamp: sentAt,
            });
            addMessage({
              sender_id: myNodeNumRef.current,
              sender_name: selfInfo?.name ?? 'Me',
              payload: text,
              channel: channelIdx,
              timestamp: sentAt,
              status: 'acked',
              receivedVia: 'mqtt',
              replyId: replyField,
            });
          } else {
            throw new Error('Not connected — connect radio or MQTT to send channel messages');
          }
        } catch (e) {
          console.warn(
            '[useMeshcoreRuntime] sendChannelTextMessage / publishMeshcore error ' +
              errLikeToLogString(e),
          );
          throw e;
        }
      }
    },
    [addMessage, selfInfo, fetchAndUpdateLocalStats],
  );

  const refreshContacts = useCallback(async () => {
    if (!connRef.current) return;
    try {
      // Mark all existing contacts as not on radio before refreshing
      await window.electronAPI.db.markAllMeshcoreContactsOffRadio();

      const contactsRaw = await connRef.current.getContacts();
      const contacts = contactsRaw.map(meshcoreContactRawFromDevice);
      setMeshcoreContactsForTelemetry(contacts);
      const previousNodesBaseline = meshcorePreviousNodesBaselineForBuild();
      const newNodes = await buildNodesFromContacts(contacts, {
        self: selfInfo,
        myNodeId: myNodeNumRef.current,
        previousNodes: previousNodesBaseline,
        contactsFromRadio: true,
        deferDbMerge: true,
        deferPathHistory: true,
      });
      applyMeshcoreNodesToUi(newNodes);
      const identityId = meshcoreIdentityIdRef.current;
      if (identityId) {
        repairMeshcoreChannelSenderIdsInStore(identityId);
      }
      await deferMeshcoreDbContactMerge(newNodes, previousNodesBaseline);

      // Warn if approaching contact limit
      if (contacts.length > MESHCORE_CONTACTS_WARNING_THRESHOLD) {
        console.warn(
          `[useMeshcoreRuntime] refreshContacts: radio contacts near limit (${contacts.length}/${MESHCORE_MAX_CONTACTS})`,
        );
      }
    } catch (e) {
      console.error('[useMeshcoreRuntime] refreshContacts error ' + errLikeToLogString(e));
    }
  }, [
    buildNodesFromContacts,
    meshcorePreviousNodesBaselineForBuild,
    selfInfo,
    applyMeshcoreNodesToUi,
    deferMeshcoreDbContactMerge,
  ]);

  const sendAdvert = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) {
      throw new Error('Not connected to radio');
    }
    try {
      await withTimeout(
        conn.sendFloodAdvert(),
        MESHCORE_SEND_FLOOD_ADVERT_TIMEOUT_MS,
        'MeshCore send flood advert',
      );
    } catch (e: unknown) {
      if (e == null || (e instanceof Error && e.message === '')) {
        console.warn('[useMeshcoreRuntime] sendAdvert: empty rejection from radio');
        throw new Error('MeshCore advert rejected by radio');
      }
      throw e;
    }
  }, []);

  const sendZeroHopAdvert = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) {
      throw new Error('Not connected to radio');
    }
    try {
      await withTimeout(
        conn.sendZeroHopAdvert(),
        MESHCORE_SEND_FLOOD_ADVERT_TIMEOUT_MS,
        'MeshCore send zero-hop advert',
      );
    } catch (e: unknown) {
      if (e == null || (e instanceof Error && e.message === '')) {
        console.warn('[useMeshcoreRuntime] sendZeroHopAdvert: empty rejection from radio');
        throw new Error('MeshCore zero-hop advert rejected by radio');
      }
      throw e;
    }
  }, []);

  const applyMeshcoreFloodScopeHashtag = useCallback(async (hashtag: string) => {
    const conn = connRef.current;
    if (!conn) throw new Error('Not connected to radio');
    await applyMeshcoreFloodScope(conn, hashtag);
  }, []);

  const syncClock = useCallback(async () => {
    if (!connRef.current) return;
    await connRef.current.syncDeviceTime();
  }, []);

  const reboot = useCallback(async () => {
    if (!connRef.current) return;
    try {
      await connRef.current.reboot();
    } catch (e) {
      console.warn('[useMeshcoreRuntime] reboot error ' + errLikeToLogString(e));
    }
    await disconnect();
  }, [disconnect]);

  const deleteNode = useCallback(async (nodeId: number) => {
    let pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey) {
      const dbContacts =
        (await window.electronAPI.db.getMeshcoreContacts()) as MeshcoreContactDbRow[];
      const dbRow = dbContacts.find((c) => c.node_id === nodeId);
      if (dbRow) {
        const hex = dbRow.public_key.replace(/\s/g, '');
        const pairs = hex.match(/.{2}/g);
        if (pairs) {
          pubKey = new Uint8Array(pairs.map((b) => parseInt(b, 16)));
        }
      }
    }
    if (pubKey && connRef.current) {
      try {
        await connRef.current.removeContact(pubKey);
      } catch (e) {
        console.warn('[useMeshcoreRuntime] removeContact error ' + errLikeToLogString(e));
      }
    } else if (meshcoreIsChatStubNodeId(nodeId)) {
      // stub node: skip radio removal
    } else {
      // no pubKey: skip radio removal
    }
    pubKeyMapRef.current.delete(nodeId);
    // Remove the 6-byte prefix mapping too
    for (const [prefix, id] of pubKeyPrefixMapRef.current) {
      if (id === nodeId) {
        pubKeyPrefixMapRef.current.delete(prefix);
        break;
      }
    }
    setNodes((prev) => {
      const next = new Map(prev);
      next.delete(nodeId);
      return next;
    });
    await window.electronAPI.db.deleteMeshcoreContact(nodeId).catch((e: unknown) => {
      console.warn('[useMeshcoreRuntime] deleteMeshcoreContact error ' + errLikeToLogString(e));
    });
  }, []);

  const clearRawPackets = useCallback(() => {
    setRawPackets([]);
  }, []);

  const clearAllRepeaters = useCallback(async () => {
    setNodes((prev) => {
      const next = new Map(prev);
      for (const [id, node] of prev) {
        if (node.hw_model === 'Repeater') next.delete(id);
      }
      return next;
    });
    await window.electronAPI.db.clearMeshcoreRepeaters().catch((e: unknown) => {
      console.warn('[useMeshcoreRuntime] clearMeshcoreRepeaters error ' + errLikeToLogString(e));
    });
  }, []);

  const clearAllMeshcoreContacts = useCallback(async () => {
    const conn = connRef.current;
    const myId = myNodeNumRef.current;
    if (conn && myId !== 0) {
      try {
        const raw = await conn.getContacts();
        for (const c of raw) {
          const id = pubkeyToNodeId(c.publicKey);
          if (id === myId) continue;
          await conn.removeContact(c.publicKey).catch((e: unknown) => {
            console.warn(
              '[useMeshcoreRuntime] clearAllMeshcoreContacts removeContact error ' +
                errLikeToLogString(e),
            );
          });
        }
      } catch (e: unknown) {
        console.warn(
          '[useMeshcoreRuntime] clearAllMeshcoreContacts getContacts error ' +
            errLikeToLogString(e),
        );
      }
    }
    try {
      await window.electronAPI.db.clearMeshcoreContacts();
    } catch (e: unknown) {
      console.warn('[useMeshcoreRuntime] clearMeshcoreContacts DB error ' + errLikeToLogString(e));
      throw e instanceof Error ? e : new Error(String(e));
    }
    setMeshcoreContactsForTelemetry([]);
    setNodes((prev) => {
      const self = prev.get(myId);
      if (myId === 0) return new Map();
      const next = new Map<number, MeshNode>();
      if (self) next.set(myId, self);
      return next;
    });
    const pk = pubKeyMapRef.current.get(myId);
    pubKeyMapRef.current.clear();
    pubKeyPrefixMapRef.current.clear();
    outPathMapRef.current.clear();
    if (pk && myId !== 0) {
      pubKeyMapRef.current.set(myId, pk);
      const prefix = Array.from(pk.slice(0, 6))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      pubKeyPrefixMapRef.current.set(prefix, myId);
    }
  }, []);

  const offloadContactsFromRadio = useCallback(
    async (options?: MeshcoreOffloadFromRadioOptions): Promise<number> => {
      const { signal, onProgress } = options ?? {};
      const conn = connRef.current;
      if (!conn) {
        throw new Error('Not connected to radio');
      }
      const myId = myNodeNumRef.current;
      const raw = await conn.getContacts();
      throwIfMeshcoreOffloadAborted(signal);
      const contacts = raw.map(meshcoreContactRawFromDevice);
      const now = new Date().toISOString();
      const pendingDbRows: ReturnType<typeof contactToDbRow>[] = [];
      for (const contact of contacts) {
        const id = pubkeyToNodeId(contact.publicKey);
        if (id === myId) continue;
        const prevHops = nodesRef.current.get(id)?.hops_away;
        const base = meshcoreContactToMeshNode(contact);
        const mergedHops = meshcoreMergeContactHopsAwayFromPrevious(base.hops_away, prevHops, 0);
        pendingDbRows.push(
          contactToDbRow(contact, nicknameMapRef.current.get(id) ?? null, 1, now, mergedHops),
        );
      }
      const toRemove = pendingDbRows.length;
      onProgress?.({ phase: 'saving', current: 0, total: toRemove });
      if (pendingDbRows.length > 0) {
        try {
          await window.electronAPI.db.saveMeshcoreContactsBatch(pendingDbRows);
        } catch (e: unknown) {
          console.warn(
            '[useMeshcoreRuntime] offloadContactsFromRadio saveMeshcoreContactsBatch error ' +
              errLikeToLogString(e),
          );
          throw e;
        }
      }
      throwIfMeshcoreOffloadAborted(signal);
      let removed = 0;
      for (const c of raw) {
        const id = pubkeyToNodeId(c.publicKey);
        if (id === myId) continue;
        throwIfMeshcoreOffloadAborted(signal, removed);
        try {
          await conn.removeContact(c.publicKey);
          removed += 1;
          onProgress?.({ phase: 'removing', current: removed, total: toRemove });
        } catch (e: unknown) {
          if (isMeshcoreOffloadAbortError(e)) {
            throw e;
          }
          console.warn(
            '[useMeshcoreRuntime] offloadContactsFromRadio removeContact error ' +
              errLikeToLogString(e),
          );
        }
      }
      return removed;
    },
    [],
  );

  const setOwner = useCallback(
    async (owner: { longName: string; shortName: string; isLicensed: boolean }) => {
      if (!connRef.current) {
        console.warn('[useMeshcoreRuntime] setOwner: connRef.current is null, aborting');
        return;
      }
      try {
        await connRef.current.setAdvertName(owner.longName);
      } catch (e) {
        console.error('[useMeshcoreRuntime] setAdvertName threw: ' + errLikeToLogString(e));
        throw e;
      }
      setSelfInfo((prev) => (prev ? { ...prev, name: owner.longName } : prev));
    },
    [],
  );

  const setRadioParams = useCallback(
    async (p: { freq: number; bw: number; sf: number; cr: number; txPower: number }) => {
      if (!connRef.current) {
        console.warn('[useMeshcoreRuntime] setRadioParams: connRef.current is null, aborting');
        return;
      }
      try {
        // MeshCore protocol: freq as UInt32 in kHz (910525 = 910.525 MHz), bw in Hz.
        const freqKhz = Math.round(p.freq / 1000);
        await connRef.current.setRadioParams(freqKhz, p.bw, p.sf, p.cr);
      } catch (e) {
        console.error('[useMeshcoreRuntime] setRadioParams threw: ' + errLikeToLogString(e));
        throw normalizeMeshCoreError(
          e,
          'Failed to apply radio settings. The device may not support changing radio parameters over this connection.',
        );
      }
      try {
        await connRef.current.setTxPower(p.txPower);
      } catch (e) {
        console.error('[useMeshcoreRuntime] setTxPower threw: ' + errLikeToLogString(e));
        throw normalizeMeshCoreError(
          e,
          'Failed to set TX power. The device may not support changing it over this connection.',
        );
      }
      setSelfInfo((prev) =>
        prev
          ? {
              ...prev,
              radioFreq: p.freq,
              radioBw: p.bw,
              radioSf: p.sf,
              radioCr: p.cr,
              txPower: p.txPower,
            }
          : prev,
      );
    },
    [],
  );

  const sendPositionToDeviceMeshCore = useCallback(
    async (lat: number, lon: number) => {
      if (!connRef.current) return;
      const latInt = Math.round(lat * MESHCORE_COORD_SCALE);
      const lonInt = Math.round(lon * MESHCORE_COORD_SCALE);
      try {
        await connRef.current.setAdvertLatLong(latInt, lonInt);
        const selfNodeId = myNodeNumRef.current;
        const nowSec = Math.floor(Date.now() / 1000);
        setOurPosition({ lat, lon, source: 'static' });
        try {
          const existing =
            parseStoredJson<Record<string, unknown>>(
              localStorage.getItem('mesh-client:gpsSettings'),
              'useMeshcoreRuntime sendPositionToDeviceMeshCore persist static',
            ) ?? {};
          const refreshInterval =
            typeof existing.refreshInterval === 'number' ? existing.refreshInterval : 0;
          localStorage.setItem(
            'mesh-client:gpsSettings',
            JSON.stringify({ ...existing, staticLat: lat, staticLon: lon, refreshInterval }),
          );
        } catch {
          // catch-no-log-ok localStorage quota or private mode
        }
        if (selfNodeId > 0) {
          setNodes((prev) => {
            const next = new Map(prev);
            const existing = next.get(selfNodeId);
            if (existing) {
              next.set(selfNodeId, {
                ...existing,
                latitude: lat,
                longitude: lon,
                last_heard: nowSec,
              });
            } else {
              const trimmedName = selfInfo?.name?.trim() ?? '';
              next.set(selfNodeId, {
                node_id: selfNodeId,
                long_name: trimmedName || `Node-${selfNodeId.toString(16).toUpperCase()}`,
                short_name: '',
                hw_model: CONTACT_TYPE_LABELS[selfInfo?.type ?? 0] ?? 'Unknown',
                battery: 0,
                snr: 0,
                rssi: 0,
                last_heard: nowSec,
                latitude: lat,
                longitude: lon,
              });
            }
            return next;
          });
        }
      } catch (e) {
        console.error(
          `[useMeshcoreRuntime] setAdvertLatLong failed ${formatStructuredLogDetail({
            lat,
            lon,
            latInt,
            lonInt,
            err: e instanceof Error ? e.message : String(e),
          })}`,
        );
        throw normalizeMeshCoreError(
          e,
          'Device rejected position update — check that the device supports setting coordinates',
        );
      }
    },
    [selfInfo?.name, selfInfo?.type],
  );

  /** Successful Status/Ping prove reachability; sync `last_heard` when firmware `lastAdvert` is stale. */
  const bumpMeshcoreNodeLastHeardFromRpc = useCallback(
    (nodeId: number) => {
      const existing = nodesRef.current.get(nodeId);
      if (!existing) return;
      const nowSec = Math.floor(Date.now() / 1000);
      const lat = existing.latitude ?? null;
      const lon = existing.longitude ?? null;
      const storeId = resolveMeshcoreStoreIdentityId();
      if (storeId) {
        patchMeshcoreNodeLastHeardAt(storeId, nodeId, nowSec);
      }
      setNodes((prev) => {
        const cur = prev.get(nodeId);
        if (!cur) return prev;
        const next = new Map(prev);
        next.set(nodeId, { ...cur, last_heard: nowSec });
        return next;
      });
      void window.electronAPI.db
        .updateMeshcoreContactAdvert(nodeId, nowSec, lat, lon)
        .catch((e: unknown) => {
          console.warn(
            '[useMeshcoreRuntime] updateMeshcoreContactAdvert (RPC bump) error ' +
              errLikeToLogString(e),
          );
        });
    },
    [resolveMeshcoreStoreIdentityId],
  );

  /**
   * MeshCore: always allow Ping/trace in the UI. Pre-gating on PathUpdated/path history caused false
   * “path not synced” when the radio had not yet reported 129; traceRoute resolves routes and sets
   * meshcorePingErrors when the path is still unavailable.
   */
  const meshcoreCanPingTrace = useCallback(() => true, []);

  const ensureNodePubKey = useCallback(async (nodeId: number): Promise<Uint8Array | null> => {
    const storeId = meshcoreIdentityIdRef.current ?? getIdentityIdForProtocol('meshcore') ?? null;
    const storeRecord = storeId ? useNodeStore.getState().nodes[storeId]?.[nodeId] : undefined;
    const pubKey = await resolveMeshcoreNodePubKey(
      nodeId,
      pubKeyMapRef.current,
      storeRecord?.publicKey,
    );
    if (pubKey) {
      pubKeyMapRef.current.set(nodeId, pubKey);
      registerMeshcorePubKey(nodeId, pubKey);
    }
    return pubKey;
  }, []);

  const traceRoute = useCallback(
    async (nodeId: number) => {
      const pubKey = await ensureNodePubKey(nodeId);
      if (!pubKey) {
        clearMeshcorePingNoRouteExpiryTimer(nodeId);
        setMeshcorePingErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, 'Node not found (no encryption key)');
          return next;
        });
        return;
      }
      if (!connRef.current) {
        clearMeshcorePingNoRouteExpiryTimer(nodeId);
        setMeshcorePingErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, 'Not connected to device');
          return next;
        });
        return;
      }
      clearMeshcorePingNoRouteExpiryTimer(nodeId);
      setMeshcorePingErrors((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });

      let tracePathHash: string | undefined;
      try {
        const conn = connRef.current;
        if (!conn) {
          throw new Error('Not connected to device');
        }
        const hopsAway = nodesRef.current.get(nodeId)?.hops_away;
        let storedPath = outPathMapRef.current.get(nodeId);
        /** `outPathLen` from the matching radio contact when we consult `getContacts` (may diverge from UI `hops_away`). */
        let radioContactPathLen: number | null = null;
        /** Multi-hop trace needs the radio’s route bytes; the single-byte pubkey fallback only works for direct peers. */
        if ((!storedPath || storedPath.length <= 1) && (hopsAway == null || hopsAway >= 1)) {
          try {
            const contactsRaw = await conn.getContacts();
            const contacts = contactsRaw.map(meshcoreContactRawFromDevice);
            for (const contact of contacts) {
              if (pubkeyToNodeId(contact.publicKey) !== nodeId) continue;
              if (typeof contact.outPathLen === 'number' && Number.isFinite(contact.outPathLen)) {
                radioContactPathLen = contact.outPathLen;
              }
              const slice = meshcoreSliceContactOutPathForTrace(
                contact.outPath,
                contact.outPathLen,
              );
              if (slice.length > 0) {
                outPathMapRef.current.set(nodeId, slice);
                storedPath = slice;
              }
              break;
            }
          } catch (e: unknown) {
            console.warn(
              '[useMeshcoreRuntime] traceRoute getContacts refresh failed ' + errLikeToLogString(e),
            );
          }
        }
        if ((!storedPath || storedPath.length <= 1) && (hopsAway == null || hopsAway >= 1)) {
          try {
            const sel = await usePathHistoryStore.getState().ensureBestPathLoaded(nodeId);
            if (sel?.pathBytes?.length !== undefined && sel.pathBytes.length > 1) {
              const fromHist = new Uint8Array(sel.pathBytes);
              outPathMapRef.current.set(nodeId, fromHist);
              storedPath = fromHist;
            }
          } catch {
            // catch-no-log-ok path history optional
          }
        }
        const needsRoutePrime =
          (!storedPath || storedPath.length <= 1) && (hopsAway == null || hopsAway >= 1);
        if (needsRoutePrime) {
          try {
            await withTimeout(
              conn.sendFloodAdvert(),
              MESHCORE_SEND_FLOOD_ADVERT_TIMEOUT_MS,
              'meshcoreTracePrimeFloodAdvert',
            );
          } catch (e: unknown) {
            console.warn(
              '[useMeshcoreRuntime] traceRoute prime: sendFloodAdvert failed ' +
                errLikeToLogString(e),
            );
          }
          await waitForMeshcorePath129ForNode(conn, nodeId, MESHCORE_TRACE_PRIME_WAIT_MS);
          try {
            const contactsRawPrime = await conn.getContacts();
            const contactsPrime = contactsRawPrime.map(meshcoreContactRawFromDevice);
            for (const contact of contactsPrime) {
              if (pubkeyToNodeId(contact.publicKey) !== nodeId) continue;
              if (typeof contact.outPathLen === 'number' && Number.isFinite(contact.outPathLen)) {
                radioContactPathLen = contact.outPathLen;
              }
              const slicePrime = meshcoreSliceContactOutPathForTrace(
                contact.outPath,
                contact.outPathLen,
              );
              if (slicePrime.length > 0) {
                outPathMapRef.current.set(nodeId, slicePrime);
                storedPath = slicePrime;
              }
              break;
            }
          } catch (e: unknown) {
            console.warn(
              '[useMeshcoreRuntime] traceRoute post-prime getContacts failed ' +
                errLikeToLogString(e),
            );
          }
          if (!storedPath || storedPath.length <= 1) {
            try {
              const selPrime = await usePathHistoryStore.getState().ensureBestPathLoaded(nodeId);
              if (selPrime?.pathBytes?.length !== undefined && selPrime.pathBytes.length > 1) {
                const fromHistPrime = new Uint8Array(selPrime.pathBytes);
                outPathMapRef.current.set(nodeId, fromHistPrime);
                storedPath = fromHistPrime;
              }
            } catch {
              // catch-no-log-ok path history optional
            }
          }
        }
        const pathTooShort = !storedPath || storedPath.length <= 1;
        const uiSaysMultiHop = (hopsAway ?? 0) >= 1;
        const radioSaysMultiHop = radioContactPathLen != null && radioContactPathLen >= 1;
        if (pathTooShort && (uiSaysMultiHop || radioSaysMultiHop)) {
          clearMeshcorePingNoRouteExpiryTimer(nodeId);
          setMeshcorePingErrors((prev) => {
            const next = new Map(prev);
            next.set(nodeId, MESHCORE_PING_NO_ROUTE_ERROR_MSG);
            return next;
          });
          const tid = window.setTimeout(() => {
            if (!meshcoreHookMountedRef.current) return;
            setMeshcorePingErrors((prev) => meshcorePingNoRouteErrorExpiryUpdate(prev, nodeId));
            meshcorePingNoRouteExpiryTimersRef.current.delete(nodeId);
          }, MESHCORE_PING_NO_ROUTE_ERROR_DISPLAY_MS);
          meshcorePingNoRouteExpiryTimersRef.current.set(nodeId, tid);
          return;
        }
        let outPath =
          storedPath && storedPath.length > 0 ? storedPath : new Uint8Array([pubKey[0]]);
        if (outPath.length === 1 && outPath[0] === 0 && pubKey[0] !== 0) {
          outPath = new Uint8Array([pubKey[0]]);
        }
        const tracePathBytes = Array.from(outPath);
        tracePathHash = tracePathBytes.length > 0 ? computePathHash(tracePathBytes) : undefined;
        if (tracePathHash) {
          const tracePathHops =
            typeof hopsAway === 'number' && Number.isFinite(hopsAway)
              ? Math.max(0, hopsAway)
              : Math.max(0, tracePathBytes.length - 1);
          usePathHistoryStore
            .getState()
            .recordPathUpdated(nodeId, tracePathBytes, tracePathHops, false);
        }
        let tracePathInUse = outPath;
        let result;
        try {
          result = await withTimeout(
            runMeshcoreTracePathMultiplexed(
              conn as unknown as MeshcoreTracePathMuxConnection,
              tracePathInUse,
              MESHCORE_TRACE_TIMEOUT_MS,
              repeaterRemoteRpcRef.current,
            ),
            MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
            'meshcoreTracePing',
          );
        } catch (firstTraceError: unknown) {
          const directRetryEligible = (hopsAway ?? 0) === 0 && tracePathInUse.length === 1;
          if (!directRetryEligible) throw firstTraceError;
          tracePathInUse = new Uint8Array(pubKey);
          const retryPathBytes = Array.from(tracePathInUse);
          tracePathHash = computePathHash(retryPathBytes);
          usePathHistoryStore.getState().recordPathUpdated(nodeId, retryPathBytes, 0, false);
          result = await withTimeout(
            runMeshcoreTracePathMultiplexed(
              conn as unknown as MeshcoreTracePathMuxConnection,
              tracePathInUse,
              MESHCORE_TRACE_TIMEOUT_MS,
              repeaterRemoteRpcRef.current,
            ),
            MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
            'meshcoreTracePingDirectRetry',
          );
        }
        const traceHops = meshcoreTracePathLenToHops(result.pathLen);
        const convertedSnrs = (result.pathSnrs ?? []).map((s) => s * MESHCORE_RPC_SNR_RAW_TO_DB);
        const convertedLastSnr = result.lastSnr;
        setMeshcoreTraceResults((prev) => {
          const next = new Map(prev);
          next.set(nodeId, {
            pathLen: result.pathLen,
            pathHashes: result.pathHashes ?? [],
            pathSnrs: convertedSnrs,
            lastSnr: convertedLastSnr,
            tag: result.tag,
          });
          meshcoreTraceResultsRef.current = next;
          return next;
        });
        void useDiagnosticsStore
          .getState()
          .saveMeshcoreTraceHistory(
            nodeId,
            result.pathLen,
            convertedSnrs,
            convertedLastSnr,
            result.tag,
          );
        const existingForRf = nodesRef.current.get(nodeId);
        setNodes((prev) => {
          const existing = prev.get(nodeId);
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(nodeId, { ...existing, hops_away: traceHops });
          return next;
        });
        const lastSnrRf =
          typeof convertedLastSnr === 'number' && Number.isFinite(convertedLastSnr)
            ? convertedLastSnr
            : (existingForRf?.snr ?? 0);
        const lastRssiRf =
          typeof existingForRf?.rssi === 'number' && Number.isFinite(existingForRf.rssi)
            ? existingForRf.rssi
            : 0;
        const nowSecTrace = Math.floor(Date.now() / 1000);
        const hopsToSave = typeof traceHops === 'number' ? traceHops : null;
        void window.electronAPI.db
          .updateMeshcoreContactLastRf(nodeId, lastSnrRf, lastRssiRf, hopsToSave, nowSecTrace)
          .catch((e: unknown) => {
            console.warn(
              '[useMeshcoreRuntime] updateMeshcoreContactLastRf (traceRoute) error ' +
                errLikeToLogString(e),
            );
          });
        useRepeaterSignalStore.getState().recordSignal(nodeId, result.lastSnr);
        bumpMeshcoreNodeLastHeardFromRpc(nodeId);
        if (tracePathHash) {
          usePathHistoryStore.getState().recordOutcome(nodeId, tracePathHash, true);
        }
        clearMeshcorePingNoRouteExpiryTimer(nodeId);
        setMeshcorePingErrors((prev) => {
          const next = new Map(prev);
          next.delete(nodeId);
          return next;
        });
      } catch (e: unknown) {
        const rawErr = meshcoreTraceRouteRejectReason(e);
        const errMsg = rawErr && rawErr !== 'undefined' ? rawErr : 'request failed';
        const isTimeout =
          errMsg.toLowerCase().includes('timeout') || errMsg.toLowerCase().includes('timed out');
        let friendlyErr = isTimeout
          ? `Request timed out (up to ~${Math.round(MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS / 1000)}s)`
          : `Failed: ${errMsg}`;
        friendlyErr = meshcoreAppendRepeaterAuthHint(friendlyErr);
        if (tracePathHash) {
          usePathHistoryStore.getState().recordOutcome(nodeId, tracePathHash, false);
        }
        setMeshcorePingErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, friendlyErr);
          return next;
        });
        console.warn('[useMeshcoreRuntime] traceRoute error ' + errLikeToLogString(e));
      }
    },
    [bumpMeshcoreNodeLastHeardFromRpc, clearMeshcorePingNoRouteExpiryTimer, ensureNodePubKey],
  );

  const requestRepeaterStatus = useCallback(
    async (nodeId: number) => {
      const pubKey = await ensureNodePubKey(nodeId);
      if (!pubKey) {
        const msg = 'Node not found (no encryption key)';
        setMeshcoreStatusErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, msg);
          return next;
        });
        throw new Error(msg);
      }
      if (!connRef.current) {
        setMeshcoreStatusErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, 'Not connected to device');
          return next;
        });
        return;
      }
      setMeshcoreStatusErrors((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
      try {
        await repeaterRemoteRpcRef.current(async () => {
          const conn = connRef.current;
          if (!conn) {
            throw new Error('Not connected to device');
          }
          await meshcoreTryRemoteServerLogin(
            conn,
            nodeId,
            pubKey,
            nodesRef.current.get(nodeId)?.hw_model,
          );
          const raw = await conn.getStatus(pubKey, MESHCORE_STATUS_TIMEOUT_MS);
          const lastSnrDb = raw.last_snr * MESHCORE_RPC_SNR_RAW_TO_DB;
          const status: MeshCoreRepeaterStatus = {
            battMilliVolts: raw.batt_milli_volts,
            noiseFloor: raw.noise_floor,
            lastRssi: raw.last_rssi,
            lastSnr: lastSnrDb,
            nPacketsRecv: raw.n_packets_recv,
            nPacketsSent: raw.n_packets_sent,
            totalAirTimeSecs: raw.total_air_time_secs,
            totalUpTimeSecs: raw.total_up_time_secs,
            nSentFlood: raw.n_sent_flood,
            nSentDirect: raw.n_sent_direct,
            nRecvFlood: raw.n_recv_flood,
            nRecvDirect: raw.n_recv_direct,
            errEvents: raw.err_events,
            nDirectDups: raw.n_direct_dups,
            nFloodDups: raw.n_flood_dups,
            currTxQueueLen: raw.curr_tx_queue_len,
          };
          setMeshcoreNodeStatus((prev) => {
            const next = new Map(prev);
            next.set(nodeId, status);
            return next;
          });
          setNodes((prev) => {
            const cur = prev.get(nodeId);
            if (!cur) return prev;
            const next = new Map(prev);
            next.set(nodeId, { ...cur, snr: lastSnrDb, rssi: raw.last_rssi });
            return next;
          });
          useRepeaterSignalStore.getState().recordSignal(nodeId, status.lastSnr);
          bumpMeshcoreNodeLastHeardFromRpc(nodeId);
          if (Number.isFinite(lastSnrDb) && Number.isFinite(raw.last_rssi)) {
            void window.electronAPI.db
              .updateMeshcoreContactLastRf(nodeId, lastSnrDb, raw.last_rssi)
              .catch((e: unknown) => {
                console.warn(
                  '[useMeshcoreRuntime] updateMeshcoreContactLastRf error ' + errLikeToLogString(e),
                );
              });
          }
        });
      } catch (e: unknown) {
        const rawErr = e instanceof Error ? e.message : String(e);
        const errMsg = rawErr && rawErr !== 'undefined' ? rawErr : 'request failed';
        let friendlyErr = errMsg.toLowerCase().includes('timeout')
          ? `Request timed out (~${Math.round(MESHCORE_STATUS_TIMEOUT_MS / 1000)}s)`
          : errMsg.toLowerCase().includes('auth') || errMsg.toLowerCase().includes('login')
            ? 'Authentication failed'
            : `Failed: ${errMsg}`;
        friendlyErr = meshcoreAppendRepeaterAuthHint(friendlyErr);
        setMeshcoreStatusErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, friendlyErr);
          return next;
        });
        console.warn('[useMeshcoreRuntime] requestRepeaterStatus error ' + errLikeToLogString(e));
      }
    },
    [bumpMeshcoreNodeLastHeardFromRpc, ensureNodePubKey],
  );

  const requestTelemetry = useCallback(
    async (nodeId: number) => {
      setMeshcoreTelemetryErrors((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
      const pubKey = await ensureNodePubKey(nodeId);
      if (!pubKey) {
        const msg = 'Node not found (no encryption key)';
        setMeshcoreTelemetryErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, msg);
          return next;
        });
        throw new Error(msg);
      }
      if (!connRef.current) {
        setMeshcoreTelemetryErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, 'Not connected to device');
          return next;
        });
        return;
      }
      try {
        await repeaterRemoteRpcRef.current(async () => {
          const conn = connRef.current;
          if (!conn) {
            throw new Error('Not connected to device');
          }
          await meshcoreTryRemoteServerLogin(
            conn,
            nodeId,
            pubKey,
            nodesRef.current.get(nodeId)?.hw_model,
          );
          const raw = await conn.getTelemetry(pubKey, MESHCORE_TELEMETRY_TIMEOUT_MS);
          let entries: CayenneLppEntry[] = [];
          try {
            entries = CayenneLpp.parse(raw.lppSensorData) as CayenneLppEntry[];
          } catch (parseErr: unknown) {
            console.warn(
              '[useMeshcoreRuntime] requestTelemetry CayenneLpp.parse error ' +
                errLikeToLogString(parseErr),
            );
          }
          const result: MeshCoreNodeTelemetry = { fetchedAt: Date.now(), entries };
          for (const entry of entries) {
            if (entry.type === CayenneLpp.LPP_TEMPERATURE && typeof entry.value === 'number') {
              result.temperature = entry.value;
            } else if (
              entry.type === CayenneLpp.LPP_RELATIVE_HUMIDITY &&
              typeof entry.value === 'number'
            ) {
              result.relativeHumidity = entry.value;
            } else if (
              entry.type === CayenneLpp.LPP_BAROMETRIC_PRESSURE &&
              typeof entry.value === 'number'
            ) {
              result.barometricPressure = entry.value;
            } else if (entry.type === CayenneLpp.LPP_VOLTAGE && typeof entry.value === 'number') {
              result.voltage = entry.value;
            } else if (
              entry.type === CayenneLpp.LPP_GPS &&
              typeof entry.value === 'object' &&
              entry.value !== null
            ) {
              result.gps = entry.value;
            }
          }
          setMeshcoreNodeTelemetry((prev) => {
            const next = new Map(prev);
            next.set(nodeId, result);
            return next;
          });
          setMeshcoreTelemetryErrors((prev) => {
            const next = new Map(prev);
            next.delete(nodeId);
            return next;
          });
          const hasEnv =
            result.temperature != null ||
            result.relativeHumidity != null ||
            result.barometricPressure != null;
          if (hasEnv) {
            const pt: EnvironmentTelemetryPoint = {
              timestamp: result.fetchedAt,
              nodeNum: nodeId,
              temperature: result.temperature,
              relativeHumidity: result.relativeHumidity,
              barometricPressure: result.barometricPressure,
            };
            setEnvironmentTelemetry((prev) => [...prev, pt].slice(-MAX_ENV_TELEMETRY_POINTS));
          }
          const altM = meshcoreTelemetryGpsAltitudeMeters(result.gps);
          if (altM !== undefined) {
            setNodes((prev) => {
              const cur = prev.get(nodeId);
              if (!cur) return prev;
              const next = new Map(prev);
              next.set(nodeId, { ...cur, altitude: altM });
              return next;
            });
          }
        });
      } catch (e: unknown) {
        const rawErr = e instanceof Error ? e.message : String(e);
        const errMsg = rawErr && rawErr !== 'undefined' ? rawErr : 'request failed';
        let friendlyErr = errMsg.toLowerCase().includes('timeout')
          ? `Request timed out (~${Math.round(MESHCORE_TELEMETRY_TIMEOUT_MS / 1000)}s)`
          : errMsg.toLowerCase().includes('auth') || errMsg.toLowerCase().includes('login')
            ? 'Authentication failed'
            : `Failed: ${errMsg}`;
        friendlyErr = meshcoreAppendRepeaterAuthHint(friendlyErr);
        setMeshcoreTelemetryErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, friendlyErr);
          return next;
        });
        console.warn('[useMeshcoreRuntime] requestTelemetry error ' + errLikeToLogString(e));
      }
    },
    [ensureNodePubKey],
  );

  requestTelemetryMeshCoreRef.current = requestTelemetry;

  const requestNeighbors = useCallback(
    async (nodeId: number) => {
      const pubKey = await ensureNodePubKey(nodeId);
      if (!pubKey) {
        const msg = meshcoreAppendRepeaterAuthHint('Node not found (no encryption key)');
        setMeshcoreNeighborErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, msg);
          return next;
        });
        throw new Error(msg);
      }
      if (!connRef.current) {
        const msg = meshcoreAppendRepeaterAuthHint('Not connected to device');
        setMeshcoreNeighborErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, msg);
          return next;
        });
        throw new Error(msg);
      }
      setMeshcoreNeighborErrors((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
      try {
        await repeaterRemoteRpcRef.current(async () => {
          const conn = connRef.current;
          if (!conn) {
            throw new Error('Not connected to device');
          }
          await meshcoreRepeaterTryLogin(conn, pubKey);
          const neighbourPrefixLen = 6;
          const reqBytes = buildMeshcoreGetNeighboursRequest({
            count: 10,
            offset: 0,
            orderBy: 0,
            pubKeyPrefixLength: neighbourPrefixLen,
          });
          const responseData = await conn.sendBinaryRequest(
            pubKey,
            reqBytes,
            MESHCORE_NEIGHBORS_TIMEOUT_MS,
          );
          const raw = parseMeshcoreGetNeighboursResponse(responseData, neighbourPrefixLen);
          const neighbours: MeshCoreNeighborEntry[] = raw.neighbours.map((nb) => {
            const prefixHex = Array.from(nb.publicKeyPrefix)
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
            const resolvedNodeId = pubKeyPrefixMapRef.current.get(prefixHex) ?? 0;
            return {
              publicKeyPrefix: nb.publicKeyPrefix,
              prefixHex,
              resolvedNodeId,
              heardSecondsAgo: nb.heardSecondsAgo,
              snr: nb.snr * MESHCORE_RPC_SNR_RAW_TO_DB,
            };
          });
          const result: MeshCoreNeighborResult = {
            totalNeighboursCount: raw.totalNeighboursCount,
            neighbours,
            fetchedAt: Date.now(),
          };
          setMeshcoreNeighbors((prev) => {
            const next = new Map(prev);
            next.set(nodeId, result);
            return next;
          });
          setMeshcoreNeighborErrors((prev) => {
            const next = new Map(prev);
            next.delete(nodeId);
            return next;
          });
        });
      } catch (e: unknown) {
        const rawErr = e instanceof Error ? e.message : String(e);
        const errMsg = rawErr && rawErr !== 'undefined' ? rawErr : 'request failed';
        let friendlyErr = errMsg.toLowerCase().includes('timeout')
          ? `Request timed out (~${Math.round(MESHCORE_NEIGHBORS_TIMEOUT_MS / 1000)}s)`
          : errMsg.toLowerCase().includes('auth') || errMsg.toLowerCase().includes('login')
            ? 'Authentication failed'
            : `Failed: ${errMsg}`;
        friendlyErr = meshcoreAppendRepeaterAuthHint(friendlyErr);
        setMeshcoreNeighborErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, friendlyErr);
          return next;
        });
        console.warn('[useMeshcoreRuntime] requestNeighbors error ' + errLikeToLogString(e));
        throw new Error(friendlyErr);
      }
    },
    [ensureNodePubKey],
  );

  const sendRepeaterCliCommand = useCallback(
    async (nodeId: number, command: string, useSavedPath = false): Promise<string> => {
      const pubKey = pubKeyMapRef.current.get(nodeId);
      if (!pubKey) {
        setMeshcoreCliErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, 'Node not found (no encryption key)');
          return next;
        });
        throw new Error('Node not found (no encryption key)');
      }
      if (!connRef.current) {
        setMeshcoreCliErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, 'Not connected to device');
          return next;
        });
        throw new Error('Not connected to device');
      }

      setMeshcoreCliErrors((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });

      const service = repeaterCommandServiceRef.current ?? createRepeaterCommandService();
      repeaterCommandServiceRef.current ??= service;

      const path: Uint8Array[] = useSavedPath
        ? (() => {
            const trace = meshcoreTraceResults.get(nodeId);
            const snrs = trace?.pathSnrs;
            if (!trace || !Array.isArray(snrs) || snrs.length === 0) return [];
            return snrs.map(() => pubKey);
          })()
        : [];

      try {
        return await repeaterRemoteRpcRef.current(async () => {
          const conn = connRef.current;
          if (!conn) {
            throw new Error('Not connected to device');
          }
          const { token, promise } = service.registerPendingCommand(command, path);
          const commandWithToken = service.formatCommandWithToken(command, token);

          addCliHistoryEntry(nodeId, {
            type: 'sent',
            text: command,
            timestamp: Date.now(),
          });

          await meshcoreTryRemoteServerLogin(
            conn,
            nodeId,
            pubKey,
            nodesRef.current.get(nodeId)?.hw_model,
          );
          const txtType = 1; // TxtTypes.CliData
          await conn.sendTextMessage(pubKey, commandWithToken, txtType);

          const response = await promise;
          addCliHistoryEntry(nodeId, {
            type: 'received',
            text: response,
            timestamp: Date.now(),
          });
          bumpMeshcoreNodeLastHeardFromRpc(nodeId);
          return response;
        });
      } catch (e: unknown) {
        const rawErr = e instanceof Error ? e.message : String(e);
        const errMsg = rawErr && rawErr !== 'undefined' ? rawErr : 'request failed';
        let friendlyErr = errMsg.toLowerCase().includes('timeout')
          ? `Request timed out`
          : errMsg.toLowerCase().includes('auth') || errMsg.toLowerCase().includes('login')
            ? 'Authentication failed'
            : `Failed: ${errMsg}`;
        friendlyErr = meshcoreAppendRepeaterAuthHint(friendlyErr);
        setMeshcoreCliErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, friendlyErr);
          return next;
        });
        addCliHistoryEntry(nodeId, {
          type: 'received',
          text: `[Error: ${friendlyErr}]`,
          timestamp: Date.now(),
        });
        console.warn('[useMeshcoreRuntime] sendRepeaterCliCommand error ' + errLikeToLogString(e));
        throw new Error(friendlyErr);
      }
    },
    [addCliHistoryEntry, bumpMeshcoreNodeLastHeardFromRpc, meshcoreTraceResults],
  );

  const resolveRoomLoginHopsForNode = useCallback((nodeId: number): number => {
    return resolveMeshcoreRoomLoginHopsAway(
      nodesRef.current.get(nodeId),
      outPathMapRef.current.get(nodeId),
    );
  }, []);

  const resolveRoomLoginStoredPath = useCallback(
    async (
      nodeId: number,
      loginHopsAway: number,
      pubKey: Uint8Array,
      opts?: { schedulerFastPath?: boolean },
    ): Promise<Uint8Array | undefined> => {
      const fromMap = outPathMapRef.current.get(nodeId);
      if (fromMap && fromMap.length > 1) return fromMap;
      let pathFromHistory: Uint8Array | undefined;
      if (loginHopsAway > 0) {
        const best = await usePathHistoryStore.getState().ensureBestPathLoaded(nodeId);
        if (best?.pathBytes?.length && best.pathBytes.length > 1) {
          pathFromHistory = Uint8Array.from(best.pathBytes);
        }
      }
      const conn = connRef.current;
      if (!conn || loginHopsAway <= 0) {
        return fromMap && fromMap.length > 0 ? fromMap : pathFromHistory;
      }
      const schedulerFastPath = opts?.schedulerFastPath === true;
      const resolved = await withTimeout(
        resolveMeshcoreRoomLoginRouteBytes(conn, nodeId, {
          pubKey,
          outPathFromMap: fromMap,
          pathFromHistory,
          loginHopsAway,
          allowPrime: schedulerFastPath ? false : fromMap == null || fromMap.length <= 1,
          skipTrace: schedulerFastPath,
          traceTimeoutMs: schedulerFastPath ? 0 : MESHCORE_TRACE_TIMEOUT_MS,
          runSerialized: (fn) => repeaterRemoteRpcRef.current(fn),
        }),
        schedulerFastPath
          ? MESHCORE_ROOM_SYNC_ROUTE_RESOLVE_FAST_MS
          : MESHCORE_ROOM_LOGIN_ROUTE_RESOLVE_MAX_MS,
        'meshcoreRoomLoginRouteResolve',
      ).catch(() => undefined);
      if (resolved && resolved.length > 0) {
        outPathMapRef.current.set(nodeId, resolved);
      }
      return resolved;
    },
    [],
  );

  const loginRoom = useCallback(
    async (
      nodeId: number,
      password: string,
      opts?: {
        adminPassword?: string;
        guestPassword?: string;
        rememberPassword?: boolean;
        forceRelogin?: boolean;
      },
    ): Promise<void> => {
      let pubKey = pubKeyMapRef.current.get(nodeId);
      if (!pubKey) {
        throw new Error('Room not found (no encryption key)');
      }
      const pubKeyHex = Array.from(pubKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      if (meshcoreIsSyntheticPlaceholderPubKeyHex(pubKeyHex)) {
        throw new Error(
          'Room has no RF encryption key — wait for contact sync or reconnect radio.',
        );
      }
      if (pubkeyToNodeId(pubKey) !== nodeId) {
        try {
          const rows =
            (await window.electronAPI.db.getMeshcoreContacts()) as MeshcoreContactDbRow[];
          const row = rows.find((r) => r.node_id === nodeId);
          if (row) {
            const bytes = meshcoreFullPubKeyBytesFromContactDbHex(row.public_key);
            if (bytes && pubkeyToNodeId(bytes) === nodeId) {
              pubKeyMapRef.current.set(nodeId, bytes);
              pubKey = bytes;
            }
          }
        } catch (e: unknown) {
          console.warn(
            '[useMeshcoreRuntime] loginRoom pubkey reload from DB failed ' + errLikeToLogString(e),
          );
        }
        if (pubkeyToNodeId(pubKey) !== nodeId) {
          throw new Error('Room key out of sync — reconnect or refresh contacts.');
        }
      }
      const conn = connRef.current;
      if (!conn) {
        throw new Error('Not connected to device');
      }
      if (meshcoreIsRoomLoggedIn(nodeId) && !opts?.forceRelogin) {
        return;
      }
      const guestPassword = opts?.guestPassword ?? password;
      const adminPassword = opts?.adminPassword ?? '';
      const hopsAway = resolveRoomLoginHopsForNode(nodeId);
      const uiHops = nodesRef.current.get(nodeId)?.hops_away;
      const outPathLen = outPathMapRef.current.get(nodeId)?.length ?? 0;
      console.debug(
        `[useMeshcoreRuntime] loginRoom node=0x${nodeId.toString(16)} hopsAway=${hopsAway} uiHops=${String(uiHops ?? 'n/a')} outPathLen=${outPathLen}`,
      );
      await withTimeout(
        (async (): Promise<void> => {
          const activeConn = connRef.current;
          if (!activeConn) {
            throw new Error('Not connected to device');
          }
          // Route prime can take 10s+ — do not hold repeaterRemoteRpc (SendLogin) mutex during flood/path wait.
          const storedPath = await resolveRoomLoginStoredPath(nodeId, hopsAway, pubKey);
          if (hopsAway > 0 && (!storedPath || storedPath.length <= 1)) {
            throw new Error(MESHCORE_ROOM_LOGIN_NO_ROUTE_MESSAGE);
          }
          const pathSync = await syncMeshcoreRoomContactPathBeforeLogin(
            activeConn,
            nodeId,
            pubKey,
            nodesRef.current.get(nodeId),
            storedPath,
            hopsAway,
            (fn) => repeaterRemoteRpcRef.current(fn),
          );
          if (hopsAway > 0 && !pathSync.synced) {
            const detail = pathSync.error ? ` (${pathSync.error})` : '';
            throw new Error(
              pathSync.reason === 'no_path'
                ? MESHCORE_ROOM_LOGIN_NO_ROUTE_MESSAGE
                : `${MESHCORE_ROOM_LOGIN_PATH_SYNC_FAILED_MESSAGE}${detail}`,
            );
          }
          console.debug(
            `[useMeshcoreRuntime] loginRoom pathSync node=0x${nodeId.toString(16)} ${JSON.stringify(pathSync)} storedPathLen=${storedPath?.length ?? 0}`,
          );
          await repeaterRemoteRpcRef.current(async () => {
            const rpcConn = connRef.current;
            if (!rpcConn) {
              throw new Error('Not connected to device');
            }
            await meshcoreRoomLogin(rpcConn, nodeId, pubKey, password, {
              adminPassword,
              guestPassword,
              hopsAway,
              companionTransport: meshcoreConnectTypeRef.current,
              forceRelogin: opts?.forceRelogin,
            });
          });
          if (opts?.rememberPassword) {
            await setMeshcoreRoomCredential(nodeId, { guestPassword, adminPassword });
            const syncCfg = getMeshcoreRoomSyncConfig(nodeId);
            await setMeshcoreRoomSyncConfig(nodeId, {
              enabled: syncCfg.enabled,
              intervalMinutes: syncCfg.intervalMinutes,
              autoLoginOnConnect: true,
            });
          }
          clearMeshcoreRoomAutoLoginFailure(nodeId);
        })(),
        MESHCORE_ROOM_LOGIN_TOTAL_TIMEOUT_MS,
        'loginRoom',
      );
    },
    [resolveRoomLoginHopsForNode, resolveRoomLoginStoredPath],
  );

  const cancelRoomLogin = useCallback((nodeId: number): void => {
    meshcoreCancelRoomLogin(nodeId);
  }, []);

  const leaveRoom = useCallback(async (nodeId: number): Promise<void> => {
    let pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey) {
      throw new Error('Room not found (no encryption key)');
    }
    const pubKeyHex = Array.from(pubKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (meshcoreIsSyntheticPlaceholderPubKeyHex(pubKeyHex)) {
      throw new Error('Room has no RF encryption key — wait for contact sync or reconnect radio.');
    }
    if (pubkeyToNodeId(pubKey) !== nodeId) {
      try {
        const rows = (await window.electronAPI.db.getMeshcoreContacts()) as MeshcoreContactDbRow[];
        const row = rows.find((r) => r.node_id === nodeId);
        if (row) {
          const bytes = meshcoreFullPubKeyBytesFromContactDbHex(row.public_key);
          if (bytes && pubkeyToNodeId(bytes) === nodeId) {
            pubKeyMapRef.current.set(nodeId, bytes);
            pubKey = bytes;
          }
        }
      } catch (e: unknown) {
        console.warn(
          '[useMeshcoreRuntime] leaveRoom pubkey reload from DB failed ' + errLikeToLogString(e),
        );
      }
      if (pubkeyToNodeId(pubKey) !== nodeId) {
        throw new Error('Room key out of sync — reconnect or refresh contacts.');
      }
    }
    const conn = connRef.current;
    if (!conn) {
      throw new Error('Not connected to device');
    }
    try {
      await repeaterRemoteRpcRef.current(async () => {
        const activeConn = connRef.current;
        if (!activeConn) {
          throw new Error('Not connected to device');
        }
        await meshcoreRoomLogout(activeConn, nodeId, pubKey, {
          companionTransport: meshcoreConnectTypeRef.current,
        });
      });
    } catch (e: unknown) {
      const friendlyErr = meshcoreRoomLogoutFailureMessage(e);
      console.warn('[useMeshcoreRuntime] leaveRoom failed ' + errLikeToLogString(e));
      throw new Error(friendlyErr);
    }
  }, []);

  const loginRoomWithSaved = useCallback(
    async (nodeId: number): Promise<void> => {
      const cred = getMeshcoreRoomCredential(nodeId);
      if (!cred) {
        throw new Error('No saved room credential');
      }
      const password = meshcoreRoomEffectiveGuestPassword(cred.guestPassword);
      await loginRoom(nodeId, password, {
        guestPassword: password,
        adminPassword: cred.adminPassword ?? '',
      });
    },
    [loginRoom],
  );

  const loginAllSavedRooms = useCallback(
    async (roomNodeIds?: number[]): Promise<void> => {
      if (!connRef.current) {
        throw new Error('Not connected to device');
      }
      const savedIds = new Set(listMeshcoreRoomCredentialNodeIds());
      const fromUi =
        roomNodeIds?.filter((id) => Number.isFinite(id) && id >= 0 && savedIds.has(id)) ?? [];
      const candidateIds =
        fromUi.length > 0
          ? fromUi
          : [...savedIds].filter((id) => nodesRef.current.get(id)?.hw_model === 'Room');
      const nodeIds = candidateIds.filter((id) => !meshcoreIsRoomLoggedIn(id));
      for (const nodeId of nodeIds) {
        const cred = getMeshcoreRoomCredential(nodeId);
        if (!cred) continue;
        const guestPassword = meshcoreRoomEffectiveGuestPassword(cred.guestPassword);
        try {
          await loginRoom(nodeId, guestPassword, {
            guestPassword,
            adminPassword: cred.adminPassword ?? '',
          });
          clearMeshcoreRoomAutoLoginFailure(nodeId);
        } catch (e: unknown) {
          if (!meshcoreIsRoomLoginAbortError(e)) {
            await applyMeshcoreRoomLoginFailure(nodeId, e, 'useMeshcoreRuntime loginAllSavedRooms');
          }
          console.warn(
            '[useMeshcoreRuntime] loginAllSavedRooms failed ' +
              `node=0x${nodeId.toString(16)} ` +
              errLikeToLogString(e),
          );
        }
      }
    },
    [loginRoom],
  );

  const runRoomSyncSchedulerTickBody = useCallback(async (): Promise<void> => {
    const now = Date.now();
    if (now - lastMeshcoreRoomSyncTxAtRef.current < MESHCORE_ROOM_SYNC_MIN_MESH_TX_SPACING_MS) {
      return;
    }

    const roomNodes: RoomSyncSchedulerNode[] = listMeshcoreRoomSyncEnabledNodeIds()
      .filter((id) => nodesRef.current.get(id)?.hw_model === 'Room')
      .map((id) => {
        const cfg = getMeshcoreRoomSyncConfig(id);
        return {
          nodeId: id,
          roomSyncEnabled: cfg.enabled,
          roomSyncIntervalMinutes: cfg.intervalMinutes,
          lastRoomSyncAt: cfg.lastSyncAt,
        };
      });

    const target = pickMostOverdueRoom(roomNodes, now);
    if (!target) return;

    const cred = getMeshcoreRoomCredential(target.nodeId);
    if (!cred) return;

    const pubKey = pubKeyMapRef.current.get(target.nodeId);
    if (!pubKey) return;

    if (meshcoreIsRoomLoggedIn(target.nodeId)) {
      lastMeshcoreRoomSyncTxAtRef.current = Date.now();
      await touchMeshcoreRoomLastSyncAt(target.nodeId, Date.now());
      roomSyncSchedulerWarnedNodesRef.current.delete(target.nodeId);
      return;
    }

    try {
      const password = meshcoreRoomEffectiveGuestPassword(cred.guestPassword);
      const activeConn = connRef.current;
      if (!activeConn) return;
      const syncHops = resolveRoomLoginHopsForNode(target.nodeId);
      const storedPath = await resolveRoomLoginStoredPath(target.nodeId, syncHops, pubKey, {
        schedulerFastPath: true,
      });
      if (syncHops > 0 && (!storedPath || storedPath.length <= 1)) {
        await touchMeshcoreRoomLastSyncAt(target.nodeId, Date.now());
        return;
      }
      const pathSync = await syncMeshcoreRoomContactPathBeforeLogin(
        activeConn,
        target.nodeId,
        pubKey,
        nodesRef.current.get(target.nodeId),
        storedPath,
        syncHops,
        (fn) => repeaterRemoteRpcRef.current(fn),
      );
      if (syncHops > 0 && !pathSync.synced) {
        if (pathSync.reason === 'no_path') {
          await touchMeshcoreRoomLastSyncAt(target.nodeId, Date.now());
          return;
        }
        throw new Error(MESHCORE_ROOM_LOGIN_PATH_SYNC_FAILED_MESSAGE);
      }
      await repeaterRemoteRpcRef.current(async () => {
        const rpcConn = connRef.current;
        if (!rpcConn) return;
        await meshcoreRoomLogin(rpcConn, target.nodeId, pubKey, password, {
          guestPassword: password,
          adminPassword: cred.adminPassword ?? '',
          hopsAway: syncHops,
        });
      });
      lastMeshcoreRoomSyncTxAtRef.current = Date.now();
      await touchMeshcoreRoomLastSyncAt(target.nodeId, Date.now());
      roomSyncSchedulerWarnedNodesRef.current.delete(target.nodeId);
    } catch (e: unknown) {
      if (meshcoreRoomLoginErrorIsNoRoute(e)) {
        await touchMeshcoreRoomLastSyncAt(target.nodeId, Date.now());
        return;
      }
      if (meshcoreRoomLoginErrorIsAuthFailure(e)) {
        await applyMeshcoreRoomLoginFailure(
          target.nodeId,
          e,
          'useMeshcoreRuntime room sync scheduler',
        );
      }
      const logLine =
        '[useMeshcoreRuntime] room sync scheduler login failed ' + errLikeToLogString(e);
      if (roomSyncSchedulerWarnedNodesRef.current.has(target.nodeId)) {
        console.debug(logLine);
      } else {
        roomSyncSchedulerWarnedNodesRef.current.add(target.nodeId);
        console.warn(logLine);
      }
    }
  }, [resolveRoomLoginHopsForNode, resolveRoomLoginStoredPath]);

  const runRoomSyncSchedulerTick = useCallback(async (): Promise<void> => {
    if (!connRef.current || (state.status !== 'configured' && state.status !== 'connected')) {
      return;
    }
    if (roomSyncSchedulerInFlightRef.current) {
      return;
    }
    roomSyncSchedulerInFlightRef.current = true;
    try {
      await runRoomSyncSchedulerTickBody();
    } finally {
      roomSyncSchedulerInFlightRef.current = false;
    }
  }, [state.status, runRoomSyncSchedulerTickBody]);

  const runRoomAutoLoginOnConnect = useCallback(async (): Promise<void> => {
    if (!connRef.current) return;
    const configuredIds = listMeshcoreRoomAutoLoginOnConnectNodeIds();
    const nodeIds = configuredIds.filter((id) => nodesRef.current.get(id)?.hw_model === 'Room');
    const targets = nodeIds.filter((nodeId) => {
      if (meshcoreIsRoomLoggedIn(nodeId)) return false;
      if (!getMeshcoreRoomCredential(nodeId)) return false;
      if (getMeshcoreRoomAutoLoginFailure(nodeId)) return false;
      if (!pubKeyMapRef.current.get(nodeId)) {
        return false;
      }
      return true;
    });
    await Promise.allSettled(
      targets.map(async (nodeId) => {
        try {
          await loginRoomWithSaved(nodeId);
          lastMeshcoreRoomSyncTxAtRef.current = Date.now();
        } catch (e: unknown) {
          if (!meshcoreIsRoomLoginAbortError(e)) {
            await applyMeshcoreRoomLoginFailure(
              nodeId,
              e,
              'useMeshcoreRuntime room auto-login on connect',
            );
          }
          console.warn(
            '[useMeshcoreRuntime] room auto-login on connect failed ' + errLikeToLogString(e),
          );
        }
      }),
    );
  }, [loginRoomWithSaved]);

  const runRoomReconnectSync = useCallback(async (): Promise<void> => {
    if (!connRef.current) return;
    const now = Date.now();
    const roomNodes: RoomSyncSchedulerNode[] = listMeshcoreRoomSyncEnabledNodeIds()
      .filter((id) => nodesRef.current.get(id)?.hw_model === 'Room')
      .map((id) => {
        const cfg = getMeshcoreRoomSyncConfig(id);
        return {
          nodeId: id,
          roomSyncEnabled: cfg.enabled,
          roomSyncIntervalMinutes: cfg.intervalMinutes,
          lastRoomSyncAt: cfg.lastSyncAt,
        };
      });
    const target = pickMostOverdueRoom(roomNodes, now);
    if (!target) return;
    const cred = getMeshcoreRoomCredential(target.nodeId);
    if (!cred) return;
    const pubKey = pubKeyMapRef.current.get(target.nodeId);
    if (!pubKey) return;
    try {
      const password = meshcoreRoomEffectiveGuestPassword(cred.guestPassword);
      const activeConn = connRef.current;
      if (!activeConn) return;
      const syncHops = resolveRoomLoginHopsForNode(target.nodeId);
      const storedPath = await resolveRoomLoginStoredPath(target.nodeId, syncHops, pubKey);
      if (syncHops > 0 && (!storedPath || storedPath.length <= 1)) {
        throw new Error(MESHCORE_ROOM_LOGIN_NO_ROUTE_MESSAGE);
      }
      const pathSync = await syncMeshcoreRoomContactPathBeforeLogin(
        activeConn,
        target.nodeId,
        pubKey,
        nodesRef.current.get(target.nodeId),
        storedPath,
        syncHops,
        (fn) => repeaterRemoteRpcRef.current(fn),
      );
      if (syncHops > 0 && !pathSync.synced) {
        throw new Error(MESHCORE_ROOM_LOGIN_PATH_SYNC_FAILED_MESSAGE);
      }
      await repeaterRemoteRpcRef.current(async () => {
        const rpcConn = connRef.current;
        if (!rpcConn) return;
        await meshcoreRoomLogin(rpcConn, target.nodeId, pubKey, password, {
          guestPassword: password,
          adminPassword: cred.adminPassword ?? '',
          hopsAway: syncHops,
        });
      });
      lastMeshcoreRoomSyncTxAtRef.current = Date.now();
      await touchMeshcoreRoomLastSyncAt(target.nodeId, Date.now());
    } catch (e: unknown) {
      console.debug('[useMeshcoreRuntime] room reconnect sync failed ' + errLikeToLogString(e));
    }
  }, [resolveRoomLoginHopsForNode, resolveRoomLoginStoredPath]);

  meshcoreRoomReconnectSyncRef.current = () => {
    triggerRoomAutoLoginRef.current();
    void runRoomReconnectSync();
  };

  triggerRoomAutoLoginRef.current = () => {
    void runRoomAutoLoginOnConnect();
  };

  useEffect(() => {
    if (state.status !== 'configured') return;
    triggerRoomAutoLoginRef.current();
  }, [state.status, nodes.size]);

  useEffect(() => {
    const operational = state.status === 'configured' || state.status === 'connected';
    if (!operational) {
      if (roomSyncSchedulerRef.current) {
        clearInterval(roomSyncSchedulerRef.current);
        roomSyncSchedulerRef.current = null;
      }
      roomSyncSchedulerWarnedNodesRef.current.clear();
      return;
    }
    if (roomSyncSchedulerRef.current) return;
    roomSyncSchedulerRef.current = setInterval(() => {
      void runRoomSyncSchedulerTick();
    }, MESHCORE_ROOM_SYNC_TICK_MS);
    return () => {
      if (roomSyncSchedulerRef.current) {
        clearInterval(roomSyncSchedulerRef.current);
        roomSyncSchedulerRef.current = null;
      }
    };
  }, [state.status, runRoomSyncSchedulerTick]);

  const sendRoomPost = useCallback(
    async (nodeId: number, text: string): Promise<void> => {
      const pubKey = pubKeyMapRef.current.get(nodeId);
      const conn = connRef.current;
      if (!pubKey) {
        throw new Error('Room not found (no encryption key)');
      }
      if (!conn) {
        throw new Error('Not connected to device');
      }
      if (!meshcoreRoomCanPost(nodeId)) {
        const relogged = await meshcoreRoomTryRelogin(conn, nodeId, pubKey, 'post', {
          hopsAway: resolveRoomLoginHopsForNode(nodeId),
          companionTransport: meshcoreConnectTypeRef.current,
        });
        if (!relogged || !meshcoreRoomCanPost(nodeId)) {
          throw new Error('Room session expired — log in again to post');
        }
      }
      const sentAt = Date.now();
      const tempMsg: ChatMessage = {
        sender_id: myNodeNumRef.current,
        sender_name: selfInfo?.name ?? 'Me',
        payload: text,
        meshcoreDedupeKey: text,
        channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
        timestamp: sentAt,
        status: 'sending',
        roomServerId: nodeId,
        to: nodeId,
      };
      const storeId = meshcoreIdentityIdRef.current;
      const canonicalId = addMessage(tempMsg);
      try {
        const hopsAway = nodesRef.current.get(nodeId)?.hops_away ?? 0;
        console.debug(
          `[useMeshcoreRuntime] sendRoomPost mode=post txtType=${MESHCORE_TXT_TYPE_PLAIN} bodyLen=${new TextEncoder().encode(text).length} room=0x${nodeId.toString(16)} hops=${hopsAway} transport=${meshcoreConnectTypeRef.current ?? 'unknown'}`,
        );
        const session = meshcoreGetRoomSession(nodeId);
        const postOpts = {
          hopsAway,
          companionTransport: meshcoreConnectTypeRef.current,
        };
        const sendOnce = async (): Promise<{ expectedAckCrc?: number; estTimeout?: number }> => {
          const activeConn = connRef.current;
          if (!activeConn) {
            throw new Error('Not connected to device');
          }
          return sendMeshcoreRoomPostWithSentWait(activeConn, pubKey, text, postOpts);
        };
        let result: { expectedAckCrc?: number; estTimeout?: number };
        try {
          result = await repeaterRemoteRpcRef.current(sendOnce);
        } catch (first: unknown) {
          const msg = meshcoreRoomPostSendErrorMessage(first);
          const adminPassword = session?.adminPassword?.trim() ?? '';
          if (
            adminPassword.length > 0 &&
            msg.includes('not logged in on the radio') &&
            connRef.current
          ) {
            console.debug(
              `[useMeshcoreRuntime] sendRoomPost mode=admin-retry txtType=${MESHCORE_TXT_TYPE_PLAIN} bodyLen=${new TextEncoder().encode(text).length} room=0x${nodeId.toString(16)} hops=${hopsAway} transport=${meshcoreConnectTypeRef.current ?? 'unknown'}`,
            );
            await repeaterRemoteRpcRef.current(async () => {
              const activeConn = connRef.current;
              if (!activeConn) return;
              await meshcoreRoomLogin(activeConn, nodeId, pubKey, adminPassword, {
                guestPassword: meshcoreRoomEffectiveGuestPassword(session?.guestPassword ?? ''),
                adminPassword,
                hopsAway,
                companionTransport: meshcoreConnectTypeRef.current,
                forceRelogin: true,
              });
            });
            result = await repeaterRemoteRpcRef.current(sendOnce);
          } else {
            throw first;
          }
        }
        void fetchAndUpdateLocalStats().catch((e: unknown) => {
          console.warn(
            '[useMeshcoreRuntime] fetchAndUpdateLocalStats (room post) error ' +
              errLikeToLogString(e),
          );
        });
        const acked: ChatMessage = {
          ...tempMsg,
          status: 'acked',
          packetId: result?.expectedAckCrc,
        };
        if (storeId) {
          upsertMeshcoreMessageWithDedup(storeId, acked);
          if (canonicalId) {
            updateMessageStatus(storeId, canonicalId, 'acked');
          }
        }
        setMessages((prev) =>
          prev.map((m) =>
            m === tempMsg || (m.timestamp === sentAt && m.status === 'sending') ? acked : m,
          ),
        );
        void window.electronAPI.db
          .saveMeshcoreMessage(messageToDbRow(acked))
          .catch((e: unknown) => {
            console.warn(
              '[useMeshcoreRuntime] saveMeshcoreMessage (room post) error ' + errLikeToLogString(e),
            );
          });
        void setMeshcoreRoomLastPostAt(nodeId, sentAt);
      } catch (e: unknown) {
        const errMsg = meshcoreRoomPostSendErrorMessage(e);
        const failed: ChatMessage = { ...tempMsg, status: 'failed', error: errMsg };
        if (storeId) {
          upsertMeshcoreMessageWithDedup(storeId, failed);
          if (canonicalId) {
            updateMessageStatus(storeId, canonicalId, 'failed', errMsg);
          }
        }
        setMessages((prev) =>
          prev.map((m) =>
            m === tempMsg || (m.timestamp === sentAt && m.status === 'sending') ? failed : m,
          ),
        );
        throw new Error(errMsg);
      }
    },
    [addMessage, fetchAndUpdateLocalStats, resolveRoomLoginHopsForNode, selfInfo?.name],
  );

  const sendRoomAdminCliCommand = useCallback(
    async (nodeId: number, command: string): Promise<string> => {
      const node = nodesRef.current.get(nodeId);
      if (node?.hw_model !== 'Room') {
        return sendRepeaterCliCommand(nodeId, command, false);
      }
      const pubKey = pubKeyMapRef.current.get(nodeId);
      if (!pubKey) {
        throw new Error('Room not found (no encryption key)');
      }
      const conn = connRef.current;
      if (!conn) {
        throw new Error('Not connected to device');
      }
      if (!meshcoreRoomCanAdmin(nodeId)) {
        const relogged = await meshcoreRoomTryRelogin(conn, nodeId, pubKey, 'admin', {
          hopsAway: resolveRoomLoginHopsForNode(nodeId),
          companionTransport: meshcoreConnectTypeRef.current,
        });
        if (!relogged || !meshcoreRoomCanAdmin(nodeId)) {
          throw new Error('Room admin login required');
        }
      }
      return sendRepeaterCliCommand(nodeId, command, false);
    },
    [resolveRoomLoginHopsForNode, sendRepeaterCliCommand],
  );

  const applyMeshcoreTelemetryPrivacyPolicy = useCallback(
    async (modes: {
      telemetryModeBase: number;
      telemetryModeLoc: number;
      telemetryModeEnv: number;
    }) => {
      const conn = connRef.current;
      const s = selfInfoRef.current;
      if (!conn || !s) return;
      const manualByte = s.manualAddContacts ? 1 : 0;
      const frame = buildMeshcoreSetOtherParamsFrame(
        manualByte,
        packMeshcoreTelemetryModesByte(
          modes.telemetryModeBase,
          modes.telemetryModeLoc,
          modes.telemetryModeEnv,
        ),
        s.advertLocPolicy ?? 0,
        s.multiAcks ?? 0,
      );
      await new Promise<void>((resolve, reject) => {
        const onOk = () => {
          conn.off(0, onOk);
          conn.off(1, onErr);
          resolve();
        };
        const onErr = () => {
          conn.off(0, onOk);
          conn.off(1, onErr);
          reject(new Error('MeshCore rejected telemetry privacy settings'));
        };
        conn.once(0, onOk);
        conn.once(1, onErr);
        void conn.sendToRadioFrame(frame).catch((e: unknown) => {
          conn.off(0, onOk);
          conn.off(1, onErr);
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
      setSelfInfo((prev) =>
        prev
          ? {
              ...prev,
              telemetryModeBase: modes.telemetryModeBase,
              telemetryModeLoc: modes.telemetryModeLoc,
              telemetryModeEnv: modes.telemetryModeEnv,
            }
          : prev,
      );
    },
    [],
  );

  const applyMeshcoreContactAutoAdd = useCallback(
    async (params: {
      autoAddAll: boolean;
      overwriteOldest: boolean;
      chat: boolean;
      repeater: boolean;
      roomServer: boolean;
      sensor: boolean;
      maxHopsWire: number;
    }) => {
      const conn = connRef.current;
      if (!conn) throw new Error('Not connected');
      if (params.autoAddAll) {
        await conn.setAutoAddContacts();
        setManualAddContacts(false);
      } else {
        await conn.setManualAddContacts();
        setManualAddContacts(true);
      }
      try {
        localStorage.setItem(MANUAL_CONTACTS_KEY, String(!params.autoAddAll));
      } catch {
        // catch-no-log-ok localStorage quota or private mode — non-critical setting
      }
      setSelfInfo((prev) => (prev ? { ...prev, manualAddContacts: !params.autoAddAll } : prev));

      const configByte = mergeAutoaddConfigByte({
        overwriteOldest: params.overwriteOldest,
        chat: params.chat,
        repeater: params.repeater,
        roomServer: params.roomServer,
        sensor: params.sensor,
      });
      const hops = Math.max(0, Math.min(params.maxHopsWire, 64));
      const frame = buildSetAutoaddConfigFrame(configByte, hops);
      await new Promise<void>((resolve, reject) => {
        const onOk = () => {
          conn.off(0, onOk);
          conn.off(1, onErr);
          resolve();
        };
        const onErr = () => {
          conn.off(0, onOk);
          conn.off(1, onErr);
          reject(new Error('MeshCore rejected contact auto-add settings'));
        };
        conn.once(0, onOk);
        conn.once(1, onErr);
        void conn.sendToRadioFrame(frame).catch((e: unknown) => {
          conn.off(0, onOk);
          conn.off(1, onErr);
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
      setMeshcoreAutoadd({ autoaddConfig: configByte, autoaddMaxHops: hops });
    },
    [],
  );

  const toggleManualAddContacts = useCallback(async (manual: boolean) => {
    if (!connRef.current) return;
    try {
      if (manual) {
        await connRef.current.setManualAddContacts();
      } else {
        await connRef.current.setAutoAddContacts();
      }
      setManualAddContacts(manual);
      setSelfInfo((prev) => (prev ? { ...prev, manualAddContacts: manual } : prev));
      try {
        localStorage.setItem(MANUAL_CONTACTS_KEY, String(manual));
      } catch {
        // catch-no-log-ok localStorage quota or private mode — non-critical setting
      }
    } catch (e) {
      console.warn('[useMeshcoreRuntime] toggleManualAddContacts error ' + errLikeToLogString(e));
    }
  }, []);

  const setMeshcoreChannel = useCallback(async (idx: number, name: string, secret: Uint8Array) => {
    if (!connRef.current) {
      console.warn('[useMeshcoreRuntime] setMeshcoreChannel: no connection');
      return;
    }

    // Validate parameters
    if (!Number.isInteger(idx) || idx < 0 || idx > 39) {
      console.warn('[useMeshcoreRuntime] setMeshcoreChannel: invalid channel index', idx);
      throw new Error(`Invalid channel index: ${idx}. Must be 0-39.`);
    }

    if (typeof name !== 'string' || name.length === 0) {
      console.warn('[useMeshcoreRuntime] setMeshcoreChannel: invalid name', name);
      throw new Error('Channel name must be a non-empty string');
    }

    if (name.length > MESHCORE_CHANNEL_NAME_MAX_LEN) {
      console.warn('[useMeshcoreRuntime] setMeshcoreChannel: name too long', name.length);
      throw new Error(`Channel name must be at most ${MESHCORE_CHANNEL_NAME_MAX_LEN} characters`);
    }

    if (!(secret instanceof Uint8Array) || secret.length === 0) {
      console.warn(
        '[useMeshcoreRuntime] setMeshcoreChannel: invalid secret ' + errLikeToLogString(secret),
      );
      throw new Error('Channel secret must be a non-empty Uint8Array');
    }

    try {
      await withTimeout(connRef.current.setChannel(idx, name, secret), 10_000, 'setChannel');
      setChannels((prev) => {
        const next = prev.filter((c) => c.index !== idx);
        return [...next, { index: idx, name, secret }].sort((a, b) => a.index - b.index);
      });
    } catch (e) {
      const error = normalizeMeshCoreError(e, 'Failed to save channel to device');
      console.warn(
        `[useMeshcoreRuntime] setMeshcoreChannel error ${formatStructuredLogDetail({
          errorMessage: error.message,
          errorType: typeof e,
          idx,
          name,
          secretLength: secret?.length,
        })}`,
      );
      throw error;
    }
  }, []);

  const deleteMeshcoreChannel = useCallback(async (idx: number) => {
    if (!connRef.current) return;
    try {
      await connRef.current.deleteChannel(idx);
      setChannels((prev) => prev.filter((c) => c.index !== idx));
    } catch (e) {
      console.warn('[useMeshcoreRuntime] deleteMeshcoreChannel error ' + errLikeToLogString(e));
    }
  }, []);

  const importContacts = useCallback(async (): Promise<{
    imported: number;
    skipped: number;
    errors: string[];
  }> => {
    const raw = await window.electronAPI.meshcore.openJsonFile();
    if (raw == null) {
      return { imported: 0, skipped: 0, errors: [] };
    }

    let parsed: unknown[];
    try {
      const val = JSON.parse(raw) as unknown;
      // Accept root array or root object with any array-valued key (e.g. { repeaters: [...] })
      if (Array.isArray(val)) {
        parsed = val;
      } else if (val && typeof val === 'object') {
        const arrays = Object.values(val as Record<string, unknown>).filter(Array.isArray);
        if (arrays.length === 0) throw new Error('JSON contains no array of entries');
        parsed = arrays[0] as unknown[];
      } else {
        throw new Error('JSON root must be an array or an object containing an array');
      }
    } catch (e) {
      console.warn('[useMeshcoreRuntime] importContacts: parse error ' + errLikeToLogString(e));
      return { imported: 0, skipped: 0, errors: [e instanceof Error ? e.message : String(e)] };
    }

    function parsePublicKey(rawKey: string): Uint8Array | null {
      const s = rawKey.trim().replace(/-/g, '+').replace(/_/g, '/');
      if (/^[0-9a-fA-F]{64}$/.test(s)) {
        const bytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
        return bytes;
      }
      try {
        const decoded = atob(s);
        if (decoded.length === 32) return Uint8Array.from(decoded, (c) => c.charCodeAt(0));
      } catch {
        // catch-no-log-ok atob decode attempt failed — falls through to return null
      }
      return null;
    }

    let skipped = 0;
    const errors: string[] = [];
    const validEntries: {
      nodeId: number;
      name: string;
      pubKey: Uint8Array;
      latitude: number | null;
      longitude: number | null;
    }[] = [];

    for (const r of parsed) {
      if (!r || typeof r !== 'object') {
        skipped++;
        continue;
      }
      const rec = r as Record<string, unknown>;
      const firstString = (...vals: unknown[]) => {
        for (const v of vals) {
          if (typeof v === 'string' && v.trim()) return v.trim();
        }
        return '';
      };
      const name = firstString(rec.name, rec.label, rec.title, rec.node_name);
      const rawKey = firstString(rec.public_key, rec.pubkey, rec.key, rec.publicKey);
      if (!name || !rawKey) {
        skipped++;
        continue;
      }
      const pubKey = parsePublicKey(rawKey);
      if (!pubKey) {
        console.warn('[useMeshcoreRuntime] importContacts: invalid public key for', name, rawKey);
        errors.push(`Skipped "${name}": invalid public key`);
        skipped++;
        continue;
      }
      const nodeId = pubkeyToNodeId(pubKey);
      const parseCoord = (value: unknown): number | null => {
        if (value == null) return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      };
      const latitude = parseCoord(rec.latitude ?? rec.lat ?? rec.adv_lat ?? rec.advLat);
      const longitude = parseCoord(
        rec.longitude ?? rec.lon ?? rec.lng ?? rec.adv_lon ?? rec.advLon,
      );
      nicknameMapRef.current.set(nodeId, name);
      pubKeyMapRef.current.set(nodeId, pubKey);
      validEntries.push({ nodeId, name, pubKey, latitude, longitude });
    }

    if (validEntries.length > 0) {
      skipMountDbHydrationCommitRef.current = true;
      const importSec = Math.floor(Date.now() / 1000);
      let dbRows: { node_id: number; last_advert: number | null; hops_away: number | null }[] = [];
      try {
        dbRows = (await window.electronAPI.db.getMeshcoreContacts()) as {
          node_id: number;
          last_advert: number | null;
          hops_away: number | null;
        }[];
      } catch (e: unknown) {
        console.warn(
          '[useMeshcoreRuntime] importContacts: getMeshcoreContacts for last_advert merge ' +
            errLikeToLogString(e),
        );
      }
      const dbLastAdvertById = new Map(dbRows.map((r) => [r.node_id, r.last_advert]));
      const dbHopsById = new Map(dbRows.map((r) => [r.node_id, r.hops_away]));
      /** Built inside `setNodes` so we read merged `last_heard` before `nodesRef` catches up. */
      const lastAdvertForDbByNodeId = new Map<number, number>();

      setNodes((prev) => {
        const next = new Map(prev);
        for (const { nodeId, name, pubKey, latitude, longitude } of validEntries) {
          const existing = next.get(nodeId);
          const hasImportGps = latitude != null && longitude != null;
          const existingHasGps = existing?.latitude != null && existing?.longitude != null;
          if (existing) {
            const prevSec = lastHeardToUnixSeconds(existing.last_heard ?? 0);
            next.set(nodeId, {
              ...existing,
              long_name: name,
              short_name: '',
              latitude: hasImportGps && !existingHasGps ? latitude : existing.latitude,
              longitude: hasImportGps && !existingHasGps ? longitude : existing.longitude,
              ...(prevSec <= 0 ? { last_heard: importSec } : {}),
            });
          } else {
            // Create a stub node for pre-loaded repeaters
            const prefix = Array.from(pubKey.slice(0, 6))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
            pubKeyPrefixMapRef.current.set(prefix, nodeId);
            const dbHops = dbHopsById.get(nodeId);
            next.set(nodeId, {
              node_id: nodeId,
              long_name: name,
              short_name: '',
              hw_model: 'Repeater',
              battery: 0,
              snr: 0,
              rssi: 0,
              last_heard: importSec,
              latitude: hasImportGps ? latitude : null,
              longitude: hasImportGps ? longitude : null,
              favorited: false,
              ...(dbHops != null ? { hops_away: dbHops } : {}),
            });
          }
          const rowPrior = dbLastAdvertById.get(nodeId);
          const merged = next.get(nodeId);
          const uiPriorSec = merged != null ? lastHeardToUnixSeconds(merged.last_heard ?? 0) : 0;
          const lastAdvertForDb =
            rowPrior != null && rowPrior > 0 ? rowPrior : uiPriorSec > 0 ? uiPriorSec : importSec;
          lastAdvertForDbByNodeId.set(nodeId, lastAdvertForDb);
        }
        const storeId = meshcoreIdentityIdRef.current;
        if (storeId) {
          syncMeshcoreNodesMapToIdentityStore(storeId, next);
        }
        return next;
      });

      for (const { nodeId, name, pubKey, latitude, longitude } of validEntries) {
        const publicKeyHex = Array.from(pubKey)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const hasImportGps = latitude != null && longitude != null;
        const lastAdvertForDb = lastAdvertForDbByNodeId.get(nodeId) ?? importSec;
        void window.electronAPI.db
          .saveMeshcoreContact({
            node_id: nodeId,
            public_key: publicKeyHex,
            adv_name: null,
            contact_type: 2, // Repeater
            last_advert: lastAdvertForDb,
            adv_lat: hasImportGps ? latitude : null,
            adv_lon: hasImportGps ? longitude : null,
            last_snr: null,
            last_rssi: null,
            nickname: name,
            on_radio: 0,
          })
          .catch((e: unknown) => {
            console.warn(
              '[useMeshcoreRuntime] saveMeshcoreContact (import contacts) error ' +
                errLikeToLogString(e),
            );
          });
      }
    }

    return { imported: validEntries.length, skipped, errors };
  }, []);

  const setNodeFavorited = useCallback(async (nodeId: number, favorited: boolean) => {
    const storeId = meshcoreIdentityIdRef.current ?? getIdentityIdForProtocol('meshcore') ?? null;
    const storeRecord = storeId ? useNodeStore.getState().nodes[storeId]?.[nodeId] : undefined;
    const runtimeNode = nodesRef.current.get(nodeId);
    if (!runtimeNode && !storeRecord) return;

    const prevFav = runtimeNode?.favorited ?? storeRecord?.favorited ?? false;
    if (storeId) {
      patchNodeFavorited(storeId, nodeId, favorited);
    }
    setNodes((prev) => {
      const n = prev.get(nodeId);
      if (!n) return prev;
      const next = new Map(prev);
      next.set(nodeId, { ...n, favorited });
      return next;
    });
    const pk = pubKeyMapRef.current.get(nodeId) ?? storeRecord?.publicKey;
    const hex =
      pk != null
        ? Array.from(pk)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')
        : meshcoreSyntheticPlaceholderPubKeyHex(nodeId);
    try {
      await window.electronAPI.db.updateMeshcoreContactFavorited(nodeId, favorited, hex);
    } catch (e) {
      console.warn(
        '[useMeshcoreRuntime] updateMeshcoreContactFavorited error ' + errLikeToLogString(e),
      );
      if (storeId) {
        patchNodeFavorited(storeId, nodeId, prevFav);
      }
      setNodes((prev) => {
        const n = prev.get(nodeId);
        if (!n) return prev;
        const next = new Map(prev);
        next.set(nodeId, { ...n, favorited: prevFav });
        return next;
      });
    }
  }, []);

  const sendReaction = useCallback(
    async (glyph: string, replyId: number, channel: number) => {
      if (!connRef.current) {
        throw new Error('Not connected to radio');
      }
      const parsed = reactionGlyphFromPicker(glyph);
      if (!parsed) {
        throw new Error('Invalid reaction emoji');
      }
      const storeId = meshcoreIdentityIdRef.current;
      const storeMessages =
        storeId != null
          ? messageRecordsToChatMessages(
              Object.values(useMessageStore.getState().messages[storeId] ?? {}),
            )
          : [];
      const reactedTo =
        storeMessages.find((m) => m.packetId === replyId || m.timestamp === replyId) ??
        messagesRef.current.find((m) => m.packetId === replyId || m.timestamp === replyId);
      const targetName = reactedTo?.sender_name || 'Unknown';
      const replyKey = reactedTo ? (reactedTo.packetId ?? reactedTo.timestamp) : replyId;
      const tapbackText = `${formatMeshcoreWireReplyPrefix(targetName, replyKey)} ${parsed.glyph}`;
      const conn = connRef.current;
      const me = myNodeNumRef.current;

      const publishTapback = (tapbackMsg: ChatMessage) => {
        addMessage(tapbackMsg);
        void window.electronAPI.db
          .saveMeshcoreMessage(messageToDbRow(tapbackMsg))
          .catch((e: unknown) => {
            console.warn(
              '[useMeshcoreRuntime] saveMeshcoreMessage (tapback) error ' + errLikeToLogString(e),
            );
          });
      };

      if (reactedTo?.to != null) {
        const peerNodeId =
          reactedTo.sender_id === me && reactedTo.to != null ? reactedTo.to : reactedTo.sender_id;
        const pubKey = pubKeyMapRef.current.get(peerNodeId);
        if (!pubKey) {
          throw new Error(
            'Cannot send reaction: no encryption key for this contact. Wait for a full contact exchange, refresh contacts, or remove name-only stubs.',
          );
        }
        // Tapbacks are fire-and-forget; no ACK tracking or status UI for reactions
        await conn.sendTextMessage(pubKey, tapbackText);
        const tapbackTs = Date.now();
        const tapbackMsg: ChatMessage = {
          sender_id: me,
          sender_name: selfInfo?.name ?? 'Me',
          payload: parsed.glyph,
          channel: -1,
          timestamp: tapbackTs,
          status: 'acked',
          emoji: parsed.scalar,
          replyId,
          to: peerNodeId,
        };
        publishTapback(tapbackMsg);
      } else {
        const outboundChannel =
          reactedTo != null && typeof reactedTo.channel === 'number' && reactedTo.channel >= 0
            ? reactedTo.channel
            : channel === -1
              ? 0
              : channel;
        // Tapbacks are fire-and-forget; no ACK tracking or status UI for reactions
        await conn.sendChannelTextMessage(outboundChannel, tapbackText);
        publishTapback({
          sender_id: me,
          sender_name: selfInfo?.name ?? 'Me',
          payload: parsed.glyph,
          channel: outboundChannel,
          timestamp: Date.now(),
          status: 'acked',
          emoji: parsed.scalar,
          replyId,
        });
      }
    },
    [addMessage, selfInfo?.name],
  );

  // ─── MeshCore Device Time ────────────────────────────────────────
  const getDeviceTime = useCallback(async (): Promise<number | null> => {
    const conn = connRef.current;
    if (!conn) return null;
    try {
      const result = await conn.getDeviceTime();
      return result?.time ?? null;
    } catch (e: unknown) {
      console.warn('[useMeshcoreRuntime] getDeviceTime error ' + errLikeToLogString(e));
      return null;
    }
  }, []);

  const syncDeviceTime = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      await conn.setDeviceTime(Math.floor(Date.now() / 1000));
    } catch (e: unknown) {
      console.warn('[useMeshcoreRuntime] syncDeviceTime error ' + errLikeToLogString(e));
      throw e;
    }
  }, []);

  // ─── MeshCore Device Query ─────────────────────────────────────
  const getDeviceInfo = useCallback(
    async (appTargetVer?: number): Promise<Record<string, unknown> | null> => {
      const conn = connRef.current;
      if (!conn) return null;
      try {
        const result = await conn.deviceQuery(appTargetVer ?? MESHCORE_DEVICE_QUERY_APP_VER);
        const mm = meshcoreManufacturerModelFromDeviceQuery(result);
        if (mm) {
          setState((prev) => ({ ...prev, manufacturerModel: mm }));
        }
        return result;
      } catch (e: unknown) {
        console.warn('[useMeshcoreRuntime] getDeviceInfo error ' + errLikeToLogString(e));
        return null;
      }
    },
    [],
  );

  // ─── MeshCore Contact Import/Export ───────────────────────────
  const importContact = useCallback(
    async (advertBytes: Uint8Array): Promise<boolean> => {
      const conn = connRef.current;
      if (!conn) return false;
      try {
        await conn.importContact(advertBytes);
        await refreshContacts();
        return true;
      } catch (e: unknown) {
        console.warn('[useMeshcoreRuntime] importContact error ' + errLikeToLogString(e));
        return false;
      }
    },
    [refreshContacts],
  );

  const exportContact = useCallback(
    async (nodeId: number): Promise<Uint8Array | null> => {
      const conn = connRef.current;
      if (!conn) return null;
      const pubKey = await ensureNodePubKey(nodeId);
      if (!pubKey) {
        console.warn('[useMeshcoreRuntime] exportContact: no public key for node', nodeId);
        return null;
      }
      try {
        const result = await conn.exportContact(pubKey);
        return result;
      } catch (e: unknown) {
        console.warn('[useMeshcoreRuntime] exportContact error ' + errLikeToLogString(e));
        return null;
      }
    },
    [ensureNodePubKey],
  );

  const shareContact = useCallback(
    async (nodeId: number): Promise<boolean> => {
      const conn = connRef.current;
      if (!conn) return false;
      const pubKey = await ensureNodePubKey(nodeId);
      if (!pubKey) {
        console.warn('[useMeshcoreRuntime] shareContact: no public key for node', nodeId);
        return false;
      }
      try {
        await conn.shareContact(pubKey);
        return true;
      } catch (e: unknown) {
        console.warn('[useMeshcoreRuntime] shareContact error ' + errLikeToLogString(e));
        return false;
      }
    },
    [ensureNodePubKey],
  );

  // ─── MeshCore Contact Path Management ──────────────────────────
  // Note: setContactPath requires full contact object from meshcore.js.
  // Use resetContactPath to clear path, or implement setContactPath with contact data.
  const setContactPath = useCallback(async (nodeId: number, path: number[]): Promise<boolean> => {
    const conn = connRef.current;
    if (!conn || path.length === 0) return false;
    const pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey) {
      console.warn('[useMeshcoreRuntime] setContactPath: no public key for node', nodeId);
      return false;
    }
    try {
      const hops = resolveMeshcoreRoomLoginHopsAway(
        nodesRef.current.get(nodeId),
        outPathMapRef.current.get(nodeId),
      );
      const result = await syncMeshcoreRoomContactPathBeforeLogin(
        conn,
        nodeId,
        pubKey,
        nodesRef.current.get(nodeId),
        Uint8Array.from(path),
        hops,
      );
      return result.synced;
    } catch (e: unknown) {
      console.warn('[useMeshcoreRuntime] setContactPath error ' + errLikeToLogString(e));
      return false;
    }
  }, []);

  const resetContactPath = useCallback(async (nodeId: number): Promise<boolean> => {
    const conn = connRef.current;
    if (!conn) return false;
    const pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey) {
      console.warn('[useMeshcoreRuntime] resetContactPath: no public key for node', nodeId);
      return false;
    }
    try {
      await conn.resetPath(pubKey);
      return true;
    } catch (e: unknown) {
      console.warn('[useMeshcoreRuntime] resetContactPath error ' + errLikeToLogString(e));
      return false;
    }
  }, []);

  // ─── MeshCore Statistics ───────────────────────────────────────
  const getRadioStats =
    useCallback(async (): Promise<MeshCoreStatsResponse<MeshCoreRadioStatsData> | null> => {
      const conn = connRef.current;
      if (!conn) return null;
      try {
        const result = await conn.getStatsRadio();
        return result;
      } catch (e: unknown) {
        console.warn('[useMeshcoreRuntime] getRadioStats error ' + errLikeToLogString(e));
        return null;
      }
    }, []);

  const getPacketStats =
    useCallback(async (): Promise<MeshCoreStatsResponse<MeshCorePacketStatsData> | null> => {
      const conn = connRef.current;
      if (!conn) return null;
      try {
        const result = await conn.getStatsPackets();
        return result;
      } catch (e: unknown) {
        console.warn('[useMeshcoreRuntime] getPacketStats error ' + errLikeToLogString(e));
        return null;
      }
    }, []);

  // ─── MeshCore Channel Data ──────────────────────────────────────
  const sendChannelData = useCallback(
    async (
      channelIdx: number,
      pathLen: number,
      path: Uint8Array,
      dataType: number,
      payload: Uint8Array,
    ): Promise<boolean> => {
      const conn = connRef.current;
      if (!conn) return false;
      try {
        await conn.sendChannelData(channelIdx, pathLen, path, dataType, payload);
        return true;
      } catch (e: unknown) {
        console.warn('[useMeshcoreRuntime] sendChannelData error ' + errLikeToLogString(e));
        return false;
      }
    },
    [],
  );

  // ─── MeshCore Cryptographic Operations ───────────────────────────
  const signData = useCallback(async (data: Uint8Array): Promise<Uint8Array | null> => {
    const conn = connRef.current;
    if (!conn) return null;
    try {
      const signature = await conn.sign(data);
      return signature;
    } catch (e: unknown) {
      console.warn('[useMeshcoreRuntime] signData error ' + errLikeToLogString(e));
      return null;
    }
  }, []);

  const exportPrivateKey = useCallback(async (): Promise<Uint8Array | null> => {
    const conn = connRef.current;
    if (!conn) return null;
    try {
      const raw = await conn.exportPrivateKey();
      return coerceMeshcoreExportPrivateKeyResult(raw);
    } catch (e: unknown) {
      console.warn('[useMeshcoreRuntime] exportPrivateKey error ' + errLikeToLogString(e));
      return null;
    }
  }, []);

  const importPrivateKey = useCallback(async (privateKey: Uint8Array): Promise<boolean> => {
    const conn = connRef.current;
    if (!conn) return false;
    try {
      await conn.importPrivateKey(privateKey);
      return true;
    } catch (e: unknown) {
      console.warn('[useMeshcoreRuntime] importPrivateKey error ' + errLikeToLogString(e));
      return false;
    }
  }, []);

  // ─── MeshCore Waiting Messages ───────────────────────────────────
  const getWaitingMessages = useCallback(async (): Promise<unknown[] | null> => {
    const conn = connRef.current;
    if (!conn) return null;
    try {
      const messages = await conn.getWaitingMessages();
      return messages;
    } catch (e: unknown) {
      console.warn('[useMeshcoreRuntime] getWaitingMessages error ' + errLikeToLogString(e));
      return null;
    }
  }, []);

  const syncNextMessage = useCallback(async (): Promise<unknown> => {
    const conn = connRef.current;
    if (!conn) return null;
    try {
      const msg = await conn.syncNextMessage();
      return msg;
    } catch (e: unknown) {
      console.warn('[useMeshcoreRuntime] syncNextMessage error ' + errLikeToLogString(e));
      return null;
    }
  }, []);

  // No-op stubs to satisfy the same interface shape used in App.tsx
  const noopAsync = useCallback(async () => {}, []);
  const noopVoid = useCallback(() => {}, []);

  const requestRefresh = useCallback(async () => {
    await fetchAndUpdateLocalStats();
  }, [fetchAndUpdateLocalStats]);

  const refreshOurPositionNoop = useCallback(async () => {
    const myNode = nodesRef.current.get(myNodeNumRef.current);
    const storedStatic = readStoredStaticGps();
    const staticLat = storedStatic?.lat;
    const staticLon = storedStatic?.lon;
    // Match useMeshtasticRuntime: when a static override exists, do not let device coords win over it.
    const devLat = storedStatic != null ? undefined : myNode?.latitude;
    const devLon = storedStatic != null ? undefined : myNode?.longitude;
    const devAlt = storedStatic != null ? undefined : myNode?.altitude;
    const pos = await resolveOurPosition(devLat, devLon, staticLat, staticLon, devAlt);
    setOurPosition(pos);
    if (getStoredMeshProtocol() === 'meshcore') {
      useDiagnosticsStore.getState().setOurPositionSource(pos?.source ?? null);
    }

    if (pos) {
      const selfNodeId = myNodeNumRef.current;
      if (selfNodeId > 0) {
        const nowSec = Math.floor(Date.now() / 1000);
        setNodes((prev) => {
          const next = new Map(prev);
          const existing = next.get(selfNodeId);
          if (existing) {
            next.set(selfNodeId, {
              ...existing,
              latitude: pos.lat,
              longitude: pos.lon,
              last_heard: nowSec,
              lastPositionWarning: undefined,
            });
          } else {
            const trimmedName = selfInfo?.name?.trim() ?? '';
            next.set(selfNodeId, {
              node_id: selfNodeId,
              long_name: trimmedName || `Node-${selfNodeId.toString(16).toUpperCase()}`,
              short_name: '',
              hw_model: CONTACT_TYPE_LABELS[selfInfo?.type ?? 0] ?? 'Unknown',
              battery: 0,
              snr: 0,
              rssi: 0,
              last_heard: nowSec,
              latitude: pos.lat,
              longitude: pos.lon,
            });
          }
          return next;
        });
      }

      if (pos.source === 'static' && connRef.current) {
        sendPositionToDeviceMeshCore(pos.lat, pos.lon).catch((e: unknown) => {
          console.debug(
            '[useMeshcoreRuntime] refreshOurPosition setAdvertLatLong non-fatal ' +
              errLikeToLogString(e),
          );
        });
      }
    }

    return pos;
  }, [selfInfo?.name, selfInfo?.type, sendPositionToDeviceMeshCore]);

  refreshOurPositionMeshCoreRef.current = refreshOurPositionNoop;

  // Same as useMeshtasticRuntime: resolve map/static GPS on startup so MapPanel receives ourPosition.
  useEffect(() => {
    void refreshOurPositionNoop();
  }, [refreshOurPositionNoop]);

  // Telemetry may populate self-node altitude after the first refreshOurPosition; merge into device GPS.
  useEffect(() => {
    if (getStoredMeshProtocol() !== 'meshcore') return;
    const selfId = state.myNodeNum;
    if (selfId <= 0) return;
    const alt = nodes.get(selfId)?.altitude;
    if (alt == null || !Number.isFinite(alt)) return;
    queueMicrotask(() => {
      setOurPosition((prev) => {
        if (prev?.source !== 'device') return prev;
        if (prev.altitudeMeters === alt) return prev;
        return { ...prev, altitudeMeters: alt };
      });
    });
  }, [nodes, state.myNodeNum]);

  const getNodes = useCallback(() => nodes, [nodes]);
  const getFullNodeLabel = useCallback(
    (id: number) => nodes.get(id)?.long_name ?? id.toString(16).toUpperCase(),
    [nodes],
  );
  const getPickerStyleNodeLabel = useCallback(
    (id: number) => nodes.get(id)?.long_name ?? id.toString(16).toUpperCase(),
    [nodes],
  );
  const refreshNodesFromDb = useCallback(async () => {
    try {
      const dbContacts = (await window.electronAPI.db.getMeshcoreContacts()) as {
        node_id: number;
        adv_name: string | null;
        contact_type: number;
        last_advert: number | null;
        adv_lat: number | null;
        adv_lon: number | null;
        last_snr: number | null;
        last_rssi: number | null;
        favorited: number;
        hops_away: number | null;
      }[];
      let nextMap: Map<number, MeshNode> | null = null;
      setNodes((prev) => {
        const next = new Map(prev);
        for (const row of dbContacts) {
          const existing = next.get(row.node_id);
          const mergedHopsAway =
            row.hops_away != null
              ? existing?.hops_away != null
                ? Math.min(existing.hops_away, row.hops_away)
                : row.hops_away
              : existing?.hops_away;
          if (existing) {
            if (existing.hops_away === mergedHopsAway) continue;
            next.set(row.node_id, { ...existing, hops_away: mergedHopsAway });
            continue;
          }
          next.set(row.node_id, {
            node_id: row.node_id,
            long_name: row.adv_name ?? `Node-${row.node_id.toString(16).toUpperCase()}`,
            short_name: '',
            hw_model: CONTACT_TYPE_LABELS[row.contact_type] ?? 'Unknown',
            battery: 0,
            snr: row.last_snr ?? 0,
            rssi: row.last_rssi ?? 0,
            last_heard: row.last_advert ?? 0,
            latitude: row.adv_lat ?? null,
            longitude: row.adv_lon ?? null,
            favorited: row.favorited === 1,
            ...(mergedHopsAway != null ? { hops_away: mergedHopsAway } : {}),
          });
        }
        nextMap = next;
        return next;
      });
      const storeId = resolveMeshcoreStoreIdentityId();
      if (storeId && nextMap) {
        syncMeshcoreNodesMapToIdentityStore(storeId, nextMap);
      }
    } catch (e) {
      console.warn('[useMeshcoreRuntime] refreshNodesFromDb error ' + errLikeToLogString(e));
    }
  }, [resolveMeshcoreStoreIdentityId]);
  const refreshMessagesFromDb = useCallback(async (opts?: { replaceFromDb?: boolean }) => {
    try {
      const dbMsgs = (await window.electronAPI.db.getMeshcoreMessages(
        undefined,
        500,
      )) as MeshcoreMessageDbRow[];
      const mapped = repairMeshcoreHydratedMessages(
        mapMeshcoreDbRowsToChatMessages(dbMsgs),
        meshcoreRoomServerIdsFromNodes(nodesRef.current.values()),
        myNodeNumRef.current,
      );
      void persistMeshcoreMessageSenderRepairs(dbMsgs, mapped);
      setNodes((prev) => mergeStubNodesFromMeshcoreMessages(prev, mapped));
      setMessages((prev) => mergeMeshcoreDbHydrationWithLive(prev, mapped, opts));
    } catch (e) {
      console.warn('[useMeshcoreRuntime] refreshMessagesFromDb error ' + errLikeToLogString(e));
    }
  }, []);

  const meshcoreMessagesFromStore = useMessageStore((s) =>
    meshcoreIdentityId ? s.messages[meshcoreIdentityId] : undefined,
  );
  const meshcoreNodesFromStore = useNodeStore((s) =>
    meshcoreIdentityId ? s.nodes[meshcoreIdentityId] : undefined,
  );

  const resolvedMessages = useMemo(() => {
    if (!meshcoreIdentityId) return messages;
    if (!meshcoreMessagesFromStore) return messages;
    const fromStore = meshcoreChatMessagesForDisplay(
      messageRecordsToChatMessages(Object.values(meshcoreMessagesFromStore)),
    );
    return fromStore.length > 0 ? fromStore : meshcoreChatMessagesForDisplay(messages);
  }, [meshcoreIdentityId, messages, meshcoreMessagesFromStore]);
  const resolvedNodes = useMemo(() => {
    if (!meshcoreIdentityId) return nodes;
    if (!meshcoreNodesFromStore) return nodes;
    const fromStore = nodeRecordsToMeshNodeMap(Object.values(meshcoreNodesFromStore));
    return fromStore.size > 0 ? fromStore : nodes;
  }, [meshcoreIdentityId, nodes, meshcoreNodesFromStore]);

  useEffect(() => {
    if (!meshcoreIdentityId) return;
    setConnection(meshcoreIdentityId, {
      status: state.status,
      connectionLoss: state.connectionLoss,
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
  }, [meshcoreIdentityId, state, mqttStatus]);

  const scheduleMeshcoreDmAckPendingImpl = useCallback(
    ({
      identityId,
      ackKeyU32,
      estTimeoutMs,
      destNodeId,
    }: {
      identityId: IdentityId;
      ackKeyU32: number;
      estTimeoutMs: number;
      destNodeId?: number;
    }) => {
      const pendingMapKeys = meshcorePendingDmAckMapKeys(ackKeyU32);
      const outPathRaw = destNodeId != null ? outPathMapRef.current.get(destNodeId) : undefined;
      const sendPathBytes = outPathRaw && outPathRaw.length > 0 ? Array.from(outPathRaw) : [];
      const sendPathHash = sendPathBytes.length > 0 ? computePathHash(sendPathBytes) : '';
      const hopsAway = destNodeId != null ? (nodesRef.current.get(destNodeId)?.hops_away ?? 0) : 0;
      if (sendPathBytes.length > 0 && destNodeId != null) {
        usePathHistoryStore
          .getState()
          .recordPathUpdated(destNodeId, sendPathBytes, hopsAway, false);
      }
      const timeoutId = setTimeout(() => {
        for (const k of pendingMapKeys) {
          pendingAcksRef.current.delete(k);
        }
        if (destNodeId != null && sendPathHash) {
          usePathHistoryStore.getState().recordOutcome(destNodeId, sendPathHash, false);
        }
        syncMeshcoreDmAckToMessageStore(identityId, ackKeyU32, myNodeNumRef.current, 'failed');
        void window.electronAPI.db
          .updateMeshcoreMessageStatus(ackKeyU32, 'failed')
          .catch((e: unknown) => {
            console.warn(
              '[useMeshcoreRuntime] updateMeshcoreMessageStatus (DM ack timeout) error ' +
                errLikeToLogString(e),
            );
          });
      }, estTimeoutMs);
      const pendingEntry: PendingDmAckEntry = {
        timeoutId,
        mapKeys: pendingMapKeys,
        canonicalPacketIdU32: ackKeyU32,
        destNodeId,
        pathHash: sendPathHash,
      };
      for (const k of pendingMapKeys) {
        pendingAcksRef.current.set(k, pendingEntry);
      }
    },
    [],
  );

  useEffect(() => {
    setMeshcoreDmAckPendingImpl(scheduleMeshcoreDmAckPendingImpl);
    return () => setMeshcoreDmAckPendingImpl(null);
  }, [scheduleMeshcoreDmAckPendingImpl]);

  useEffect(() => {
    setMeshcorePubKeyRegistryRefSync(() => {
      copyMeshcorePubKeyRegistryToRefs(pubKeyMapRef.current, pubKeyPrefixMapRef.current);
    });
    return () => setMeshcorePubKeyRegistryRefSync(null);
  }, []);

  useEffect(() => {
    registerMeshcoreSession({
      prepareRfConnect,
      attachRfSession,
      handleRfConnectFailure,
      finalizeDriverDisconnect,
      connectAutomatic,
      getDestinationPubKey: (nodeId) => pubKeyMapRef.current.get(nodeId),
    });
    return () => registerMeshcoreSession(null);
  }, [
    prepareRfConnect,
    attachRfSession,
    handleRfConnectFailure,
    finalizeDriverDisconnect,
    connectAutomatic,
  ]);

  return useMemo(
    () => ({
      state,
      nodes: resolvedNodes,
      messages: resolvedMessages,
      channels,
      selfInfo,
      meshcoreLocalStats: nodesRef.current.get(myNodeNumRef.current)?.meshcore_local_stats ?? null,
      connect,
      disconnect,
      onPowerSuspend,
      onPowerResume,
      prepareRfConnect,
      attachRfSession,
      handleRfConnectFailure,
      finalizeDriverDisconnect,
      sendMessage,
      sendAdvert,
      sendZeroHopAdvert,
      applyMeshcoreFloodScopeHashtag,
      syncClock,
      refreshContacts,
      reboot,
      deleteNode,
      clearAllRepeaters,
      clearAllMeshcoreContacts,
      offloadContactsFromRadio,
      setOwner,
      traceRoute,
      meshcoreCanPingTrace,
      meshcorePingRouteReadyEpoch,
      requestRepeaterStatus,
      requestTelemetry,
      requestNeighbors,
      importContacts,
      toggleManualAddContacts,
      setMeshcoreChannel,
      deleteMeshcoreChannel,
      deviceLogs,
      rawPackets,
      clearRawPackets,
      meshcoreTraceResults,
      meshcoreNodeStatus,
      meshcoreStatusErrors,
      meshcoreNodeTelemetry,
      meshcoreTelemetryErrors,
      meshcorePingErrors,
      meshcoreNeighbors,
      meshcoreNeighborErrors,
      meshcoreCliHistories,
      meshcoreCliErrors,
      sendRepeaterCliCommand,
      loginRoom,
      loginRoomWithSaved,
      loginAllSavedRooms,
      cancelRoomLogin,
      leaveRoom,
      sendRoomPost,
      sendRoomAdminCliCommand,
      clearCliHistory,
      manualAddContacts,
      mqttStatus,
      mqttConnectionLoss,
      waitingMessagesCount,
      selfNodeId: state.myNodeNum,
      identityId: meshcoreIdentityId,
      getNodes,
      getFullNodeLabel,
      getPickerStyleNodeLabel,
      traceRouteResults: new Map(
        Array.from(meshcoreTraceResults.entries()).map(([id, res]) => [
          id,
          { route: res.pathHashes, from: id, timestamp: Date.now() },
        ]),
      ),
      queueStatus,
      neighborInfo: new Map<number, unknown>(),
      waypoints: [] as unknown[],
      telemetry,
      signalTelemetry,
      environmentTelemetry,
      channelConfigs: [] as unknown[],
      moduleConfigs: {},
      deviceOwner: selfInfo ? { longName: selfInfo.name, shortName: '', isLicensed: false } : null,
      ourPosition,
      gpsLoading: false,
      telemetryEnabled: null,
      sendReaction,
      requestPosition: noopAsync,
      setNodeFavorited,
      shutdown: noopAsync,
      factoryReset: noopAsync,
      resetNodeDb: noopAsync,
      commitConfig: noopAsync,
      setConfig: noopAsync,
      setDeviceChannel: noopAsync,
      clearChannel: noopAsync,
      rebootOta: noopAsync,
      enterDfuMode: noopAsync,
      factoryResetConfig: noopAsync,
      sendWaypoint: noopAsync,
      deleteWaypoint: noopAsync,
      setModuleConfig: noopAsync,
      setCannedMessages: noopAsync,
      requestRefresh,
      refreshOurPosition: refreshOurPositionNoop,
      sendPositionToDevice: sendPositionToDeviceMeshCore,
      updateGpsInterval: noopVoid,
      refreshNodesFromDb,
      refreshMessagesFromDb,
      connectAutomatic,
      telemetryDeviceUpdateInterval: undefined as number | undefined,
      setRadioParams,
      meshcoreContactsForTelemetry,
      meshcoreAutoadd,
      applyMeshcoreContactAutoAdd,
      refreshMeshcoreAutoaddFromDevice,
      applyMeshcoreTelemetryPrivacyPolicy,
      // MeshCore new methods
      getDeviceTime,
      syncDeviceTime,
      getDeviceInfo,
      importContact,
      exportContact,
      shareContact,
      setContactPath,
      resetContactPath,
      getRadioStats,
      getPacketStats,
      sendChannelData,
      signData,
      exportPrivateKey,
      importPrivateKey,
      getWaitingMessages,
      syncNextMessage,
      getRemoteAdminKeyForNode,
      setRemoteAdminKeyForNode,
    }),
    [
      state,
      resolvedNodes,
      resolvedMessages,
      channels,
      selfInfo,
      meshcoreIdentityId,
      connect,
      disconnect,
      onPowerSuspend,
      onPowerResume,
      prepareRfConnect,
      attachRfSession,
      handleRfConnectFailure,
      finalizeDriverDisconnect,
      sendMessage,
      getNodes,
      getFullNodeLabel,
      getPickerStyleNodeLabel,
      refreshNodesFromDb,
      refreshMessagesFromDb,
      sendAdvert,
      sendZeroHopAdvert,
      applyMeshcoreFloodScopeHashtag,
      syncClock,
      refreshContacts,
      reboot,
      deleteNode,
      clearAllRepeaters,
      clearAllMeshcoreContacts,
      offloadContactsFromRadio,
      setOwner,
      traceRoute,
      meshcoreCanPingTrace,
      meshcorePingRouteReadyEpoch,
      requestRepeaterStatus,
      requestTelemetry,
      requestNeighbors,
      importContacts,
      toggleManualAddContacts,
      setMeshcoreChannel,
      deleteMeshcoreChannel,
      deviceLogs,
      rawPackets,
      clearRawPackets,
      meshcoreTraceResults,
      meshcoreNodeStatus,
      meshcoreStatusErrors,
      meshcoreNodeTelemetry,
      meshcoreTelemetryErrors,
      meshcorePingErrors,
      meshcoreNeighbors,
      meshcoreNeighborErrors,
      meshcoreCliHistories,
      meshcoreCliErrors,
      sendRepeaterCliCommand,
      loginRoom,
      loginRoomWithSaved,
      loginAllSavedRooms,
      cancelRoomLogin,
      leaveRoom,
      sendRoomPost,
      sendRoomAdminCliCommand,
      clearCliHistory,
      manualAddContacts,
      mqttStatus,
      mqttConnectionLoss,
      waitingMessagesCount,
      queueStatus,
      telemetry,
      signalTelemetry,
      environmentTelemetry,
      ourPosition,
      sendReaction,
      setNodeFavorited,
      requestRefresh,
      refreshOurPositionNoop,
      sendPositionToDeviceMeshCore,
      noopVoid,
      noopAsync,
      connectAutomatic,
      setRadioParams,
      meshcoreContactsForTelemetry,
      meshcoreAutoadd,
      applyMeshcoreContactAutoAdd,
      refreshMeshcoreAutoaddFromDevice,
      applyMeshcoreTelemetryPrivacyPolicy,
      // MeshCore new methods
      getDeviceTime,
      syncDeviceTime,
      getDeviceInfo,
      importContact,
      exportContact,
      shareContact,
      setContactPath,
      resetContactPath,
      getRadioStats,
      getPacketStats,
      sendChannelData,
      signData,
      exportPrivateKey,
      importPrivateKey,
      getWaitingMessages,
      syncNextMessage,
      getRemoteAdminKeyForNode,
      setRemoteAdminKeyForNode,
    ],
  );
}

export type MeshcoreRuntime = ReturnType<typeof useMeshcoreRuntime>;
