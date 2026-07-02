import { create } from 'zustand';

import { preferNonEmptyTrimmedString } from '@/shared/nodeNameUtils';

import {
  computeNodeInfoLastHeardMs,
  mergeMeshtasticLivePacketLastHeard,
} from '../lib/meshtasticLastHeard';
import { mergeMeshcoreLastHeardFromAdvert } from '../lib/nodeStatus';
import type {
  CliEntry,
  NeighborInfoEvent,
  NeighborResult,
  NodeInfoEvent,
  PingResult,
  PositionEvent,
  StatusResult,
  TelemetryEvent,
  TelemetryResult,
  TraceRouteEvent,
  WaypointEvent,
} from '../lib/protocols/Protocol';
import type { IdentityId, MeshCoreLocalStats, MeshNeighbor } from '../lib/types';
import { getConnection } from './connectionStore';
import { getIdentity } from './identityStore';
import { omitRecordKey } from './storeUtils';

export interface NodeRecord {
  nodeId: number;
  // From NodeInfo
  longName?: string;
  shortName?: string;
  macAddr?: string;
  hwModel?: string;
  isLicensed?: boolean;
  role?: number;
  lastHeardAt?: number;
  // From Position
  latitude?: number;
  longitude?: number;
  altitude?: number;
  positionTimestamp?: number;
  groundSpeed?: number;
  groundTrack?: number;
  // From Telemetry
  batteryLevel?: number;
  voltage?: number;
  channelUtilization?: number;
  airUtilTx?: number;
  uptimeSeconds?: number;
  temperature?: number;
  relativeHumidity?: number;
  barometricPressure?: number;
  iaq?: number;
  telemetryTimestamp?: number;
  snr?: number;
  rssi?: number;
  hopsAway?: number;
  viaMqtt?: boolean | number;
  hops?: number;
  path?: number[];
  heardViaMqttOnly?: boolean;
  heardViaMqtt?: boolean;
  source?: 'rf' | 'mqtt';
  onRadio?: boolean;
  favorited?: boolean;
  lastPositionWarning?: string;
  /** Reticulum LXMF destination hash (32 hex chars) when known. */
  reticulumDestinationHash?: string;
  numPacketsRxBad?: number;
  numRxDupe?: number;
  numPacketsRx?: number;
  numPacketsTx?: number;
  lux?: number;
  windSpeed?: number;
  windDirection?: number;
  paxCount?: number;
  detectionText?: string;
  neighbors?: MeshNeighbor[];
  meshcoreLocalStats?: MeshCoreLocalStats;
  publicKey?: Uint8Array;
  // MeshCore per-node op state (results of on-demand requests for repeaters /
  // remote nodes). Optional fields; non-MeshCore nodes leave them undefined.
  meshcoreNodeStatus?: StatusResult;
  meshcoreStatusError?: string;
  meshcoreTraceResult?: PingResult;
  meshcorePingError?: string;
  meshcoreCanPingTrace?: boolean;
  meshcorePingRouteReadyEpoch?: number;
  meshcoreNeighbors?: NeighborResult;
  meshcoreNeighborError?: string;
  meshcoreNodeTelemetry?: TelemetryResult;
  meshcoreTelemetryError?: string;
  meshcoreCliHistory?: CliEntry[];
  meshcoreCliError?: string;
}

export type MeshcoreOpFields = Pick<
  NodeRecord,
  | 'meshcoreNodeStatus'
  | 'meshcoreStatusError'
  | 'meshcoreTraceResult'
  | 'meshcorePingError'
  | 'meshcoreCanPingTrace'
  | 'meshcorePingRouteReadyEpoch'
  | 'meshcoreNeighbors'
  | 'meshcoreNeighborError'
  | 'meshcoreNodeTelemetry'
  | 'meshcoreTelemetryError'
  | 'meshcoreCliHistory'
  | 'meshcoreCliError'
>;

interface NodeStoreState {
  nodes: Record<IdentityId, Record<number, NodeRecord>>;
  traceRoutes: Record<IdentityId, TraceRouteEvent[]>;
  waypoints: Record<IdentityId, Record<number, WaypointEvent>>;
  neighborInfo: Record<IdentityId, Record<number, NeighborInfoEvent>>;
}

