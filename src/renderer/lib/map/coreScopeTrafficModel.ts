import { isValidLatLon } from '@/shared/geoCoords';
import { bytesToHex, hexToBytesLenient } from '@/shared/hexBytes';
import { parseMeshCoreRfPacket } from '@/shared/meshcoreRfPacketParse';

import { BEACON_MESSAGE_PREVIEW_MAX_LENGTH, type BeaconTrafficMessage } from './beaconTrafficModel';
import { liveTrafficControlSubtype } from './liveTrafficControl';
import {
  LIVE_TRAFFIC_MAX_AGE_MS,
  type LiveTrafficEvent,
  type LiveTrafficPoint,
  type LiveTrafficSegment,
} from './liveTrafficModel';

export interface CoreScopeTrafficPoint extends LiveTrafficPoint {
  publicKey: string;
}

export interface CoreScopeTrafficNodeIndex {
  points: readonly CoreScopeTrafficPoint[];
  pointsByPublicKey: ReadonlyMap<string, CoreScopeTrafficPoint | null>;
  /** Origin labels do not require GPS or a drawable route. */
  labelsByPublicKey?: ReadonlyMap<string, string>;
  /** Collisions include unlocated nodes; server route heuristics cannot hide them. */
  keysByPrefix: ReadonlyMap<string, string | null>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, limit = 160): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= limit ? value : null;
}

