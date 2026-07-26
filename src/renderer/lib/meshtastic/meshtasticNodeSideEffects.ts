/**
 * Node identity, position, and telemetry side effects driven by the
 * `PacketRouter` `node_info` / `position` / `telemetry` events.
 *
 * `MeshtasticProtocol` decodes UserPacket, NodeInfoPacket, PositionPacket, and
 * TelemetryPacket already, so the runtime no longer keeps a second
 * `device.events.on*` subscription for each of them. `PacketRouter` writes the
 * canonical `nodeStore` record before listeners run; everything here is the
 * extra runtime work that record does not cover — hook-local node map patches,
 * diagnostics, position history, telemetry charts, and the BLE/serial display
 * name caches.
 *
 * Failure point: every branch is additive. A missing node row skips the patch,
 * localStorage name-cache writes are swallowed (non-critical), and SQLite
 * `saveNode` is fire-and-forget — chat and node ingest have already been
 * persisted by `PacketRouter`.
 */
import type { Dispatch, RefObject, SetStateAction } from 'react';

import {
  meshtasticShortNameAfterClearingDefault,
  preferNonEmptyTrimmedString,
} from '../../../shared/nodeNameUtils';
import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { usePositionHistoryStore } from '../../stores/positionHistoryStore';
import { validateCoords } from '../coordUtils';
import { packetRouter, type PacketRouterListener } from '../drivers/PacketRouter';
import { shouldPreserveStaticGpsForSelfNode } from '../gpsSource';
import { getIdentityNode } from '../identityStoreReads';
import {
  computeNodeInfoLastHeardMs,
  mergeMeshtasticLivePacketLastHeard,
  mergeMeshtasticUserPacketLastHeard,
} from '../meshtasticLastHeard';
import { parseStoredJson } from '../parseStoredJson';
import type {
  DomainEvent,
  NodeInfoEvent,
  PositionEvent,
  TelemetryEvent,
} from '../protocols/Protocol';
import { MESHTASTIC_CAPABILITIES } from '../radio/BaseRadioProvider';
import { LAST_SERIAL_PORT_KEY } from '../serialPortSignature';
import { getStoredMeshProtocol } from '../storedMeshProtocol';
import type {
  ConnectionType,
  EnvironmentTelemetryPoint,
  IdentityId,
  MeshNode,
  TelemetryPoint,
} from '../types';

const MAX_TELEMETRY_POINTS = 50;
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
  updateNodes: (updater: (prev: Map<number, MeshNode>) => Map<number, MeshNode>) => void;
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

function processNodeDiagnostics(
  identityId: IdentityId,
  node: MeshNode,
  myNodeNum: number,
  homeNode: MeshNode | null,
): void {
  if (getStoredMeshProtocol() !== 'meshtastic') return;
  useDiagnosticsStore
    .getState()
    .processNodeUpdate(node, homeNode, myNodeNum, MESHTASTIC_CAPABILITIES);
}

function cacheShortNameByKey(storageKey: string, cacheKey: string, shortName: string): void {
  try {
    const cache =
      parseStoredJson<Record<string, string>>(
        localStorage.getItem(storageKey),
        `meshtasticNodeSideEffects ${storageKey}`,
      ) ?? {};
    cache[cacheKey] = shortName;
    localStorage.setItem(storageKey, JSON.stringify(cache));
  } catch {
    // catch-no-log-ok localStorage write for transport display-name cache — non-critical
  }
}

