/**
 * Runtime side effects for MeshCore pushes that `MeshCoreProtocol` decodes into `DomainEvent`s
 * (hop ACK 130, message-waiting 131, RF RX 136, CLI data responses, disconnect).
 *
 * Every handler runs off `PacketRouter` — this module never subscribes to the SDK event bus.
 *
 * Failure point: DB / MQTT IPC rejections are logged; Zustand stores and hook state stay
 * authoritative for the UI.
 */
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { getIdentityChatMessages } from '@/renderer/lib/identityStoreReads';
import { withTimeout } from '@/shared/withTimeout';

import { parseMeshCoreRfPacket } from '../../../shared/meshcoreRfPacketParse';
import { packetRouter } from '../../lib/drivers/PacketRouter';
import {
  classifyPayload,
  classifyProximity,
  extractMeshtasticSenderId,
  meshtasticSenderIdForRawLogFallback,
} from '../../lib/foreignLoraDetection';
import { syncNodesMapToIdentityStore } from '../../lib/hydrateIdentityStoresFromDb';
import {
  applyMeshcoreDmAckToPending,
  syncMeshcoreDmAckToMessageStore,
} from '../../lib/meshcore/meshcoreDmAckRuntime';
import type {
  DeviceLogEntry,
  MeshCoreConnection,
  RxPacketEntry,
} from '../../lib/meshcore/meshcoreHookTypes';
import { processMeshcoreWaitingMessageItem } from '../../lib/meshcoreProcessWaitingMessageItem';
import {
  meshcoreRawPacketLogFromBytesFallback,
  meshcoreRawPacketResolveFromParsed,
  meshcoreRfIsSelfOriginated,
  meshcoreRfNodeHashCandidates,
  meshcoreRfResolvePathSender,
} from '../../lib/meshcoreRawPacketSender';
import { shouldCoalesceSelfFloodAdvert } from '../../lib/meshcoreRawSelfFloodAdvertCoalesce';
import { meshcoreSortedStorePrior } from '../../lib/meshcoreStoreDedup';
import { meshcoreMergeContactHopsAwayFromPrevious, pubkeyToNodeId } from '../../lib/meshcoreUtils';
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
import { getMeshtasticConnectedMyNodeNum } from '../../lib/meshtasticConnectedNodeRef';
import type { DomainEvent } from '../../lib/protocols/Protocol';
import { MAX_RAW_PACKET_LOG_ENTRIES } from '../../lib/rawPacketLogConstants';
import { getStoredMeshProtocol } from '../../lib/storedMeshProtocol';
import {
  MESHCORE_RAW_SELF_FLOOD_ADVERT_COALESCE_MS,
  MESHCORE_SYNC_NEXT_MESSAGE_MAX_PER_DRAIN,
  MESHCORE_SYNC_NEXT_MESSAGE_TIMEOUT_MS,
  MESHCORE_WAITING_MESSAGES_BATCH_YIELD,
} from '../../lib/timeConstants';
import type { ChatMessage, MeshNode, TelemetryPoint } from '../../lib/types';
import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { usePathHistoryStore } from '../../stores/pathHistoryStore';
import type {
  MeshcoreConnSideEffectsCtx,
  ProcessWaitingMessagesOptions,
} from './meshcoreConnSideEffectsCtx';
import { MAX_DEVICE_LOGS, MAX_TELEMETRY_POINTS, meshcoreDmAckKeyU32 } from './meshcoreHookPreamble';
import {
  getMeshcoreProcessWaitingMessagesInFlight,
  requestMeshcoreWaitingMessagesFollowUp,
  requestMeshcoreWaitingMessagesManualFollowUp,
  resetMeshcoreProcessWaitingMessagesSync,
  setMeshcoreProcessWaitingMessagesInFlight,
  takeMeshcoreWaitingMessagesFollowUp,
  takeMeshcoreWaitingMessagesManualFollowUp,
} from './meshcoreWaitingMessagesSyncState';

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
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
    setNodes,
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
    if (!manual && !silent) return;
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

  const processWaitingMessages = async (options?: ProcessWaitingMessagesOptions) => {
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
      return Promise.resolve();
    }
    const connectionType = meshcoreConnectTypeRef.current;
    const inFlight = (async () => {
      const startedAt = Date.now();
      let bannerActive = false;
      let processed = 0;
      let pendingMessages: ChatMessage[] = [];
      const workingNodes = new Map(readNodes());
      let nodesDirty = false;

      const flushBatch = () => {
        if (pendingMessages.length > 0) {
          addMessagesBatch(pendingMessages);
          pendingMessages = [];
        }
        if (nodesDirty) {
          setNodes(workingNodes);
          // Publish before React commits so the next drain iteration reads merged rows.
          const storeId = meshcoreIdentityIdRef.current;
          if (storeId) syncNodesMapToIdentityStore(storeId, workingNodes);
          nodesDirty = false;
        }
      };

      let syncTotal = 0;
      let silentDrainUiActive = false;

      const ingestItem = async (item: ReturnType<typeof normalizeMeshcoreWaitingMessageItem>) => {
        if (!item) return;
        try {
          const result = processMeshcoreWaitingMessageItem(
            item,
            buildWaitingMessageItemDeps(workingNodes),
          );
          if (result.nodesDirty) nodesDirty = true;
          if (result.pendingMessages.length > 0) {
            pendingMessages.push(...result.pendingMessages);
          }
          processed += 1;
          flushBatch();
          if (bannerActive) {
            setWaitingMessagesSyncProgress({ processed, total: syncTotal });
          }
        } catch (e: unknown) {
          console.warn(
            '[meshcoreConnSideEffects] processWaitingMessages ingest error ' +
              errLikeToLogString(e),
          );
        }
        await yieldToEventLoop();
      };

      if (!showSyncBanner) {
        setWaitingMessagesSilentDrainActive(true);
        silentDrainUiActive = true;
      }
      try {
        if (showSyncBanner) {
          const msgs = await withTimeout(
            conn.getWaitingMessages(),
            waitingMessagesDrainTimeoutMs(true, connectionType),
            'MeshCore getWaitingMessages',
          );
          if (!meshcoreHookMountedRef.current) return;
          const arr = normalizeMeshcoreWaitingMessageBatch(msgs);
          const total = arr.length;
          syncTotal = total;
          if (shouldActivateWaitingMessagesBanner(showSyncBanner, total)) {
            bannerActive = true;
            setWaitingMessagesSyncActive(true);
            setWaitingMessagesSyncProgress(null);
            setWaitingMessagesCount(total);
            setWaitingMessagesSyncProgress({ processed: 0, total });
          } else if (total === 0) {
            console.debug(
              '[meshcoreConnSideEffects] processWaitingMessages empty queue (manual sync)',
            );
            return;
          }
          console.debug('[meshcoreConnSideEffects] processWaitingMessages start', {
            count: total,
            showSyncBanner,
          });
          for (const m of arr) {
            if (!meshcoreHookMountedRef.current) break;
            await ingestItem(m);
            if (
              processed % MESHCORE_WAITING_MESSAGES_BATCH_YIELD === 0 ||
              pendingMessages.length >= MESHCORE_WAITING_MESSAGES_BATCH_YIELD
            ) {
              flushBatch();
            }
          }
          flushBatch();
        } else {
          console.debug('[meshcoreConnSideEffects] processWaitingMessages start (incremental)', {
            showSyncBanner,
          });
          let silentDrainExhaustedCap = false;
          for (let i = 0; i < MESHCORE_SYNC_NEXT_MESSAGE_MAX_PER_DRAIN; i += 1) {
            if (!meshcoreHookMountedRef.current) break;
            let raw: unknown;
            try {
              raw = await withTimeout(
                conn.syncNextMessage(),
                MESHCORE_SYNC_NEXT_MESSAGE_TIMEOUT_MS,
                'MeshCore syncNextMessage',
              );
            } catch (e: unknown) {
              if (isMeshcoreSyncNextMessageTimeoutError(e)) {
                break;
              }
              throw e;
            }
            const item = normalizeMeshcoreWaitingMessageItem(raw);
            if (!item) break;
            await ingestItem(item);
            if (i === MESHCORE_SYNC_NEXT_MESSAGE_MAX_PER_DRAIN - 1) {
              silentDrainExhaustedCap = true;
            }
          }
          if (silentDrainExhaustedCap) {
            requestMeshcoreWaitingMessagesFollowUp();
          }
          flushBatch();
        }
        console.debug('[meshcoreConnSideEffects] processWaitingMessages done', {
          count: processed,
          durationMs: Date.now() - startedAt,
          showSyncBanner,
        });
      } finally {
        if (silentDrainUiActive) {
          setWaitingMessagesSilentDrainActive(false);
        }
        if (bannerActive) {
          setWaitingMessagesCount(0);
          setWaitingMessagesSyncActive(false);
          setWaitingMessagesSyncProgress(null);
        }
        setMeshcoreProcessWaitingMessagesInFlight(null);
        maybeChainWaitingMessageFollowUp();
      }
    })();
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
    const snr = payload.lastSnr;
    const rssi = payload.lastRssi;
    const now = Date.now();
    const rawU8 = payload.raw;
    const loraPacketClass = rawU8 ? classifyPayload(rawU8) : null;

    // Extract sender ID and update known node's last_heard + signal metrics
    let senderInfo = '';
    if (rawU8 && rawU8.length >= 8 && loraPacketClass != null) {
      if (loraPacketClass === 'meshtastic') {
        const senderId = extractMeshtasticSenderId(rawU8);
        if (senderId !== null) {
          senderInfo = ` from=0x${senderId.toString(16)}`;
          // If we know this node (and it's not ourselves), update last_heard + SNR/RSSI
          if (senderId !== myNodeNumRef.current && readNodes().has(senderId)) {
            const nowSec = Math.floor(now / 1000);
            setNodes((prev) => {
              const existing = prev.get(senderId);
              if (!existing) return prev;
              const next = new Map(prev);
              next.set(senderId, {
                ...existing,
                last_heard: Math.max(existing.last_heard ?? 0, nowSec),
                snr: snr,
                rssi: rssi,
              });
              return next;
            });
          }
        }
      } else if (loraPacketClass === 'meshcore') {
        senderInfo = ' [meshcore]';
      }
    }

    const entry: DeviceLogEntry = {
      ts: now,
      level: 'debug',
      source: 'meshcore',
      message: `RX${senderInfo} SNR=${snr.toFixed(2)}dB RSSI=${rssi}dBm`,
    };
    setDeviceLogs((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_DEVICE_LOGS ? next.slice(next.length - MAX_DEVICE_LOGS) : next;
    });
    const sigPoint: TelemetryPoint = { timestamp: now, snr, rssi };
    setSignalTelemetry((prev) => [...prev, sigPoint].slice(-MAX_TELEMETRY_POINTS));

    // Packet-log metadata hoisted for the MQTT publish below (set inside the rawU8 block).
    let mqttRawHex: string | undefined;
    let mqttLen: number | undefined;
    let mqttPacketType: number | undefined;
    let mqttRoute: string | undefined;
    let mqttPayloadLen: number | undefined;
    let mqttHash: string | undefined;

    // Raw packet log: always run MeshCore in-house parse on this path (LOG_RX is MeshCore RF only).
    // Do not gate on classifyPayload — Meshtastic-shaped heuristics can mis-label MeshCore frames.
    if (rawU8) {
      let routeTypeString: string | null = null;
      let payloadTypeString: string | null = null;
      let hopCount = 0;
      let pathBytes: number[] = [];
      let pathHashSizeBytes: 1 | 2 | 3 = 1;
      let fromNodeId: number | null = null;
      let messageFingerprintHex: string | null = null;
      let transportScopeCode: number | null = null;
      let transportReturnCode: number | null = null;
      let advertName: string | null = null;
      let advertLat: number | null = null;
      let advertLon: number | null = null;
      let advertTimestampSec: number | null = null;
      let parseOk = false;

      const parsed = parseMeshCoreRfPacket(rawU8);
      if (parsed.ok) {
        parseOk = true;
        routeTypeString = parsed.routeTypeString;
        payloadTypeString = parsed.payloadTypeString;
        hopCount = parsed.hopCount;
        pathBytes = parsed.pathBytes;
        pathHashSizeBytes = parsed.pathHashSizeBytes;
        messageFingerprintHex = parsed.messageFingerprintHex;
        if (parsed.transportCodes) {
          transportScopeCode = parsed.transportCodes[0];
          transportReturnCode = parsed.transportCodes[1];
        }
        if (parsed.advert) {
          advertName = parsed.advert.name.length > 0 ? parsed.advert.name : null;
          advertLat = parsed.advert.latitudeDeg;
          advertLon = parsed.advert.longitudeDeg;
          advertTimestampSec = parsed.advert.timestampSec;
        }
        const id = meshcoreRawPacketResolveFromParsed(parsed, pubKeyPrefixMapRef.current);
        if (id != null) {
          fromNodeId = id;
          if (parsed.transportCodes) {
            void window.electronAPI.db
              .updateMeshcoreContactRfTransport(
                id,
                parsed.transportCodes[0],
                parsed.transportCodes[1],
              )
              .catch((e: unknown) => {
                console.warn(
                  '[meshcoreConnSideEffects] updateMeshcoreContactRfTransport error ' +
                    errLikeToLogString(e),
                );
              });
          }
        }
      } else {
        const fb = meshcoreRawPacketLogFromBytesFallback(rawU8, pubKeyPrefixMapRef.current);
        if (fb) {
          routeTypeString = fb.routeTypeString;
          payloadTypeString = fb.payloadTypeString;
          hopCount = fb.hopCount;
          pathBytes = fb.pathBytes;
          pathHashSizeBytes = fb.pathHashSizeBytes;
          if (fb.fromNodeId != null) fromNodeId = fb.fromNodeId;
        }
      }

      // Update hops_away on known MeshCore nodes from RF packet hop count.
      // Only use fromNodeId resolved by MeshCore parsing (before the Meshtastic fallback).
      if (fromNodeId !== null && fromNodeId !== myNodeNumRef.current) {
        const resolvedFromNodeId = fromNodeId;
        const nowSec = Math.floor(now / 1000);
        setNodes((prev) => {
          const existing = prev.get(resolvedFromNodeId);
          if (!existing) return prev;
          const mergedHopsAway = meshcoreMergeContactHopsAwayFromPrevious(
            hopCount,
            existing.hops_away,
            0,
          );
          const updated: MeshNode = {
            ...existing,
            hops_away: mergedHopsAway ?? hopCount,
            snr: snr,
            rssi: rssi,
            last_heard: Math.max(existing.last_heard ?? 0, nowSec),
            source: 'rf',
            heard_via_mqtt_only: false,
            via_mqtt: false,
          };

          // Optimization: skip identical updates
          if (
            existing.hops_away === updated.hops_away &&
            existing.snr === snr &&
            existing.rssi === rssi &&
            existing.last_heard === updated.last_heard
          ) {
            return prev;
          }

          const next = new Map(prev);
          next.set(resolvedFromNodeId, updated);

          void window.electronAPI.db
            .updateMeshcoreContactLastRf(
              resolvedFromNodeId,
              snr,
              rssi,
              mergedHopsAway ?? hopCount,
              nowSec,
            )
            .catch((e: unknown) => {
              console.warn(
                '[meshcoreConnSideEffects] updateMeshcoreContactLastRf error ' +
                  errLikeToLogString(e),
              );
            });
          void useDiagnosticsStore
            .getState()
            .saveMeshcoreHopHistory(resolvedFromNodeId, now, mergedHopsAway ?? hopCount, snr, rssi)
            .catch((e: unknown) => {
              console.warn(
                '[meshcoreConnSideEffects] saveMeshcoreHopHistory error ' + errLikeToLogString(e),
              );
            });

          return next;
        });
      }

      if (fromNodeId == null) {
        const mtId = meshtasticSenderIdForRawLogFallback(parseOk, rawU8);
        if (mtId != null) fromNodeId = mtId;
      }
      const rxEntry: RxPacketEntry = {
        ts: now,
        snr,
        rssi,
        raw: rawU8,
        routeTypeString,
        payloadTypeString,
        hopCount,
        pathBytes,
        pathHashSizeBytes,
        fromNodeId,
        messageFingerprintHex,
        transportScopeCode,
        transportReturnCode,
        advertName,
        advertLat,
        advertLon,
        advertTimestampSec,
        parseOk,
      };
      setRawPackets((prev) => {
        const myId = myNodeNumRef.current;
        const last = prev[prev.length - 1];
        if (
          myId !== 0 &&
          shouldCoalesceSelfFloodAdvert(
            last,
            rxEntry,
            myId,
            MESHCORE_RAW_SELF_FLOOD_ADVERT_COALESCE_MS,
          )
        ) {
          const next = [...prev.slice(0, -1), rxEntry];
          const trimmed =
            next.length > MAX_RAW_PACKET_LOG_ENTRIES
              ? next.slice(next.length - MAX_RAW_PACKET_LOG_ENTRIES)
              : next;
          // Sync before React commit so same-tick chat ingest sees this row.
          rawPacketsRef.current = trimmed;
          return trimmed;
        }
        const next = [...prev, rxEntry];
        const trimmed =
          next.length > MAX_RAW_PACKET_LOG_ENTRIES
            ? next.slice(next.length - MAX_RAW_PACKET_LOG_ENTRIES)
            : next;
        // Sync before React commit so same-tick chat ingest sees this row.
        rawPacketsRef.current = trimmed;
        return trimmed;
      });

      // Populate hoisted MQTT packet-log fields from the parsed result.
      mqttRawHex = Array.from(rawU8, (b) => b.toString(16).padStart(2, '0')).join('');
      mqttLen = rawU8.length;
      mqttPayloadLen = rawU8.length;
      if (parsed.ok) {
        mqttPacketType = parsed.payloadTypeNibble;
      }
      mqttRoute = routeTypeString ?? undefined;
      mqttHash = messageFingerprintHex ?? undefined;

      // Record noisy payload types for MeshCore
      // FLOOD (1001): Discovery Floods indicate routing loops or lost paths
      // FLOOD + ADVERT (1002): Flood-routed advertisements (room or device)
      if (fromNodeId != null && routeTypeString === 'FLOOD') {
        if (parsed.ok && parsed.advert != null) {
          useDiagnosticsStore.getState().recordNoisePort(fromNodeId, 1002);
        } else {
          useDiagnosticsStore.getState().recordNoisePort(fromNodeId, 1001);
        }
      }

      // MeshCore radio RF RX → Meshtastic Foreign LoRa (local overhear, not contact-list sync).
      const selfPubKey =
        myNodeNumRef.current !== 0
          ? (pubKeyMapRef.current.get(myNodeNumRef.current) ?? selfInfoRef.current?.publicKey)
          : undefined;
      const isSelfRf =
        myNodeNumRef.current !== 0 &&
        meshcoreRfIsSelfOriginated(rawU8, selfPubKey, myNodeNumRef.current);
      if (loraPacketClass === 'meshcore') {
        const mtNode = getMeshtasticConnectedMyNodeNum();
        if (mtNode > 0) {
          let rfSenderId = fromNodeId ?? undefined;
          let rfDisplayName: string | undefined;
          const meshcoreNodes = readNodes();
          if (parsed.ok) {
            if (rfSenderId == null && parsed.advert) {
              const advertId = pubkeyToNodeId(parsed.advert.publicKey);
              if (advertId !== 0) rfSenderId = advertId;
              if (parsed.advert.name.length > 0) rfDisplayName = parsed.advert.name;
            } else if (advertName) {
              rfDisplayName = advertName;
            }
            if (rfSenderId == null && parsed.pathBytes.length > 0) {
              const useAllContacts = hopCount <= 2 && rssi > -80 && parsed.pathBytes.length > 0;
              const pathCandidates = meshcoreRfNodeHashCandidates(
                meshcoreNodes,
                myNodeNumRef.current,
                useAllContacts ? { rssi: undefined } : { rssi },
              );
              const pathId = meshcoreRfResolvePathSender(parsed.pathBytes, pathCandidates);
              if (pathId != null) rfSenderId = pathId;
            }
          }
          const isOwnMeshcoreTx =
            isSelfRf ||
            (rfSenderId != null && rfSenderId === myNodeNumRef.current) ||
            (fromNodeId != null && fromNodeId === myNodeNumRef.current);
          if (isOwnMeshcoreTx && myNodeNumRef.current !== 0) {
            rfSenderId = myNodeNumRef.current;
            rfDisplayName =
              rfDisplayName ??
              selfInfoRef.current?.name?.trim() ??
              meshcoreNodes.get(myNodeNumRef.current)?.long_name ??
              meshcoreNodes.get(myNodeNumRef.current)?.short_name ??
              nicknameMapRef.current.get(myNodeNumRef.current);
          }
          if (rfSenderId != null && rfDisplayName == null) {
            const known = meshcoreNodes.get(rfSenderId);
            rfDisplayName =
              known?.long_name ?? known?.short_name ?? nicknameMapRef.current.get(rfSenderId);
          }
          const proximity = classifyProximity(rssi || undefined, snr || undefined);
          let rfFingerprint =
            rfSenderId == null && messageFingerprintHex ? messageFingerprintHex : undefined;
          if (isOwnMeshcoreTx) {
            rfFingerprint = undefined;
          }
          // Local RF only — skip distant mesh floods (identified or not).
          if (proximity !== 'very-close' && proximity !== 'nearby') {
            return;
          }
          if (rfSenderId == null && rfFingerprint == null) {
            return;
          }
          useDiagnosticsStore
            .getState()
            .recordForeignLora(
              mtNode,
              'meshcore',
              rssi || undefined,
              snr || undefined,
              rfSenderId,
              readNodes,
              'meshcore-radio-rf',
              rfFingerprint,
              rfDisplayName,
            );
        }
      }
    }

    // Foreign LoRa fingerprinting: only flag non-MeshCore packets as foreign (requires known self node ID)
    if (
      getStoredMeshProtocol() === 'meshcore' &&
      myNodeNumRef.current !== 0 &&
      rawU8 &&
      loraPacketClass != null
    ) {
      if (loraPacketClass !== 'meshcore') {
        const senderId = loraPacketClass === 'meshtastic' ? extractMeshtasticSenderId(rawU8) : null;
        useDiagnosticsStore
          .getState()
          .recordForeignLora(
            myNodeNumRef.current,
            loraPacketClass,
            rssi || undefined,
            snr || undefined,
            senderId ?? undefined,
            readNodes,
          );
      }
    }

    if (mqttStatusRef.current === 'connected') {
      const nowMs = Date.now();
      if (nowMs - lastPacketLogAtRef.current >= 100) {
        lastPacketLogAtRef.current = nowMs;
        void window.electronAPI.mqtt
          .publishMeshcorePacketLog({
            origin: selfInfoRef.current?.name ?? 'mesh-client',
            snr,
            rssi,
            rawHex: mqttRawHex,
            len: mqttLen,
            packetType: mqttPacketType,
            route: mqttRoute,
            payloadLen: mqttPayloadLen,
            hash: mqttHash,
          })
          .catch((e: unknown) => {
            const t = Date.now();
            if (t - lastPacketLogPublishFailureLogAtRef.current >= 30_000) {
              lastPacketLogPublishFailureLogAtRef.current = t;
              console.warn(
                '[meshcoreConnSideEffects] MQTT packet-log publish failed ' + errLikeToLogString(e),
              );
            }
          });
      }
    }
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
    if (routedIdentityId !== resolveIdentityId()) return;
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