function publicKey(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f\d]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timestamp(value: unknown): number | null {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

function pointFromNode(node: Record<string, unknown>, key: string): CoreScopeTrafficPoint | null {
  const lat = finiteNumber(node.lat);
  const lon = finiteNumber(node.lon);
  return lat != null && lon != null && isValidLatLon(lat, lon) && (lat !== 0 || lon !== 0)
    ? { nodeId: null, publicKey: key, label: text(node.name) ?? key.slice(0, 8), lat, lon }
    : null;
}

/** Build once for each directory snapshot, never scan every node for each packet. */
export function buildCoreScopeTrafficNodeIndex(
  nodes: readonly unknown[],
  observers: readonly unknown[] = [],
): CoreScopeTrafficNodeIndex {
  const pointsByPublicKey = new Map<string, CoreScopeTrafficPoint | null>();
  const labelsByPublicKey = new Map<string, string>();
  const conflictingLocations = new Set<string>();
  const keysByPrefix = new Map<string, string | null>();
  const entries = [
    ...nodes,
    ...observers.flatMap((value) => {
      const observer = record(value);
      const key = publicKey(observer?.id);
      return observer && key ? [{ ...observer, public_key: key }] : [];
    }),
  ];
  for (const value of entries) {
    const node = record(value);
    const key = publicKey(node?.public_key);
    if (!node || !key) continue;
    labelsByPublicKey.set(key, text(node.name) ?? labelsByPublicKey.get(key) ?? key.slice(0, 8));
    const point = pointFromNode(node, key);
    const previous = pointsByPublicKey.get(key);
    if (point && previous && (point.lat !== previous.lat || point.lon !== previous.lon))
      conflictingLocations.add(key);
    // A sparse observer roster is not contrary location evidence. Two valid, conflicting
    // positions remain unknown; no nearest/freshest guess is made between them.
    pointsByPublicKey.set(key, conflictingLocations.has(key) ? null : (point ?? previous ?? null));
    for (const width of [1, 2, 3]) {
      const prefix = key.slice(0, width * 2);
      const previousKey = keysByPrefix.get(prefix);
      keysByPrefix.set(prefix, previousKey === undefined || previousKey === key ? key : null);
    }
  }
  return {
    points: [...pointsByPublicKey.values()].filter(
      (point): point is CoreScopeTrafficPoint => point !== null,
    ),
    pointsByPublicKey,
    labelsByPublicKey,
    keysByPrefix,
  };
}

function packetRecord(value: unknown): Record<string, unknown> | null {
  const input = record(value);
  if (!input) return null;
  const packet = input.type === 'packet' ? record(input.data) : input;
  return packet ? { ...record(packet.packet), ...packet } : null;
}

function decodedPayload(packet: Record<string, unknown>): Record<string, unknown> | null {
  const decoded = record(record(packet.decoded)?.payload);
  if (decoded) return decoded;
  const json = text(packet.decoded_json, 65_536);
  if (!json) return null;
  try {
    return record(JSON.parse(json));
  } catch {
    // catch-no-log-ok Malformed public feed metadata is ignored, never executed or displayed raw.
    return null;
  }
}

function observationPath(value: unknown): string[] | null {
  const json = text(value, 1_024);
  if (!json) return null;
  let path: unknown;
  try {
    path = JSON.parse(json);
  } catch {
    // catch-no-log-ok Invalid observation paths remain unlocated rather than reusing transmission geometry.
    return null;
  }
  if (!Array.isArray(path) || path.length > 63) return null;
  const hashes: string[] = [];
  for (const entry of path) {
    if (
      typeof entry !== 'string' ||
      !/^(?:[a-f\d]{2}|[a-f\d]{4}|[a-f\d]{6})$/i.test(entry) ||
      (hashes.length > 0 && entry.length !== hashes[0].length)
    )
      return null;
    hashes.push(entry.toLowerCase());
  }
  return hashes;
}

/** Public channel text is supplied by CoreScope; encrypted summaries are never message bodies. */
export function normalizeCoreScopeMessage(value: unknown): BeaconTrafficMessage | null {
  const packet = packetRecord(value);
  if (!packet) return null;
  const packetHash = text(packet.hash, 128)?.toLowerCase();
  const payload = decodedPayload(packet);
  if (
    !packetHash ||
    payload?.type !== 'CHAN' ||
    payload.decryptionStatus !== 'decrypted' ||
    typeof payload.text !== 'string' ||
    payload.text.length === 0
  )
    return null;
  const senderLabel = text(payload.sender);
  const sentAtSeconds = finiteNumber(payload.sender_timestamp);
  const sentAt = sentAtSeconds == null ? null : sentAtSeconds * 1_000;
  return {
    packetHash,
    messageText: payload.text.slice(0, BEACON_MESSAGE_PREVIEW_MAX_LENGTH),
    ...(senderLabel ? { senderLabel } : {}),
    sentAt: sentAt != null && Number.isFinite(sentAt) ? sentAt : null,
  };
}

function consecutiveSegments(
  route: readonly (CoreScopeTrafficPoint | null)[],
): LiveTrafficSegment[] {
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

/** CoreScope repeats transmission first_seen on WebSocket observations; live callers supply receipt time. */
export function normalizeCoreScopeObservation(
  value: unknown,
  index: CoreScopeTrafficNodeIndex,
  now: number,
  messages?: ReadonlyMap<string, BeaconTrafficMessage>,
  options?: { receivedAt: number },
): LiveTrafficEvent | null {
  const packet = packetRecord(value);
  if (!packet) return null;
  const packetHash = text(packet.hash, 128)?.toLowerCase();
  const sourceFirstSeenTs = timestamp(packet.timestamp) ?? timestamp(packet.first_seen);
  const ts = options ? finiteNumber(options.receivedAt) : sourceFirstSeenTs;
  if (!packetHash || ts == null || ts > now || now - ts > LIVE_TRAFFIC_MAX_AGE_MS) return null;
  const rawHex =
    typeof packet.raw_hex === 'string' &&
    packet.raw_hex.length <= 8_192 &&
    packet.raw_hex.length % 2 === 0 &&
    /^[a-f\d]+$/i.test(packet.raw_hex)
      ? packet.raw_hex.toLowerCase()
      : null;
  const parsed = rawHex ? parseMeshCoreRfPacket(hexToBytesLenient(rawHex)) : null;
  const validRaw = parsed?.ok && [1, 2, 3].includes(parsed.pathHashSizeBytes);
  const path = observationPath(packet.path_json);
  const routeType =
    typeof packet.route_type === 'number' &&
    Number.isInteger(packet.route_type) &&
    packet.route_type >= 0 &&
    packet.route_type <= 3
      ? packet.route_type
      : null;
  const valid = path !== null && routeType !== null;
  const flood = valid && (routeType === 0 || routeType === 1);
  const observerId = publicKey(packet.observer_id) ?? text(packet.observer_id, 128);
  const observerKey = publicKey(observerId);
  const receiver = observerKey ? (index.pointsByPublicKey.get(observerKey) ?? null) : null;
  let source: CoreScopeTrafficPoint | null = null;
  let senderLabel: string | undefined;
  if (
    validRaw &&
    (parsed.payloadTypeString === 'ADVERT' || parsed.payloadTypeString === 'ANON_REQ')
  ) {
    const offset = parsed.payloadTypeString === 'ANON_REQ' ? 1 : 0;
    const keyBytes = parsed.innerPayload.subarray(offset, offset + 32);
    if (keyBytes.length === 32) {
      const key = bytesToHex(keyBytes);
      source = index.pointsByPublicKey.get(key) ?? null;
      const payload = parsed.payloadTypeString === 'ADVERT' ? decodedPayload(packet) : null;
      const decodedName = publicKey(payload?.pubKey) === key ? text(payload?.name) : null;
      senderLabel =
        text(parsed.advert?.name) ??
        decodedName ??
        index.labelsByPublicKey?.get(key) ??
        source?.label ??
        key.slice(0, 8);
      // The advert's own coordinates describe this observation, including a newly seen or
      // moving node. Directory positions are only a fallback when it supplies no valid fix.
      if (parsed.advert && bytesToHex(parsed.advert.publicKey) === key) {
        source =
          pointFromNode(
            {
              name: senderLabel,
              lat: parsed.advert.latitudeDeg,
              lon: parsed.advert.longitudeDeg,
            },
            key,
          ) ?? source;
      }
    }
  }
  const route: (CoreScopeTrafficPoint | null)[] = [source];
  const estimatedHops = new Set<number>();
  if (flood) {
    const resolved = Array.isArray(packet.resolved_path) ? packet.resolved_path : null;
    for (let i = 0; i < path.length; i++) {
      const prefix = path[i];
      const key = index.keysByPrefix.get(prefix);
      const resolvedKey = resolved ? publicKey(resolved[i]) : null;
      const candidateKey = resolved ? resolvedKey : key;
      const point = candidateKey?.startsWith(prefix)
        ? (index.pointsByPublicKey.get(candidateKey) ?? null)
        : null;
      // CoreScope's chosen candidate is an estimate on colliding prefixes. Never choose
      // a candidate locally, bridge null resolutions, or promote an estimate to confirmed.
      if (point && key === null && resolvedKey) estimatedHops.add(i + 1);
      route.push(point);
    }
  }
  route.push(receiver);
  const points = [
    ...new Map(
      route
        .filter((point): point is CoreScopeTrafficPoint => point !== null)
        .map((point) => [point.publicKey, point]),
    ).values(),
  ];
  const segments = flood ? consecutiveSegments(route) : [];
  const estimated = estimatedHops.size > 0;
  const kind = validRaw
    ? parsed.payloadTypeString
    : (
        text(record(record(packet.decoded)?.header)?.payloadTypeName, 48) ?? 'UNKNOWN'
      ).toUpperCase();
  const payload = decodedPayload(packet);
  const controlSubtype = liveTrafficControlSubtype(
    kind,
    payload?.ctrlSubtype,
    validRaw ? parsed.innerPayload : payload?.raw,
  );
  const message = normalizeCoreScopeMessage(packet) ?? messages?.get(packetHash);
  const reportedObservationCount = finiteNumber(packet.observation_count);
  const transmissionId =
    typeof packet.id === 'number' && Number.isSafeInteger(packet.id)
      ? String(packet.id)
      : (text(packet.id) ?? '');
  const pathIdentity = valid ? `${routeType}:${path.join(',')}` : 'unknown';
  return {
    id: `corescope:${packetHash}:${observerId ?? 'unknown'}:${pathIdentity}:${sourceFirstSeenTs ?? 'unknown'}:${transmissionId}`,
    packetHash,
    ...(observerId ? { observerId } : {}),
    ts,
    ...(sourceFirstSeenTs != null && sourceFirstSeenTs <= now ? { sourceFirstSeenTs } : {}),
    kind,
    controlSubtype,
    source: 'CoreScope',
    ...(senderLabel ? { senderLabel } : {}),
    segments,
    points,
    routeStatus: !valid
      ? 'unparsed'
      : !flood
        ? 'direct'
        : points.length === 0
          ? 'unlocated'
          : estimated
            ? 'estimated'
            : route.every((point) => point !== null)
              ? 'resolved'
              : 'partial',
    scopeCode: validRaw ? (parsed.transportCodes?.[0] ?? null) : null,
    returnScopeCode: validRaw ? (parsed.transportCodes?.[1] ?? null) : null,
    rssi: finiteNumber(packet.rssi) ?? Number.NaN,
    snr: finiteNumber(packet.snr) ?? Number.NaN,
    hopCount: path?.length ?? null,
    ...(reportedObservationCount != null &&
    Number.isSafeInteger(reportedObservationCount) &&
    reportedObservationCount > 0
      ? { reportedObservationCount }
      : {}),
    ...(message
      ? {
          messageText: message.messageText,
          senderLabel: message.senderLabel,
          contentStatus: 'decoded' as const,
        }
      : kind === 'GRP_TXT' || kind === 'TXT_MSG'
        ? { contentStatus: 'unavailable' as const }
        : {}),
  };
}
