import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isReticulumAutostartEnabled } from '@/renderer/lib/appSettingsStorage';
import {
  buildReticulumDiagnosticRows,
  mergeReticulumDiagnosticRows,
} from '@/renderer/lib/diagnostics/ReticulumDiagnosticEngine';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  ingestReticulumLxmfPayloadWithSideEffects,
  type ReticulumLxmfPayload,
} from '@/renderer/lib/ingest/reticulumIngest';
import { classifyReticulumVia } from '@/renderer/lib/reticulum/classifyReticulumVia';
import {
  resolveReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import {
  markStaleReticulumOutboundInStore,
  markStaleReticulumOutboundMessages,
} from '@/renderer/lib/reticulum/markStaleReticulumOutbound';
import { fetchReticulumIdentityStatus } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { registerReticulumSession } from '@/renderer/lib/sessions/reticulumSession';
import {
  nodeRecordsToMeshNodeMap,
  reticulumDbRowToMessageRecord,
} from '@/renderer/lib/storeRecordAdapters';
import type { ReticulumContact, ReticulumSidecarEvent } from '@/shared/reticulum-types';

import { getIdentityIdForProtocol } from '../lib/identityByProtocol';
import { getOfflineIdentityIdForProtocol } from '../lib/offlineProtocolIdentities';
import type { DeviceState, MeshNode } from '../lib/types';
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
import {
  refreshReticulumPeersFromSidecar,
  reticulumContactToNodeRecord,
  useReticulumPeerStore,
} from '../stores/reticulumPeerStore';
import { useReticulumPropagationStore } from '../stores/reticulumPropagationStore';
import type { ProtocolRuntime } from './protocolRuntime';

const INITIAL_STATE: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  connectionType: null,
};

export type ReticulumRuntime = ReturnType<typeof useReticulumRuntime>;