/** UserPacket identity: live long/short name, hardware, role, and public key. */
function handleUserPacketNodeInfo(info: NodeInfoEvent, deps: MeshtasticNodeSideEffectsDeps): void {
  const nodeNum = info.nodeId;
  deps.rfHeardNodeIds.current.add(nodeNum);
  deps.updateNodes((prev) => {
    const updated = new Map(prev);
    const existing = updated.get(nodeNum) ?? deps.emptyNode(nodeNum);
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
    updated.set(nodeNum, node);
    void window.electronAPI.db.saveNode(node);
    return updated;
  });
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
      cacheShortNameByKey(BLE_DEVICE_NAMES_KEY, deviceId, shortName);
    }
    return;
  }
  if (deps.connectionType === 'serial') {
    const portId = localStorage.getItem(LAST_SERIAL_PORT_KEY);
    const shortName =
      preferNonEmptyTrimmedString(info.shortName, preferNonEmptyTrimmedString(info.longName, '')) ||
      null;
    if (portId && shortName) {
      cacheShortNameByKey(SERIAL_PORT_NODE_NAMES_KEY, portId, shortName);
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
  const prevOwnRole = isSelf ? getIdentityNode(identityId, nodeNum)?.role : undefined;
  const hasPosition = info.latitude != null && info.longitude != null;

  deps.updateNodes((prev) => {
    const updated = new Map(prev);
    const existing = updated.get(nodeNum) ?? deps.emptyNode(nodeNum);

    let newLat = existing.latitude;
    let newLon = existing.longitude;
    const newAlt = info.altitude ?? existing.altitude;
    let posWarn: string | undefined = existing.lastPositionWarning;

    if (hasPosition && !shouldPreserveStaticGpsForSelfNode(nodeNum, myNodeNum)) {
      const r = validateCoords(info.latitude!, info.longitude!);
      if (r.valid) {
        newLat = info.latitude!;
        newLon = info.longitude!;
        posWarn = undefined;
      } else if (!isSelf || (existing.latitude === 0 && existing.longitude === 0)) {
        posWarn = r.warning;
      }
    }

    const lastHeardMs = computeNodeInfoLastHeardMs(info.lastHeardAt, existing.last_heard, isSelf);
    const lastHeardStale =
      lastHeardMs > 0 && Date.now() - lastHeardMs > MESHTASTIC_CAPABILITIES.nodeStaleThresholdMs;

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
      snr: info.snr ?? existing.snr,
      battery: info.batteryLevel ?? existing.battery,
      last_heard: lastHeardMs,
      latitude: newLat,
      longitude: newLon,
      role: info.role ?? existing.role,
      // Stale NodeInfo still carries cached hops; don't show hop count for ghosts.
      hops_away: isSelf
        ? (info.hopsAway ?? 0)
        : lastHeardStale
          ? undefined
          : (info.hopsAway ?? existing.hops_away),
      via_mqtt: info.viaMqtt ?? false,
      voltage: info.voltage ?? existing.voltage,
      channel_utilization: info.channelUtilization ?? existing.channel_utilization,
      air_util_tx: info.airUtilTx ?? existing.air_util_tx,
      altitude: newAlt,
      heard_via_mqtt_only: false,
      source: 'rf',
      lastPositionWarning: posWarn,
    };
    updated.set(nodeNum, node);
    void window.electronAPI.db.saveNode(node);
    return updated;
  });

  if (isSelf && info.batteryLevel !== undefined) {
    deps.applyOwnNodeBatteryFromDeviceMetrics(info.batteryLevel);
  }
  if (
    isSelf &&
    getIdentityNode(identityId, nodeNum)?.role === ROLE_CLIENT_MUTE &&
    prevOwnRole !== ROLE_CLIENT_MUTE
  ) {
    console.info(
      '[meshtasticNodeSideEffects] Device role is Client Mute — position reports to device suppressed',
    );
  }
  const updatedRfNode = getIdentityNode(identityId, nodeNum);
  if (updatedRfNode) {
    processNodeDiagnostics(
      identityId,
      updatedRfNode,
      myNodeNum,
      getIdentityNode(identityId, myNodeNum) ?? null,
    );
  }
  if (hasPosition && validateCoords(info.latitude!, info.longitude!).valid) {
    usePositionHistoryStore.getState().recordPosition(nodeNum, info.latitude!, info.longitude!);
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
    handleUserPacketNodeInfo(info, deps);
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
  const myNodeNum = deps.getMyNodeNum();
  if (nodeNum !== 0) {
    deps.rfHeardNodeIds.current.add(nodeNum);
  }

  const r = validateCoords(position.latitude, position.longitude);
  if (!r.valid) {
    deps.updateNodes((prev) => {
      const updated = new Map(prev);
      const existing = updated.get(nodeNum) ?? deps.emptyNode(nodeNum);
      // Don't flag our own node if we have valid fallback coords
      if (nodeNum === myNodeNum && (existing.latitude != null || existing.longitude != null)) {
        return prev;
      }
      updated.set(nodeNum, {
        ...existing,
        lastPositionWarning: r.warning,
        last_heard: mergeMeshtasticLivePacketLastHeard(
          existing.last_heard || 0,
          Date.now(),
          deps.getIsConfiguring(),
        ),
      });
      return updated;
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
  deps.updateNodes((prev) => {
    const updated = new Map(prev);
    updated.set(nodeNum, node);
    void window.electronAPI.db.saveNode(node);
    return updated;
  });
  processNodeDiagnostics(identityId, node, myNodeNum, homeNode);
  usePositionHistoryStore.getState().recordPosition(nodeNum, position.latitude, position.longitude);
  deps.maybeRequestNodeInfoForNode(nodeNum);
}

/** Environment sensor variant: chart point plus the node row's `env_*` columns. */
function handleEnvironmentTelemetry(
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
  deps.updateNodes((prev) => {
    const existing = prev.get(nodeNum);
    if (!existing) return prev;
    const updated = new Map(prev);
    updated.set(nodeNum, {
      ...existing,
      env_temperature: telemetry.temperature ?? existing.env_temperature,
      env_humidity: telemetry.relativeHumidity ?? existing.env_humidity,
      env_pressure: telemetry.barometricPressure ?? existing.env_pressure,
      env_iaq: telemetry.iaq ?? existing.env_iaq,
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
    return updated;
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
  deps.updateNodes((prev) => {
    const updated = new Map(prev);
    updated.set(myNodeNum, node);
    void window.electronAPI.db.saveNode(node);
    return updated;
  });
  processNodeDiagnostics(identityId, node, myNodeNum, node);
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
  const existing = getIdentityNode(identityId, nodeNum);
  if (existing) {
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
    deps.updateNodes((prev) => {
      const updated = new Map(prev);
      updated.set(nodeNum, node);
      return updated;
    });
    processNodeDiagnostics(
      identityId,
      node,
      myNodeNum,
      getIdentityNode(identityId, myNodeNum) ?? null,
    );
  }
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
    handleEnvironmentTelemetry(telemetry, deps);
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
  const listener: PacketRouterListener = (event: DomainEvent, routedIdentityId) => {
    if (routedIdentityId !== identityId) return;
    switch (event.type) {
      case 'node_info':
        handleNodeInfo(identityId, event.payload, deps);
        break;
      case 'position':
        handlePosition(identityId, event.payload, deps);
        break;
      case 'telemetry':
        handleTelemetry(identityId, event.payload, deps);
        break;
      default:
        break;
    }
  };
  return packetRouter.addListener(listener);
}
