import { type MeshDevice, Types } from '@meshtastic/core';
import { Admin, Portnums } from '@meshtastic/protobufs';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { persistLastRfSelfNodeId } from '@/renderer/lib/meshtasticMqttIdentity';
import type { MeshtasticLoraConfig } from '@/shared/meshtasticUrlEncoder';

import { meshtasticNodeLacksDisplayIdentity } from '../../../shared/nodeNameUtils';
import { setConnection } from '../../stores/connectionStore';
import { setMeshtasticConfigSlice } from '../../stores/deviceStore';
import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { updateIdentity } from '../../stores/identityStore';
import { usePositionHistoryStore } from '../../stores/positionHistoryStore';
import { safeDisconnect } from '../connection';
import { persistDbWrite } from '../dbPersistRetry';
import { connectionDriver } from '../drivers/ConnectionDriver';
import { isForeignLoraLogCandidate } from '../foreignLoraDetection';
import type { OurPosition } from '../gpsSource';
import { getIdentityNode } from '../identityStoreReads';
import { attachMeshtasticIngest, type MeshtasticIngestSession } from '../ingest/meshtasticIngest';
import { attachMeshtasticProtocolIngress, meshtasticTransportParams } from '../meshIdentityBridge';
import { setMeshtasticConnectedMyNodeNum } from '../meshtasticConnectedNodeRef';
import type { MeshtasticRemoteAdminClient } from '../meshtasticRemoteAdmin';
import type { MeshtasticRawPacketEntry } from '../rawPacketLogConstants';
import { getStoredMeshProtocol } from '../storedMeshProtocol';
import {
  MESHTASTIC_BLE_CONFIGURE_TIMEOUT_MS,
  MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS,
  MESHTASTIC_LOCAL_LORA_CONFIG_DELAY_MS,
} from '../timeConstants';
import type {
  ConnectionType,
  DeviceState,
  EnvironmentTelemetryPoint,
  MeshNode,
  MeshtasticRemoteConfigSnapshot,
  MeshWaypoint,
  MQTTStatus,
  NeighborInfoRecord,
  RemoteAdminStatus,
  TelemetryPoint,
} from '../types';
import { recordMeshtasticClientNotification } from './meshtasticClientNotification';
import { meshtasticDeviceStatusForCode } from './meshtasticDeviceStatus';
import { shouldFetchLocalLoraConfigAfterConfigure } from './meshtasticLocalLoraConfig';
import type { ModulePortEvent, PaxCounterPoint } from './meshtasticModuleEvents';
import { attachMeshtasticModulePortSideEffects } from './meshtasticModulePortSideEffects';
import type { MeshtasticMqttClientProxyBridge } from './meshtasticMqttClientProxy';
import { attachMeshtasticNodeSideEffects } from './meshtasticNodeSideEffects';
import { attachMeshtasticRawPacketSideEffects } from './meshtasticRawPacketSideEffects';
import { attachMeshtasticRouterSideEffects } from './meshtasticRouterSideEffects';
import {
  installMeshtasticSdkRoutingErrorConsoleHook,
  installMeshtasticSdkRoutingErrorUnhandledRejectionHandler,
} from './meshtasticSdkRoutingErrorConsoleHook';
import {
  applyMeshtasticOutboundRoutingErrorFromLog,
  applyMeshtasticOutboundRoutingErrorFromRejection,
} from './meshtasticSdkRoutingErrorLog';
import { attachMeshtasticStoreForwardSideEffects } from './meshtasticStoreForwardSideEffects';
import { attachMeshtasticTraceSideEffects } from './meshtasticTraceSideEffects';
import { pushMeshtasticTransportSideEffectUnsubs } from './meshtasticTransportSideEffects';

const REQUEST_NODEINFO_MIN_INTERVAL_MS = 120_000;
const { DeviceStatusEnum } = Types;

/** After configure, request NodeDB metadata once; retry once if the first call fails. */
function requestMetadataAfterConfigure(
  device: MeshDevice,
  myNode: number,
  attempt: 1 | 2,
  retryTimerRef: { current: ReturnType<typeof setTimeout> | null },
): void {
  void device.getMetadata(myNode).catch((e: unknown) => {
    console.debug(
      '[useMeshtasticRuntime] getMetadata after configure failed ' +
        errLikeToLogString(e) +
        (attempt === 2 ? ' (retry)' : ''),
    );
    if (attempt === 1) {
      if (retryTimerRef.current != null) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        requestMetadataAfterConfigure(device, myNode, 2, retryTimerRef);
      }, MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS);
    }
  });
}

export type RequestStoreForwardHistoryResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'no_server'
        | 'not_configured'
        | 'local_is_server'
        | 'send_failed'
        | 'cooldown'
        | 'offline_gate'
        | 'already_requested';
    };

export interface MeshtasticRuntimeWireEffectsDeps {
  channelConfigsRef: RefObject<
    {
      index: number;
      name: string;
      role: number;
      psk: Uint8Array;
      uplinkEnabled: boolean;
      downlinkEnabled: boolean;
      positionPrecision: number;
    }[]
  >;
  configureTargetNodeNumRef: RefObject<number | null>;
  configureTargetPersistRestoredRef: RefObject<boolean>;
  configureTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
  connectionParamsRef: RefObject<{
    type: ConnectionType;
    httpAddress?: string;
    blePeripheralId?: string;
    lastSerialPortId?: string | null;
  } | null>;
  deviceConfiguredRef: RefObject<boolean>;
  deviceGpsModeRef: RefObject<number>;
  deviceRef: RefObject<MeshDevice | null>;
  handleConnectionLostRef: RefObject<() => void>;
  schedulePostCommitRebootRecoveryRef: RefObject<(source?: string) => void>;
  clearPostCommitRebootRecoveryRef: RefObject<() => void>;
  isConfiguringRef: RefObject<boolean>;
  lastDataReceivedRef: RefObject<number>;
  lastNodeInfoRequestAtRef: RefObject<Map<number, number>>;
  lastRfDisconnectAtRef: RefObject<number | null>;
  lastRfSelfNodeIdRef: RefObject<number>;
  lastSfHeartbeatChannelRef: RefObject<number>;
  lastSfHeartbeatPeriodRef: RefObject<number>;
  lastSfHeartbeatServerRef: RefObject<number | null>;
  localLoraConfigTimerRef: RefObject<ReturnType<typeof setTimeout> | undefined>;
  meshtasticIdentityIdRef: RefObject<string | null>;
  meshtasticIngestSessionRef: RefObject<MeshtasticIngestSession | null>;
  meshtasticIngressDetachRef: RefObject<(() => void) | null>;
  mqttClientProxyBridgeRef: RefObject<MeshtasticMqttClientProxyBridge | null>;
  mqttStatusRef: RefObject<MQTTStatus>;
  myNodeNumRef: RefObject<number>;
  ackMeshPacketIdByTempIdRef: RefObject<Map<number, number>>;
  pendingTracePacketIdToTargetRef: RefObject<Map<number, number>>;
  pendingTraceRequestsRef: RefObject<Map<number, number>>;
  refreshOurPositionRef: RefObject<() => Promise<OurPosition | null>>;
  remoteAdminClientRef: RefObject<MeshtasticRemoteAdminClient | null>;
  remoteAdminStatusRef: RefObject<RemoteAdminStatus>;
  requestStoreForwardHistoryRef: RefObject<
    (options?: {
      serverNodeId?: number;
      manual?: boolean;
    }) => Promise<RequestStoreForwardHistoryResult>
  >;
  rfHeardNodeIds: RefObject<Set<number>>;
  sfHistoryRequestedServersRef: RefObject<Set<number>>;
  skipLocalLoraConfigRef: RefObject<boolean>;
  loraConfigRef: RefObject<MeshtasticLoraConfig | null>;
  unsubscribesRef: RefObject<(() => void)[]>;
  virtualNodeIdRef: RefObject<number>;
  touchLastData: () => void;
  applyOwnNodeBatteryFromDeviceMetrics: (batteryLevel: number) => void;
  getNodeName: (nodeNum: number) => string;
  updateNodes: (updater: (prev: Map<number, MeshNode>) => Map<number, MeshNode>) => void;
  startWatchdog: () => void;
  stopWatchdog: () => void;
  cleanupSubscriptions: () => void;
  startGpsInterval: () => void;
  stopGpsInterval: () => void;
  isDuplicate: (senderId: number, packetId: number) => boolean;
  ensureNodeExists: (nodeNum: number, source: 'rf' | 'mqtt') => void;
  clearConfigureTimeout: () => void;
  applyMeshtasticForeignLoraFromLog: (message: string) => void;
  emptyNode: (nodeId: number) => MeshNode;
  setMeshtasticIdentityId: Dispatch<SetStateAction<string | null>>;
  setState: Dispatch<SetStateAction<DeviceState>>;
  setQueueStatus: Dispatch<SetStateAction<{ free: number; maxlen: number; res: number } | null>>;
  setDeviceLogs: Dispatch<
    SetStateAction<{ message: string; time: number; source: string; level: number }[]>
  >;
  setTraceRouteResults: Dispatch<
    SetStateAction<Map<number, { route: number[]; from: number; timestamp: number }>>
  >;
  setNeighborInfo: Dispatch<SetStateAction<Map<number, NeighborInfoRecord>>>;
  setWaypoints: Dispatch<SetStateAction<Map<number, MeshWaypoint>>>;
  setModuleConfigs: Dispatch<SetStateAction<Record<string, unknown>>>;
  setSecurityConfig: Dispatch<
    SetStateAction<{
      publicKey: Uint8Array;
      privateKey: Uint8Array;
      adminKey: Uint8Array[];
      isManaged: boolean;
      serialEnabled: boolean;
      debugLogApiEnabled: boolean;
      adminChannelEnabled: boolean;
    } | null>
  >;
  setLoraConfig: Dispatch<SetStateAction<MeshtasticLoraConfig | null>>;
  setConfigureTargetNodeNumState: Dispatch<SetStateAction<number | null>>;
  setRemoteConfigSnapshot: Dispatch<SetStateAction<MeshtasticRemoteConfigSnapshot | null>>;
  setRemoteAdminStatus: Dispatch<SetStateAction<RemoteAdminStatus>>;
  setRemoteAdminError: Dispatch<SetStateAction<string | undefined>>;
  setTelemetry: Dispatch<SetStateAction<TelemetryPoint[]>>;
  setSignalTelemetry: Dispatch<SetStateAction<TelemetryPoint[]>>;
  setEnvironmentTelemetry: Dispatch<SetStateAction<EnvironmentTelemetryPoint[]>>;
  setDeviceOwner: Dispatch<
    SetStateAction<{ longName: string; shortName: string; isLicensed: boolean } | null>
  >;
  setDeviceGpsMode: Dispatch<SetStateAction<number>>;
  setDeviceFixedPosition: Dispatch<SetStateAction<boolean | null>>;
  setTelemetryDeviceUpdateInterval: Dispatch<SetStateAction<number | null>>;
  setRawPackets: Dispatch<SetStateAction<MeshtasticRawPacketEntry[]>>;
  setRemoteHardwareMessages: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }[]>>
  >;
  setAudioMessages: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }[]>>
  >;
  setDetectionSensorEvents: Dispatch<SetStateAction<Map<number, ModulePortEvent[]>>>;
  setPingResponses: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }>>
  >;
  setIpTunnelMessages: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }[]>>
  >;
  setPaxCounterData: Dispatch<SetStateAction<Map<number, PaxCounterPoint[]>>>;
  setSerialMessages: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }[]>>
  >;
  setStoreForwardMessages: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }[]>>
  >;
  setRangeTestPackets: Dispatch<SetStateAction<Map<number, ModulePortEvent[]>>>;
  setZpsMessages: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }[]>>
  >;
  setSimulatorPackets: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }[]>>
  >;
  setAtakMessages: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }[]>>
  >;
  setMapReports: Dispatch<
    SetStateAction<Map<number, { from: number; data: unknown; timestamp: number }>>
  >;
  setPrivateMessages: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }[]>>
  >;
}

