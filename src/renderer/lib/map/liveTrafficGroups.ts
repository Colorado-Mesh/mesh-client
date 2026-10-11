import {
  LIVE_TRAFFIC_MAX_AGE_MS,
  LIVE_TRAFFIC_MAX_PACKETS,
  type LiveTrafficEvent,
  type LiveTrafficPoint,
  type LiveTrafficSegment,
} from './liveTrafficModel';

export interface LiveTrafficGroupSegment extends LiveTrafficSegment {
  /** First retained report of this directed edge; observedPaths retains route order. */
  observedAt: number;
  lastSeenTs: number;
  observationId: string;
  reportCount: number;
}

export interface LiveTrafficObservedPath {
  id: string;
  observationId: string;
  observerId?: string;
  /** Receipt time of the complete report, not a measured per-hop transmission time. */
  observedAt: number;
  /** One contiguous observed run, in hop order. Repeated edges in loops are retained. */
  segmentKeys: string[];
}

export interface LiveTrafficGroup extends LiveTrafficEvent {
  segments: LiveTrafficGroupSegment[];
  observedPaths: LiveTrafficObservedPath[];
  /** Unique reports retained after the caller's geographic/source/category filters. */
  reportCount: number;
  /** Only explicitly identified observers count; unknown observers are not guessed. */
  observerCount: number;
  firstSeenTs: number;
  lastSeenTs: number;
  scopeCodes: (number | null)[];
  returnScopeCodes: (number | null)[];
  scopeMixed: boolean;
}

interface GroupAccumulator {
  id: string;
  firstSeenTs: number;
  latest: LiveTrafficEvent;
  message: LiveTrafficEvent | null;
  senderLabel: string | undefined;
  controlSubtype: LiveTrafficEvent['controlSubtype'];
  reportCount: number;
  observers: Set<string>;
  points: Map<string, LiveTrafficPoint>;
  segments: Map<string, LiveTrafficGroupSegment>;
  observedPaths: LiveTrafficObservedPath[];
  statuses: Set<LiveTrafficEvent['routeStatus']>;
  scopeCodes: Set<number | null>;
  returnScopeCodes: Set<number | null>;
  reportedObservationCount: number | undefined;
}

/** Include coordinates so two reports of a moved node cannot silently change an existing edge. */
export function liveTrafficPointKey(point: LiveTrafficPoint): string {
  const publicKey =
    'publicKey' in point && typeof point.publicKey === 'string'
      ? point.publicKey.toLowerCase()
      : null;
  const identity = publicKey
    ? `key:${publicKey}`
    : point.nodeId !== null
      ? `node:${point.nodeId}`
      : 'location';
  return JSON.stringify([identity, point.lat, point.lon]);
}

/** Direction matters: A→B and B→A are different observed branches. */
export function liveTrafficSegmentKey(segment: LiveTrafficSegment): string {
  return JSON.stringify([liveTrafficPointKey(segment.from), liveTrafficPointKey(segment.to)]);
}

function observedPaths(event: LiveTrafficEvent): LiveTrafficObservedPath[] {
  const paths: LiveTrafficObservedPath[] = [];
  let previous: LiveTrafficSegment | undefined;
  for (const segment of event.segments) {
    const contiguous =
      previous?.hopIndex != null &&
      segment.hopIndex != null &&
      segment.hopIndex === previous.hopIndex + 1 &&
      liveTrafficPointKey(previous.to) === liveTrafficPointKey(segment.from);
    if (contiguous) paths[paths.length - 1].segmentKeys.push(liveTrafficSegmentKey(segment));
    else {
      paths.push({
        id: JSON.stringify([groupId(event), event.id, paths.length]),
        observationId: event.id,
        observerId: event.observerId,
        observedAt: event.ts,
        segmentKeys: [liveTrafficSegmentKey(segment)],
      });
    }
    previous = segment;
  }
  return paths;
}

function groupId(event: LiveTrafficEvent): string {
  const packetIdentity = event.packetIdentity ?? event.packetHash;
  return JSON.stringify(
    packetIdentity
      ? ['packet', event.source, event.sourceSessionId ?? null, packetIdentity]
      : ['observation', event.source, event.sourceSessionId ?? null, event.id],
  );
}

function routeStatus(group: GroupAccumulator): LiveTrafficEvent['routeStatus'] {
  if (group.statuses.has('estimated') && group.segments.size > 0) return 'estimated';
  if (group.statuses.size === 1) return group.statuses.values().next().value ?? 'unlocated';
  if (group.points.size === 0 && group.segments.size === 0) return 'unlocated';
  return 'partial';
}

function orderedCodes(codes: Set<number | null>): (number | null)[] {
  return [...codes].sort((a, b) => (a ?? -1) - (b ?? -1));
}

/**
 * Call after geographic, source, and scope filtering. A group is a union of observed edges,
 * never a polyline assembled from its points. Raw captures without a credible hash stay separate.
 */
