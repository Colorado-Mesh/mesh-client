/**
 * Runtime side effects for MeshCore pushes that `MeshCoreProtocol` decodes into `DomainEvent`s
 * (hop ACK 130, message-waiting 131, RF RX 136, CLI data responses, disconnect).
 *
 * Every handler runs off `PacketRouter` — this module never subscribes to the SDK event bus.
 *
 * Failure point: DB / MQTT IPC rejections are logged; Zustand stores and hook state stay
 * authoritative for the UI.
 */
import type { Dispatch, RefObject, SetStateAction } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { getIdentityChatMessages } from '@/renderer/lib/identityStoreReads';
import { withTimeout } from '@/shared/withTimeout';

import { packetRouter } from '../../lib/drivers/PacketRouter';
import {
  applyMeshcoreDmAckToPending,
  syncMeshcoreDmAckToMessageStore,
} from '../../lib/meshcore/meshcoreDmAckRuntime';
import type { DeviceLogEntry, MeshCoreConnection } from '../../lib/meshcore/meshcoreHookTypes';
import { createMeshcoreMqttPacketLogBucket } from '../../lib/meshcore/meshcoreMqttPacketLogThrottle';
import { handleMeshcoreRfRx, type MeshcoreRfRxDeps } from '../../lib/meshcore/meshcoreRfRxRuntime';
import { processMeshcoreWaitingMessageItem } from '../../lib/meshcoreProcessWaitingMessageItem';
import { meshcoreSortedStorePrior } from '../../lib/meshcoreStoreDedup';
import {
  normalizeMeshcoreWaitingMessageBatch,
  normalizeMeshcoreWaitingMessageItem,
} from '../../lib/meshcoreWaitingMessageItem';
import {
  isMeshcoreCompanionDrainDeferred,
  isMeshcoreSyncNextMessageTimeoutError,
  logMeshcoreWaitingMessagesDrainError,
  markMeshcoreMsgWaitingEvent,
  resetMeshcoreWaitingMessagesDrainSchedule,
  scheduleMeshcoreWaitingMessagesDrain,
  shouldActivateWaitingMessagesBanner,
  waitingMessagesDrainTimeoutMs,
} from '../../lib/meshcoreWaitingMessagesDrain';
import type { DomainEvent } from '../../lib/protocols/Protocol';
import { meshNodeToNodeRecord } from '../../lib/storeRecordAdapters';
import {
  MESHCORE_SYNC_NEXT_MESSAGE_MAX_PER_DRAIN,
  MESHCORE_SYNC_NEXT_MESSAGE_TIMEOUT_MS,
  MESHCORE_WAITING_MESSAGES_BATCH_YIELD,
} from '../../lib/timeConstants';
import type { ChatMessage, MeshNode } from '../../lib/types';
import type { NodeRecord } from '../../stores/nodeStore';
import { upsertNodeRecordsForIdentity } from '../../stores/nodeStore';
import { usePathHistoryStore } from '../../stores/pathHistoryStore';
import type {
  MeshcoreConnSideEffectsCtx,
  ProcessWaitingMessagesOptions,
} from './meshcoreConnSideEffectsCtx';
import { MAX_DEVICE_LOGS, meshcoreDmAckKeyU32 } from './meshcoreHookPreamble';
import {
  getMeshcoreProcessWaitingMessagesInFlight,
  requestMeshcoreWaitingMessagesFollowUp,
  requestMeshcoreWaitingMessagesManualFollowUp,
  resetMeshcoreProcessWaitingMessagesSync,
  resetMeshcoreWaitingMessagesSilentFollowUpChain,
  setMeshcoreProcessWaitingMessagesInFlight,
  takeMeshcoreWaitingMessagesFollowUp,
  takeMeshcoreWaitingMessagesManualFollowUp,
} from './meshcoreWaitingMessagesSyncState';

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

