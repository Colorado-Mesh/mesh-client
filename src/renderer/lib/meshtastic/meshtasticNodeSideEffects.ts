/**
 * Node identity, position, and telemetry side effects driven by the
 * `PacketRouter` `node_info` / `position` / `telemetry` events.
 *
 * `MeshtasticProtocol` decodes UserPacket, NodeInfoPacket, PositionPacket, and
 * TelemetryPacket already, so the runtime no longer keeps a second
 * `device.events.on*` subscription for each of them. `PacketRouter` writes the
 * canonical `nodeStore` record before listeners run; everything here is the
 * extra runtime work that record does not cover — enriched node patches,
 * diagnostics, position history, telemetry charts, and the BLE/serial display
 * name caches. Enriched patches write back to `nodeStore` directly so React
 * state never acts as a second node authority.
 *
 * Failure point: every branch is additive. A missing node row skips the patch,
 * localStorage name-cache writes are swallowed (non-critical), and SQLite
 * `saveNode` is fire-and-forget with a rejection handler — chat and node
 * ingest have already updated the canonical store before persistence begins.
 */
import type { Dispatch, RefObject, SetStateAction } from 'react';

import {
  meshtasticShortNameAfterClearingDefault,
  preferNonEmptyTrimmedString,
} from '../../../shared/nodeNameUtils';
import { upsertNodeRecord } from '../../stores/nodeStore';
import { usePositionHistoryStore } from '../../stores/positionHistoryStore';
import { validateCoords } from '../coordUtils';
import { persistDbWrite } from '../dbPersistRetry';
import { attachTypedPacketListeners } from '../drivers/attachTypedPacketListener';
import { shouldPreserveStaticGpsForSelfNode } from '../gpsSource';
import { getIdentityNode } from '../identityStoreReads';
import {
  computeNodeInfoLastHeardMs,
  mergeMeshtasticLivePacketLastHeard,
  mergeMeshtasticUserPacketLastHeard,
} from '../meshtasticLastHeard';
import type { NodeInfoEvent, PositionEvent, TelemetryEvent } from '../protocols/Protocol';
import { MESHTASTIC_CAPABILITIES } from '../radio/BaseRadioProvider';
import { LAST_SERIAL_PORT_KEY } from '../serialPortSignature';
import { MAX_TELEMETRY_POINTS } from '../sessionMemoryCaps';
import { meshNodeToNodeRecord } from '../storeRecordAdapters';
import type {
  ConnectionType,
  EnvironmentTelemetryPoint,
  IdentityId,
  MeshNode,
  TelemetryPoint,
} from '../types';
import { processMeshtasticNodeDiagnostics } from './meshtasticProcessNodeDiagnostics';
import { cacheTransportDisplayName } from './transportDisplayNameCache';

const ROLE_CLIENT_MUTE = 1;
const BLE_DEVICE_NAMES_KEY = 'mesh-client:bleDeviceNames';
const SERIAL_PORT_NODE_NAMES_KEY = 'mesh-client:serialPortNodeNames';

export interface MeshtasticNodeSideEffectsDeps {
  /** Transport of the active link — selects which display-name cache is written. */
  connectionType: ConnectionType;
  getMyNodeNum: () => number;
  /** True during NodeDB replay, when rxTime bumps must not move `last_heard`. */
  getIsConfiguring: () => boolean;
  /** Web Bluetooth device id of the active BLE link, for the short-name cache. */
  getBluetoothDeviceId: () => string | undefined;
  touchLastData: () => void;
  emptyNode: (nodeId: number) => MeshNode;
  ensureNodeExists: (nodeNum: number, source: 'rf' | 'mqtt') => void;
  /** Ask an unknown sender for its NodeInfo (throttled by the caller). */
  maybeRequestNodeInfoForNode: (nodeNum: number) => void;
  applyOwnNodeBatteryFromDeviceMetrics: (batteryLevel: number) => void;
  /** Nodes heard over RF this session; drives the MQTT-only badge. */
  rfHeardNodeIds: RefObject<Set<number>>;
  setDeviceOwner: Dispatch<
    SetStateAction<{ longName: string; shortName: string; isLicensed: boolean } | null>
  >;
  setTelemetry: Dispatch<SetStateAction<TelemetryPoint[]>>;
  setEnvironmentTelemetry: Dispatch<SetStateAction<EnvironmentTelemetryPoint[]>>;
}

