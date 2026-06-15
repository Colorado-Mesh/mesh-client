import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { type MeshDevice, Types } from '@meshtastic/core';
import { Admin, Mesh, Portnums } from '@meshtastic/protobufs';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  decodeStoreForwardTextPayload,
  isDuplicateHistoryMessage,
  parseStoreForwardHeartbeat,
} from '@/renderer/lib/meshtasticBacklogUtils';
import { persistLastRfSelfNodeId } from '@/renderer/lib/meshtasticMqttIdentity';
import {
  loadMeshtasticMqttManualChannelPsks,
  resolveMeshtasticMqttPublishFieldsForChannel,
  type ResolveMeshtasticMqttPublishOptions,
} from '@/renderer/lib/meshtasticMqttPublish';
import { resolveMeshtasticTextMessagePayload } from '@/shared/meshtasticTextMessagePayload';
import type { MeshtasticLoraConfig } from '@/shared/meshtasticUrlEncoder';

import {
  meshtasticNodeLacksDisplayIdentity,
  meshtasticShortNameAfterClearingDefault,
  preferNonEmptyTrimmedString,
} from '../../../shared/nodeNameUtils';
import {
  meshtasticWireUint32AllowZero,
  meshtasticWireUint32NonZero,
} from '../../../shared/reactionEmoji';
import { setConnection } from '../../stores/connectionStore';
import { setMeshtasticConfigSlice } from '../../stores/deviceStore';
import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { updateIdentity } from '../../stores/identityStore';
import { useMessageStore } from '../../stores/messageStore';
import { usePositionHistoryStore } from '../../stores/positionHistoryStore';
import { MAX_IN_MEMORY_CHAT_MESSAGES, trimChatMessagesToMax } from '../chatInMemoryBuffer';
import { safeDisconnect } from '../connection';
import { validateCoords } from '../coordUtils';
import { connectionDriver } from '../drivers/ConnectionDriver';
import { isForeignLoraLogCandidate } from '../foreignLoraDetection';
import type { OurPosition } from '../gpsSource';
import { shouldPreserveStaticGpsForSelfNode } from '../gpsSource';
import { meshtasticHwModelName } from '../hardwareModels';
import { attachMeshtasticIngest, type MeshtasticIngestSession } from '../ingest/meshtasticIngest';
import { bindMeshtasticIngress, meshtasticTransportParams } from '../meshIdentityBridge';
import { setMeshtasticConnectedMyNodeNum } from '../meshtasticConnectedNodeRef';
import {
  computeNodeInfoLastHeardMs,
  mergeMeshtasticLivePacketLastHeard,
  mergeMeshtasticUserPacketLastHeard,
  meshtasticPacketRxTimeMs,
  meshtasticTracerouteLastHeardNodeIds,
} from '../meshtasticLastHeard';
import {
  findMeshtasticCrossTransportDuplicate,
  mapMeshtasticCrossTransportUpgrade,
  meshtasticPacketIdsEqual,
  normalizeMeshtasticPacketId,
} from '../meshtasticMessageDedup';
import type { MeshtasticRemoteAdminClient } from '../meshtasticRemoteAdmin';
import { meshtasticComputedRfHopsAway } from '../meshtasticRfHops';
import {
  mergeMeshtasticTraceRouteIntoResultsMap,
  meshtasticTraceRouteLookupKeys,
} from '../meshtasticTraceRouteLookupKeys';
import { parseStoredJson } from '../parseStoredJson';
import { MESHTASTIC_CAPABILITIES } from '../radio/BaseRadioProvider';
import {
  MAX_RAW_PACKET_LOG_ENTRIES,
  type MeshtasticRawPacketEntry,
} from '../rawPacketLogConstants';
import { normalizeReactionEmoji } from '../reactions';
import { enrichMeshtasticReplyPreviews } from '../replyPreview';
import { LAST_SERIAL_PORT_KEY } from '../serialPortSignature';
import { getStoredMeshProtocol } from '../storedMeshProtocol';
import { messageRecordsToChatMessages } from '../storeRecordAdapters';
import {
  MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS,
  MESHTASTIC_LOCAL_LORA_CONFIG_DELAY_MS,
} from '../timeConstants';
import type {
  ChatMessage,
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
import { pushMeshtasticTransportSideEffectUnsubs } from './meshtasticLegacyDeviceEvents';
import { shouldFetchLocalLoraConfigAfterConfigure } from './meshtasticLocalLoraConfig';
import type { MeshtasticMqttClientProxyBridge } from './meshtasticMqttClientProxy';

const MAX_TELEMETRY_POINTS = 50;
const BROADCAST_ADDR = 0xffffffff;
const REQUEST_NODEINFO_MIN_INTERVAL_MS = 120_000;
const { PortNum } = Portnums;
const { DeviceStatusEnum } = Types;

function isMeshtasticTraceroutePortnum(portnum: unknown): boolean {
  return Number(portnum) === Portnums.PortNum.TRACEROUTE_APP;
}

function meshtasticPublicKeyHex(bytes: Uint8Array | undefined): string | undefined {
  if (bytes?.length !== 32) return undefined;
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function meshtasticRawPacketPortLabel(packet: unknown): string {
  const p = packet as {
    payloadVariant?: { case?: string; value?: { portnum?: number } };
  };
  const variant = p.payloadVariant?.case;
  if (variant === 'decoded') {
    const portnum = p.payloadVariant?.value?.portnum;
    if (typeof portnum === 'number') {
      const found = Object.entries(Portnums.PortNum).find(([, v]) => v === portnum);
      return found ? found[0] : `PORT_${portnum}`;
    }
    return 'decoded';
  }
  if (variant === 'encrypted') return 'encrypted';
  return variant ?? '?';
}

function meshtasticMqttPublishOpts(
  mqttOnly: boolean,
): ResolveMeshtasticMqttPublishOptions | undefined {
  return mqttOnly ? { preferManualOverRadio: true } : undefined;
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

const ROLE_CLIENT_MUTE = 1;

export interface MeshtasticLegacyWireSubscriptionDeps {
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
  messagesRef: RefObject<ChatMessage[]>;
  mqttClientProxyBridgeRef: RefObject<MeshtasticMqttClientProxyBridge | null>;
  mqttStatusRef: RefObject<MQTTStatus>;
  myNodeNumRef: RefObject<number>;
  nodesRef: RefObject<Map<number, MeshNode>>;
  pendingTempIdRef: RefObject<number | undefined>;
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
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setTelemetry: Dispatch<SetStateAction<TelemetryPoint[]>>;
  setSignalTelemetry: Dispatch<SetStateAction<TelemetryPoint[]>>;
  setEnvironmentTelemetry: Dispatch<SetStateAction<EnvironmentTelemetryPoint[]>>;
  setDeviceOwner: Dispatch<
    SetStateAction<{ longName: string; shortName: string; isLicensed: boolean } | null>
  >;
  setChannels: Dispatch<SetStateAction<{ index: number; name: string }[]>>;
  setChannelConfigs: Dispatch<
    SetStateAction<
      {
        index: number;
        name: string;
        role: number;
        psk: Uint8Array;
        uplinkEnabled: boolean;
        downlinkEnabled: boolean;
        positionPrecision: number;
      }[]
    >
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
  setDetectionSensorEvents: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }[]>>
  >;
  setPingResponses: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }>>
  >;
  setIpTunnelMessages: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }[]>>
  >;
  setPaxCounterData: Dispatch<
    SetStateAction<Map<number, { from: number; count: number; timestamp: number }>>
  >;
  setSerialMessages: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }[]>>
  >;
  setStoreForwardMessages: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }[]>>
  >;
  setRangeTestPackets: Dispatch<
    SetStateAction<Map<number, { from: number; data: Uint8Array; timestamp: number }[]>>
  >;
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