// --- Waiting messages (event 131) drain — module-level so the flush/ingest steps stay
// shallow closures instead of nesting inside attach → processWaitingMessages → async IIFE. ---

type WaitingMessageItemDeps = Parameters<typeof processMeshcoreWaitingMessageItem>[1];

interface MeshcoreWaitingMessagesDrainDeps {
  meshcoreHookMountedRef: RefObject<boolean>;
  meshcoreIdentityIdRef: RefObject<string | null>;
  connectionType: 'ble' | 'serial' | 'tcp';
  readNodes: () => Map<number, MeshNode>;
  addMessagesBatch: (msgs: ChatMessage[]) => void;
  buildItemDeps: (workingNodes: Map<number, MeshNode>) => WaitingMessageItemDeps;
  setWaitingMessagesSyncActive: Dispatch<SetStateAction<boolean>>;
  setWaitingMessagesSyncProgress: Dispatch<
    SetStateAction<{ processed: number; total: number } | null>
  >;
  setWaitingMessagesCount: Dispatch<SetStateAction<number>>;
  setWaitingMessagesSilentDrainActive: Dispatch<SetStateAction<boolean>>;
}

interface MeshcoreWaitingMessagesDrainState {
  processed: number;
  bannerActive: boolean;
  syncTotal: number;
  /** Mutated in place (pushed/cleared) rather than reassigned so helpers can share the reference. */
  pendingMessages: ChatMessage[];
  dirtyNodeIds: Set<number>;
  workingNodes: Map<number, MeshNode>;
}

function collectDirtyWaitingNodeRecords(
  dirtyNodeIds: Set<number>,
  workingNodes: Map<number, MeshNode>,
): NodeRecord[] {
  return Array.from(dirtyNodeIds)
    .map((nodeId) => workingNodes.get(nodeId))
    .filter((node): node is MeshNode => node != null)
    .map((node) => meshNodeToNodeRecord(node));
}

interface FlushMeshcoreWaitingBatchOptions {
  pendingMessages: ChatMessage[];
  dirtyNodeIds: Set<number>;
  workingNodes: Map<number, MeshNode>;
  identityId: string | null;
  addMessagesBatch: (msgs: ChatMessage[]) => void;
}

function flushMeshcoreWaitingBatch(opts: FlushMeshcoreWaitingBatchOptions): void {
  if (opts.pendingMessages.length > 0) {
    opts.addMessagesBatch(opts.pendingMessages);
    opts.pendingMessages.length = 0;
  }
  if (opts.dirtyNodeIds.size === 0) return;
  if (opts.identityId) {
    const dirtyRecords = collectDirtyWaitingNodeRecords(opts.dirtyNodeIds, opts.workingNodes);
    if (dirtyRecords.length > 0) {
      upsertNodeRecordsForIdentity(opts.identityId, dirtyRecords);
    }
  }
  opts.dirtyNodeIds.clear();
}

function flushMeshcoreWaitingState(
  state: MeshcoreWaitingMessagesDrainState,
  deps: Pick<MeshcoreWaitingMessagesDrainDeps, 'meshcoreIdentityIdRef' | 'addMessagesBatch'>,
): void {
  flushMeshcoreWaitingBatch({
    pendingMessages: state.pendingMessages,
    dirtyNodeIds: state.dirtyNodeIds,
    workingNodes: state.workingNodes,
    identityId: deps.meshcoreIdentityIdRef.current,
    addMessagesBatch: deps.addMessagesBatch,
  });
}

