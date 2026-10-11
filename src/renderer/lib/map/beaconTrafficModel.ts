import { isValidLatLon } from '@/shared/geoCoords';

import { liveTrafficControlSubtype } from './liveTrafficControl';
import {
  LIVE_TRAFFIC_MAX_AGE_MS,
  LIVE_TRAFFIC_MAX_PACKETS,
  type LiveTrafficEvent,
  type LiveTrafficPoint,
  type LiveTrafficSegment,
} from './liveTrafficModel';

export interface BeaconTrafficPoint extends LiveTrafficPoint {
  /** Beacon UUIDs are not local radio node numbers. */
  beaconNodeId: string | null;
  publicKey: string;
}

export interface BeaconTrafficNodeIndex {
  points: readonly BeaconTrafficPoint[];
  pointsByPublicKey: ReadonlyMap<string, BeaconTrafficPoint | null>;
  observerKeysById: ReadonlyMap<string, string | null>;
}

export interface BeaconTrafficMessage {
  packetHash: string;
  messageText: string;
  senderLabel?: string;
  /** Sender clock metadata; never used to make an observation look newly received. */
  sentAt: number | null;
}

export const BEACON_MESSAGE_PREVIEW_MAX_LENGTH = 1_000;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maxLength = 160): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null;
}

function publicKey(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f\d]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pointFromNode(value: unknown, directory = false): BeaconTrafficPoint | null {
  const node = record(value);
  if (!node) return null;
  const key = publicKey(node.publicKey);
  const lat = finiteNumber(directory ? node.lat : node.latitude);
  const lon = finiteNumber(directory ? node.lng : node.longitude);
  if (!key || lat == null || lon == null || !isValidLatLon(lat, lon) || (lat === 0 && lon === 0)) {
    return null;
  }
  return {
    nodeId: null,
    beaconNodeId: text(node.id),
    publicKey: key,
    label: text(node.name) ?? key.slice(0, 8),
    lat,
    lon,
  };
}

/** Index directory coordinates only; IATA/region centroids are never node locations. */
export function buildBeaconTrafficNodeIndex(
  nodes: readonly unknown[],
  observers: readonly unknown[] = [],
): BeaconTrafficNodeIndex {
  const pointsByPublicKey = new Map<string, BeaconTrafficPoint | null>();
  for (const value of nodes) {
    const node = record(value);
    const key = publicKey(node?.publicKey);
    if (!key) continue;
    const point = pointFromNode(node, true);
    const previous = pointsByPublicKey.get(key);
    if (
      pointsByPublicKey.has(key) &&
      (!point || point.lat !== previous?.lat || point.lon !== previous.lon)
    ) {
      pointsByPublicKey.set(key, null);
    } else pointsByPublicKey.set(key, point);
  }
  const observerKeysById = new Map<string, string | null>();
  for (const value of observers) {
    const observer = record(value);
    const id = text(observer?.id);
    const key = publicKey(observer?.publicKey);
    if (!id || !key) continue;
    const previous = observerKeysById.get(id);
    observerKeysById.set(id, previous === undefined || previous === key ? key : null);
  }
  return {
    points: [...pointsByPublicKey.values()].filter(
      (point): point is BeaconTrafficPoint => point !== null,
    ),
    pointsByPublicKey,
    observerKeysById,
  };
}

function resolvedNode(value: unknown): Record<string, unknown> | null {
  const resolution = record(value);
  // Even a high flag with multiple candidates is not a uniquely resolved hop.
  if (
    resolution?.confidence !== 'high' ||
    !Array.isArray(resolution.nodes) ||
    resolution.nodes.length !== 1
  ) {
    return null;
  }
  return record(resolution.nodes[0]);
}

function resolvedPoint(value: unknown, prefix?: string): BeaconTrafficPoint | null {
  const point = pointFromNode(resolvedNode(value));
  return point && (!prefix || point.publicKey.startsWith(prefix)) ? point : null;
}

function originLabel(observation: Record<string, unknown>, kind: string): string | null {
  const source = resolvedNode(observation.resolvedSource);
  const sourceKey = publicKey(source?.publicKey);
  const parsed = record(observation.parsedPayload);
  // Beacon's ADVERT summary is the verified advertised name; other summaries are not senders.
  const advertisedName =
    kind === 'ADVERT'
      ? ((parsed?.type === 'ADVERT' ? text(record(parsed.appData)?.name) : null) ??
        text(observation.summary))
      : null;
  const originKey = publicKey(observation.originPubkey);
  return (
    advertisedName ??
    (sourceKey ? (text(source?.name) ?? sourceKey.slice(0, 8)) : null) ??
    originKey?.slice(0, 8) ??
    null
  );
}

