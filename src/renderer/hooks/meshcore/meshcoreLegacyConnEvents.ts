import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { parseMeshCoreRfPacket } from '../../../shared/meshcoreRfPacketParse';
import {
  classifyPayload,
  classifyProximity,
  extractMeshtasticSenderId,
  meshtasticSenderIdForRawLogFallback,
} from '../../lib/foreignLoraDetection';
import { shouldPreserveStaticGpsForSelfNode } from '../../lib/gpsSource';
import type {
  DeviceLogEntry,
  MeshCoreConnection,
  MeshCoreContactRaw,
  RxPacketEntry,
} from '../../lib/meshcore/meshcoreHookTypes';
import {
  buildMeshcoreRoomIncomingMessage,
  MESHCORE_TXT_TYPE_SIGNED_PLAIN,
  parseMeshcoreChannelIncomingFromThread,
  parseMeshcoreDmIncomingFromThread,
  parseMeshcoreRoomPostPayload,
  resolveMeshcoreChannelMessageSender,
} from '../../lib/meshcoreChannelText';
import {
  meshcoreCoerceRadioRxFrame,
  parseAutoaddConfigResponse,
} from '../../lib/meshcoreContactAutoAdd';
import {
  MESHCORE_CHAT_CORRELATE_WINDOW_MS,
  meshcoreCorrelateOrSynthesizeChatEntry,
  meshcoreFindRecentGrpTxtRawPacket,
} from '../../lib/meshcoreRawPacketCorrelate';
import {
  meshcoreRawPacketLogFromBytesFallback,
  meshcoreRawPacketResolveFromParsed,
  meshcoreRfIsSelfOriginated,
  meshcoreRfNodeHashCandidates,
  meshcoreRfResolvePathSender,
} from '../../lib/meshcoreRawPacketSender';
import { shouldCoalesceSelfFloodAdvert } from '../../lib/meshcoreRawSelfFloodAdvertCoalesce';
import { setMeshcoreRoomLastPostAt } from '../../lib/meshcoreRoomSyncStorage';
import { meshcoreSortedStorePrior } from '../../lib/meshcoreStoreDedup';
import {
  CONTACT_TYPE_LABELS,
  isMeshcoreTransportStatusChatLine,
  mergeHwModelOnContactUpdate,
  mergeMeshcoreChatStubNodes,
  MESHCORE_COORD_SCALE,
  meshcoreContactToMeshNode,
  meshcoreContactTypeFromHwModel,
  meshcoreInferHopsFromOutPath,
  meshcoreMergeChannelDisplayNameOntoNode,
  meshcoreMergeContactHopsAwayFromPrevious,
  meshcoreMinimalNodeFromAdvertEvent,
  meshcoreSliceContactOutPathForTrace,
  meshcoreSyntheticPlaceholderPubKeyHex,
  minimalMeshcoreChatNode,
  pubkeyToNodeId,
} from '../../lib/meshcoreUtils';
import { getMeshtasticConnectedMyNodeNum } from '../../lib/meshtasticConnectedNodeRef';
import {
  LAST_HEARD_MAX_FUTURE_SKEW_SEC,
  mergeMeshcoreLastHeardFromAdvert,
} from '../../lib/nodeStatus';
import { MAX_RAW_PACKET_LOG_ENTRIES } from '../../lib/rawPacketLogConstants';
import { getStoredMeshProtocol } from '../../lib/storedMeshProtocol';
import { MESHCORE_RAW_SELF_FLOOD_ADVERT_COALESCE_MS } from '../../lib/timeConstants';
import type { ChatMessage, IdentityId, MeshNode, TelemetryPoint } from '../../lib/types';
import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { updateMessageStatus, useMessageStore } from '../../stores/messageStore';
import { usePathHistoryStore } from '../../stores/pathHistoryStore';
import { usePositionHistoryStore } from '../../stores/positionHistoryStore';
import {
  contactToDbRow,
  MAX_DEVICE_LOGS,
  MAX_TELEMETRY_POINTS,
  meshcoreContactRawFromDevice,
  meshcoreDeviceAckLookupKeys,
  meshcoreDmAckKeyU32,
  type PendingDmAckEntry,
} from './meshcoreHookPreamble';
import type { MeshcoreLegacyConnEventsCtx } from './meshcoreLegacyConnEventsCtx';

/** Identity-scoped chat rows from {@link useSendMessage} use numeric ids after rename. */
function syncMeshcoreDmAckToMessageStore(
  identityId: IdentityId,
  ackKeyU32: number,
  selfId: number,
  newStatus: 'acked' | 'failed',
): void {
  const byId = useMessageStore.getState().messages[identityId] ?? {};
  for (const [id, rec] of Object.entries(byId)) {
    if (rec.from !== selfId) continue;
    if (rec.status !== 'sending' && rec.status !== 'failed') continue;
    if (!/^\d+$/.test(id)) continue;
    if (meshcoreDmAckKeyU32(Number(id)) !== ackKeyU32) continue;
    updateMessageStatus(identityId, id, newStatus);
  }
}

