import type { MeshDevice } from '@meshtastic/core';
import { Portnums } from '@meshtastic/protobufs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNodeStore } from '../../stores/nodeStore';
import { packetRouter } from '../drivers/PacketRouter';
import { syncNodesMapToIdentityStore } from '../hydrateIdentityStoresFromDb';
import type { ConnectionType, MeshNode } from '../types';
import { attachMeshtasticRuntimeWireEffects } from './meshtasticRuntimeWireEffects';

const UNKNOWN_NODE = 0xabcd1234;
const IDENTITY = 'id-1';

/** Wire effects read nodes from `nodeStore`, so the mocks publish there too. */
function publishNodes(nodes: Map<number, MeshNode>): void {
  syncNodesMapToIdentityStore(IDENTITY, nodes);
}

function makeDeps() {
  const nodeMirror = new Map<number, MeshNode>();
  const ensureNodeExists = vi.fn((nodeNum: number, source: 'rf' | 'mqtt') => {
    if (!nodeMirror.has(nodeNum)) {
      nodeMirror.set(nodeNum, {
        node_id: nodeNum,
        long_name: '',
        short_name: '',
        hw_model: '',
        battery: 0,
        snr: 0,
        rssi: 0,
        last_heard: Date.now(),
        latitude: null,
        longitude: null,
        source,
        heard_via_mqtt_only: false,
      });
      publishNodes(nodeMirror);
    }
  });
  const noopRef = { current: null };
  const noopMapRef = { current: new Map() };

  return {
    nodeMirror,
    ensureNodeExists,
    deps: {
      channelConfigsRef: { current: [] },
      configureTargetNodeNumRef: noopRef,
      configureTargetPersistRestoredRef: { current: false },
      configureTimeoutRef: { current: null },
      connectionParamsRef: {
        current: { type: 'ble' as ConnectionType, blePeripheralId: 'p1' },
      },
      deviceConfiguredRef: { current: true },
      deviceGpsModeRef: { current: 0 },
      deviceRef: { current: null as MeshDevice | null },
      handleConnectionLostRef: { current: vi.fn() },
      schedulePostCommitRebootRecoveryRef: { current: vi.fn() },
      clearPostCommitRebootRecoveryRef: { current: vi.fn() },
      isConfiguringRef: { current: false },
      lastDataReceivedRef: { current: Date.now() },
      lastNodeInfoRequestAtRef: { current: new Map() },
      lastRfDisconnectAtRef: { current: null },
      lastRfSelfNodeIdRef: { current: 0 },
      lastSfHeartbeatChannelRef: { current: 0 },
      lastSfHeartbeatPeriodRef: { current: 0 },
      lastSfHeartbeatServerRef: { current: null },
      localLoraConfigTimerRef: { current: undefined },
      meshtasticIdentityIdRef: { current: IDENTITY },
      meshtasticIngestSessionRef: {
        current: {
          setConfiguring: vi.fn(),
          detach: vi.fn(),
          markPacketSeen: vi.fn(),
          isDuplicatePacket: vi.fn(),
        },
      },
      meshtasticIngressDetachRef: { current: null },
      mqttStatusRef: { current: 'disconnected' as const },
      myNodeNumRef: { current: 0 },
      pendingTempIdRef: { current: undefined },
      ackMeshPacketIdByTempIdRef: { current: new Map() },
      pendingTracePacketIdToTargetRef: noopMapRef,
      pendingTraceRequestsRef: noopMapRef,
      refreshOurPositionRef: { current: vi.fn().mockResolvedValue(null) },
      remoteAdminClientRef: { current: null },
      remoteAdminStatusRef: { current: 'idle' as const },
      requestStoreForwardHistoryRef: { current: vi.fn() },
      rfHeardNodeIds: { current: new Set<number>() },
      sfHistoryRequestedServersRef: { current: new Set<number>() },
      skipLocalLoraConfigRef: { current: false },
      loraConfigRef: { current: null },
      unsubscribesRef: { current: [] as (() => void)[] },
      virtualNodeIdRef: { current: 1 },
      touchLastData: vi.fn(),
      applyOwnNodeBatteryFromDeviceMetrics: vi.fn(),
      getNodeName: vi.fn(),
      updateNodes: vi.fn((fn: (prev: Map<number, MeshNode>) => Map<number, MeshNode>) => {
        const next = fn(new Map(nodeMirror));
        nodeMirror.clear();
        for (const [id, node] of next) nodeMirror.set(id, node);
        publishNodes(nodeMirror);
      }),
      startWatchdog: vi.fn(),
      stopWatchdog: vi.fn(),
      cleanupSubscriptions: vi.fn(),
      startGpsInterval: vi.fn(),
      stopGpsInterval: vi.fn(),
      isDuplicate: vi.fn().mockReturnValue(false),
      ensureNodeExists,
      clearConfigureTimeout: vi.fn(),
      applyMeshtasticForeignLoraFromLog: vi.fn(),
      emptyNode: vi.fn(),
      setMeshtasticIdentityId: vi.fn(),
      setState: vi.fn(),
      setQueueStatus: vi.fn(),
      setDeviceLogs: vi.fn(),
      setTraceRouteResults: vi.fn(),
      setNeighborInfo: vi.fn(),
      setWaypoints: vi.fn(),
      setModuleConfigs: vi.fn(),
      setSecurityConfig: vi.fn(),
      setLoraConfig: vi.fn(),
      setConfigureTargetNodeNumState: vi.fn(),
      setRemoteConfigSnapshot: vi.fn(),
      setRemoteAdminStatus: vi.fn(),
      setRemoteAdminError: vi.fn(),
      setMessages: vi.fn(),
      setTelemetry: vi.fn(),
      setSignalTelemetry: vi.fn(),
      setEnvironmentTelemetry: vi.fn(),
      setDeviceOwner: vi.fn(),
      setChannels: vi.fn(),
      setChannelConfigs: vi.fn(),
      setDeviceGpsMode: vi.fn(),
      setDeviceFixedPosition: vi.fn(),
      setTelemetryDeviceUpdateInterval: vi.fn(),
      setRawPackets: vi.fn(),
      setRemoteHardwareMessages: vi.fn(),
      setAudioMessages: vi.fn(),
      setDetectionSensorEvents: vi.fn(),
      setPingResponses: vi.fn(),
      setIpTunnelMessages: vi.fn(),
      setPaxCounterData: vi.fn(),
      setSerialMessages: vi.fn(),
      setStoreForwardMessages: vi.fn(),
      setRangeTestPackets: vi.fn(),
      setZpsMessages: vi.fn(),
      setSimulatorPackets: vi.fn(),
      setAtakMessages: vi.fn(),
      setMapReports: vi.fn(),
      setPrivateMessages: vi.fn(),
      mqttClientProxyBridgeRef: { current: null },
    },
  };
}

