/* eslint-disable react-hooks/refs, @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion -- Runtime session pattern matches useMeshtasticRuntime (ref latch + ProtocolRuntime casts). */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  type MeshcomDeviceCommandsActions,
  useMeshcomDeviceCommands,
} from '../hooks/meshcom/useMeshcomDeviceCommands';
import { getAppSettingsRaw } from '../lib/appSettingsStorage';
import { connectionDriver } from '../lib/drivers/ConnectionDriver';
import { errLikeToLogString } from '../lib/errLikeToLogString';
import {
  isLowAccuracyPosition,
  type OurPosition,
  readStoredStaticGps,
  resolveOurPosition,
} from '../lib/gpsSource';
import { hydrateIdentityStoresFromDb } from '../lib/hydrateIdentityStoresFromDb';
import { getIdentityNodeMap } from '../lib/identityStoreReads';
import { canTransmitLocation } from '../lib/locationTransmit';
import { getOfflineIdentityIdForProtocol } from '../lib/offlineProtocolIdentities';
import { publishOurPositionReference } from '../lib/ourPositionReference';
import { parseStoredJson } from '../lib/parseStoredJson';
import type { MeshComDeviceHandle } from '../lib/protocols/MeshComProtocol';
import { ensureMeshcomProtocolLoaded } from '../lib/protocols/meshcomProtocolLoader';
import { readRadioSelfPosition } from '../lib/radioSelfPosition';
import { createRfReconnectController } from '../lib/rfReconnectController';
import {
  type MeshcomRfTransportType,
  registerMeshcomSession,
} from '../lib/sessions/meshcomSession';
import { getStoredMeshProtocol } from '../lib/storedMeshProtocol';
import { messageRecordsToChatMessages, nodeRecordsToMeshNodeMap } from '../lib/storeRecordAdapters';
import type { ConnectionType, DeviceState, IdentityId } from '../lib/types';
import { getConnection, setConnection } from '../stores/connectionStore';
import { useMessageStore } from '../stores/messageStore';
import { upsertNodeRecord, useNodeStore } from '../stores/nodeStore';
import type { ProtocolRuntime } from './protocolRuntime';

function isMeshcomAutoSettimeEnabled(): boolean {
  const parsed = parseStoredJson<{ meshcomAutoSettime?: unknown }>(
    getAppSettingsRaw(),
    'useMeshcomRuntime autoSettime',
  );
  return parsed?.meshcomAutoSettime === true;
}

const INITIAL_STATE: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  connectionType: null,
};

const asyncNoop = async (): Promise<void> => {};
const syncNoop = (): void => {};

function toUiConnectionType(type: MeshcomRfTransportType): ConnectionType {
  if (type === 'http') return 'http';
  return type;
}

function resolveHost(httpAddress?: string): string {
  const trimmed = httpAddress?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : '127.0.0.1';
}

/**
 * MeshCom runtime — session registration, transport open, ingest, reconnect, power resume.
 * Transport createDevice / EXTUDP decode wiring continues with the parallel transport agent.
 */