export function attachMeshcoreLegacyConnEvents(
  conn: MeshCoreConnection,
  ctx: MeshcoreLegacyConnEventsCtx,
): () => void {
  const protocolOwnedEvents = new Set<string | number>([128, 7, 8, 138, 'rx']);
  const {
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
    addMessage,
    addCliHistoryEntry,
    teardownMeshcoreConnEventListeners,
    meshcorePreviousNodesBaselineForBuild,
  } = ctx;

  /** PacketRouter + meshcoreIngest own parsed room posts when identity is bound. */
  const legacyOwnsRoomPosts = (): boolean => meshcoreIdentityIdRef.current == null;

  const storePriorForIngest = (): ChatMessage[] => {
    const storeId = meshcoreIdentityIdRef.current;
    if (storeId) return meshcoreSortedStorePrior(storeId);
    return [...messagesRef.current].sort((a, b) => a.timestamp - b.timestamp);
  };

  const meshcorePersistentListenerRegs: {
    event: string | number;
    handler: (...args: unknown[]) => void;
  }[] = [];
  const onMeshcoreConn = (event: string | number, handler: (...args: unknown[]) => void) => {
    if (protocolOwnedEvents.has(event)) return;
    conn.on(event, handler);
    meshcorePersistentListenerRegs.push({ event, handler });
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

  // Push: periodic advert — event 0x80 = 128 (meshcore.js emits publicKey only; lat/lastAdvert may be absent)
  onMeshcoreConn(128, (data: unknown) => {
    const d = data as {
      publicKey: Uint8Array;
      advLat?: number;
      advLon?: number;
      lastAdvert?: number;
      type?: number;
      advName?: string;
    };
    if (d.publicKey?.length !== 32) {
      return;
    }
    const nodeId = pubkeyToNodeId(d.publicKey);
    if (nodeId === 0) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const persistOut = {
      kind: 'none' as 'none' | 'insert' | 'update',
      persistLastAdvert: nowSec,
      persistLat: null as number | null,
      persistLon: null as number | null,
      insertContactType: 0,
      insertAdvName: null as string | null,
      /** Set on existing-contact updates when RF advert includes a new `advName` (optional 5th IPC arg). */
      persistAdvName: undefined as string | undefined,
    };
    setNodes((prev) => {
      const existing = prev.get(nodeId);
      const nick = nicknameMapRef.current.get(nodeId);
      const hasLat = typeof d.advLat === 'number' && Number.isFinite(d.advLat) && d.advLat !== 0;
      const hasLon = typeof d.advLon === 'number' && Number.isFinite(d.advLon) && d.advLon !== 0;
      const rawAdvertSec =
        typeof d.lastAdvert === 'number' && Number.isFinite(d.lastAdvert) && d.lastAdvert > 0
          ? Math.floor(d.lastAdvert)
          : undefined;
      const lastHeard = mergeMeshcoreLastHeardFromAdvert(
        rawAdvertSec,
        existing?.last_heard ?? nowSec,
        nowSec,
      );
      if (rawAdvertSec != null && rawAdvertSec > nowSec + LAST_HEARD_MAX_FUTURE_SKEW_SEC) {
        console.debug(
          `[useMeshcoreRuntime] clamped future lastAdvert nodeId=${nodeId.toString(16)} advertSec=${rawAdvertSec} nowSec=${nowSec}`,
        );
      }
      persistOut.persistLastAdvert = lastHeard;
      if (!existing) {
        const built = meshcoreMinimalNodeFromAdvertEvent(d.publicKey, {
          nowSec,
          advLat: d.advLat,
          advLon: d.advLon,
          lastAdvert: d.lastAdvert,
          contactType: d.type,
          advName: d.advName,
        });
        if (!built) return prev;
        persistOut.kind = 'insert';
        persistOut.persistLat = built.persistAdvLatDeg;
        persistOut.persistLon = built.persistAdvLonDeg;
        persistOut.insertContactType = built.contactType;
        persistOut.insertAdvName =
          typeof d.advName === 'string' && d.advName.trim() ? d.advName.trim() : null;
        pubKeyMapRef.current.set(nodeId, d.publicKey);
        const prefix = Array.from(d.publicKey.slice(0, 6))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        pubKeyPrefixMapRef.current.set(prefix, nodeId);
        const nodeWithNick = nick ? { ...built.node, long_name: nick, short_name: '' } : built.node;
        const next = new Map(prev);
        next.set(nodeId, nodeWithNick);
        return next;
      }
      persistOut.kind = 'update';
      pubKeyMapRef.current.set(nodeId, d.publicKey);
      const prefix = Array.from(d.publicKey.slice(0, 6))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      pubKeyPrefixMapRef.current.set(prefix, nodeId);
      const next = new Map(prev);
      const skipSelfStaticCoords = shouldPreserveStaticGpsForSelfNode(nodeId, myNodeNumRef.current);
      persistOut.persistLat =
        skipSelfStaticCoords || !hasLat
          ? (existing.latitude ?? null)
          : d.advLat! / MESHCORE_COORD_SCALE;
      persistOut.persistLon =
        skipSelfStaticCoords || !hasLon
          ? (existing.longitude ?? null)
          : d.advLon! / MESHCORE_COORD_SCALE;
      const advNameTrim = typeof d.advName === 'string' && d.advName.trim() ? d.advName.trim() : '';
      const applyAdvertName = !nick && Boolean(advNameTrim);
      if (applyAdvertName) {
        persistOut.persistAdvName = advNameTrim;
      }
      const advertType = typeof d.type === 'number' && Number.isFinite(d.type) ? d.type : -1;
      const newHwModel =
        advertType >= 0 ? (CONTACT_TYPE_LABELS[advertType] ?? 'Unknown') : existing.hw_model;
      const mergedHwModel = mergeHwModelOnContactUpdate(existing.hw_model, newHwModel);
      next.set(nodeId, {
        ...existing,
        last_heard: lastHeard,
        hw_model: mergedHwModel,
        latitude:
          skipSelfStaticCoords || !hasLat ? existing.latitude : d.advLat! / MESHCORE_COORD_SCALE,
        longitude:
          skipSelfStaticCoords || !hasLon ? existing.longitude : d.advLon! / MESHCORE_COORD_SCALE,
        ...(nick
          ? { long_name: nick, short_name: '' }
          : applyAdvertName
            ? { long_name: advNameTrim, short_name: '' }
            : {}),
      });
      if (mergedHwModel !== existing.hw_model) {
        const mergedType = meshcoreContactTypeFromHwModel(mergedHwModel);
        if (mergedType !== undefined) {
          void window.electronAPI.db
            .updateMeshcoreContactType(nodeId, mergedType)
            .catch((e: unknown) => {
              console.warn(
                '[useMeshcoreRuntime] updateMeshcoreContactType error ' + errLikeToLogString(e),
              );
            });
        }
      }
      return next;
    });
    if (
      typeof d.advLat === 'number' &&
      Number.isFinite(d.advLat) &&
      d.advLat !== 0 &&
      typeof d.advLon === 'number' &&
      Number.isFinite(d.advLon) &&
      d.advLon !== 0
    ) {
      usePositionHistoryStore
        .getState()
        .recordPosition(nodeId, d.advLat / MESHCORE_COORD_SCALE, d.advLon / MESHCORE_COORD_SCALE);
    }
    if (persistOut.kind === 'insert') {
      void window.electronAPI.db
        .saveMeshcoreContact({
          node_id: nodeId,
          public_key: Array.from(d.publicKey)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(''),
          adv_name: persistOut.insertAdvName,
          contact_type: persistOut.insertContactType,
          last_advert: persistOut.persistLastAdvert,
          adv_lat: persistOut.persistLat,
          adv_lon: persistOut.persistLon,
          nickname: null,
          on_radio: 1,
        })
        .catch((e: unknown) => {
          console.warn(
            '[useMeshcoreRuntime] saveMeshcoreContact (event 128 new) error ' +
              errLikeToLogString(e),
          );
        });
    } else if (persistOut.kind === 'update') {
      void window.electronAPI.db
        .updateMeshcoreContactAdvert(
          nodeId,
          persistOut.persistLastAdvert,
          persistOut.persistLat,
          persistOut.persistLon,
          persistOut.persistAdvName,
        )
        .catch((e: unknown) => {
          console.warn(
            '[useMeshcoreRuntime] updateMeshcoreContactAdvert error ' + errLikeToLogString(e),
          );
        });
    }
    // Foreign LoRa for MeshCore overhear is recorded from RF RX (event 136), not advert sync (128).
  });

  // Push: path updated — event 0x81 = 129; update last_heard for that contact
  onMeshcoreConn(129, (data: unknown) => {
    const d = data as { publicKey: Uint8Array };
    if (d.publicKey?.length !== 32) {
      return;
    }
    const nodeId = pubkeyToNodeId(d.publicKey);
    if (nodeId === 0) return;
    if (!meshcoreSessionPathUpdatedNodeIdsRef.current.has(nodeId)) {
      meshcoreSessionPathUpdatedNodeIdsRef.current.add(nodeId);
      setMeshcorePingRouteReadyEpoch((e) => e + 1);
    }
    useDiagnosticsStore.getState().recordPathUpdated(nodeId);
    const nowSec = Math.floor(Date.now() / 1000);
    const persist129 = {
      kind: 'none' as 'none' | 'insert' | 'update',
      persistLastAdvert: nowSec,
    };
    setNodes((prev) => {
      const existing = prev.get(nodeId);
      const nick = nicknameMapRef.current.get(nodeId);
      if (!existing) {
        const built = meshcoreMinimalNodeFromAdvertEvent(d.publicKey, { nowSec });
        if (!built) return prev;
        persist129.kind = 'insert';
        persist129.persistLastAdvert = built.lastHeardSec;
        pubKeyMapRef.current.set(nodeId, d.publicKey);
        const prefix = Array.from(d.publicKey.slice(0, 6))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        pubKeyPrefixMapRef.current.set(prefix, nodeId);
        const nodeWithNick = nick ? { ...built.node, long_name: nick, short_name: '' } : built.node;
        const next = new Map(prev);
        next.set(nodeId, nodeWithNick);
        return next;
      }
      // update path: only refresh last_heard in memory; DB last_advert is written next time event 128 fires
      persist129.kind = 'update';
      const next = new Map(prev);
      next.set(nodeId, {
        ...existing,
        last_heard: Math.max(existing.last_heard ?? 0, nowSec),
      });
      return next;
    });
    if (persist129.kind === 'insert') {
      void window.electronAPI.db
        .saveMeshcoreContact({
          node_id: nodeId,
          public_key: Array.from(d.publicKey)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(''),
          adv_name: null,
          contact_type: 0,
          last_advert: persist129.persistLastAdvert,
          adv_lat: null,
          adv_lon: null,
          nickname: null,
          on_radio: 1,
        })
        .catch((e: unknown) => {
          console.warn(
            '[useMeshcoreRuntime] saveMeshcoreContact (event 129 new) error ' +
              errLikeToLogString(e),
          );
        });
    }
    // Accumulate nodeIds for path history recording after the debounced refresh
    meshcorePathUpdatePendingRef.current.add(nodeId);
    // Refresh route bytes quickly so trace/ping can use outPath before the debounced full rebuild.
    void (async () => {
      if (!connRef.current) return;
      try {
        const contactsRaw = await connRef.current.getContacts();
        const contacts = contactsRaw.map(meshcoreContactRawFromDevice);
        for (const contact of contacts) {
          const cNodeId = pubkeyToNodeId(contact.publicKey);
          if (cNodeId !== nodeId) continue;
          const sliced = meshcoreSliceContactOutPathForTrace(contact.outPath, contact.outPathLen);
          if (sliced.length > 0) {
            outPathMapRef.current.set(cNodeId, sliced);
            const pathBytes = Array.from(sliced);
            const hops = meshcoreInferHopsFromOutPath(contact) ?? Math.max(0, pathBytes.length - 1);
            usePathHistoryStore.getState().recordPathUpdated(cNodeId, pathBytes, hops, false);
            meshcorePathUpdatePendingRef.current.delete(cNodeId);
          }
          break;
        }
      } catch (e: unknown) {
        console.warn(
          '[useMeshcoreRuntime] immediate path refresh after 129 error ' + errLikeToLogString(e),
        );
      }
    })();
    // Path updates may change hop counts; debounced contacts refresh to fetch updated outPathLen
    if (meshcoreContactsRefreshTimerRef.current) {
      clearTimeout(meshcoreContactsRefreshTimerRef.current);
    }
    meshcoreContactsRefreshTimerRef.current = setTimeout(() => {
      void (async () => {
        if (!connRef.current) return;
        const buildFn = buildNodesFromContactsRef.current;
        if (!buildFn) return;
        try {
          const contactsRaw = await connRef.current.getContacts();
          const contacts = contactsRaw.map(meshcoreContactRawFromDevice);
          setMeshcoreContactsForTelemetry(contacts);
          const newNodes = await buildFn(contacts, {
            self: selfInfoRef.current,
            myNodeId: myNodeNumRef.current,
            previousNodes: meshcorePreviousNodesBaselineForBuild(),
          });
          setNodes((prev) => mergeMeshcoreChatStubNodes(prev, newNodes));
          // Record path history for any nodeIds that triggered event 129
          const pendingIds = meshcorePathUpdatePendingRef.current;
          meshcorePathUpdatePendingRef.current = new Set();
          for (const contact of contacts) {
            const cNodeId = pubkeyToNodeId(contact.publicKey);
            if (!pendingIds.has(cNodeId)) continue;
            const sliced = meshcoreSliceContactOutPathForTrace(contact.outPath, contact.outPathLen);
            const pathBytes = sliced.length > 0 ? Array.from(sliced) : [];
            if (pathBytes.length > 0) {
              const hops = newNodes.get(cNodeId)?.hops_away ?? 0;
              usePathHistoryStore.getState().recordPathUpdated(cNodeId, pathBytes, hops, false);
            }
          }
        } catch (e) {
          console.warn(
            '[useMeshcoreRuntime] debounced contacts refresh error ' + errLikeToLogString(e),
          );
        }
      })();
    }, 2000);
  });

  // Push: send confirmed — event 0x82 = 130; resolve pending DM delivery
  // ackCode: 0x80 = RESP_CODE_ACK (success), 0x81 = RESP_CODE_NACK (failure)
  onMeshcoreConn(130, (data: unknown) => {
    const d = data as { ackCode: number; roundTrip?: number };
    if (typeof d.ackCode !== 'number' || !Number.isFinite(d.ackCode)) {
      console.warn('[useMeshcoreRuntime] event 130: non-numeric ackCode', d.ackCode);
      return;
    }
    const isNack = d.ackCode === 0x81 || d.ackCode === 129; // 0x81 or signed representation
    let pending: PendingDmAckEntry | undefined;
    for (const lk of meshcoreDeviceAckLookupKeys(d.ackCode)) {
      pending = pendingAcksRef.current.get(lk);
      if (pending) break;
    }
    if (!pending) {
      const lateKey = meshcoreDmAckKeyU32(d.ackCode);
      const selfId = myNodeNumRef.current;
      const newStatus = isNack ? 'failed' : 'acked';
      const hadLateOutbound = messagesRef.current.some(
        (m) =>
          m.packetId != null &&
          meshcoreDmAckKeyU32(m.packetId) === lateKey &&
          m.sender_id === selfId &&
          m.to != null &&
          (m.status === 'sending' || m.status === 'failed'),
      );
      const storeId = meshcoreIdentityIdRef.current;
      const hadLateInMessageStore =
        storeId != null &&
        Object.entries(useMessageStore.getState().messages[storeId] ?? {}).some(
          ([id, rec]) =>
            rec.from === selfId &&
            (rec.status === 'sending' || rec.status === 'failed') &&
            /^\d+$/.test(id) &&
            meshcoreDmAckKeyU32(Number(id)) === lateKey,
        );
      if (hadLateOutbound || hadLateInMessageStore) {
        if (hadLateOutbound) {
          setMessages((prev) =>
            prev.map((m) =>
              m.packetId != null &&
              meshcoreDmAckKeyU32(m.packetId) === lateKey &&
              m.sender_id === selfId &&
              m.to != null &&
              (m.status === 'sending' || m.status === 'failed')
                ? { ...m, status: newStatus }
                : m,
            ),
          );
        }
        if (storeId) syncMeshcoreDmAckToMessageStore(storeId, lateKey, selfId, newStatus);
        void window.electronAPI.db
          .updateMeshcoreMessageStatus(lateKey, newStatus)
          .catch((e: unknown) => {
            console.warn(
              '[useMeshcoreRuntime] updateMeshcoreMessageStatus (late 130) error ' +
                errLikeToLogString(e),
            );
          });
      }
      return;
    }
    clearTimeout(pending.timeoutId);
    for (const k of pending.mapKeys) {
      pendingAcksRef.current.delete(k);
    }
    if (pending.destNodeId != null && pending.pathHash != null) {
      usePathHistoryStore
        .getState()
        .recordOutcome(
          pending.destNodeId,
          pending.pathHash,
          !isNack,
          !isNack && typeof d.roundTrip === 'number' ? d.roundTrip : undefined,
        );
    }
    const canon = pending.canonicalPacketIdU32;
    const newStatus = isNack ? 'failed' : 'acked';
    setMessages((prev) =>
      prev.map((m) =>
        m.packetId != null && meshcoreDmAckKeyU32(m.packetId) === canon
          ? { ...m, status: newStatus }
          : m,
      ),
    );
    const storeId = meshcoreIdentityIdRef.current;
    if (storeId) {
      syncMeshcoreDmAckToMessageStore(storeId, canon, myNodeNumRef.current, newStatus);
    }
    void window.electronAPI.db.updateMeshcoreMessageStatus(canon, newStatus).catch((e: unknown) => {
      console.warn(
        '[useMeshcoreRuntime] updateMeshcoreMessageStatus error ' + errLikeToLogString(e),
      );
    });
  });

  // Push: new contact discovered — event 0x8A = 138
  onMeshcoreConn(138, (data: unknown) => {
    const d = meshcoreContactRawFromDevice(data as MeshCoreContactRaw);
    const node = meshcoreContactToMeshNode(d);
    pubKeyMapRef.current.set(node.node_id, d.publicKey);
    outPathMapRef.current.set(
      node.node_id,
      meshcoreSliceContactOutPathForTrace(d.outPath, d.outPathLen),
    );
    const prefix = Array.from(d.publicKey.slice(0, 6))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    pubKeyPrefixMapRef.current.set(prefix, node.node_id);
    const nick = nicknameMapRef.current.get(node.node_id);
    const nodeWithNick = nick ? { ...node, long_name: nick, short_name: '' } : node;
    const prevHopsForDb = nodesRef.current.get(nodeWithNick.node_id)?.hops_away;
    const mergedHopsForDb = meshcoreMergeContactHopsAwayFromPrevious(
      nodeWithNick.hops_away,
      prevHopsForDb,
      0,
    );
    setNodes((prev) => {
      const next = new Map(prev);
      const existing = prev.get(nodeWithNick.node_id);
      next.set(nodeWithNick.node_id, {
        ...(existing ?? {}),
        ...nodeWithNick,
        hw_model: mergeHwModelOnContactUpdate(existing?.hw_model, nodeWithNick.hw_model),
        hops_away: meshcoreMergeContactHopsAwayFromPrevious(
          nodeWithNick.hops_away,
          existing?.hops_away,
          0,
        ),
      });
      return next;
    });
    void window.electronAPI.db
      .saveMeshcoreContact(contactToDbRow(d, nick ?? null, 1, undefined, mergedHopsForDb))
      .catch((e: unknown) => {
        console.warn(
          '[useMeshcoreRuntime] saveMeshcoreContact (event 138) error ' + errLikeToLogString(e),
        );
      });
  });

  // Push: message waiting — event 0x83 = 131; fetch all queued messages
  const processWaitingMessages = async () => {
    const msgs = await conn.getWaitingMessages();
    if (!meshcoreHookMountedRef.current) return;
    const arr = msgs as {
      contactMessage?: { pubKeyPrefix: Uint8Array; senderTimestamp: number; text: string };
      channelMessage?: { channelIdx: number; senderTimestamp: number; text: string };
    }[];
    for (const m of arr) {
      if (m.contactMessage) {
        const d = m.contactMessage;
        const prefix = Array.from(d.pubKeyPrefix)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const senderId = pubKeyPrefixMapRef.current.get(prefix) ?? 0;
        if (senderId === 0) {
          console.warn(
            '[useMeshcoreRuntime] event 131: unknown pubKeyPrefix in queued DM, sender will be 0',
            prefix,
          );
        }
        const sender = nodesRef.current.get(senderId);
        if (senderId !== 0) {
          setNodes((prev) => {
            const node = prev.get(senderId);
            if (!node) return prev;
            const next = new Map(prev);
            next.set(senderId, {
              ...node,
              last_heard: Math.max(node.last_heard ?? 0, d.senderTimestamp),
            });
            return next;
          });
        }
        if (isMeshcoreTransportStatusChatLine(d.text)) {
          logTransportLineAsDevice(d.text);
        } else if (sender?.hw_model === 'Room') {
          if (!legacyOwnsRoomPosts()) {
            void setMeshcoreRoomLastPostAt(senderId, d.senderTimestamp * 1000);
          } else {
            const { authorId, payload } = parseMeshcoreRoomPostPayload(
              d.text,
              pubKeyPrefixMapRef.current,
            );
            const authorNode = authorId !== 0 ? nodesRef.current.get(authorId) : undefined;
            const authorName =
              authorNode?.long_name ??
              (authorId !== 0 ? `Node-${authorId.toString(16).toUpperCase()}` : 'Unknown');
            addMessage(
              buildMeshcoreRoomIncomingMessage({
                rawText: payload,
                roomServerId: senderId,
                authorId: authorId !== 0 ? authorId : myNodeNumRef.current || 0,
                authorName,
                timestamp: d.senderTimestamp * 1000,
                receivedVia: 'rf',
              }),
            );
          }
        } else {
          addMessage({
            ...parseMeshcoreDmIncomingFromThread(storePriorForIngest(), {
              rawText: d.text,
              senderId,
              displayName: sender?.long_name ?? `Node-${senderId.toString(16).toUpperCase()}`,
              timestamp: d.senderTimestamp * 1000,
              receivedVia: 'rf',
              peerNodeId: senderId,
              myNodeId: myNodeNumRef.current || 0,
              to: myNodeNumRef.current || undefined,
            }),
            isHistory: true,
          });
        }
      }
      if (m.channelMessage) {
        const d = m.channelMessage;
        if (isMeshcoreTransportStatusChatLine(d.text)) {
          logTransportLineAsDevice(d.text);
          continue;
        }
        const resolved = resolveMeshcoreChannelMessageSender({
          rawText: d.text,
          nodes: nodesRef.current,
        });
        if (resolved.senderId !== 0) {
          setNodes((prev) => {
            const next = new Map(prev);
            const existing = next.get(resolved.senderId);
            next.set(
              resolved.senderId,
              existing
                ? meshcoreMergeChannelDisplayNameOntoNode(
                    {
                      ...existing,
                      last_heard: Math.max(existing.last_heard ?? 0, d.senderTimestamp),
                    },
                    resolved.displayName,
                  )
                : minimalMeshcoreChatNode(
                    resolved.senderId,
                    resolved.displayName,
                    d.senderTimestamp,
                    'rf',
                  ),
            );
            return next;
          });
        }
        addMessage({
          ...parseMeshcoreChannelIncomingFromThread(storePriorForIngest(), {
            rawText: d.text,
            senderId: resolved.senderId,
            displayName: resolved.displayName,
            channel: d.channelIdx,
            timestamp: d.senderTimestamp * 1000,
            receivedVia: 'rf',
          }),
          isHistory: true,
        });
      }
    }
  };
  processWaitingMessagesRef.current = processWaitingMessages;
  onMeshcoreConn(131, () => {
    void (async () => {
      try {
        await processWaitingMessages();
      } catch (e) {
        console.warn(
          '[useMeshcoreRuntime] getWaitingMessages error, retrying in 2 s ' + errLikeToLogString(e),
        );
        // Single retry — device may be busy during BLE reconnect
        setTimeout(() => {
          if (!meshcoreHookMountedRef.current) return;
          void processWaitingMessages().catch((e2: unknown) => {
            console.warn(
              '[useMeshcoreRuntime] getWaitingMessages retry failed ' + errLikeToLogString(e2),
            );
          });
        }, 2_000);
      }
    })();
  });

  // Incoming DM — event 7
  onMeshcoreConn(7, (data: unknown) => {
    const now = Date.now();
    const d = data as {
      pubKeyPrefix: Uint8Array;
      text: string;
      senderTimestamp: number;
      txtType?: number;
    };
    const prefix = Array.from(d.pubKeyPrefix)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const senderId = pubKeyPrefixMapRef.current.get(prefix) ?? 0;
    if (senderId === 0) {
      console.warn('[useMeshcoreRuntime] event 7: unknown pubKeyPrefix, sender will be 0', prefix);
    }
    const sender = nodesRef.current.get(senderId);
    // CLI data response (txtType === 1)
    if (d.txtType === 1) {
      const service = repeaterCommandServiceRef.current;
      if (service) {
        const handled = service.handleResponse(d.text);
        if (handled) {
          return;
        }
      } else {
        console.warn(
          '[useMeshcoreRuntime] event 7: CLI response received but no command service active (sender:',
          senderId.toString(16).toUpperCase(),
          ')',
        );
      }
      // CLI response without matching pending command - add to history
      if (senderId !== 0) {
        const { body } = service ? service.parseResponseToken(d.text) : { body: d.text };
        addCliHistoryEntry(senderId, {
          type: 'received',
          text: body,
          timestamp: Date.now(),
        });
      }
      return;
    }

    // Room server pushed post (SignedPlain) — not a DM to the room infrastructure node.
    if (d.txtType === MESHCORE_TXT_TYPE_SIGNED_PLAIN && sender?.hw_model === 'Room') {
      const postTs = d.senderTimestamp * 1000;
      if (!legacyOwnsRoomPosts()) {
        void setMeshcoreRoomLastPostAt(senderId, postTs);
        return;
      }
      const { authorId, payload } = parseMeshcoreRoomPostPayload(
        d.text,
        pubKeyPrefixMapRef.current,
      );
      const authorNode = authorId !== 0 ? nodesRef.current.get(authorId) : undefined;
      const authorName =
        authorNode?.long_name ??
        (authorId !== 0 ? `Node-${authorId.toString(16).toUpperCase()}` : 'Unknown');
      addMessage(
        buildMeshcoreRoomIncomingMessage({
          rawText: payload,
          roomServerId: senderId,
          authorId: authorId !== 0 ? authorId : myNodeNumRef.current || 0,
          authorName,
          timestamp: postTs,
          receivedVia: 'rf',
        }),
      );
      void setMeshcoreRoomLastPostAt(senderId, postTs);
      return;
    }

    if (senderId !== 0) {
      setNodes((prev) => {
        const node = prev.get(senderId);
        if (!node) return prev;
        const next = new Map(prev);
        next.set(senderId, {
          ...node,
          last_heard: Math.max(node.last_heard ?? 0, d.senderTimestamp),
        });
        return next;
      });
    }
    if (isMeshcoreTransportStatusChatLine(d.text)) {
      logTransportLineAsDevice(d.text);
      return;
    }
    const dmRfMatch = rawPacketsRef.current
      .slice()
      .reverse()
      .find(
        (e) =>
          e.payloadTypeString === 'TXT_MSG' &&
          e.fromNodeId === null &&
          now - e.ts <= MESHCORE_CHAT_CORRELATE_WINDOW_MS,
      );
    addMessage(
      parseMeshcoreDmIncomingFromThread(storePriorForIngest(), {
        rawText: d.text,
        senderId,
        displayName: sender?.long_name ?? `Node-${senderId.toString(16).toUpperCase()}`,
        timestamp: d.senderTimestamp * 1000,
        receivedVia: 'rf',
        rxHops: dmRfMatch != null ? dmRfMatch.hopCount : undefined,
        peerNodeId: senderId,
        myNodeId: myNodeNumRef.current || 0,
        to: myNodeNumRef.current || undefined,
      }),
    );
    const resolvedSenderId = senderId !== 0 ? senderId : null;
    setRawPackets((prev) =>
      meshcoreCorrelateOrSynthesizeChatEntry(prev, 'TXT_MSG', resolvedSenderId, {
        ts: now,
        snr: 0,
        rssi: 0,
        raw: new Uint8Array(0),
        routeTypeString: null,
        payloadTypeString: 'TXT_MSG',
        hopCount: 0,
        fromNodeId: resolvedSenderId,
        messageFingerprintHex: null,
        transportScopeCode: null,
        transportReturnCode: null,
        advertName: null,
        advertLat: null,
        advertLon: null,
        advertTimestampSec: null,
        parseOk: false,
      }),
    );
  });

  // Incoming channel message — event 8
  onMeshcoreConn(8, (data: unknown) => {
    const now = Date.now();
    const d = data as { channelIdx: number; text: string; senderTimestamp: number };
    if (isMeshcoreTransportStatusChatLine(d.text)) {
      logTransportLineAsDevice(d.text);
      return;
    }
    const rfMatch = meshcoreFindRecentGrpTxtRawPacket(rawPacketsRef.current, now);
    const hopsAway = rfMatch?.hopCount;
    const resolved = resolveMeshcoreChannelMessageSender({
      rawText: d.text,
      rfFromNodeId: rfMatch?.fromNodeId ?? null,
      rfAdvertName: rfMatch?.advertName ?? null,
      nodes: nodesRef.current,
    });
    if (resolved.senderId !== 0) {
      setNodes((prev) => {
        const next = new Map(prev);
        const existing = next.get(resolved.senderId);
        const updated: MeshNode = existing
          ? meshcoreMergeChannelDisplayNameOntoNode(
              {
                ...existing,
                last_heard: Math.max(existing.last_heard ?? 0, d.senderTimestamp),
                ...(hopsAway != null ? { hops_away: hopsAway } : {}),
                source: 'rf',
                heard_via_mqtt_only: false,
                via_mqtt: false,
              },
              resolved.displayName,
            )
          : {
              ...minimalMeshcoreChatNode(
                resolved.senderId,
                resolved.displayName,
                d.senderTimestamp,
                'rf',
              ),
              ...(hopsAway != null ? { hops_away: hopsAway } : {}),
              source: 'rf',
              heard_via_mqtt_only: false,
              via_mqtt: false,
            };
        next.set(resolved.senderId, updated);
        if (hopsAway != null) {
          void window.electronAPI.db.saveMeshcoreContact({
            node_id: resolved.senderId,
            public_key: meshcoreSyntheticPlaceholderPubKeyHex(resolved.senderId),
            adv_name: resolved.displayName,
            contact_type: 1,
            last_advert: d.senderTimestamp,
            nickname: null,
            hops_away: hopsAway,
            on_radio: 1,
          });
        }
        return next;
      });
    }
    addMessage(
      parseMeshcoreChannelIncomingFromThread(storePriorForIngest(), {
        rawText: d.text,
        senderId: resolved.senderId,
        displayName: resolved.displayName,
        channel: d.channelIdx,
        timestamp: d.senderTimestamp * 1000,
        receivedVia: 'rf',
        rxHops: rfMatch != null ? rfMatch.hopCount : undefined,
      }),
    );
    if (mqttStatusRef.current === 'connected') {
      void window.electronAPI.mqtt
        .publishMeshcorePacketLog({
          origin: selfInfoRef.current?.name ?? 'mesh-client',
          snr: rfMatch?.snr ?? 0,
          rssi: rfMatch?.rssi ?? 0,
        })
        .catch((e: unknown) => {
          console.warn(
            '[useMeshcoreRuntime] publishMeshcorePacketLog (heard RF) error ' +
              errLikeToLogString(e),
          );
        });
    }
    setRawPackets((prev) =>
      meshcoreCorrelateOrSynthesizeChatEntry(prev, 'GRP_TXT', resolved.senderId || null, {
        ts: now,
        snr: 0,
        rssi: 0,
        raw: new Uint8Array(0),
        routeTypeString: null,
        payloadTypeString: 'GRP_TXT',
        hopCount: 0,
        fromNodeId: resolved.senderId || null,
        messageFingerprintHex: null,
        transportScopeCode: null,
        transportReturnCode: null,
        advertName: null,
        advertLat: null,
        advertLon: null,
        advertTimestampSec: null,
        parseOk: false,
      }),
    );
  });

  // Push: RF packet received — event 0x88 = 136; feed into device logs + signal telemetry.
  // Foreign LoRa fingerprinting requires d.raw (Uint8Array) from meshcore.js/device.
  onMeshcoreConn(136, (data: unknown) => {
    const d = data as { lastSnr?: number; lastRssi?: number; raw?: unknown };
    const snr = d.lastSnr ?? 0;
    const rssi = d.lastRssi ?? 0;
    const now = Date.now();
    const rawU8 = d.raw instanceof Uint8Array && d.raw.length > 0 ? d.raw : null;
    const loraPacketClass = rawU8 ? classifyPayload(rawU8) : null;

    // Extract sender ID and update known node's last_heard + signal metrics
    let senderInfo = '';
    if (rawU8 && rawU8.length >= 8 && loraPacketClass != null) {
      if (loraPacketClass === 'meshtastic') {
        const senderId = extractMeshtasticSenderId(rawU8);
        if (senderId !== null) {
          senderInfo = ` from=0x${senderId.toString(16)}`;
          // If we know this node (and it's not ourselves), update last_heard + SNR/RSSI
          if (senderId !== myNodeNumRef.current && nodesRef.current.has(senderId)) {
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
                  '[useMeshcoreRuntime] updateMeshcoreContactRfTransport error ' +
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
          if (fb.fromNodeId != null) fromNodeId = fb.fromNodeId;
        }
      }

      // Update hops_away on known MeshCore nodes from RF packet hop count.
      // Only use fromNodeId resolved by MeshCore parsing (before the Meshtastic fallback).
      if (fromNodeId !== null && fromNodeId !== myNodeNumRef.current) {
        const nowSec = Math.floor(now / 1000);
        setNodes((prev) => {
          const existing = prev.get(fromNodeId!);
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
          next.set(fromNodeId!, updated);

          void window.electronAPI.db
            .updateMeshcoreContactLastRf(fromNodeId!, snr, rssi, mergedHopsAway ?? hopCount, nowSec)
            .catch((e: unknown) => {
              console.warn(
                '[useMeshcoreRuntime] updateMeshcoreContactLastRf error ' + errLikeToLogString(e),
              );
            });
          void useDiagnosticsStore
            .getState()
            .saveMeshcoreHopHistory(fromNodeId!, now, mergedHopsAway ?? hopCount, snr, rssi)
            .catch((e: unknown) => {
              console.warn(
                '[useMeshcoreRuntime] saveMeshcoreHopHistory error ' + errLikeToLogString(e),
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
          return next.length > MAX_RAW_PACKET_LOG_ENTRIES
            ? next.slice(next.length - MAX_RAW_PACKET_LOG_ENTRIES)
            : next;
        }
        const next = [...prev, rxEntry];
        return next.length > MAX_RAW_PACKET_LOG_ENTRIES
          ? next.slice(next.length - MAX_RAW_PACKET_LOG_ENTRIES)
          : next;
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
          const meshcoreNodes = nodesRef.current;
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
              () => nodesRef.current,
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
            () => nodesRef.current,
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
          .catch(() => {
            const t = Date.now();
            if (t - lastPacketLogPublishFailureLogAtRef.current >= 30_000) {
              lastPacketLogPublishFailureLogAtRef.current = t;
            }
          });
      }
    }
  });

  onMeshcoreConn('disconnected', () => {
    setState((prev) => {
      const wasOperational =
        prev.status === 'connected' || prev.status === 'configured' || prev.status === 'stale';
      return {
        ...prev,
        status: 'disconnected',
        connectionLoss: wasOperational,
      };
    });
    const staleConn = connRef.current;
    connRef.current = null;
    queueMicrotask(() => {
      teardownMeshcoreConnEventListeners({ driverDisconnect: false });
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
      if (staleConn) {
        void staleConn.close().catch(() => {});
      }
    });
  });

  onMeshcoreConn('rx', (data: unknown) => {
    const frame = meshcoreCoerceRadioRxFrame(data);
    const parsed = frame && parseAutoaddConfigResponse(frame);
    if (parsed) setMeshcoreAutoadd(parsed);
  });

  return () => {
    for (const { event, handler } of meshcorePersistentListenerRegs) {
      conn.off(event, handler);
    }
    processWaitingMessagesRef.current = null;
  };
}
