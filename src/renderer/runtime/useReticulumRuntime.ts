import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isReticulumAutostartEnabled } from '@/renderer/lib/appSettingsStorage';
import { BatchedRingBufferAppender } from '@/renderer/lib/batchedRingBufferAppender';
import { requestChatOutboxDrain } from '@/renderer/lib/chatOutboxDrain';
import {
  buildReticulumDiagnosticRows,
  mergeReticulumDiagnosticRows,
} from '@/renderer/lib/diagnostics/ReticulumDiagnosticEngine';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import i18n from '@/renderer/lib/i18n';
import {
  ingestReticulumLxmfPayloadWithSideEffects,
  type ReticulumLxmfPayload,
} from '@/renderer/lib/ingest/reticulumIngest';
import {
  MAX_RAW_PACKET_LOG_ENTRIES,
  type ReticulumRawPacketEntry,
} from '@/renderer/lib/rawPacketLogConstants';
import {
  applyReticulumOutboundDeliveryStatus,
  flushPendingReticulumOutboundDeliveryStatus,
} from '@/renderer/lib/reticulum/applyReticulumOutboundDeliveryStatus';
import {
  resolveReticulumOutboundViaFromPath,
  reticulumViaToMessageTransport,
} from '@/renderer/lib/reticulum/classifyReticulumVia';
import { clearReticulumSessionStores } from '@/renderer/lib/reticulum/clearReticulumSessionStores';
import {
  resolveReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import { extractLxmfPayloadFromSendResponse } from '@/renderer/lib/reticulum/lxmfSendResponse';
import {
  markStaleReticulumOutboundInStore,
  markStaleReticulumOutboundMessages,
  RETICULUM_STALE_OUTBOUND_MS,
} from '@/renderer/lib/reticulum/markStaleReticulumOutbound';
import { cacheReticulumInboundAttachment } from '@/renderer/lib/reticulum/reticulumAttachmentCache';
import { fetchReticulumConfigAudit } from '@/renderer/lib/reticulum/reticulumConfigAudit';
import {
  logReticulumInterfaceStateEvent,
  logReticulumLocalInterfaceHealthChanges,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceLogging';
import {
  pickReticulumLocalHealthPollMs,
  scheduleReticulumLocalInterfaceBurst,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceRefresh';
import { failReticulumSendingOutboundToDestHash } from '@/renderer/lib/reticulum/reticulumOutboundFailureBridge';
import { applyPropagationSyncEvent } from '@/renderer/lib/reticulum/reticulumPropagationSync';
import { reticulumWireRowToEntry } from '@/renderer/lib/reticulum/reticulumRawPacketLog';
import {
  resolveReticulumSelfFullLabel,
  resolveReticulumSelfHeaderLabel,
} from '@/renderer/lib/reticulum/reticulumSelfNodeLabel';
import {
  peersUpdatedRequiresFullRefresh,
  RETICULUM_PEER_REFRESH_STORM_COALESCE_MS,
  reticulumSidecarEventRefreshActions,
  scheduleLeadingTrailingRefresh,
  scheduleTrailingOnlyRefresh,
} from '@/renderer/lib/reticulum/reticulumSidecarPeerRefreshEvents';
import {
  fetchReticulumIdentityStatus,
  fetchReticulumInterfaces,
  fetchReticulumSerialPorts,
  getCachedReticulumEffectivePrimaryLocalSerialInterfaceId,
  invalidateReticulumInterfacesCache,
  type ReticulumSidecarInterfaceRow,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { parseReticulumStackSettingsPayload } from '@/renderer/lib/reticulum/reticulumStackSettings';
import { useReticulumNobleBleYieldWatcher } from '@/renderer/lib/reticulum/useReticulumNobleBleYieldWatcher';
import { useReticulumPropagationAutoSync } from '@/renderer/lib/reticulum/useReticulumPropagationAutoSync';
import { LARGE_MESH_NODE_THRESHOLD } from '@/renderer/lib/sessionMemoryCaps';
import { registerReticulumSession } from '@/renderer/lib/sessions/reticulumSession';
import {
  nodeRecordsToMeshNodeMap,
  reticulumDbRowToMessageRecord,
} from '@/renderer/lib/storeRecordAdapters';
import {
  type ReticulumIdentityStatus,
  useReticulumIdentityStore,
} from '@/renderer/stores/reticulumIdentityStore';
import type { ReticulumSidecarEvent, ReticulumWirePacketRow } from '@/shared/reticulum-types';

import { getIdentityIdForProtocol } from '../lib/identityByProtocol';
import { getOfflineIdentityIdForProtocol } from '../lib/offlineProtocolIdentities';
import type { DeviceState, MeshNode } from '../lib/types';
import { useBlockStore } from '../stores/blockStore';
import { setConnection } from '../stores/connectionStore';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { useIdentityStore } from '../stores/identityStore';
import {
  renameMessageId,
  replaceMessageRecordsForIdentity,
  updateMessageStatus,
  useMessageStore,
} from '../stores/messageStore';
import { upsertNodeRecord, upsertNodeRecordsForIdentity, useNodeStore } from '../stores/nodeStore';
import { useNomadNetworkStore } from '../stores/nomadNetworkStore';
import { useReticulumDiscoveryMapStore } from '../stores/reticulumDiscoveryMapStore';
import {
  parseAnnounceActivityRows,
  useReticulumIdentityActivityStore,
} from '../stores/reticulumIdentityActivityStore';
import { useReticulumPacketStore } from '../stores/reticulumPacketStore';
import {
  applyReticulumAnnounceReceivedOptimistic,
  applyReticulumPeersUpdatedPatches,
  refreshReticulumPeersFromSidecar,
  RETICULUM_PEER_REFRESH_MS,
  reticulumContactToNodeRecordPreservingLabel,
  reticulumHashForNodeId,
  reticulumSelfIdentityToNodeRecord,
  useReticulumPeerStore,
} from '../stores/reticulumPeerStore';
import { useRrcHubStore } from '../stores/rrcHubStore';
import { useRrcSessionStore } from '../stores/rrcSessionStore';
import type { ProtocolRuntime } from './protocolRuntime';

/** Safety poll interval when the path table is large. */
const RETICULUM_PEER_REFRESH_LARGE_MS = 60_000;

const INITIAL_STATE: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  connectionType: null,
};

const UINT8_BASE64_CHUNK_SIZE = 0x8000;

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += UINT8_BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + UINT8_BASE64_CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export type ReticulumRuntime = ReturnType<typeof useReticulumRuntime>;

export function useReticulumRuntime(): ProtocolRuntime {
  const identityId =
    useIdentityStore(() => getIdentityIdForProtocol('reticulum')) ??
    getOfflineIdentityIdForProtocol('reticulum');
  const [state, setState] = useState<DeviceState>(INITIAL_STATE);
  useReticulumPropagationAutoSync(state.status === 'configured');
  const [selfLxmfHash, setSelfLxmfHash] = useState<string | null>(null);
  const [rawPackets, setRawPackets] = useState<ReticulumRawPacketEntry[]>([]);
  const rawPacketAppenderRef = useRef<BatchedRingBufferAppender<ReticulumRawPacketEntry> | null>(
    null,
  );
  rawPacketAppenderRef.current ??= new BatchedRingBufferAppender(
    setRawPackets,
    MAX_RAW_PACKET_LOG_ENTRIES,
  );
  const unsubEventRef = useRef<(() => void) | null>(null);
  const connectRef = useRef<(() => Promise<void>) | null>(null);
  const restartStackRef = useRef<(() => Promise<void>) | null>(null);
  const connectInFlightRef = useRef(false);
  const connectInFlightDoneRef = useRef<Promise<void> | null>(null);
  const suppressReconnectRef = useRef(false);
  /**
   * Bumped on every power-suspend so a `connect()` flight started before an earlier suspend
   * (and still in flight when a *later* suspend/resume pair fires) can detect it has been
   * superseded and skip finalizing a stale "configured" state. Independent of `suppressReconnectRef`
   * (B1's sticky user-disconnect): that flag decides whether to reconnect at all; this one decides
   * whether an already-in-flight connect's result is still safe to apply.
   */
  const resumeGenerationRef = useRef(0);
  const peerRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagnosticsRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localInterfaceBurstCancelRef = useRef<(() => void) | null>(null);
  const localInterfacePollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  const localInterfacesRef = useRef<ReticulumSidecarInterfaceRow[]>([]);
  const processedLinkTimeoutDestsRef = useRef(new Set<string>());
  const nodeStoreSlice = useNodeStore((s) => (identityId ? s.nodes[identityId] : undefined));

  const sidecarActiveForBleYield =
    state.status === 'configured' || state.status === 'connected' || state.status === 'stale';
  useReticulumNobleBleYieldWatcher(sidecarActiveForBleYield);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const selfNodeId = useMemo(
    () => (selfLxmfHash ? reticulumHashToNodeId(selfLxmfHash) : null),
    [selfLxmfHash],
  );

  const nodes = useMemo(() => {
    if (!nodeStoreSlice) return new Map<number, MeshNode>();
    return nodeRecordsToMeshNodeMap(Object.values(nodeStoreSlice));
  }, [nodeStoreSlice]);

  const syncConnectionStore = useCallback(
    (patch: Partial<DeviceState>) => {
      if (!identityId) return;
      setConnection(identityId, {
        status: patch.status,
        myNodeNum: patch.myNodeNum ?? selfNodeId ?? 0,
        connectionType: patch.connectionType,
      });
    },
    [identityId, selfNodeId],
  );

  const applyContactNodesFromStore = useCallback(() => {
    if (!identityId) return;
    const dismissed = useReticulumPeerStore.getState().dismissedContactHashes;
    const contacts = useReticulumPeerStore.getState().contacts;
    const priorNodes = useNodeStore.getState().nodes[identityId] ?? {};
    const records = [];
    const keepNodeIds = new Set<number>();
    if (selfNodeId != null) keepNodeIds.add(selfNodeId);

    for (const contact of contacts.values()) {
      const hash = contact.destination_hash.replace(/[^0-9a-f]/gi, '').toLowerCase();
      if (dismissed.has(hash)) continue;
      const nodeId = reticulumHashToNodeId(contact.destination_hash);
      records.push(reticulumContactToNodeRecordPreservingLabel(contact, priorNodes[nodeId]));
      keepNodeIds.add(nodeId);
    }

    // Drop path-table peers previously synced into nodeStore; keep self + LXMF contacts only.
    useNodeStore.setState((s) => {
      const prior = s.nodes[identityId] ?? {};
      const next = Object.fromEntries(
        Object.entries(prior).filter(([key, rec]) => {
          const nodeId = Number(key);
          return !rec.reticulumDestinationHash || keepNodeIds.has(nodeId);
        }),
      );
      return { nodes: { ...s.nodes, [identityId]: next } };
    });
    upsertNodeRecordsForIdentity(identityId, records);
  }, [identityId, selfNodeId]);

  const refreshContactsFromSidecar = useCallback(
    async (opts?: { forceRefresh?: boolean }) => {
      await refreshReticulumPeersFromSidecar(opts);
      applyContactNodesFromStore();
    },
    [applyContactNodesFromStore],
  );

  const refreshContactsFromSidecarForced = useCallback(async () => {
    await refreshContactsFromSidecar({ forceRefresh: true });
  }, [refreshContactsFromSidecar]);

  const refreshContactsFromSidecarSoft = useCallback(async () => {
    await refreshContactsFromSidecar();
  }, [refreshContactsFromSidecar]);

  const syncSelfNodeFromIdentityStatus = useCallback(
    (lxmfHash: string, displayName: string | null) => {
      if (!identityId) return;
      const record = reticulumSelfIdentityToNodeRecord(lxmfHash, displayName);
      const existing = useNodeStore.getState().nodes[identityId]?.[record.nodeId];
      if (existing) {
        upsertNodeRecord(identityId, {
          ...existing,
          reticulumDestinationHash: record.reticulumDestinationHash,
          longName: record.longName,
          shortName: record.shortName,
        });
        return;
      }
      upsertNodeRecord(identityId, record);
    },
    [identityId],
  );

  const applyIdentityStatusToStores = useCallback(
    (status: {
      configured: boolean;
      lxmfHash: string | null;
      displayName: string | null;
      identityHash?: string | null;
    }) => {
      if (!status.lxmfHash) return null;
      const existing = useReticulumIdentityStore.getState().identity;
      const nextIdentity: ReticulumIdentityStatus = {
        configured: status.configured,
        identity_hash: status.identityHash?.trim() || existing?.identity_hash || '',
        lxmf_hash: status.lxmfHash,
        display_name: status.displayName,
      };
      useReticulumIdentityStore.getState().setIdentity(nextIdentity);
      setSelfLxmfHash(status.lxmfHash);
      syncSelfNodeFromIdentityStatus(status.lxmfHash, status.displayName);
      return status.lxmfHash;
    },
    [syncSelfNodeFromIdentityStatus],
  );

  const refreshIdentityFromSidecar = useCallback(async (): Promise<string | null> => {
    const status = await fetchReticulumIdentityStatus();
    return applyIdentityStatusToStores(status);
  }, [applyIdentityStatusToStores]);

  /**
   * Refresh local identity display name into Zustand stores only.
   * Avoid React setState here — this is polled from an effect.
   */
  const refreshSelfNodeDisplayNameFromSidecar = useCallback(async () => {
    if (!identityId || !selfLxmfHash) return;
    const status = await fetchReticulumIdentityStatus();
    if (!status.lxmfHash) return;
    const existing = useReticulumIdentityStore.getState().identity;
    useReticulumIdentityStore.getState().setIdentity({
      configured: status.configured,
      identity_hash: status.identityHash?.trim() || existing?.identity_hash || '',
      lxmf_hash: status.lxmfHash,
      display_name: status.displayName,
    });
    syncSelfNodeFromIdentityStatus(status.lxmfHash, status.displayName);
  }, [identityId, selfLxmfHash, syncSelfNodeFromIdentityStatus]);

  const refreshLocalInterfacesFromSidecar = useCallback(async () => {
    invalidateReticulumInterfacesCache();
    const [interfaces, osSerialPorts] = await Promise.all([
      fetchReticulumInterfaces(),
      fetchReticulumSerialPorts(),
    ]);
    localInterfacesRef.current = interfaces;
    logReticulumLocalInterfaceHealthChanges(interfaces, osSerialPorts);
    return { interfaces, osSerialPorts };
  }, []);

  const syncDiagnosticsFromSidecar = useCallback(async () => {
    try {
      const [snapshot, health, auditIssues, sidecarStatus, stackRaw] = await Promise.all([
        window.electronAPI.reticulum.proxyGet('/api/v1/diagnostics') as Promise<
          Parameters<typeof buildReticulumDiagnosticRows>[0]
        >,
        refreshLocalInterfacesFromSidecar(),
        fetchReticulumConfigAudit().catch((e: unknown) => {
          console.debug('[useReticulumRuntime] config audit failed ' + String(e));
          return [];
        }),
        window.electronAPI.reticulum.getStatus(),
        window.electronAPI.reticulum.proxyGet('/api/v1/stack/settings').catch(() => null),
      ]);
      const { interfaces, osSerialPorts } = health;
      const selfNodeId = selfLxmfHash ? reticulumHashToNodeId(selfLxmfHash) : 0;
      const shareInstanceEnabled =
        stackRaw != null ? parseReticulumStackSettingsPayload(stackRaw).share_instance : false;
      const rows = buildReticulumDiagnosticRows(snapshot, {
        selfNodeId,
        interfaces,
        osSerialPorts,
        auditIssues,
        autoBeaconAlert: sidecarStatus.autoBeaconAlert ?? null,
        interfaceIssueAlert: sidecarStatus.interfaceIssueAlert ?? null,
        shareInstanceEnabled,
      });
      useDiagnosticsStore.setState((s) => ({
        diagnosticRows: mergeReticulumDiagnosticRows(s.diagnosticRows, rows),
      }));
    } catch (e) {
      console.debug('[useReticulumRuntime] diagnostics ' + errLikeToLogString(e));
    }
  }, [refreshLocalInterfacesFromSidecar, selfLxmfHash]);

  const scheduleLocalInterfaceStatusBurst = useCallback(() => {
    localInterfaceBurstCancelRef.current?.();
    localInterfaceBurstCancelRef.current = scheduleReticulumLocalInterfaceBurst(() => {
      void refreshLocalInterfacesFromSidecar();
    });
  }, [refreshLocalInterfacesFromSidecar]);

  const scheduleFullPeerRefresh = useCallback(() => {
    const peerCount = useReticulumPeerStore.getState().peers.size;
    const onRefresh = () => {
      void refreshContactsFromSidecar();
      void syncDiagnosticsFromSidecar();
    };
    if (peerCount > LARGE_MESH_NODE_THRESHOLD) {
      scheduleTrailingOnlyRefresh({
        timerRef: peerRefreshDebounceRef,
        onRefresh,
        coalesceMs: RETICULUM_PEER_REFRESH_STORM_COALESCE_MS,
      });
      return;
    }
    scheduleLeadingTrailingRefresh({
      timerRef: peerRefreshDebounceRef,
      onRefresh,
    });
  }, [refreshContactsFromSidecar, syncDiagnosticsFromSidecar]);

  const scheduleDebouncedDiagnosticsRefresh = useCallback(() => {
    if (diagnosticsRefreshDebounceRef.current) {
      clearTimeout(diagnosticsRefreshDebounceRef.current);
    }
    diagnosticsRefreshDebounceRef.current = setTimeout(() => {
      diagnosticsRefreshDebounceRef.current = null;
      void syncDiagnosticsFromSidecar();
    }, 2_000);
  }, [syncDiagnosticsFromSidecar]);

  const appendRawPacket = useCallback((entry: ReticulumRawPacketEntry) => {
    rawPacketAppenderRef.current?.append(entry);
    useReticulumPacketStore.getState().appendPacket(entry);
  }, []);

  const hydrateRawPackets = useCallback(async () => {
    try {
      await useReticulumPacketStore.getState().hydrateFromSidecar();
      const fromStore = useReticulumPacketStore.getState().packets;
      setRawPackets(fromStore.slice(-MAX_RAW_PACKET_LOG_ENTRIES));
    } catch (e) {
      console.debug('[useReticulumRuntime] hydrate raw packets ' + errLikeToLogString(e));
    }
  }, []);

  const clearRawPackets = useCallback(async () => {
    rawPacketAppenderRef.current?.clearPending();
    setRawPackets([]);
    await useReticulumPacketStore.getState().clearSidecarBuffer();
  }, []);

  const ingestLxmfPayload = useCallback(
    (p: ReticulumLxmfPayload) => {
      if (!identityId) return;
      void (async () => {
        let attachmentPath: string | null = null;
        if (p.attachment?.data_base64 && p.direction !== 'outbound') {
          attachmentPath = await cacheReticulumInboundAttachment(p.attachment);
        }
        ingestReticulumLxmfPayloadWithSideEffects(identityId, p, {
          selfLxmfHash: selfLxmfHash ?? undefined,
          attachmentPath,
        });
      })();
    },
    [identityId, selfLxmfHash],
  );

  const refreshMessagesFromDb = useCallback(async () => {
    if (!identityId) return;
    try {
      const rows = (await window.electronAPI.db.getReticulumMessages(identityId, 500)) as {
        sender_id: string;
        sender_name?: string;
        payload: string;
        timestamp: number;
        to_hash?: string | null;
        reply_to_hash?: string | null;
        message_hash?: string | null;
        received_via?: string | null;
        delivery_status?: string | null;
        attachment_path?: string | null;
      }[];
      replaceMessageRecordsForIdentity(
        identityId,
        rows.map((row) => reticulumDbRowToMessageRecord(row)),
      );
    } catch (e) {
      console.warn('[useReticulumRuntime] refresh messages ' + errLikeToLogString(e));
    }
  }, [identityId]);

  const recordAnnounceActivity = useCallback((payload: unknown, defaultAspect?: string) => {
    const rows = parseAnnounceActivityRows(payload);
    if (rows.length === 0 && defaultAspect && payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>;
      const destinationHash =
        typeof p.destination_hash === 'string' ? p.destination_hash : undefined;
      if (destinationHash) {
        rows.push({
          destination_hash: destinationHash,
          aspect: defaultAspect,
          identity_hash: typeof p.identity_hash === 'string' ? p.identity_hash : null,
          last_seen: Date.now(),
          hops: typeof p.hops === 'number' && Number.isFinite(p.hops) ? Math.trunc(p.hops) : null,
        });
      }
    }
    for (const row of rows) {
      void useReticulumIdentityActivityStore.getState().upsertActivity(row);
    }
  }, []);

  const handleSidecarEvent = useCallback(
    (evt: ReticulumSidecarEvent) => {
      if (evt.type === 'wire_packet' && evt.payload && typeof evt.payload === 'object') {
        appendRawPacket(reticulumWireRowToEntry(evt.payload as ReticulumWirePacketRow));
      }
      if (evt.type === 'lxmf_message' && evt.payload && typeof evt.payload === 'object') {
        ingestLxmfPayload(evt.payload);
      }
      if (evt.type === 'resource.received' && evt.payload && typeof evt.payload === 'object') {
        ingestLxmfPayload(evt.payload);
      }
      if (evt.type === 'lxmf_outbound_status' && evt.payload && typeof evt.payload === 'object') {
        const p = evt.payload as {
          message_hash?: string;
          status?: string;
          sent_via?: string;
        };
        if (identityId && p.message_hash && p.status) {
          applyReticulumOutboundDeliveryStatus(identityId, p.message_hash, p.status, {
            sentVia: p.sent_via,
          });
        }
      }
      if (
        (evt.type === 'propagation_sync' || evt.type === 'propagation.sync_progress') &&
        evt.payload &&
        typeof evt.payload === 'object'
      ) {
        const p = evt.payload as { progress?: number; active?: boolean; message?: string | null };
        applyPropagationSyncEvent(p);
      }
      if (evt.type === 'rmap.discovery' && evt.payload && typeof evt.payload === 'object') {
        const p = evt.payload as { discovered?: unknown };
        if (Array.isArray(p.discovered)) {
          useReticulumDiscoveryMapStore.getState().setDiscovered(p.discovered);
        }
      }
      if (evt.type === 'nomadnetwork.node') {
        void useNomadNetworkStore.getState().refreshFromSidecar();
        recordAnnounceActivity(evt.payload, 'nomadnetwork.node');
      }
      if (evt.type === 'rrc.hub' && evt.payload && typeof evt.payload === 'object') {
        const p = evt.payload as {
          destination_hash?: string;
          identity_hash?: string | null;
          display_name?: string | null;
          hops?: number | null;
          source?: string;
        };
        if (typeof p.destination_hash === 'string') {
          useRrcHubStore.getState().upsertFromEvent({
            destination_hash: p.destination_hash,
            identity_hash: p.identity_hash,
            display_name: p.display_name,
            hops: p.hops,
            source: (p.source as 'discovered' | undefined) ?? 'discovered',
          });
        }
      }
      if (evt.type === 'rrc.connected' && evt.payload && typeof evt.payload === 'object') {
        const p = evt.payload as {
          hub_dest_hash?: string;
          hub_name?: string | null;
          status?: string;
        };
        const st =
          p.status === 'connecting'
            ? 'connecting'
            : p.status === 'active'
              ? 'active'
              : 'awaiting_welcome';
        useRrcSessionStore.getState().applyStatus(st, p.hub_dest_hash ?? null, p.hub_name ?? null);
      }
      if (evt.type === 'rrc.disconnected' && evt.payload && typeof evt.payload === 'object') {
        const p = evt.payload as { reason?: string };
        const session = useRrcSessionStore.getState();
        if (p.reason === 'local_disconnect') {
          session.clearSession();
        } else {
          // Sidecar auto-reconnects unintended drops; keep volatile rooms until reconnect settles.
          session.applyStatus('reconnecting');
          if (p.reason) session.setError(p.reason);
        }
      }
      if (evt.type === 'rrc.room.joined' && evt.payload && typeof evt.payload === 'object') {
        const p = evt.payload as {
          room?: string;
          members?: { identity_hash: string; nickname?: string | null }[];
        };
        if (typeof p.room === 'string') {
          useRrcSessionStore.getState().roomJoined(p.room, p.members);
        }
      }
      if (evt.type === 'rrc.room.parted' && evt.payload && typeof evt.payload === 'object') {
        const p = evt.payload as { room?: string };
        if (typeof p.room === 'string') {
          useRrcSessionStore.getState().roomParted(p.room);
        }
      }
      if (evt.type === 'rrc.message' && evt.payload && typeof evt.payload === 'object') {
        const p = evt.payload as {
          id?: string;
          room?: string;
          kind?: string;
          body?: string;
          sender_hash?: string | null;
          nickname?: string | null;
          timestamp?: number;
        };
        if (typeof p.room === 'string' && typeof p.body === 'string') {
          const kind =
            p.kind === 'notice' || p.kind === 'action' || p.kind === 'error' || p.kind === 'system'
              ? p.kind
              : 'msg';
          useRrcSessionStore.getState().addMessage(
            {
              id: typeof p.id === 'string' ? p.id : `rrc-${Date.now()}`,
              room: p.room,
              kind,
              body: p.body,
              sender_hash: p.sender_hash,
              nickname: p.nickname,
              timestamp: typeof p.timestamp === 'number' ? p.timestamp : Date.now(),
            },
            { bumpUnread: true },
          );
        }
      }
      if (evt.type === 'rrc.error' && evt.payload && typeof evt.payload === 'object') {
        const p = evt.payload as { message?: string };
        if (typeof p.message === 'string') {
          useRrcSessionStore.getState().setError(p.message);
        }
      }
      const refreshActions = reticulumSidecarEventRefreshActions(evt.type);
      if (refreshActions.interfaces) {
        logReticulumInterfaceStateEvent(evt.payload);
        invalidateReticulumInterfacesCache();
        void refreshLocalInterfacesFromSidecar();
      }
      if (evt.type === 'stack_restart_requested') {
        void restartStackRef.current?.().catch((e: unknown) => {
          console.error(
            '[useReticulumRuntime] stack_restart_requested failed ' + errLikeToLogString(e),
          );
        });
      }
      if (evt.type === 'announce.received') {
        applyReticulumAnnounceReceivedOptimistic(evt.payload);
        recordAnnounceActivity(evt.payload);
        requestChatOutboxDrain('reticulum');
      }
      if (evt.type === 'peers_updated' && refreshActions.peerPatches) {
        if (peersUpdatedRequiresFullRefresh(evt.payload)) {
          scheduleFullPeerRefresh();
        } else {
          applyReticulumPeersUpdatedPatches(evt.payload);
        }
      }
      if (refreshActions.peers) {
        scheduleFullPeerRefresh();
      } else if (refreshActions.diagnostics) {
        scheduleDebouncedDiagnosticsRefresh();
      }
    },
    [
      appendRawPacket,
      identityId,
      ingestLxmfPayload,
      recordAnnounceActivity,
      refreshLocalInterfacesFromSidecar,
      scheduleDebouncedDiagnosticsRefresh,
      scheduleFullPeerRefresh,
    ],
  );

  const tearDownFromSidecarStop = useCallback(() => {
    unsubEventRef.current?.();
    unsubEventRef.current = null;
    localInterfacesRef.current = [];
    setSelfLxmfHash(null);
    rawPacketAppenderRef.current?.clearPending();
    setRawPackets([]);
    clearReticulumSessionStores();
    processedLinkTimeoutDestsRef.current.clear();
    setState(INITIAL_STATE);
    syncConnectionStore(INITIAL_STATE);
  }, [syncConnectionStore]);

  useEffect(() => {
    const unsubStatus = window.electronAPI.reticulum.onStatus((status) => {
      if (status.interfaceIssueAlert || status.autoBeaconAlert) {
        void syncDiagnosticsFromSidecar();
        const timeouts = status.interfaceIssueAlert?.linkDeliveryTimeouts;
        if (identityId && timeouts?.length) {
          for (const { destinationHash } of timeouts) {
            const norm = destinationHash.replace(/[^0-9a-f]/gi, '').toLowerCase();
            if (!norm || processedLinkTimeoutDestsRef.current.has(norm)) continue;
            processedLinkTimeoutDestsRef.current.add(norm);
            failReticulumSendingOutboundToDestHash(
              identityId,
              norm,
              i18n.t('chatPanel.reticulumSendFailed'),
            );
          }
        }
      }
      if (status.running) return;
      if (connectInFlightRef.current) return;
      const wasActive =
        stateRef.current.status === 'configured' ||
        stateRef.current.status === 'connected' ||
        stateRef.current.status === 'stale';
      if (wasActive) {
        tearDownFromSidecarStop();
        // Consume the suppress flag only when there was an active session to react to —
        // a stray "not running" status while the stack is already off must not clear a
        // suppression set by an earlier manual disconnect (would let a later unrelated
        // stop autostart the stack again).
        if (suppressReconnectRef.current) {
          suppressReconnectRef.current = false;
        } else if (isReticulumAutostartEnabled()) {
          void connectRef.current?.().catch((e: unknown) => {
            console.warn(
              '[useReticulumRuntime] autostart reconnect failed ' + errLikeToLogString(e),
            );
          });
        }
      }
    });
    return () => {
      unsubStatus();
    };
  }, [tearDownFromSidecarStop, syncDiagnosticsFromSidecar, identityId]);

  useEffect(() => {
    return () => {
      if (peerRefreshDebounceRef.current) {
        clearTimeout(peerRefreshDebounceRef.current);
        peerRefreshDebounceRef.current = null;
      }
      if (diagnosticsRefreshDebounceRef.current) {
        clearTimeout(diagnosticsRefreshDebounceRef.current);
        diagnosticsRefreshDebounceRef.current = null;
      }
      unsubEventRef.current?.();
      unsubEventRef.current = null;
      // Dev HMR remounts App without an explicit disconnect — keep the sidecar alive.
      if (!import.meta.env.DEV) {
        void window.electronAPI.reticulum.stop();
      }
    };
  }, []);

  const connect = useCallback(async () => {
    if (connectInFlightRef.current) {
      const pending = connectInFlightDoneRef.current;
      if (pending) {
        await pending.catch(() => {});
        return;
      }
      throw new Error('Reticulum connect already in progress');
    }
    connectInFlightRef.current = true;
    const generation = resumeGenerationRef.current;
    const flight = (async () => {
      setState((s) => ({ ...s, status: 'connecting', connectionType: null }));
      syncConnectionStore({ status: 'connecting', connectionType: null });
      await window.electronAPI.reticulum.start({ reuseIfRunning: true });
      unsubEventRef.current?.();
      unsubEventRef.current = window.electronAPI.reticulum.onEvent(handleSidecarEvent);
      const lxmfHash = await refreshIdentityFromSidecar();
      const connectedNodeId = lxmfHash ? reticulumHashToNodeId(lxmfHash) : 0;
      await refreshContactsFromSidecar();
      await refreshLocalInterfacesFromSidecar();
      await syncDiagnosticsFromSidecar();
      await hydrateRawPackets();
      if (identityId) {
        await markStaleReticulumOutboundMessages(identityId, RETICULUM_STALE_OUTBOUND_MS);
        markStaleReticulumOutboundInStore(identityId, RETICULUM_STALE_OUTBOUND_MS);
        await refreshMessagesFromDb();
      }
      if (resumeGenerationRef.current !== generation) {
        // A later power-suspend fired while this connect attempt was still in flight — the
        // sidecar keeps running (no RF link to go stale), but a fresher resume/suspend cycle
        // now owns the UI state; applying this stale "configured" result could clobber it.
        console.debug(
          '[useReticulumRuntime] connect superseded by newer power-suspend generation — skip applying stale configured state',
        );
        return;
      }
      setState({ status: 'configured', myNodeNum: connectedNodeId, connectionType: null });
      syncConnectionStore({
        status: 'configured',
        connectionType: null,
        myNodeNum: connectedNodeId,
      });
      scheduleLocalInterfaceStatusBurst();
    })();
    connectInFlightDoneRef.current = flight;
    try {
      await flight;
    } catch (e) {
      console.error('[useReticulumRuntime] connect failed ' + errLikeToLogString(e));
      setState(INITIAL_STATE);
      syncConnectionStore(INITIAL_STATE);
      throw e instanceof Error ? e : new Error(String(e));
    } finally {
      connectInFlightRef.current = false;
      connectInFlightDoneRef.current = null;
    }
  }, [
    handleSidecarEvent,
    refreshContactsFromSidecar,
    refreshIdentityFromSidecar,
    refreshLocalInterfacesFromSidecar,
    refreshMessagesFromDb,
    syncDiagnosticsFromSidecar,
    hydrateRawPackets,
    identityId,
    syncConnectionStore,
    scheduleLocalInterfaceStatusBurst,
  ]);

  const disconnect = useCallback(async () => {
    suppressReconnectRef.current = true;
    if (peerRefreshDebounceRef.current) {
      clearTimeout(peerRefreshDebounceRef.current);
      peerRefreshDebounceRef.current = null;
    }
    if (diagnosticsRefreshDebounceRef.current) {
      clearTimeout(diagnosticsRefreshDebounceRef.current);
      diagnosticsRefreshDebounceRef.current = null;
    }
    unsubEventRef.current?.();
    unsubEventRef.current = null;
    await window.electronAPI.reticulum.stop();
    localInterfacesRef.current = [];
    setSelfLxmfHash(null);
    rawPacketAppenderRef.current?.clearPending();
    setRawPackets([]);
    clearReticulumSessionStores();
    processedLinkTimeoutDestsRef.current.clear();
    setState(INITIAL_STATE);
    syncConnectionStore(INITIAL_STATE);
  }, [syncConnectionStore]);

  const restartStack = useCallback(async () => {
    if (connectInFlightRef.current) {
      const pending = connectInFlightDoneRef.current;
      if (pending) {
        await pending.catch(() => {});
      }
      if (connectInFlightRef.current) {
        throw new Error('Reticulum stack operation already in progress');
      }
    }
    connectInFlightRef.current = true;
    console.warn('[useReticulumRuntime] restarting stack to reload interface config');
    const priorSuppress = suppressReconnectRef.current;
    suppressReconnectRef.current = true;
    const flight = (async () => {
      setState((s) => ({ ...s, status: 'connecting', connectionType: null }));
      syncConnectionStore({ status: 'connecting', connectionType: null });
      unsubEventRef.current?.();
      unsubEventRef.current = null;
      await window.electronAPI.reticulum.stop();
      await window.electronAPI.reticulum.start({ reuseIfRunning: false });
      unsubEventRef.current = window.electronAPI.reticulum.onEvent(handleSidecarEvent);
      const lxmfHash = await refreshIdentityFromSidecar();
      const connectedNodeId = lxmfHash ? reticulumHashToNodeId(lxmfHash) : 0;
      await refreshContactsFromSidecar();
      await refreshLocalInterfacesFromSidecar();
      await syncDiagnosticsFromSidecar();
      await hydrateRawPackets();
      if (identityId) {
        await markStaleReticulumOutboundMessages(identityId, RETICULUM_STALE_OUTBOUND_MS);
        markStaleReticulumOutboundInStore(identityId, RETICULUM_STALE_OUTBOUND_MS);
        await refreshMessagesFromDb();
      }
      setState({ status: 'configured', myNodeNum: connectedNodeId, connectionType: null });
      syncConnectionStore({
        status: 'configured',
        connectionType: null,
        myNodeNum: connectedNodeId,
      });
      scheduleLocalInterfaceStatusBurst();
    })();
    connectInFlightDoneRef.current = flight;
    try {
      await flight;
    } catch (e) {
      console.error('[useReticulumRuntime] stack restart failed ' + errLikeToLogString(e));
      tearDownFromSidecarStop();
      throw e instanceof Error ? e : new Error(String(e));
    } finally {
      suppressReconnectRef.current = priorSuppress;
      connectInFlightRef.current = false;
      connectInFlightDoneRef.current = null;
    }
  }, [
    handleSidecarEvent,
    refreshContactsFromSidecar,
    refreshIdentityFromSidecar,
    refreshLocalInterfacesFromSidecar,
    refreshMessagesFromDb,
    syncConnectionStore,
    syncDiagnosticsFromSidecar,
    hydrateRawPackets,
    identityId,
    tearDownFromSidecarStop,
    scheduleLocalInterfaceStatusBurst,
  ]);

  useEffect(() => {
    connectRef.current = connect;
    restartStackRef.current = restartStack;
  }, [connect, restartStack]);

  useEffect(() => {
    if (state.status !== 'configured' && state.status !== 'connected' && state.status !== 'stale') {
      return;
    }
    void refreshContactsFromSidecar();
    void refreshSelfNodeDisplayNameFromSidecar();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = () => {
      const ms =
        useReticulumPeerStore.getState().peers.size > LARGE_MESH_NODE_THRESHOLD
          ? RETICULUM_PEER_REFRESH_LARGE_MS
          : RETICULUM_PEER_REFRESH_MS;
      timeoutId = setTimeout(() => {
        void refreshContactsFromSidecar();
        void refreshSelfNodeDisplayNameFromSidecar();
        scheduleNext();
      }, ms);
    };
    scheduleNext();
    return () => {
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [state.status, refreshContactsFromSidecar, refreshSelfNodeDisplayNameFromSidecar]);

  /** Keep nodeStore longName in sync when Network panel updates identity display_name. */
  useEffect(() => {
    return useReticulumIdentityStore.subscribe((identityState, prev) => {
      const next = identityState.identity;
      const prevIdentity = prev.identity;
      if (
        next?.display_name === prevIdentity?.display_name &&
        next?.lxmf_hash === prevIdentity?.lxmf_hash
      ) {
        return;
      }
      if (!next?.lxmf_hash) return;
      setSelfLxmfHash(next.lxmf_hash);
      syncSelfNodeFromIdentityStatus(next.lxmf_hash, next.display_name?.trim() || null);
    });
  }, [syncSelfNodeFromIdentityStatus]);

  useEffect(() => {
    if (state.status !== 'configured' && state.status !== 'connected' && state.status !== 'stale') {
      if (localInterfacePollTimeoutRef.current !== null) {
        clearTimeout(localInterfacePollTimeoutRef.current);
      }
      localInterfacePollTimeoutRef.current = null;
      localInterfaceBurstCancelRef.current?.();
      localInterfaceBurstCancelRef.current = null;
      return;
    }

    let cancelled = false;

    const scheduleNextPoll = (delayMs: number) => {
      if (cancelled) return;
      localInterfacePollTimeoutRef.current = setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async () => {
      const health = await refreshLocalInterfacesFromSidecar();
      if (cancelled) return;
      void syncDiagnosticsFromSidecar();
      scheduleNextPoll(pickReticulumLocalHealthPollMs(health.interfaces, health.osSerialPorts));
    };

    void tick();

    return () => {
      cancelled = true;
      if (localInterfacePollTimeoutRef.current) {
        clearTimeout(localInterfacePollTimeoutRef.current);
        localInterfacePollTimeoutRef.current = null;
      }
      localInterfaceBurstCancelRef.current?.();
      localInterfaceBurstCancelRef.current = null;
    };
  }, [state.status, refreshLocalInterfacesFromSidecar, syncDiagnosticsFromSidecar]);

  const connectAutomatic = useCallback(async () => {
    await connect();
  }, [connect]);

  const resolveOutboundVia = useCallback((destinationHash: string) => {
    const peer = useReticulumPeerStore.getState().getPeer(destinationHash);
    const pathIface = peer?.interface?.trim() || null;
    return reticulumViaToMessageTransport(
      resolveReticulumOutboundViaFromPath(
        pathIface,
        localInterfacesRef.current,
        getCachedReticulumEffectivePrimaryLocalSerialInterfaceId(),
      ),
    );
  }, []);

  const sendMessage = useCallback(
    async (
      text: string,
      to: number | string,
      replyToHash?: string,
      pendingId?: string,
      replyPreviewText?: string,
    ) => {
      if (!identityId) return;
      const destination =
        typeof to === 'string'
          ? to
          : (reticulumHashForNodeId(to) ?? resolveReticulumDestinationHash(to) ?? String(to));
      const body: Record<string, unknown> = {
        destination_hash: destination,
        text,
      };
      if (replyToHash) {
        body.reply_to_hash = replyToHash;
        body.reply_to_id = replyToHash;
      }
      const quote = replyPreviewText?.trim();
      if (quote) {
        body.reply_preview_text = quote;
      }
      try {
        const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/lxmf/send', body)) as {
          ok?: boolean;
          error?: string;
          message?: ReticulumLxmfPayload;
          sent_via?: string;
          delivery_method?: string;
          delivery_status?: string;
        };
        if (res?.ok === false) {
          if (res.error === 'no_propagation_node') {
            throw new Error('no_propagation_node');
          }
          throw new Error(res.error ?? 'LXMF send rejected by sidecar');
        }
        const lxmfPayload = extractLxmfPayloadFromSendResponse(res);
        if (lxmfPayload) {
          const hash = lxmfPayload.message_hash;
          const outboundStatus = 'sending' as const;
          if (pendingId && hash) {
            renameMessageId(identityId, pendingId, hash);
            ingestLxmfPayload(lxmfPayload);
            // Terminal WS may have arrived before rename; apply buffered Completes/Fails.
            flushPendingReticulumOutboundDeliveryStatus(identityId, hash);
            const afterFlush = useMessageStore.getState().messages[identityId]?.[hash]?.status;
            if (afterFlush !== 'acked' && afterFlush !== 'failed') {
              updateMessageStatus(identityId, hash, outboundStatus);
            }
          } else {
            ingestLxmfPayload(lxmfPayload);
            if (hash) {
              flushPendingReticulumOutboundDeliveryStatus(identityId, hash);
            }
            if (pendingId) {
              const afterFlush = hash
                ? useMessageStore.getState().messages[identityId]?.[hash]?.status
                : undefined;
              if (afterFlush !== 'acked' && afterFlush !== 'failed') {
                updateMessageStatus(identityId, pendingId, outboundStatus);
              }
            }
          }
        } else if (pendingId) {
          updateMessageStatus(identityId, pendingId, 'failed', 'LXMF send returned no payload');
        }
      } catch (e) {
        if (pendingId) {
          const errStr = errLikeToLogString(e);
          const userMessage = errStr.includes('no_propagation_node')
            ? i18n.t('chatPanel.reticulumNoPropagationNode')
            : i18n.t('chatPanel.reticulumSendFailed');
          updateMessageStatus(identityId, pendingId, 'failed', userMessage);
        }
        throw e;
      }
    },
    [identityId, ingestLxmfPayload],
  );

  const sendAttachment = useCallback(
    async (file: File, to: number | string) => {
      if (!identityId) {
        throw new Error(i18n.t('chatPanel.reticulumSendAttachmentNoIdentity'));
      }
      const destination =
        typeof to === 'string'
          ? to
          : (reticulumHashForNodeId(to) ?? resolveReticulumDestinationHash(to) ?? String(to));
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/lxmf/resource', {
          destination_hash: destination,
          file_name: file.name,
          mime_type: file.type || 'application/octet-stream',
          data_base64: uint8ArrayToBase64(bytes),
        })) as { ok?: boolean; error?: string; message?: ReticulumLxmfPayload };
        if (res?.ok === false) {
          throw new Error(res.error ?? i18n.t('chatPanel.reticulumSendAttachmentFailed'));
        }
        if (res?.message) {
          const payload = extractLxmfPayloadFromSendResponse(res) ?? res.message;
          if (payload) ingestLxmfPayload(payload);
        }
      } catch (e) {
        console.warn('[useReticulumRuntime] send attachment failed ' + errLikeToLogString(e));
        throw e instanceof Error && e.message
          ? e
          : new Error(i18n.t('chatPanel.reticulumSendAttachmentFailed'));
      }
    },
    [identityId, ingestLxmfPayload],
  );

  const sendReaction = useCallback(
    async (glyph: string, replyId: number, channel: number) => {
      void channel;
      if (!identityId) return;
      const storeMessages = Object.values(useMessageStore.getState().messages[identityId] ?? {});
      const targetMsg = storeMessages.find(
        (m) => m.timestamp === replyId || m.reticulumMessageHash === String(replyId),
      );
      if (!targetMsg?.reticulumMessageHash) return;
      const peerHash =
        targetMsg.from === selfNodeId
          ? resolveReticulumDestinationHash(targetMsg.to)
          : targetMsg.reticulumSenderHash;
      if (!peerHash) return;
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/lxmf/reaction', {
        destination_hash: peerHash,
        target_hash: targetMsg.reticulumMessageHash,
        emoji: glyph,
      })) as { ok?: boolean; message?: ReticulumLxmfPayload };
      if (res?.message) {
        const payload = extractLxmfPayloadFromSendResponse(res) ?? res.message;
        if (payload) ingestLxmfPayload(payload);
      }
    },
    [identityId, ingestLxmfPayload, selfNodeId],
  );

  const getFullNodeLabel = useCallback(
    (nodeId: number) => {
      if (!identityId) return String(nodeId);
      const normalizedId = nodeId >>> 0;
      const isSelf = selfNodeId != null && normalizedId === selfNodeId;
      if (isSelf) {
        const identity = useReticulumIdentityStore.getState().identity;
        const stored = useNodeStore.getState().nodes[identityId]?.[normalizedId]?.longName;
        return resolveReticulumSelfFullLabel(
          {
            identityDisplayName: identity?.display_name,
            lxmfHash: selfLxmfHash ?? identity?.lxmf_hash ?? null,
            storedLongName: stored,
          },
          normalizedId,
        );
      }
      const stored = useNodeStore.getState().nodes[identityId]?.[normalizedId]?.longName;
      if (stored) return stored;
      const hash = resolveReticulumDestinationHash(normalizedId);
      return (
        hash?.replace(/[^0-9a-f]/gi, '').slice(0, 12) ?? normalizedId.toString(16).toUpperCase()
      );
    },
    [identityId, selfNodeId, selfLxmfHash],
  );

  const getPickerStyleNodeLabel = useCallback(
    (nodeId: number) => {
      if (!identityId) return String(nodeId);
      const normalizedId = nodeId >>> 0;
      const isSelf = selfNodeId != null && normalizedId === selfNodeId;
      if (isSelf) {
        const identity = useReticulumIdentityStore.getState().identity;
        const stored = useNodeStore.getState().nodes[identityId]?.[normalizedId]?.longName;
        return resolveReticulumSelfHeaderLabel({
          identityDisplayName: identity?.display_name,
          lxmfHash: selfLxmfHash ?? identity?.lxmf_hash ?? null,
          storedLongName: stored,
        });
      }
      return getFullNodeLabel(normalizedId);
    },
    [identityId, selfNodeId, selfLxmfHash, getFullNodeLabel],
  );

  const getNodes = useCallback(() => [...nodes.values()], [nodes]);

  const refreshNodesFromDb = useCallback(async () => {
    await refreshContactsFromSidecar();
  }, [refreshContactsFromSidecar]);

  const setNodeFavorited = useCallback(
    async (nodeId: number, favorited: boolean) => {
      if (!identityId) return;
      const hash = resolveReticulumDestinationHash(nodeId);
      if (!hash) return;
      const existing = useNodeStore.getState().nodes[identityId]?.[nodeId];
      if (existing) {
        upsertNodeRecord(identityId, { ...existing, favorited });
      }
      await useReticulumPeerStore.getState().toggleFavorite(hash, favorited);
    },
    [identityId],
  );

  const onPowerSuspend = useCallback(() => {
    resumeGenerationRef.current += 1;
  }, []);

  const onPowerResume = useCallback(() => {
    if (suppressReconnectRef.current) {
      console.debug('[useReticulumRuntime] power resume — skip reconnect (user disconnect)');
      return;
    }
    void connect();
  }, [connect]);

  const runtime = useMemo(
    () => ({
      state,
      identityId: identityId,
      selfNodeId,
      mqttStatus: null,
      mqttConnectionLoss: null,
      messages: [],
      nodes,
      deviceOwner: null,
      deviceLogs: [],
      rawPackets,
      clearRawPackets,
      queueStatus: null,
      ourPosition: null,
      gpsLoading: false,
      telemetry: null,
      signalTelemetry: null,
      environmentTelemetry: null,
      traceRouteResults: new Map(),
      neighborInfo: new Map(),
      channels: [],
      channelConfigs: [],
      moduleConfigs: {},
      waypoints: [],
      telemetryEnabled: null,
      telemetryDeviceUpdateInterval: undefined,
      connect,
      connectAutomatic,
      disconnect,
      restartStack,
      onPowerSuspend,
      onPowerResume,
      prepareRfConnect: async () => {},
      attachRfSession: async () => {},
      handleRfConnectFailure: async () => {},
      finalizeDriverDisconnect: async () => {
        await disconnect();
      },
      sendMessage,
      sendReaction,
      sendAttachment,
      resolveOutboundVia,
      setNodeFavorited,
      refreshNodesFromDb,
      refreshMessagesFromDb,
      requestRefresh: refreshContactsFromSidecarForced,
      requestSoftRefresh: refreshContactsFromSidecarSoft,
      syncDiagnostics: syncDiagnosticsFromSidecar,
      getNodes,
      getFullNodeLabel,
      getPickerStyleNodeLabel,
    }),
    [
      state,
      identityId,
      selfNodeId,
      nodes,
      connect,
      connectAutomatic,
      disconnect,
      restartStack,
      onPowerSuspend,
      onPowerResume,
      clearRawPackets,
      rawPackets,
      sendMessage,
      sendReaction,
      sendAttachment,
      resolveOutboundVia,
      setNodeFavorited,
      refreshNodesFromDb,
      refreshMessagesFromDb,
      refreshContactsFromSidecarForced,
      refreshContactsFromSidecarSoft,
      syncDiagnosticsFromSidecar,
      getNodes,
      getFullNodeLabel,
      getPickerStyleNodeLabel,
    ],
  );

  useEffect(() => {
    if (!identityId) return;
    void useBlockStore.getState().load('reticulum', identityId);
  }, [identityId]);

  useEffect(() => {
    registerReticulumSession({
      connect,
      connectAutomatic,
      disconnect,
      restartStack,
      finalizeDriverDisconnect: disconnect,
      selfNodeId,
      getFullNodeLabel,
      sendMessage,
      sendAttachment,
      sendReaction,
      handleSidecarEvent,
      resolveOutboundVia,
    });
    return () => {
      registerReticulumSession(null);
    };
  }, [
    connect,
    connectAutomatic,
    disconnect,
    restartStack,
    selfNodeId,
    getFullNodeLabel,
    sendMessage,
    sendAttachment,
    sendReaction,
    handleSidecarEvent,
    resolveOutboundVia,
  ]);

  return runtime;
}