const defaultState: NodeStoreState = {
  nodes: {},
  traceRoutes: {},
  waypoints: {},
  neighborInfo: {},
};

export const useNodeStore = create<NodeStoreState>()(() => defaultState);

function mergeNode(
  existing: NodeRecord | undefined,
  nodeId: number,
  patch: Partial<NodeRecord>,
): NodeRecord {
  // Omit undefined patch keys so stub runtime sync / partial node_info cannot wipe identity.
  const definedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<NodeRecord>;
  return { ...(existing ?? { nodeId }), ...definedPatch, nodeId };
}

/** Advert/node_info may omit or send empty names; never wipe stored identity. */
function nodeIdentityPatch(
  existing: NodeRecord | undefined,
  event: Pick<NodeInfoEvent, 'longName' | 'shortName' | 'hwModel'>,
  nodeId: number,
  protocolType: 'meshcore' | 'meshtastic' | undefined,
): Pick<NodeRecord, 'longName' | 'shortName' | 'hwModel'> {
  const patch: Pick<NodeRecord, 'longName' | 'shortName' | 'hwModel'> = {};
  const nameOpts = protocolType === 'meshtastic' ? { nodeId } : undefined;
  const longName = preferNonEmptyTrimmedString(event.longName, existing?.longName ?? '', nameOpts);
  if (longName) patch.longName = longName;
  const shortName = preferNonEmptyTrimmedString(event.shortName, existing?.shortName ?? '');
  if (shortName) patch.shortName = shortName;
  const hwModel = preferNonEmptyTrimmedString(event.hwModel, existing?.hwModel ?? '');
  if (hwModel) patch.hwModel = hwModel;
  return patch;
}

export function upsertNode(identityId: IdentityId, event: NodeInfoEvent): void {
  useNodeStore.setState((s) => {
    const byId = s.nodes[identityId] ?? {};
    const existing = byId[event.nodeId];
    const {
      nodeId,
      longName,
      shortName,
      macAddr,
      hwModel,
      isLicensed,
      role,
      lastHeardAt: eventLastHeardAt,
      publicKey,
    } = event;
    let lastHeardAt = eventLastHeardAt;
    const protocolType = getIdentity(identityId)?.protocol.type;
    if (
      protocolType === 'meshcore' &&
      eventLastHeardAt != null &&
      Number.isFinite(eventLastHeardAt)
    ) {
      const merged = mergeMeshcoreLastHeardFromAdvert(
        eventLastHeardAt,
        existing?.lastHeardAt,
        Math.floor(Date.now() / 1000),
      );
      if (merged > 0) lastHeardAt = merged;
    } else if (protocolType === 'meshtastic') {
      const selfNum = getConnection(identityId)?.myNodeNum ?? 0;
      const isSelf = selfNum > 0 && nodeId === selfNum;
      lastHeardAt = computeNodeInfoLastHeardMs(
        eventLastHeardAt,
        existing?.lastHeardAt ?? 0,
        isSelf,
      );
    }
    const identityFields = nodeIdentityPatch(
      existing,
      { longName, shortName, hwModel },
      nodeId,
      protocolType === 'meshcore' || protocolType === 'meshtastic' ? protocolType : undefined,
    );

    return {
      nodes: {
        ...s.nodes,
        [identityId]: {
          ...byId,
          [nodeId]: mergeNode(existing, nodeId, {
            ...identityFields,
            macAddr,
            isLicensed,
            role,
            lastHeardAt,
            ...(publicKey ? { publicKey } : {}),
          }),
        },
      },
    };
  });
}

/** Full MeshCore (or other) node record merge — use when syncing from MeshNode / DB rows. */
export function upsertNodeRecord(identityId: IdentityId, record: NodeRecord): void {
  useNodeStore.setState((s) => {
    const byId = s.nodes[identityId] ?? {};
    const { nodeId, ...patch } = record;
    return {
      nodes: {
        ...s.nodes,
        [identityId]: {
          ...byId,
          [nodeId]: mergeNode(byId[nodeId], nodeId, patch),
        },
      },
    };
  });
}