function receiverPoint(
  observation: Record<string, unknown>,
  index: BeaconTrafficNodeIndex,
): BeaconTrafficPoint | null {
  const observerId = text(observation.observerId);
  const key =
    publicKey(observation.observerPublicKey) ??
    (observerId ? index.observerKeysById.get(observerId) : null);
  return key ? (index.pointsByPublicKey.get(key) ?? null) : null;
}

function uniquePoints(route: readonly (BeaconTrafficPoint | null)[]): BeaconTrafficPoint[] {
  const seen = new Set<string>();
  return route.filter((point): point is BeaconTrafficPoint => {
    if (!point || seen.has(point.publicKey)) return false;
    seen.add(point.publicKey);
    return true;
  });
}

function consecutiveSegments(route: readonly (BeaconTrafficPoint | null)[]): LiveTrafficSegment[] {
  const segments: LiveTrafficSegment[] = [];
  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1];
    const to = route[i];
    if (
      !from ||
      !to ||
      from.publicKey === to.publicKey ||
      (from.lat === to.lat && from.lon === to.lon)
    )
      continue;
    segments.push({ from, to, hopIndex: i - 1 });
  }
  return segments;
}

function scopeCode(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff
    ? value
    : null;
}

function routeType(observation: Record<string, unknown>): number | null {
  const header = record(observation.header);
  const value = header?.routeType ?? observation.routeType;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3)
    return value;
  const name = header?.routeTypeName ?? observation.routeTypeName;
  if (name === 'TRANSPORT_FLOOD') return 0;
  if (name === 'FLOOD') return 1;
  if (name === 'DIRECT') return 2;
  if (name === 'TRANSPORT_DIRECT') return 3;
  return null;
}

function observationRecord(value: unknown): Record<string, unknown> | null {
  const input = record(value);
  if (!input) return null;
  const payload =
    input.type === 'event' && input.event === 'packetObservation' ? record(input.data) : input;
  if (!payload) return null;
  const observation = record(payload.observation);
  if (!observation) return payload;
  return { ...record(payload.packet), ...observation, packetHash: payload.packetHash };
}

/** Plaintext comes from Beacon's channelMessage event, never from packet summaries. */
export function normalizeBeaconMessage(value: unknown): BeaconTrafficMessage | null {
  const input = record(value);
  if (!input) return null;
  const message =
    input.type === 'event' && input.event === 'channelMessage' ? record(input.data) : input;
  if (!message) return null;
  const packetHash = text(message.packetHash, 128)?.toLowerCase();
  const decrypted =
    message.decrypted === true ? record(record(message.parsedPayload)?.decrypted) : null;
  const content = decrypted?.content ?? message.content;
  if (!packetHash || typeof content !== 'string' || content.length === 0) return null;
  const senderLabel = text(decrypted?.sender ?? message.senderName);
  return {
    packetHash,
    messageText: content.slice(0, BEACON_MESSAGE_PREVIEW_MAX_LENGTH),
    ...(senderLabel ? { senderLabel } : {}),
    sentAt: finiteNumber(decrypted?.sentAt ?? message.sentAt),
  };
}