describe('meshtasticRuntimeWireEffects telemetry NodeInfo', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {} });
  });

  it('creates stub and requests NodeInfo on first telemetry from unknown node', async () => {
    const { deps, ensureNodeExists } = makeDeps();
    const sendPacket = vi.fn().mockResolvedValue(undefined);
    const noopSub = { subscribe: () => () => {} };
    const device = {
      sendPacket,
      events: new Proxy({} as MeshDevice['events'], {
        get: () => noopSub,
      }),
      setHeartbeatInterval: vi.fn(),
    } as unknown as MeshDevice;

    attachMeshtasticRuntimeWireEffects(device, 'ble', { driverIdentityId: IDENTITY }, deps);

    packetRouter.dispatch(
      {
        type: 'telemetry',
        payload: {
          nodeId: UNKNOWN_NODE,
          timestamp: Date.now(),
          batteryLevel: 85,
          voltage: 4.1,
          variantCase: 'deviceMetrics',
        },
      },
      IDENTITY,
    );

    await vi.waitFor(() => {
      expect(sendPacket).toHaveBeenCalled();
    });

    expect(ensureNodeExists).toHaveBeenCalledWith(UNKNOWN_NODE, 'rf');
    expect(sendPacket).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      Portnums.PortNum.NODEINFO_APP,
      UNKNOWN_NODE,
    );
  });
});
