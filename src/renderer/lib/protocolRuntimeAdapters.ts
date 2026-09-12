import { dedupeChannelPillsByIndex } from '@/renderer/lib/channelListDedupe';
import type { OurPosition } from '@/renderer/lib/gpsSource';
import { meshcoreConfiguredChatChannels } from '@/renderer/lib/meshcoreConfiguredChatChannels';
import type {
  EnvironmentTelemetryPoint,
  MeshWaypoint,
  NeighborInfoRecord,
  TelemetryPoint,
} from '@/renderer/lib/types';
import type { ProtocolRuntimeDeviceOwner } from '@/renderer/runtime/protocolRuntime';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Channel pills App/Chat/AppPanel accept (`index` + `name`). */
export function asChannelIndexPills(
  channels: readonly unknown[],
): { index: number; name: string }[] {
  const pills: { index: number; name: string }[] = [];
  for (const ch of channels) {
    if (!isRecord(ch) || typeof ch.index !== 'number' || typeof ch.name !== 'string') continue;
    pills.push({ index: ch.index, name: ch.name });
  }
  return pills;
}

/** App `chatChannels` — Reticulum empty, MeshCore configured-PSK only, else last-wins pills. */
export function chatChannelsFromRuntimeChannels(
  channels: readonly unknown[],
  capabilities: {
    hasReticulumInterfaceConfig: boolean;
    hasCompanionContactManagementConfig: boolean;
  },
): { index: number; name: string }[] {
  if (capabilities.hasReticulumInterfaceConfig) return [];
  if (capabilities.hasCompanionContactManagementConfig) {
    return meshcoreConfiguredChatChannels(channels);
  }
  return dedupeChannelPillsByIndex(asChannelIndexPills(channels));
}

export interface ProtocolTraceRouteResult {
  route: number[];
  from: number;
  timestamp: number;
}

/** Narrow ProtocolRuntime `traceRouteResults` values (`route` / `from`). */
export function asTraceRouteResult(value: unknown): ProtocolTraceRouteResult | undefined {
  if (!isRecord(value) || typeof value.from !== 'number' || !Array.isArray(value.route)) {
    return undefined;
  }
  if (!value.route.every((id) => typeof id === 'number')) return undefined;
  return {
    route: value.route,
    from: value.from,
    timestamp: typeof value.timestamp === 'number' ? value.timestamp : 0,
  };
}

export function asTraceRouteResultsMap(
  results: Map<number, unknown>,
): Map<number, ProtocolTraceRouteResult> {
  const out = new Map<number, ProtocolTraceRouteResult>();
  for (const [id, value] of results) {
    const traced = asTraceRouteResult(value);
    if (traced) out.set(id, traced);
  }
  return out;
}

/** App NodeDetail hop labels — same order as the previous Meshtastic-typed path. */
export function traceRouteHopLabels(
  result: unknown,
  myNodeNum: number,
  getFullNodeLabel: (id: number) => string,
): string[] | undefined {
  const traced = asTraceRouteResult(result);
  if (!traced) return undefined;
  return [
    getFullNodeLabel(myNodeNum) || 'Me',
    ...traced.route.map((id) => getFullNodeLabel(id)),
    getFullNodeLabel(traced.from),
  ];
}

export function asNumericNodeId(selfNodeId: string | number | null, fallback = 0): number {
  return typeof selfNodeId === 'number' ? selfNodeId : fallback;
}

export function asMqttConnectionLoss(value: string | null | boolean | undefined): boolean {
  return Boolean(value);
}

export function asOurPosition(value: unknown): OurPosition | null {
  if (!isRecord(value) || typeof value.lat !== 'number' || typeof value.lon !== 'number') {
    return null;
  }
  const source = value.source;
  if (source !== 'device' && source !== 'browser' && source !== 'ip' && source !== 'static') {
    return null;
  }
  const pos: OurPosition = { lat: value.lat, lon: value.lon, source };
  if (typeof value.altitudeMeters === 'number') pos.altitudeMeters = value.altitudeMeters;
  return pos;
}

export function asGpsIntervalChange(
  fn: ((...args: never[]) => void) | undefined,
): ((secs: number) => void) | undefined {
  if (!fn) return undefined;
  return (secs) => {
    (fn as (intervalSecs: number) => void)(secs);
  };
}

function isTelemetryPoint(value: unknown): value is TelemetryPoint {
  return isRecord(value) && typeof value.timestamp === 'number';
}

function isEnvironmentTelemetryPoint(value: unknown): value is EnvironmentTelemetryPoint {
  return (
    isRecord(value) && typeof value.timestamp === 'number' && typeof value.nodeNum === 'number'
  );
}

function isMeshWaypoint(value: unknown): value is MeshWaypoint {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number' &&
    typeof value.name === 'string' &&
    typeof value.from === 'number' &&
    typeof value.timestamp === 'number'
  );
}

function isMeshNeighbor(
  value: unknown,
): value is { nodeId: number; snr: number; lastRxTime: number } {
  return (
    isRecord(value) &&
    typeof value.nodeId === 'number' &&
    typeof value.snr === 'number' &&
    typeof value.lastRxTime === 'number'
  );
}

function isNeighborInfoRecord(value: unknown): value is NeighborInfoRecord {
  return (
    isRecord(value) &&
    typeof value.nodeId === 'number' &&
    typeof value.timestamp === 'number' &&
    Array.isArray(value.neighbors) &&
    value.neighbors.every(isMeshNeighbor)
  );
}

export function asWaypointMap(value: unknown): Map<number, MeshWaypoint> | undefined {
  if (!(value instanceof Map)) return undefined;
  let allValid = true;
  for (const [id, wp] of value) {
    if (typeof id !== 'number' || !isMeshWaypoint(wp)) {
      allValid = false;
      break;
    }
  }
  if (allValid) return value as Map<number, MeshWaypoint>;
  const out = new Map<number, MeshWaypoint>();
  for (const [id, wp] of value) {
    if (typeof id === 'number' && isMeshWaypoint(wp)) out.set(id, wp);
  }
  return out;
}

export function asTelemetryPoints(value: unknown): TelemetryPoint[] {
  if (!Array.isArray(value)) return [];
  return value.every(isTelemetryPoint) ? value : value.filter(isTelemetryPoint);
}

export function asEnvironmentTelemetryPoints(value: unknown): EnvironmentTelemetryPoint[] {
  if (!Array.isArray(value)) return [];
  return value.every(isEnvironmentTelemetryPoint)
    ? value
    : value.filter(isEnvironmentTelemetryPoint);
}

export function asNeighborInfoMap(value: unknown): Map<number, NeighborInfoRecord> {
  if (!(value instanceof Map)) return new Map();
  let allValid = true;
  for (const [id, rec] of value) {
    if (typeof id !== 'number' || !isNeighborInfoRecord(rec)) {
      allValid = false;
      break;
    }
  }
  if (allValid) return value as Map<number, NeighborInfoRecord>;
  const out = new Map<number, NeighborInfoRecord>();
  for (const [id, rec] of value) {
    if (typeof id === 'number' && isNeighborInfoRecord(rec)) out.set(id, rec);
  }
  return out;
}

export function asRadioDeviceOwner(
  value: ProtocolRuntimeDeviceOwner | null,
): { longName: string; shortName: string; isLicensed: boolean } | null {
  if (!value) return null;
  return {
    longName: value.longName ?? '',
    shortName: value.shortName ?? '',
    isLicensed: value.isLicensed ?? false,
  };
}
