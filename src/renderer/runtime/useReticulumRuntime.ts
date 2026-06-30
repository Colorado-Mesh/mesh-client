import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildReticulumDiagnosticRows,
  mergeReticulumDiagnosticRows,
} from '@/renderer/lib/diagnostics/ReticulumDiagnosticEngine';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  ingestReticulumLxmfPayloadWithSideEffects,
  type ReticulumLxmfPayload,
} from '@/renderer/lib/ingest/reticulumIngest';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

import { getIdentityIdForProtocol } from '../lib/identityByProtocol';
import { getOfflineIdentityIdForProtocol } from '../lib/offlineProtocolIdentities';
import {
  registerReticulumDestinationHash,
  resolveReticulumDestinationHash,
  reticulumHashToNodeId,
} from '../lib/reticulum/destHash';
import { reticulumDbRowToMessageRecord } from '../lib/storeRecordAdapters';
import type { DeviceState, MeshNode } from '../lib/types';
import { setConnection } from '../stores/connectionStore';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { useIdentityStore } from '../stores/identityStore';
import { replaceMessageRecordsForIdentity, useMessageStore } from '../stores/messageStore';
import { type NodeRecord, upsertNodeRecordsForIdentity } from '../stores/nodeStore';
import type { ProtocolRuntime } from './protocolRuntime';

const INITIAL_STATE: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  connectionType: null,
};

function contactRowToNode(row: {
  destination_hash: string;
  display_name?: string | null;
  last_heard?: number | null;
  favorited?: number | null;
  hops?: number | null;
}): MeshNode {
  const nodeId = reticulumHashToNodeId(row.destination_hash);
  registerReticulumDestinationHash(nodeId, row.destination_hash);
  return {
    node_id: nodeId,
    reticulum_destination_hash: row.destination_hash,
    long_name: row.display_name ?? row.destination_hash.slice(0, 16),
    short_name: row.display_name?.slice(0, 4) ?? 'RT',
    hw_model: 'Reticulum',
    snr: 0,
    battery: 0,
    last_heard: row.last_heard ?? 0,
    latitude: null,
    longitude: null,
    favorited: Boolean(row.favorited),
    hops_away: row.hops ?? undefined,
    source: 'rf',
  };
}

function meshNodeToRecord(node: MeshNode): NodeRecord {
  return {
    nodeId: node.node_id,
    longName: node.long_name ?? undefined,
    shortName: node.short_name ?? undefined,
    lastHeardAt: node.last_heard ?? undefined,
    hopsAway: node.hops_away,
  };
}

export type ReticulumRuntime = ReturnType<typeof useReticulumRuntime>;

