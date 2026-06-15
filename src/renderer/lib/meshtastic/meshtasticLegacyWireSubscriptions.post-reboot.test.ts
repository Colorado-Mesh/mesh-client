import type { MeshDevice } from '@meshtastic/core';
import { describe, expect, it, vi } from 'vitest';

import type { ConnectionType, DeviceState } from '../types';
import { attachMeshtasticLegacyWireSubscriptions } from './meshtasticLegacyWireSubscriptions';

function makeDeps() {
  const touchLastData = vi.fn();
  const schedulePostCommitRebootRecovery = vi.fn();
  const clearPostCommitRebootRecovery = vi.fn();
  const setState = vi.fn();
  const stopWatchdog = vi.fn();
  const stopGpsInterval = vi.fn();
  const cleanupSubscriptions = vi.fn();
  const clearConfigureTimeout = vi.fn();
  const startWatchdog = vi.fn();
  const startGpsInterval = vi.fn();
  const refreshOurPosition = vi.fn().mockResolvedValue(null);

  const deviceConfiguredRef = { current: true };
  const isConfiguringRef = { current: false };
  const deviceRef = { current: null as MeshDevice | null };
  const connectionParamsRef = {
    current: { type: 'ble' as ConnectionType, blePeripheralId: 'p1' },
  };
  const configureTimeoutRef = { current: null as ReturnType<typeof setTimeout> | null };
  const meshtasticIngestSessionRef = {
    current: { setConfiguring: vi.fn(), detach: vi.fn(), markPacketSeen: vi.fn() },
  };

  const noopRef = { current: null };
  const noopSet = vi.fn();
  const noopMapRef = { current: new Map() };

  const deps = {
    channelConfigsRef: { current: [] },
    configureTargetNodeNumRef: noopRef,
    configureTargetPersistRestoredRef: { current: false },
    configureTimeoutRef,
    connectionParamsRef,
    deviceConfiguredRef,
    deviceGpsModeRef: { current: 0 },
    deviceRef,
    handleConnectionLostRef: { current: vi.fn() },
    schedulePostCommitRebootRecoveryRef: { current: schedulePostCommitRebootRecovery },
    clearPostCommitRebootRecoveryRef: { current: clearPostCommitRebootRecovery },
    isConfiguringRef,
    lastDataReceivedRef: { current: Date.now() },
    lastNodeInfoRequestAtRef: { current: new Map() },
    lastRfDisconnectAtRef: { current: null },
    lastRfSelfNodeIdRef: { current: 0 },
    lastSfHeartbeatChannelRef: { current: 0 },
    lastSfHeartbeatPeriodRef: { current: 0 },
    lastSfHeartbeatServerRef: { current: null },
    localLoraConfigTimerRef: { current: undefined },
    meshtasticIdentityIdRef: { current: 'id-1' },
    meshtasticIngestSessionRef,
    meshtasticIngressDetachRef: { current: null },
    messagesRef: { current: [] },
    mqttStatusRef: { current: 'disconnected' as const },
    myNodeNumRef: { current: 0 },
    nodesRef: { current: new Map() },
    pendingTempIdRef: { current: undefined },
    pendingTracePacketIdToTargetRef: noopMapRef,
    pendingTraceRequestsRef: noopMapRef,
    refreshOurPositionRef: { current: refreshOurPosition },
    remoteAdminClientRef: { current: null },
    remoteAdminStatusRef: { current: 'idle' as const },
    requestStoreForwardHistoryRef: { current: vi.fn() },
    rfHeardNodeIds: { current: new Set<number>() },
    sfHistoryRequestedServersRef: { current: new Set<number>() },
    skipLocalLoraConfigRef: { current: false },
    loraConfigRef: { current: null },
    unsubscribesRef: { current: [] as (() => void)[] },
    virtualNodeIdRef: { current: 1 },
    touchLastData,
    applyOwnNodeBatteryFromDeviceMetrics: vi.fn(),
    getNodeName: vi.fn(),
    updateNodes: vi.fn(),
    startWatchdog,
    stopWatchdog,
    cleanupSubscriptions,
    startGpsInterval,
    stopGpsInterval,
    isDuplicate: vi.fn().mockReturnValue(false),
    ensureNodeExists: vi.fn(),
    clearConfigureTimeout,
    applyMeshtasticForeignLoraFromLog: vi.fn(),
    emptyNode: vi.fn(),
    setMeshtasticIdentityId: noopSet,
    setState,
    setQueueStatus: noopSet,
    setDeviceLogs: noopSet,
    setTraceRouteResults: noopSet,
    setNeighborInfo: noopSet,
    setWaypoints: noopSet,
    setModuleConfigs: noopSet,
    setSecurityConfig: noopSet,
    setLoraConfig: noopSet,
    setConfigureTargetNodeNumState: noopSet,
    setRemoteConfigSnapshot: noopSet,
    setRemoteAdminStatus: noopSet,
    setRemoteAdminError: noopSet,
    setMessages: noopSet,
    setTelemetry: noopSet,
    setSignalTelemetry: noopSet,
    setEnvironmentTelemetry: noopSet,
    setDeviceOwner: noopSet,
    setChannels: noopSet,
    setChannelConfigs: noopSet,
    setDeviceGpsMode: noopSet,
    setDeviceFixedPosition: noopSet,
    setTelemetryDeviceUpdateInterval: noopSet,
    setRawPackets: noopSet,
    setRemoteHardwareMessages: noopSet,
    setAudioMessages: noopSet,
    setDetectionSensorEvents: noopSet,
    setPingResponses: noopSet,
    setIpTunnelMessages: noopSet,
    setPaxCounterData: noopSet,
    setSerialMessages: noopSet,
    setStoreForwardMessages: noopSet,
    setRangeTestPackets: noopSet,
    setZpsMessages: noopSet,
    setSimulatorPackets: noopSet,
    setAtakMessages: noopSet,
    setMapReports: noopSet,
    setPrivateMessages: noopSet,
    mqttClientProxyBridgeRef: { current: null },
  };

  return {
    deps,
    touchLastData,
    schedulePostCommitRebootRecovery,
    clearPostCommitRebootRecovery,
    deviceConfiguredRef,
    isConfiguringRef,
    setState,
  };
}