function meshtasticPublicKeyHex(bytes: Uint8Array | undefined): string | undefined {
  if (bytes?.length !== 32) return undefined;
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function saveNode(identityId: IdentityId, node: MeshNode): void {
  upsertNodeRecord(identityId, meshNodeToNodeRecord(node));
  persistDbWrite('meshtastic node', () => window.electronAPI.db.saveNode(node));
}

/** Self stays at hopsAway (default 0); stale peers clear hops; live peers keep packet or prior. */
function resolveNodeDbHopsAway(
  isSelf: boolean,
  lastHeardStale: boolean,
  hopsAway: number | undefined,
  previousHopsAway: number | undefined,
): number | undefined {
  if (isSelf) return hopsAway ?? 0;
  if (lastHeardStale) return undefined;
  return hopsAway ?? previousHopsAway;
}

interface NodeDbPositionPatch {
  latitude: number | null;
  longitude: number | null;
  lastPositionWarning: string | undefined;
}

function applyNodeDbPositionCoords(
  positionCoords: { latitude: number; longitude: number } | null,
  nodeNum: number,
  myNodeNum: number,
  isSelf: boolean,
  storeExisting: MeshNode,
): NodeDbPositionPatch {
  const latitude = storeExisting.latitude;
  const longitude = storeExisting.longitude;
  let lastPositionWarning: string | undefined = storeExisting.lastPositionWarning;
  if (!positionCoords || shouldPreserveStaticGpsForSelfNode(nodeNum, myNodeNum)) {
    return { latitude, longitude, lastPositionWarning };
  }
  const r = validateCoords(positionCoords.latitude, positionCoords.longitude);
  if (r.valid) {
    return {
      latitude: positionCoords.latitude,
      longitude: positionCoords.longitude,
      lastPositionWarning: undefined,
    };
  }
  if (!isSelf || (storeExisting.latitude === 0 && storeExisting.longitude === 0)) {
    lastPositionWarning = r.warning;
  }
  return { latitude, longitude, lastPositionWarning };
}

/** UserPacket identity: live long/short name, hardware, role, and public key. */
function handleUserPacketNodeInfo(
  identityId: IdentityId,
  info: NodeInfoEvent,
  deps: MeshtasticNodeSideEffectsDeps,
): void {
  const nodeNum = info.nodeId;
  deps.rfHeardNodeIds.current.add(nodeNum);
  const existing = getIdentityNode(identityId, nodeNum) ?? deps.emptyNode(nodeNum);
  const long_name = preferNonEmptyTrimmedString(info.longName, existing.long_name, {
    nodeId: nodeNum,
  });
  const short_name = meshtasticShortNameAfterClearingDefault(
    long_name,
    preferNonEmptyTrimmedString(info.shortName, existing.short_name),
    nodeNum,
  );
  const node: MeshNode = {
    ...existing,
    node_id: nodeNum,
    long_name,
    short_name,
    hw_model: info.hwModel ?? existing.hw_model,
    role: info.role ?? existing.role,
    public_key_hex: meshtasticPublicKeyHex(info.publicKey) ?? existing.public_key_hex,
    // During configure, skip rxTime bumps (NodeDB replay). After configure, use mesh rxTime.
    last_heard: mergeMeshtasticUserPacketLastHeard(
      existing.last_heard || 0,
      info.lastHeardAt ?? 0,
      deps.getIsConfiguring(),
    ),
    heard_via_mqtt_only: false,
    via_mqtt: false,
    source: 'rf',
  };
  saveNode(identityId, node);
  if (nodeNum === deps.getMyNodeNum()) {
    deps.setDeviceOwner({
      longName: preferNonEmptyTrimmedString(info.longName, ''),
      shortName: preferNonEmptyTrimmedString(info.shortName, ''),
      isLicensed: info.isLicensed ?? false,
    });
  }
}

/** Cache the connected node's short name against its BLE peripheral / serial port. */
function cacheSelfNodeTransportName(
  info: NodeInfoEvent,
  deps: MeshtasticNodeSideEffectsDeps,
): void {
  if (info.nodeId !== deps.getMyNodeNum()) return;
  if (deps.connectionType === 'ble') {
    const deviceId = deps.getBluetoothDeviceId();
    const shortName = preferNonEmptyTrimmedString(info.shortName, '') || null;
    if (deviceId && shortName) {
      cacheTransportDisplayName(BLE_DEVICE_NAMES_KEY, deviceId, shortName);
    }
    return;
  }
  if (deps.connectionType === 'serial') {
    const portId = localStorage.getItem(LAST_SERIAL_PORT_KEY);
    const shortName =
      preferNonEmptyTrimmedString(info.shortName, preferNonEmptyTrimmedString(info.longName, '')) ||
      null;
    if (portId && shortName) {
      cacheTransportDisplayName(SERIAL_PORT_NODE_NAMES_KEY, portId, shortName);
    }
  }
}

/** NodeDB NodeInfo: enriched row with SNR, hops, position, and device metrics. */
function handleNodeDbNodeInfo(
  identityId: IdentityId,
  info: NodeInfoEvent,
  deps: MeshtasticNodeSideEffectsDeps,
): void {
  const nodeNum = info.nodeId;
  const myNodeNum = deps.getMyNodeNum();
  const isSelf = nodeNum === myNodeNum;
  deps.rfHeardNodeIds.current.add(nodeNum);
  const storeExisting = getIdentityNode(identityId, nodeNum) ?? deps.emptyNode(nodeNum);
  const prevOwnRole = isSelf ? storeExisting.role : undefined;
  const positionCoords =
    info.latitude != null && info.longitude != null
      ? { latitude: info.latitude, longitude: info.longitude }
      : null;
  const positionPatch = applyNodeDbPositionCoords(
    positionCoords,
    nodeNum,
    myNodeNum,
    isSelf,
    storeExisting,
  );
  const newAlt = info.altitude ?? storeExisting.altitude;
  const lastHeardMs = computeNodeInfoLastHeardMs(
    info.lastHeardAt,
    storeExisting.last_heard,
    isSelf,
  );
  const lastHeardStale =
    lastHeardMs > 0 && Date.now() - lastHeardMs > MESHTASTIC_CAPABILITIES.nodeStaleThresholdMs;
  const long_name = preferNonEmptyTrimmedString(info.longName, storeExisting.long_name, {
    nodeId: nodeNum,
  });
  const short_name = meshtasticShortNameAfterClearingDefault(
    long_name,
    preferNonEmptyTrimmedString(info.shortName, storeExisting.short_name),
    nodeNum,
  );
  const hops_away = resolveNodeDbHopsAway(
    isSelf,
    lastHeardStale,
    info.hopsAway,
    storeExisting.hops_away,
  );
  const node: MeshNode = {
    ...storeExisting,
    node_id: nodeNum,
    long_name,
    short_name,
    hw_model: info.hwModel ?? storeExisting.hw_model,
    snr: info.snr ?? storeExisting.snr,
    battery: info.batteryLevel ?? storeExisting.battery,
    last_heard: lastHeardMs,
    latitude: positionPatch.latitude,
    longitude: positionPatch.longitude,
    role: info.role ?? storeExisting.role,
    hops_away,
    via_mqtt: info.viaMqtt ?? false,
    voltage: info.voltage ?? storeExisting.voltage,
    channel_utilization: info.channelUtilization ?? storeExisting.channel_utilization,
    air_util_tx: info.airUtilTx ?? storeExisting.air_util_tx,
    altitude: newAlt,
    heard_via_mqtt_only: false,
    source: 'rf',
    lastPositionWarning: positionPatch.lastPositionWarning,
  };
  saveNode(identityId, node);

  if (isSelf && info.batteryLevel !== undefined) {
    deps.applyOwnNodeBatteryFromDeviceMetrics(info.batteryLevel);
  }
  if (isSelf && node.role === ROLE_CLIENT_MUTE && prevOwnRole !== ROLE_CLIENT_MUTE) {
    console.info(
      '[meshtasticNodeSideEffects] Device role is Client Mute — position reports to device suppressed',
    );
  }
  processMeshtasticNodeDiagnostics(
    node,
    myNodeNum,
    isSelf ? node : (getIdentityNode(identityId, myNodeNum) ?? null),
  );
  if (positionCoords && validateCoords(positionCoords.latitude, positionCoords.longitude).valid) {
    usePositionHistoryStore
      .getState()
      .recordPosition(nodeNum, positionCoords.latitude, positionCoords.longitude);
  }
  cacheSelfNodeTransportName(info, deps);
}

function handleNodeInfo(
  identityId: IdentityId,
  info: NodeInfoEvent,
  deps: MeshtasticNodeSideEffectsDeps,
): void {
  deps.touchLastData();
  if (!info.nodeId) return;
  if (info.fromUserPacket) {
    handleUserPacketNodeInfo(identityId, info, deps);
    return;
  }
  handleNodeDbNodeInfo(identityId, info, deps);
}

function handlePosition(
  identityId: IdentityId,
  position: PositionEvent,
  deps: MeshtasticNodeSideEffectsDeps,
): void {
  deps.touchLastData();
  const nodeNum = position.nodeId;
  if (position.latitude == null || position.longitude == null) return;
  const myNodeNum = deps.getMyNodeNum();
  if (nodeNum !== 0) {
    deps.rfHeardNodeIds.current.add(nodeNum);
  }

  const r = validateCoords(position.latitude, position.longitude);
  if (!r.valid) {
    const existing = getIdentityNode(identityId, nodeNum) ?? deps.emptyNode(nodeNum);
    if (nodeNum === myNodeNum && (existing.latitude != null || existing.longitude != null)) return;
    saveNode(identityId, {
      ...existing,
      lastPositionWarning: r.warning,
      last_heard: mergeMeshtasticLivePacketLastHeard(
        existing.last_heard || 0,
        Date.now(),
        deps.getIsConfiguring(),
      ),
    });
    return;
  }

  if (shouldPreserveStaticGpsForSelfNode(nodeNum, myNodeNum)) return;

  const homeNode = getIdentityNode(identityId, myNodeNum) ?? null;
  const existing = getIdentityNode(identityId, nodeNum) ?? deps.emptyNode(nodeNum);
  const node: MeshNode = {
    ...existing,
    latitude: position.latitude,
    longitude: position.longitude,
    altitude: position.altitude ?? existing.altitude,
    // Position replays at connect must not bump last_heard (configure guard).
    last_heard: mergeMeshtasticLivePacketLastHeard(
      existing.last_heard || 0,
      position.timestamp,
      deps.getIsConfiguring(),
    ),
    lastPositionWarning: undefined,
    source: 'rf',
    heard_via_mqtt_only: false,
    via_mqtt: false,
  };
  saveNode(identityId, node);
  processMeshtasticNodeDiagnostics(node, myNodeNum, homeNode);
  usePositionHistoryStore.getState().recordPosition(nodeNum, position.latitude, position.longitude);
  deps.maybeRequestNodeInfoForNode(nodeNum);
}

/** Environment sensor variant: chart point plus the node row's `env_*` columns. */
function handleEnvironmentTelemetry(
  identityId: IdentityId,
  telemetry: TelemetryEvent,
  deps: MeshtasticNodeSideEffectsDeps,
): void {
  const nodeNum = telemetry.nodeId;
  const point: EnvironmentTelemetryPoint = {
    timestamp: Date.now(),
    nodeNum,
    temperature: telemetry.temperature,
    relativeHumidity: telemetry.relativeHumidity,
    barometricPressure: telemetry.barometricPressure,
    gasResistance: telemetry.gasResistance,
    iaq: telemetry.iaq,
    lux: telemetry.lux,
    windSpeed: telemetry.windSpeed,
    windDirection: telemetry.windDirection,
    windGust: telemetry.windGust,
    windLull: telemetry.windLull,
    weight: telemetry.weight,
    rainfall1h: telemetry.rainfall1h,
    rainfall24h: telemetry.rainfall24h,
  };
  deps.setEnvironmentTelemetry((prev) => [...prev, point].slice(-MAX_TELEMETRY_POINTS));
  const existing = getIdentityNode(identityId, nodeNum) ?? deps.emptyNode(nodeNum);
  saveNode(identityId, {
    ...existing,
    env_temperature: telemetry.temperature ?? existing.env_temperature,
    env_humidity: telemetry.relativeHumidity ?? existing.env_humidity,
    env_pressure: telemetry.barometricPressure ?? existing.env_pressure,
    env_iaq: telemetry.iaq ?? existing.env_iaq,
    env_gas_resistance: telemetry.gasResistance ?? existing.env_gas_resistance,
    env_lux: telemetry.lux ?? existing.env_lux,
    env_wind_speed: telemetry.windSpeed ?? existing.env_wind_speed,
    env_wind_direction: telemetry.windDirection ?? existing.env_wind_direction,
    last_heard: mergeMeshtasticLivePacketLastHeard(
      existing.last_heard || 0,
      telemetry.timestamp,
      deps.getIsConfiguring(),
    ),
    source: 'rf',
    heard_via_mqtt_only: false,
    via_mqtt: false,
  });
}

/** Connected node's own radio statistics (channel utilization, RX/TX counters). */
function handleLocalStatsTelemetry(
  identityId: IdentityId,
  telemetry: TelemetryEvent,
  deps: MeshtasticNodeSideEffectsDeps,
): void {
  const myNodeNum = deps.getMyNodeNum();
  const existing = getIdentityNode(identityId, myNodeNum);
  if (!existing) return;
  const node: MeshNode = {
    ...existing,
    channel_utilization: telemetry.channelUtilization ?? existing.channel_utilization,
    air_util_tx: telemetry.airUtilTx ?? existing.air_util_tx,
    num_packets_rx_bad: telemetry.numPacketsRxBad ?? existing.num_packets_rx_bad,
    num_rx_dupe: telemetry.numRxDupe ?? existing.num_rx_dupe,
    num_packets_rx: telemetry.numPacketsRx ?? existing.num_packets_rx,
    num_packets_tx: telemetry.numPacketsTx ?? existing.num_packets_tx,
    source: 'rf',
    heard_via_mqtt_only: false,
    via_mqtt: false,
  };
  saveNode(identityId, node);
  processMeshtasticNodeDiagnostics(node, myNodeNum, node);
}

/** Device metrics (and any other variant): battery chart point plus node battery. */
function handleDeviceMetricsTelemetry(
  identityId: IdentityId,
  telemetry: TelemetryEvent,
  deps: MeshtasticNodeSideEffectsDeps,
): void {
  const nodeNum = telemetry.nodeId;
  const myNodeNum = deps.getMyNodeNum();
  const point: TelemetryPoint = {
    timestamp: Date.now(),
    batteryLevel: telemetry.batteryLevel,
    voltage: telemetry.voltage,
  };
  deps.setTelemetry((prev) => [...prev, point].slice(-MAX_TELEMETRY_POINTS));

  if (telemetry.batteryLevel == null || !nodeNum) return;
  deps.ensureNodeExists(nodeNum, 'rf');
  const existing = getIdentityNode(identityId, nodeNum) ?? deps.emptyNode(nodeNum);
  const node: MeshNode = {
    ...existing,
    battery: telemetry.batteryLevel,
    last_heard: mergeMeshtasticLivePacketLastHeard(
      existing.last_heard || 0,
      telemetry.timestamp,
      deps.getIsConfiguring(),
    ),
    source: 'rf',
    heard_via_mqtt_only: false,
    via_mqtt: false,
  };
  saveNode(identityId, node);
  processMeshtasticNodeDiagnostics(
    node,
    myNodeNum,
    nodeNum === myNodeNum ? node : (getIdentityNode(identityId, myNodeNum) ?? null),
  );
  deps.maybeRequestNodeInfoForNode(nodeNum);
  if (nodeNum === myNodeNum) {
    deps.applyOwnNodeBatteryFromDeviceMetrics(telemetry.batteryLevel);
  }
}

function handleTelemetry(
  identityId: IdentityId,
  telemetry: TelemetryEvent,
  deps: MeshtasticNodeSideEffectsDeps,
): void {
  deps.touchLastData();
  // No variant case means the packet carried neither `variant.value` nor
  // `deviceMetrics`, so there is nothing to chart or patch.
  if (!telemetry.variantCase) return;
  if (telemetry.variantCase === 'environmentMetrics') {
    handleEnvironmentTelemetry(identityId, telemetry, deps);
    return;
  }
  if (telemetry.variantCase === 'localStats' && telemetry.nodeId === deps.getMyNodeNum()) {
    handleLocalStatsTelemetry(identityId, telemetry, deps);
    return;
  }
  handleDeviceMetricsTelemetry(identityId, telemetry, deps);
}

/** Attach node identity / position / telemetry side effects for one Meshtastic identity. */
export function attachMeshtasticNodeSideEffects(
  identityId: IdentityId,
  deps: MeshtasticNodeSideEffectsDeps,
): () => void {
  return attachTypedPacketListeners(identityId, {
    node_info: (payload) => {
      handleNodeInfo(identityId, payload, deps);
    },
    position: (payload) => {
      handlePosition(identityId, payload, deps);
    },
    telemetry: (payload) => {
      handleTelemetry(identityId, payload, deps);
    },
  });
}