export function useMeshcomRuntime(): ProtocolRuntime & {
  deviceCommands: MeshcomDeviceCommandsActions;
  refreshOurPosition: () => Promise<OurPosition | null>;
  setOwner: (opts: { longName: string; shortName: string; isLicensed: boolean }) => Promise<void>;
  sendPositionToDevice: (lat: number, lon: number, alt?: number) => Promise<void>;
} {
  const offlineIdentityId = getOfflineIdentityIdForProtocol('meshcom');
  const [state, setState] = useState<DeviceState>(INITIAL_STATE);
  const [ourPosition, setOurPosition] = useState<OurPosition | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const identityIdRef = useRef<IdentityId>(offlineIdentityId);
  const driverIdentityIdRef = useRef<IdentityId | null>(null);
  const ingestDetachRef = useRef<(() => void) | null>(null);
  const explicitDisconnectRef = useRef(false);
  const connectionParamsRef = useRef<{
    rfType: MeshcomRfTransportType;
    httpAddress?: string;
    blePeripheralId?: string;
    serialPortId?: string | null;
  } | null>(null);
  const reconnectAttemptRef = useRef(0);
  const rfReconnectRef = useRef(createRfReconnectController({ logTag: 'useMeshcomRuntime' }));
  const handleConnectionLostRef = useRef<() => void>(() => {});
  const refreshOurPositionGenerationRef = useRef(0);
  const refreshOurPositionRef = useRef<() => Promise<OurPosition | null>>(async () => null);

  const resolveIdentityId = useCallback(
    (): IdentityId => identityIdRef.current || offlineIdentityId,
    [offlineIdentityId],
  );

  const detachIngest = useCallback(() => {
    ingestDetachRef.current?.();
    ingestDetachRef.current = null;
  }, []);

  const attachIngestForIdentity = useCallback(
    (identityId: IdentityId) => {
      detachIngest();
      void import('../lib/ingest/meshcomIngest')
        .then(({ attachMeshcomIngest }) => {
          if (identityIdRef.current !== identityId) return;
          ingestDetachRef.current = attachMeshcomIngest(identityId, {
            getMyNodeNum: () => getConnection(identityId)?.myNodeNum ?? state.myNodeNum ?? 0,
          });
        })
        .catch((e: unknown) => {
          console.warn('[useMeshcomRuntime] ingest attach failed ' + errLikeToLogString(e));
        });
    },
    [detachIngest, state.myNodeNum],
  );

  const prepareRfConnect = useCallback(
    async (type: MeshcomRfTransportType) => {
      explicitDisconnectRef.current = false;
      rfReconnectRef.current.cancel();
      reconnectAttemptRef.current = 0;
      setState((prev) => ({
        ...prev,
        status: 'connecting',
        connectionType: toUiConnectionType(type),
        connectionLoss: false,
      }));
      setConnection(resolveIdentityId(), {
        status: 'connecting',
        connectionType: toUiConnectionType(type),
      });
    },
    [resolveIdentityId],
  );

  const finalizeDriverDisconnect = useCallback(
    async (opts?: { disconnectDriver?: boolean }) => {
      explicitDisconnectRef.current = true;
      rfReconnectRef.current.cancel();
      reconnectAttemptRef.current = 0;
      detachIngest();
      const driverId = driverIdentityIdRef.current;
      driverIdentityIdRef.current = null;
      connectionParamsRef.current = null;
      if (opts?.disconnectDriver !== false && driverId) {
        await connectionDriver.disconnect(driverId).catch((e: unknown) => {
          console.debug('[useMeshcomRuntime] disconnect ' + errLikeToLogString(e));
        });
      }
      setState({
        status: 'disconnected',
        myNodeNum: 0,
        connectionType: null,
      });
      setConnection(resolveIdentityId(), {
        status: 'disconnected',
        connectionType: null,
      });
    },
    [detachIngest, resolveIdentityId],
  );

  const handleRfConnectFailure = useCallback(
    async (type: MeshcomRfTransportType, driverIdentityId?: string) => {
      const id = driverIdentityId ?? driverIdentityIdRef.current;
      if (id) {
        await connectionDriver.disconnect(id).catch((e: unknown) => {
          console.debug('[useMeshcomRuntime] connect failure teardown ' + errLikeToLogString(e));
        });
      }
      driverIdentityIdRef.current = null;
      detachIngest();
      setState((prev) => ({
        ...prev,
        status: 'disconnected',
        connectionType: toUiConnectionType(type),
        connectionLoss: true,
      }));
      setConnection(resolveIdentityId(), {
        status: 'disconnected',
        connectionType: toUiConnectionType(type),
      });
    },
    [detachIngest, resolveIdentityId],
  );

  const maybeAutoSettime = useCallback(async (type: MeshcomRfTransportType) => {
    if ((type !== 'serial' && type !== 'ble') || !isMeshcomAutoSettimeEnabled()) return;
    const handle = connectionDriver.getHandle(identityIdRef.current) as MeshComDeviceHandle | null;
    if (!handle) return;
    try {
      const [{ buildMeshcomSettimeCommand }, { sendMeshcomDeviceCommand }] = await Promise.all([
        import('../lib/meshcom/meshcomCommandWire'),
        import('../lib/meshcom/meshcomDeviceCommands'),
      ]);
      const result = await sendMeshcomDeviceCommand(handle, buildMeshcomSettimeCommand());
      console.debug('[useMeshcomRuntime] auto settime ' + result.command);
    } catch (e) {
      console.warn('[useMeshcomRuntime] auto settime failed ' + errLikeToLogString(e));
    }
  }, []);

  const attachRfSession = useCallback(
    async (driverIdentityId: string, type: MeshcomRfTransportType) => {
      driverIdentityIdRef.current = driverIdentityId;
      identityIdRef.current = driverIdentityId;
      attachIngestForIdentity(driverIdentityId);
      setState({
        status: 'configured',
        myNodeNum: getConnection(driverIdentityId)?.myNodeNum ?? 0,
        connectionType: toUiConnectionType(type),
      });
      setConnection(driverIdentityId, {
        status: 'configured',
        connectionType: toUiConnectionType(type),
      });
      rfReconnectRef.current.markSuccess();
      reconnectAttemptRef.current = 0;
      void hydrateIdentityStoresFromDb('meshcom', driverIdentityId).catch((e: unknown) => {
        console.warn('[useMeshcomRuntime] hydrate after attach ' + errLikeToLogString(e));
      });
      void maybeAutoSettime(type);
    },
    [attachIngestForIdentity, maybeAutoSettime],
  );

  const deviceCommands = useMeshcomDeviceCommands({
    resolveIdentityId,
    connectionType: state.connectionType,
  });

  const connect = useCallback(
    async (type: MeshcomRfTransportType, httpAddress?: string, blePeripheralId?: string) => {
      await prepareRfConnect(type);
      const { openMeshComTransport } = await import('../hooks/openMeshComTransport');
      let opened: Awaited<ReturnType<typeof openMeshComTransport>> | undefined;
      try {
        opened = await openMeshComTransport(type, {
          blePeripheralId,
          host:
            type === 'udp' || type === 'tcp' || type === 'http'
              ? resolveHost(httpAddress)
              : undefined,
        });
        connectionParamsRef.current = {
          rfType: type,
          httpAddress:
            type === 'udp' || type === 'tcp' || type === 'http'
              ? resolveHost(httpAddress)
              : undefined,
          blePeripheralId,
        };
        await attachRfSession(opened.driverIdentityId, type);
      } catch (err) {
        console.warn('[useMeshcomRuntime] connect failed ' + errLikeToLogString(err));
        await handleRfConnectFailure(type, opened?.driverIdentityId);
        throw err;
      }
    },
    [attachRfSession, handleRfConnectFailure, prepareRfConnect],
  );

  const connectAutomatic = useCallback(
    async (
      type: 'ble' | 'serial' | 'http' | 'udp' | 'tcp',
      httpAddress?: string,
      lastSerialPortId?: string | null,
      blePeripheralId?: string,
    ) => {
      if (type === 'ble') {
        if (!blePeripheralId) throw new Error('No BLE device remembered for MeshCom auto-connect');
        await connect('ble', undefined, blePeripheralId);
        return;
      }
      if (type === 'serial') {
        await prepareRfConnect('serial');
        const { openMeshComTransport } = await import('../hooks/openMeshComTransport');
        let opened: Awaited<ReturnType<typeof openMeshComTransport>> | undefined;
        try {
          opened = await openMeshComTransport('serial', {
            portSignature: lastSerialPortId,
          });
          connectionParamsRef.current = {
            rfType: 'serial',
            serialPortId: lastSerialPortId,
          };
          await attachRfSession(opened.driverIdentityId, 'serial');
        } catch (err) {
          await handleRfConnectFailure('serial', opened?.driverIdentityId);
          throw err;
        }
        return;
      }
      const rfType: MeshcomRfTransportType = type === 'http' ? 'http' : type;
      await connect(rfType, httpAddress);
    },
    [attachRfSession, connect, handleRfConnectFailure, prepareRfConnect],
  );

  const attemptReconnect = useCallback(() => {
    const params = connectionParamsRef.current;
    if (!params || explicitDisconnectRef.current) return;
    const lost = rfReconnectRef.current.onLinkLost();
    if (!lost.shouldStartOwner) return;
    rfReconnectRef.current.scheduleOwner(() => {
      if (explicitDisconnectRef.current) return;
      const attempt = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = attempt;
      rfReconnectRef.current.beginAttempt(attempt);
      const run = async () => {
        rfReconnectRef.current.beginOpening();
        try {
          await connect(params.rfType, params.httpAddress, params.blePeripheralId);
        } catch (err) {
          console.warn(
            `[useMeshcomRuntime] reconnect attempt=${attempt} ${errLikeToLogString(err)}`,
          );
          const settled = rfReconnectRef.current.endAttempt({ keepReconnecting: attempt < 8 });
          if (settled.shouldSchedule) {
            handleConnectionLostRef.current();
          } else if (attempt >= 8) {
            rfReconnectRef.current.markExhausted();
          } else {
            setTimeout(
              () => {
                handleConnectionLostRef.current();
              },
              Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)),
            );
          }
        }
      };
      void run();
    });
  }, [connect]);

  handleConnectionLostRef.current = attemptReconnect;

  const onPowerSuspend = useCallback(() => {
    rfReconnectRef.current.cancel();
  }, []);

  const onPowerResume = useCallback(() => {
    if (!connectionParamsRef.current) {
      if (explicitDisconnectRef.current) {
        console.debug('[useMeshcomRuntime] power resume — skip reconnect (user disconnect)');
        return;
      }
      console.debug('[useMeshcomRuntime] power resume — skip reconnect (no stored session)');
      return;
    }
    console.debug('[useMeshcomRuntime] power resume — resetting reconnect budget');
    reconnectAttemptRef.current = 0;
    explicitDisconnectRef.current = false;
    // Wake stagger is owned by usePowerRecovery (~12s); reconnect immediately when scheduled.
    handleConnectionLostRef.current();
  }, []);

  useLayoutEffect(() => {
    registerMeshcomSession({
      connect,
      prepareRfConnect,
      attachRfSession,
      handleRfConnectFailure,
      finalizeDriverDisconnect,
      latchExplicitDisconnect: () => {
        if (explicitDisconnectRef.current) return false;
        explicitDisconnectRef.current = true;
        return true;
      },
      clearExplicitDisconnectLatch: () => {
        explicitDisconnectRef.current = false;
      },
      connectAutomatic,
    });
    return () => {
      registerMeshcomSession(null);
    };
  }, [
    attachRfSession,
    connect,
    connectAutomatic,
    finalizeDriverDisconnect,
    handleRfConnectFailure,
    prepareRfConnect,
  ]);

  useEffect(() => {
    attachIngestForIdentity(resolveIdentityId());
    return () => {
      detachIngest();
    };
  }, [attachIngestForIdentity, detachIngest, resolveIdentityId]);

  const getNodes = useCallback(() => {
    const map = getIdentityNodeMap(resolveIdentityId());
    return Array.from(map.values());
  }, [resolveIdentityId]);

  const getFullNodeLabel = useCallback(
    (nodeId: number) => {
      const node = getIdentityNodeMap(resolveIdentityId()).get(nodeId);
      return node?.long_name?.trim() || node?.short_name?.trim() || String(nodeId);
    },
    [resolveIdentityId],
  );
  const getPickerStyleNodeLabel = useCallback(
    (nodeId: number) => getFullNodeLabel(nodeId),
    [getFullNodeLabel],
  );

  const refreshMessagesFromDb = useCallback(async () => {
    await hydrateIdentityStoresFromDb('meshcom', resolveIdentityId(), { nodes: false });
  }, [resolveIdentityId]);

  const refreshNodesFromDb = useCallback(async () => {
    await hydrateIdentityStoresFromDb('meshcom', resolveIdentityId(), { messages: false });
  }, [resolveIdentityId]);

  const sendMessage = useCallback(
    async (text: string, channelIdx: number, destNodeId?: number) => {
      const identityId = resolveIdentityId();
      const handle = connectionDriver.getHandle(identityId);
      if (!handle) {
        throw new Error('Not connected to MeshCom radio');
      }
      const protocol = await ensureMeshcomProtocolLoaded();
      await protocol.sendMessage(handle, {
        text,
        channelIndex: channelIdx,
        destination: destNodeId,
      });
    },
    [resolveIdentityId],
  );

  const setOwner = useCallback(
    async (opts: { longName: string; shortName: string; isLicensed: boolean }) => {
      const identityId = resolveIdentityId();
      const handle = connectionDriver.getHandle(identityId);
      if (!handle) {
        throw new Error('Not connected to MeshCom radio');
      }
      const protocol = await ensureMeshcomProtocolLoaded();
      await protocol.setOwner(handle, opts);
    },
    [resolveIdentityId],
  );

  const sendPositionToDevice = useCallback(
    async (lat: number, lon: number, alt?: number) => {
      const identityId = resolveIdentityId();
      const handle = connectionDriver.getHandle(identityId);
      if (!handle) {
        throw new Error('Not connected to MeshCom radio');
      }
      const protocol = await ensureMeshcomProtocolLoaded();
      await protocol.sendPositionToDevice(handle, lat, lon, alt);
    },
    [resolveIdentityId],
  );

  const pushStaticPositionToDevice = useCallback(async (lat: number, lon: number) => {
    const handle = connectionDriver.getHandle(identityIdRef.current) as MeshComDeviceHandle | null;
    if (!handle || (handle.transport !== 'serial' && handle.transport !== 'ble')) return;
    if (!canTransmitLocation({ protocol: 'meshcom' })) return;
    try {
      const { sendMeshcomDeviceCommand } = await import('../lib/meshcom/meshcomDeviceCommands');
      await sendMeshcomDeviceCommand(handle, `--setlat ${lat}`);
      await sendMeshcomDeviceCommand(handle, `--setlon ${lon}`);
    } catch (e) {
      console.debug(
        '[useMeshcomRuntime] pushStaticPositionToDevice non-fatal ' + errLikeToLogString(e),
      );
    }
  }, []);

  const refreshOurPosition = useCallback(async (): Promise<OurPosition | null> => {
    // Dual-protocol: this hook stays mounted on other tabs; skip OS geolocation unless CM is active.
    if (getStoredMeshProtocol() !== 'meshcom') {
      return null;
    }
    const generation = ++refreshOurPositionGenerationRef.current;
    setGpsLoading(true);
    try {
      const storedStatic = readStoredStaticGps();
      const staticLat = storedStatic?.lat;
      const staticLon = storedStatic?.lon;
      const radioSelf = storedStatic != null ? null : readRadioSelfPosition('meshcom');
      const pos = await resolveOurPosition(
        radioSelf?.lat,
        radioSelf?.lon,
        staticLat,
        staticLon,
        radioSelf?.altitudeMeters,
      );
      if (generation !== refreshOurPositionGenerationRef.current) {
        return null;
      }
      setOurPosition(pos);
      if (getStoredMeshProtocol() === 'meshcom') {
        publishOurPositionReference(pos);
      }

      if (pos && !isLowAccuracyPosition(pos.source)) {
        const selfNodeId = state.myNodeNum;
        if (selfNodeId > 0) {
          const existing = getIdentityNodeMap(identityIdRef.current).get(selfNodeId);
          upsertNodeRecord(identityIdRef.current, {
            nodeId: selfNodeId,
            longName: existing?.long_name,
            shortName: existing?.short_name,
            latitude: pos.lat,
            longitude: pos.lon,
            lastHeardAt: Math.floor(Date.now() / 1000),
          });
        }
        if (pos.source === 'static') {
          void pushStaticPositionToDevice(pos.lat, pos.lon);
        }
      }
      return pos;
    } finally {
      if (generation === refreshOurPositionGenerationRef.current) {
        setGpsLoading(false);
      }
    }
  }, [pushStaticPositionToDevice, state.myNodeNum]);

  refreshOurPositionRef.current = refreshOurPosition;

  useEffect(() => {
    void refreshOurPositionRef.current().catch((e: unknown) => {
      console.debug('[useMeshcomRuntime] refreshOurPosition on mount ' + errLikeToLogString(e));
    });
  }, [refreshOurPosition]);

  const identityIdForStore = resolveIdentityId();
  const messagesFromStore = useMessageStore((s) => s.messages[identityIdForStore]);
  const nodesFromStore = useNodeStore((s) => s.nodes[identityIdForStore]);
  const messages = useMemo(
    () => messageRecordsToChatMessages(Object.values(messagesFromStore ?? {})),
    [messagesFromStore],
  );
  const nodes = useMemo(
    () => nodeRecordsToMeshNodeMap(Object.values(nodesFromStore ?? {})),
    [nodesFromStore],
  );

  return useMemo(() => {
    const runtimeConnect = async (
      type: ConnectionType,
      httpAddress?: string,
      blePeripheralId?: string,
    ) => {
      const rfType: MeshcomRfTransportType =
        type === 'tcp' || type === 'udp' || type === 'ble' || type === 'serial' || type === 'http'
          ? type
          : 'udp';
      await connect(rfType, httpAddress, blePeripheralId);
    };
    const base: ProtocolRuntime = {
      state,
      identityId: identityIdForStore,
      selfNodeId: state.myNodeNum || null,
      mqttStatus: null,
      mqttConnectionLoss: null,
      messages,
      nodes,
      deviceOwner: null,
      deviceLogs: [],
      rawPackets: [],
      queueStatus: null,
      ourPosition,
      gpsLoading,
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

      connect: runtimeConnect as ProtocolRuntime['connect'],
      connectAutomatic: connectAutomatic as ProtocolRuntime['connectAutomatic'],
      disconnect: () => finalizeDriverDisconnect({ disconnectDriver: true }),
      onPowerSuspend,
      onPowerResume,
      prepareRfConnect: ((type: ConnectionType) => {
        const rfType: MeshcomRfTransportType =
          type === 'tcp' || type === 'udp' || type === 'ble' || type === 'serial' || type === 'http'
            ? type
            : 'udp';
        return prepareRfConnect(rfType);
      }) as ProtocolRuntime['prepareRfConnect'],
      attachRfSession: ((driverIdentityId: string, type: ConnectionType) => {
        const rfType: MeshcomRfTransportType =
          type === 'tcp' || type === 'udp' || type === 'ble' || type === 'serial' || type === 'http'
            ? type
            : 'udp';
        return attachRfSession(driverIdentityId, rfType);
      }) as ProtocolRuntime['attachRfSession'],
      handleRfConnectFailure: ((type: ConnectionType, driverIdentityId?: string) => {
        const rfType: MeshcomRfTransportType =
          type === 'tcp' || type === 'udp' || type === 'ble' || type === 'serial' || type === 'http'
            ? type
            : 'udp';
        return handleRfConnectFailure(rfType, driverIdentityId);
      }) as ProtocolRuntime['handleRfConnectFailure'],
      finalizeDriverDisconnect: (() =>
        finalizeDriverDisconnect({
          disconnectDriver: true,
        })) as ProtocolRuntime['finalizeDriverDisconnect'],

      sendMessage: sendMessage as ProtocolRuntime['sendMessage'],
      setNodeFavorited: async () => {},
      refreshNodesFromDb,
      refreshMessagesFromDb,
      requestRefresh: asyncNoop,
      getNodes,
      getFullNodeLabel,
      getPickerStyleNodeLabel,
      clearRawPackets: syncNoop,
      hydrateRawPackets: asyncNoop,
      sendReaction: asyncNoop as ProtocolRuntime['sendReaction'],
    };
    return {
      ...base,
      deviceCommands,
      refreshOurPosition,
      setOwner,
      sendPositionToDevice,
    };
  }, [
    attachRfSession,
    connect,
    connectAutomatic,
    deviceCommands,
    finalizeDriverDisconnect,
    getFullNodeLabel,
    getNodes,
    getPickerStyleNodeLabel,
    gpsLoading,
    handleRfConnectFailure,
    identityIdForStore,
    messages,
    nodes,
    onPowerResume,
    onPowerSuspend,
    ourPosition,
    prepareRfConnect,
    refreshMessagesFromDb,
    refreshNodesFromDb,
    refreshOurPosition,
    sendMessage,
    sendPositionToDevice,
    setOwner,
    state,
  ]);
}

export type MeshcomRuntime = ReturnType<typeof useMeshcomRuntime>;