/** Single setState merge for many nodes (avoids losing updates when syncing large radio contact lists). */
export function upsertNodeRecordsForIdentity(identityId: IdentityId, records: NodeRecord[]): void {
  if (records.length === 0) return;
  useNodeStore.setState((s) => {
    const byId = { ...(s.nodes[identityId] ?? {}) };
    for (const record of records) {
      const { nodeId, ...patch } = record;
      byId[nodeId] = mergeNode(byId[nodeId], nodeId, patch);
    }
    return {
      nodes: {
        ...s.nodes,
        [identityId]: byId,
      },
    };
  });
}

function meshtasticLastHeardPatch(
  identityId: IdentityId,
  packetTimestampMs: number,
  existingLastHeardAt: number | undefined,
): number | undefined {
  if (getIdentity(identityId)?.protocol.type !== 'meshtastic') return undefined;
  const merged = mergeMeshtasticLivePacketLastHeard(
    existingLastHeardAt ?? 0,
    packetTimestampMs,
    false,
  );
  return merged > 0 ? merged : undefined;
}

/** Toggle favorite flag on a node in the identity-scoped store (UI reads this bucket). */
export function patchNodeFavorited(
  identityId: IdentityId,
  nodeId: number,
  favorited: boolean,
): void {
  useNodeStore.setState((s) => {
    const byId = s.nodes[identityId] ?? {};
    const existing = byId[nodeId];
    return {
      nodes: {
        ...s.nodes,
        [identityId]: {
          ...byId,
          [nodeId]: mergeNode(existing, nodeId, { favorited }),
        },
      },
    };
  });
}

/** Bump MeshCore `lastHeardAt` in the identity store (path-updated / RPC reachability). */
export function patchMeshcoreNodeLastHeardAt(
  identityId: IdentityId,
  nodeId: number,
  lastHeardSec: number,
  extra?: Partial<NodeRecord>,
): void {
  if (nodeId <= 0 || !Number.isFinite(lastHeardSec) || lastHeardSec <= 0) return;
  useNodeStore.setState((s) => {
    const byId = s.nodes[identityId] ?? {};
    const existing = byId[nodeId];
    if (!existing) return s;
    const merged = mergeMeshcoreLastHeardFromAdvert(
      lastHeardSec,
      existing.lastHeardAt,
      Math.floor(Date.now() / 1000),
    );
    return {
      nodes: {
        ...s.nodes,
        [identityId]: {
          ...byId,
          [nodeId]: mergeNode(existing, nodeId, {
            lastHeardAt: merged > 0 ? merged : lastHeardSec,
            ...extra,
          }),
        },
      },
    };
  });
}

export function bumpMeshtasticNodesLastHeardAt(
  identityId: IdentityId,
  nodeIds: number[],
  packetTimestampMs: number,
): void {
  if (getIdentity(identityId)?.protocol.type !== 'meshtastic' || nodeIds.length === 0) return;
  useNodeStore.setState((s) => {
    const byId = { ...(s.nodes[identityId] ?? {}) };
    let changed = false;
    for (const nodeId of nodeIds) {
      if (nodeId <= 0) continue;
      const existing = byId[nodeId];
      const lastHeardAt = meshtasticLastHeardPatch(
        identityId,
        packetTimestampMs,
        existing?.lastHeardAt,
      );
      if (lastHeardAt == null) continue;
      byId[nodeId] = mergeNode(existing, nodeId, { lastHeardAt });
      changed = true;
    }
    if (!changed) return s;
    return { nodes: { ...s.nodes, [identityId]: byId } };
  });
}

export function updatePosition(identityId: IdentityId, event: PositionEvent): void {
  useNodeStore.setState((s) => {
    const byId = s.nodes[identityId] ?? {};
    const { nodeId, latitude, longitude, altitude, timestamp, groundSpeed, groundTrack } = event;
    const existing = byId[nodeId];
    const lastHeardAt = meshtasticLastHeardPatch(identityId, timestamp, existing?.lastHeardAt);
    return {
      nodes: {
        ...s.nodes,
        [identityId]: {
          ...byId,
          [nodeId]: mergeNode(existing, nodeId, {
            latitude,
            longitude,
            altitude,
            positionTimestamp: timestamp,
            groundSpeed,
            groundTrack,
            ...(lastHeardAt != null ? { lastHeardAt } : {}),
          }),
        },
      },
    };
  });
}