export function attachMeshtasticLegacyWireSubscriptions(
  device: MeshDevice,
  type: ConnectionType,
  opts: { driverIdentityId?: string } | undefined,
  deps: MeshtasticLegacyWireSubscriptionDeps,
): void {
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
    messagesRef,
    mqttClientProxyBridgeRef,
    mqttStatusRef,
    myNodeNumRef,
    nodesRef,
    pendingTempIdRef,
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
    setMessages,
    setTelemetry,
    setSignalTelemetry,
    setEnvironmentTelemetry,
    setDeviceOwner,
    setChannels,
    setChannelConfigs,
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

  // Protocol ingress → identity-scoped stores (before legacy handlers so both
  // receive SDK events when the transport supports multiple subscribers).
  // Legacy handlers below are still required for MQTT, watchdog, etc.
  // Legacy side effects until all Meshtastic listeners are protocol events (#375 / #377).
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
    const ingress = bindMeshtasticIngress(device, type, {
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
    const statusMap: Record<number, DeviceState['status']> = {
      [DeviceStatusEnum.DeviceRestarting]: 'connecting',
      [DeviceStatusEnum.DeviceDisconnected]: 'disconnected',
      [DeviceStatusEnum.DeviceConnecting]: 'connecting',
      [DeviceStatusEnum.DeviceReconnecting]: 'connecting',
      [DeviceStatusEnum.DeviceConnected]: 'connected',
      [DeviceStatusEnum.DeviceConfiguring]: 'connecting',
      [DeviceStatusEnum.DeviceConfigured]: 'configured',
    };
    const mapped = statusMap[status] ?? 'connected';
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
        }, 30000);
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
      void refreshOurPositionRef.current();
      startGpsInterval();
      setQueueStatus({ free: 16, maxlen: 16, res: 0 });
      deviceConfiguredRef.current = true;
      mqttClientProxyBridgeRef.current?.flushPendingToDevice();
      const myNode = myNodeNumRef.current;
      if (myNode > 0) {
        const requestMetadataAfterConfigure = (attempt: 1 | 2): void => {
          void device.getMetadata(myNode).catch((e: unknown) => {
            console.debug(
              '[useMeshtasticRuntime] getMetadata after configure failed ' +
                errLikeToLogString(e) +
                (attempt === 2 ? ' (retry)' : ''),
            );
            if (attempt === 1) {
              setTimeout(() => {
                requestMetadataAfterConfigure(2);
              }, MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS);
            }
          });
        };
        requestMetadataAfterConfigure(1);
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
      } else {
        const selfNode: MeshNode = {
          ...existing,
          hops_away: 0,
          source: 'rf',
          heard_via_mqtt_only: false,
        };
        updated.set(info.myNodeNum, selfNode);
        void window.electronAPI.db.saveNode(selfNode);
      }
      return updated;
    });
  });
  unsubscribesRef.current.push(unsub2);

  // ─── Device metadata (firmware version) ────────────────────
  const unsub_meta = device.events.onDeviceMetadataPacket.subscribe((packet) => {
    const data = packet.data as {
      firmwareVersion?: string;
      hasWifi?: boolean;
      hasEthernet?: boolean;
    };
    if (data.firmwareVersion) {
      setState((s) => ({ ...s, firmwareVersion: data.firmwareVersion }));
    }
    const identityId = meshtasticIdentityIdRef.current;
    if (identityId && (data.hasWifi != null || data.hasEthernet != null)) {
      setConnection(identityId, {
        ...(data.hasWifi != null ? { deviceHasWifi: data.hasWifi } : {}),
        ...(data.hasEthernet != null ? { deviceHasEthernet: data.hasEthernet } : {}),
      });
    }
  });
  unsubscribesRef.current.push(unsub_meta);

  const maybeRequestNodeInfoForNode = (from: number): void => {
    if (from === 0 || from === myNodeNumRef.current) return;
    if (isConfiguringRef.current) return;
    const existing = nodesRef.current.get(from);
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

  // ─── Text messages ─────────────────────────────────────────
  const unsub3 = device.events.onMeshPacket.subscribe((meshPacket) => {
    if (meshPacket.payloadVariant.case !== 'decoded') {
      return;
    }
    const dataPacket = meshPacket.payloadVariant.value;
    if (dataPacket.portnum !== PortNum.TEXT_MESSAGE_APP) return;

    ensureNodeExists(meshPacket.from, 'rf');
    maybeRequestNodeInfoForNode(meshPacket.from);

    // Bump last_heard for the sender on live (non-replay) packets.
    if (!isConfiguringRef.current && meshPacket.from) {
      updateNodes((prev) => {
        const existing = prev.get(meshPacket.from);
        if (!existing) return prev;
        const now = mergeMeshtasticLivePacketLastHeard(
          existing.last_heard || 0,
          meshtasticPacketRxTimeMs(meshPacket.rxTime),
          false,
        );
        if (now <= (existing.last_heard || 0)) return prev;
        const next = new Map(prev);
        const updated: MeshNode = {
          ...existing,
          last_heard: now,
          source: 'rf',
          heard_via_mqtt_only: false,
          via_mqtt: meshPacket.viaMqtt ?? false,
        };
        next.set(meshPacket.from, updated);
        void window.electronAPI.db.saveNode(updated);
        return next;
      });
    }

    touchLastData();
    const isEcho = meshPacket.from === myNodeNumRef.current;
    const payloadBytes = dataPacket.payload ?? new Uint8Array();
    const resolvedText = resolveMeshtasticTextMessagePayload(payloadBytes);
    if (!resolvedText) {
      console.debug(
        `[useMeshtasticRuntime] Dropped non-readable TEXT_MESSAGE from 0x${meshPacket.from.toString(16)} len=${payloadBytes.length}`,
      );
      return;
    }
    let payloadText = resolvedText.text;
    const data = dataPacket as { replyId?: number; reply_id?: number; emoji?: number };

    const replyId = meshtasticWireUint32NonZero(data.replyId ?? data.reply_id);
    const wireEmoji = meshtasticWireUint32NonZero(data.emoji);

    if (payloadText.trim() === '0' && !replyId && !wireEmoji) {
      // Strip leading "0" payloads that are just a placeholder from buggy senders
      payloadText = '';
    }

    const emoji = replyId ? normalizeReactionEmoji(wireEmoji, payloadText) : undefined;

    const packetIdCoerced = meshtasticWireUint32AllowZero(meshPacket.id);

    const incomingRxHops = !isEcho ? meshtasticComputedRfHopsAway(meshPacket) : undefined;

    const msgBase: ChatMessage = {
      sender_id: meshPacket.from,
      sender_name: getNodeName(meshPacket.from),
      payload: payloadText,
      channel: meshPacket.channel ?? 0,
      timestamp: meshPacket.rxTime ? meshPacket.rxTime * 1000 : Date.now(),
      packetId: packetIdCoerced,
      status: isEcho ? 'sending' : undefined,
      emoji,
      replyId,
      to: meshPacket.to && meshPacket.to !== BROADCAST_ADDR ? meshPacket.to : undefined,
      ...(incomingRxHops !== undefined ? { rxHops: incomingRxHops } : {}),
      ...(resolvedText.viaStoreForward ? { viaStoreForward: true } : {}),
    };
    const msg = enrichMeshtasticReplyPreviews(msgBase, messagesRef.current, getNodeName);
    const chatInStore = Boolean(meshtasticIdentityIdRef.current);

    // Packet ID dedup: skip if already seen (e.g. via MQTT) so same message is not shown twice
    if (!isEcho && !msg.emoji && msg.packetId && isDuplicate(meshPacket.from, msg.packetId)) {
      if (!chatInStore) {
        const rfDedupPacketId = msg.packetId;
        const rfDedupHops = meshtasticComputedRfHopsAway(meshPacket);
        setMessages((prev) =>
          prev.map((m) =>
            meshtasticPacketIdsEqual(m.packetId, rfDedupPacketId) && m.receivedVia === 'mqtt'
              ? {
                  ...m,
                  receivedVia: 'both' as const,
                  rxHops: m.rxHops ?? rfDedupHops,
                  packetId: rfDedupPacketId,
                }
              : m,
          ),
        );
      }
      return;
    }

    // If we have an optimistic message in state for this send, skip the echo to avoid a duplicate
    if (isEcho && pendingTempIdRef.current !== undefined) {
      pendingTempIdRef.current = undefined;
      return;
    }

    const rfMsg: ChatMessage = isEcho
      ? msg
      : {
          ...msg,
          receivedVia: 'rf' as const,
          isHistory: isConfiguringRef.current || undefined,
        };

    if (!chatInStore && !isEcho && !rfMsg.emoji) {
      const storeId = meshtasticIdentityIdRef.current;
      const storeMsgs = storeId
        ? messageRecordsToChatMessages(
            Object.values(useMessageStore.getState().messages[storeId] ?? {}),
          )
        : [];
      const dedupSource = storeMsgs.length > 0 ? storeMsgs : messagesRef.current;
      const crossDup = findMeshtasticCrossTransportDuplicate(dedupSource, rfMsg);
      if (crossDup) {
        const rfDedupHops = meshtasticComputedRfHopsAway(meshPacket);
        setMessages((prev) => {
          const { messages: next, matched } = mapMeshtasticCrossTransportUpgrade(prev, {
            ...rfMsg,
            rxHops: rfMsg.rxHops ?? rfDedupHops,
          });
          if (!matched) return prev;
          return next;
        });
        const pid =
          rfMsg.packetId !== undefined && rfMsg.packetId !== 0
            ? rfMsg.packetId
            : normalizeMeshtasticPacketId(crossDup.packetId);
        if (pid !== undefined && pid !== 0) {
          isDuplicate(rfMsg.sender_id, pid); // registers as seen to suppress future duplicates
        }
        return;
      }
    }

    if (!chatInStore) {
      setMessages((prev) => {
        // Dedup reaction retransmissions before the DB write completes
        if (rfMsg.emoji && rfMsg.replyId) {
          const isDup = prev.some(
            (m) =>
              m.emoji === rfMsg.emoji &&
              m.replyId === rfMsg.replyId &&
              m.sender_id === rfMsg.sender_id,
          );
          if (isDup) return prev;
        }
        // Dedup regular messages by packetId (e.g. device config-sync replay)
        if (!rfMsg.emoji && rfMsg.packetId && prev.some((m) => m.packetId === rfMsg.packetId)) {
          return prev;
        }
        return trimChatMessagesToMax([...prev, rfMsg], MAX_IN_MEMORY_CHAT_MESSAGES);
      });
    }

    // Gateway uplink: forward RF messages to MQTT if uplinkEnabled for this channel
    // Skip our own echoes, reactions, and DMs (privacy)
    if (!isEcho && !emoji && !msg.to && mqttStatusRef.current === 'connected') {
      const chCfg = channelConfigsRef.current.find((c) => c.index === msg.channel);
      if (chCfg?.uplinkEnabled) {
        const uplinkMqtt = resolveMeshtasticMqttPublishFieldsForChannel(
          msg.channel,
          channelConfigsRef.current,
          loadMeshtasticMqttManualChannelPsks(),
          meshtasticMqttPublishOpts(!deviceRef.current),
        );
        if (uplinkMqtt.channelName) {
          window.electronAPI.mqtt
            .publish({
              text: msg.payload,
              from: msg.sender_id,
              channel: msg.channel,
              destination: BROADCAST_ADDR,
              channelName: uplinkMqtt.channelName,
              pskBase64: uplinkMqtt.pskBase64,
              publishJsonMirror: uplinkMqtt.publishJsonMirror,
            })
            .then((packetId) => {
              isDuplicate(msg.sender_id, packetId);
            })
            .catch((e: unknown) => {
              console.debug(
                '[useMeshtasticRuntime] MQTT publish echo register non-fatal ' +
                  errLikeToLogString(e),
              );
            });
        }
      }
    }

    // Desktop notification for incoming messages when app is not focused
    if (!isEcho && !emoji && document.hidden) {
      try {
        const title = msg.to ? `DM from ${msg.sender_name}` : `Message from ${msg.sender_name}`;
        new Notification(title, {
          body: msg.payload.slice(0, 100),
          silent: false,
        });
      } catch (e) {
        console.debug('[useMeshtasticRuntime] Notification not available ' + errLikeToLogString(e));
      }
    }
  });
  unsubscribesRef.current.push(unsub3);

  // ─── User info (node identity) ─────────────────────────────
  const unsub4 = device.events.onUserPacket.subscribe((packet) => {
    touchLastData();
    rfHeardNodeIds.current.add(packet.from);
    const user = packet.data as {
      id?: string;
      longName?: string;
      shortName?: string;
      hwModel?: number;
      role?: number;
      publicKey?: Uint8Array;
    };
    const packetRxMs = meshtasticPacketRxTimeMs(packet.rxTime);
    updateNodes((prev) => {
      const updated = new Map(prev);
      const existing = updated.get(packet.from) ?? emptyNode(packet.from);
      const long_name = preferNonEmptyTrimmedString(user.longName, existing.long_name, {
        nodeId: packet.from,
      });
      const short_name = meshtasticShortNameAfterClearingDefault(
        long_name,
        preferNonEmptyTrimmedString(user.shortName, existing.short_name),
        packet.from,
      );
      const last_heard = mergeMeshtasticUserPacketLastHeard(
        existing.last_heard || 0,
        packetRxMs,
        isConfiguringRef.current,
      );
      const public_key_hex = meshtasticPublicKeyHex(user.publicKey) ?? existing.public_key_hex;
      const node: MeshNode = {
        ...existing,
        node_id: packet.from,
        long_name,
        short_name,
        hw_model: user.hwModel != null ? meshtasticHwModelName(user.hwModel) : existing.hw_model,
        role: user.role ?? existing.role,
        public_key_hex,
        // During configure, skip rxTime bumps (NodeDB replay). After configure, use mesh rxTime.
        last_heard,
        heard_via_mqtt_only: false,
        via_mqtt: false,
        source: 'rf',
      };
      updated.set(packet.from, node);
      void window.electronAPI.db.saveNode(node);
      return updated;
    });
    if (packet.from === myNodeNumRef.current) {
      setDeviceOwner({
        longName: preferNonEmptyTrimmedString(user.longName, ''),
        shortName: preferNonEmptyTrimmedString(user.shortName, ''),
        isLicensed: (user as { isLicensed?: boolean }).isLicensed ?? false,
      });
    }
  });
  unsubscribesRef.current.push(unsub4);

  // ─── Node info packets ─────────────────────────────────────
  const unsub5 = device.events.onNodeInfoPacket.subscribe((packet) => {
    touchLastData();
    const rfPayload = packet as { num?: number; from?: number };
    const rfNodeId = rfPayload.num ?? rfPayload.from;
    if (rfNodeId != null) rfHeardNodeIds.current.add(rfNodeId);
    const info = packet as {
      num?: number;
      user?: {
        longName?: string;
        shortName?: string;
        hwModel?: number;
        role?: number;
      };
      snr?: number;
      position?: { latitudeI?: number; longitudeI?: number; altitude?: number };
      deviceMetrics?: {
        batteryLevel?: number;
        voltage?: number;
        channelUtilization?: number;
        airUtilTx?: number;
      };
      lastHeard?: number;
      hopsAway?: number;
      viaMqtt?: boolean;
    };
    if (!info.num) return;
    const nodeNum = info.num;
    const prevOwnRole =
      nodeNum === myNodeNumRef.current ? nodesRef.current.get(nodeNum)?.role : undefined;

    updateNodes((prev) => {
      const updated = new Map(prev);
      const existing = updated.get(nodeNum) ?? emptyNode(nodeNum);

      let newLat = existing.latitude;
      let newLon = existing.longitude;
      let newAlt = info.position?.altitude ?? existing.altitude;
      let posWarn: string | undefined = existing.lastPositionWarning;

      if (
        info.position?.latitudeI != null &&
        info.position?.longitudeI != null &&
        !shouldPreserveStaticGpsForSelfNode(nodeNum, myNodeNumRef.current)
      ) {
        const lat = info.position.latitudeI / 1e7;
        const lon = info.position.longitudeI / 1e7;
        const r = validateCoords(lat, lon);
        if (r.valid) {
          newLat = lat;
          newLon = lon;
          newAlt = info.position?.altitude ?? existing.altitude;
          posWarn = undefined;
        } else if (
          nodeNum !== myNodeNumRef.current ||
          (existing.latitude === 0 && existing.longitude === 0)
        ) {
          posWarn = r.warning;
        }
      }

      const lastHeardMs = computeNodeInfoLastHeardMs(
        info.lastHeard,
        existing.last_heard,
        nodeNum === myNodeNumRef.current,
      );
      const lastHeardStale =
        lastHeardMs > 0 && Date.now() - lastHeardMs > MESHTASTIC_CAPABILITIES.nodeStaleThresholdMs;

      const long_name = preferNonEmptyTrimmedString(info.user?.longName, existing.long_name, {
        nodeId: nodeNum,
      });
      const short_name = meshtasticShortNameAfterClearingDefault(
        long_name,
        preferNonEmptyTrimmedString(info.user?.shortName, existing.short_name),
        nodeNum,
      );
      const node: MeshNode = {
        ...existing,
        node_id: nodeNum,
        long_name,
        short_name,
        hw_model:
          info.user?.hwModel != null ? meshtasticHwModelName(info.user.hwModel) : existing.hw_model,
        snr: info.snr ?? existing.snr,
        battery: info.deviceMetrics?.batteryLevel ?? existing.battery,
        last_heard: lastHeardMs,
        latitude: newLat,
        longitude: newLon,
        role: info.user?.role ?? existing.role,
        // Stale NodeInfo still carries cached hops; don't show hop count for ghosts.
        hops_away:
          nodeNum === myNodeNumRef.current
            ? (info.hopsAway ?? 0)
            : lastHeardStale
              ? undefined
              : (info.hopsAway ?? existing.hops_away),
        via_mqtt: info.viaMqtt ?? false,
        voltage: info.deviceMetrics?.voltage ?? existing.voltage,
        channel_utilization: info.deviceMetrics?.channelUtilization ?? existing.channel_utilization,
        air_util_tx: info.deviceMetrics?.airUtilTx ?? existing.air_util_tx,
        altitude: newAlt,
        heard_via_mqtt_only: false,
        source: 'rf',
        lastPositionWarning: posWarn,
      };
      updated.set(nodeNum, node);
      void window.electronAPI.db.saveNode(node);
      return updated;
    });
    if (nodeNum === myNodeNumRef.current && info.deviceMetrics?.batteryLevel !== undefined) {
      applyOwnNodeBatteryFromDeviceMetrics(info.deviceMetrics.batteryLevel);
    }
    if (
      nodeNum === myNodeNumRef.current &&
      nodesRef.current.get(nodeNum)?.role === ROLE_CLIENT_MUTE &&
      prevOwnRole !== ROLE_CLIENT_MUTE
    ) {
      console.info(
        '[useMeshtasticRuntime] Device role is Client Mute — position reports to device suppressed',
      );
    }
    const updatedRfNode = nodesRef.current.get(nodeNum);
    if (updatedRfNode && getStoredMeshProtocol() === 'meshtastic') {
      useDiagnosticsStore
        .getState()
        .processNodeUpdate(
          updatedRfNode,
          nodesRef.current.get(myNodeNumRef.current) ?? null,
          myNodeNumRef.current,
          MESHTASTIC_CAPABILITIES,
        );
    }
    if (info.position?.latitudeI != null && info.position?.longitudeI != null) {
      const lat = info.position.latitudeI / 1e7;
      const lon = info.position.longitudeI / 1e7;
      if (validateCoords(lat, lon).valid) {
        usePositionHistoryStore.getState().recordPosition(nodeNum, lat, lon);
      }
    }
    if (type === 'ble' && nodeNum === myNodeNumRef.current) {
      const btDevice = (device.transport as { __bluetoothDevice?: { id?: string } })
        ?.__bluetoothDevice;
      const shortName = preferNonEmptyTrimmedString(info.user?.shortName, '') || null;
      if (btDevice?.id && shortName) {
        try {
          const key = 'mesh-client:bleDeviceNames';
          const cache =
            parseStoredJson<Record<string, string>>(
              localStorage.getItem(key),
              'useMeshtasticRuntime bleDeviceNames cache',
            ) ?? {};
          cache[btDevice.id] = shortName;
          localStorage.setItem(key, JSON.stringify(cache));
        } catch {
          // catch-no-log-ok localStorage write for BLE device name cache — non-critical
        }
      }
    }
    if (type === 'serial' && nodeNum === myNodeNumRef.current) {
      const portId = localStorage.getItem(LAST_SERIAL_PORT_KEY);
      const shortName =
        preferNonEmptyTrimmedString(
          info.user?.shortName,
          preferNonEmptyTrimmedString(info.user?.longName, ''),
        ) || null;
      if (portId && shortName) {
        try {
          const key = 'mesh-client:serialPortNodeNames';
          const cache =
            parseStoredJson<Record<string, string>>(
              localStorage.getItem(key),
              'useMeshtasticRuntime serialPortNodeNames cache',
            ) ?? {};
          cache[portId] = shortName;
          localStorage.setItem(key, JSON.stringify(cache));
        } catch {
          // catch-no-log-ok localStorage write for serial port node name cache — non-critical
        }
      }
    }
  });
  unsubscribesRef.current.push(unsub5);

  // ─── Position packets ──────────────────────────────────────
  const unsub6 = device.events.onPositionPacket.subscribe((packet) => {
    touchLastData();
    if (packet.from !== 0) {
      rfHeardNodeIds.current.add(packet.from);
    }
    const pos = packet.data as {
      latitudeI?: number;
      longitudeI?: number;
      altitude?: number;
    };

    const lat = (pos.latitudeI ?? 0) / 1e7;
    const lon = (pos.longitudeI ?? 0) / 1e7;
    const r = validateCoords(lat, lon);

    if (!r.valid) {
      updateNodes((prev) => {
        const updated = new Map(prev);
        const existing = updated.get(packet.from) ?? emptyNode(packet.from);
        // Don't flag our own node if we have valid fallback coords
        if (
          packet.from === myNodeNumRef.current &&
          (existing.latitude != null || existing.longitude != null)
        ) {
          return prev; // no change
        }
        updated.set(packet.from, {
          ...existing,
          lastPositionWarning: r.warning,
          last_heard: mergeMeshtasticLivePacketLastHeard(
            existing.last_heard || 0,
            Date.now(),
            isConfiguringRef.current,
          ),
        });
        return updated;
      });
      return;
    }

    if (shouldPreserveStaticGpsForSelfNode(packet.from, myNodeNumRef.current)) {
      return;
    }

    const homeNode = nodesRef.current.get(myNodeNumRef.current) ?? null;
    const existing = nodesRef.current.get(packet.from) ?? emptyNode(packet.from);
    const node: MeshNode = {
      ...existing,
      latitude: lat,
      longitude: lon,
      altitude: pos.altitude ?? existing.altitude,
      // Position replays at connect must not bump last_heard (configure guard).
      last_heard: mergeMeshtasticLivePacketLastHeard(
        existing.last_heard || 0,
        meshtasticPacketRxTimeMs(packet.rxTime),
        isConfiguringRef.current,
      ),
      lastPositionWarning: undefined,
      source: 'rf',
      heard_via_mqtt_only: false,
      via_mqtt: false,
    };
    updateNodes((prev) => {
      const updated = new Map(prev);
      updated.set(packet.from, node);
      void window.electronAPI.db.saveNode(node);
      return updated;
    });
    if (getStoredMeshProtocol() === 'meshtastic') {
      useDiagnosticsStore
        .getState()
        .processNodeUpdate(node, homeNode, myNodeNumRef.current, MESHTASTIC_CAPABILITIES);
    }
    usePositionHistoryStore.getState().recordPosition(packet.from, lat, lon);
    maybeRequestNodeInfoForNode(packet.from);
  });
  unsubscribesRef.current.push(unsub6);

  // ─── Telemetry ─────────────────────────────────────────────
  const unsub7 = device.events.onTelemetryPacket.subscribe((packet) => {
    touchLastData();
    const tel = packet.data as {
      deviceMetrics?: { batteryLevel?: number; voltage?: number };
      variant?: {
        case?: string;
        value?: {
          batteryLevel?: number;
          voltage?: number;
          channelUtilization?: number;
          airUtilTx?: number;
          numPacketsRxBad?: number;
          numRxDupe?: number;
          numPacketsRx?: number;
          numPacketsTx?: number;
          // environmentMetrics fields
          temperature?: number;
          relativeHumidity?: number;
          barometricPressure?: number;
          gasResistance?: number;
          iaq?: number;
          lux?: number;
          windSpeed?: number;
          windDirection?: number;
          windGust?: number;
          windLull?: number;
          weight?: number;
          rainfall1h?: number;
          rainfall24h?: number;
        };
      };
    };

    // Handle environmentMetrics variant
    if (tel.variant?.case === 'environmentMetrics' && tel.variant.value) {
      const env = tel.variant.value;
      const point: EnvironmentTelemetryPoint = {
        timestamp: Date.now(),
        nodeNum: packet.from,
        temperature: env.temperature,
        relativeHumidity: env.relativeHumidity,
        barometricPressure: env.barometricPressure,
        gasResistance: env.gasResistance,
        iaq: env.iaq,
        lux: env.lux,
        windSpeed: env.windSpeed,
        windDirection: env.windDirection,
        windGust: env.windGust,
        windLull: env.windLull,
        weight: env.weight,
        rainfall1h: env.rainfall1h,
        rainfall24h: env.rainfall24h,
      };
      setEnvironmentTelemetry((prev) => [...prev, point].slice(-MAX_TELEMETRY_POINTS));
      updateNodes((prev) => {
        const updated = new Map(prev);
        const existing = updated.get(packet.from);
        if (existing) {
          updated.set(packet.from, {
            ...existing,
            env_temperature: env.temperature ?? existing.env_temperature,
            env_humidity: env.relativeHumidity ?? existing.env_humidity,
            env_pressure: env.barometricPressure ?? existing.env_pressure,
            env_iaq: env.iaq ?? existing.env_iaq,
            env_lux: env.lux ?? existing.env_lux,
            env_wind_speed: env.windSpeed ?? existing.env_wind_speed,
            env_wind_direction: env.windDirection ?? existing.env_wind_direction,
            last_heard: mergeMeshtasticLivePacketLastHeard(
              existing.last_heard || 0,
              meshtasticPacketRxTimeMs(packet.rxTime),
              isConfiguringRef.current,
            ),
            source: 'rf',
            heard_via_mqtt_only: false,
            via_mqtt: false,
          });
        }
        return updated;
      });
      return;
    }

    // Handle localStats variant (connected node's radio statistics)
    if (
      tel.variant?.case === 'localStats' &&
      tel.variant.value &&
      packet.from === myNodeNumRef.current
    ) {
      const ls = tel.variant.value;
      updateNodes((prev) => {
        const updated = new Map(prev);
        const existing = updated.get(myNodeNumRef.current);
        if (existing) {
          const node: MeshNode = {
            ...existing,
            channel_utilization: ls.channelUtilization ?? existing.channel_utilization,
            air_util_tx: ls.airUtilTx ?? existing.air_util_tx,
            num_packets_rx_bad: ls.numPacketsRxBad ?? existing.num_packets_rx_bad,
            num_rx_dupe: ls.numRxDupe ?? existing.num_rx_dupe,
            num_packets_rx: ls.numPacketsRx ?? existing.num_packets_rx,
            num_packets_tx: ls.numPacketsTx ?? existing.num_packets_tx,
            source: 'rf',
            heard_via_mqtt_only: false,
            via_mqtt: false,
          };
          updated.set(myNodeNumRef.current, node);
          void window.electronAPI.db.saveNode(node);
        }
        return updated;
      });
      return;
    }

    const metrics = tel.deviceMetrics ?? tel.variant?.value;
    if (!metrics) return;

    const point: TelemetryPoint = {
      timestamp: Date.now(),
      batteryLevel: metrics.batteryLevel,
      voltage: metrics.voltage,
    };
    setTelemetry((prev) => [...prev, point].slice(-MAX_TELEMETRY_POINTS));

    // Update node battery if from a known node
    if (metrics.batteryLevel != null && packet.from) {
      ensureNodeExists(packet.from, 'rf');
      const existing = nodesRef.current.get(packet.from);
      if (existing) {
        const node: MeshNode = {
          ...existing,
          battery: metrics.batteryLevel,
          last_heard: mergeMeshtasticLivePacketLastHeard(
            existing.last_heard || 0,
            meshtasticPacketRxTimeMs(packet.rxTime),
            isConfiguringRef.current,
          ),
          source: 'rf',
          heard_via_mqtt_only: false,
          via_mqtt: false,
        };
        updateNodes((prev) => {
          const updated = new Map(prev);
          updated.set(packet.from, node);
          return updated;
        });
        if (getStoredMeshProtocol() === 'meshtastic') {
          useDiagnosticsStore
            .getState()
            .processNodeUpdate(
              node,
              nodesRef.current.get(myNodeNumRef.current) ?? null,
              myNodeNumRef.current,
              MESHTASTIC_CAPABILITIES,
            );
        }
      }
      maybeRequestNodeInfoForNode(packet.from);
      if (packet.from === myNodeNumRef.current) {
        applyOwnNodeBatteryFromDeviceMetrics(metrics.batteryLevel);
      }
    }
  });
  unsubscribesRef.current.push(unsub7);

  // ─── Channel discovery ─────────────────────────────────────
  const unsub8 = device.events.onChannelPacket.subscribe((channel) => {
    touchLastData();
    const ch = channel as {
      index?: number;
      settings?: {
        name?: string;
        psk?: Uint8Array;
        uplinkEnabled?: boolean;
        downlinkEnabled?: boolean;
        moduleSettings?: { positionPrecision?: number };
      };
      role?: number;
    };
    if (ch.index === undefined) return;

    // Update simple channels list for chat pill selector (skip disabled)
    if (ch.role !== 0) {
      setChannels((prev) => {
        const existing = prev.findIndex((c) => c.index === ch.index);
        const entry = {
          index: ch.index!,
          name: ch.settings?.name || (ch.index === 0 ? 'Primary' : `Channel ${ch.index}`),
        };
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = entry;
          return updated;
        }
        return [...prev, entry].sort((a, b) => a.index - b.index);
      });
    }

    // Update full channel configs for config panel (includes disabled)
    setChannelConfigs((prev) => {
      const existing = prev.findIndex((c) => c.index === ch.index);
      const entry = {
        index: ch.index!,
        name: ch.settings?.name || '',
        role: ch.role ?? 0,
        psk: ch.settings?.psk ?? new Uint8Array([1]),
        uplinkEnabled: ch.settings?.uplinkEnabled ?? false,
        downlinkEnabled: ch.settings?.downlinkEnabled ?? false,
        positionPrecision: ch.settings?.moduleSettings?.positionPrecision ?? 0,
      };
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = entry;
        return updated;
      }
      return [...prev, entry].sort((a, b) => a.index - b.index);
    });
  });
  unsubscribesRef.current.push(unsub8);

  // ─── SNR/RSSI from mesh packets ────────────────────────────
  const unsub9 = device.events.onMeshPacket.subscribe((packet) => {
    touchLastData();
    const mp = packet as {
      id?: number;
      rxSnr?: number;
      rxRssi?: number;
      from?: number;
      hopLimit?: number;
      hopStart?: number;
      viaMqtt?: boolean;
    };
    if (getStoredMeshProtocol() === 'meshtastic' && mp.from) {
      try {
        const raw = toBinary(Mesh.MeshPacketSchema, packet as never);
        const portLabel = meshtasticRawPacketPortLabel(packet);
        const entry: MeshtasticRawPacketEntry = {
          ts: Date.now(),
          snr: mp.rxSnr ?? 0,
          rssi: mp.rxRssi ?? 0,
          raw,
          fromNodeId: mp.from,
          portLabel,
          viaMqtt: mp.viaMqtt === true,
          isLocal: mp.from === myNodeNumRef.current && !mp.viaMqtt && portLabel === 'TELEMETRY_APP',
        };
        setRawPackets((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_RAW_PACKET_LOG_ENTRIES
            ? next.slice(next.length - MAX_RAW_PACKET_LOG_ENTRIES)
            : next;
        });
      } catch (e) {
        console.debug(
          '[useMeshtasticRuntime] raw packet log entry failed ' + errLikeToLogString(e),
        );
      }

      // Record noisy portnums for diagnostics
      const decoded = packet.payloadVariant;
      if (decoded.case === 'decoded') {
        const portnum = decoded.value.portnum;
        if (typeof portnum === 'number') {
          useDiagnosticsStore.getState().recordNoisePort(mp.from, portnum);
        }
      }
    }

    if (!mp.from) return;

    const computedHopsAway = meshtasticComputedRfHopsAway(mp);

    // Record RF path for packet redundancy tracking (skip id 0 — protobuf: no unique id for no-ack/non-broadcast)
    const rawId = Number(mp.id);
    const packetId = rawId >>> 0;
    if (getStoredMeshProtocol() === 'meshtastic' && Number.isInteger(rawId) && packetId !== 0) {
      useDiagnosticsStore.getState().recordPacketPath(packetId, mp.from, {
        transport: 'rf',
        snr: mp.rxSnr,
        rssi: mp.rxRssi,
        timestamp: Date.now(),
      });
    }

    const hasSignal = Boolean(mp.rxSnr || mp.rxRssi);
    const hasHopUpdate = computedHopsAway !== undefined && mp.from !== myNodeNumRef.current;

    if (hasSignal || hasHopUpdate) {
      updateNodes((prev) => {
        const updated = new Map(prev);
        const existing = updated.get(mp.from!);
        if (existing) {
          const node: MeshNode = {
            ...existing,
            ...(mp.rxSnr ? { snr: mp.rxSnr } : {}),
            ...(mp.rxRssi ? { rssi: mp.rxRssi } : {}),
            ...(hasSignal
              ? {
                  last_heard: mergeMeshtasticLivePacketLastHeard(
                    existing.last_heard || 0,
                    Date.now(),
                    isConfiguringRef.current,
                  ),
                }
              : {}),
            ...(hasHopUpdate &&
            !(
              existing.last_heard > 0 &&
              Date.now() - existing.last_heard > MESHTASTIC_CAPABILITIES.nodeStaleThresholdMs
            )
              ? { hops_away: computedHopsAway }
              : {}),
            source: 'rf',
            heard_via_mqtt_only: false,
            via_mqtt: mp.viaMqtt ?? false,
          };
          updated.set(mp.from!, node);
          void window.electronAPI.db.saveNode(node);
        }
        return updated;
      });
    }

    if (mp.rxSnr || mp.rxRssi) {
      setSignalTelemetry((prev) =>
        [
          ...prev,
          {
            timestamp: Date.now(),
            snr: mp.rxSnr,
            rssi: mp.rxRssi,
          },
        ].slice(-MAX_TELEMETRY_POINTS),
      );
    }
  });
  unsubscribesRef.current.push(unsub9);

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

  // ─── Trace route responses (concurrent in-flight: pending per node + outbound packet id map)
  //     onMeshPacket reads Data; onTraceRoutePacket fallback (@meshtastic/core)
  const applyMeshtasticTracerouteReply = (
    meshFrom: number,
    rd: { route: readonly number[]; routeBack: readonly number[] },
    dataLayerDest: number | undefined,
    correlationIds?: {
      replyId?: number;
      requestId?: number;
    },
    dataLayerSource?: number,
    packetRxTimeMs?: number,
  ) => {
    const baseLookupKeys = meshtasticTraceRouteLookupKeys({
      from: meshFrom,
      data: { route: rd.route, routeBack: rd.routeBack },
      dataLayerDest,
      dataLayerSource,
    });
    let correlatedDest: number | undefined;
    if (correlationIds) {
      const tryIds: number[] = [];
      const r = correlationIds.replyId;
      const q = correlationIds.requestId;
      if (typeof r === 'number' && Number.isFinite(r) && r >>> 0 !== 0) {
        tryIds.push(r >>> 0);
      }
      if (typeof q === 'number' && Number.isFinite(q) && q >>> 0 !== 0) {
        tryIds.push(q >>> 0);
      }
      for (const id of tryIds) {
        const mapped = pendingTracePacketIdToTargetRef.current.get(id);
        if (mapped !== undefined) {
          correlatedDest = mapped >>> 0;
          pendingTracePacketIdToTargetRef.current.delete(id);
          break;
        }
      }
    }
    const correlatedAdditionalKeys =
      correlatedDest !== undefined ? [correlatedDest] : ([] as number[]);
    const lookupKeys = [...new Set([...baseLookupKeys, ...correlatedAdditionalKeys])];
    const mergeAdditionalKeys = correlatedAdditionalKeys;
    for (const key of lookupKeys) {
      pendingTraceRequestsRef.current.delete(key);
    }
    const cutoff = Date.now() - 2 * 60_000;
    for (const [target, startedAt] of pendingTraceRequestsRef.current) {
      if (startedAt < cutoff) pendingTraceRequestsRef.current.delete(target);
    }
    for (const [packetId, dest] of [...pendingTracePacketIdToTargetRef.current.entries()]) {
      if (!pendingTraceRequestsRef.current.has(dest)) {
        pendingTracePacketIdToTargetRef.current.delete(packetId);
      }
    }
    setTraceRouteResults((prev) =>
      mergeMeshtasticTraceRouteIntoResultsMap(
        prev,
        meshFrom,
        rd,
        dataLayerDest,
        mergeAdditionalKeys,
        dataLayerSource,
      ),
    );

    if (!isConfiguringRef.current) {
      const bumpIds = meshtasticTracerouteLastHeardNodeIds(meshFrom, correlatedDest);
      if (bumpIds.length > 0) {
        updateNodes((prev) => {
          const updated = new Map(prev);
          let changed = false;
          for (const nodeId of bumpIds) {
            const existing = updated.get(nodeId);
            if (!existing) continue;
            const last_heard = mergeMeshtasticLivePacketLastHeard(
              existing.last_heard || 0,
              packetRxTimeMs ?? 0,
              false,
            );
            if (last_heard <= (existing.last_heard || 0)) continue;
            const node: MeshNode = {
              ...existing,
              last_heard,
              source: 'rf',
              heard_via_mqtt_only: false,
              via_mqtt: false,
            };
            updated.set(nodeId, node);
            void window.electronAPI.db.saveNode(node);
            changed = true;
          }
          return changed ? updated : prev;
        });
      }
    }
  };

  const unsubTraceMesh = device.events.onMeshPacket.subscribe((meshPacket) => {
    if (meshPacket.payloadVariant.case !== 'decoded') return;
    const dataPacket = meshPacket.payloadVariant.value;
    if (!isMeshtasticTraceroutePortnum(dataPacket.portnum)) return;
    try {
      const rd = fromBinary(Mesh.RouteDiscoverySchema, dataPacket.payload) as unknown as {
        route: readonly number[];
        routeBack: readonly number[];
      };
      const rawDest = (dataPacket as { dest?: number }).dest;
      const dataLayerDest =
        typeof rawDest === 'number' && Number.isFinite(rawDest) ? rawDest : undefined;
      const rawSource = (dataPacket as { source?: number }).source;
      const dataLayerSource =
        typeof rawSource === 'number' && Number.isFinite(rawSource) ? rawSource : undefined;
      const dp = dataPacket as { requestId?: number; replyId?: number };
      const rawReply = dp.replyId;
      const rawReq = dp.requestId;
      applyMeshtasticTracerouteReply(
        meshPacket.from,
        rd,
        dataLayerDest,
        {
          replyId: typeof rawReply === 'number' && Number.isFinite(rawReply) ? rawReply : undefined,
          requestId: typeof rawReq === 'number' && Number.isFinite(rawReq) ? rawReq : undefined,
        },
        dataLayerSource,
        meshtasticPacketRxTimeMs(meshPacket.rxTime),
      );
    } catch {
      // catch-no-log-ok RouteDiscovery decode failed (non-traceroute payload on port)
    }
  });
  unsubscribesRef.current.push(unsubTraceMesh);

  const unsubTraceLegacy = device.events.onTraceRoutePacket.subscribe((packet) => {
    const rd = packet.data as unknown as {
      route: readonly number[];
      routeBack: readonly number[];
    };
    applyMeshtasticTracerouteReply(
      packet.from,
      rd,
      undefined,
      undefined,
      undefined,
      meshtasticPacketRxTimeMs(packet.rxTime),
    );
  });
  unsubscribesRef.current.push(unsubTraceLegacy);

  // Queue status → connectionStore via MeshtasticProtocol + PacketRouter (no legacy handler).

  // Device logs → deviceStore via protocol; legacy handler only for foreign LoRa parsing.
  const unsubLog = device.events.onLogRecord.subscribe((record) => {
    applyMeshtasticForeignLoraFromLog(record.message);
  });
  unsubscribesRef.current.push(unsubLog);

  const unsubForeignLoraLogLine = window.electronAPI.log.onLine((entry) => {
    if (!isForeignLoraLogCandidate(entry.message)) return;
    applyMeshtasticForeignLoraFromLog(entry.message);
  });
  unsubscribesRef.current.push(unsubForeignLoraLogLine);

  // Neighbor info → nodeStore via protocol ingress.

  // Waypoints → nodeStore via protocol; legacy handler only relays MQTT uplink.
  const unsubWaypoint = device.events.onWaypointPacket.subscribe((packet) => {
    touchLastData();
    const data = packet.data as {
      id?: number;
      latitudeI?: number;
      longitudeI?: number;
      name?: string;
      description?: string;
      icon?: number;
      lockedTo?: number;
      expire?: number;
    };
    if (!data.id) return;

    const mp = packet as { from?: number; to?: number; channel?: number };
    const fromNode = mp.from;
    const toNode = (mp.to ?? BROADCAST_ADDR) >>> 0;
    const chanIdx = mp.channel ?? 0;
    if (
      fromNode != null &&
      fromNode !== myNodeNumRef.current &&
      mqttStatusRef.current === 'connected' &&
      toNode === BROADCAST_ADDR
    ) {
      const chCfg = channelConfigsRef.current.find((c) => c.index === chanIdx);
      if (chCfg?.uplinkEnabled) {
        const wpMqtt = resolveMeshtasticMqttPublishFieldsForChannel(
          chanIdx,
          channelConfigsRef.current,
          loadMeshtasticMqttManualChannelPsks(),
          meshtasticMqttPublishOpts(!deviceRef.current),
        );
        if (wpMqtt.channelName) {
          void window.electronAPI.mqtt
            .publishWaypoint({
              from: fromNode,
              to: toNode,
              channel: chanIdx,
              channelName: wpMqtt.channelName,
              pskBase64: wpMqtt.pskBase64,
              publishJsonMirror: wpMqtt.publishJsonMirror,
              waypoint: {
                id: data.id,
                latitudeI: data.latitudeI ?? 0,
                longitudeI: data.longitudeI ?? 0,
                name: data.name ?? '',
                description: data.description ?? '',
                icon: data.icon ?? 0,
                lockedTo: data.lockedTo ?? 0,
                expire: data.expire ?? 0,
              },
            })
            .catch((e: unknown) => {
              console.debug(
                '[useMeshtasticRuntime] MQTT waypoint relay failed ' + errLikeToLogString(e),
              );
            });
        }
      }
    }
  });
  unsubscribesRef.current.push(unsubWaypoint);

  // Module config → deviceStore via protocol ingress (skipped during remote configure).

  const unsubRemoteAdmin = device.events.onMeshPacket.subscribe((meshPacket) => {
    remoteAdminClientRef.current?.handleMeshPacket(meshPacket as never);
  });
  unsubscribesRef.current.push(unsubRemoteAdmin);

  // ─── Remote Hardware packets ──────────────────────────────────
  const unsubRemoteHardware = device.events.onRemoteHardwarePacket.subscribe((packet) => {
    touchLastData();
    const data = packet.data as { raw?: Uint8Array };
    setRemoteHardwareMessages((prev) => {
      const updated = new Map(prev);
      const from = packet.from;
      const existing = updated.get(from) ?? [];
      updated.set(from, [
        ...existing.slice(-10),
        { from, data: data.raw ?? new Uint8Array(), timestamp: Date.now() },
      ]);
      return updated;
    });
  });
  unsubscribesRef.current.push(unsubRemoteHardware);

  // ─── Audio packets ─────────────────────────────────────────────
  const unsubAudio = device.events.onAudioPacket.subscribe((packet) => {
    touchLastData();
    setAudioMessages((prev) => {
      const updated = new Map(prev);
      const from = packet.from;
      const existing = updated.get(from) ?? [];
      updated.set(from, [
        ...existing.slice(-50),
        { from, data: packet.data, timestamp: Date.now() },
      ]);
      return updated;
    });
  });
  unsubscribesRef.current.push(unsubAudio);

  // ─── Detection Sensor packets ─────────────────────────────────
  const unsubDetectionSensor = device.events.onDetectionSensorPacket.subscribe((packet) => {
    touchLastData();
    setDetectionSensorEvents((prev) => {
      const updated = new Map(prev);
      const from = packet.from;
      const existing = updated.get(from) ?? [];
      updated.set(from, [
        ...existing.slice(-100),
        { from, data: packet.data, timestamp: Date.now() },
      ]);
      return updated;
    });
  });
  unsubscribesRef.current.push(unsubDetectionSensor);

  // ─── Ping/Reply packets ───────────────────────────────────────
  const unsubPing = device.events.onPingPacket.subscribe((packet) => {
    touchLastData();
    setPingResponses((prev) => {
      const updated = new Map(prev);
      updated.set(packet.from, {
        from: packet.from,
        data: packet.data,
        timestamp: Date.now(),
      });
      return updated;
    });
  });
  unsubscribesRef.current.push(unsubPing);

  // ─── IP Tunnel packets ─────────────────────────────────────────
  const unsubIpTunnel = device.events.onIpTunnelPacket.subscribe((packet) => {
    touchLastData();
    setIpTunnelMessages((prev) => {
      const updated = new Map(prev);
      const from = packet.from;
      const existing = updated.get(from) ?? [];
      updated.set(from, [
        ...existing.slice(-100),
        { from, data: packet.data, timestamp: Date.now() },
      ]);
      return updated;
    });
  });
  unsubscribesRef.current.push(unsubIpTunnel);

  // ─── PaxCounter packets ───────────────────────────────────────
  const unsubPaxcounter = device.events.onPaxcounterPacket.subscribe((packet) => {
    touchLastData();
    const pax = packet.data as { count?: number };
    setPaxCounterData((prev) => {
      const updated = new Map(prev);
      updated.set(packet.from, {
        from: packet.from,
        count: pax.count ?? 0,
        timestamp: Date.now(),
      });
      return updated;
    });
  });
  unsubscribesRef.current.push(unsubPaxcounter);

  // ─── Serial packets ───────────────────────────────────────────
  const unsubSerial = device.events.onSerialPacket.subscribe((packet) => {
    touchLastData();
    setSerialMessages((prev) => {
      const updated = new Map(prev);
      const from = packet.from;
      const existing = updated.get(from) ?? [];
      updated.set(from, [
        ...existing.slice(-100),
        { from, data: packet.data, timestamp: Date.now() },
      ]);
      return updated;
    });
  });
  unsubscribesRef.current.push(unsubSerial);

  // ─── Store & Forward packets ───────────────────────────────────
  const unsubStoreForward = device.events.onStoreForwardPacket.subscribe((packet) => {
    touchLastData();
    setStoreForwardMessages((prev) => {
      const updated = new Map(prev);
      const from = packet.from;
      const existing = updated.get(from) ?? [];
      updated.set(from, [
        ...existing.slice(-50),
        { from, data: packet.data, timestamp: Date.now() },
      ]);
      return updated;
    });

    const serverNodeId = packet.from;
    const heartbeat = parseStoreForwardHeartbeat(packet.data);
    if (serverNodeId && heartbeat) {
      lastSfHeartbeatServerRef.current = serverNodeId;
      lastSfHeartbeatChannelRef.current = packet.channel ?? 0;
      lastSfHeartbeatPeriodRef.current = heartbeat.period;
      if (heartbeat.secondary === 0 && deviceConfiguredRef.current) {
        void requestStoreForwardHistoryRef.current({ serverNodeId, manual: false });
      }
    }

    const from = packet.from;
    const payloadText = decodeStoreForwardTextPayload(packet.data);
    if (!from || !payloadText) return;
    const sfChat: ChatMessage = {
      sender_id: from,
      sender_name: getNodeName(from),
      payload: payloadText,
      channel: packet.channel ?? 0,
      timestamp: Date.now(),
      isHistory: true,
      receivedVia: 'rf',
      viaStoreForward: true,
    };
    setMessages((prev) => {
      if (isDuplicateHistoryMessage(prev, sfChat)) return prev;
      return trimChatMessagesToMax([...prev, sfChat], MAX_IN_MEMORY_CHAT_MESSAGES);
    });
    void window.electronAPI.db.saveMessage(sfChat);
  });
  unsubscribesRef.current.push(unsubStoreForward);

  // ─── Range Test packets ────────────────────────────────────────
  const unsubRangeTest = device.events.onRangeTestPacket.subscribe((packet) => {
    touchLastData();
    setRangeTestPackets((prev) => {
      const updated = new Map(prev);
      const from = packet.from;
      const existing = updated.get(from) ?? [];
      updated.set(from, [
        ...existing.slice(-100),
        { from, data: packet.data, timestamp: Date.now() },
      ]);
      return updated;
    });
  });
  unsubscribesRef.current.push(unsubRangeTest);

  // ─── ZPS packets ───────────────────────────────────────────────
  const unsubZps = device.events.onZpsPacket.subscribe((packet) => {
    touchLastData();
    setZpsMessages((prev) => {
      const updated = new Map(prev);
      const from = packet.from;
      const existing = updated.get(from) ?? [];
      updated.set(from, [
        ...existing.slice(-50),
        { from, data: packet.data, timestamp: Date.now() },
      ]);
      return updated;
    });
  });
  unsubscribesRef.current.push(unsubZps);

  // ─── Simulator packets ────────────────────────────────────────
  const unsubSimulator = device.events.onSimulatorPacket.subscribe((packet) => {
    touchLastData();
    setSimulatorPackets((prev) => {
      const updated = new Map(prev);
      const from = packet.from;
      const existing = updated.get(from) ?? [];
      updated.set(from, [
        ...existing.slice(-50),
        { from, data: packet.data, timestamp: Date.now() },
      ]);
      return updated;
    });
  });
  unsubscribesRef.current.push(unsubSimulator);

  // ─── ATAK Plugin packets ───────────────────────────────────────
  const unsubAtakPlugin = device.events.onAtakPluginPacket.subscribe((packet) => {
    touchLastData();
    setAtakMessages((prev) => {
      const updated = new Map(prev);
      const from = packet.from;
      const existing = updated.get(from) ?? [];
      updated.set(from, [
        ...existing.slice(-100),
        { from, data: packet.data, timestamp: Date.now() },
      ]);
      return updated;
    });
  });
  unsubscribesRef.current.push(unsubAtakPlugin);

  // ─── Map Report packets ────────────────────────────────────────
  const unsubMapReport = device.events.onMapReportPacket.subscribe((packet) => {
    touchLastData();
    setMapReports((prev) => {
      const updated = new Map(prev);
      updated.set(packet.from, {
        from: packet.from,
        data: packet.data,
        timestamp: Date.now(),
      });
      return updated;
    });
  });
  unsubscribesRef.current.push(unsubMapReport);

  // ─── Private App packets ───────────────────────────────────────
  const unsubPrivate = device.events.onPrivatePacket.subscribe((packet) => {
    touchLastData();
    setPrivateMessages((prev) => {
      const updated = new Map(prev);
      const from = packet.from;
      const existing = updated.get(from) ?? [];
      updated.set(from, [
        ...existing.slice(-50),
        { from, data: packet.data, timestamp: Date.now() },
      ]);
      return updated;
    });
  });
  unsubscribesRef.current.push(unsubPrivate);

  // ─── ATAK Forwarder packets ────────────────────────────────────
  const unsubAtakForwarder = device.events.onAtakForwarderPacket.subscribe((packet) => {
    touchLastData();
    setAtakMessages((prev) => {
      const updated = new Map(prev);
      const from = packet.from;
      const existing = updated.get(from) ?? [];
      updated.set(from, [
        ...existing.slice(-100),
        { from, data: packet.data, timestamp: Date.now() },
      ]);
      return updated;
    });
  });
  unsubscribesRef.current.push(unsubAtakForwarder);

  pushMeshtasticTransportSideEffectUnsubs(
    device,
    type,
    (unsub) => unsubscribesRef.current.push(unsub),
    () => {
      handleConnectionLostRef.current();
    },
  );
}