/** Normalize one Beacon v2 observation; callers retain the server's per-observer timestamp. */
export function normalizeBeaconObservation(
  value: unknown,
  index: BeaconTrafficNodeIndex,
  now: number,
  messages?: ReadonlyMap<string, BeaconTrafficMessage>,
): LiveTrafficEvent | null {
  const observation = observationRecord(value);
  if (!observation) return null;
  const packetHash = text(observation.packetHash, 128)?.toLowerCase();
  const ts = finiteNumber(observation.heardAt);
  if (!packetHash || ts == null || ts > now || now - ts > LIVE_TRAFFIC_MAX_AGE_MS) return null;
  const header = record(observation.header);
  const kind = (
    text(header?.payloadTypeName, 48) ??
    text(observation.payloadTypeName, 48) ??
    'UNKNOWN'
  ).toUpperCase();
  const parsedPayload = record(observation.parsedPayload);
  const controlSubtype = liveTrafficControlSubtype(
    kind,
    parsedPayload?.type,
    observation.rawPayload ?? parsedPayload?.raw,
  );
  const type = routeType(observation);
  const flood = type === 0 || type === 1;
  const direct = type === 2 || type === 3;
  const source = resolvedPoint(observation.resolvedSource);
  const receiver = receiverPoint(observation, index);
  const pathLength = record(observation.pathLength);
  const hopCount = finiteNumber(pathLength?.hopCount);
  const hashSize = finiteNumber(pathLength?.hashSize);
  const pathBytes =
    typeof observation.pathBytes === 'string' &&
    observation.pathBytes.length <= 378 &&
    observation.pathBytes.length % 2 === 0 &&
    /^[a-f\d]*$/i.test(observation.pathBytes)
      ? observation.pathBytes.toLowerCase()
      : null;
  const resolvedPath = Array.isArray(observation.resolvedPath) ? observation.resolvedPath : [];
  const validPath =
    hopCount != null &&
    Number.isInteger(hopCount) &&
    hopCount >= 0 &&
    hopCount <= 63 &&
    hashSize != null &&
    [1, 2, 3].includes(hashSize) &&
    pathBytes?.length === hopCount * hashSize * 2 &&
    resolvedPath.length === hopCount;
  const route: (BeaconTrafficPoint | null)[] = [source];
  if (flood && validPath) {
    for (let i = 0; i < resolvedPath.length; i++) {
      route.push(
        resolvedPoint(resolvedPath[i], pathBytes.slice(i * hashSize * 2, (i + 1) * hashSize * 2)),
      );
    }
  } else if (flood) route.push(null);
  route.push(receiver);
  // A destination address is not evidence that an overheard packet reached that destination.
  // DIRECT hashes are remaining routing instructions, never a traversed geographic path.
  const points = uniquePoints(route);
  const segments = flood && validPath ? consecutiveSegments(route) : [];
  const status: LiveTrafficEvent['routeStatus'] =
    type == null
      ? 'unparsed'
      : direct
        ? 'direct'
        : points.length === 0
          ? 'unlocated'
          : validPath && route.every((point) => point !== null)
            ? 'resolved'
            : 'partial';
  const observer =
    text(observation.observerId) ?? publicKey(observation.observerPublicKey) ?? 'unknown';
  const observationId =
    typeof observation.id === 'number' && Number.isSafeInteger(observation.id)
      ? observation.id.toString()
      : (text(observation.id) ?? '');
  // Retain different routes, receivers, and repeat observations of the same payload.
  const id = `beacon:${packetHash}:${observer}:${pathBytes ?? 'unknown'}:${ts}:${observationId}`;
  const message = messages?.get(packetHash);
  const senderLabel = message?.senderLabel ?? originLabel(observation, kind);
  const isTextPacket = kind === 'GRP_TXT' || kind === 'TXT_MSG';
  const reportedObservationCount = finiteNumber(observation.observationCount);
  return {
    id,
    packetHash,
    ...(observer !== 'unknown' ? { observerId: observer } : {}),
    ...(reportedObservationCount != null &&
    Number.isSafeInteger(reportedObservationCount) &&
    reportedObservationCount > 0
      ? { reportedObservationCount }
      : {}),
    ts,
    kind,
    controlSubtype,
    source: 'Beacon',
    segments,
    points,
    routeStatus: status,
    scopeCode: scopeCode(observation.transportScopeCode),
    returnScopeCode: scopeCode(observation.transportReturnCode),
    rssi: finiteNumber(observation.rssi) ?? Number.NaN,
    snr: finiteNumber(observation.snr) ?? Number.NaN,
    hopCount: validPath ? hopCount : null,
    ...(senderLabel ? { senderLabel } : {}),
    ...(message
      ? {
          messageText: message.messageText,
          contentStatus: 'decoded' as const,
        }
      : isTextPacket
        ? { contentStatus: 'unavailable' as const }
        : {}),
  };
}

/** Bounded, chronological feed; exact server retransmissions reuse their observation identity. */
export function normalizeBeaconObservations(
  values: readonly unknown[],
  index: BeaconTrafficNodeIndex,
  now: number,
  messages?: ReadonlyMap<string, BeaconTrafficMessage>,
): LiveTrafficEvent[] {
  const events = new Map<string, LiveTrafficEvent>();
  for (const value of values.slice(-LIVE_TRAFFIC_MAX_PACKETS)) {
    const event = normalizeBeaconObservation(value, index, now, messages);
    if (event) events.set(event.id, event);
  }
  return [...events.values()].sort((a, b) => a.ts - b.ts);
}