export function useReticulumRuntime(): ProtocolRuntime {
  const identityId =
    useIdentityStore(() => getIdentityIdForProtocol('reticulum')) ??
    getOfflineIdentityIdForProtocol('reticulum');
  const [state, setState] = useState<DeviceState>(INITIAL_STATE);
  const [selfLxmfHash, setSelfLxmfHash] = useState<string | null>(null);
  const unsubEventRef = useRef<(() => void) | null>(null);
  const connectInFlightRef = useRef(false);
  const suppressReconnectRef = useRef(false);
  const stateRef = useRef(state);
  const peerInterfaceByHashRef = useRef<Map<string, string>>(new Map());
  const nodeStoreSlice = useNodeStore((s) => (identityId ? s.nodes[identityId] : undefined));

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

  const applyContactNodes = useCallback(
    (contacts: ReticulumContact[]) => {
      if (!identityId) return;
      upsertNodeRecordsForIdentity(identityId, contacts.map(reticulumContactToNodeRecord));
    },
    [identityId],
  );

  const refreshIdentityFromSidecar = useCallback(async (): Promise<string | null> => {
    const status = await fetchReticulumIdentityStatus();
    if (status.lxmfHash) {
      setSelfLxmfHash(status.lxmfHash);
      return status.lxmfHash;
    }
    return null;
  }, []);

  const refreshContactsFromSidecar = useCallback(async () => {
    const contacts = await refreshReticulumPeersFromSidecar();
    applyContactNodes(contacts);
    const ifaceByHash = new Map<string, string>();
    for (const peer of useReticulumPeerStore.getState().peers.values()) {
      if (peer.interface) ifaceByHash.set(peer.destination_hash, peer.interface);
    }
    peerInterfaceByHashRef.current = ifaceByHash;
  }, [applyContactNodes]);

  const syncDiagnosticsFromSidecar = useCallback(async () => {
    try {
      const snapshot = (await window.electronAPI.reticulum.proxyGet(
        '/api/v1/diagnostics',
      )) as Parameters<typeof buildReticulumDiagnosticRows>[0];
      const rows = buildReticulumDiagnosticRows(snapshot);
      useDiagnosticsStore.setState((s) => ({
        diagnosticRows: mergeReticulumDiagnosticRows(s.diagnosticRows, rows),
      }));
    } catch (e) {
      console.debug('[useReticulumRuntime] diagnostics ' + errLikeToLogString(e));
    }
  }, []);

  const ingestLxmfPayload = useCallback(
    (p: ReticulumLxmfPayload) => {
      if (!identityId) return;
      ingestReticulumLxmfPayloadWithSideEffects(identityId, p);
    },
    [identityId],
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

  const handleSidecarEvent = useCallback(
    (evt: ReticulumSidecarEvent) => {
      if (evt.type === 'lxmf_message' && evt.payload && typeof evt.payload === 'object') {
        ingestLxmfPayload(evt.payload);
      }
      if (
        evt.type === 'propagation.sync_progress' &&
        evt.payload &&
        typeof evt.payload === 'object'
      ) {
        const p = evt.payload as { progress?: number; active?: boolean; message?: string | null };
        useReticulumPropagationStore.getState().setSyncState({
          active: p.active ?? true,
          progress: typeof p.progress === 'number' ? p.progress : 0,
          message: p.message ?? null,
        });
      }
      if (evt.type === 'nomadnetwork.node') {
        void useNomadNetworkStore.getState().refreshFromSidecar();
      }
      if (
        evt.type === 'announce.received' ||
        evt.type === 'peers_updated' ||
        evt.type === 'interface.state' ||
        evt.type === 'stats_update'
      ) {
        void refreshContactsFromSidecar();
        void syncDiagnosticsFromSidecar();
      }
    },
    [ingestLxmfPayload, refreshContactsFromSidecar, syncDiagnosticsFromSidecar],
  );

  const tearDownFromSidecarStop = useCallback(() => {
    unsubEventRef.current?.();
    unsubEventRef.current = null;
    setSelfLxmfHash(null);
    setState(INITIAL_STATE);
    syncConnectionStore(INITIAL_STATE);
  }, [syncConnectionStore]);

  const connectRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const unsubStatus = window.electronAPI.reticulum.onStatus((status) => {
      if (status.running) return;
      const wasActive = stateRef.current.status !== 'disconnected';
      if (wasActive) {
        tearDownFromSidecarStop();
        if (isReticulumAutostartEnabled() && !suppressReconnectRef.current) {
          void connectRef.current?.().catch((e: unknown) => {
            console.warn(
              '[useReticulumRuntime] autostart reconnect failed ' + errLikeToLogString(e),
            );
          });
        }
      }
      suppressReconnectRef.current = false;
    });
    return () => {
      unsubStatus();
    };
  }, [tearDownFromSidecarStop]);

  useEffect(() => {
    return () => {
      unsubEventRef.current?.();
      unsubEventRef.current = null;
      // Dev HMR remounts App without an explicit disconnect — keep the sidecar alive.
      if (!import.meta.env.DEV) {
        void window.electronAPI.reticulum.stop();
      }
    };
  }, []);

  const connect = useCallback(async () => {
    if (connectInFlightRef.current) return;
    connectInFlightRef.current = true;
    setState((s) => ({ ...s, status: 'connecting', connectionType: null }));
    syncConnectionStore({ status: 'connecting', connectionType: null });
    try {
      await window.electronAPI.reticulum.start({ reuseIfRunning: true });
      unsubEventRef.current?.();
      unsubEventRef.current = window.electronAPI.reticulum.onEvent(handleSidecarEvent);
      const lxmfHash = await refreshIdentityFromSidecar();
      const connectedNodeId = lxmfHash ? reticulumHashToNodeId(lxmfHash) : 0;
      await refreshContactsFromSidecar();
      await syncDiagnosticsFromSidecar();
      if (identityId) {
        await markStaleReticulumOutboundMessages(identityId);
        markStaleReticulumOutboundInStore(identityId);
        await refreshMessagesFromDb();
      }
      setState({ status: 'configured', myNodeNum: connectedNodeId, connectionType: null });
      syncConnectionStore({
        status: 'configured',
        connectionType: null,
        myNodeNum: connectedNodeId,
      });
    } catch (e) {
      console.error('[useReticulumRuntime] connect failed ' + errLikeToLogString(e));
      setState(INITIAL_STATE);
      syncConnectionStore(INITIAL_STATE);
      throw e instanceof Error ? e : new Error(String(e));
    } finally {
      connectInFlightRef.current = false;
    }
  }, [
    handleSidecarEvent,
    refreshContactsFromSidecar,
    refreshIdentityFromSidecar,
    refreshMessagesFromDb,
    syncDiagnosticsFromSidecar,
    identityId,
    syncConnectionStore,
  ]);

  const disconnect = useCallback(async () => {
    suppressReconnectRef.current = true;
    unsubEventRef.current?.();
    unsubEventRef.current = null;
    await window.electronAPI.reticulum.stop();
    setSelfLxmfHash(null);
    setState(INITIAL_STATE);
    syncConnectionStore(INITIAL_STATE);
  }, [syncConnectionStore]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const connectAutomatic = useCallback(async () => {
    await connect();
  }, [connect]);

  const resolveOutboundVia = useCallback((destinationHash: string) => {
    const iface = peerInterfaceByHashRef.current.get(destinationHash);
    return iface ? classifyReticulumVia(iface) : 'network';
  }, []);

  const sendMessage = useCallback(
    async (text: string, to: number | string, replyToHash?: string, pendingId?: string) => {
      if (!identityId) return;
      const destination =
        typeof to === 'string' ? to : (resolveReticulumDestinationHash(to) ?? String(to));
      const body: Record<string, unknown> = {
        destination_hash: destination,
        text,
      };
      if (replyToHash) {
        body.reply_to_hash = replyToHash;
        body.reply_to_id = replyToHash;
      }
      try {
        const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/lxmf/send', body)) as {
          ok?: boolean;
          message?: ReticulumLxmfPayload;
          sent_via?: string;
        };
        if (res?.message) {
          const hash = res.message.message_hash;
          if (pendingId && hash) {
            renameMessageId(identityId, pendingId, hash);
            ingestLxmfPayload(res.message);
            updateMessageStatus(identityId, hash, 'acked');
          } else {
            ingestLxmfPayload(res.message);
            if (pendingId) updateMessageStatus(identityId, pendingId, 'acked');
          }
        } else if (pendingId) {
          updateMessageStatus(identityId, pendingId, 'acked');
        }
      } catch (e) {
        if (pendingId) {
          updateMessageStatus(identityId, pendingId, 'failed', errLikeToLogString(e));
        }
        throw e;
      }
    },
    [identityId, ingestLxmfPayload],
  );

  const sendAttachment = useCallback(
    async (file: File, to: number | string) => {
      const destination =
        typeof to === 'string' ? to : (resolveReticulumDestinationHash(to) ?? String(to));
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/lxmf/resource', {
        destination_hash: destination,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        data_base64: btoa(binary),
      })) as { ok?: boolean; message?: ReticulumLxmfPayload };
      if (res?.message) {
        ingestLxmfPayload(res.message);
      }
    },
    [ingestLxmfPayload],
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
        ingestLxmfPayload(res.message);
      }
    },
    [identityId, ingestLxmfPayload, selfNodeId],
  );

  const getFullNodeLabel = useCallback(
    (nodeId: number) => {
      if (!identityId) return String(nodeId);
      return useNodeStore.getState().nodes[identityId]?.[nodeId]?.longName ?? String(nodeId);
    },
    [identityId],
  );

  const getPickerStyleNodeLabel = getFullNodeLabel;

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
      rawPackets: [],
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
      onPowerSuspend: () => {},
      onPowerResume: () => {
        void connect();
      },
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
      requestRefresh: refreshContactsFromSidecar,
      getNodes,
      getFullNodeLabel,
      getPickerStyleNodeLabel,
      handleSidecarEvent,
    }),
    [
      state,
      identityId,
      selfNodeId,
      nodes,
      connect,
      connectAutomatic,
      disconnect,
      sendMessage,
      sendReaction,
      sendAttachment,
      resolveOutboundVia,
      setNodeFavorited,
      refreshNodesFromDb,
      refreshMessagesFromDb,
      refreshContactsFromSidecar,
      getNodes,
      getFullNodeLabel,
      getPickerStyleNodeLabel,
      handleSidecarEvent,
    ],
  );

  useEffect(() => {
    registerReticulumSession({
      connect,
      connectAutomatic,
      disconnect,
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
