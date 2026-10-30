import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { Mesh, Portnums } from '@meshtastic/protobufs';

import { isValidLatLon } from '@/shared/geoCoords';
import { bytesToHex } from '@/shared/hexBytes';
import {
  meshCorePacketFingerprintHex,
  meshCorePathInvariantPayloadId,
  parseMeshCoreRfPacket,
} from '@/shared/meshcoreRfPacketParse';

import type { OurPosition } from '../gpsSource';
import type { RxPacketEntry } from '../meshcore/meshcoreHookTypes';
import type { MeshtasticRawPacketEntry } from '../rawPacketLogConstants';
import { MS_PER_MINUTE } from '../timeConstants';
import type { MeshNode } from '../types';
import { type LiveTrafficControlSubtype, liveTrafficControlSubtype } from './liveTrafficControl';

export const LIVE_TRAFFIC_MAX_PACKETS = 200;
export const LIVE_TRAFFIC_MAX_AGE_MS = MS_PER_MINUTE;

export interface LiveTrafficPoint {
  nodeId: number | null;
  lat: number;
  lon: number;
  label: string;
}

export interface LiveTrafficSegment {
  from: LiveTrafficPoint;
  to: LiveTrafficPoint;
  /** Original zero-based route edge index; missing hops leave gaps in this sequence. */
  hopIndex?: number;
}

export interface LiveTrafficEvent {
  id: string;
  ts: number;
  kind: string;
  /** Discovery purpose does not identify a sender or imply that the full body was decoded. */
  controlSubtype?: LiveTrafficControlSubtype;
  source: 'RF' | 'MQTT' | 'Beacon' | 'CoreScope' | 'unknown';
  segments: LiveTrafficSegment[];
  points: LiveTrafficPoint[];
  routeStatus: 'resolved' | 'estimated' | 'partial' | 'unlocated' | 'direct' | 'unparsed';
  /** Packet-specific transport codes are not geographical region identifiers. */
  scopeCode: number | null;
  returnScopeCode: number | null;
  rssi: number;
  snr: number;
  hopCount: number | null;
  messageText?: string;
  senderLabel?: string;
  contentStatus?: 'encrypted' | 'unavailable' | 'decoded';
  packetHash?: string;
  /** Exact local wire identity for grouping; this is not a server or cryptographic hash. */
  packetIdentity?: string;
  observerId?: string;
  /** Separate connections to the same source may observe the same packet hash again. */
  sourceSessionId?: string;
  /** Upstream transmission time when the live event uses this client's receipt timestamp. */
  sourceFirstSeenTs?: number;
  /** Beacon's global server count, distinct from reports retained in the current view. */
  reportedObservationCount?: number;
}

export interface LiveTrafficBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** The node fields traffic geometry reads; a pop-out window receives only these. */
export type LiveTrafficNode = Pick<
  MeshNode,
  'long_name' | 'short_name' | 'latitude' | 'longitude' | 'public_key_hex'
>;

export interface LiveTrafficNodeIndex {
  points: ReadonlyMap<number, LiveTrafficPoint>;
  /** Sender identity is useful even when the contact has never shared a location. */
  labelsByNodeId?: ReadonlyMap<number, string>;
  /** A null value means multiple contacts share the prefix, including unlocated contacts. */
  nodesByPrefix: ReadonlyMap<string, number | null>;
  nodesByPublicKey: ReadonlyMap<string, number | null>;
}

function addUniqueKey(index: Map<string, number | null>, key: string, nodeId: number): void {
  const previous = index.get(key);
  index.set(key, previous === undefined || previous === nodeId ? nodeId : null);
}

function locatedPoint(
  nodeId: number | null,
  lat: number | null,
  lon: number | null,
  label: string,
): LiveTrafficPoint | null {
  if (lat == null || lon == null || !isValidLatLon(lat, lon) || (lat === 0 && lon === 0)) {
    return null;
  }
  return { nodeId, lat, lon, label };
}

