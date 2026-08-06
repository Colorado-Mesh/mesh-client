import type { Connection } from '@liamcottle/meshcore.js';
import { CayenneLpp } from '@liamcottle/meshcore.js';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { dedupeChannelPillsByIndex } from '@/renderer/lib/channelListDedupe';
import { requestChatOutboxDrain } from '@/renderer/lib/chatOutboxDrain';
/* eslint-disable @typescript-eslint/no-confusing-void-expression */
import {
  clearMeshcoreBleMacSuppression,
  commitConnectedMeshcoreBleSuppression,
  prearmMeshcoreBleMacSuppressionFromStorage,
  preserveOrClearMeshcoreBleSuppression,
  readMeshcoreWebBluetoothDeviceId,
  resolveConnectedMeshcoreBleIdentity,
} from '@/renderer/lib/connectedMeshcoreBleMac';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  isMeshcoreOffloadAbortError,
  type MeshcoreOffloadFromRadioOptions,
  throwIfMeshcoreOffloadAborted,
} from '@/renderer/lib/meshcoreOffload';
import { NOBLE_BLE_YIELD_RELEASED_EVENT } from '@/renderer/lib/nobleBleYieldReleased';

import {
  isMeshcorePathHashMode,
  meshcoreFirmwareSupportsMultibytePathHash,
  type MeshcorePathHashMode,
  meshcorePathHashSizeFromTraceFlags,
} from '../../shared/meshcorePathHash';
import { withTimeout } from '../../shared/withTimeout';
import { pushAppToast } from '../components/Toast';
import { attachMeshcoreConnSideEffects } from '../hooks/meshcore/meshcoreConnSideEffects';
import type {
  MeshcoreConnSideEffectsCtx,
  ProcessWaitingMessagesOptions,
} from '../hooks/meshcore/meshcoreConnSideEffectsCtx';
import {
  buildMeshcoreNodeMapFromDb,
  contactToDbRow,
  findMeshcoreCrossTransportDuplicate,
  formatStructuredLogDetail,
  INITIAL_STATE,
  isMeshcoreRoomChatMessage,
  MANUAL_CONTACTS_KEY,
  mapMeshcoreDbRowsToChatMessages,
  MAX_ENV_TELEMETRY_POINTS,
  MAX_TELEMETRY_POINTS,
  mergeMeshcoreContactsFromDbIntoNodeMap,
  mergeMeshcoreDbHydrationWithLive,
  mergeStubNodesFromMeshcoreMessages,
  MESHCORE_DEVICE_QUERY_APP_VER,
  MESHCORE_DM_ACK_TIMEOUT_MIN_MS,
  MESHCORE_INIT_TIMEOUT_MS,
  MESHCORE_NEIGHBORS_PAGE_SIZE,
  MESHCORE_NEIGHBORS_TIMEOUT_MS,
  MESHCORE_PING_NO_ROUTE_ERROR_MSG,
  MESHCORE_RESPONSE_DEVICE_INFO,
  MESHCORE_ROOM_MESSAGE_CHANNEL,
  MESHCORE_SEND_FLOOD_ADVERT_TIMEOUT_MS,
  MESHCORE_STATUS_TIMEOUT_MS,
  MESHCORE_TELEMETRY_TIMEOUT_MS,
  MESHCORE_TRACE_TIMEOUT_MS,
  meshcoreContactRawFromDevice,
  meshcoreDmAckKeyU32,
  meshcoreFullPubKeyBytesFromContactDbHex,
  meshcoreMessageDedupeKey,
  meshcorePendingDmAckMapKeys,
  meshcoreTraceRouteRejectReason,
  messageToDbRow,
  normalizeMeshCoreError,
  type PendingDmAckEntry,
  persistMeshcoreMessageSenderRepairs,
  registerMeshcorePubKeysFromContactDbRows,
  resolveMeshcoreNodePubKey,
  serializeErrorLike,
  upgradeMeshcoreCrossTransportMessage,
} from '../hooks/meshcore/meshcoreHookPreamble';
import { openMeshCoreTransport } from '../hooks/openMeshCoreTransport';
import {
  getAppSettingsRaw,
  isMeshcoreOpenWireCompatEnabled,
  mergeAppSetting,
  mergeAppSettingsPartial,
} from '../lib/appSettingsStorage';
import {
  classifyMeshcoreBleTimeoutStage,
  isMeshcoreSetupAbortError,
  isMeshcoreTcpTransportDeadError,
  MESHCORE_SETUP_ABORT_MESSAGE,
  rethrowMeshcoreSetupAbortFromTcpDead,
} from '../lib/bleConnectErrors';
import { raceWithDeadline, verifyNobleBleRfLink } from '../lib/bleReconnectHelper';
import { createBleReconnectTransportCleanup } from '../lib/bleReconnectLateTransport';
import { MAX_IN_MEMORY_CHAT_MESSAGES, trimChatMessagesToMax } from '../lib/chatInMemoryBuffer';
import { setMeshcoreDiagnosticsNodes } from '../lib/diagnosticsNodesRef';
import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import type { OurPosition } from '../lib/gpsSource';
import { hasStoredStaticGps, readStoredStaticGps, resolveOurPosition } from '../lib/gpsSource';
import {
  loadMeshcoreMessagesForHydration,
  loadMeshcoreSavedHopRowsForHydration,
  meshcoreHydratedMessageRecords,
  syncNodesMapToIdentityStore,
} from '../lib/hydrateIdentityStoresFromDb';
import i18n from '../lib/i18n';
import { getIdentityIdForProtocol } from '../lib/identityByProtocol';
import {
  getIdentityChatMessages,
  getIdentityNode,
  getIdentityNodeMap,
} from '../lib/identityStoreReads';
import { attachMeshcoreIngest } from '../lib/ingest/meshcoreIngest';
import { repairMeshcoreChannelSenderIdsInStore } from '../lib/ingest/meshcoreSenderRepair';
import {
  rehydrateMeshcoreConnectionParamsFromStorage,
  resolveLastBlePeripheralId,
} from '../lib/lastConnectionStorage';
import {
  meshcoreIdentityHasFullKeyPair,
  tryPersistMeshcorePublicKeyFromRadio,
} from '../lib/letsMeshJwt';
import { assignCayenneTemperatureFields } from '../lib/meshcore/meshcoreCayenneTemperature';
import { ensureMeshcoreChatSenderInNodeStore } from '../lib/meshcore/meshcoreChatSenderNode';
import { takeMeshcoreDiscoverSelfCache } from '../lib/meshcore/meshcoreDiscoverSelfCache';
import { syncMeshcoreDmAckToMessageStore } from '../lib/meshcore/meshcoreDmAckRuntime';
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
  MeshcoreRequestNeighborsOpts,
  MeshCoreSelfInfo,
  MeshCoreStatsResponse,
  MeshcoreTraceResultEntry,
  RxPacketEntry,
} from '../lib/meshcore/meshcoreHookTypes';
import {
  MESHCORE_ERR_NODE_NOT_FOUND,
  MESHCORE_ERR_NOT_CONNECTED,
  MESHCORE_ERR_REQUEST_FAILED,
  meshcoreRepeaterAdminRpcErrorBudgetMs,
  meshcoreRepeaterRpcErrorMessage,
  meshcoreStoredUserMessage,
  type MeshcoreUserMessage,
  meshcoreUserMessageKey,
  serializeMeshcoreUserMessage,
} from '../lib/meshcore/meshcoreMessageI18n';
import {
  MESHCORE_PATH_UPDATED_CONTACTS_REBUILD_DEBOUNCE_MS,
  rebuildMeshcoreContactsAfterPathUpdated,
  refreshMeshcoreOutPathAfterPathUpdated,
} from '../lib/meshcore/meshcorePathUpdatedRuntime';
import {
  clearMeshcorePubKeyRegistry,
  copyMeshcorePubKeyRegistryToRefs,
  registerMeshcorePubKey,
  replaceMeshcorePubKeyRegistry,
  setMeshcorePubKeyRegistryRefSync,
} from '../lib/meshcore/meshcorePubKeyRegistry';
import { attachMeshcoreSerialTransportLossWatch } from '../lib/meshcore/meshcoreSerialTransportLoss';
import {
  isMeshcoreTcpBurstDeadBridge,
  setMeshcoreTcpWriteDeadListener,
  shouldDeferMeshcoreTcpReconnectAfterBurst,
} from '../lib/meshcore/meshcoreTcpInitBurst';
import {
  buildMeshcoreOutboundTapbackWire,
  MESHCORE_TXT_TYPE_CLI_DATA,
  MESHCORE_TXT_TYPE_PLAIN,
  meshcoreChatMessagesForDisplay,
  normalizeMeshcoreIncomingText,
  parseMeshcoreChannelIncomingFromThread,
  resolveMeshcoreChannelMessageSender,
  resolveMeshcoreOutboundWireText,
} from '../lib/meshcoreChannelText';
import {
  buildSetAutoaddConfigFrame,
  fetchMeshcoreAutoaddConfigFromConn,
  mergeAutoaddConfigByte,
  type MeshcoreAutoaddWireState,
} from '../lib/meshcoreContactAutoAdd';
import { queueLenFromMeshCoreCoreStatsRaw } from '../lib/meshcoreCoreStatsQueue';
import {
  meshcoreRoomServerIdsFromContacts,
  meshcoreRoomServerIdsFromNodes,
  repairMeshcoreHydratedMessages,
} from '../lib/meshcoreDbCacheHydration';
import { setMeshcoreDmAckPendingImpl } from '../lib/meshcoreDmAckDelivery';
import {
  awaitDualNobleBleMeshtasticSettle,
  isRendererNobleBlePlatform,
  needsSequentialMeshcoreRadioInit,
  withNobleBleConnectMutex,
} from '../lib/meshcoreDualNobleBleInit';
import { applyMeshcoreFloodScope } from '../lib/meshcoreFloodScope';
import {
  buildMeshcoreGetNeighboursRequest,
  parseMeshcoreGetNeighboursResponse,
} from '../lib/meshcoreGetNeighboursBinary';
import { persistMeshcoreSelfNodeId } from '../lib/meshcoreLastSelfNodeId';
import {
  clearMeshcoreLocallyDeletedContact,
  filterOutMeshcoreLocallyDeletedContacts,
  markMeshcoreLocallyDeletedContact,
  restoreMeshcoreLocallyDeletedContactsFromStorage,
  shouldApplyMeshcoreContact,
} from '../lib/meshcoreLocallyDeletedContacts';
import { exportAndPersistMeshcoreMqttIdentity } from '../lib/meshcoreMqttIdentityExport';
import { readMeshcoreMqttSettingsFromStorage } from '../lib/meshcoreMqttSettingsStorage';
import { mergeMeshcoreNeighborPage } from '../lib/meshcoreNeighborPageMerge';
import { buildMeshcoreOpenReactionWire } from '../lib/meshcoreOpenReaction';
import {
  parsePathHashModeFromDeviceQuery,
  setMeshcorePathHashModeOnRadio,
} from '../lib/meshcorePathHashMode';
import {
  meshcoreContactOutPathBytesForTrace,
  type MeshcoreRadioContactPathSnapshot,
  meshcoreSnapshotContactPathFromContacts,
} from '../lib/meshcoreRadioContactPath';
import { waitForMeshcoreRadioSentAck } from '../lib/meshcoreRadioSentWait';
import {
  type MeshcoreRepeaterRpcPendingMap,
  setRepeaterAdminRpcPending,
} from '../lib/meshcoreRepeaterAdminPending';
import { runMeshcoreRepeaterBinaryRequest } from '../lib/meshcoreRepeaterBinaryRequestRpc';
import { isMeshcoreRepeaterCliDangerCommand } from '../lib/meshcoreRepeaterCliDanger';
import {
  meshcoreCompanionRepeaterRfBusy,
  resetMeshcoreRepeaterRpcInFlightOnDisconnect,
  runMeshcoreRepeaterRpcOnce,
} from '../lib/meshcoreRepeaterRpcInFlight';
import { runMeshcoreRepeaterStatusRequest } from '../lib/meshcoreRepeaterStatusRpc';
import { runMeshcoreRepeaterTelemetryRequest } from '../lib/meshcoreRepeaterTelemetryRpc';
import {
  computeMeshcoreTracePrimeStrategy,
  evaluateMeshcorePingRouteAbort,
  meshcoreCanSynthesizeTracePath,
  meshcoreDirectRepeaterRelayPubKeys,
  meshcoreIsUsableTraceStoredPath,
  meshcoreTraceDirectRetryEligible,
  planMeshcoreRepeaterTraceRoute,
  resolveMeshcoreTraceOutPathSeed,
} from '../lib/meshcoreRepeaterTracePath';
import { resolveMeshcoreActiveConnection } from '../lib/meshcoreResolveActiveConnection';
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
import { meshcoreIsRoomLoginQueued } from '../lib/meshcoreRoomLoginQueue';
import { resolveMeshcoreRoomLoginRouteBytes } from '../lib/meshcoreRoomLoginRouteResolve';
import { applyMeshcoreRoomLoginFailure } from '../lib/meshcoreRoomSavedSecrets';
import {
  meshcoreRoomPostSendErrorMessage,
  meshcoreRoomPostSendErrorStored,
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
  resetMeshcoreTracePathMultiplexOnDisconnect,
  startMeshcoreTracePathMultiplexed,
} from '../lib/meshcoreTracePathMultiplex';
import {
  awaitMeshcoreRepeaterAdminRfIdle,
  awaitMeshcoreRepeaterPingSettleForNode,
} from '../lib/meshcoreTraceRadioIdle';
import {
  meshcoreTracePrimeFloodWhenForPing,
  type MeshcoreTraceRoutePrimeMetrics,
  primeMeshcoreTraceRouteWithFallback,
} from '../lib/meshcoreTraceRoutePrime';
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
  meshcoreConnectionImpliesUsbPower,
  meshcoreContactToMeshNode,
  meshcoreIsChatStubNodeId,
  meshcoreIsSyntheticPlaceholderPubKeyHex,
  meshcoreManufacturerModelFromDeviceQuery,
  meshcoreMergeChannelDisplayNameOntoNode,
  meshcoreMergeContactHopsAwayFromPrevious,
  meshcoreMilliVoltsToApproximateBatteryPercent,
  meshcoreMinimalNodeFromAdvertEvent,
  meshcoreRemoveContactErrorMessage,
  meshcoreScaledAdvLatLonToDeg,
  meshcoreSyntheticPlaceholderPubKeyHex,
  meshcoreTelemetryGpsAltitudeMeters,
  meshcoreTracePathLenToHops,
  meshcoreTraceResultToOutPathBytes,
  minimalMeshcoreChatNode,
  pubkeyToNodeId,
  resolveMeshcoreRoomLoginHopsAway,
} from '../lib/meshcoreUtils';
import {
  logMeshcoreWaitingMessagesDrainError,
  markMeshcoreCompanionTx,
  scheduleMeshcoreWaitingMessagesDrain,
  shouldRunMeshcoreWaitingMessagesPeriodicPoll,
} from '../lib/meshcoreWaitingMessagesDrain';
import {
  attachMeshcoreProtocolIngress,
  finalizeMeshcoreDriverIdentity,
  meshcoreTransportParams,
} from '../lib/meshIdentityBridge';
import { tryAutoLaunchMqtt } from '../lib/mqttAutoLaunch';
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
  calculateRepeaterCliTimeout,
  type CliHistoryEntry,
  computeRepeaterCliHopCount,
  createRepeaterCommandService,
  REPEATER_CLI_MAX_COMMAND_LENGTH,
  type RepeaterCommandService,
} from '../lib/repeaterCommandService';
import { createRepeaterRemoteRpcQueue } from '../lib/repeaterRemoteRpcQueue';
import { createRfReconnectController } from '../lib/rfReconnectController';
import { rfMaxReconnectAttemptsForTransport } from '../lib/rfReconnectShared';
import { registerMeshcoreSerialDisconnectTarget } from '../lib/serialDisconnectRouter';
import {
  captureSerialIdentityForRediscovery,
  startSerialRediscovery,
} from '../lib/serialPortAutoRediscovery';
import {
  escalateSerialReconnectExhaustion,
  forgetGrantedSerialPortBestEffort,
  SERIAL_DEAD_THRESHOLD_MS,
  SERIAL_STALE_THRESHOLD_MS,
  SERIAL_WATCHDOG_INTERVAL_MS,
} from '../lib/serialPortRecovery';
import { LAST_SERIAL_PORT_KEY, persistSerialPortIdentity } from '../lib/serialPortSignature';
import { registerMeshcoreSession } from '../lib/sessions/meshcoreSession';
import { getStoredMeshProtocol } from '../lib/storedMeshProtocol';
import { messageRecordsToChatMessages, nodeRecordsToMeshNodeMap } from '../lib/storeRecordAdapters';
import { delayUnlessSuspended } from '../lib/systemPowerState';
import {
  computeRoomPostTotalTimeoutMs,
  MESHCORE_MAX_RECONNECT_DELAY_MS,
  MESHCORE_ROOM_LOGIN_HOP_BASE_MS,
  MESHCORE_ROOM_LOGIN_HOP_INCREMENT_MS,
  MESHCORE_ROOM_LOGIN_ROUTE_RESOLVE_MAX_MS,
  MESHCORE_ROOM_LOGIN_TOTAL_TIMEOUT_MS,
  MESHCORE_ROOM_SYNC_MIN_MESH_TX_SPACING_MS,
  MESHCORE_ROOM_SYNC_ROUTE_RESOLVE_FAST_MS,
  MESHCORE_ROOM_SYNC_TICK_MS,
  MESHCORE_STATS_POLL_MS,
  MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
  MESHCORE_WAITING_MESSAGES_POLL_MS,
  NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS,
  POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS,
  RF_SERIAL_OPEN_RETRY_DELAY_MS,
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
import { mirrorMqttStatusForProtocol, setConnection } from '../stores/connectionStore';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import {
  updateMessageStatus,
  upsertMessageRecordsForIdentity,
  useMessageStore,
} from '../stores/messageStore';
import {
  patchMeshcoreNodeLastHeardAt,
  patchNodeFavorited,
  removeNode,
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

/** Wait for companion OK (event 0) / ERR (event 1) after sending a config frame. */
async function awaitMeshcoreCompanionConfigAck(
  conn: Pick<Connection, 'once' | 'off' | 'sendToRadioFrame'>,
  frame: Uint8Array,
  rejectedMessage: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onOk = () => {
      conn.off(0, onOk);
      conn.off(1, onErr);
      resolve();
    };
    const onErr = () => {
      conn.off(0, onOk);
      conn.off(1, onErr);
      reject(new Error(rejectedMessage));
    };
    conn.once(0, onOk);
    conn.once(1, onErr);
    void conn.sendToRadioFrame(frame).catch((e: unknown) => {
      conn.off(0, onOk);
      conn.off(1, onErr);
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

/** Path-updated rebuild merges chat stubs without nesting a setState updater in the debounce. */
function meshcorePathUpdatedNodesMergeUpdater(
  newNodes: Map<number, MeshNode>,
): (prev: Map<number, MeshNode>) => Map<number, MeshNode> {
  return (prev) => mergeMeshcoreChatStubNodes(prev, newNodes);
}

export function useMeshcoreRuntime() {
  // Restore tombstones before any contact/message hydration in this session.
  restoreMeshcoreLocallyDeletedContactsFromStorage();
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
  const [meshcoreRepeaterRpcPending, setMeshcoreRepeaterRpcPending] =
    useState<MeshcoreRepeaterRpcPendingMap>(new Map());
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
  const waitingMessagesCountRef = useRef(0);
  const [waitingMessagesSyncActive, setWaitingMessagesSyncActive] = useState(false);
  const [waitingMessagesSyncProgress, setWaitingMessagesSyncProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);
  const [waitingMessagesSilentDrainActive, setWaitingMessagesSilentDrainActive] = useState(false);
  const [waitingMessagesDrainDeferred, setWaitingMessagesDrainDeferred] = useState(false);
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
  /** True while reconnect open/attach is in flight (single-flight + deferred Noble flush). */
  const meshcoreReconnectConnectInFlightRef = useRef(false);
  /** Set when Noble drops during an in-flight connect; reconnect runs after connect() settles. */
  const meshcoreDeferredReconnectRef = useRef(false);
  /** Single-owner reconnect scheduler (shared MeshCore/Meshtastic invariant). */
  const meshcoreRfReconnectRef = useRef(
    createRfReconnectController({ logTag: 'useMeshcoreRuntime' }),
  );
  const meshcoreConnectionParamsRef = useRef<{
    rfType: 'ble' | 'serial' | 'tcp';
    httpAddress?: string;
    blePeripheralId?: string;
    serialPortId?: string | null;
    serialPort?: SerialPort | null;
  } | null>(null);
  /** Cleared on successful connect; set when user explicitly disconnects (blocks auto-reconnect). */
  const meshcoreExplicitDisconnectRef = useRef(false);
  /** True after at least one successful configure; blocks reconnect loop on first-connect failures. */
  const meshcoreEverConfiguredRef = useRef(false);
  /**
   * Set when main emits meshcore:tcp-disconnected (or write fail-closed). Cleared on prepareRfConnect
   * for a new TCP open. Lets initConn abort before contacts→UI / getChannels even if the IPC
   * event arrives a tick before setup-generation bump is observed (Fuzzy SoftAP write storms).
   */
  const meshcoreTcpBridgeDeadRef = useRef(false);
  /**
   * TCP: set once getSelfInfo + getContacts have resolved (contact payload held). OpenHop/pyMC often
   * clean-FINs at that moment — after capture we complete configured from the burst and defer
   * reconnect instead of aborting into a never-configured loop (Neal).
   */
  const meshcoreTcpInitBurstCapturedRef = useRef(false);
  /**
   * TCP: true while post-configure getContacts is in flight. Peer FIN during the dump must
   * latch bridge-dead without handleMeshcoreConnectionLost (session already configured).
   */
  const meshcoreTcpContactsDumpInFlightRef = useRef(false);
  /**
   * True for the duration of `initConn`. After configure-before-dump, peer FIN once the contacts
   * burst is held must defer reconnect (not bump setup gen) until init finishes.
   */
  const meshcoreInitConnInFlightRef = useRef(false);
  /**
   * Active session configured (Meshtastic `deviceConfiguredRef` parity). Cleared on disconnect /
   * new connect; set when initConn reaches configured so post-configure Noble drops during
   * remaining init work are not deferred behind reconnect/connect in-flight flags.
   */
  const meshcoreDeviceConfiguredRef = useRef(false);
  const meshcoreReconnectAttemptRef = useRef(0);
  const meshcoreReconnectGenerationRef = useRef(0);
  const meshcoreIsReconnectingRef = useRef(false);
  /** Cleanup for post-exhaustion serial port rediscovery poll. */
  const serialRediscoveryStopRef = useRef<(() => void) | null>(null);
  const meshcoreLastDataReceivedRef = useRef<number>(Date.now());
  const meshcoreSerialWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meshcoreSerialLossCleanupRef = useRef<(() => void) | null>(null);
  const handleMeshcoreConnectionLostRef = useRef<() => void>(() => {});
  const attemptMeshcoreReconnectRef = useRef<() => Promise<void>>(async () => {});
  const scheduleMeshcoreReconnectAttemptRef = useRef<() => void>(() => {});
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
  /** Skip mount DB hydration commit when live ingest/import ran before async reload finishes. */
  const skipMountDbHydrationCommitRef = useRef(false);
  /** SQLite hydration snapshot set synchronously before `setNodes` so initConn can merge hops before the store catches up. */
  const meshcoreLastPersistedNodesRef = useRef<Map<number, MeshNode>>(new Map());
  /**
   * True once this runtime applied a node map (initConn cache or radio contacts). The mount DB
   * load is per-instance, so it cannot use store emptiness — App hydration fills the same bucket.
   */
  const meshcoreNodesAppliedRef = useRef(false);
  /** Store bucket for this tab: live identity, pending driver identity, else the offline slot. */
  const resolveMeshcoreStoreIdentityId = useCallback((): string | null => {
    return (
      meshcoreIdentityIdRef.current ??
      meshcorePendingDriverIdentityRef.current ??
      getOfflineIdentityIdForProtocol('meshcore')
    );
  }, []);
  /**
   * Canonical node map for this identity. `nodeStore` sees both ingress paths
   * (Protocol → PacketRouter and this runtime), so send/RPC/dedup read it directly.
   */
  const readMeshcoreNodes = useCallback(
    (): Map<number, MeshNode> => getIdentityNodeMap(resolveMeshcoreStoreIdentityId()),
    [resolveMeshcoreStoreIdentityId],
  );
  const readMeshcoreMessages = useCallback(
    (): ChatMessage[] => getIdentityChatMessages(resolveMeshcoreStoreIdentityId()),
    [resolveMeshcoreStoreIdentityId],
  );
  /** Mount DB load — initConn awaits this so an immediate connect does not skip persisted hop counts. */
  /** Same baseline as initConn: avoid an empty store map during contact rebuilds (debounced 129 / refresh). */
  const meshcorePreviousNodesBaselineForBuild = useCallback(() => {
    const fromStore = readMeshcoreNodes();
    return fromStore.size > 0 ? fromStore : meshcoreLastPersistedNodesRef.current;
  }, [readMeshcoreNodes]);
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
  /** Rate-limit debug logs when optional packet-logger IPC publish fails. */
  const lastPacketLogPublishFailureLogAtRef = useRef(0);
  const meshcoreHookMountedRef = useRef(true);
  const repeaterCommandServiceRef = useRef<RepeaterCommandService | null>(null);
  const repeaterRemoteRpcRef = useRef(createRepeaterRemoteRpcQueue());
  const lastMeshcoreRoomSyncTxAtRef = useRef(0);
  const roomSyncSchedulerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roomAutoLoginRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const processWaitingMessagesRef = useRef<
    ((options?: ProcessWaitingMessagesOptions) => Promise<void>) | null
  >(null);
  /** Previous txAirSecs value for calculating channel utilization delta. */
  const prevTxAirSecsRef = useRef<number | null>(null);
  /** Previous timestamp for calculating channel utilization delta. */
  const prevStatsTimestampRef = useRef<number | null>(null);
  /** Periodic poll for local radio stats ({@link MESHCORE_STATS_POLL_MS}). */
  const meshcoreStatsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Clears pending no-route expiry timers when a new ping starts (legacy; errors persist until next ping). */
  const meshcorePingNoRouteExpiryTimersRef = useRef<Map<number, number>>(new Map());

  const clearMeshcorePingNoRouteExpiryTimer = useCallback((nodeId: number) => {
    const t = meshcorePingNoRouteExpiryTimersRef.current.get(nodeId);
    if (t != null) {
      clearTimeout(t);
      meshcorePingNoRouteExpiryTimersRef.current.delete(nodeId);
    }
  }, []);

  const resolveMeshcoreConn = useCallback((): MeshCoreConnection | null => {
    return resolveMeshcoreActiveConnection({
      connRef,
      meshcoreDriverConnectedRef,
      meshcoreIdentityIdRef,
      meshcorePendingDriverIdentityRef,
    });
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
    meshcoreLastDataReceivedRef.current = Date.now();
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
    // Pre-arm before Meshtastic configure can dump NodeDB for the companion's old !node id.
    prearmMeshcoreBleMacSuppressionFromStorage(resolveLastBlePeripheralId('meshcore') ?? null);
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
    setMeshcoreDiagnosticsNodes(nodes, myNodeNumRef.current);
  }, [nodes, state.myNodeNum]);

  // Push runtime node map into identity-scoped Zustand after commit (mirrors Meshtastic #375 path).
  useEffect(() => {
    const storeId =
      meshcoreIdentityIdRef.current ?? meshcorePendingDriverIdentityRef.current ?? null;
    if (!storeId) return;
    syncNodesMapToIdentityStore(storeId, nodes);
  }, [nodes, meshcoreIdentityId]);

  useEffect(() => {
    meshcoreTraceResultsRef.current = meshcoreTraceResults;
  }, [meshcoreTraceResults]);

  useEffect(() => {
    waitingMessagesCountRef.current = waitingMessagesCount;
  }, [waitingMessagesCount]);

  useEffect(() => {
    rawPacketsRef.current = rawPackets;
  }, [rawPackets]);

  useEffect(() => {
    myNodeNumRef.current = state.myNodeNum;
  }, [state.myNodeNum]);

  // Start stats polling when configured (after contacts dump — not during initConn).
  useEffect(() => {
    if (state.status === 'configured') {
      if (meshcoreStatsPollRef.current) clearInterval(meshcoreStatsPollRef.current);
      meshcoreStatsPollRef.current = setInterval(() => {
        if (!meshcoreHookMountedRef.current) return;
        if (meshcoreInitConnInFlightRef.current) return;
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
      mirrorMqttStatusForProtocol('meshcore', st);
      if (st === 'connected') {
        setMqttConnectionLoss(false);
      } else if (consumeMqttUserDisconnect()) {
        setMqttConnectionLoss(false);
      } else if (prev === 'connected') {
        setMqttConnectionLoss(true);
      }
    });
  }, []);

  const maybeAutoLaunchMeshcoreMqttAfterIdentity = useCallback(() => {
    if (!readMeshcoreMqttSettingsFromStorage().autoLaunch) return;
    void (async () => {
      const st = mqttStatusRef.current;
      if (st === 'connected') return;
      // Startup may have opened MQTT before RF identity/JWT was ready — replace stale session.
      if (st === 'connecting') {
        await window.electronAPI.mqtt.disconnect('meshcore').catch((e: unknown) => {
          console.debug(
            '[useMeshcoreRuntime] MQTT stale connecting session disconnect ' +
              errLikeToLogString(e),
          );
        });
        mqttStatusRef.current = 'disconnected';
        setMqttStatus('disconnected');
      }
      if (mqttStatusRef.current !== 'disconnected') return;
      await tryAutoLaunchMqtt('meshcore');
    })().catch((e: unknown) => {
      console.warn(
        '[useMeshcoreRuntime] MQTT auto-launch after identity persist failed ' +
          errLikeToLogString(e),
      );
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
      const mergedInitial = filterOutMeshcoreLocallyDeletedContacts(
        mergeStubNodesFromMeshcoreMessages(initial, mapped),
      );
      if (opts?.beforeCommit && !opts.beforeCommit()) return;

      meshcoreLastPersistedNodesRef.current = new Map(mergedInitial);

      setNodes(mergedInitial);
      if (mergedInitial.size > 0) meshcoreNodesAppliedRef.current = true;
      const storeId =
        meshcoreIdentityIdRef.current ??
        meshcorePendingDriverIdentityRef.current ??
        getOfflineIdentityIdForProtocol('meshcore');
      if (storeId) {
        syncNodesMapToIdentityStore(storeId, mergedInitial);
      }
      if (opts?.hydrateMessages && mapped.length > 0) {
        setMessages((prev) => mergeMeshcoreDbHydrationWithLive(prev, mapped));
        // Send/reply/dedup read `messageStore`, so mount hydration has to land there too.
        if (storeId) {
          upsertMessageRecordsForIdentity(storeId, meshcoreHydratedMessageRecords(mapped));
        }
      }
    },
    [],
  );

  useEffect(() => {
    queueMicrotask(() => {
      void reloadMeshcoreNodesFromDb({
        hydrateMessages: true,
        beforeCommit: () =>
          !skipMountDbHydrationCommitRef.current && !meshcoreNodesAppliedRef.current,
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
            const { messages: next, matched } = upgradeMeshcoreCrossTransportMessage(prev, msg);
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
              const { messages: next, matched } = upgradeMeshcoreCrossTransportMessage(prev, msg);
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

  const addMessagesBatch = useCallback((batch: ChatMessage[]) => {
    if (batch.length === 0) return;
    const storeId = meshcoreIdentityIdRef.current;
    const uiMessages: ChatMessage[] = [];
    for (const msg of batch) {
      if (storeId) {
        const result = upsertMeshcoreMessageWithDedup(storeId, msg);
        if (result.inserted || result.storeUpdated) {
          uiMessages.push(result.message);
          const skipSendingRoomPersist =
            result.message.status === 'sending' && isMeshcoreRoomChatMessage(result.message);
          if (!skipSendingRoomPersist) {
            void window.electronAPI.db
              .saveMeshcoreMessage(messageToDbRow(result.message))
              .catch((e: unknown) => {
                console.warn(
                  '[useMeshcoreRuntime] saveMeshcoreMessage (batch) error ' + errLikeToLogString(e),
                );
              });
          }
        }
      } else {
        uiMessages.push(msg);
      }
    }
    if (uiMessages.length === 0) return;
    flushSync(() => {
      setMessages((prev) => {
        let next = prev;
        for (const msg of uiMessages) {
          const incomingKey = meshcoreMessageDedupeKey(msg);
          const exactDup = next.some((m) => meshcoreMessageDedupeKey(m) === incomingKey);
          if (exactDup) {
            if (storeId) {
              next = next.map((m) =>
                meshcoreMessageDedupeKey(m) === incomingKey
                  ? { ...m, receivedVia: msg.receivedVia ?? m.receivedVia }
                  : m,
              );
            }
            continue;
          }
          const crossTransportDup = findMeshcoreCrossTransportDuplicate(next, msg);
          if (crossTransportDup) {
            const { messages: merged, matched } = upgradeMeshcoreCrossTransportMessage(next, msg);
            if (matched) {
              next = merged;
              continue;
            }
          }
          next = trimChatMessagesToMax([...next, msg], MAX_IN_MEMORY_CHAT_MESSAGES);
        }
        return next;
      });
    });
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
        nodes: readMeshcoreNodes(),
      });
      const resolvedId = resolved.senderId;
      const displayName = resolved.displayName;
      const storeId = meshcoreIdentityIdRef.current;
      if (resolvedId !== 0 && shouldApplyMeshcoreContact(resolvedId)) {
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
        resolvedId !== 0 &&
        shouldApplyMeshcoreContact(resolvedId) &&
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
      const prior = storeId ? meshcoreSortedStorePrior(storeId) : [];
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
  }, [addMessage, readMeshcoreNodes]);

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
        const slicedPath = meshcoreContactOutPathBytesForTrace(contact);
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
            ...fromSelfBattery,
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

  const applyMeshcoreNodesToUi = useCallback(
    (nodeMap: Map<number, MeshNode>, opts?: { fromRadio?: boolean }) => {
      // Only a live radio contact list may revive an explicitly deleted id.
      if (opts?.fromRadio) {
        for (const id of nodeMap.keys()) {
          clearMeshcoreLocallyDeletedContact(id);
        }
      }
      const incoming = filterOutMeshcoreLocallyDeletedContacts(nodeMap);
      const prev = filterOutMeshcoreLocallyDeletedContacts(readMeshcoreNodes());
      const mergedForStore = filterOutMeshcoreLocallyDeletedContacts(
        mergeMeshcoreChatStubNodes(prev, incoming),
      );
      setNodes(mergedForStore);
      if (mergedForStore.size > 0) meshcoreNodesAppliedRef.current = true;
      // Publish before React commits — connect-time side effects (room auto-login) filter on hw_model.
      const storeId = resolveMeshcoreStoreIdentityId();
      if (storeId) syncNodesMapToIdentityStore(storeId, mergedForStore);
    },
    [resolveMeshcoreStoreIdentityId, readMeshcoreNodes],
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
      if (!shouldApplyMeshcoreContact(nodeId)) return;
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
      // Path updates change hop counts; debounce a full contacts rebuild for updated outPathLen.
      if (meshcoreContactsRefreshTimerRef.current) {
        clearTimeout(meshcoreContactsRefreshTimerRef.current);
      }
      meshcoreContactsRefreshTimerRef.current = setTimeout(() => {
        meshcoreContactsRefreshTimerRef.current = null;
        const liveConn = connRef.current;
        const buildFn = buildNodesFromContactsRef.current;
        if (!liveConn || !buildFn) return;
        const pendingIds = meshcorePathUpdatePendingRef.current;
        meshcorePathUpdatePendingRef.current = new Set();
        void rebuildMeshcoreContactsAfterPathUpdated({
          conn: liveConn,
          buildNodesFromContacts: buildFn,
          self: selfInfoRef.current,
          myNodeId: myNodeNumRef.current,
          previousNodes: meshcorePreviousNodesBaselineForBuild(),
          pendingPathUpdateNodeIds: pendingIds,
          onContacts: setMeshcoreContactsForTelemetry,
          onNodes: (newNodes) => {
            setNodes(meshcorePathUpdatedNodesMergeUpdater(newNodes));
          },
          onPendingRetained: (retainedIds) => {
            for (const id of retainedIds) meshcorePathUpdatePendingRef.current.add(id);
          },
        });
      }, MESHCORE_PATH_UPDATED_CONTACTS_REBUILD_DEBOUNCE_MS);
      requestChatOutboxDrain('meshcore');
    },
    [meshcorePreviousNodesBaselineForBuild],
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

  const bumpMeshcoreLastDataReceived = useCallback(() => {
    meshcoreLastDataReceivedRef.current = Date.now();
    setState((s) => {
      if (s.status === 'stale') {
        return { ...s, status: 'configured', lastDataReceived: Date.now() };
      }
      return s;
    });
  }, []);

  const stopMeshcoreSerialWatchdog = useCallback(() => {
    if (meshcoreSerialWatchdogRef.current) {
      clearInterval(meshcoreSerialWatchdogRef.current);
      meshcoreSerialWatchdogRef.current = null;
    }
    meshcoreSerialLossCleanupRef.current?.();
    meshcoreSerialLossCleanupRef.current = null;
  }, []);

  const startMeshcoreSerialWatchdog = useCallback(
    (conn: MeshCoreConnection) => {
      if (meshcoreConnectionParamsRef.current?.rfType !== 'serial') return;
      stopMeshcoreSerialWatchdog();
      meshcoreLastDataReceivedRef.current = Date.now();
      meshcoreSerialLossCleanupRef.current = attachMeshcoreSerialTransportLossWatch(
        conn as unknown as Connection & { writable: WritableStream<Uint8Array> },
        () => {
          if (meshcoreIsReconnectingRef.current) return;
          handleMeshcoreConnectionLostRef.current();
        },
      );
      meshcoreSerialWatchdogRef.current = setInterval(() => {
        if (meshcoreIsReconnectingRef.current) return;
        if (meshcoreConnectionParamsRef.current?.rfType !== 'serial') return;
        const identityId =
          meshcoreIdentityIdRef.current ?? meshcorePendingDriverIdentityRef.current;
        const driverLast = identityId
          ? connectionDriver.getLastDataAtForIdentity(identityId)
          : null;
        const lastAt = Math.max(meshcoreLastDataReceivedRef.current, driverLast ?? 0);
        const elapsed = Date.now() - lastAt;
        if (elapsed > SERIAL_DEAD_THRESHOLD_MS) {
          console.warn(
            `[useMeshcoreRuntime] watchdog: serial dead for ${elapsed}ms, triggering reconnect`,
          );
          handleMeshcoreConnectionLostRef.current();
        } else if (elapsed > SERIAL_STALE_THRESHOLD_MS) {
          console.warn(`[useMeshcoreRuntime] watchdog: serial stale for ${elapsed}ms`);
          setState((s) => {
            if (s.status === 'configured' || s.status === 'connected') {
              return { ...s, status: 'stale', lastDataReceived: lastAt };
            }
            return s;
          });
        }
      }, SERIAL_WATCHDOG_INTERVAL_MS);
    },
    [stopMeshcoreSerialWatchdog],
  );

  const meshcoreConnSideEffectsCtx = useMemo<MeshcoreConnSideEffectsCtx>(
    () => ({
      resolveIdentityId: () =>
        meshcoreIdentityIdRef.current ?? meshcorePendingDriverIdentityRef.current,
      meshcoreIdentityIdRef,
      meshcoreDriverConnectedRef,
      connRef,
      lastPacketLogPublishFailureLogAtRef,
      meshcoreContactsRefreshTimerRef,
      meshcoreHookMountedRef,
      meshcoreSessionPathUpdatedNodeIdsRef,
      meshcoreWaitingMessagesPollRef,
      meshcoreConnectTypeRef,
      mqttStatusRef,
      myNodeNumRef,
      nicknameMapRef,
      readNodes: readMeshcoreNodes,
      pendingAcksRef,
      processWaitingMessagesRef,
      pubKeyMapRef,
      pubKeyPrefixMapRef,
      rawPacketsRef,
      repeaterCommandServiceRef,
      selfInfoRef,
      setDeviceLogs,
      setMeshcorePingRouteReadyEpoch,
      setMessages,
      setQueueStatus,
      setRawPackets,
      setSignalTelemetry,
      setState,
      setWaitingMessagesCount,
      setWaitingMessagesSyncActive,
      setWaitingMessagesSyncProgress,
      setWaitingMessagesSilentDrainActive,
      setWaitingMessagesDrainDeferred,
      addMessagesBatch,
      addCliHistoryEntry,
      teardownMeshcoreConnEventListeners,
      handleConnectionLostRef: handleMeshcoreConnectionLostRef,
      meshcoreExplicitDisconnectRef,
      bumpLastDataReceived: bumpMeshcoreLastDataReceived,
    }),
    [
      readMeshcoreNodes,
      addMessagesBatch,
      addCliHistoryEntry,
      teardownMeshcoreConnEventListeners,
      bumpMeshcoreLastDataReceived,
    ],
  );

  useEffect(() => {
    return window.electronAPI.onNobleBleAdapterState((state) => {
      if (state !== 'poweredOn') return;
      if (meshcoreConnectionParamsRef.current?.rfType !== 'ble') {
        const rehydrated = rehydrateMeshcoreConnectionParamsFromStorage();
        if (rehydrated?.rfType !== 'ble') return;
        meshcoreConnectionParamsRef.current = rehydrated;
      }
      if (meshcoreExplicitDisconnectRef.current) {
        console.debug(
          '[useMeshcoreRuntime] BLE adapter poweredOn — skip reconnect (user disconnect)',
        );
        return;
      }
      console.debug('[useMeshcoreRuntime] BLE adapter poweredOn — resetting reconnect budget');
      meshcoreReconnectAttemptRef.current = 0;
      meshcoreReconnectGenerationRef.current += 1;
      meshcoreIsReconnectingRef.current = false;
      bleConnectInProgressRef.current = false;
      void (async () => {
        if (isRendererNobleBlePlatform()) {
          await awaitDualNobleBleMeshtasticSettle(POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS);
        }
        if (meshcoreExplicitDisconnectRef.current) return;
        handleMeshcoreConnectionLostRef.current();
      })().catch((e: unknown) => {
        console.warn(
          '[useMeshcoreRuntime] BLE poweredOn settle/reconnect ' + errLikeToLogString(e),
        );
      });
    });
  }, []);

  useEffect(() => {
    return window.electronAPI.onNobleBleDisconnected((sessionId) => {
      if (sessionId !== 'meshcore') return;
      // prepareRfConnect(tcp|serial) disconnects Noble as intentional teardown. That async
      // disconnect must not call handleMeshcoreConnectionLost — it bumps setupGeneration and
      // aborts the in-flight TCP/serial connect (Mac: BLE auto then manual TCP).
      if (meshcoreConnectTypeRef.current !== 'ble') {
        console.debug(
          `[useMeshcoreRuntime] Noble BLE disconnected — skip (connectType=${meshcoreConnectTypeRef.current ?? 'null'})`,
        );
        return;
      }
      // Defer only before active configure (not meshcoreEverConfiguredRef). Once initConn has
      // marked the session configured, Noble drops must reach handleMeshcoreConnectionLost even
      // if bleConnectInProgress / reconnect open is still true for remaining init work.
      if (
        (bleConnectInProgressRef.current ||
          (meshcoreIsReconnectingRef.current && meshcoreReconnectConnectInFlightRef.current)) &&
        !meshcoreDeviceConfiguredRef.current
      ) {
        meshcoreDeferredReconnectRef.current = true;
        console.debug(
          '[useMeshcoreRuntime] Noble BLE disconnected — defer reconnect until connect settles',
        );
        return;
      }
      if (!meshcoreConnectionParamsRef.current) {
        if (meshcoreExplicitDisconnectRef.current) {
          console.debug(
            '[useMeshcoreRuntime] Noble BLE disconnected — skip reconnect (user disconnect)',
          );
          return;
        }
        const rehydrated = rehydrateMeshcoreConnectionParamsFromStorage();
        if (!rehydrated) {
          console.debug(
            '[useMeshcoreRuntime] Noble BLE disconnected — skip reconnect (no stored session)',
          );
          return;
        }
        meshcoreConnectionParamsRef.current = rehydrated;
        console.debug(
          '[useMeshcoreRuntime] Noble BLE disconnected — rehydrated reconnect params from storage',
        );
      }
      console.warn('[useMeshcoreRuntime] Noble BLE disconnected');
      handleMeshcoreConnectionLostRef.current();
    });
  }, []);

  useEffect(() => {
    const onNobleYieldReleased = () => {
      if (meshcoreConnectionParamsRef.current?.rfType !== 'ble') return;
      if (meshcoreExplicitDisconnectRef.current) return;
      if (meshcoreDriverConnectedRef.current || connRef.current) {
        return;
      }
      if (meshcoreIsReconnectingRef.current || bleConnectInProgressRef.current) {
        console.debug(
          '[useMeshcoreRuntime] Noble BLE yield released — skip nudge (reconnect in progress)',
        );
        return;
      }
      console.debug('[useMeshcoreRuntime] Noble BLE yield released — nudging MeshCore reconnect');
      meshcoreReconnectAttemptRef.current = 0;
      meshcoreIsReconnectingRef.current = false;
      handleMeshcoreConnectionLostRef.current();
    };
    window.addEventListener(NOBLE_BLE_YIELD_RELEASED_EVENT, onNobleYieldReleased);
    return () => {
      window.removeEventListener(NOBLE_BLE_YIELD_RELEASED_EVENT, onNobleYieldReleased);
    };
  }, []);

  const setupEventListeners = useCallback(
    (conn: MeshCoreConnection) => attachMeshcoreConnSideEffects(conn, meshcoreConnSideEffectsCtx),
    [meshcoreConnSideEffectsCtx],
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

  /**
   * Parallel init RPCs can reject with setup AbortError while another await is in flight
   * (e.g. DB cache). Attach early so sibling cancels do not surface as unhandledrejection.
   */
  const observeMeshcoreSetupAbort = useCallback((promise: Promise<unknown>): void => {
    void promise.catch((e: unknown) => {
      if (isMeshcoreSetupAbortError(e)) return;
      console.warn(
        '[useMeshcoreRuntime] observed parallel setup rejection ' + errLikeToLogString(e),
      );
    });
  }, []);

  const refreshMeshcoreAutoaddFromDevice = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      const outcome = await fetchMeshcoreAutoaddConfigFromConn(conn);
      if (outcome.kind === 'ok') {
        setMeshcoreAutoadd(outcome.state);
        return;
      }
      console.debug(
        `[useMeshcoreRuntime] refreshMeshcoreAutoaddFromDevice skipped (${outcome.kind})`,
      );
    } catch (e: unknown) {
      console.warn(
        '[useMeshcoreRuntime] refreshMeshcoreAutoaddFromDevice error ' + errLikeToLogString(e),
      );
    }
  }, []);

  /** Shared post-connection handshake: wire events, fetch self info, contacts, channels. */
  const initConn = useCallback(
    async (conn: MeshCoreConnection, setupGen: number, opts?: { driverIdentityId?: string }) => {
      meshcoreInitConnInFlightRef.current = true;
      try {
        connRef.current = conn;
        meshcoreConnEventListenersTeardownRef.current?.();
        meshcoreConnEventListenersTeardownRef.current = setupEventListeners(conn);

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
            if (isMeshcoreSetupAbortError(e)) return;
            console.warn('[useMeshcoreRuntime] loadMessagesFromDb error ' + errLikeToLogString(e));
          }
        })();

        const initConnPerfStart = performance.now();
        const driverStoreId = opts?.driverIdentityId ?? resolveMeshcoreStoreIdentityId();
        if (driverStoreId) {
          meshcoreIdentityIdRef.current = driverStoreId;
          setMeshcoreIdentityId(driverStoreId);
        }

        const sequentialRadioInit = needsSequentialMeshcoreRadioInit(
          meshcoreConnectTypeRef.current,
        );
        const getSelfInfoStart = performance.now();
        let getContactsStart = getSelfInfoStart;
        let parallelSelfInfoPromise: ReturnType<MeshCoreConnection['getSelfInfo']> | undefined;
        let parallelContactsPromise: Promise<MeshCoreContactRaw[]> | undefined;
        if (!sequentialRadioInit) {
          parallelSelfInfoPromise = awaitUnlessMeshcoreSetupCancelled(
            setupGen,
            conn.getSelfInfo(5000),
          );
          observeMeshcoreSetupAbort(parallelSelfInfoPromise);
          getContactsStart = performance.now();
          parallelContactsPromise = awaitUnlessMeshcoreSetupCancelled(
            setupGen,
            (async () => {
              if (meshcoreConnectTypeRef.current === 'ble') {
                await awaitDualNobleBleMeshtasticSettle();
              }
              return withTimeout(conn.getContacts(), MESHCORE_INIT_TIMEOUT_MS, 'getContacts');
            })(),
          );
          observeMeshcoreSetupAbort(parallelContactsPromise);
          const channelsPromise = awaitUnlessMeshcoreSetupCancelled(
            setupGen,
            withTimeout(conn.getChannels(), MESHCORE_INIT_TIMEOUT_MS, 'getChannels'),
          );
          void (async () => {
            try {
              const rawChannels = await channelsPromise;
              setChannels(
                dedupeChannelPillsByIndex(
                  rawChannels.map((c) => ({ index: c.channelIdx, name: c.name, secret: c.secret })),
                ),
              );
            } catch (e) {
              if (isMeshcoreSetupAbortError(e)) return;
              console.warn('[useMeshcoreRuntime] getChannels error ' + errLikeToLogString(e));
            }
          })();
        }

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
            const cachedNodes = buildMeshcoreNodeMapFromDb(contactRows, savedNodes, mapped);
            dbCacheNodeCount = cachedNodes.size;
            meshcoreLastPersistedNodesRef.current = new Map(cachedNodes);
            applyMeshcoreNodesToUi(cachedNodes);
          } catch (e) {
            if (isMeshcoreSetupAbortError(e)) throw e;
            console.warn(
              '[useMeshcoreRuntime] initConn db cache hydrate failed ' + errLikeToLogString(e),
            );
          }
        }
        const dbCacheMs = Math.round(performance.now() - dbCacheStart);
        console.debug(
          `[useMeshcoreRuntime] initConn dbCache→UI ${dbCacheMs}ms (${dbCacheNodeCount} nodes)`,
        );

        // TCP: ConnectionDriver.discoverSelf already ran getSelfInfo — reuse to avoid a second
        // companion RPC that SoftAP/OpenHop often FINs after (Neal/Fuzzy).
        const reusedDiscoverSelf =
          sequentialRadioInit && meshcoreConnectTypeRef.current === 'tcp'
            ? takeMeshcoreDiscoverSelfCache(conn)
            : undefined;
        const rawInfo =
          reusedDiscoverSelf ??
          (sequentialRadioInit
            ? await awaitUnlessMeshcoreSetupCancelled(setupGen, conn.getSelfInfo(5000))
            : await parallelSelfInfoPromise!);
        const getSelfInfoMs = Math.round(performance.now() - getSelfInfoStart);
        console.debug(
          reusedDiscoverSelf
            ? `[useMeshcoreRuntime] initConn getSelfInfo ${getSelfInfoMs}ms (reused discoverSelf)`
            : `[useMeshcoreRuntime] initConn getSelfInfo ${getSelfInfoMs}ms`,
        );
        const info = enrichMeshCoreSelfInfo(rawInfo);
        setSelfInfo(info);
        setState((prev) => ({ ...prev, status: 'connected' }));

        const myNodeId = pubkeyToNodeId(info.publicKey);
        persistMeshcoreSelfNodeId(myNodeId);
        tryPersistMeshcorePublicKeyFromRadio(info.publicKey);
        const transportType = meshcoreConnectTypeRef.current;
        // Latch session readiness after self-info (reconnect / FIN races), but keep UI status at
        // `connected` until the contacts dump settles. Promoting `configured` early starts App
        // flood-advert, stats poll, and static-GPS writes that interleave with getContacts —
        // SoftAP then FINs mid-dump and meshcore.js Ok/Err listeners race (first-connect hang).
        const configureBeforeContactsDump = true;
        setState((prev) => ({
          ...prev,
          myNodeNum: myNodeId,
          status: 'connected',
          connectionLoss: false,
          serialNeedsReselect: false,
        }));
        meshcoreDeviceConfiguredRef.current = true;
        meshcoreEverConfiguredRef.current = true;
        if (getStoredMeshProtocol() === 'meshcore') {
          useDiagnosticsStore.getState().migrateForeignLoraFromZero(myNodeId);
        }

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
          // MeshCore protocol ingress owns every inbound push; companion RPCs
          // (stats, repeater admin) remain hook-owned request/response paths.
          const ingress = attachMeshcoreProtocolIngress(
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
            rawPacketsForHopCorrelation: () => rawPacketsRef.current,
          });
          setConnection(identityId, {
            status: 'connected',
            connectionType: transportType === 'tcp' ? 'http' : transportType,
            myNodeNum: myNodeId,
          });
        }

        const promoteConfiguredAfterContactsDump = (): void => {
          setState((prev) => ({
            ...prev,
            myNodeNum: myNodeId,
            status: 'configured',
            connectionLoss: false,
            serialNeedsReselect: false,
          }));
          meshcoreDeviceConfiguredRef.current = true;
          meshcoreEverConfiguredRef.current = true;
          if (identityId) {
            setConnection(identityId, {
              status: 'configured',
              connectionType: transportType === 'tcp' ? 'http' : transportType,
              myNodeNum: myNodeId,
            });
          }
        };

        // TCP: after session latch, peer FIN during contacts dump is tolerated (do not abort initConn).
        // Before latch (should not happen for TCP now), dead bridge still aborts.
        const assertInitConnStillLive = (): void => {
          if (meshcoreSetupGenerationRef.current !== setupGen) {
            throw new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError');
          }
          if (transportType === 'tcp' && meshcoreDeviceConfiguredRef.current) {
            return;
          }
          const tcpBurstOk = transportType === 'tcp' && meshcoreTcpInitBurstCapturedRef.current;
          if (tcpBurstOk) return;
          if (transportType === 'tcp' && meshcoreTcpBridgeDeadRef.current) {
            throw new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError');
          }
          if (transportType === 'tcp' && connRef.current !== conn) {
            throw new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError');
          }
        };

        if (sequentialRadioInit) {
          getContactsStart = performance.now();
        }
        // TCP only: FIN during dump must not reconnect-loop (BLE/serial ignore this latch path).
        meshcoreTcpContactsDumpInFlightRef.current = transportType === 'tcp';
        let contactsRaw: MeshCoreContactRaw[] = [];
        let contactsDumpOk = false;
        try {
          contactsRaw = sequentialRadioInit
            ? await awaitUnlessMeshcoreSetupCancelled(
                setupGen,
                withTimeout(conn.getContacts(), MESHCORE_INIT_TIMEOUT_MS, 'getContacts'),
              )
            : await parallelContactsPromise!;
          contactsDumpOk = true;
        } catch (e) {
          if (
            configureBeforeContactsDump &&
            meshcoreDeviceConfiguredRef.current &&
            meshcoreSetupGenerationRef.current === setupGen
          ) {
            if (transportType === 'tcp') {
              meshcoreTcpBridgeDeadRef.current = true;
            }
            console.warn(
              '[useMeshcoreRuntime] initConn getContacts failed after configured — keeping session ' +
                errLikeToLogString(e),
            );
            contactsRaw = [];
            contactsDumpOk = false;
          } else {
            throw e;
          }
        } finally {
          meshcoreTcpContactsDumpInFlightRef.current = false;
        }
        const getContactsMs = Math.round(performance.now() - getContactsStart);
        console.debug(
          `[useMeshcoreRuntime] initConn getContacts ${getContactsMs}ms (total ${Math.round(performance.now() - initConnPerfStart)}ms)`,
        );
        // Contact payload held (or dump soft-failed) — TCP peer FIN from here is non-fatal.
        if (transportType === 'tcp') {
          meshcoreTcpInitBurstCapturedRef.current = true;
        }
        // Fuzzy SoftAP: peer FIN often lands between getContacts resolve and contacts→UI —
        // abort before DB/UI work when burst was not yet captured (pre-TCP path above).
        assertInitConnStillLive();
        // Do not mark-all-off-radio + apply an empty dump on soft-fail — that would wipe the
        // dbCache→UI hydration shown before getContacts (SQLite contacts already on screen).
        let previousNodesBaseline = meshcorePreviousNodesBaselineForBuild();
        let newNodes = previousNodesBaseline;
        if (contactsDumpOk) {
          try {
            await window.electronAPI.db.markAllMeshcoreContactsOffRadio();
          } catch (e) {
            console.warn(
              '[useMeshcoreRuntime] initConn markAllMeshcoreContactsOffRadio failed ' +
                errLikeToLogString(e),
            );
          }
          assertInitConnStillLive();
          const contacts = contactsRaw.map(meshcoreContactRawFromDevice);
          setMeshcoreContactsForTelemetry(contacts);
          previousNodesBaseline = meshcorePreviousNodesBaselineForBuild();
          newNodes = await awaitUnlessMeshcoreSetupCancelled(
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
          assertInitConnStillLive();
          applyMeshcoreNodesToUi(newNodes, { fromRadio: true });
          if (identityId) {
            repairMeshcoreChannelSenderIdsInStore(identityId);
          }
          const contactsToUiMs = Math.round(performance.now() - initConnPerfStart);
          console.debug(
            `[useMeshcoreRuntime] initConn contacts→UI ${contactsToUiMs}ms (${newNodes.size} nodes)`,
          );
          void deferMeshcoreDbContactMerge(newNodes, previousNodesBaseline);
        } else {
          console.debug(
            '[useMeshcoreRuntime] initConn contacts dump soft-failed — preserving dbCache hydration',
          );
        }
        promoteConfiguredAfterContactsDump();
        assertInitConnStillLive();
        const tcpBurstDeadBridge = isMeshcoreTcpBurstDeadBridge({
          transportType,
          burstCaptured: meshcoreTcpInitBurstCapturedRef.current,
          bridgeDead: meshcoreTcpBridgeDeadRef.current,
        });
        // Room auto-login after contacts sync (not overlapping the dump). TCP also needs a live
        // bridge after channels below.
        if (transportType !== 'tcp') {
          triggerRoomAutoLoginRef.current();
        }

        if (sequentialRadioInit) {
          const skipChannelsForDeadBurst = isMeshcoreTcpBurstDeadBridge({
            transportType,
            burstCaptured: meshcoreTcpInitBurstCapturedRef.current,
            bridgeDead: meshcoreTcpBridgeDeadRef.current,
          });
          if (skipChannelsForDeadBurst) {
            console.debug(
              '[useMeshcoreRuntime] initConn getChannels skipped (TCP burst-complete, bridge dead)',
            );
          } else {
            assertInitConnStillLive();
            const getChannelsStart = performance.now();
            try {
              // Race: peer FIN after burst must not hang getChannels until MESHCORE_INIT_TIMEOUT.
              const channelsWork = withTimeout(
                conn.getChannels(),
                MESHCORE_INIT_TIMEOUT_MS,
                'getChannels',
              );
              const rawChannels = await awaitUnlessMeshcoreSetupCancelled(
                setupGen,
                (async () => {
                  let settled = false;
                  const deadWatch =
                    transportType === 'tcp'
                      ? new Promise<never>((_, reject) => {
                          const id = setInterval(() => {
                            if (
                              settled ||
                              !isMeshcoreTcpBurstDeadBridge({
                                transportType,
                                burstCaptured: meshcoreTcpInitBurstCapturedRef.current,
                                bridgeDead: meshcoreTcpBridgeDeadRef.current,
                              })
                            ) {
                              return;
                            }
                            clearInterval(id);
                            reject(new Error('meshcore:tcp-write: no active socket'));
                          }, 20);
                          // Attach .catch before finally cleanup so a losing race rejection
                          // cannot become an unhandled rejection after Promise.race settles.
                          void channelsWork
                            .catch(() => {
                              // catch-no-log-ok consumed; original rejection still races via channelsWork
                            })
                            .finally(() => {
                              settled = true;
                              clearInterval(id);
                            });
                        })
                      : null;
                  return deadWatch
                    ? await Promise.race([channelsWork, deadWatch])
                    : await channelsWork;
                })(),
              );
              setChannels(
                dedupeChannelPillsByIndex(
                  rawChannels.map((c) => ({ index: c.channelIdx, name: c.name, secret: c.secret })),
                ),
              );
              const getChannelsMs = Math.round(performance.now() - getChannelsStart);
              console.debug(
                `[useMeshcoreRuntime] initConn getChannels ${getChannelsMs}ms (${rawChannels.length} channels)`,
              );
            } catch (e) {
              if (isMeshcoreSetupAbortError(e)) throw e;
              // Burst already held: soft-skip channels on dead bridge rather than abort configured.
              if (meshcoreTcpInitBurstCapturedRef.current && isMeshcoreTcpTransportDeadError(e)) {
                meshcoreTcpBridgeDeadRef.current = true;
                if (
                  shouldDeferMeshcoreTcpReconnectAfterBurst({
                    burstCaptured: true,
                    everConfigured: meshcoreEverConfiguredRef.current,
                    deviceConfigured: meshcoreDeviceConfiguredRef.current,
                    initConnInFlight: meshcoreInitConnInFlightRef.current,
                  })
                ) {
                  meshcoreDeferredReconnectRef.current = true;
                }
                console.warn(
                  '[useMeshcoreRuntime] getChannels skipped after TCP burst (bridge dead) ' +
                    errLikeToLogString(e),
                );
              } else {
                rethrowMeshcoreSetupAbortFromTcpDead(e);
                console.warn('[useMeshcoreRuntime] getChannels error ' + errLikeToLogString(e));
                assertInitConnStillLive();
              }
            }
          }
        }

        assertInitConnStillLive();
        // TCP: room auto-login only with a live bridge after the post-configure dump.
        // BLE/serial already triggered room auto-login after contacts above.
        if (configureBeforeContactsDump && transportType === 'tcp') {
          if (!tcpBurstDeadBridge && !meshcoreTcpBridgeDeadRef.current) {
            triggerRoomAutoLoginRef.current();
          } else {
            console.debug(
              '[useMeshcoreRuntime] initConn skip room auto-login (TCP post-configure dump, bridge dead)',
            );
          }
        }

        const skipTcpSocketWork = isMeshcoreTcpBurstDeadBridge({
          transportType,
          burstCaptured: meshcoreTcpInitBurstCapturedRef.current,
          bridgeDead: meshcoreTcpBridgeDeadRef.current,
        });

        if (!skipTcpSocketWork) {
          // Re-resolve map/App GPS after the node store picks up getSelfInfo advert coords (same tick as setNodes is too early).
          requestAnimationFrame(() => {
            queueMicrotask(() => {
              if (meshcoreSetupGenerationRef.current !== setupGen || connRef.current !== conn) {
                return;
              }
              void refreshOurPositionMeshCoreRef.current().catch((e: unknown) => {
                if (isMeshcoreTcpTransportDeadError(e) || isMeshcoreSetupAbortError(e)) return;
                console.debug(
                  '[useMeshcoreRuntime] post-connect refreshOurPosition ' + errLikeToLogString(e),
                );
              });
              void requestTelemetryMeshCoreRef.current(myNodeId).catch((e: unknown) => {
                if (isMeshcoreTcpTransportDeadError(e) || isMeshcoreSetupAbortError(e)) return;
                console.debug(
                  '[useMeshcoreRuntime] post-connect self telemetry (altitude) ' +
                    errLikeToLogString(e),
                );
              });
            });
          });

          // Post-init side-effects — run sequentially to avoid shared Ok/Err listener races
          // with user-initiated commands (e.g. config import right after connect).
          assertInitConnStillLive();
          // Apply saved manual contacts preference
          try {
            const savedManual = localStorage.getItem(MANUAL_CONTACTS_KEY) === 'true';
            if (savedManual) {
              await awaitUnlessMeshcoreSetupCancelled(setupGen, conn.setManualAddContacts());
            }
          } catch (e) {
            if (isMeshcoreSetupAbortError(e)) throw e;
            rethrowMeshcoreSetupAbortFromTcpDead(e);
            console.warn(
              '[useMeshcoreRuntime] setManualAddContacts (init) error ' + errLikeToLogString(e),
            );
          }

          await awaitUnlessMeshcoreSetupCancelled(
            setupGen,
            conn.syncDeviceTime().catch((e: unknown) => {
              rethrowMeshcoreSetupAbortFromTcpDead(e);
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
                rethrowMeshcoreSetupAbortFromTcpDead(e);
                console.warn(
                  '[useMeshcoreRuntime] getBatteryVoltage error ' + errLikeToLogString(e),
                );
              }),
          );

          try {
            await awaitUnlessMeshcoreSetupCancelled(setupGen, refreshMeshcoreAutoaddFromDevice());
          } catch (e) {
            if (isMeshcoreSetupAbortError(e)) throw e;
            rethrowMeshcoreSetupAbortFromTcpDead(e);
            console.warn(
              '[useMeshcoreRuntime] refreshMeshcoreAutoaddFromDevice error ' +
                errLikeToLogString(e),
            );
          }

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
            if (isMeshcoreSetupAbortError(e)) throw e;
            rethrowMeshcoreSetupAbortFromTcpDead(e);
            console.warn(
              '[useMeshcoreRuntime] initConn reapply flood scope failed ' + errLikeToLogString(e),
            );
          }

          try {
            const deviceInfo = await awaitUnlessMeshcoreSetupCancelled(
              setupGen,
              conn.deviceQuery(MESHCORE_DEVICE_QUERY_APP_VER),
            );
            const pathFields = parsePathHashModeFromDeviceQuery(deviceInfo);
            setState((prev) => {
              const next = { ...prev };
              if (deviceInfo?.firmware_build_date) {
                next.firmwareVersion = deviceInfo.firmware_build_date;
              }
              if (pathFields.firmwareVersion) {
                next.firmwareVersion = pathFields.firmwareVersion;
              }
              const mm =
                pathFields.manufacturerModel ??
                meshcoreManufacturerModelFromDeviceQuery(deviceInfo);
              if (mm) {
                next.manufacturerModel = mm;
              }
              if (isMeshcorePathHashMode(pathFields.pathHashMode)) {
                next.pathHashMode = pathFields.pathHashMode;
              }
              return next;
            });

            // Companion is source of truth on connect — do not push App settings onto the radio.
            // Sync UI preference FROM the device so a stamped default (1-byte) cannot fight MeshCore app.
            try {
              if (isMeshcorePathHashMode(pathFields.pathHashMode)) {
                mergeAppSetting(
                  'meshcorePathHashMode',
                  pathFields.pathHashMode,
                  'initConn adopt pathHashMode from radio',
                );
              }
            } catch (e) {
              if (isMeshcoreSetupAbortError(e)) throw e;
              console.warn(
                '[useMeshcoreRuntime] initConn adopt path hash mode failed ' +
                  errLikeToLogString(e),
              );
            }
          } catch (e) {
            if (isMeshcoreSetupAbortError(e)) throw e;
            rethrowMeshcoreSetupAbortFromTcpDead(e);
            // catch-no-log-ok deviceQuery optional for firmware string
          }

          // MQTT private key export runs after other init RPCs to avoid meshcore.js listener races
          // (Linux Web Bluetooth is especially sensitive).
          try {
            await awaitUnlessMeshcoreSetupCancelled(
              setupGen,
              exportAndPersistMeshcoreMqttIdentity(conn, info.publicKey, transportType),
            );
          } catch (e) {
            if (isMeshcoreSetupAbortError(e)) throw e;
            rethrowMeshcoreSetupAbortFromTcpDead(e);
            console.warn(
              '[useMeshcoreRuntime] initConn MQTT identity export failed ' + errLikeToLogString(e),
            );
          }
          assertInitConnStillLive();
          maybeAutoLaunchMeshcoreMqttAfterIdentity();

          // Proactively fetch any messages that queued while disconnected (no Chat banner).
          scheduleMeshcoreWaitingMessagesDrain(
            async () => {
              try {
                await processWaitingMessagesRef.current?.({ showSyncBanner: false });
              } catch (e: unknown) {
                // catch-no-log-ok logMeshcoreWaitingMessagesDrainError handles logging
                logMeshcoreWaitingMessagesDrainError(
                  'initConn: proactive getWaitingMessages failed',
                  e,
                  false,
                );
              }
            },
            {
              isMounted: () => meshcoreHookMountedRef.current,
              onDeferredChange: setWaitingMessagesDrainDeferred,
            },
          );

          // Periodic safety-net poll in case the device never re-sends event 131.
          if (meshcoreWaitingMessagesPollRef.current)
            clearInterval(meshcoreWaitingMessagesPollRef.current);
          meshcoreWaitingMessagesPollRef.current = setInterval(() => {
            if (!meshcoreHookMountedRef.current) return;
            if (!shouldRunMeshcoreWaitingMessagesPeriodicPoll(waitingMessagesCountRef.current)) {
              return;
            }
            scheduleMeshcoreWaitingMessagesDrain(
              async () => {
                try {
                  await processWaitingMessagesRef.current?.({ showSyncBanner: false });
                } catch (e: unknown) {
                  // catch-no-log-ok logMeshcoreWaitingMessagesDrainError handles logging
                  logMeshcoreWaitingMessagesDrainError(
                    'periodic getWaitingMessages failed',
                    e,
                    false,
                  );
                }
              },
              {
                isMounted: () => meshcoreHookMountedRef.current,
                onDeferredChange: setWaitingMessagesDrainDeferred,
              },
            );
          }, MESHCORE_WAITING_MESSAGES_POLL_MS);

          meshcoreRoomReconnectSyncRef.current();
        } else {
          console.debug(
            '[useMeshcoreRuntime] initConn TCP burst-complete with dead bridge — skip post-connect RPCs',
          );
          // Do not auto-launch MQTT here: identity export was skipped with the dead bridge.
          // Reconnect's full init will export JWT then call maybeAutoLaunchMeshcoreMqttAfterIdentity.
        }
        meshcoreEverConfiguredRef.current = true;
      } finally {
        meshcoreInitConnInFlightRef.current = false;
      }
    },
    [
      awaitUnlessMeshcoreSetupCancelled,
      applyMeshcoreNodesToUi,
      buildNodesFromContacts,
      deferMeshcoreDbContactMerge,
      handleMeshcorePathUpdatedFromIngest,
      maybeAutoLaunchMeshcoreMqttAfterIdentity,
      meshcorePreviousNodesBaselineForBuild,
      observeMeshcoreSetupAbort,
      refreshMeshcoreAutoaddFromDevice,
      resolveMeshcoreStoreIdentityId,
      setupEventListeners,
    ],
  );

  const prepareRfConnect = useCallback(
    async (
      type: 'ble' | 'serial' | 'tcp',
      opts?: { preserveReconnectState?: boolean },
    ): Promise<void> => {
      // Always bump: abort in-flight initConn/attach when another connect supersedes
      // (BLE auto-connect vs manual TCP race — openMeshCoreTransport can leave a live
      // meshcore:tcp socket before attachRfSession sets driverConnected).
      meshcoreSetupGenerationRef.current += 1;
      if (type === 'ble' && bleConnectInProgressRef.current) {
        console.debug('[useMeshcoreRuntime] prepareRfConnect BLE superseding in-flight connect');
        bleConnectInProgressRef.current = false;
        meshcoreDeferredReconnectRef.current = false;
      }
      // BLE: keep sticky suppress MAC so Meshtastic NodeDB cannot revive the companion ghost
      // during the open gap. Non-BLE: drop suppress entirely (no MAC-derived ghost risk).
      preserveOrClearMeshcoreBleSuppression(
        type === 'ble',
        resolveLastBlePeripheralId('meshcore') ?? null,
      );
      // Prefer pending (set right after openMeshCoreTransport) so a mid-open supersede can
      // disconnect the driver before attachRfSession latches driverConnected.
      const driverIdentity =
        meshcorePendingDriverIdentityRef.current ??
        (meshcoreDriverConnectedRef.current ? meshcoreIdentityIdRef.current : null);
      const staleConn = connRef.current;
      connRef.current = null;
      if (driverIdentity) {
        meshcoreDriverConnectedRef.current = false;
        meshcorePendingDriverIdentityRef.current = null;
        teardownMeshcoreConnEventListeners({
          driverDisconnect: false,
          driverIdentityId: driverIdentity,
        });
        await connectionDriver.disconnect(driverIdentity).catch((e: unknown) => {
          console.debug(
            '[useMeshcoreRuntime] prepareRfConnect driver disconnect ' + errLikeToLogString(e),
          );
        });
      } else if (staleConn) {
        teardownMeshcoreConnEventListeners({ driverDisconnect: false });
        await staleConn.close().catch((e: unknown) => {
          console.debug('[useMeshcoreRuntime] prepareRfConnect close ' + errLikeToLogString(e));
        });
      }
      // Always clear the main-process TCP bridge. openMeshCoreTransport can leave
      // meshcoreTcpSocket live while driverConnected/connRef are still unset — a racing
      // BLE prepare used to orphan that socket and let TCP init continue with connectType=ble.
      await window.electronAPI.meshcore.tcp.disconnect().catch((e: unknown) => {
        console.debug(
          '[useMeshcoreRuntime] prepareRfConnect tcp.disconnect ' + errLikeToLogString(e),
        );
      });
      meshcoreConnectTypeRef.current = type;
      // Manual / new connect: drop prior-session params so mid-open loss cannot rehydrate
      // stale BLE and prepareRfConnect(ble) while TCP is still opening (Mac race after race-fix).
      if (!opts?.preserveReconnectState) {
        meshcoreConnectionParamsRef.current = null;
      }
      if (type === 'tcp') {
        meshcoreTcpBridgeDeadRef.current = false;
        meshcoreTcpInitBurstCapturedRef.current = false;
        meshcoreTcpContactsDumpInFlightRef.current = false;
        meshcoreInitConnInFlightRef.current = false;
        if (!opts?.preserveReconnectState) {
          meshcoreDeferredReconnectRef.current = false;
        }
      }
      // Manual / new connect cancels background serial rediscovery.
      if (!opts?.preserveReconnectState) {
        serialRediscoveryStopRef.current?.();
        serialRediscoveryStopRef.current = null;
      }
      setState({
        status: 'connecting',
        myNodeNum: 0,
        connectionType: type === 'tcp' ? 'http' : type,
        connectionLoss: false,
        serialNeedsReselect: false,
      });
      meshcoreDeviceConfiguredRef.current = false;
      if (type === 'ble') bleConnectInProgressRef.current = true;
      meshcoreExplicitDisconnectRef.current = false;
      if (!opts?.preserveReconnectState) {
        meshcoreReconnectAttemptRef.current = 0;
        meshcoreIsReconnectingRef.current = false;
        meshcoreRfReconnectRef.current.cancel();
      }
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
      meshcoreConnEventListenersTeardownRef.current?.();
      meshcoreConnEventListenersTeardownRef.current = setupEventListeners(conn);
      await initConn(conn, setupGen, { driverIdentityId });
      if (type === 'serial') {
        const serialPort =
          meshcoreConnectionParamsRef.current?.serialPort ??
          (conn as { port?: SerialPort }).port ??
          null;
        if (meshcoreConnectionParamsRef.current) {
          meshcoreConnectionParamsRef.current.serialPort = serialPort;
        }
        startMeshcoreSerialWatchdog(conn);
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
      if (type === 'ble') {
        bleConnectInProgressRef.current = false;
      }
    },
    [initConn, setupEventListeners, startMeshcoreSerialWatchdog],
  );

  const handleRfConnectFailure = useCallback(
    (type: 'ble' | 'serial' | 'tcp', driverIdentityId?: string): Promise<void> => {
      setState({ status: 'disconnected', myNodeNum: 0, connectionType: null });
      meshcoreDeviceConfiguredRef.current = false;
      // Keep sticky suppress across failed BLE open so NodeDB cannot revive Blue.
      preserveOrClearMeshcoreBleSuppression(
        type === 'ble',
        resolveLastBlePeripheralId('meshcore') ?? null,
      );
      teardownMeshcoreConnEventListeners({
        driverDisconnect: true,
        driverIdentityId,
      });
      connRef.current = null;
      if (type === 'ble') {
        bleConnectInProgressRef.current = false;
      }
      return Promise.resolve();
    },
    [teardownMeshcoreConnEventListeners],
  );

  const finalizeDriverDisconnect = useCallback(
    async (opts?: { disconnectDriver?: boolean }) => {
      const disconnectDriver = opts?.disconnectDriver !== false;
      meshcoreExplicitDisconnectRef.current = true;
      meshcoreEverConfiguredRef.current = false;
      meshcoreDeviceConfiguredRef.current = false;
      meshcoreConnectionParamsRef.current = null;
      // Sticky suppress survives user disconnect so the next Meshtastic configure still
      // skips the companion ghost until a non-BLE transport (or Forget) clears it.
      prearmMeshcoreBleMacSuppressionFromStorage(resolveLastBlePeripheralId('meshcore') ?? null);
      meshcoreIsReconnectingRef.current = false;
      meshcoreReconnectAttemptRef.current = 0;
      meshcoreReconnectGenerationRef.current += 1;
      meshcoreRfReconnectRef.current.cancel();
      meshcoreSetupGenerationRef.current += 1;
      const ackEntries = new Set(pendingAcksRef.current.values());
      for (const e of ackEntries) {
        clearTimeout(e.timeoutId);
      }
      pendingAcksRef.current.clear();
      repeaterCommandServiceRef.current?.clear();

      const usedDriverConnect = meshcoreDriverConnectedRef.current;
      const disconnectConn = connRef.current;
      if (disconnectConn) {
        resetMeshcoreTracePathMultiplexOnDisconnect(disconnectConn);
      }
      resetMeshcoreRepeaterRpcInFlightOnDisconnect();
      repeaterRemoteRpcRef.current = createRepeaterRemoteRpcQueue();
      setMeshcoreRepeaterRpcPending(new Map());
      setMeshcorePingErrors(new Map());
      setMeshcoreStatusErrors(new Map());
      setMeshcoreNeighborErrors(new Map());
      setMeshcoreTelemetryErrors(new Map());
      if (roomAutoLoginRetryTimerRef.current) {
        clearTimeout(roomAutoLoginRetryTimerRef.current);
        roomAutoLoginRetryTimerRef.current = null;
      }
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
      stopMeshcoreSerialWatchdog();
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
    [teardownMeshcoreConnEventListeners, reloadMeshcoreNodesFromDb, stopMeshcoreSerialWatchdog],
  );

  const attemptMeshcoreReconnect = useCallback(async () => {
    const params = meshcoreConnectionParamsRef.current;
    if (!params) {
      meshcoreIsReconnectingRef.current = false;
      return;
    }
    if (meshcoreExplicitDisconnectRef.current) {
      meshcoreIsReconnectingRef.current = false;
      return;
    }

    const maxReconnectAttempts = rfMaxReconnectAttemptsForTransport(params.rfType);
    if (meshcoreReconnectAttemptRef.current >= maxReconnectAttempts) {
      meshcoreIsReconnectingRef.current = false;
      meshcoreReconnectAttemptRef.current = 0;
      meshcoreRfReconnectRef.current.markExhausted();
      if (params.rfType === 'ble') {
        bleConnectInProgressRef.current = false;
      }
      stopMeshcoreSerialWatchdog();
      if (params.rfType === 'serial') {
        const exhaustedSerialPort = params.serialPort ?? null;
        const captured = captureSerialIdentityForRediscovery(exhaustedSerialPort);
        await escalateSerialReconnectExhaustion(exhaustedSerialPort, { forgetPort: false });
        serialRediscoveryStopRef.current?.();
        serialRediscoveryStopRef.current = startSerialRediscovery({
          signature: captured.signature,
          portId: captured.portId,
          onFound: (port) => {
            persistSerialPortIdentity(port);
            if (meshcoreConnectionParamsRef.current?.rfType === 'serial') {
              meshcoreConnectionParamsRef.current.serialPort = port;
            }
            setState((s) => ({
              ...s,
              serialNeedsReselect: false,
              connectionLoss: true,
              status: 'reconnecting',
            }));
            meshcoreIsReconnectingRef.current = true;
            meshcoreReconnectAttemptRef.current = 0;
            // Re-enter through the controller after markExhausted (idle → owner).
            const linkLost = meshcoreRfReconnectRef.current.onLinkLost();
            meshcoreReconnectGenerationRef.current = linkLost.generation;
            if (linkLost.shouldStartOwner) {
              scheduleMeshcoreReconnectAttemptRef.current();
            } else {
              meshcoreDeferredReconnectRef.current = true;
            }
          },
          onTimeout: () => {
            void forgetGrantedSerialPortBestEffort(exhaustedSerialPort);
          },
        });
      }
      setState((s) => ({
        ...s,
        status: 'disconnected',
        connectionType: params.rfType === 'serial' ? 'serial' : null,
        connectionLoss: true,
        serialNeedsReselect: params.rfType === 'serial',
      }));
      return;
    }

    const generation = meshcoreReconnectGenerationRef.current;
    meshcoreReconnectAttemptRef.current += 1;
    meshcoreRfReconnectRef.current.beginAttempt(meshcoreReconnectAttemptRef.current);
    setState((s) => ({
      ...s,
      status: 'reconnecting',
      connectionLoss: true,
      reconnectAttempt: meshcoreReconnectAttemptRef.current,
    }));

    const delay = Math.min(
      2000 * Math.pow(2, meshcoreReconnectAttemptRef.current - 1),
      MESHCORE_MAX_RECONNECT_DELAY_MS,
    );
    console.debug(
      `[useMeshcoreRuntime] reconnect: waiting ${delay}ms before attempt ${meshcoreReconnectAttemptRef.current}/${maxReconnectAttempts}`,
    );
    const delayResult = await delayUnlessSuspended(delay, () =>
      !meshcoreIsReconnectingRef.current
        ? true
        : meshcoreReconnectGenerationRef.current !== generation,
    );
    if (delayResult === 'aborted') {
      // Generation bump during backoff (or cancel) aborted this delay. If a deferred restart was
      // requested, the owning cycle must schedule the next attempt — do not leave isReconnecting
      // true with no further work (n7eal TCP / #792).
      if (
        meshcoreDeferredReconnectRef.current &&
        meshcoreIsReconnectingRef.current &&
        !meshcoreExplicitDisconnectRef.current
      ) {
        meshcoreDeferredReconnectRef.current = false;
        meshcoreRfReconnectRef.current.endAttempt({ keepReconnecting: true });
        scheduleMeshcoreReconnectAttemptRef.current();
        return;
      }
      meshcoreRfReconnectRef.current.endAttempt({
        keepReconnecting: meshcoreIsReconnectingRef.current,
      });
      // Another cycle may still own reconnect (generation bumped while isReconnecting stayed
      // true). Only clear the UI when this cycle was cancelled and nothing else is driving it —
      // otherwise a raced setup-abort / delay abort left status=reconnecting forever (#792).
      if (!meshcoreIsReconnectingRef.current) {
        setState((s) => ({
          ...s,
          status: 'disconnected',
          connectionLoss: true,
        }));
      }
      return;
    }
    if (delayResult === 'suspended') {
      meshcoreIsReconnectingRef.current = false;
      meshcoreRfReconnectRef.current.cancel();
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
      if (
        meshcoreDeferredReconnectRef.current &&
        meshcoreIsReconnectingRef.current &&
        !meshcoreExplicitDisconnectRef.current
      ) {
        meshcoreDeferredReconnectRef.current = false;
        meshcoreRfReconnectRef.current.endAttempt({ keepReconnecting: true });
        scheduleMeshcoreReconnectAttemptRef.current();
        return;
      }
      meshcoreRfReconnectRef.current.endAttempt({
        keepReconnecting: meshcoreIsReconnectingRef.current,
      });
      if (!meshcoreIsReconnectingRef.current) {
        setState((s) => ({
          ...s,
          status: 'disconnected',
          connectionLoss: true,
        }));
      }
      return;
    }

    meshcoreRfReconnectRef.current.beginOpening();
    let opened: Awaited<ReturnType<typeof openMeshCoreTransport>> | undefined;
    const isBleReconnect = params.rfType === 'ble';
    if (meshcoreReconnectConnectInFlightRef.current) {
      console.debug(
        '[useMeshcoreRuntime] reconnect: skip overlapping open (connect already in flight)',
      );
      meshcoreDeferredReconnectRef.current = true;
      meshcoreRfReconnectRef.current.markDirty();
      return;
    }
    meshcoreReconnectConnectInFlightRef.current = true;
    if (isBleReconnect) bleConnectInProgressRef.current = true;
    let attemptActive = true;
    const lateTransport = createBleReconnectTransportCleanup(
      (identityId) => connectionDriver.disconnect(identityId),
      'useMeshcoreRuntime',
    );
    const runReconnectAttempt = async () => {
      await prepareRfConnect(params.rfType, { preserveReconnectState: true });
      if (meshcoreReconnectGenerationRef.current !== generation || !attemptActive) {
        throw new Error('MeshCore reconnect superseded before open');
      }
      opened =
        isBleReconnect && isRendererNobleBlePlatform()
          ? await withNobleBleConnectMutex('meshcore', () =>
              openMeshCoreTransport(params.rfType, {
                blePeripheralId: params.blePeripheralId,
                host: params.rfType === 'tcp' ? (params.httpAddress ?? 'localhost') : undefined,
                portSignature:
                  params.rfType === 'serial' ? (params.serialPortId ?? undefined) : undefined,
              }),
            )
          : await openMeshCoreTransport(params.rfType, {
              blePeripheralId: params.blePeripheralId,
              host: params.rfType === 'tcp' ? (params.httpAddress ?? 'localhost') : undefined,
              portSignature:
                params.rfType === 'serial' ? (params.serialPortId ?? undefined) : undefined,
            });
      if (meshcoreReconnectGenerationRef.current !== generation || !attemptActive) {
        await lateTransport.cleanup(opened.driverIdentityId);
        throw new Error('MeshCore reconnect superseded after open');
      }
      meshcorePendingDriverIdentityRef.current = opened.driverIdentityId;
      await attachRfSession(opened.driverIdentityId, params.rfType);
      if (meshcoreReconnectGenerationRef.current !== generation || !attemptActive) {
        await lateTransport.cleanup(opened.driverIdentityId);
        throw new Error('MeshCore reconnect superseded during attach');
      }
      if (!(await verifyNobleBleRfLink(params.rfType, 'meshcore'))) {
        await lateTransport.cleanup(opened.driverIdentityId);
        throw new Error('RF link lost after MeshCore reconnect attach');
      }
      if (!attemptActive || meshcoreReconnectGenerationRef.current !== generation) {
        await lateTransport.cleanup(opened.driverIdentityId);
        throw new Error('MeshCore reconnect superseded after attach');
      }
      console.debug(
        `[useMeshcoreRuntime] Reconnect succeeded on attempt ${meshcoreReconnectAttemptRef.current}`,
      );
      if (params.rfType === 'ble') {
        const bleIdentityOpts = {
          blePeripheralId: params.blePeripheralId,
          webBluetoothDeviceId: readMeshcoreWebBluetoothDeviceId(opened.conn),
          fallbackLastBlePeripheralId: resolveLastBlePeripheralId('meshcore') ?? null,
        };
        const bleId = resolveConnectedMeshcoreBleIdentity(bleIdentityOpts);
        if (bleId) {
          params.blePeripheralId = bleId;
        }
        commitConnectedMeshcoreBleSuppression(bleIdentityOpts);
      } else {
        clearMeshcoreBleMacSuppression();
      }
      // Burst-complete attach left a dead bridge (OpenHop FIN after contacts). UI is configured
      // from the contacts burst — accept that session. Forcing an immediate live-socket retry
      // loops forever on companions that FIN after every contacts dump (WAN :5054 / SoftAP).
      // Live recovery happens on write-fail / later tcp-disconnected once deviceConfigured.
      if (params.rfType === 'tcp' && meshcoreDeferredReconnectRef.current) {
        meshcoreDeferredReconnectRef.current = false;
        console.debug(
          '[useMeshcoreRuntime] TCP burst-complete reconnect attach — accepting dead bridge (configured)',
        );
      }
      meshcoreReconnectAttemptRef.current = 0;
      meshcoreIsReconnectingRef.current = false;
      meshcoreDeferredReconnectRef.current = false;
      meshcoreRfReconnectRef.current.markSuccess();
      setState((s) => ({
        ...s,
        serialNeedsReselect: false,
        connectionLoss: false,
      }));
      requestChatOutboxDrain('meshcore');
    };
    const reconnectWork = runReconnectAttempt();
    void reconnectWork.catch((e: unknown) => {
      console.debug('[useMeshcoreRuntime] reconnectWork late reject ' + errLikeToLogString(e));
    });
    try {
      // Applied to every transport, not just BLE (constant name is historical): TCP/serial
      // reconnects used to `await reconnectWork` with no ceiling at all. A disconnect that
      // lands while an open+attach is still in flight defers to that attempt settling; without
      // a deadline here, a hang anywhere in openMeshCoreTransport/attachRfSession wedges the
      // whole reconnect state machine forever instead of just failing this attempt and retrying.
      await raceWithDeadline(
        reconnectWork,
        NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS,
        `Reconnect attempt timed out after ${NOBLE_BLE_RECONNECT_ATTEMPT_BUDGET_MS}ms`,
      );
    } catch (err) {
      attemptActive = false;
      // Stop background initConn RPCs (getSelfInfo/getContacts/getChannels/etc.) if open
      // resolved into attach after the budget fired. Not BLE-specific: raceWithDeadline now
      // guards every transport's reconnect attempt, so a TCP/serial attempt can hit this same
      // path — bumping only for BLE here left non-BLE stale setup RPCs free to keep running
      // and apply state after the attempt was already declared failed.
      meshcoreSetupGenerationRef.current += 1;
      if (isMeshcoreSetupAbortError(err)) {
        // Setup abort means connection-lost (or a newer connect) bumped setup generation while
        // this attempt's initConn was still running. Do NOT clear isReconnecting — that flag is
        // what finally's deferred restart and delayUnlessSuspended use to keep the cycle alive.
        // Clearing it here left status=reconnecting with no further attempts (n7eal TCP #792).
        console.debug('[useMeshcoreRuntime] reconnect aborted (setup superseded)');
        if (meshcoreIsReconnectingRef.current) {
          meshcoreDeferredReconnectRef.current = true;
        }
        return;
      }
      await lateTransport.cleanup(opened?.driverIdentityId);
      console.warn(
        `[useMeshcoreRuntime] Reconnect attempt ${meshcoreReconnectAttemptRef.current} failed: ` +
          errLikeToLogString(err),
      );
      // Retry only if this generation is still current. Deferred Noble drops are flushed in finally.
      if (
        !meshcoreDeferredReconnectRef.current &&
        meshcoreIsReconnectingRef.current &&
        meshcoreReconnectGenerationRef.current === generation
      ) {
        scheduleMeshcoreReconnectAttemptRef.current();
      }
    } finally {
      attemptActive = false;
      meshcoreReconnectConnectInFlightRef.current = false;
      if (isBleReconnect) {
        bleConnectInProgressRef.current = false;
      }
      if (meshcoreDeferredReconnectRef.current) {
        meshcoreRfReconnectRef.current.markDirty();
      }
      const settled = meshcoreRfReconnectRef.current.endAttempt({
        keepReconnecting: meshcoreIsReconnectingRef.current,
      });
      if (meshcoreDeferredReconnectRef.current || settled.shouldSchedule) {
        meshcoreDeferredReconnectRef.current = false;
        if (meshcoreIsReconnectingRef.current) {
          console.debug(
            '[useMeshcoreRuntime] reconnect settled — running deferred reconnect after transport drop',
          );
          // Call attempt directly (coalesced) — nested handleMeshcoreConnectionLost re-bumped
          // generation and raced a second backoff loop with this flush (n7eal TCP / #792).
          scheduleMeshcoreReconnectAttemptRef.current();
        }
      }
    }
  }, [attachRfSession, prepareRfConnect, stopMeshcoreSerialWatchdog]);

  useLayoutEffect(() => {
    attemptMeshcoreReconnectRef.current = attemptMeshcoreReconnect;
  }, [attemptMeshcoreReconnect]);

  const scheduleMeshcoreReconnectAttempt = useCallback(() => {
    meshcoreRfReconnectRef.current.scheduleOwner(() => {
      if (!meshcoreIsReconnectingRef.current || meshcoreExplicitDisconnectRef.current) {
        return;
      }
      if (meshcoreReconnectConnectInFlightRef.current) {
        meshcoreDeferredReconnectRef.current = true;
        meshcoreRfReconnectRef.current.markDirty();
        return;
      }
      void attemptMeshcoreReconnectRef.current();
    });
  }, []);
  useLayoutEffect(() => {
    scheduleMeshcoreReconnectAttemptRef.current = scheduleMeshcoreReconnectAttempt;
  }, [scheduleMeshcoreReconnectAttempt]);

  const handleMeshcoreConnectionLost = useCallback(() => {
    if (meshcoreExplicitDisconnectRef.current) {
      console.debug('[useMeshcoreRuntime] skip reconnect (user disconnect)');
      return;
    }
    // Abort in-flight initConn immediately (before async driver teardown). Neal TCP: peer FIN
    // after getContacts raced past a gen bump that used to live only inside the async IIFE.
    meshcoreSetupGenerationRef.current += 1;
    if (
      !meshcoreEverConfiguredRef.current &&
      meshcoreReconnectAttemptRef.current === 0 &&
      !meshcoreIsReconnectingRef.current
    ) {
      const hasStoredSession =
        meshcoreConnectionParamsRef.current != null ||
        rehydrateMeshcoreConnectionParamsFromStorage() != null;
      if (!hasStoredSession) {
        console.debug(
          '[useMeshcoreRuntime] Connection lost before first configure — skip reconnect (auto-connect owns retry)',
        );
        return;
      }
      meshcoreConnectionParamsRef.current ??= rehydrateMeshcoreConnectionParamsFromStorage();
      console.debug(
        '[useMeshcoreRuntime] Connection lost with stored session before everConfigured — reconnecting',
      );
    }
    if (!meshcoreConnectionParamsRef.current) {
      if (meshcoreExplicitDisconnectRef.current) return;
      const rehydrated = rehydrateMeshcoreConnectionParamsFromStorage();
      if (!rehydrated) return;
      meshcoreConnectionParamsRef.current = rehydrated;
    }
    // Single-owner: while a cycle is active, onLinkLost only dirties — never schedules after
    // await disconnect (n7eal TCP dual attempt 2+3 / #792–#796).
    const wasReconnecting = meshcoreIsReconnectingRef.current;
    const linkLost = meshcoreRfReconnectRef.current.onLinkLost();
    meshcoreReconnectGenerationRef.current = linkLost.generation;
    if (!linkLost.shouldStartOwner) {
      meshcoreDeferredReconnectRef.current = true;
    }
    meshcoreDeviceConfiguredRef.current = false;
    // Keep sticky BLE suppress while reconnecting so Meshtastic cannot revive the ghost.
    prearmMeshcoreBleMacSuppressionFromStorage(resolveLastBlePeripheralId('meshcore') ?? null);
    if (!wasReconnecting) {
      console.warn('[useMeshcoreRuntime] Connection lost — initiating reconnect');
      meshcoreIsReconnectingRef.current = true;
    } else {
      console.warn(
        '[useMeshcoreRuntime] Connection lost during reconnect — restarting reconnect cycle',
      );
    }

    void (async () => {
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
      // Owner (attempt finally / delay-abort) schedules follow-ups. Lost-handler must not
      // schedule when a cycle was already active — even if inFlight cleared during await.
      if (!linkLost.shouldStartOwner) {
        meshcoreDeferredReconnectRef.current = true;
        console.debug(
          meshcoreRfReconnectRef.current.phase === 'opening' ||
            meshcoreReconnectConnectInFlightRef.current
            ? '[useMeshcoreRuntime] Connection lost — defer reconnect until in-flight open settles'
            : '[useMeshcoreRuntime] Connection lost during reconnect backoff — defer until delay settles',
        );
        return;
      }
      scheduleMeshcoreReconnectAttemptRef.current();
    })().catch((e: unknown) => {
      console.warn(
        '[useMeshcoreRuntime] handleMeshcoreConnectionLost async ' + errLikeToLogString(e),
      );
    });
  }, [teardownMeshcoreConnEventListeners]);

  // Cleanup on unmount — tear down listeners and release connection/driver.
  useEffect(() => {
    return () => {
      serialRediscoveryStopRef.current?.();
      serialRediscoveryStopRef.current = null;
      teardownMeshcoreConnEventListeners({ driverDisconnect: true });
      const conn = connRef.current;
      connRef.current = null;
      if (conn) {
        void conn.close().catch((e: unknown) => {
          console.debug('[useMeshcoreRuntime] unmount close ' + errLikeToLogString(e));
        });
      }
    };
  }, [teardownMeshcoreConnEventListeners]);

  handleMeshcoreConnectionLostRef.current = handleMeshcoreConnectionLost;

  const onPowerSuspend = useCallback(() => {
    meshcoreReconnectGenerationRef.current += 1;
    meshcoreIsReconnectingRef.current = false;
    meshcoreRfReconnectRef.current.cancel();
  }, []);

  const onPowerResume = useCallback(() => {
    if (!meshcoreConnectionParamsRef.current) {
      if (meshcoreExplicitDisconnectRef.current) {
        console.debug('[useMeshcoreRuntime] power resume — skip reconnect (user disconnect)');
        return;
      }
      const rehydrated = rehydrateMeshcoreConnectionParamsFromStorage();
      if (!rehydrated) {
        console.debug('[useMeshcoreRuntime] power resume — skip reconnect (no stored session)');
        return;
      }
      meshcoreConnectionParamsRef.current = rehydrated;
      console.debug('[useMeshcoreRuntime] power resume — rehydrated reconnect params from storage');
    }
    console.debug('[useMeshcoreRuntime] power resume — resetting reconnect budget');
    meshcoreReconnectAttemptRef.current = 0;
    meshcoreReconnectGenerationRef.current += 1;
    meshcoreIsReconnectingRef.current = false;
    bleConnectInProgressRef.current = false;
    void (async () => {
      if (isRendererNobleBlePlatform() && meshcoreConnectionParamsRef.current?.rfType === 'ble') {
        console.debug(
          '[useMeshcoreRuntime] power resume — waiting for Meshtastic Noble BLE to settle',
        );
        await awaitDualNobleBleMeshtasticSettle(POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS);
      }
      if (meshcoreExplicitDisconnectRef.current) {
        console.debug(
          '[useMeshcoreRuntime] power resume — skip reconnect (user disconnect after settle wait)',
        );
        return;
      }
      console.debug('[useMeshcoreRuntime] power resume — triggering reconnect');
      handleMeshcoreConnectionLostRef.current();
    })().catch((e: unknown) => {
      console.warn('[useMeshcoreRuntime] power resume settle/reconnect ' + errLikeToLogString(e));
    });
  }, []);

  const connect = useCallback(
    async (type: 'ble' | 'serial' | 'tcp', tcpHost?: string, blePeripheralId?: string) => {
      /** Linux MeshCore uses renderer Web Bluetooth (not Noble IPC) — timeout copy must match. */
      const meshcoreBleLinuxWebBluetooth =
        type === 'ble' && navigator.userAgent.toLowerCase().includes('linux');

      await prepareRfConnect(type);
      const connectSetupGen = meshcoreSetupGenerationRef.current;
      // Provisional reconnect target for the intended transport before open/attach completes.
      // Without this, a peer FIN mid-open used lastConnection BLE and tore down TCP.
      meshcoreConnectionParamsRef.current = {
        rfType: type,
        httpAddress: type === 'tcp' ? tcpHost : undefined,
        blePeripheralId: type === 'ble' ? blePeripheralId : undefined,
        serialPortId: type === 'serial' ? localStorage.getItem(LAST_SERIAL_PORT_KEY) : undefined,
        serialPort: null,
      };

      let opened: Awaited<ReturnType<typeof openMeshCoreTransport>> | undefined;
      let connectSucceeded = false;
      try {
        if (type === 'ble' && !meshcoreBleLinuxWebBluetooth && !blePeripheralId) {
          throw new Error('BLE peripheral ID required');
        }
        const openTransport = () =>
          openMeshCoreTransport(type, {
            blePeripheralId,
            host: type === 'tcp' ? (tcpHost ?? 'localhost') : undefined,
          });
        opened =
          type === 'ble' && isRendererNobleBlePlatform()
            ? await withNobleBleConnectMutex('meshcore', openTransport)
            : await openTransport();
        // Latch pending before attach so a racing prepareRfConnect can driver-disconnect
        // this open (attachRfSession previously left a gap where TCP stayed orphaned).
        meshcorePendingDriverIdentityRef.current = opened.driverIdentityId;
        if (meshcoreSetupGenerationRef.current !== connectSetupGen) {
          meshcorePendingDriverIdentityRef.current = null;
          await connectionDriver.disconnect(opened.driverIdentityId).catch((e: unknown) => {
            console.debug(
              '[useMeshcoreRuntime] connect superseded disconnect ' + errLikeToLogString(e),
            );
          });
          if (type === 'tcp') {
            await window.electronAPI.meshcore.tcp.disconnect().catch((e: unknown) => {
              console.debug(
                '[useMeshcoreRuntime] connect superseded tcp.disconnect ' + errLikeToLogString(e),
              );
            });
          }
          throw new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError');
        }
        await attachRfSession(opened.driverIdentityId, type);
        const bleIdentityOpts =
          type === 'ble'
            ? {
                blePeripheralId,
                webBluetoothDeviceId: readMeshcoreWebBluetoothDeviceId(opened.conn),
                fallbackLastBlePeripheralId: resolveLastBlePeripheralId('meshcore') ?? null,
              }
            : null;
        const bleId = bleIdentityOpts ? resolveConnectedMeshcoreBleIdentity(bleIdentityOpts) : null;
        meshcoreConnectionParamsRef.current = {
          rfType: type,
          httpAddress: type === 'tcp' ? tcpHost : undefined,
          blePeripheralId: type === 'ble' ? (bleId ?? undefined) : undefined,
          serialPortId: type === 'serial' ? localStorage.getItem(LAST_SERIAL_PORT_KEY) : undefined,
          serialPort: null,
        };
        if (bleIdentityOpts) {
          commitConnectedMeshcoreBleSuppression(bleIdentityOpts);
        } else {
          clearMeshcoreBleMacSuppression();
        }
        meshcoreExplicitDisconnectRef.current = false;
        meshcoreReconnectAttemptRef.current = 0;
        meshcoreIsReconnectingRef.current = false;
        meshcoreReconnectGenerationRef.current += 1;
        connectSucceeded = true;
        meshcoreEverConfiguredRef.current = true;
        // Neal OpenHop: peer FIN after contacts — initConn completed configured from the burst
        // with a dead bridge. Do not force an immediate live-socket reconnect (companions that
        // FIN after every contacts dump would loop forever). Write-fail / later IPC close
        // reconnect once deviceConfigured is latched.
        if (type === 'tcp' && meshcoreDeferredReconnectRef.current) {
          meshcoreDeferredReconnectRef.current = false;
          console.debug(
            '[useMeshcoreRuntime] TCP burst-complete configure — accepting dead bridge',
          );
        }
      } catch (err) {
        const isSetupAbort = isMeshcoreSetupAbortError(err);
        if (isSetupAbort) {
          await handleRfConnectFailure(type, opened?.driverIdentityId);
          throw err;
        }
        const rawMessage = serializeErrorLike(err) || 'meshcore.errors.connectionFailed';
        const safeMessage = rawMessage.trim() || 'meshcore.errors.connectionFailed';
        const isAlreadyInProgress = /already in progress|Connection already in progress/i.test(
          safeMessage,
        );
        const isMissingServices = /could not find all requested services/i.test(safeMessage);
        const isPeripheralInUse = /already in use by the/i.test(safeMessage);
        const bleTimeoutStage =
          type === 'ble' ? classifyMeshcoreBleTimeoutStage(safeMessage) : 'unknown';
        const isBleConnectTimeout = bleTimeoutStage !== 'unknown';
        const fallbackMessage =
          type === 'ble' && err == null
            ? 'meshcore.errors.bleNoDetails'
            : 'meshcore.errors.connectionFailed';
        const displayMessage =
          safeMessage !== 'meshcore.errors.connectionFailed' && safeMessage !== 'Connection failed'
            ? safeMessage
            : fallbackMessage;
        const timeoutMessage = meshcoreBleLinuxWebBluetooth
          ? bleTimeoutStage === 'protocol-handshake'
            ? 'meshcore.errors.bleTimeoutWebBtHandshake'
            : 'meshcore.errors.bleTimeoutWebBt'
          : bleTimeoutStage === 'protocol-handshake'
            ? 'meshcore.errors.bleTimeoutHandshake'
            : 'meshcore.errors.bleTimeoutNoble';
        const normalizedErr = new Error(
          isAlreadyInProgress
            ? 'meshcore.errors.bleAlreadyInProgress'
            : isMissingServices
              ? 'meshcore.errors.bleMissingServices'
              : isPeripheralInUse
                ? 'meshcore.errors.blePeripheralInUse'
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
        if (type === 'ble') {
          bleConnectInProgressRef.current = false;
          if (meshcoreDeferredReconnectRef.current && !connectSucceeded) {
            meshcoreDeferredReconnectRef.current = false;
            console.debug(
              '[useMeshcoreRuntime] connect settled — running deferred reconnect after Noble drop',
            );
            queueMicrotask(() => handleMeshcoreConnectionLostRef.current());
          }
        }
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
        const attachSerialSession = async () => {
          opened = await openMeshCoreTransport('serial', {
            portSignature: lastSerialPortId,
          });
          await attachRfSession(opened.driverIdentityId, 'serial');
          meshcoreConnectionParamsRef.current = {
            rfType: 'serial',
            serialPortId: lastSerialPortId ?? localStorage.getItem(LAST_SERIAL_PORT_KEY),
            serialPort: null,
          };
          clearMeshcoreBleMacSuppression();
          meshcoreExplicitDisconnectRef.current = false;
          meshcoreReconnectAttemptRef.current = 0;
          meshcoreIsReconnectingRef.current = false;
        };
        try {
          try {
            await attachSerialSession();
          } catch (firstErr) {
            const firstSetupAbort = isMeshcoreSetupAbortError(firstErr);
            if (firstSetupAbort || opened) {
              throw firstErr;
            }
            console.debug(
              '[useMeshcoreRuntime] connectAutomatic serial open failed — retrying once',
            );
            await new Promise<void>((resolve) => {
              setTimeout(resolve, RF_SERIAL_OPEN_RETRY_DELAY_MS);
            });
            opened = undefined;
            await attachSerialSession();
          }
        } catch (err) {
          const isSetupAbort = isMeshcoreSetupAbortError(err);
          if (!isSetupAbort) {
            const normalized = normalizeMeshCoreError(
              err,
              'Serial auto-connect failed (radio did not respond)',
            );
            const stage = opened ? 'attachRfSession' : 'openMeshCoreTransport';
            console.warn(
              `[useMeshcoreRuntime] connectAutomatic serial error stage=${stage} ${errLikeToLogString(normalized)} raw=${errLikeToLogString(err)}`,
            );
            await handleRfConnectFailure('serial', opened?.driverIdentityId);
            throw normalized;
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
    await finalizeDriverDisconnect({ disconnectDriver: true });
  }, [finalizeDriverDisconnect]);

  const sendMessage = useCallback(
    async (text: string, channelIdx: number, destNodeId?: number, replyId?: number) => {
      if (destNodeId !== undefined) {
        if (!connRef.current) {
          throw new Error(MESHCORE_ERR_NOT_CONNECTED);
        }
        const pubKey = pubKeyMapRef.current.get(destNodeId);
        if (!pubKey) {
          throw new Error(
            'Cannot send DM: no encryption key for this contact. Wait for a full contact exchange, refresh contacts, or remove name-only stubs.',
          );
        }
        const sentAt = Date.now();
        const openWireCompat = isMeshcoreOpenWireCompatEnabled();
        const { wireText: textToSend, displayPayload } = resolveMeshcoreOutboundWireText({
          text,
          replyTo: replyId != null ? String(replyId) : undefined,
          channelIndex: channelIdx,
          destination: destNodeId,
          myNodeNum: myNodeNumRef.current,
          messages: readMeshcoreMessages(),
          openWireCompat,
        });
        const replyField: number | undefined =
          replyId != null && displayPayload.trim() && textToSend !== displayPayload
            ? replyId
            : undefined;
        // Optimistically add own message with 'sending' status (DM uses channel -1, not UI sendChannel)
        const tempMsg: ChatMessage = {
          sender_id: myNodeNumRef.current,
          sender_name: selfInfo?.name ?? 'Me',
          payload: displayPayload,
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
        const destNode = getIdentityNode(meshcoreIdentityIdRef.current, destNodeId);
        const hopsAway = destNode?.hops_away ?? 0;
        const hopBasedTimeoutMs =
          MESHCORE_ROOM_LOGIN_HOP_BASE_MS + hopsAway * MESHCORE_ROOM_LOGIN_HOP_INCREMENT_MS;

        try {
          const result = await connRef.current.sendTextMessage(pubKey, textToSend);
          markMeshcoreCompanionTx();
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
        const openWireCompat = isMeshcoreOpenWireCompatEnabled();
        const { wireText: textToSend, displayPayload } = resolveMeshcoreOutboundWireText({
          text,
          replyTo: replyId != null ? String(replyId) : undefined,
          channelIndex: channelIdx,
          myNodeNum: myNodeNumRef.current,
          messages: readMeshcoreMessages(),
          openWireCompat,
        });
        const replyField: number | undefined =
          replyId != null && displayPayload.trim() && textToSend !== displayPayload
            ? replyId
            : undefined;
        try {
          const channelConn = connRef.current;
          if (channelConn) {
            await channelConn.sendChannelTextMessage(channelIdx, textToSend);
            markMeshcoreCompanionTx();
            void fetchAndUpdateLocalStats().catch((e: unknown) => {
              console.warn(
                '[useMeshcoreRuntime] fetchAndUpdateLocalStats (channel send) error ' +
                  errLikeToLogString(e),
              );
            });
            addMessage({
              sender_id: myNodeNumRef.current,
              sender_name: selfInfo?.name ?? 'Me',
              payload: displayPayload,
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
    [addMessage, readMeshcoreMessages, selfInfo, fetchAndUpdateLocalStats],
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
      applyMeshcoreNodesToUi(newNodes, { fromRadio: true });
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

  const applyMeshcorePathHashMode = useCallback(
    async (mode: MeshcorePathHashMode) => {
      const conn = connRef.current;
      if (!conn) throw new Error('Not connected to radio');
      if (!isMeshcorePathHashMode(mode)) {
        throw new Error('Invalid path hash mode');
      }
      const fw = state.firmwareVersion;
      if (mode !== 0 && !meshcoreFirmwareSupportsMultibytePathHash(fw)) {
        throw new Error('Path hash mode requires companion firmware v1.14.0 or newer');
      }
      if (typeof conn.setPathHashMode === 'function') {
        await conn.setPathHashMode(mode);
      } else {
        await setMeshcorePathHashModeOnRadio(conn, mode);
      }
      setState((prev) => ({ ...prev, pathHashMode: mode }));
    },
    [state.firmwareVersion],
  );

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

  const deleteNode = useCallback(
    async (nodeId: number) => {
      // Tombstone first so concurrent MQTT/stub merges cannot resurrect during awaits.
      markMeshcoreLocallyDeletedContact(nodeId);
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
      let radioRemoveFailed = false;
      if (pubKey && connRef.current) {
        try {
          await connRef.current.removeContact(pubKey);
        } catch (e) {
          radioRemoveFailed = true;
          console.warn(
            '[useMeshcoreRuntime] removeContact error ' + meshcoreRemoveContactErrorMessage(e),
          );
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
      const storeId = resolveMeshcoreStoreIdentityId();
      if (storeId) {
        removeNode(storeId, nodeId);
      }
      try {
        await window.electronAPI.db.deleteMeshcoreContact(nodeId);
      } catch (e: unknown) {
        clearMeshcoreLocallyDeletedContact(nodeId);
        console.warn('[useMeshcoreRuntime] deleteMeshcoreContact error ' + errLikeToLogString(e));
      }
      if (radioRemoveFailed) {
        pushAppToast(i18n.t('meshcore.errors.removeContactFailed'), 'warning');
      }
    },
    [resolveMeshcoreStoreIdentityId],
  );

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
                meshcoreRemoveContactErrorMessage(e),
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
        const prevHops = getIdentityNode(meshcoreIdentityIdRef.current, id)?.hops_away;
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
              meshcoreRemoveContactErrorMessage(e),
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
      const existing = getIdentityNode(meshcoreIdentityIdRef.current, nodeId);
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

  const refreshRepeaterContactPathFromRadio = useCallback(
    async (
      nodeId: number,
      storedPath: Uint8Array | undefined,
      pubKey: Uint8Array,
      hopsAway: number | null | undefined,
    ): Promise<MeshcoreRadioContactPathSnapshot> => {
      if (
        storedPath &&
        storedPath.length > 1 &&
        meshcoreIsUsableTraceStoredPath(storedPath, hopsAway, pubKey)
      ) {
        return {
          path: storedPath,
          radioContactPathLen: null,
          radioContactFound: true,
        };
      }
      const conn = resolveMeshcoreConn();
      if (!conn) {
        return meshcoreSnapshotContactPathFromContacts(nodeId, [], storedPath);
      }
      try {
        const contactsRaw = await conn.getContacts();
        const snap = meshcoreSnapshotContactPathFromContacts(
          nodeId,
          contactsRaw.map(meshcoreContactRawFromDevice),
          storedPath,
        );
        if (snap.path && snap.path.length > 0) {
          outPathMapRef.current.set(nodeId, snap.path);
        }
        return snap;
      } catch (e: unknown) {
        console.warn(
          '[useMeshcoreRuntime] refreshRepeaterContactPathFromRadio failed ' +
            errLikeToLogString(e),
        );
        return meshcoreSnapshotContactPathFromContacts(nodeId, [], storedPath);
      }
    },
    [resolveMeshcoreConn],
  );

  const traceRoute = useCallback(
    async (nodeId: number): Promise<boolean> => {
      setMeshcoreRepeaterRpcPending((prev) =>
        setRepeaterAdminRpcPending(prev, nodeId, 'ping', true),
      );
      try {
        return await runMeshcoreRepeaterRpcOnce('trace', nodeId, async () => {
          const pubKey = await ensureNodePubKey(nodeId);
          const connAtEntry = resolveMeshcoreConn();
          if (!pubKey) {
            clearMeshcorePingNoRouteExpiryTimer(nodeId);
            setMeshcorePingErrors((prev) => {
              const next = new Map(prev);
              next.set(nodeId, MESHCORE_ERR_NODE_NOT_FOUND);
              return next;
            });
            return false;
          }
          if (!connAtEntry) {
            const rehydrated =
              meshcoreConnectionParamsRef.current ?? rehydrateMeshcoreConnectionParamsFromStorage();
            if (rehydrated && !meshcoreConnectionParamsRef.current) {
              meshcoreConnectionParamsRef.current = rehydrated;
            }
            if (rehydrated && !meshcoreExplicitDisconnectRef.current) {
              setState((s) => ({ ...s, connectionLoss: true }));
              if (!meshcoreIsReconnectingRef.current) {
                console.debug(
                  '[useMeshcoreRuntime] traceRoute: no live conn — scheduling reconnect',
                );
                queueMicrotask(() => handleMeshcoreConnectionLostRef.current());
              }
            }
            clearMeshcorePingNoRouteExpiryTimer(nodeId);
            setMeshcorePingErrors((prev) => {
              const next = new Map(prev);
              next.set(nodeId, MESHCORE_ERR_NOT_CONNECTED);
              return next;
            });
            return false;
          }
          clearMeshcorePingNoRouteExpiryTimer(nodeId);
          setMeshcorePingErrors((prev) => {
            const next = new Map(prev);
            next.delete(nodeId);
            return next;
          });

          let tracePathHash: string | undefined;
          try {
            const conn = resolveMeshcoreConn();
            if (!conn) {
              throw new Error(MESHCORE_ERR_NOT_CONNECTED);
            }
            const setupGen = meshcoreSetupGenerationRef.current;
            const isTraceAborted = (): boolean =>
              meshcoreSetupGenerationRef.current !== setupGen || resolveMeshcoreConn() !== conn;
            const hopsAway = getIdentityNode(meshcoreIdentityIdRef.current, nodeId)?.hops_away;
            let storedPath = outPathMapRef.current.get(nodeId);
            if (storedPath && !meshcoreIsUsableTraceStoredPath(storedPath, hopsAway, pubKey)) {
              outPathMapRef.current.delete(nodeId);
              storedPath = undefined;
            }
            const contactSnap = await refreshRepeaterContactPathFromRadio(
              nodeId,
              storedPath,
              pubKey,
              hopsAway,
            );
            storedPath = contactSnap.path ?? storedPath;
            let radioContactPathLen = contactSnap.radioContactPathLen;
            let pathFromHistory: Uint8Array | undefined;
            if (!storedPath || storedPath.length <= 1) {
              try {
                const sel = await usePathHistoryStore.getState().ensureBestPathLoaded(nodeId);
                if (sel?.pathBytes?.length !== undefined && sel.pathBytes.length > 1) {
                  pathFromHistory = new Uint8Array(sel.pathBytes);
                }
              } catch {
                // catch-no-log-ok path history optional
              }
            }
            let tracePlan = planMeshcoreRepeaterTraceRoute({
              storedPath,
              hopsAway,
              pubKey,
              radioContactPathLen,
              pathFromHistory,
            });
            let routeStoredPath = tracePlan.storedPath;
            if (routeStoredPath && routeStoredPath.length > 1) {
              outPathMapRef.current.set(nodeId, routeStoredPath);
            }
            const relayKeysForSynth = meshcoreDirectRepeaterRelayPubKeys(
              readMeshcoreNodes(),
              pubKeyMapRef.current,
              nodeId,
            );
            const partialDestPath = routeStoredPath ?? outPathMapRef.current.get(nodeId);
            const canSynthesizePath = meshcoreCanSynthesizeTracePath({
              hopsAway,
              relayKeysForSynth,
              partialDestPath,
              destPubKey: pubKey,
            });
            const primeStrategy = computeMeshcoreTracePrimeStrategy({
              needsRoutePrime: tracePlan.needsRoutePrime,
              pathTooShort: tracePlan.pathTooShort,
              hopsAway,
              hasUsableStoredPath: Boolean(routeStoredPath && routeStoredPath.length > 1),
              canSynthesizePath,
            });
            let routePrimeRan = false;
            let routePrimeMetrics: MeshcoreTraceRoutePrimeMetrics | undefined;
            if (tracePlan.needsRoutePrime && primeStrategy !== 'none') {
              routePrimeRan = true;
              const primed = await primeMeshcoreTraceRouteWithFallback({
                conn,
                nodeId,
                pubKey,
                hopsAway,
                outPathMapRef: outPathMapRef.current,
                existingPath: routeStoredPath,
                initialStrategy: primeStrategy,
                isAborted: isTraceAborted,
                floodWhen: (metrics, hops) =>
                  meshcoreTracePrimeFloodWhenForPing(
                    metrics,
                    hops,
                    canSynthesizePath,
                    primeStrategy,
                  ),
              });
              routePrimeMetrics = primed.metrics;
              if (isTraceAborted()) return false;
              if (primed.metrics) {
                console.debug(
                  '[useMeshcoreRuntime] traceRoute prime metrics ' +
                    formatStructuredLogDetail(primed.metrics as unknown as Record<string, unknown>),
                );
              }
              if (primed.radioContactPathLen != null) {
                radioContactPathLen = primed.radioContactPathLen;
              }
              if (primed.path && primed.path.length > 0) {
                routeStoredPath = primed.path;
              }
              if (
                (!routeStoredPath || routeStoredPath.length <= 1) &&
                radioContactPathLen != null &&
                radioContactPathLen >= 0
              ) {
                try {
                  const selPrime = await usePathHistoryStore
                    .getState()
                    .ensureBestPathLoaded(nodeId);
                  if (selPrime?.pathBytes?.length !== undefined && selPrime.pathBytes.length > 1) {
                    const fromHistPrime = new Uint8Array(selPrime.pathBytes);
                    outPathMapRef.current.set(nodeId, fromHistPrime);
                    routeStoredPath = fromHistPrime;
                  }
                } catch {
                  // catch-no-log-ok path history optional
                }
              }
            }
            tracePlan = planMeshcoreRepeaterTraceRoute({
              storedPath: routeStoredPath,
              hopsAway,
              pubKey,
              radioContactPathLen,
              pathFromHistory,
            });
            const uiSaysMultiHop = tracePlan.uiSaysMultiHop;
            const radioSaysMultiHop = tracePlan.radioSaysMultiHop;
            const pathResolved = resolveMeshcoreTraceOutPathSeed({
              tracePlan,
              pubKey,
              hopsAway,
              nodeId,
              nodes: readMeshcoreNodes(),
              pubKeyByNodeId: pubKeyMapRef.current,
              pathByNodeId: outPathMapRef.current,
            });
            const outPath = pathResolved.outPath;
            const floodPrimeExhausted =
              routePrimeRan &&
              routePrimeMetrics?.strategy === 'flood' &&
              !routePrimeMetrics.usableAfterPrime &&
              !routePrimeMetrics.path129Received;
            const hasResolvedPath =
              meshcoreIsUsableTraceStoredPath(outPath, hopsAway, pubKey) &&
              (pathResolved.composed ||
                Boolean(tracePlan.storedPath) ||
                (routePrimeRan && !floodPrimeExhausted));
            const shouldAbortPing = evaluateMeshcorePingRouteAbort({
              floodPrimeExhausted,
              pathResolvedComposed: pathResolved.composed,
              pathTooShort: tracePlan.pathTooShort,
              hopsAway,
              uiSaysMultiHop,
              radioSaysMultiHop,
              hasResolvedPath,
            });
            if (pathResolved.composed) {
              outPathMapRef.current.set(nodeId, outPath);
              console.debug(
                `[useMeshcoreRuntime] traceRoute: using synthesized multi-hop path for node ${nodeId} (${outPath.length} bytes)`,
              );
            }
            if (shouldAbortPing) {
              console.debug(
                '[useMeshcoreRuntime] traceRoute pingNoRoute ' +
                  formatStructuredLogDetail({
                    nodeId,
                    hopsAway: hopsAway ?? null,
                    radioContactPathLen,
                    pathLen: outPath.length,
                    primeStrategy,
                  }),
              );
              clearMeshcorePingNoRouteExpiryTimer(nodeId);
              setMeshcorePingErrors((prev) => {
                const next = new Map(prev);
                next.set(nodeId, MESHCORE_PING_NO_ROUTE_ERROR_MSG);
                return next;
              });
              return false;
            }
            const attemptPathBytes = Array.from(outPath);
            tracePathHash =
              attemptPathBytes.length > 0 ? computePathHash(attemptPathBytes) : undefined;
            let tracePathInUse = outPath;
            let result;
            const firstTrace = startMeshcoreTracePathMultiplexed(
              conn,
              tracePathInUse,
              MESHCORE_TRACE_TIMEOUT_MS,
              repeaterRemoteRpcRef.current,
            );
            try {
              result = await withTimeout(
                firstTrace.promise,
                MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
                'meshcoreTracePing',
              );
            } catch (firstTraceError: unknown) {
              firstTrace.cancel('superseded or timed out');
              try {
                await firstTrace.promise;
              } catch {
                // catch-no-log-ok first trace rejected after cancel; direct retry may proceed
              }
              const directRetryEligible = meshcoreTraceDirectRetryEligible(
                hopsAway,
                tracePathInUse.length,
              );
              if (!directRetryEligible) throw firstTraceError;
              tracePathInUse = new Uint8Array(pubKey);
              const retryTrace = startMeshcoreTracePathMultiplexed(
                conn,
                tracePathInUse,
                MESHCORE_TRACE_TIMEOUT_MS,
                repeaterRemoteRpcRef.current,
              );
              try {
                result = await withTimeout(
                  retryTrace.promise,
                  MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
                  'meshcoreTracePingDirectRetry',
                );
              } catch (retryErr: unknown) {
                retryTrace.cancel('direct retry timed out');
                throw retryErr;
              }
            }
            const traceHops = meshcoreTracePathLenToHops(result.pathLen);
            const verifiedOutPath = meshcoreTraceResultToOutPathBytes(
              result.pathLenByte,
              result.pathHashes,
              pubKey,
              result.flags,
            );
            if (verifiedOutPath.length > 0) {
              outPathMapRef.current.set(nodeId, verifiedOutPath);
              const verifiedPathBytes = Array.from(verifiedOutPath);
              usePathHistoryStore
                .getState()
                .recordPathUpdated(nodeId, verifiedPathBytes, traceHops, false);
            }
            const convertedSnrs = (result.pathSnrs ?? []).map(
              (s) => s * MESHCORE_RPC_SNR_RAW_TO_DB,
            );
            const convertedLastSnr = result.lastSnr;
            setMeshcoreTraceResults((prev) => {
              const next = new Map(prev);
              next.set(nodeId, {
                pathLen: result.pathLen,
                pathHashes: result.pathHashes ?? [],
                hashSizeBytes: meshcorePathHashSizeFromTraceFlags(result.flags),
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
            const existingForRf = getIdentityNode(meshcoreIdentityIdRef.current, nodeId);
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
            return true;
          } catch (e: unknown) {
            const failedHops = getIdentityNode(meshcoreIdentityIdRef.current, nodeId)?.hops_away;
            if ((failedHops ?? 0) >= 1) {
              outPathMapRef.current.delete(nodeId);
            }
            const rawErr = meshcoreTraceRouteRejectReason(e);
            const errMsg = rawErr && rawErr !== 'undefined' ? rawErr : MESHCORE_ERR_REQUEST_FAILED;
            const isTimeout =
              errMsg.toLowerCase().includes('timeout') ||
              errMsg.toLowerCase().includes('timed out');
            const friendlyRef: MeshcoreUserMessage = isTimeout
              ? {
                  key: 'meshcore.errors.requestTimedOut',
                  params: { seconds: Math.round(MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS / 1000) },
                }
              : { key: MESHCORE_ERR_REQUEST_FAILED, params: { detail: errMsg } };
            const friendlyErr = meshcoreStoredUserMessage(friendlyRef);
            if (tracePathHash) {
              usePathHistoryStore.getState().recordOutcome(nodeId, tracePathHash, false);
            }
            setMeshcorePingErrors((prev) => {
              const next = new Map(prev);
              next.set(nodeId, friendlyErr);
              return next;
            });
            console.warn('[useMeshcoreRuntime] traceRoute error ' + errLikeToLogString(e));
            return false;
          }
        });
      } finally {
        setMeshcoreRepeaterRpcPending((prev) =>
          setRepeaterAdminRpcPending(prev, nodeId, 'ping', false),
        );
      }
    },
    [
      bumpMeshcoreNodeLastHeardFromRpc,
      clearMeshcorePingNoRouteExpiryTimer,
      ensureNodePubKey,
      readMeshcoreNodes,
      refreshRepeaterContactPathFromRadio,
      resolveMeshcoreConn,
    ],
  );

  const requestRepeaterStatus = useCallback(
    async (nodeId: number) => {
      setMeshcoreRepeaterRpcPending((prev) =>
        setRepeaterAdminRpcPending(prev, nodeId, 'status', true),
      );
      try {
        return await runMeshcoreRepeaterRpcOnce('status', nodeId, async () => {
          const pubKey = await ensureNodePubKey(nodeId);
          if (!pubKey) {
            const msg = MESHCORE_ERR_NODE_NOT_FOUND;
            setMeshcoreStatusErrors((prev) => {
              const next = new Map(prev);
              next.set(nodeId, msg);
              return next;
            });
            throw new Error(msg);
          }
          if (!resolveMeshcoreConn()) {
            setMeshcoreStatusErrors((prev) => {
              const next = new Map(prev);
              next.set(nodeId, MESHCORE_ERR_NOT_CONNECTED);
              return next;
            });
            throw new Error(MESHCORE_ERR_NOT_CONNECTED);
          }
          const timeoutMs = MESHCORE_STATUS_TIMEOUT_MS;
          setMeshcoreStatusErrors((prev) => {
            const next = new Map(prev);
            next.delete(nodeId);
            return next;
          });
          try {
            const conn = resolveMeshcoreConn();
            if (!conn) {
              throw new Error(MESHCORE_ERR_NOT_CONNECTED);
            }
            await awaitMeshcoreRepeaterPingSettleForNode(nodeId);
            const raw = await runMeshcoreRepeaterStatusRequest(
              conn,
              pubKey,
              timeoutMs,
              repeaterRemoteRpcRef.current,
              awaitMeshcoreRepeaterAdminRfIdle,
            );
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
                    '[useMeshcoreRuntime] updateMeshcoreContactLastRf error ' +
                      errLikeToLogString(e),
                  );
                });
            }
          } catch (e: unknown) {
            const rawErr = e instanceof Error ? e.message : String(e);
            const errMsg = rawErr && rawErr !== 'undefined' ? rawErr : MESHCORE_ERR_REQUEST_FAILED;
            const friendlyErr = meshcoreStoredUserMessage(
              meshcoreRepeaterRpcErrorMessage(
                errMsg,
                meshcoreRepeaterAdminRpcErrorBudgetMs(errMsg, timeoutMs),
              ),
            );
            setMeshcoreStatusErrors((prev) => {
              const next = new Map(prev);
              next.set(nodeId, friendlyErr);
              return next;
            });
            console.warn(
              '[useMeshcoreRuntime] requestRepeaterStatus error ' + errLikeToLogString(e),
            );
            throw new Error(friendlyErr);
          }
        });
      } finally {
        setMeshcoreRepeaterRpcPending((prev) =>
          setRepeaterAdminRpcPending(prev, nodeId, 'status', false),
        );
      }
    },
    [bumpMeshcoreNodeLastHeardFromRpc, ensureNodePubKey, resolveMeshcoreConn],
  );

  const requestTelemetry = useCallback(
    async (nodeId: number) => {
      setMeshcoreRepeaterRpcPending((prev) =>
        setRepeaterAdminRpcPending(prev, nodeId, 'telemetry', true),
      );
      try {
        return await runMeshcoreRepeaterRpcOnce('telemetry', nodeId, async () => {
          setMeshcoreTelemetryErrors((prev) => {
            const next = new Map(prev);
            next.delete(nodeId);
            return next;
          });
          const pubKey = await ensureNodePubKey(nodeId);
          if (!pubKey) {
            const msg = MESHCORE_ERR_NODE_NOT_FOUND;
            setMeshcoreTelemetryErrors((prev) => {
              const next = new Map(prev);
              next.set(nodeId, msg);
              return next;
            });
            throw new Error(msg);
          }
          if (!resolveMeshcoreConn()) {
            setMeshcoreTelemetryErrors((prev) => {
              const next = new Map(prev);
              next.set(nodeId, MESHCORE_ERR_NOT_CONNECTED);
              return next;
            });
            throw new Error(MESHCORE_ERR_NOT_CONNECTED);
          }
          const timeoutMs = MESHCORE_TELEMETRY_TIMEOUT_MS;
          try {
            const conn = resolveMeshcoreConn();
            if (!conn) {
              throw new Error(MESHCORE_ERR_NOT_CONNECTED);
            }
            await awaitMeshcoreRepeaterPingSettleForNode(nodeId);
            await meshcoreTryRemoteServerLogin(
              conn,
              nodeId,
              pubKey,
              getIdentityNode(meshcoreIdentityIdRef.current, nodeId)?.hw_model,
              repeaterRemoteRpcRef.current,
            );
            const raw = await runMeshcoreRepeaterTelemetryRequest(
              conn,
              pubKey,
              timeoutMs,
              repeaterRemoteRpcRef.current,
              awaitMeshcoreRepeaterAdminRfIdle,
            );
            let entries: CayenneLppEntry[] = [];
            const lppSensorData = raw.lppSensorData;
            if (lppSensorData) {
              try {
                entries = CayenneLpp.parse(lppSensorData) as CayenneLppEntry[];
              } catch (parseErr: unknown) {
                console.warn(
                  '[useMeshcoreRuntime] requestTelemetry CayenneLpp.parse error ' +
                    errLikeToLogString(parseErr),
                );
              }
            }
            const result: MeshCoreNodeTelemetry = { fetchedAt: Date.now(), entries };
            const temps = assignCayenneTemperatureFields(entries, CayenneLpp.LPP_TEMPERATURE);
            result.temperature = temps.temperature;
            result.mcuTemperature = temps.mcuTemperature;
            for (const entry of entries) {
              if (entry.type === CayenneLpp.LPP_TEMPERATURE) {
                // handled above (env vs MCU by channel)
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
              result.mcuTemperature != null ||
              result.relativeHumidity != null ||
              result.barometricPressure != null;
            if (hasEnv) {
              const pt: EnvironmentTelemetryPoint = {
                timestamp: result.fetchedAt,
                nodeNum: nodeId,
                temperature: result.temperature,
                mcuTemperature: result.mcuTemperature,
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
          } catch (e: unknown) {
            const rawErr = e instanceof Error ? e.message : String(e);
            const errMsg = rawErr && rawErr !== 'undefined' ? rawErr : MESHCORE_ERR_REQUEST_FAILED;
            const friendlyErr = meshcoreStoredUserMessage(
              meshcoreRepeaterRpcErrorMessage(
                errMsg,
                meshcoreRepeaterAdminRpcErrorBudgetMs(errMsg, timeoutMs),
              ),
            );
            setMeshcoreTelemetryErrors((prev) => {
              const next = new Map(prev);
              next.set(nodeId, friendlyErr);
              return next;
            });
            console.warn('[useMeshcoreRuntime] requestTelemetry error ' + errLikeToLogString(e));
            throw new Error(friendlyErr);
          }
        });
      } finally {
        setMeshcoreRepeaterRpcPending((prev) =>
          setRepeaterAdminRpcPending(prev, nodeId, 'telemetry', false),
        );
      }
    },
    [ensureNodePubKey, resolveMeshcoreConn],
  );

  requestTelemetryMeshCoreRef.current = requestTelemetry;

  const requestNeighbors = useCallback(
    async (nodeId: number, opts?: MeshcoreRequestNeighborsOpts) => {
      const offset = Math.max(0, Math.min(0xffff, Math.floor(opts?.offset ?? 0)));
      setMeshcoreRepeaterRpcPending((prev) =>
        setRepeaterAdminRpcPending(prev, nodeId, 'neighbors', true),
      );
      try {
        return await runMeshcoreRepeaterRpcOnce(
          'neighbors',
          nodeId,
          async () => {
            const pubKey = await ensureNodePubKey(nodeId);
            if (!pubKey) {
              const msg = meshcoreStoredUserMessage(MESHCORE_ERR_NODE_NOT_FOUND);
              setMeshcoreNeighborErrors((prev) => {
                const next = new Map(prev);
                next.set(nodeId, msg);
                return next;
              });
              throw new Error(MESHCORE_ERR_NODE_NOT_FOUND);
            }
            if (!resolveMeshcoreConn()) {
              const msg = meshcoreStoredUserMessage(MESHCORE_ERR_NOT_CONNECTED);
              setMeshcoreNeighborErrors((prev) => {
                const next = new Map(prev);
                next.set(nodeId, msg);
                return next;
              });
              throw new Error(MESHCORE_ERR_NOT_CONNECTED);
            }
            const timeoutMs = MESHCORE_NEIGHBORS_TIMEOUT_MS;
            setMeshcoreNeighborErrors((prev) => {
              const next = new Map(prev);
              next.delete(nodeId);
              return next;
            });
            try {
              const conn = resolveMeshcoreConn();
              if (!conn) {
                throw new Error(MESHCORE_ERR_NOT_CONNECTED);
              }
              await awaitMeshcoreRepeaterPingSettleForNode(nodeId);
              const neighbourPrefixLen = 6;
              const reqBytes = buildMeshcoreGetNeighboursRequest({
                count: MESHCORE_NEIGHBORS_PAGE_SIZE,
                offset,
                orderBy: 0,
                pubKeyPrefixLength: neighbourPrefixLen,
              });
              const responseData = await runMeshcoreRepeaterBinaryRequest(
                conn,
                pubKey,
                reqBytes,
                timeoutMs,
                repeaterRemoteRpcRef.current,
                awaitMeshcoreRepeaterAdminRfIdle,
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
                  // parseMeshcoreGetNeighboursResponse already returns dB (int8/4).
                  snr: nb.snr,
                };
              });
              const page: MeshCoreNeighborResult = {
                totalNeighboursCount: raw.totalNeighboursCount,
                neighbours,
                fetchedAt: Date.now(),
              };
              console.debug(
                '[useMeshcoreRuntime] requestNeighbors ok nodeId=' +
                  String(nodeId) +
                  ' offset=' +
                  String(offset) +
                  ' returned=' +
                  String(neighbours.length) +
                  ' total=' +
                  String(raw.totalNeighboursCount),
              );
              setMeshcoreNeighbors((prev) => {
                const outcome = mergeMeshcoreNeighborPage(prev.get(nodeId), page, offset);
                if (outcome.action === 'skip') {
                  return prev;
                }
                const next = new Map(prev);
                next.set(nodeId, outcome.result);
                return next;
              });
              setMeshcoreNeighborErrors((prev) => {
                const next = new Map(prev);
                next.delete(nodeId);
                return next;
              });
            } catch (e: unknown) {
              const rawErr = e instanceof Error ? e.message : String(e);
              const errMsg =
                rawErr && rawErr !== 'undefined' ? rawErr : MESHCORE_ERR_REQUEST_FAILED;
              const friendlyErr = meshcoreStoredUserMessage(
                meshcoreRepeaterRpcErrorMessage(
                  errMsg,
                  meshcoreRepeaterAdminRpcErrorBudgetMs(errMsg, timeoutMs),
                ),
              );
              setMeshcoreNeighborErrors((prev) => {
                const next = new Map(prev);
                next.set(nodeId, friendlyErr);
                return next;
              });
              console.warn('[useMeshcoreRuntime] requestNeighbors error ' + errLikeToLogString(e));
              throw new Error(friendlyErr);
            }
          },
          { coalesceKey: String(offset) },
        );
      } finally {
        setMeshcoreRepeaterRpcPending((prev) =>
          setRepeaterAdminRpcPending(prev, nodeId, 'neighbors', false),
        );
      }
    },
    [ensureNodePubKey, resolveMeshcoreConn],
  );

  const sendRepeaterCliCommand = useCallback(
    async (
      nodeId: number,
      command: string,
      opts?: { confirmedDanger?: boolean },
    ): Promise<string> => {
      setMeshcoreRepeaterRpcPending((prev) =>
        setRepeaterAdminRpcPending(prev, nodeId, 'cli', true),
      );
      try {
        const trimmed = command.trim();
        if (trimmed.length > REPEATER_CLI_MAX_COMMAND_LENGTH) {
          throw new Error(
            serializeMeshcoreUserMessage({
              key: 'repeatersPanel.cliCommandTooLong',
              params: { max: REPEATER_CLI_MAX_COMMAND_LENGTH },
            }),
          );
        }
        if (isMeshcoreRepeaterCliDangerCommand(trimmed) && !opts?.confirmedDanger) {
          throw new Error(serializeMeshcoreUserMessage('meshcore.errors.cliDangerNotConfirmed'));
        }
        const pubKey = pubKeyMapRef.current.get(nodeId);
        if (!pubKey) {
          setMeshcoreCliErrors((prev) => {
            const next = new Map(prev);
            next.set(nodeId, MESHCORE_ERR_NODE_NOT_FOUND);
            return next;
          });
          throw new Error(MESHCORE_ERR_NODE_NOT_FOUND);
        }
        if (!resolveMeshcoreConn()) {
          setMeshcoreCliErrors((prev) => {
            const next = new Map(prev);
            next.set(nodeId, MESHCORE_ERR_NOT_CONNECTED);
            return next;
          });
          throw new Error(MESHCORE_ERR_NOT_CONNECTED);
        }

        setMeshcoreCliErrors((prev) => {
          const next = new Map(prev);
          next.delete(nodeId);
          return next;
        });

        const service = repeaterCommandServiceRef.current ?? createRepeaterCommandService();
        repeaterCommandServiceRef.current ??= service;

        try {
          return await runMeshcoreRepeaterRpcOnce('cli', nodeId, async () => {
            const conn = resolveMeshcoreConn();
            if (!conn) {
              throw new Error(MESHCORE_ERR_NOT_CONNECTED);
            }

            await awaitMeshcoreRepeaterPingSettleForNode(nodeId);
            await meshcoreTryRemoteServerLogin(
              conn,
              nodeId,
              pubKey,
              getIdentityNode(meshcoreIdentityIdRef.current, nodeId)?.hw_model,
              repeaterRemoteRpcRef.current,
            );

            const node = getIdentityNode(meshcoreIdentityIdRef.current, nodeId);
            const trace = meshcoreTraceResults.get(nodeId);
            const hopCount = computeRepeaterCliHopCount(
              node?.hops_away,
              trace != null ? meshcoreTracePathLenToHops(trace.pathLen) : null,
            );
            const timeoutMs = calculateRepeaterCliTimeout(hopCount, trimmed.length);
            const { token, promise } = service.registerPendingCommand(trimmed, [], {
              timeoutMs,
              senderNodeId: nodeId,
            });
            const commandWithToken = service.formatCommandWithToken(trimmed, token);

            addCliHistoryEntry(nodeId, {
              type: 'sent',
              text: trimmed,
              timestamp: Date.now(),
            });

            await repeaterRemoteRpcRef.current(async () => {
              await awaitMeshcoreRepeaterAdminRfIdle();
              await waitForMeshcoreRadioSentAck(
                conn,
                async () => {
                  await conn.sendTextMessage(pubKey, commandWithToken, MESHCORE_TXT_TYPE_CLI_DATA);
                },
                { rejectErrMsg: 'radio rejected repeater CLI command' },
              );
              markMeshcoreCompanionTx();
            });

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
          const errMsg = rawErr && rawErr !== 'undefined' ? rawErr : MESHCORE_ERR_REQUEST_FAILED;
          const friendlyErr = meshcoreStoredUserMessage(
            meshcoreRepeaterRpcErrorMessage(errMsg, MESHCORE_TRACE_TIMEOUT_MS),
          );
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
          console.warn(
            '[useMeshcoreRuntime] sendRepeaterCliCommand error ' + errLikeToLogString(e),
          );
          throw new Error(friendlyErr);
        }
      } finally {
        setMeshcoreRepeaterRpcPending((prev) =>
          setRepeaterAdminRpcPending(prev, nodeId, 'cli', false),
        );
      }
    },
    [
      addCliHistoryEntry,
      bumpMeshcoreNodeLastHeardFromRpc,
      meshcoreTraceResults,
      resolveMeshcoreConn,
    ],
  );

  const resolveRoomLoginHopsForNode = useCallback((nodeId: number): number => {
    return resolveMeshcoreRoomLoginHopsAway(
      getIdentityNode(meshcoreIdentityIdRef.current, nodeId),
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
      ).catch((e: unknown) => {
        console.debug(
          '[useMeshcoreRuntime] meshcoreRoomLoginRouteResolve ' + errLikeToLogString(e),
        );
        return undefined;
      });
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
        throw new Error(MESHCORE_ERR_NOT_CONNECTED);
      }
      if (meshcoreIsRoomLoggedIn(nodeId) && !opts?.forceRelogin) {
        return;
      }
      const guestPassword = opts?.guestPassword ?? password;
      const adminPassword = opts?.adminPassword ?? '';
      const hopsAway = resolveRoomLoginHopsForNode(nodeId);
      const uiHops = getIdentityNode(meshcoreIdentityIdRef.current, nodeId)?.hops_away;
      const outPathLen = outPathMapRef.current.get(nodeId)?.length ?? 0;
      console.debug(
        `[useMeshcoreRuntime] loginRoom node=0x${nodeId.toString(16)} hopsAway=${hopsAway} uiHops=${String(uiHops ?? 'n/a')} outPathLen=${outPathLen}`,
      );
      const loginAbort = new AbortController();
      try {
        await withTimeout(
          (async (): Promise<void> => {
            const activeConn = connRef.current;
            if (!activeConn) {
              throw new Error(MESHCORE_ERR_NOT_CONNECTED);
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
              getIdentityNode(meshcoreIdentityIdRef.current, nodeId),
              storedPath,
              hopsAway,
              (fn) => repeaterRemoteRpcRef.current(fn),
            );
            if (hopsAway > 0 && !pathSync.synced) {
              throw new Error(
                serializeMeshcoreUserMessage(
                  pathSync.reason === 'no_path'
                    ? MESHCORE_ROOM_LOGIN_NO_ROUTE_MESSAGE
                    : {
                        key: 'meshcore.errors.roomLogin.pathSyncFailedDetail',
                        params: { detail: pathSync.error ? ` (${pathSync.error})` : '' },
                      },
                ),
              );
            }
            console.debug(
              `[useMeshcoreRuntime] loginRoom pathSync node=0x${nodeId.toString(16)} ${JSON.stringify(pathSync)} storedPathLen=${storedPath?.length ?? 0}`,
            );
            await repeaterRemoteRpcRef.current(async () => {
              const rpcConn = connRef.current;
              if (!rpcConn) {
                throw new Error(MESHCORE_ERR_NOT_CONNECTED);
              }
              await meshcoreRoomLogin(rpcConn, nodeId, pubKey, password, {
                adminPassword,
                guestPassword,
                hopsAway,
                companionTransport: meshcoreConnectTypeRef.current,
                forceRelogin: opts?.forceRelogin,
                signal: loginAbort.signal,
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
      } catch (e: unknown) {
        if (errLikeToLogString(e).includes('loginRoom timed out')) {
          loginAbort.abort();
          meshcoreCancelRoomLogin(nodeId);
        }
        throw e;
      }
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
      throw new Error(MESHCORE_ERR_NOT_CONNECTED);
    }
    try {
      await repeaterRemoteRpcRef.current(async () => {
        const activeConn = connRef.current;
        if (!activeConn) {
          throw new Error(MESHCORE_ERR_NOT_CONNECTED);
        }
        await meshcoreRoomLogout(activeConn, nodeId, pubKey, {
          companionTransport: meshcoreConnectTypeRef.current,
        });
      });
    } catch (e: unknown) {
      console.warn('[useMeshcoreRuntime] leaveRoom failed ' + errLikeToLogString(e));
      throw new Error(serializeMeshcoreUserMessage(meshcoreRoomLogoutFailureMessage(e)));
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
        throw new Error(MESHCORE_ERR_NOT_CONNECTED);
      }
      const savedIds = new Set(listMeshcoreRoomCredentialNodeIds());
      const fromUi =
        roomNodeIds?.filter((id) => Number.isFinite(id) && id >= 0 && savedIds.has(id)) ?? [];
      const candidateIds =
        fromUi.length > 0
          ? fromUi
          : [...savedIds].filter(
              (id) => getIdentityNode(meshcoreIdentityIdRef.current, id)?.hw_model === 'Room',
            );
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
    if (meshcoreCompanionRepeaterRfBusy()) {
      console.debug('[useMeshcoreRuntime] room sync deferred (repeater RF busy)');
      return;
    }
    const now = Date.now();
    if (now - lastMeshcoreRoomSyncTxAtRef.current < MESHCORE_ROOM_SYNC_MIN_MESH_TX_SPACING_MS) {
      return;
    }

    const roomNodes: RoomSyncSchedulerNode[] = listMeshcoreRoomSyncEnabledNodeIds()
      .filter((id) => getIdentityNode(meshcoreIdentityIdRef.current, id)?.hw_model === 'Room')
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
        getIdentityNode(meshcoreIdentityIdRef.current, target.nodeId),
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
    if (meshcoreCompanionRepeaterRfBusy()) {
      console.debug('[useMeshcoreRuntime] room auto-login deferred (repeater RF busy)');
      roomAutoLoginRetryTimerRef.current ??= setTimeout(() => {
        roomAutoLoginRetryTimerRef.current = null;
        triggerRoomAutoLoginRef.current();
      }, MESHCORE_ROOM_SYNC_TICK_MS);
      return;
    }
    const configuredIds = listMeshcoreRoomAutoLoginOnConnectNodeIds();
    const nodeIds = configuredIds.filter(
      (id) => getIdentityNode(meshcoreIdentityIdRef.current, id)?.hw_model === 'Room',
    );
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
    if (meshcoreCompanionRepeaterRfBusy()) {
      console.debug('[useMeshcoreRuntime] room reconnect sync deferred (repeater RF busy)');
      return;
    }
    const now = Date.now();
    const roomNodes: RoomSyncSchedulerNode[] = listMeshcoreRoomSyncEnabledNodeIds()
      .filter((id) => getIdentityNode(meshcoreIdentityIdRef.current, id)?.hw_model === 'Room')
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
        getIdentityNode(meshcoreIdentityIdRef.current, target.nodeId),
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
        throw new Error(MESHCORE_ERR_NOT_CONNECTED);
      }
      if (meshcoreIsRoomLoginQueued(nodeId)) {
        meshcoreCancelRoomLogin(nodeId);
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
        const hopsAway = getIdentityNode(meshcoreIdentityIdRef.current, nodeId)?.hops_away ?? 0;
        console.debug(
          `[useMeshcoreRuntime] sendRoomPost mode=post txtType=${MESHCORE_TXT_TYPE_PLAIN} bodyLen=${new TextEncoder().encode(text).length} room=0x${nodeId.toString(16)} hops=${hopsAway} transport=${meshcoreConnectTypeRef.current ?? 'unknown'}`,
        );
        const session = meshcoreGetRoomSession(nodeId);
        const postOpts = {
          hopsAway,
          companionTransport: meshcoreConnectTypeRef.current,
        };
        const postTimeoutMs = computeRoomPostTotalTimeoutMs(
          hopsAway,
          meshcoreConnectTypeRef.current,
        );
        const runPostRpc = <T>(fn: () => Promise<T>): Promise<T> =>
          withTimeout(repeaterRemoteRpcRef.current(fn), postTimeoutMs, 'sendRoomPost');
        const sendOnce = async (): Promise<{ expectedAckCrc?: number; estTimeout?: number }> => {
          const activeConn = connRef.current;
          if (!activeConn) {
            throw new Error(MESHCORE_ERR_NOT_CONNECTED);
          }
          return sendMeshcoreRoomPostWithSentWait(activeConn, pubKey, text, postOpts);
        };
        let result: { expectedAckCrc?: number; estTimeout?: number };
        try {
          result = await runPostRpc(sendOnce);
        } catch (firstErr: unknown) {
          const postErr = meshcoreRoomPostSendErrorMessage(firstErr);
          const adminPassword = session?.adminPassword?.trim() ?? '';
          if (
            adminPassword.length > 0 &&
            meshcoreUserMessageKey(postErr) === 'meshcore.errors.roomPost.badState' &&
            connRef.current
          ) {
            console.debug(
              `[useMeshcoreRuntime] sendRoomPost mode=admin-retry txtType=${MESHCORE_TXT_TYPE_PLAIN} bodyLen=${new TextEncoder().encode(text).length} room=0x${nodeId.toString(16)} hops=${hopsAway} transport=${meshcoreConnectTypeRef.current ?? 'unknown'}`,
            );
            await runPostRpc(async () => {
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
            result = await runPostRpc(sendOnce);
          } else {
            throw firstErr;
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
        if (acked.packetId == null) {
          void window.electronAPI.db
            .updateMeshcoreMessageStatusByKey(
              myNodeNumRef.current,
              sentAt,
              MESHCORE_ROOM_MESSAGE_CHANNEL,
              text,
              'acked',
            )
            .catch((e: unknown) => {
              console.warn(
                '[useMeshcoreRuntime] updateMeshcoreMessageStatusByKey (room post) error ' +
                  errLikeToLogString(e),
              );
            });
        }
        void setMeshcoreRoomLastPostAt(nodeId, sentAt).catch((e: unknown) => {
          console.warn(
            '[useMeshcoreRuntime] setMeshcoreRoomLastPostAt failed ' + errLikeToLogString(e),
          );
        });
      } catch (e: unknown) {
        const errMsg = meshcoreRoomPostSendErrorStored(e);
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
      const node = getIdentityNode(meshcoreIdentityIdRef.current, nodeId);
      if (node?.hw_model !== 'Room') {
        return sendRepeaterCliCommand(nodeId, command);
      }
      const pubKey = pubKeyMapRef.current.get(nodeId);
      if (!pubKey) {
        throw new Error('Room not found (no encryption key)');
      }
      const conn = connRef.current;
      if (!conn) {
        throw new Error(MESHCORE_ERR_NOT_CONNECTED);
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
      return sendRepeaterCliCommand(nodeId, command);
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
      await awaitMeshcoreCompanionConfigAck(
        conn,
        frame,
        'MeshCore rejected telemetry privacy settings',
      );
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
      await awaitMeshcoreCompanionConfigAck(
        conn,
        frame,
        'MeshCore rejected contact auto-add settings',
      );
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
      /** Built inside `setNodes` so we read merged `last_heard` before the store catches up. */
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
          syncNodesMapToIdentityStore(storeId, next);
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

  const setNodeFavorited = useCallback(
    async (nodeId: number, favorited: boolean) => {
      const storeId =
        meshcoreIdentityIdRef.current ??
        getIdentityIdForProtocol('meshcore') ??
        resolveMeshcoreStoreIdentityId();
      const storeRecord = storeId ? useNodeStore.getState().nodes[storeId]?.[nodeId] : undefined;
      // Local nodes map can lead the identity store briefly after commit; don't no-op favoriting.
      const localNode = nodes.get(nodeId);
      if (!storeRecord && !localNode) return;

      const prevFav = storeRecord?.favorited ?? localNode?.favorited ?? false;
      if (storeId) {
        patchNodeFavorited(storeId, nodeId, favorited);
      }
      setNodes((prev) => {
        const n = prev.get(nodeId) ?? localNode;
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
          const n = prev.get(nodeId) ?? localNode;
          if (!n) return prev;
          const next = new Map(prev);
          next.set(nodeId, { ...n, favorited: prevFav });
          return next;
        });
      }
    },
    [nodes, resolveMeshcoreStoreIdentityId],
  );

  const sendReaction = useCallback(
    async (glyph: string, replyId: number, channel: number) => {
      if (!connRef.current) {
        throw new Error('Not connected to radio');
      }
      const parsed = reactionGlyphFromPicker(glyph);
      if (!parsed) {
        throw new Error('Invalid reaction emoji');
      }
      const reactedTo = readMeshcoreMessages().find(
        (m) => m.packetId === replyId || m.timestamp === replyId,
      );
      if (reactedTo == null) {
        throw new Error('Reaction target message not found');
      }
      const targetName = reactedTo.sender_name || 'Unknown';
      const replyKey = reactedTo.packetId ?? reactedTo.timestamp;
      const openWireCompat = isMeshcoreOpenWireCompatEnabled();
      const isDm = reactedTo.to != null;
      const openReactionWire = openWireCompat
        ? buildMeshcoreOpenReactionWire(reactedTo, parsed.glyph, { isDm })
        : null;
      const tapbackText =
        openReactionWire ?? buildMeshcoreOutboundTapbackWire(targetName, parsed.glyph);
      const conn = connRef.current;
      const me = myNodeNumRef.current;

      const publishTapback = (tapbackMsg: ChatMessage) => {
        addMessage(tapbackMsg);
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
        markMeshcoreCompanionTx();
        const tapbackTs = Date.now();
        const tapbackMsg: ChatMessage = {
          sender_id: me,
          sender_name: selfInfo?.name ?? 'Me',
          payload: parsed.glyph,
          channel: -1,
          timestamp: tapbackTs,
          status: 'acked',
          emoji: parsed.scalar,
          replyId: replyKey,
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
        markMeshcoreCompanionTx();
        publishTapback({
          sender_id: me,
          sender_name: selfInfo?.name ?? 'Me',
          payload: parsed.glyph,
          channel: outboundChannel,
          timestamp: Date.now(),
          status: 'acked',
          emoji: parsed.scalar,
          replyId: replyKey,
        });
      }
    },
    [addMessage, readMeshcoreMessages, selfInfo?.name],
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
        getIdentityNode(meshcoreIdentityIdRef.current, nodeId),
        outPathMapRef.current.get(nodeId),
      );
      const result = await syncMeshcoreRoomContactPathBeforeLogin(
        conn,
        nodeId,
        pubKey,
        getIdentityNode(meshcoreIdentityIdRef.current, nodeId),
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
        markMeshcoreCompanionTx();
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

  const ensureMeshcoreMqttIdentity = useCallback(async (): Promise<boolean> => {
    if (meshcoreIdentityHasFullKeyPair()) return true;
    const conn = connRef.current;
    const publicKey = selfInfoRef.current?.publicKey;
    if (
      !conn ||
      !publicKey?.length ||
      (state.status !== 'configured' && state.status !== 'connected')
    ) {
      return false;
    }
    const ok = await exportAndPersistMeshcoreMqttIdentity(
      conn,
      publicKey,
      meshcoreConnectTypeRef.current,
    );
    if (ok) {
      maybeAutoLaunchMeshcoreMqttAfterIdentity();
    }
    return ok;
  }, [maybeAutoLaunchMeshcoreMqttAfterIdentity, state.status]);

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

  const syncWaitingMessages = useCallback(async (): Promise<void> => {
    await processWaitingMessagesRef.current?.({ showSyncBanner: true });
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
    const myNode = getIdentityNode(meshcoreIdentityIdRef.current, myNodeNumRef.current);
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
        // Do not write SetAdvertLatLon during initConn contacts dump — SoftAP FINs mid-dump when
        // GPS/stats/advert RPCs interleave with getContacts (meshcore.js shared Ok/Err).
        if (meshcoreInitConnInFlightRef.current) {
          return pos;
        }
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
        syncNodesMapToIdentityStore(storeId, nextMap);
      }
    } catch (e) {
      console.warn('[useMeshcoreRuntime] refreshNodesFromDb error ' + errLikeToLogString(e));
    }
  }, [resolveMeshcoreStoreIdentityId]);
  const refreshMessagesFromDb = useCallback(
    async (opts?: { replaceFromDb?: boolean }) => {
      try {
        const dbMsgs = (await window.electronAPI.db.getMeshcoreMessages(
          undefined,
          500,
        )) as MeshcoreMessageDbRow[];
        const mapped = repairMeshcoreHydratedMessages(
          mapMeshcoreDbRowsToChatMessages(dbMsgs),
          meshcoreRoomServerIdsFromNodes(readMeshcoreNodes().values()),
          myNodeNumRef.current,
        );
        void persistMeshcoreMessageSenderRepairs(dbMsgs, mapped);
        setNodes((prev) => mergeStubNodesFromMeshcoreMessages(prev, mapped));
        setMessages((prev) => mergeMeshcoreDbHydrationWithLive(prev, mapped, opts));
      } catch (e) {
        console.warn('[useMeshcoreRuntime] refreshMessagesFromDb error ' + errLikeToLogString(e));
      }
    },
    [readMeshcoreNodes],
  );

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
    const identityId = getIdentityIdForProtocol('meshcore') ?? meshcoreIdentityId;
    if (!identityId) return;
    setConnection(identityId, {
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
      const hopsAway =
        destNodeId != null
          ? (getIdentityNode(meshcoreIdentityIdRef.current, destNodeId)?.hops_away ?? 0)
          : 0;
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
    registerMeshcoreSerialDisconnectTarget({
      isSerialConnected: () => meshcoreConnectionParamsRef.current?.rfType === 'serial',
      onDisconnected: () => handleMeshcoreConnectionLostRef.current(),
    });
    return () => registerMeshcoreSerialDisconnectTarget(null);
  }, []);

  // Main reports the raw TCP socket's own 'close'/'error' event within milliseconds of the
  // real network failure (clean FIN or RST alike). Without this, TCP relied solely on the
  // passive stale/dead watchdog — which, unlike serial, doesn't exist for MeshCore's TCP
  // transport at all (see startMeshcoreSerialWatchdog), so a dropped TCP connection had no
  // automatic recovery path whatsoever. Mirrors the equivalent Meshtastic fix in
  // meshtasticTransportLossDetection.ts.
  // After getContacts burst is captured: mark dead + defer reconnect — do not sync-bump
  // setupGeneration via handleMeshcoreConnectionLost (that cancels initConn before configured).
  useEffect(() => {
    const latchTcpBridgeDeadForBurst = (source: 'ipc' | 'write'): void => {
      // Params are only written after a successful attachRfSession. Mid-first-connect peer FIN
      // (Neal: after getContacts) must still abort initConn — gate on the in-flight connect type too.
      const storedTcp = meshcoreConnectionParamsRef.current?.rfType === 'tcp';
      const connectingTcp = meshcoreConnectTypeRef.current === 'tcp';
      if (!storedTcp && !connectingTcp) return;
      meshcoreTcpBridgeDeadRef.current = true;
      // Post-configure contacts dump: keep the configured session; do not reconnect-loop.
      if (meshcoreTcpContactsDumpInFlightRef.current) {
        console.debug(
          source === 'write'
            ? '[useMeshcoreRuntime] TCP write-dead during post-configure contacts dump — keep configured'
            : '[useMeshcoreRuntime] TCP closed during post-configure contacts dump — keep configured',
        );
        return;
      }
      // Defer while this open can still finish from the contacts burst (!everConfigured covers
      // late IPC after premature deviceConfigured; !deviceConfigured covers mid-reconnect opens).
      const defer = shouldDeferMeshcoreTcpReconnectAfterBurst({
        burstCaptured: meshcoreTcpInitBurstCapturedRef.current,
        everConfigured: meshcoreEverConfiguredRef.current,
        deviceConfigured: meshcoreDeviceConfiguredRef.current,
        initConnInFlight: meshcoreInitConnInFlightRef.current,
      });
      if (defer) {
        meshcoreDeferredReconnectRef.current = true;
        console.debug(
          source === 'write'
            ? '[useMeshcoreRuntime] TCP write-dead after init burst — latch bridge dead, defer reconnect'
            : '[useMeshcoreRuntime] TCP closed after init burst — defer reconnect until configured',
        );
        return;
      }
      if (source === 'ipc') {
        handleMeshcoreConnectionLostRef.current();
      }
      // write-dead while fully configured: leave reconnect to meshcore:tcp-disconnected IPC
      // so we do not double-enter the owner.
    };

    setMeshcoreTcpWriteDeadListener(() => {
      latchTcpBridgeDeadForBurst('write');
    });
    const unsub = window.electronAPI.meshcore.tcp.onDisconnected(() => {
      latchTcpBridgeDeadForBurst('ipc');
    });
    return () => {
      setMeshcoreTcpWriteDeadListener(null);
      unsub();
    };
  }, []);

  useEffect(() => {
    registerMeshcoreSession({
      connect,
      prepareRfConnect,
      attachRfSession,
      handleRfConnectFailure,
      finalizeDriverDisconnect,
      connectAutomatic,
      getDestinationPubKey: (nodeId) => pubKeyMapRef.current.get(nodeId),
    });
    return () => registerMeshcoreSession(null);
  }, [
    connect,
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
      meshcoreLocalStats:
        getIdentityNode(meshcoreIdentityIdRef.current, myNodeNumRef.current)
          ?.meshcore_local_stats ?? null,
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
      applyMeshcorePathHashMode,
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
      meshcoreRepeaterRpcPending,
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
      waitingMessagesSyncActive,
      waitingMessagesSyncProgress,
      waitingMessagesSilentDrainActive,
      waitingMessagesDrainDeferred,
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
      ensureMeshcoreMqttIdentity,
      getWaitingMessages,
      syncWaitingMessages,
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
      applyMeshcorePathHashMode,
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
      meshcoreRepeaterRpcPending,
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
      waitingMessagesSyncActive,
      waitingMessagesSyncProgress,
      waitingMessagesSilentDrainActive,
      waitingMessagesDrainDeferred,
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
      ensureMeshcoreMqttIdentity,
      getWaitingMessages,
      syncWaitingMessages,
      syncNextMessage,
      getRemoteAdminKeyForNode,
      setRemoteAdminKeyForNode,
    ],
  );
}

export type MeshcoreRuntime = ReturnType<typeof useMeshcoreRuntime>;