export function updateTelemetry(identityId: IdentityId, event: TelemetryEvent): void {
  useNodeStore.setState((s) => {
    const byId = s.nodes[identityId] ?? {};
    const {
      nodeId,
      timestamp,
      batteryLevel,
      voltage,
      channelUtilization,
      airUtilTx,
      uptimeSeconds,
      temperature,
      relativeHumidity,
      barometricPressure,
      iaq,
    } = event;
    const existing = byId[nodeId];
    const lastHeardAt = meshtasticLastHeardPatch(identityId, timestamp, existing?.lastHeardAt);
    return {
      nodes: {
        ...s.nodes,
        [identityId]: {
          ...byId,
          [nodeId]: mergeNode(existing, nodeId, {
            batteryLevel,
            voltage,
            channelUtilization,
            airUtilTx,
            uptimeSeconds,
            temperature,
            relativeHumidity,
            barometricPressure,
            iaq,
            telemetryTimestamp: timestamp,
            ...(lastHeardAt != null ? { lastHeardAt } : {}),
          }),
        },
      },
    };
  });
}

export function addTraceRoute(identityId: IdentityId, event: TraceRouteEvent): void {
  useNodeStore.setState((s) => ({
    traceRoutes: {
      ...s.traceRoutes,
      [identityId]: [...(s.traceRoutes[identityId] ?? []), event],
    },
  }));
}

export function upsertWaypoint(identityId: IdentityId, event: WaypointEvent): void {
  useNodeStore.setState((s) => ({
    waypoints: {
      ...s.waypoints,
      [identityId]: { ...(s.waypoints[identityId] ?? {}), [event.id]: event },
    },
  }));
}

export function upsertNeighborInfo(identityId: IdentityId, event: NeighborInfoEvent): void {
  useNodeStore.setState((s) => ({
    neighborInfo: {
      ...s.neighborInfo,
      [identityId]: {
        ...(s.neighborInfo[identityId] ?? {}),
        [event.nodeId]: event,
      },
    },
  }));
}

export function updateMeshcoreOp(
  identityId: IdentityId,
  nodeId: number,
  patch: Partial<MeshcoreOpFields>,
): void {
  useNodeStore.setState((s) => {
    const byId = s.nodes[identityId] ?? {};
    return {
      nodes: {
        ...s.nodes,
        [identityId]: {
          ...byId,
          [nodeId]: mergeNode(byId[nodeId], nodeId, patch),
        },
      },
    };
  });
}

export function appendMeshcoreCliEntry(
  identityId: IdentityId,
  nodeId: number,
  entry: CliEntry,
): void {
  useNodeStore.setState((s) => {
    const byId = s.nodes[identityId] ?? {};
    const existing = byId[nodeId];
    const next = [...(existing?.meshcoreCliHistory ?? []), entry];
    return {
      nodes: {
        ...s.nodes,
        [identityId]: {
          ...byId,
          [nodeId]: mergeNode(existing, nodeId, { meshcoreCliHistory: next }),
        },
      },
    };
  });
}

export function clearMeshcoreCliHistory(identityId: IdentityId, nodeId: number): void {
  useNodeStore.setState((s) => {
    const byId = s.nodes[identityId] ?? {};
    const existing = byId[nodeId];
    if (!existing) return s;
    return {
      nodes: {
        ...s.nodes,
        [identityId]: {
          ...byId,
          [nodeId]: mergeNode(existing, nodeId, { meshcoreCliHistory: [] }),
        },
      },
    };
  });
}

export function clearNodeIdentity(identityId: IdentityId): void {
  useNodeStore.setState((s) => ({
    nodes: omitRecordKey(s.nodes, identityId),
    traceRoutes: omitRecordKey(s.traceRoutes, identityId),
    waypoints: omitRecordKey(s.waypoints, identityId),
    neighborInfo: omitRecordKey(s.neighborInfo, identityId),
  }));
}