describe('meshtasticLegacyWireSubscriptions DeviceRestarting', () => {
  it('skips touchLastData and schedules post-reboot recovery on status 1', () => {
    const {
      deps,
      touchLastData,
      schedulePostCommitRebootRecovery,
      deviceConfiguredRef,
      isConfiguringRef,
      setState,
    } = makeDeps();

    const statusSubscribers = new Set<(status: number) => void>();
    const noopSub = { subscribe: () => () => {} };
    const device = {
      events: new Proxy({} as MeshDevice['events'], {
        get: (_target, prop) => {
          if (prop === 'onDeviceStatus') {
            return {
              subscribe: (cb: (status: number) => void) => {
                statusSubscribers.add(cb);
                return () => statusSubscribers.delete(cb);
              },
            };
          }
          return noopSub;
        },
      }),
      setHeartbeatInterval: vi.fn(),
    } as unknown as MeshDevice;

    attachMeshtasticLegacyWireSubscriptions(device, 'ble', { driverIdentityId: 'id-1' }, deps);

    for (const cb of statusSubscribers) cb(1);

    expect(touchLastData).not.toHaveBeenCalled();
    expect(deviceConfiguredRef.current).toBe(false);
    expect(isConfiguringRef.current).toBe(true);
    expect(schedulePostCommitRebootRecovery).toHaveBeenCalledWith('DeviceRestarting');
    expect(setState).toHaveBeenCalledWith(expect.any(Function));
    const updater = setState.mock.calls[0][0] as (s: DeviceState) => DeviceState;
    expect(updater({ status: 'configured', myNodeNum: 1, connectionType: 'ble' }).status).toBe(
      'connecting',
    );
  });

  it('clears post-reboot recovery on DeviceConfigured (status 7)', () => {
    const { deps, clearPostCommitRebootRecovery } = makeDeps();

    const statusSubscribers = new Set<(status: number) => void>();
    const noopSub = { subscribe: () => () => {} };
    const device = {
      events: new Proxy({} as MeshDevice['events'], {
        get: (_target, prop) => {
          if (prop === 'onDeviceStatus') {
            return {
              subscribe: (cb: (status: number) => void) => {
                statusSubscribers.add(cb);
                return () => statusSubscribers.delete(cb);
              },
            };
          }
          return noopSub;
        },
      }),
      setHeartbeatInterval: vi.fn(),
    } as unknown as MeshDevice;

    attachMeshtasticLegacyWireSubscriptions(device, 'ble', { driverIdentityId: 'id-1' }, deps);

    for (const cb of statusSubscribers) cb(7);

    expect(clearPostCommitRebootRecovery).toHaveBeenCalled();
  });
});