export function useReticulumRuntime(): ProtocolRuntime {
  const identityId =
    useIdentityStore(() => getIdentityIdForProtocol('reticulum')) ??
    getOfflineIdentityIdForProtocol('reticulum');
  const [state, setState] = useState<DeviceState>(INITIAL_STATE);
  const [nodes, setNodes] = useState<Map<number, MeshNode>>(() => new Map());
  const [selfLxmfHash, setSelfLxmfHash] = useState<string | null>(null);
  const unsubEventRef = useRef<(() => void) | null>(null);

  const selfNodeId = useMemo(
    () => (selfLxmfHash ? reticulumHashToNodeId(selfLxmfHash) : null),
    [selfLxmfHash],
  );

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

  const applyNodes = useCallback(
    (map: Map<number, MeshNode>) => {
      setNodes(new Map(map));
      if (!identityId) return;
      upsertNodeRecordsForIdentity(identityId, [...map.values()].map(meshNodeToRecord));
    },
    [identityId],
  );

  const refreshIdentityFromSidecar = useCallback(async () => {
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/identity/status')) as {
        configured?: boolean;
        lxmf_hash?: string;
      };
      if (body.configured && body.lxmf_hash) {
        setSelfLxmfHash(body.lxmf_hash);
        registerReticulumDestinationHash(reticulumHashToNodeId(body.lxmf_hash), body.lxmf_hash);
      }
    } catch (e) {
      console.debug('[useReticulumRuntime] identity status ' + errLikeToLogString(e));
    }
  }, []);

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

  const refreshContactsFromSidecar = useCallback(async () => {
    try {
      const [contactsBody, peersBody] = await Promise.all([
        window.electronAPI.reticulum.proxyGet('/api/v1/contacts') as Promise<{
          contacts?: {
            destination_hash: string;
            display_name?: string;
            last_heard?: number;
          }[];
        }>,
        window.electronAPI.reticulum.proxyGet('/api/v1/peers') as Promise<{
          peers?: { destination_hash: string; display_name?: string; hops?: number }[];
        }>,
      ]);
      const hopsByHash = new Map<string, number>();
      for (const peer of peersBody.peers ?? []) {
        if (peer.hops != null) hopsByHash.set(peer.destination_hash, peer.hops);
      }
      const map = new Map<number, MeshNode>();
      for (const row of contactsBody.contacts ?? []) {
        const node = contactRowToNode({
          destination_hash: row.destination_hash,
          display_name: row.display_name ?? null,
          last_heard: row.last_heard ?? null,
          hops: hopsByHash.get(row.destination_hash) ?? null,
        });
        map.set(node.node_id, node);
      }
      for (const peer of peersBody.peers ?? []) {
        if (map.has(reticulumHashToNodeId(peer.destination_hash))) continue;
        const node = contactRowToNode({
          destination_hash: peer.destination_hash,
          display_name: peer.display_name ?? null,
          last_heard: null,
          hops: peer.hops ?? null,
        });
        map.set(node.node_id, node);
      }
      applyNodes(map);
    } catch (e) {
      console.warn('[useReticulumRuntime] refresh contacts ' + errLikeToLogString(e));
    }
  }, [applyNodes]);

  const ingestLxmfPayload = useCallback(
    (p: ReticulumLxmfPayload) => {
      if (!identityId) return;
      ingestReticulumLxmfPayloadWithSideEffects(identityId, p);
    },
    [identityId],
  );

  const handleSidecarEvent = useCallback(
    (evt: ReticulumSidecarEvent) => {
      if (evt.type === 'lxmf_message' && evt.payload && typeof evt.payload === 'object') {
        ingestLxmfPayload(evt.payload);
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

  useEffect(() => {
    return () => {
      unsubEventRef.current?.();
      unsubEventRef.current = null;
      void window.electronAPI.reticulum.stop();
    };
  }, []);

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, status: 'connecting', connectionType: null }));
    syncConnectionStore({ status: 'connecting', connectionType: null });
    try {
      await window.electronAPI.reticulum.start({ reuseIfRunning: true });
      unsubEventRef.current?.();
      unsubEventRef.current = window.electronAPI.reticulum.onEvent(handleSidecarEvent);
      await refreshIdentityFromSidecar();
      await refreshContactsFromSidecar();
      await syncDiagnosticsFromSidecar();
      setState({ status: 'configured', myNodeNum: selfNodeId ?? 0, connectionType: null });
      syncConnectionStore({
        status: 'configured',
        connectionType: null,
        myNodeNum: selfNodeId ?? 0,
      });
    } catch (e) {
      console.error('[useReticulumRuntime] connect failed ' + errLikeToLogString(e));
      setState(INITIAL_STATE);
      syncConnectionStore(INITIAL_STATE);
      throw e instanceof Error ? e : new Error(String(e));
    }
  }, [
    handleSidecarEvent,
    refreshContactsFromSidecar,
    refreshIdentityFromSidecar,
    syncDiagnosticsFromSidecar,
    selfNodeId,
    syncConnectionStore,
  ]);

  const disconnect = useCallback(async () => {
    unsubEventRef.current?.();
    unsubEventRef.current = null;
    await window.electronAPI.reticulum.stop();
    setSelfLxmfHash(null);
    setState(INITIAL_STATE);
    syncConnectionStore(INITIAL_STATE);
  }, [syncConnectionStore]);

  const connectAutomatic = useCallback(async () => {
    await connect();
  }, [connect]);

  const sendMessage = useCallback(
    async (text: string, to: number | string, replyToHash?: string) => {
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
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/lxmf/send', body)) as {
        ok?: boolean;
        message?: ReticulumLxmfPayload;
      };
      if (res?.message) {
        ingestLxmfPayload(res.message);
      }
    },
    [ingestLxmfPayload],
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
      return nodes.get(nodeId)?.long_name ?? String(nodeId);
    },
    [nodes],
  );

  const getPickerStyleNodeLabel = getFullNodeLabel;

  const getNodes = useCallback(() => [...nodes.values()], [nodes]);

  const refreshNodesFromDb = useCallback(async () => {
    await refreshContactsFromSidecar();
  }, [refreshContactsFromSidecar]);

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
      }[];
      replaceMessageRecordsForIdentity(
        identityId,
        rows.map((row) => reticulumDbRowToMessageRecord(row)),
      );
    } catch (e) {
      console.warn('[useReticulumRuntime] refresh messages ' + errLikeToLogString(e));
    }
  }, [identityId]);

  const setNodeFavorited = useCallback(
    async (nodeId: number, favorited: boolean) => {
      const node = nodes.get(nodeId);
      const hash = node?.reticulum_destination_hash ?? resolveReticulumDestinationHash(nodeId);
      if (!hash) return;
      setNodes((prev) => {
        const next = new Map(prev);
        const n = next.get(nodeId);
        if (n) next.set(nodeId, { ...n, favorited });
        return next;
      });
      try {
        await window.electronAPI.db.upsertReticulumDestination({
          destination_hash: hash,
          display_name: node?.long_name ?? null,
          favorited,
        });
      } catch (e) {
        console.warn('[useReticulumRuntime] favorite ' + errLikeToLogString(e));
      }
    },
    [nodes],
  );

  return useMemo(
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
}
