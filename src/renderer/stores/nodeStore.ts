import { create } from 'zustand';

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
import type { IdentityId } from '../lib/types';

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
  numPacketsRxBad?: number;
  numRxDupe?: number;
  numPacketsRx?: number;
  numPacketsTx?: number;
  lux?: number;
  windSpeed?: number;
  windDirection?: number;
  paxCount?: number;
  detectionText?: string;
  neighbors?: import('../lib/types').MeshNeighbor[];
  meshcoreLocalStats?: import('../lib/types').MeshCoreLocalStats;
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
  return { ...(existing ?? { nodeId }), ...patch };
}

export function upsertNode(identityId: IdentityId, event: NodeInfoEvent): void {
  useNodeStore.setState((s) => {
    const byId = s.nodes[identityId] ?? {};
    const { nodeId, longName, shortName, macAddr, hwModel, isLicensed, role, lastHeardAt, publicKey } = event;
    return {
      nodes: {
        ...s.nodes,
        [identityId]: {
          ...byId,
          [nodeId]: mergeNode(byId[nodeId], nodeId, {
            longName,
            shortName,
            macAddr,
            hwModel,
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

export function updatePosition(identityId: IdentityId, event: PositionEvent): void {
  useNodeStore.setState((s) => {
    const byId = s.nodes[identityId] ?? {};
    const { nodeId, latitude, longitude, altitude, timestamp, groundSpeed, groundTrack } = event;
    return {
      nodes: {
        ...s.nodes,
        [identityId]: {
          ...byId,
          [nodeId]: mergeNode(byId[nodeId], nodeId, {
            latitude,
            longitude,
            altitude,
            positionTimestamp: timestamp,
            groundSpeed,
            groundTrack,
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
    return {
      nodes: {
        ...s.nodes,
        [identityId]: {
          ...byId,
          [nodeId]: mergeNode(byId[nodeId], nodeId, {
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
  useNodeStore.setState((s) => {
    const { [identityId]: _n, ...nodes } = s.nodes;
    const { [identityId]: _t, ...traceRoutes } = s.traceRoutes;
    const { [identityId]: _w, ...waypoints } = s.waypoints;
    const { [identityId]: _ni, ...neighborInfo } = s.neighborInfo;
    return { nodes, traceRoutes, waypoints, neighborInfo };
  });
}