async function ingestMeshcoreWaitingMessageItem(
  item: ReturnType<typeof normalizeMeshcoreWaitingMessageItem>,
  state: MeshcoreWaitingMessagesDrainState,
  deps: Pick<MeshcoreWaitingMessagesDrainDeps, 'buildItemDeps' | 'setWaitingMessagesSyncProgress'>,
): Promise<void> {
  if (!item) return;
  try {
    const result = processMeshcoreWaitingMessageItem(item, deps.buildItemDeps(state.workingNodes));
    if (result.nodesDirty) {
      for (const nodeId of result.updatedNodeIds) state.dirtyNodeIds.add(nodeId);
    }
    if (result.pendingMessages.length > 0) {
      state.pendingMessages.push(...result.pendingMessages);
    }
    state.processed += 1;
    if (state.bannerActive) {
      deps.setWaitingMessagesSyncProgress({ processed: state.processed, total: state.syncTotal });
    }
  } catch (e: unknown) {
    console.warn(
      '[meshcoreConnSideEffects] processWaitingMessages ingest error ' + errLikeToLogString(e),
    );
  }
  await yieldToEventLoop();
}

/** Manual sync (Chat "Sync now") — fetches the full queue and shows the sync-progress banner. */
async function drainWaitingMessagesManual(
  conn: MeshCoreConnection,
  state: MeshcoreWaitingMessagesDrainState,
  deps: MeshcoreWaitingMessagesDrainDeps,
): Promise<void> {
  const msgs = await withTimeout(
    conn.getWaitingMessages(),
    waitingMessagesDrainTimeoutMs(true, deps.connectionType),
    'MeshCore getWaitingMessages',
  );
  if (!deps.meshcoreHookMountedRef.current) return;
  const arr = normalizeMeshcoreWaitingMessageBatch(msgs);
  const total = arr.length;
  state.syncTotal = total;
  if (shouldActivateWaitingMessagesBanner(true, total)) {
    state.bannerActive = true;
    deps.setWaitingMessagesSyncActive(true);
    deps.setWaitingMessagesSyncProgress(null);
    deps.setWaitingMessagesCount(total);
    deps.setWaitingMessagesSyncProgress({ processed: 0, total });
  } else if (total === 0) {
    console.debug('[meshcoreConnSideEffects] processWaitingMessages empty queue (manual sync)');
    return;
  }
  console.debug('[meshcoreConnSideEffects] processWaitingMessages start', {
    count: total,
    showSyncBanner: true,
  });
  for (const m of arr) {
    if (!deps.meshcoreHookMountedRef.current) break;
    await ingestMeshcoreWaitingMessageItem(m, state, deps);
    if (
      state.processed % MESHCORE_WAITING_MESSAGES_BATCH_YIELD === 0 ||
      state.pendingMessages.length >= MESHCORE_WAITING_MESSAGES_BATCH_YIELD
    ) {
      flushMeshcoreWaitingState(state, deps);
    }
  }
  flushMeshcoreWaitingState(state, deps);
}

/** Silent/incremental drain (message-waiting push 131) — no banner, capped per-drain. */
async function drainWaitingMessagesSilent(
  conn: MeshCoreConnection,
  state: MeshcoreWaitingMessagesDrainState,
  deps: MeshcoreWaitingMessagesDrainDeps,
): Promise<void> {
  console.debug('[meshcoreConnSideEffects] processWaitingMessages start (incremental)', {
    showSyncBanner: false,
  });
  let silentDrainExhaustedCap = false;
  for (let i = 0; i < MESHCORE_SYNC_NEXT_MESSAGE_MAX_PER_DRAIN; i += 1) {
    if (!deps.meshcoreHookMountedRef.current) break;
    let raw: unknown;
    try {
      raw = await withTimeout(
        conn.syncNextMessage(),
        MESHCORE_SYNC_NEXT_MESSAGE_TIMEOUT_MS,
        'MeshCore syncNextMessage',
      );
    } catch (e: unknown) {
      if (isMeshcoreSyncNextMessageTimeoutError(e)) break;
      throw e;
    }
    const item = normalizeMeshcoreWaitingMessageItem(raw);
    if (!item) break;
    await ingestMeshcoreWaitingMessageItem(item, state, deps);
    if (i === MESHCORE_SYNC_NEXT_MESSAGE_MAX_PER_DRAIN - 1) {
      silentDrainExhaustedCap = true;
    }
  }
  if (silentDrainExhaustedCap) {
    requestMeshcoreWaitingMessagesFollowUp();
  }
  flushMeshcoreWaitingState(state, deps);
}

