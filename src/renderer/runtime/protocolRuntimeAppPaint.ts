import {
  asChannelIndexPills,
  asEnvironmentTelemetryPoints,
  asNeighborInfoMap,
  asOurPosition,
  asRadioDeviceOwner,
  asTelemetryPoints,
  asTraceRouteResultsMap,
  asWaypointMap,
} from '../lib/protocolRuntimeAdapters';
import type { ProtocolRuntime } from './protocolRuntime';

const asyncVoid = (): Promise<void> => Promise.resolve();
const syncNoop = (): void => {};

/**
 * Empty {@link ProtocolRuntime} fields App adapts on first paint (`useRuntime` →
 * `asTraceRouteResultsMap` / channel pills / telemetry). Disabled or pre-live stubs
 * must spread this (or pass {@link collectProtocolRuntimeAppPaintIssues}) so a missing
 * Map/array cannot throw `… is not iterable` before the live hook publishes.
 */
export function createInertProtocolRuntimeBase(): ProtocolRuntime {
  return {
    state: {
      status: 'disconnected',
      connectionType: null,
      myNodeNum: 0,
    },
    identityId: null,
    selfNodeId: null,
    mqttStatus: null,
    mqttConnectionLoss: null,
    messages: [],
    nodes: new Map(),
    deviceOwner: null,
    deviceLogs: [],
    rawPackets: [],
    queueStatus: null,
    ourPosition: null,
    gpsLoading: false,
    telemetry: [],
    signalTelemetry: [],
    environmentTelemetry: [],
    traceRouteResults: new Map(),
    neighborInfo: new Map(),
    channels: [],
    channelConfigs: [],
    moduleConfigs: {},
    waypoints: [],
    telemetryEnabled: null,
    telemetryDeviceUpdateInterval: undefined,

    connect: asyncVoid,
    connectAutomatic: asyncVoid,
    disconnect: asyncVoid,
    onPowerSuspend: syncNoop,
    onPowerResume: syncNoop,
    prepareRfConnect: asyncVoid,
    attachRfSession: asyncVoid,
    handleRfConnectFailure: asyncVoid,
    finalizeDriverDisconnect: asyncVoid,

    sendMessage: asyncVoid,
    setNodeFavorited: asyncVoid,
    refreshNodesFromDb: asyncVoid,
    refreshMessagesFromDb: asyncVoid,
    requestRefresh: asyncVoid,
    getNodes: () => [],
    getFullNodeLabel: (nodeId: number) => String(nodeId),
    getPickerStyleNodeLabel: (nodeId: number) => String(nodeId),
    clearRawPackets: syncNoop,
    hydrateRawPackets: asyncVoid,
  };
}

/** Fields App iterates or adapts during the active-runtime first-paint path. */
export const PROTOCOL_RUNTIME_APP_PAINT_FIELDS = [
  'traceRouteResults',
  'neighborInfo',
  'channels',
  'messages',
  'nodes',
  'deviceLogs',
  'rawPackets',
  'channelConfigs',
  'telemetry',
  'signalTelemetry',
  'environmentTelemetry',
] as const;

export type ProtocolRuntimeAppPaintField = (typeof PROTOCOL_RUNTIME_APP_PAINT_FIELDS)[number];

function isMap(value: unknown): value is Map<unknown, unknown> {
  return value instanceof Map;
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Structural checks for values App may `for…of` / spread before adapters run.
 * Returns human-readable issue strings (empty when paint-safe).
 */
export function collectProtocolRuntimeAppPaintIssues(runtime: unknown): string[] {
  if (runtime == null || typeof runtime !== 'object') {
    return ['runtime is not an object'];
  }
  const r = runtime as Record<string, unknown>;
  const issues: string[] = [];

  const requireMap = (field: ProtocolRuntimeAppPaintField) => {
    if (!isMap(r[field])) issues.push(`${field} must be a Map (got ${describe(r[field])})`);
  };
  const requireArray = (field: ProtocolRuntimeAppPaintField) => {
    if (!isArray(r[field])) issues.push(`${field} must be an array (got ${describe(r[field])})`);
  };

  requireMap('traceRouteResults');
  requireMap('neighborInfo');
  requireMap('nodes');
  requireArray('channels');
  requireArray('messages');
  requireArray('deviceLogs');
  requireArray('rawPackets');
  requireArray('channelConfigs');
  // Telemetry adapters tolerate non-arrays; still require array for stubs so App
  // never sees `undefined` if a future adapter drops the guard.
  requireArray('telemetry');
  requireArray('signalTelemetry');
  requireArray('environmentTelemetry');

  return issues;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Map) return 'Map';
  return typeof value;
}

/**
 * Same adapter calls App makes from `activeRuntime` on first paint. Must not throw
 * for a paint-safe runtime (and should no-op for empty Maps/arrays).
 */
export function runAppPaintAdapters(runtime: {
  traceRouteResults?: unknown;
  neighborInfo?: unknown;
  channels?: unknown;
  telemetry?: unknown;
  signalTelemetry?: unknown;
  environmentTelemetry?: unknown;
  ourPosition?: unknown;
  deviceOwner?: ProtocolRuntime['deviceOwner'];
  waypoints?: unknown;
}): void {
  asTraceRouteResultsMap(runtime.traceRouteResults as Map<number, unknown> | null | undefined);
  asNeighborInfoMap(runtime.neighborInfo);
  asChannelIndexPills(runtime.channels as readonly unknown[] | null | undefined);
  asTelemetryPoints(runtime.telemetry);
  asTelemetryPoints(runtime.signalTelemetry);
  asEnvironmentTelemetryPoints(runtime.environmentTelemetry);
  asOurPosition(runtime.ourPosition);
  asRadioDeviceOwner(runtime.deviceOwner ?? null);
  asWaypointMap(runtime.waypoints);
}