/** Build once per node/public-key snapshot, then resolve each captured hop in constant time. */
export function buildLiveTrafficNodeIndex(
  nodes: ReadonlyMap<number, LiveTrafficNode>,
  pubKeyByNodeId?: ReadonlyMap<number, Uint8Array>,
  receiver?: { nodeId: number | null; position: OurPosition | null },
): LiveTrafficNodeIndex {
  const points = new Map<number, LiveTrafficPoint>();
  const labelsByNodeId = new Map<number, string>();
  const nodesByPrefix = new Map<string, number | null>();
  const nodesByPublicKey = new Map<string, number | null>();
  const publicKeys = new Map<number, string>();
  for (const [nodeId, node] of nodes) {
    const label = node.long_name || node.short_name || nodeId.toString(16);
    labelsByNodeId.set(nodeId, label);
    const point = locatedPoint(nodeId, node.latitude, node.longitude, label);
    if (point) points.set(nodeId, point);
    if (node.public_key_hex && /^[a-f\d]{64}$/i.test(node.public_key_hex)) {
      publicKeys.set(nodeId, node.public_key_hex.toLowerCase());
    }
  }
  // Include keys without positions/contact rows so a missing location cannot hide a collision.
  for (const [nodeId, key] of pubKeyByNodeId ?? []) {
    if (key.length === 32) publicKeys.set(nodeId, bytesToHex(key));
  }
  for (const [nodeId, key] of publicKeys) {
    addUniqueKey(nodesByPublicKey, key, nodeId);
    for (const width of [1, 2, 3]) addUniqueKey(nodesByPrefix, key.slice(0, width * 2), nodeId);
  }
  if (
    receiver?.nodeId != null &&
    receiver.nodeId > 0 &&
    receiver.position &&
    (receiver.position.source === 'static' || !points.has(receiver.nodeId))
  ) {
    const node = nodes.get(receiver.nodeId);
    const point = locatedPoint(
      receiver.nodeId,
      receiver.position.lat,
      receiver.position.lon,
      node?.long_name || node?.short_name || receiver.nodeId.toString(16),
    );
    if (point) points.set(receiver.nodeId, point);
  }
  return { points, labelsByNodeId, nodesByPrefix, nodesByPublicKey };
}

function sourceIdentity(
  packet: RxPacketEntry,
  index: LiveTrafficNodeIndex,
): { point: LiveTrafficPoint | null; label: string } | null {
  // Other encrypted payloads do not carry a complete origin public key.
  // The sniffer's heuristic fromNodeId alone is not evidence for drawing an origin link.
  if (packet.payloadTypeString !== 'ADVERT' && packet.payloadTypeString !== 'ANON_REQ') return null;
  if (packet.raw.length > 65_536) return null;
  const parsed = parseMeshCoreRfPacket(packet.raw);
  if (!parsed.ok || parsed.payloadTypeString !== packet.payloadTypeString) return null;
  const offset = packet.payloadTypeString === 'ANON_REQ' ? 1 : 0;
  const key = parsed.innerPayload.subarray(offset, offset + 32);
  if (key.length !== 32) return null;
  const keyHex = bytesToHex(key);
  const nodeId = index.nodesByPublicKey.get(keyHex);
  const known = nodeId == null ? null : (index.points.get(nodeId) ?? null);
  const knownLabel = nodeId == null ? null : index.labelsByNodeId?.get(nodeId);
  const label = knownLabel || known?.label || keyHex.slice(0, 8);
  if (packet.payloadTypeString === 'ADVERT') {
    const advertLabel = packet.advertName?.trim() || label;
    return {
      point: locatedPoint(nodeId ?? null, packet.advertLat, packet.advertLon, advertLabel) ?? known,
      label: advertLabel,
    };
  }
  return { point: known, label };
}

function nodeLabel(
  nodeId: number | null | undefined,
  index: LiveTrafficNodeIndex,
): string | undefined {
  if (nodeId == null || !Number.isInteger(nodeId) || nodeId <= 0 || nodeId > 0xffffffff)
    return undefined;
  return (
    index.labelsByNodeId?.get(nodeId) || index.points.get(nodeId)?.label || nodeId.toString(16)
  );
}