export function groupLiveTrafficEvents(
  events: readonly LiveTrafficEvent[],
  now: number,
): LiveTrafficGroup[] {
  const reports = new Map<string, LiveTrafficEvent>();
  for (const event of events.slice(-LIVE_TRAFFIC_MAX_PACKETS)) {
    if (!Number.isFinite(event.ts) || event.ts > now || now - event.ts > LIVE_TRAFFIC_MAX_AGE_MS)
      continue;
    const identity = JSON.stringify([event.source, event.sourceSessionId ?? null, event.id]);
    const previous = reports.get(identity);
    const samePacket = previous && groupId(previous) === groupId(event);
    const refreshedEvent =
      samePacket && event.kind === 'CONTROL' && !event.controlSubtype && previous.controlSubtype
        ? { ...event, controlSubtype: previous.controlSubtype }
        : event;
    // A metadata refresh of the same observation is still one report.
    reports.set(
      identity,
      samePacket &&
        previous.contentStatus === 'decoded' &&
        event.contentStatus !== 'decoded' &&
        previous.messageText !== undefined
        ? {
            ...refreshedEvent,
            messageText: previous.messageText,
            senderLabel: previous.senderLabel ?? event.senderLabel,
            contentStatus: previous.contentStatus,
          }
        : samePacket && !event.senderLabel && previous.senderLabel
          ? { ...refreshedEvent, senderLabel: previous.senderLabel }
          : refreshedEvent,
    );
  }
  const groups = new Map<string, GroupAccumulator>();
  const chronological = [...reports.values()].sort((a, b) => a.ts - b.ts);
  for (const event of chronological) {
    const id = groupId(event);
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        firstSeenTs: event.ts,
        latest: event,
        message: null,
        senderLabel: undefined,
        controlSubtype: undefined,
        reportCount: 0,
        observers: new Set(),
        points: new Map(),
        segments: new Map(),
        observedPaths: [],
        statuses: new Set(),
        scopeCodes: new Set(),
        returnScopeCodes: new Set(),
        reportedObservationCount: undefined,
      };
      groups.set(id, group);
    }
    group.latest = event;
    if (event.senderLabel) group.senderLabel = event.senderLabel;
    if (event.kind === 'CONTROL' && event.controlSubtype)
      group.controlSubtype = event.controlSubtype;
    group.reportCount += 1;
    if (event.observerId) group.observers.add(event.observerId);
    group.statuses.add(event.routeStatus);
    group.scopeCodes.add(event.scopeCode);
    group.returnScopeCodes.add(event.returnScopeCode);
    if (event.contentStatus === 'decoded' && typeof event.messageText === 'string')
      group.message = event;
    if (
      event.reportedObservationCount != null &&
      Number.isSafeInteger(event.reportedObservationCount) &&
      event.reportedObservationCount > 0
    ) {
      group.reportedObservationCount = Math.max(
        group.reportedObservationCount ?? 0,
        event.reportedObservationCount,
      );
    }
    for (const point of event.points) group.points.set(liveTrafficPointKey(point), point);
    group.observedPaths.push(...observedPaths(event));
    const seenEdges = new Set<string>();
    for (const segment of event.segments) {
      const key = liveTrafficSegmentKey(segment);
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      group.points.set(liveTrafficPointKey(segment.from), segment.from);
      group.points.set(liveTrafficPointKey(segment.to), segment.to);
      const previous = group.segments.get(key);
      group.segments.set(
        key,
        previous
          ? {
              ...previous,
              lastSeenTs: event.ts,
              reportCount: previous.reportCount + 1,
            }
          : {
              ...segment,
              observedAt: event.ts,
              lastSeenTs: event.ts,
              observationId: event.id,
              reportCount: 1,
            },
      );
    }
  }
  return [...groups.values()]
    .map((group): LiveTrafficGroup => {
      const scopeCodes = orderedCodes(group.scopeCodes);
      const returnScopeCodes = orderedCodes(group.returnScopeCodes);
      return {
        ...group.latest,
        id: group.id,
        segments: [...group.segments.values()],
        observedPaths: group.observedPaths,
        points: [...group.points.values()],
        routeStatus: routeStatus(group),
        reportCount: group.reportCount,
        observerCount: group.observers.size,
        observerId: group.observers.size === 1 ? group.observers.values().next().value : undefined,
        firstSeenTs: group.firstSeenTs,
        lastSeenTs: group.latest.ts,
        scopeCodes,
        returnScopeCodes,
        scopeMixed: scopeCodes.length > 1 || returnScopeCodes.length > 1,
        scopeCode: scopeCodes.length === 1 ? scopeCodes[0] : null,
        returnScopeCode: returnScopeCodes.length === 1 ? returnScopeCodes[0] : null,
        reportedObservationCount: group.reportedObservationCount,
        senderLabel: group.message?.senderLabel ?? group.senderLabel,
        controlSubtype: group.latest.kind === 'CONTROL' ? group.controlSubtype : undefined,
        ...(group.message
          ? {
              messageText: group.message.messageText,
              contentStatus: 'decoded',
            }
          : {}),
      };
    })
    .sort((a, b) => a.lastSeenTs - b.lastSeenTs);
}