export function attachMeshtasticRuntimeWireEffects(
  device: MeshDevice,
  type: ConnectionType,
  opts: { driverIdentityId?: string } | undefined,
  deps: MeshtasticRuntimeWireEffectsDeps,
): void {
  const metadataRetryTimerRef: { current: ReturnType<typeof setTimeout> | null } = {
    current: null,
  };
  deps.unsubscribesRef.current.push(() => {
    if (metadataRetryTimerRef.current != null) {
      clearTimeout(metadataRetryTimerRef.current);
      metadataRetryTimerRef.current = null;
    }
  });

  const {
    channelConfigsRef,
    configureTargetNodeNumRef,
    configureTargetPersistRestoredRef,
    configureTimeoutRef,
    connectionParamsRef,
    deviceConfiguredRef,
    deviceGpsModeRef,
    deviceRef,
    handleConnectionLostRef,
    schedulePostCommitRebootRecoveryRef,
    clearPostCommitRebootRecoveryRef,
    isConfiguringRef,
    lastDataReceivedRef,
    lastNodeInfoRequestAtRef,
    lastRfDisconnectAtRef,
    lastRfSelfNodeIdRef,
    lastSfHeartbeatChannelRef,
    lastSfHeartbeatPeriodRef,
    lastSfHeartbeatServerRef,
    localLoraConfigTimerRef,
    meshtasticIdentityIdRef,
    meshtasticIngestSessionRef,
    meshtasticIngressDetachRef,
    mqttClientProxyBridgeRef,
    mqttStatusRef,
    myNodeNumRef,
    ackMeshPacketIdByTempIdRef,
    pendingTracePacketIdToTargetRef,
    pendingTraceRequestsRef,
    refreshOurPositionRef,
    remoteAdminClientRef,
    remoteAdminStatusRef,
    requestStoreForwardHistoryRef,
    rfHeardNodeIds,
    sfHistoryRequestedServersRef,
    skipLocalLoraConfigRef,
    loraConfigRef,
    unsubscribesRef,
    virtualNodeIdRef,
    touchLastData,
    applyOwnNodeBatteryFromDeviceMetrics,
    getNodeName,
    updateNodes,
    startWatchdog,
    stopWatchdog,
    cleanupSubscriptions,
    startGpsInterval,
    stopGpsInterval,
    isDuplicate,
    ensureNodeExists,
    clearConfigureTimeout,
    applyMeshtasticForeignLoraFromLog,
    emptyNode,
    setMeshtasticIdentityId,
    setState,
    setQueueStatus,
    setDeviceLogs,
    setTraceRouteResults,
    setNeighborInfo,
    setWaypoints,
    setModuleConfigs,
    setSecurityConfig,
    setLoraConfig,
    setConfigureTargetNodeNumState,
    setRemoteConfigSnapshot,
    setRemoteAdminStatus,
    setRemoteAdminError,
    setTelemetry,
    setSignalTelemetry,
    setEnvironmentTelemetry,
    setDeviceOwner,
    setDeviceGpsMode,
    setDeviceFixedPosition,
    setTelemetryDeviceUpdateInterval,
    setRawPackets,
    setRemoteHardwareMessages,
    setAudioMessages,
    setDetectionSensorEvents,
    setPingResponses,
    setIpTunnelMessages,
    setPaxCounterData,
    setSerialMessages,
    setStoreForwardMessages,
    setRangeTestPackets,
    setZpsMessages,
    setSimulatorPackets,
    setAtakMessages,
    setMapReports,
    setPrivateMessages,
  } = deps;

  // Protocol ingress → identity-scoped stores. Handlers below cover only what
  // `MeshtasticProtocol` does not emit yet: connection lifecycle (configure
  // timeout, watchdog, GPS), MQTT client proxy, module-port UI maps, Store &
  // Forward, and remote admin. Everything the Protocol emits is consumed from
  // `PacketRouter` (see `meshtasticIngest` / `meshtasticRouterSideEffects`).
  if (meshtasticIngressDetachRef.current) {
    meshtasticIngressDetachRef.current();
  }
  const cp = connectionParamsRef.current;
  let identityId = opts?.driverIdentityId ?? null;
  if (identityId) {
    meshtasticIngressDetachRef.current = null;
    meshtasticIdentityIdRef.current = identityId;
    setMeshtasticIdentityId(identityId);
  } else {
    const ingress = attachMeshtasticProtocolIngress(device, type, {
      peripheralId: cp?.blePeripheralId,
      host: cp?.httpAddress,
    });
    meshtasticIngressDetachRef.current = ingress.detach;
    identityId = ingress.identityId;
    meshtasticIdentityIdRef.current = identityId;
    setMeshtasticIdentityId(identityId);
  }
  if (meshtasticIngestSessionRef.current) {
    meshtasticIngestSessionRef.current.detach();
  }
  if (identityId) {
    meshtasticIngestSessionRef.current = attachMeshtasticIngest(identityId, {
      getIsConfiguring: () => isConfiguringRef.current,
      getMyNodeNum: () => myNodeNumRef.current,
    });
  }

  // ─── Device status ─────────────────────────────────────────
  const unsub1 = device.events.onDeviceStatus.subscribe((status) => {
    if (status !== DeviceStatusEnum.DeviceRestarting) {
      touchLastData();
    }
    const mapped: DeviceState['status'] = meshtasticDeviceStatusForCode(status);
    setState((s) => ({
      ...s,
      status: mapped,
      ...(mapped === 'configured' || mapped === 'connected' ? { connectionLoss: false } : {}),
    }));

    if (status === DeviceStatusEnum.DeviceRestarting) {
      deviceConfiguredRef.current = false;
      isConfiguringRef.current = true;
      meshtasticIngestSessionRef.current?.setConfiguring(true);
      schedulePostCommitRebootRecoveryRef.current('DeviceRestarting');
    }

    // Track configuring phase so packet replays are marked as historical
    if (
      status === DeviceStatusEnum.DeviceConnecting ||
      status === DeviceStatusEnum.DeviceConnected ||
      status === DeviceStatusEnum.DeviceConfiguring
    ) {
      isConfiguringRef.current = true;
      meshtasticIngestSessionRef.current?.setConfiguring(true);
      if (
        status === DeviceStatusEnum.DeviceConfiguring &&
        type === 'ble' &&
        !configureTimeoutRef.current
      ) {
        configureTimeoutRef.current = setTimeout(() => {
          console.warn('[useMeshtasticRuntime] configure timeout (BLE 30s) — forcing disconnect');
          const activeDevice = deviceRef.current;
          deviceRef.current = null;
          if (activeDevice) {
            void safeDisconnect(activeDevice).catch((e: unknown) => {
              console.debug(
                '[useMeshtasticRuntime] configure timeout safeDisconnect ' + errLikeToLogString(e),
              );
            });
          }
          cleanupSubscriptions();
          stopWatchdog();
          stopGpsInterval();
          setState({
            status: 'disconnected',
            myNodeNum: 0,
            connectionType: null,
            batteryPercent: undefined,
            batteryCharging: undefined,
          });
          clearConfigureTimeout();
        }, MESHTASTIC_BLE_CONFIGURE_TIMEOUT_MS);
      }
    }

    // Start watchdog when configured
    if (status === DeviceStatusEnum.DeviceConfigured) {
      clearPostCommitRebootRecoveryRef.current();
      clearConfigureTimeout();
      isConfiguringRef.current = false;
      meshtasticIngestSessionRef.current?.setConfiguring(false);
      lastDataReceivedRef.current = Date.now();
      startWatchdog();
      void refreshOurPositionRef.current().catch((e: unknown) => {
        console.debug(
          '[meshtasticRuntimeWireEffects] refreshOurPosition after configure failed ' +
            errLikeToLogString(e),
        );
      });
      startGpsInterval();
      setQueueStatus({ free: 16, maxlen: 16, res: 0 });
      deviceConfiguredRef.current = true;
      mqttClientProxyBridgeRef.current?.flushPendingToDevice();
      const myNode = myNodeNumRef.current;
      if (myNode > 0) {
        requestMetadataAfterConfigure(device, myNode, 1, metadataRetryTimerRef);
      }
      if (localLoraConfigTimerRef.current != null) {
        clearTimeout(localLoraConfigTimerRef.current);
      }
      localLoraConfigTimerRef.current = setTimeout(() => {
        localLoraConfigTimerRef.current = undefined;
        if (
          !shouldFetchLocalLoraConfigAfterConfigure({
            skipLocalLoraConfig: skipLocalLoraConfigRef.current,
            configureTargetNodeNum: configureTargetNodeNumRef.current,
            remoteAdminStatus: remoteAdminStatusRef.current,
            loraConfig: loraConfigRef.current,
          })
        ) {
          return;
        }
        void deviceRef.current
          ?.getConfig(Admin.AdminMessage_ConfigType.LORA_CONFIG)
          .catch((e: unknown) => {
            console.debug(
              '[useMeshtasticRuntime] LoRa config request failed ' + errLikeToLogString(e),
            );
          });
      }, MESHTASTIC_LOCAL_LORA_CONFIG_DELAY_MS);
    }

    // Always clean up on disconnect, even if we never reached configured
    if (status === DeviceStatusEnum.DeviceDisconnected) {
      if (localLoraConfigTimerRef.current != null) {
        clearTimeout(localLoraConfigTimerRef.current);
        localLoraConfigTimerRef.current = undefined;
      }
      skipLocalLoraConfigRef.current = false;
      lastRfDisconnectAtRef.current = Date.now();
      rfHeardNodeIds.current.clear();
      lastNodeInfoRequestAtRef.current.clear();
      clearConfigureTimeout();
      isConfiguringRef.current = false;
      stopWatchdog();
      stopGpsInterval();
      cleanupSubscriptions();
      setTraceRouteResults(new Map());
      setQueueStatus(null);
      setDeviceLogs([]);
      usePositionHistoryStore.getState().clearHistory();
      setNeighborInfo(new Map());
      setWaypoints(new Map());
      setModuleConfigs({});
      setSecurityConfig(null);
      setLoraConfig(null);
      setConfigureTargetNodeNumState(null);
      configureTargetNodeNumRef.current = null;
      configureTargetPersistRestoredRef.current = false;
      setRemoteConfigSnapshot(null);
      setRemoteAdminStatus('idle');
      setRemoteAdminError(undefined);
      remoteAdminClientRef.current?.resetEditState();
      remoteAdminClientRef.current?.sessionStore.clear();
      deviceRef.current = null;
      deviceConfiguredRef.current = false;
      sfHistoryRequestedServersRef.current = new Set();
      setState((s) => ({
        ...s,
        status: 'disconnected',
        connectionType: null,
        firmwareVersion: undefined,
        batteryPercent: undefined,
        batteryCharging: undefined,
      }));
    }
  });
  unsubscribesRef.current.push(unsub1);

  // ─── My node info ──────────────────────────────────────────
  const unsub2 = device.events.onMyNodeInfo.subscribe((info) => {
    console.debug(`[useMeshtasticRuntime] onMyNodeInfo: myNodeNum=${info.myNodeNum}`);
    touchLastData();
    const virtualNodeId = virtualNodeIdRef.current;
    if (virtualNodeId !== info.myNodeNum) {
      window.electronAPI.db.deleteNode(virtualNodeId).catch((e: unknown) => {
        console.debug('[useMeshtasticRuntime] deleteNode virtual ' + errLikeToLogString(e));
      });
    }
    myNodeNumRef.current = info.myNodeNum;
    const identityId = meshtasticIdentityIdRef.current;
    if (identityId) {
      const cp = connectionParamsRef.current;
      if (cp) {
        const transportParams = meshtasticTransportParams(cp.type, {
          peripheralId: cp.blePeripheralId,
          host: cp.httpAddress,
        });
        connectionDriver.remapMeshtasticNodeSignature(identityId, transportParams, info.myNodeNum);
      } else {
        updateIdentity(identityId, {
          selfNodeNum: info.myNodeNum,
          signature: `meshtastic:node:${info.myNodeNum}`,
        });
      }
      setConnection(identityId, { myNodeNum: info.myNodeNum, status: 'configured' });
    }
    setMeshtasticConnectedMyNodeNum(info.myNodeNum);
    lastRfSelfNodeIdRef.current = info.myNodeNum;
    persistLastRfSelfNodeId(info.myNodeNum);
    if (getStoredMeshProtocol() === 'meshtastic') {
      useDiagnosticsStore.getState().migrateForeignLoraFromZero(info.myNodeNum);
    }
    setState((s) => ({
      ...s,
      myNodeNum: info.myNodeNum,
      batteryPercent: undefined,
      batteryCharging: undefined,
    }));
    updateNodes((prev) => {
      const updated = new Map(prev);
      if (virtualNodeId !== info.myNodeNum) updated.delete(virtualNodeId);
      const existing = updated.get(info.myNodeNum);
      if (!existing) {
        const selfNode: MeshNode = {
          ...emptyNode(info.myNodeNum),
          hops_away: 0,
          last_heard: Date.now(),
          source: 'rf',
          heard_via_mqtt_only: false,
        };
        updated.set(info.myNodeNum, selfNode);
        persistDbWrite('meshtastic runtime self node', () =>
          window.electronAPI.db.saveNode(selfNode),
        );
      } else {
        const selfNode: MeshNode = {
          ...existing,
          hops_away: 0,
          source: 'rf',
          heard_via_mqtt_only: false,
        };
        updated.set(info.myNodeNum, selfNode);
        persistDbWrite('meshtastic runtime self node', () =>
          window.electronAPI.db.saveNode(selfNode),
        );
      }
      return updated;
    });
  });
  unsubscribesRef.current.push(unsub2);

  const maybeRequestNodeInfoForNode = (from: number): void => {
    if (from === 0 || from === myNodeNumRef.current) return;
    if (isConfiguringRef.current) return;
    const existing = getIdentityNode(meshtasticIdentityIdRef.current, from);
    if (existing && !meshtasticNodeLacksDisplayIdentity(existing, from)) return;
    const now = Date.now();
    const last = lastNodeInfoRequestAtRef.current.get(from) ?? 0;
    if (now - last < REQUEST_NODEINFO_MIN_INTERVAL_MS) return;
    lastNodeInfoRequestAtRef.current.set(from, now);
    void (async () => {
      try {
        await device.sendPacket(new Uint8Array(), Portnums.PortNum.NODEINFO_APP, from);
        console.debug(`[useMeshtasticRuntime] NODEINFO request sent for 0x${from.toString(16)}`);
      } catch (e: unknown) {
        console.debug(
          '[useMeshtasticRuntime] NODEINFO request failed',
          e instanceof Error ? e.message : e,
        );
      }
    })();
  };

  // ─── PacketRouter side effects (Protocol owns SDK packet decode) ───
  if (identityId) {
    unsubscribesRef.current.push(
      attachMeshtasticRouterSideEffects(identityId, {
        getMyNodeNum: () => myNodeNumRef.current,
        getMqttStatus: () => mqttStatusRef.current,
        getChannelConfigs: () => channelConfigsRef.current,
        hasRfDevice: () => !!deviceRef.current,
        getNodeName,
        registerMqttEchoPacketId: (senderId, packetId) => {
          isDuplicate(senderId, packetId);
        },
        requestNodeInfoForNode: maybeRequestNodeInfoForNode,
        applyForeignLoraFromLog: applyMeshtasticForeignLoraFromLog,
        applyRoutingErrorFromLog: (message) => {
          applySdkRoutingErrorFromLog(message);
        },
        setFirmwareVersion: (firmwareVersion) => {
          setState((s) => ({ ...s, firmwareVersion }));
        },
      }),
      attachMeshtasticTraceSideEffects(identityId, {
        pendingTracePacketIdToTargetRef,
        pendingTraceRequestsRef,
        setTraceRouteResults,
        touchLastData,
      }),
      attachMeshtasticRawPacketSideEffects(identityId, {
        getMyNodeNum: () => myNodeNumRef.current,
        getIsConfiguring: () => isConfiguringRef.current,
        setRawPackets,
        setSignalTelemetry,
        touchLastData,
      }),
      attachMeshtasticModulePortSideEffects(identityId, {
        touchLastData,
        setRemoteHardwareMessages,
        setAudioMessages,
        setDetectionSensorEvents,
        setPingResponses,
        setIpTunnelMessages,
        setPaxCounterData,
        setSerialMessages,
        setRangeTestPackets,
        setZpsMessages,
        setSimulatorPackets,
        setAtakMessages,
        setMapReports,
        setPrivateMessages,
      }),
      attachMeshtasticStoreForwardSideEffects(identityId, {
        touchLastData,
        getNodeName,
        getIsDeviceConfigured: () => deviceConfiguredRef.current,
        recordHeartbeat: ({ serverNodeId, channel, period }) => {
          lastSfHeartbeatServerRef.current = serverNodeId;
          lastSfHeartbeatChannelRef.current = channel;
          lastSfHeartbeatPeriodRef.current = period;
        },
        requestStoreForwardHistory: (options) => {
          void requestStoreForwardHistoryRef.current(options).catch((e: unknown) => {
            console.debug(
              '[meshtasticRuntimeWireEffects] Store & Forward history request failed ' +
                errLikeToLogString(e),
            );
          });
        },
        setStoreForwardMessages,
      }),
      attachMeshtasticNodeSideEffects(identityId, {
        connectionType: type,
        getMyNodeNum: () => myNodeNumRef.current,
        getIsConfiguring: () => isConfiguringRef.current,
        getBluetoothDeviceId: () =>
          (device.transport as { __bluetoothDevice?: { id?: string } })?.__bluetoothDevice?.id,
        touchLastData,
        emptyNode,
        ensureNodeExists,
        maybeRequestNodeInfoForNode,
        applyOwnNodeBatteryFromDeviceMetrics,
        rfHeardNodeIds,
        setDeviceOwner,
        setTelemetry,
        setEnvironmentTelemetry,
      }),
    );
  }

  // Node identity, position, and telemetry → meshtasticNodeSideEffects
  // (node_info / position / telemetry DomainEvents).

  // Channel pills and channel configs → deviceStore via MeshtasticProtocol
  // `channel` events; the runtime reads them back through `resolvedChannelConfigs`.

  // SNR/RSSI + sniffer → meshtasticRawPacketSideEffects (raw_packet DomainEvent).

  // ─── Mesh heartbeat (built-in liveness signal) ─────────────
  const unsub10 = device.events.onMeshHeartbeat.subscribe(() => {
    touchLastData();
  });
  unsubscribesRef.current.push(unsub10);

  // ─── Device config (track GPS mode and telemetry) ───────────
  const unsubConfig = device.events.onConfigPacket.subscribe((config) => {
    if (configureTargetNodeNumRef.current != null) return;
    const cfg = config as {
      payloadVariant?: {
        case?: string;
        value?: {
          gpsMode?: number;
          device_update_interval?: number;
          deviceUpdateInterval?: number;
        };
      };
    };
    if (cfg.payloadVariant?.case === 'position' && cfg.payloadVariant.value?.gpsMode != null) {
      deviceGpsModeRef.current = cfg.payloadVariant.value.gpsMode;
      setDeviceGpsMode(cfg.payloadVariant.value.gpsMode);
      const fixedPosition = (cfg.payloadVariant.value as { fixedPosition?: boolean }).fixedPosition;
      if (typeof fixedPosition === 'boolean') {
        setDeviceFixedPosition(fixedPosition);
      }
    }
    if (cfg.payloadVariant?.case === 'telemetry' && cfg.payloadVariant.value != null) {
      const interval =
        cfg.payloadVariant.value.device_update_interval ??
        cfg.payloadVariant.value.deviceUpdateInterval;
      if (typeof interval === 'number') {
        setTelemetryDeviceUpdateInterval(interval);
      }
    }
    if (cfg.payloadVariant?.case === 'security' && cfg.payloadVariant.value != null) {
      setSecurityConfig(
        cfg.payloadVariant.value as {
          publicKey: Uint8Array;
          privateKey: Uint8Array;
          adminKey: Uint8Array[];
          isManaged: boolean;
          serialEnabled: boolean;
          debugLogApiEnabled: boolean;
          adminChannelEnabled: boolean;
        },
      );
    }
    if (cfg.payloadVariant?.case === 'lora' && cfg.payloadVariant.value != null) {
      setLoraConfig(cfg.payloadVariant.value as MeshtasticLoraConfig);
    }
    const configCase = cfg.payloadVariant?.case;
    const configValue = cfg.payloadVariant?.value;
    const identityId = meshtasticIdentityIdRef.current;
    if (configCase && configValue != null && identityId) {
      setMeshtasticConfigSlice(identityId, configCase, configValue);
    }
  });
  unsubscribesRef.current.push(unsubConfig);

  const unsubFromRadio = device.events.onFromRadio.subscribe((packet) => {
    const variant = packet.payloadVariant;
    if (variant?.case === 'mqttClientProxyMessage') {
      void mqttClientProxyBridgeRef.current?.handleFromRadio(packet).catch((e: unknown) => {
        console.warn(
          '[useMeshtasticRuntime] mqttClientProxy FromRadio failed ' + errLikeToLogString(e),
        );
      });
      return;
    }
    if (variant?.case === 'clientNotification') {
      const message = variant.value?.message;
      if (typeof message === 'string' && message.trim()) {
        recordMeshtasticClientNotification(message);
      }
    }
  });
  unsubscribesRef.current.push(unsubFromRadio);

  // Traceroute correlation → meshtasticTraceSideEffects (trace_route DomainEvent).

  // Queue status → connectionStore via MeshtasticProtocol + PacketRouter.

  const applySdkRoutingErrorFromLog = (logMessage: string): boolean => {
    return applyMeshtasticOutboundRoutingErrorFromLog(logMessage, {
      myNodeNum: myNodeNumRef.current,
      identityId: meshtasticIdentityIdRef.current,
      tempIdToWirePacketId: ackMeshPacketIdByTempIdRef.current,
    });
  };

  const applySdkRoutingErrorFromRejection = (reason: unknown): boolean => {
    const uiApplied = applyMeshtasticOutboundRoutingErrorFromRejection(reason, {
      myNodeNum: myNodeNumRef.current,
      identityId: meshtasticIdentityIdRef.current,
      tempIdToWirePacketId: ackMeshPacketIdByTempIdRef.current,
    });
    if (!uiApplied) {
      const parsed = reason as { id?: number; packetId?: number; error?: number };
      const packetId = parsed.id ?? parsed.packetId;
      console.debug('[meshtasticSdkRoutingErrorLog] SDK queue rejection', packetId, parsed.error);
    }
    return uiApplied;
  };

  // Device log records → deviceStore via protocol; foreign-LoRa and SDK routing
  // error parsing run from the PacketRouter `device_log` listener attached above.
  // Main-process log lines are not a protocol event, so they stay subscribed here.
  const unsubForeignLoraLogLine = window.electronAPI.log.onLine((entry) => {
    if (isForeignLoraLogCandidate(entry.message)) {
      applyMeshtasticForeignLoraFromLog(entry.message);
    }
    applySdkRoutingErrorFromLog(entry.message);
  });
  unsubscribesRef.current.push(
    unsubForeignLoraLogLine,
    installMeshtasticSdkRoutingErrorConsoleHook(applySdkRoutingErrorFromLog),
    installMeshtasticSdkRoutingErrorUnhandledRejectionHandler(applySdkRoutingErrorFromRejection),
  );

  // Neighbor info → nodeStore via protocol ingress.

  // Waypoint MQTT uplink → meshtasticRouterSideEffects (waypoint DomainEvent).

  // Module config → deviceStore via protocol ingress (skipped during remote configure).

  const unsubRemoteAdmin = device.events.onMeshPacket.subscribe((meshPacket) => {
    remoteAdminClientRef.current?.handleMeshPacket(meshPacket as never);
  });
  unsubscribesRef.current.push(unsubRemoteAdmin);

  // Module ports + Store & Forward → PacketRouter side-effect modules.

  pushMeshtasticTransportSideEffectUnsubs(
    device,
    type,
    (unsub) => unsubscribesRef.current.push(unsub),
    () => {
      handleConnectionLostRef.current();
    },
  );
}