/**
 * Runs one waiting-messages drain (manual full sync or silent incremental) and manages the
 * sync-progress banner / silent-drain UI flag around it. Mirrors the original inline async IIFE
 * inside `processWaitingMessages`, minus the in-flight bookkeeping (owned by the caller).
 */
async function runMeshcoreWaitingMessagesDrain(
  conn: MeshCoreConnection,
  options: { showSyncBanner: boolean },
  deps: MeshcoreWaitingMessagesDrainDeps,
): Promise<void> {
  const startedAt = Date.now();
  const state: MeshcoreWaitingMessagesDrainState = {
    processed: 0,
    bannerActive: false,
    syncTotal: 0,
    pendingMessages: [],
    dirtyNodeIds: new Set<number>(),
    workingNodes: new Map(deps.readNodes()),
  };
  let silentDrainUiActive = false;
  if (!options.showSyncBanner) {
    deps.setWaitingMessagesSilentDrainActive(true);
    silentDrainUiActive = true;
  }
  try {
    if (options.showSyncBanner) {
      await drainWaitingMessagesManual(conn, state, deps);
    } else {
      await drainWaitingMessagesSilent(conn, state, deps);
    }
    console.debug('[meshcoreConnSideEffects] processWaitingMessages done', {
      count: state.processed,
      durationMs: Date.now() - startedAt,
      showSyncBanner: options.showSyncBanner,
    });
  } finally {
    if (silentDrainUiActive) {
      deps.setWaitingMessagesSilentDrainActive(false);
    }
    if (state.bannerActive) {
      deps.setWaitingMessagesCount(0);
      deps.setWaitingMessagesSyncActive(false);
      deps.setWaitingMessagesSyncProgress(null);
    }
  }
}