function uniquePoints(points: readonly (LiveTrafficPoint | null)[]): LiveTrafficPoint[] {
  const seen = new Set<string>();
  return points.filter((point): point is LiveTrafficPoint => {
    if (!point) return false;
    const key = `${point.nodeId}:${point.lat}:${point.lon}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function consecutiveSegments(points: readonly (LiveTrafficPoint | null)[]): LiveTrafficSegment[] {
  const segments: LiveTrafficSegment[] = [];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    if (!from || !to || (from.lat === to.lat && from.lon === to.lon)) continue;
    segments.push({ from, to, hopIndex: i - 1 });
  }
  return segments;
}

function eventId(
  protocol: string,
  packet: { ts: number; raw: Uint8Array },
  duplicateCounts: Map<string, number>,
): string {
  const key = `${protocol}:${packet.ts}:${meshCorePacketFingerprintHex(packet.raw)}`;
  const count = duplicateCounts.get(key) ?? 0;
  duplicateCounts.set(key, count + 1);
  return `${key}:${count}`;
}

/** Input ring buffers append in capture order. Never scan more than the last 200 entries. */
function recentPackets<T extends { ts: number }>(packets: readonly T[], now: number): T[] {
  return packets
    .slice(-LIVE_TRAFFIC_MAX_PACKETS)
    .filter((packet) => packet.ts <= now && now - packet.ts <= LIVE_TRAFFIC_MAX_AGE_MS);
}

function meshCorePacketIdentity(packet: RxPacketEntry): string | undefined {
  if (!packet.parseOk || packet.raw.length > 65_536) return undefined;
  const parsed = parseMeshCoreRfPacket(packet.raw);
  if (!parsed.ok || parsed.innerPayload.length === 0) return undefined;
  const payload = meshCorePathInvariantPayloadId(parsed.payloadTypeNibble, parsed.innerPayload);
  return JSON.stringify([
    'meshcore',
    parsed.routeTypeString,
    parsed.transportCodes,
    payload.payloadTypeNibble,
    bytesToHex(payload.innerPayload),
  ]);
}

function meshCoreControlSubtype(packet: RxPacketEntry): LiveTrafficControlSubtype | undefined {
  if (!packet.parseOk || packet.payloadTypeString !== 'CONTROL' || packet.raw.length > 65_536)
    return undefined;
  const parsed = parseMeshCoreRfPacket(packet.raw);
  return parsed.ok
    ? liveTrafficControlSubtype(parsed.payloadTypeString, undefined, parsed.innerPayload)
    : undefined;
}

function meshtasticPacketMetadata(
  entry: MeshtasticRawPacketEntry,
  index: LiveTrafficNodeIndex,
): Partial<
  Pick<LiveTrafficEvent, 'packetIdentity' | 'messageText' | 'senderLabel' | 'contentStatus'>
> {
  if (entry.raw.byteLength === 0 || entry.raw.byteLength > 65_536) return {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- The generated schema decodes a bounded capture; fields are validated below.
    const packet = fromBinary(Mesh.MeshPacketSchema, entry.raw) as {
      id?: number;
      from?: number;
      to?: number;
      channel?: number;
      payloadVariant?: { case?: string; value?: unknown };
    };
    if (entry.fromNodeId != null && packet.from !== entry.fromNodeId)
      return { senderLabel: undefined };
    const senderLabel = nodeLabel(packet.from, index);
    const variant = packet.payloadVariant;
    const decoded =
      variant?.case === 'decoded' && typeof variant.value === 'object' && variant.value !== null
        ? (variant.value as { portnum?: number; payload?: unknown })
        : null;
    const payload =
      decoded?.payload instanceof Uint8Array
        ? decoded.payload
        : variant?.case === 'encrypted' && variant.value instanceof Uint8Array
          ? variant.value
          : null;
    if (!payload) return { senderLabel };
    // Include all decoded Data fields (port, reply/request metadata, flags), not text alone.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- The decoded value originated from this generated schema.
    const identityPayload = decoded ? toBinary(Mesh.DataSchema, variant?.value as never) : payload;
    const identity =
      packet.from != null &&
      packet.from > 0 &&
      packet.id != null &&
      packet.id > 0 &&
      payload.length > 0
        ? JSON.stringify([
            'meshtastic',
            packet.from,
            packet.id,
            packet.to ?? 0,
            packet.channel ?? 0,
            variant?.case,
            bytesToHex(identityPayload),
          ])
        : undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- SDK enum is the authoritative protocol port number.
    if (decoded?.portnum === Portnums.PortNum.TEXT_MESSAGE_APP) {
      const messageText = new TextDecoder().decode(payload).slice(0, 1_000);
      return {
        packetIdentity: identity,
        senderLabel,
        ...(messageText
          ? {
              messageText,
              contentStatus: 'decoded' as const,
            }
          : { contentStatus: 'unavailable' as const }),
      };
    }
    return { packetIdentity: identity, senderLabel };
  } catch {
    // catch-no-log-ok Corrupt captures remain distinct traffic observations without guessed content.
    return {};
  }
}

export function buildLiveTrafficEvents(
  packets: readonly RxPacketEntry[],
  index: LiveTrafficNodeIndex,
  myNodeNum: number | null,
  now: number,
): LiveTrafficEvent[] {
  const duplicateCounts = new Map<string, number>();
  return recentPackets(packets, now).map((packet) => {
    const source = packet.source === 'rf' ? 'RF' : packet.source === 'mqtt' ? 'MQTT' : 'unknown';
    const identity = packet.parseOk ? sourceIdentity(packet, index) : null;
    const origin = identity?.point ?? null;
    const receiver =
      source === 'RF' && myNodeNum != null ? (index.points.get(myNodeNum) ?? null) : null;
    const flood =
      packet.routeTypeString === 'FLOOD' || packet.routeTypeString === 'TRANSPORT_FLOOD';
    const route: (LiveTrafficPoint | null)[] = [origin];
    const width = packet.pathHashSizeBytes;
    const validPath =
      packet.parseOk &&
      [1, 2, 3].includes(width) &&
      packet.hopCount >= 0 &&
      packet.hopCount <= 63 &&
      packet.pathBytes.length === packet.hopCount * width &&
      packet.pathBytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);
    if (flood && validPath) {
      for (let i = 0; i < packet.pathBytes.length; i += width) {
        const nodeId = index.nodesByPrefix.get(bytesToHex(packet.pathBytes.slice(i, i + width)));
        route.push(nodeId == null ? null : (index.points.get(nodeId) ?? null));
      }
    } else if (flood) {
      route.push(null);
    }
    if (source === 'RF') route.push(receiver);
    const points = uniquePoints(route);
    // DIRECT stores remaining routing instructions, not a record of the traversed route.
    const segments = flood && validPath ? consecutiveSegments(route) : [];
    const routeStatus: LiveTrafficEvent['routeStatus'] = !packet.parseOk
      ? 'unparsed'
      : !flood
        ? 'direct'
        : points.length === 0
          ? 'unlocated'
          : validPath && route.every((point) => point !== null)
            ? 'resolved'
            : 'partial';
    return {
      id: eventId('mc', packet, duplicateCounts),
      packetIdentity: meshCorePacketIdentity(packet),
      ts: packet.ts,
      kind: packet.payloadTypeString ?? 'UNKNOWN',
      controlSubtype: meshCoreControlSubtype(packet),
      source,
      ...(identity ? { senderLabel: identity.label } : {}),
      ...(source === 'RF' && myNodeNum != null && myNodeNum > 0
        ? { observerId: `radio:${myNodeNum}` }
        : {}),
      segments,
      points,
      routeStatus,
      scopeCode: packet.transportScopeCode,
      returnScopeCode: packet.transportReturnCode,
      rssi: packet.rssi,
      snr: packet.snr,
      hopCount: packet.parseOk ? packet.hopCount : null,
      ...(packet.payloadTypeString === 'GRP_TXT' || packet.payloadTypeString === 'TXT_MSG'
        ? { contentStatus: 'unavailable' as const }
        : {}),
    };
  });
}

export function buildMeshtasticLiveTrafficEvents(
  packets: readonly MeshtasticRawPacketEntry[],
  index: LiveTrafficNodeIndex,
  myNodeNum: number | null,
  now: number,
): LiveTrafficEvent[] {
  const duplicateCounts = new Map<string, number>();
  return recentPackets(packets, now)
    .filter((packet) => !packet.isLocal)
    .map((packet) => {
      const origin =
        packet.fromNodeId == null ? null : (index.points.get(packet.fromNodeId) ?? null);
      const receiver =
        !packet.viaMqtt && myNodeNum != null ? (index.points.get(myNodeNum) ?? null) : null;
      const direct = !packet.viaMqtt && packet.hopsAway === 0 && packet.fromNodeId !== myNodeNum;
      const points = uniquePoints([origin, receiver]);
      const segments = direct ? consecutiveSegments([origin, receiver]) : [];
      return {
        id: eventId('mt', packet, duplicateCounts),
        ts: packet.ts,
        kind: packet.portLabel,
        source: packet.viaMqtt ? 'MQTT' : 'RF',
        ...(!packet.viaMqtt && myNodeNum != null && myNodeNum > 0
          ? { observerId: `radio:${myNodeNum}` }
          : {}),
        segments,
        points,
        routeStatus: segments.length > 0 ? 'resolved' : points.length > 0 ? 'partial' : 'unlocated',
        scopeCode: null,
        returnScopeCode: null,
        rssi: packet.rssi,
        snr: packet.snr,
        hopCount: packet.hopsAway ?? null,
        senderLabel: nodeLabel(packet.fromNodeId, index),
        ...meshtasticPacketMetadata(packet, index),
      };
    });
}

/** Preserve geographic identity while drawing its nearest wrapped world copy. */
export function liveTrafficLongitudeNear(longitude: number, reference: number): number {
  return longitude + Math.round((reference - longitude) / 360) * 360;
}

/** Fit the smallest longitude arc by excluding the largest gap between points. */
export function liveTrafficFitCoordinates(points: readonly LiveTrafficPoint[]): [number, number][] {
  if (points.length < 2) return points.map((point) => [point.lat, point.lon]);
  const longitudes = points.map((point) => point.lon).sort((a, b) => a - b);
  let largestGap = -1;
  let start = longitudes[0];
  for (let i = 0; i < longitudes.length; i++) {
    const next = longitudes[(i + 1) % longitudes.length];
    const gap = next + (i === longitudes.length - 1 ? 360 : 0) - longitudes[i];
    if (gap > largestGap) {
      largestGap = gap;
      start = next;
    }
  }
  const center = start + (360 - largestGap) / 2;
  return points.map((point) => [point.lat, liveTrafficLongitudeNear(point.lon, center)]);
}

const FIT_TRIM_MIN_POINTS = 20;
const FIT_TRIM_KEEP_SHARE = 0.95;
const FIT_TRIM_RADIUS_FACTOR = 3;
const FIT_TRIM_MIN_RADIUS_DEGREES = 2;

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Leave out a few isolated far-away positions before framing a node directory. Regional
 * directories often carry a handful of nodes with placeholder or stale positions on another
 * continent (the Colorado Beacon directory has one near the North Pole), and fitting those shows
 * half the planet instead of the mesh. A point is left out only when it is outside the nearest
 * 95% of points and more than three times that radius from the median, and never closer than
 * 2 degrees, so a widely spread mesh is framed whole.
 */
export function liveTrafficFitCorePoints(
  points: readonly LiveTrafficPoint[],
): readonly LiveTrafficPoint[] {
  if (points.length < FIT_TRIM_MIN_POINTS) return points;
  const coordinates = liveTrafficFitCoordinates(points);
  const centerLat = median(coordinates.map(([lat]) => lat).sort((a, b) => a - b));
  const centerLon = median(coordinates.map(([, lon]) => lon).sort((a, b) => a - b));
  const lonScale = Math.cos((centerLat * Math.PI) / 180);
  const distances = coordinates.map(([lat, lon]) =>
    Math.hypot(lat - centerLat, (lon - centerLon) * lonScale),
  );
  const sorted = [...distances].sort((a, b) => a - b);
  const keepRadius = sorted[Math.ceil(sorted.length * FIT_TRIM_KEEP_SHARE) - 1];
  const limit = Math.max(keepRadius * FIT_TRIM_RADIUS_FACTOR, FIT_TRIM_MIN_RADIUS_DEGREES);
  return points.filter((_, index) => distances[index] <= limit);
}

export function pointInLiveTrafficBounds(
  point: LiveTrafficPoint,
  bounds: LiveTrafficBounds,
): boolean {
  if (point.lat < bounds.south || point.lat > bounds.north) return false;
  // Leaflet keeps unwrapped longitude bounds when the map crosses the dateline or
  // pans into another world copy. Compare circular distances from the western edge.
  const width = bounds.east - bounds.west;
  if (Math.abs(width) >= 360) return true;
  const span = ((width % 360) + 360) % 360;
  const offset = (((point.lon - bounds.west) % 360) + 360) % 360;
  return offset <= span;
}

export interface LiveTrafficFilter {
  /** Omit for all regions. Custom/viewport bounds use the same coordinate filter as presets. */
  bounds?: LiveTrafficBounds | null;
  scope?: 'all' | 'unscoped' | 'scoped' | number;
}

export function filterLiveTrafficEvents(
  events: readonly LiveTrafficEvent[],
  filter: LiveTrafficFilter,
): LiveTrafficEvent[] {
  const bounds = filter.bounds;
  return events.filter((event) => {
    if (bounds && !event.points.some((point) => pointInLiveTrafficBounds(point, bounds))) {
      return false;
    }
    if (filter.scope === 'unscoped') return event.scopeCode == null;
    if (filter.scope === 'scoped') return event.scopeCode != null;
    return typeof filter.scope !== 'number' || event.scopeCode === filter.scope;
  });
}
