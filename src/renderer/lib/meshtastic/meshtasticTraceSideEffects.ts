/**
 * Traceroute reply correlation driven by the `PacketRouter` `trace_route` event.
 *
 * `MeshtasticProtocol` decodes both wire shapes (RouteDiscovery inside a decoded
 * MeshPacket, and the typed `onTraceRoutePacket`), so this module replaces the
 * two duplicate `device.events.on*` subscriptions the runtime used to own.
 *
 * Failure point: none — correlation maps are best effort and expire on a 2 minute
 * cutoff, so a dropped reply only means the row is keyed by mesh `from`.
 */
import type { Dispatch, RefObject, SetStateAction } from 'react';

import { attachTypedPacketListener } from '../drivers/attachTypedPacketListener';
import {
  mergeMeshtasticTraceRouteIntoResultsMap,
  type MeshtasticTraceRouteEntry,
  meshtasticTraceRouteLookupKeys,
} from '../meshtasticTraceRouteLookupKeys';
import type { DomainEvent } from '../protocols/Protocol';
import { trimMapToMaxSize } from '../sessionMemoryCaps';
import type { IdentityId } from '../types';

const PENDING_TRACE_TTL_MS = 2 * 60_000;

/**
 * Ceiling on outstanding trace correlations. Replies prune their own entries,
 * but a session that fires traces at unreachable nodes never gets a reply, so
 * the maps also need a hard bound.
 */
const MAX_PENDING_TRACE_ENTRIES = 128;

export interface MeshtasticTraceSideEffectsDeps {
  /** Outbound traceroute packet id → traced node, filled by the send path. */
  pendingTracePacketIdToTargetRef: RefObject<Map<number, number>>;
  /** Traced node → request start time. */
  pendingTraceRequestsRef: RefObject<Map<number, number>>;
  setTraceRouteResults: Dispatch<SetStateAction<Map<number, MeshtasticTraceRouteEntry>>>;
  touchLastData: () => void;
}

type TraceRouteEvent = Extract<DomainEvent, { type: 'trace_route' }>;

function normalizedPacketId(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 0xffffffff) {
    return undefined;
  }
  return Math.trunc(value);
}

/** Drop expired trace requests, orphaned packet-id mappings, and overflow entries. */
export function prunePendingTraceState(
  deps: Pick<
    MeshtasticTraceSideEffectsDeps,
    'pendingTraceRequestsRef' | 'pendingTracePacketIdToTargetRef'
  >,
  now: number = Date.now(),
): void {
  const requests = deps.pendingTraceRequestsRef.current;
  const packetIds = deps.pendingTracePacketIdToTargetRef.current;

  const cutoff = now - PENDING_TRACE_TTL_MS;
  for (const [target, startedAt] of requests) {
    if (startedAt < cutoff) requests.delete(target);
  }
  if (requests.size > MAX_PENDING_TRACE_ENTRIES) {
    const kept = trimMapToMaxSize(requests, MAX_PENDING_TRACE_ENTRIES);
    for (const target of [...requests.keys()]) {
      if (!kept.has(target)) requests.delete(target);
    }
  }
  for (const [packetId, dest] of [...packetIds.entries()]) {
    if (!requests.has(dest)) packetIds.delete(packetId);
  }
}

/**
 * Correlate a reply back to the node the user asked to trace, then merge it into
 * the per-node results map under every key the UI may look it up by.
 */
export function applyMeshtasticTracerouteReply(
  event: TraceRouteEvent['payload'],
  deps: MeshtasticTraceSideEffectsDeps,
): void {
  const rd = { route: event.route, routeBack: event.routeBack ?? [] };
  const baseLookupKeys = meshtasticTraceRouteLookupKeys({
    from: event.from,
    data: rd,
    dataLayerDest: event.dataLayerDest,
    dataLayerSource: event.dataLayerSource,
  });

  let correlatedDest: number | undefined;
  for (const id of [normalizedPacketId(event.replyId), normalizedPacketId(event.requestId)]) {
    if (id === undefined) continue;
    const mapped = deps.pendingTracePacketIdToTargetRef.current.get(id);
    if (mapped !== undefined) {
      correlatedDest = mapped >>> 0;
      deps.pendingTracePacketIdToTargetRef.current.delete(id);
      break;
    }
  }

  const correlatedAdditionalKeys = correlatedDest !== undefined ? [correlatedDest] : [];
  for (const key of new Set([...baseLookupKeys, ...correlatedAdditionalKeys])) {
    deps.pendingTraceRequestsRef.current.delete(key);
  }

  prunePendingTraceState(deps);

  deps.setTraceRouteResults((prev) =>
    mergeMeshtasticTraceRouteIntoResultsMap(
      prev,
      event.from,
      rd,
      event.dataLayerDest,
      correlatedAdditionalKeys,
      event.dataLayerSource,
    ),
  );

  // last_heard for traceroute participants is bumped in nodeStore by the
  // PacketRouter `trace_route` case (bumpMeshtasticNodesLastHeardAt).
}

/** Attach traceroute correlation for one Meshtastic identity. Returns a detach fn. */
export function attachMeshtasticTraceSideEffects(
  identityId: IdentityId,
  deps: MeshtasticTraceSideEffectsDeps,
): () => void {
  return attachTypedPacketListener(identityId, 'trace_route', (payload) => {
    deps.touchLastData();
    applyMeshtasticTracerouteReply(payload, deps);
  });
}
