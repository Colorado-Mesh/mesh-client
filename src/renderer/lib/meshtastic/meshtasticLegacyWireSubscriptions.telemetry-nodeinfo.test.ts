import type { MeshDevice } from '@meshtastic/core';
import { Portnums } from '@meshtastic/protobufs';
import { describe, expect, it, vi } from 'vitest';

import type { ConnectionType, MeshNode } from '../types';
import { attachMeshtasticLegacyWireSubscriptions } from './meshtasticLegacyWireSubscriptions';

const UNKNOWN_NODE = 0xabcd1234;

function makeDeps() {
  const nodesRef = { current: new Map<number, MeshNode>() };
  const ensureNodeExists = vi.fn((nodeNum: number, source: 'rf' | 'mqtt') => {
    if (!nodesRef.current.has(nodeNum)) {
      nodesRef.current.set(nodeNum, {
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
    }
  });
  const noopRef = { current: null };
  const noopMapRef = { current: new Map() };

  return {
    nodesRef,
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
      meshtasticIdentityIdRef: { current: 'id-1' },
      meshtasticIngestSessionRef: {
        current: { setConfiguring: vi.fn(), detach: vi.fn(), markPacketSeen: vi.fn() },
      },
      meshtasticIngressDetachRef: { current: null },
      messagesRef: { current: [] },
      mqttStatusRef: { current: 'disconnected' as const },
      myNodeNumRef: { current: 0 },
      nodesRef,
      pendingTempIdRef: { current: undefined },
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
        nodesRef.current = fn(nodesRef.current);
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
    },
  };
}

describe('meshtasticLegacyWireSubscriptions telemetry NodeInfo', () => {
  it('creates stub and requests NodeInfo on first telemetry from unknown node', async () => {
    const { deps, ensureNodeExists } = makeDeps();
    const telemetrySubscribers = new Set<(packet: unknown) => void>();
    const sendPacket = vi.fn().mockResolvedValue(undefined);
    const noopSub = { subscribe: () => () => {} };
    const device = {
      sendPacket,
      events: new Proxy({} as MeshDevice['events'], {
        get: (_target, prop) => {
          if (prop === 'onTelemetryPacket') {
            return {
              subscribe: (cb: (packet: unknown) => void) => {
                telemetrySubscribers.add(cb);
                return () => telemetrySubscribers.delete(cb);
              },
            };
          }
          return noopSub;
        },
      }),
      setHeartbeatInterval: vi.fn(),
    } as unknown as MeshDevice;

    attachMeshtasticLegacyWireSubscriptions(device, 'ble', { driverIdentityId: 'id-1' }, deps);

    for (const cb of telemetrySubscribers) {
      cb({
        from: UNKNOWN_NODE,
        rxTime: Math.floor(Date.now() / 1000),
        data: { deviceMetrics: { batteryLevel: 85, voltage: 4.1 } },
      });
    }

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