export function attachMeshcoreConnSideEffects(
  conn: MeshCoreConnection,
  ctx: MeshcoreConnSideEffectsCtx,
): () => void {
  const {
    resolveIdentityId,
    meshcoreIdentityIdRef,
    meshcoreDriverConnectedRef,
    connRef,
    lastPacketLogAtRef,
    lastPacketLogPublishFailureLogAtRef,
    meshcoreContactsRefreshTimerRef,
    meshcoreHookMountedRef,
    meshcoreSessionPathUpdatedNodeIdsRef,
    meshcoreWaitingMessagesPollRef,
    meshcoreConnectTypeRef,
    mqttStatusRef,
    myNodeNumRef,
    nicknameMapRef,
    readNodes,
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
    handleConnectionLostRef,
    meshcoreExplicitDisconnectRef,
    bumpLastDataReceived,
  } = ctx;

  // Capture identity at attach; prefer finalized identity once configure completes.
  const identityIdAtAttach = resolveIdentityId();
  const mqttPacketLogBucket = createMeshcoreMqttPacketLogBucket();

  const storePriorForIngest = (): ChatMessage[] => {
    const storeId = meshcoreIdentityIdRef.current;
    return storeId ? meshcoreSortedStorePrior(storeId) : [];
  };

  const logTransportLineAsDevice = (line: string) => {
    const now = Date.now();
    const entry: DeviceLogEntry = {
      ts: now,
      level: 'info',
      source: 'meshcore',
      message: line.length > 220 ? `${line.slice(0, 220)}…` : line,
    };
    setDeviceLogs((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_DEVICE_LOGS ? next.slice(next.length - MAX_DEVICE_LOGS) : next;
    });
  };

  // --- Hop ACK (event 130) ---

  const handleDmAck = (
    identityId: string,
    payload: Extract<DomainEvent, { type: 'meshcore_dm_ack' }>['payload'],
  ) => {
    const { pending, isNack, newStatus, ackKeyU32 } = applyMeshcoreDmAckToPending(
      payload.ackCode,
      pendingAcksRef.current,
    );
    const selfId = myNodeNumRef.current;

    if (!pending) {
      const hadLateOutbound = getIdentityChatMessages(identityId).some(
        (m) =>
          m.packetId != null &&
          meshcoreDmAckKeyU32(m.packetId) === ackKeyU32 &&
          m.sender_id === selfId &&
          m.to != null &&
          (m.status === 'sending' || m.status === 'failed'),
      );
      if (hadLateOutbound) {
        setMessages((prev) =>
          prev.map((m) =>
            m.packetId != null &&
            meshcoreDmAckKeyU32(m.packetId) === ackKeyU32 &&
            m.sender_id === selfId &&
            m.to != null &&
            (m.status === 'sending' || m.status === 'failed')
              ? { ...m, status: newStatus }
              : m,
          ),
        );
      }
      syncMeshcoreDmAckToMessageStore(identityId, ackKeyU32, selfId, newStatus);
      void window.electronAPI.db
        .updateMeshcoreMessageStatus(ackKeyU32, newStatus)
        .catch((e: unknown) => {
          console.warn(
            '[meshcoreConnSideEffects] updateMeshcoreMessageStatus (late 130) error ' +
              errLikeToLogString(e),
          );
        });
      return;
    }

    if (pending.destNodeId != null && pending.pathHash != null) {
      usePathHistoryStore
        .getState()
        .recordOutcome(
          pending.destNodeId,
          pending.pathHash,
          !isNack,
          !isNack && typeof payload.roundTrip === 'number' ? payload.roundTrip : undefined,
        );
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.packetId != null && meshcoreDmAckKeyU32(m.packetId) === ackKeyU32
          ? { ...m, status: newStatus }
          : m,
      ),
    );
    syncMeshcoreDmAckToMessageStore(identityId, ackKeyU32, selfId, newStatus);
    void window.electronAPI.db
      .updateMeshcoreMessageStatus(ackKeyU32, newStatus)
      .catch((e: unknown) => {
        console.warn(
          '[meshcoreConnSideEffects] updateMeshcoreMessageStatus error ' + errLikeToLogString(e),
        );
      });
  };

  // --- Waiting messages (event 131) ---

  const waitingMessageDrainScheduleOptions = {
    isMounted: () => meshcoreHookMountedRef.current,
    onDeferredChange: setWaitingMessagesDrainDeferred,
  };

  const scheduleSilentWaitingMessageDrain = (drain: () => Promise<void>) => {
    scheduleMeshcoreWaitingMessagesDrain(drain, waitingMessageDrainScheduleOptions);
  };

  const maybeChainWaitingMessageFollowUp = () => {
    if (!meshcoreHookMountedRef.current) return;
    const manual = takeMeshcoreWaitingMessagesManualFollowUp();
    const silent = takeMeshcoreWaitingMessagesFollowUp();
    if (!manual && !silent) {
      resetMeshcoreWaitingMessagesSilentFollowUpChain();
      return;
    }
    const showSyncBanner = manual;
    scheduleSilentWaitingMessageDrain(() =>
      processWaitingMessages({ showSyncBanner }).catch((e: unknown) => {
        logMeshcoreWaitingMessagesDrainError('getWaitingMessages error', e, showSyncBanner);
      }),
    );
  };

  const buildWaitingMessageItemDeps = (
    workingNodes: Map<number, MeshNode>,
  ): Parameters<typeof processMeshcoreWaitingMessageItem>[1] => ({
    workingNodes,
    pubKeyPrefixMap: pubKeyPrefixMapRef.current,
    myNodeNum: myNodeNumRef.current || 0,
    meshcoreIdentityId: meshcoreIdentityIdRef.current,
    storePriorForBatch: storePriorForIngest,
    logTransportLineAsDevice,
  });

  const processWaitingMessages = async (options?: ProcessWaitingMessagesOptions): Promise<void> => {
    if (getMeshcoreProcessWaitingMessagesInFlight()) {
      if (options?.showSyncBanner !== false) {
        requestMeshcoreWaitingMessagesManualFollowUp();
      } else {
        requestMeshcoreWaitingMessagesFollowUp();
      }
      console.debug('[meshcoreConnSideEffects] processWaitingMessages skipped (in flight)');
      return getMeshcoreProcessWaitingMessagesInFlight()!;
    }
    const showSyncBanner = options?.showSyncBanner !== false;
    if (!showSyncBanner && isMeshcoreCompanionDrainDeferred()) {
      scheduleSilentWaitingMessageDrain(() =>
        processWaitingMessages(options).catch((e: unknown) => {
          logMeshcoreWaitingMessagesDrainError('getWaitingMessages error', e, false);
        }),
      );
      return;
    }
    const drainDeps: MeshcoreWaitingMessagesDrainDeps = {
      meshcoreHookMountedRef,
      meshcoreIdentityIdRef,
      connectionType: meshcoreConnectTypeRef.current,
      readNodes,
      addMessagesBatch,
      buildItemDeps: buildWaitingMessageItemDeps,
      setWaitingMessagesSyncActive,
      setWaitingMessagesSyncProgress,
      setWaitingMessagesCount,
      setWaitingMessagesSilentDrainActive,
    };
    const inFlight = runMeshcoreWaitingMessagesDrain(conn, { showSyncBanner }, drainDeps).finally(
      () => {
        setMeshcoreProcessWaitingMessagesInFlight(null);
        maybeChainWaitingMessageFollowUp();
      },
    );
    setMeshcoreProcessWaitingMessagesInFlight(inFlight);
    return inFlight;
  };
  processWaitingMessagesRef.current = processWaitingMessages;

  const handleWaitingMessages = () => {
    markMeshcoreMsgWaitingEvent();
    scheduleMeshcoreWaitingMessagesDrain(
      async () => {
        try {
          await processWaitingMessages({ showSyncBanner: false });
        } catch (e) {
          // catch-no-log-ok logMeshcoreWaitingMessagesDrainError handles logging
          const errMsg = errLikeToLogString(e);
          logMeshcoreWaitingMessagesDrainError('getWaitingMessages error', e, false);
          if (errMsg.includes('timed out')) {
            return;
          }
          // Single retry — device may be busy during BLE reconnect
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 2_000);
          });
          if (!meshcoreHookMountedRef.current) return;
          try {
            await processWaitingMessages({ showSyncBanner: false });
          } catch (retryErr: unknown) {
            // catch-no-log-ok logMeshcoreWaitingMessagesDrainError handles logging
            logMeshcoreWaitingMessagesDrainError('getWaitingMessages error', retryErr, false);
          }
        }
      },
      {
        isMounted: () => meshcoreHookMountedRef.current,
        onDeferredChange: setWaitingMessagesDrainDeferred,
      },
    );
  };

  // --- CLI data response (direct message, txtType 1) ---

  const handleCliResponse = (
    payload: Extract<DomainEvent, { type: 'meshcore_cli_response' }>['payload'],
  ) => {
    const senderId = payload.senderNodeId;
    const service = repeaterCommandServiceRef.current;
    if (service) {
      if (service.handleResponse(payload.text, senderId)) return;
    } else {
      console.warn(
        '[meshcoreConnSideEffects] CLI response received but no command service active (sender:',
        senderId.toString(16).toUpperCase(),
        ')',
      );
    }
    // CLI response without matching pending command — surface it in the panel history.
    if (senderId !== 0) {
      const { body } = service ? service.parseResponseToken(payload.text) : { body: payload.text };
      addCliHistoryEntry(senderId, {
        type: 'received',
        text: body,
        timestamp: Date.now(),
      });
    }
  };

  // --- RF RX (event 136) ---

  const handleRfRx = (payload: Extract<DomainEvent, { type: 'meshcore_rf_rx' }>['payload']) => {
    const deps: MeshcoreRfRxDeps = {
      myNodeNumRef,
      meshcoreIdentityIdRef,
      readNodes,
      pubKeyMapRef,
      pubKeyPrefixMapRef,
      nicknameMapRef,
      selfInfoRef,
      rawPacketsRef,
      mqttStatusRef,
      lastPacketLogAtRef,
      lastPacketLogPublishFailureLogAtRef,
      mqttPacketLogBucket,
      setDeviceLogs,
      setSignalTelemetry,
      setRawPackets,
    };
    handleMeshcoreRfRx(payload, deps);
  };

  // --- Disconnect ---

  const handleDisconnected = () => {
    let shouldReconnect = false;
    setState((prev) => {
      const wasOperational =
        prev.status === 'connected' || prev.status === 'configured' || prev.status === 'stale';
      shouldReconnect = wasOperational;
      return {
        ...prev,
        status: 'disconnected',
        connectionLoss: wasOperational,
      };
    });
    const usedDriverConnect = meshcoreDriverConnectedRef.current;
    const staleConn = connRef.current;
    connRef.current = null;
    teardownMeshcoreConnEventListeners({ driverDisconnect: usedDriverConnect });
    queueMicrotask(() => {
      meshcoreSessionPathUpdatedNodeIdsRef.current = new Set();
      setMeshcorePingRouteReadyEpoch((e) => e + 1);
      setQueueStatus(null);
      if (meshcoreContactsRefreshTimerRef.current) {
        clearTimeout(meshcoreContactsRefreshTimerRef.current);
        meshcoreContactsRefreshTimerRef.current = null;
      }
      if (meshcoreWaitingMessagesPollRef.current) {
        clearInterval(meshcoreWaitingMessagesPollRef.current);
        meshcoreWaitingMessagesPollRef.current = null;
      }
      resetMeshcoreProcessWaitingMessagesSync(
        setWaitingMessagesCount,
        setWaitingMessagesSyncActive,
        setWaitingMessagesSyncProgress,
        setWaitingMessagesSilentDrainActive,
        setWaitingMessagesDrainDeferred,
      );
      resetMeshcoreWaitingMessagesDrainSchedule();
      if (staleConn && !usedDriverConnect) {
        void staleConn.close().catch((e: unknown) => {
          console.debug('[meshcoreConnSideEffects] stale conn close ' + errLikeToLogString(e));
        });
      }
      if (shouldReconnect && !meshcoreExplicitDisconnectRef.current) {
        handleConnectionLostRef.current();
      }
    });
  };

  const detachListener = packetRouter.addListener((event, routedIdentityId) => {
    const expectedIdentityId = meshcoreIdentityIdRef.current ?? identityIdAtAttach;
    if (!expectedIdentityId || routedIdentityId !== expectedIdentityId) return;
    bumpLastDataReceived?.();
    switch (event.type) {
      case 'meshcore_dm_ack':
        handleDmAck(routedIdentityId, event.payload);
        break;
      case 'meshcore_waiting_messages':
        handleWaitingMessages();
        break;
      case 'meshcore_cli_response':
        handleCliResponse(event.payload);
        break;
      case 'meshcore_rf_rx':
        handleRfRx(event.payload);
        break;
      case 'device_status':
        if (event.payload.status === 'disconnected') {
          handleDisconnected();
        }
        break;
      default:
        break;
    }
  });

  return () => {
    detachListener();
    resetMeshcoreProcessWaitingMessagesSync(
      setWaitingMessagesCount,
      setWaitingMessagesSyncActive,
      setWaitingMessagesSyncProgress,
      setWaitingMessagesSilentDrainActive,
      setWaitingMessagesDrainDeferred,
    );
    resetMeshcoreWaitingMessagesDrainSchedule();
    processWaitingMessagesRef.current = null;
  };
}
