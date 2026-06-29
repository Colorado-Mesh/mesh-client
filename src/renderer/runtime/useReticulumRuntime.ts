import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

import { getIdentityIdForProtocol } from '../lib/identityByProtocol';
import { getOfflineIdentityIdForProtocol } from '../lib/offlineProtocolIdentities';
import { reticulumHashToNodeId } from '../lib/reticulum/destHash';
import type { ChatMessage, DeviceState, MeshNode } from '../lib/types';
import { setConnection } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import { addMessage, replaceMessageRecordsForIdentity } from '../stores/messageStore';
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
}): MeshNode {
  const nodeId = reticulumHashToNodeId(row.destination_hash);
  return {
    node_id: nodeId,
    long_name: row.display_name ?? row.destination_hash.slice(0, 16),
    short_name: row.display_name?.slice(0, 4) ?? 'RT',
    hw_model: 'Reticulum',
    snr: 0,
    battery: 0,
    last_heard: row.last_heard ?? 0,
    latitude: null,
    longitude: null,
    favorited: Boolean(row.favorited),
    source: 'rf',
  };
}

function meshNodeToRecord(node: MeshNode): NodeRecord {
  return {
    nodeId: node.node_id,
    longName: node.long_name ?? undefined,
    shortName: node.short_name ?? undefined,
    lastHeardAt: node.last_heard ?? undefined,
  };
}

export type ReticulumRuntime = ReturnType<typeof useReticulumRuntime>;

export function useReticulumRuntime(): ProtocolRuntime {
  const identityId =
    useIdentityStore(() => getIdentityIdForProtocol('reticulum')) ??
    getOfflineIdentityIdForProtocol('reticulum');
  const [state, setState] = useState<DeviceState>(INITIAL_STATE);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nodes, setNodes] = useState<Map<number, MeshNode>>(() => new Map());
  const unsubEventRef = useRef<(() => void) | null>(null);

  const syncConnectionStore = useCallback(
    (patch: Partial<DeviceState>) => {
      if (!identityId) return;
      setConnection(identityId, {
        status: patch.status,
        myNodeNum: patch.myNodeNum,
        connectionType: patch.connectionType,
      });
    },
    [identityId],
  );

  const applyNodes = useCallback(
    (map: Map<number, MeshNode>) => {
      setNodes(new Map(map));
      if (!identityId) return;
      upsertNodeRecordsForIdentity(identityId, [...map.values()].map(meshNodeToRecord));
    },
    [identityId],
  );

  const refreshContactsFromSidecar = useCallback(async () => {
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/contacts')) as {
        contacts?: {
          destination_hash: string;
          display_name?: string;
          last_heard?: number;
        }[];
      };
      const map = new Map<number, MeshNode>();
      for (const row of body.contacts ?? []) {
        const node = contactRowToNode({
          destination_hash: row.destination_hash,
          display_name: row.display_name ?? null,
          last_heard: row.last_heard ?? null,
        });
        map.set(node.node_id, node);
      }
      applyNodes(map);
    } catch (e) {
      console.warn('[useReticulumRuntime] refresh contacts ' + errLikeToLogString(e));
    }
  }, [applyNodes]);

  const handleSidecarEvent = useCallback(
    (evt: ReticulumSidecarEvent) => {
      if (evt.type === 'lxmf_message' && evt.payload && typeof evt.payload === 'object') {
        const p = evt.payload as {
          sender_hash?: string;
          sender_name?: string;
          text?: string;
          timestamp?: number;
          to_hash?: string;
        };
        if (!p.text || !p.sender_hash) return;
        const senderNodeId = reticulumHashToNodeId(p.sender_hash);
        const msg: ChatMessage = {
          sender_id: senderNodeId,
          reticulum_sender_hash: p.sender_hash,
          sender_name: p.sender_name ?? p.sender_hash.slice(0, 12),
          payload: p.text,
          channel: 0,
          timestamp: p.timestamp ?? Date.now(),
          status: 'acked',
          to: p.to_hash ? reticulumHashToNodeId(p.to_hash) : undefined,
        };
        setMessages((prev) => [...prev, msg].slice(-500));
        if (identityId) {
          addMessage(identityId, {
            id: String(msg.id),
            from: senderNodeId,
            senderName: msg.sender_name,
            to: msg.to ?? 0,
            payload: msg.payload,
            channelIndex: 0,
            timestamp: msg.timestamp,
            status: 'acked',
          });
        }
      }
      if (evt.type === 'announce.received') {
        void refreshContactsFromSidecar();
      }
    },
    [identityId, refreshContactsFromSidecar],
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
      await refreshContactsFromSidecar();
      setState({ status: 'connected', myNodeNum: 0, connectionType: null });
      syncConnectionStore({ status: 'connected', connectionType: null, myNodeNum: 0 });
    } catch (e) {
      console.error('[useReticulumRuntime] connect failed ' + errLikeToLogString(e));
      setState(INITIAL_STATE);
      syncConnectionStore(INITIAL_STATE);
      throw e instanceof Error ? e : new Error(String(e));
    }
  }, [handleSidecarEvent, refreshContactsFromSidecar, syncConnectionStore]);

  const disconnect = useCallback(async () => {
    unsubEventRef.current?.();
    unsubEventRef.current = null;
    await window.electronAPI.reticulum.stop();
    setState(INITIAL_STATE);
    syncConnectionStore(INITIAL_STATE);
  }, [syncConnectionStore]);

  const connectAutomatic = useCallback(async () => {
    await connect();
  }, [connect]);

  const sendMessage = useCallback(async (text: string, to: number | string) => {
    const destination = typeof to === 'string' ? to : String(to);
    await window.electronAPI.reticulum.proxyPost('/api/v1/lxmf/send', {
      destination_hash: destination,
      text,
    });
  }, []);

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

  const refreshMessagesFromDb = useCallback(() => {
    if (!identityId) return Promise.resolve();
    replaceMessageRecordsForIdentity(identityId, []);
    setMessages([]);
    return Promise.resolve();
  }, [identityId]);

  return useMemo(
    () => ({
      state,
      identityId: identityId,
      selfNodeId: null,
      mqttStatus: null,
      mqttConnectionLoss: null,
      messages,
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
      setNodeFavorited: async () => {},
      refreshNodesFromDb,
      refreshMessagesFromDb,
      requestRefresh: refreshContactsFromSidecar,
      getNodes,
      getFullNodeLabel,
      getPickerStyleNodeLabel,
    }),
    [
      state,
      identityId,
      messages,
      nodes,
      connect,
      connectAutomatic,
      disconnect,
      sendMessage,
      refreshNodesFromDb,
      refreshMessagesFromDb,
      refreshContactsFromSidecar,
      getNodes,
      getFullNodeLabel,
      getPickerStyleNodeLabel,
    ],
  );
}
