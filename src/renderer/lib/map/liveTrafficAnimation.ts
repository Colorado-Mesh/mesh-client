import { MS_PER_SECOND } from '@/shared/timeConstants';

import { liveTrafficSegmentKey } from './liveTrafficGroups';
import { LIVE_TRAFFIC_MAX_AGE_MS, type LiveTrafficSegment } from './liveTrafficModel';

export const LIVE_TRAFFIC_HOP_DURATION_MS = 0.66 * MS_PER_SECOND;
export const LIVE_TRAFFIC_ARRIVAL_DURATION_MS = 0.8 * MS_PER_SECOND;
const FRESH_EVENT_WINDOW_MS = 10 * MS_PER_SECOND;

export interface LiveTrafficAnimationInput {
  id: string;
  ts: number;
  segments: readonly LiveTrafficSegment[];
  observedPaths?: readonly {
    observedAt: number;
    segmentKeys: readonly string[];
  }[];
}

export interface LiveTrafficHop {
  key: string;
  eventId: string;
  segmentKey: string;
  segment: LiveTrafficSegment;
  startedAt: number;
  endsAt: number;
}

interface SeenGroup {
  lastPresent: number;
  edges: Map<string, LiveTrafficHop | 'historical' | null>;
  saturated: boolean;
}

export interface LiveTrafficAnimationOptions {
  maxFlights?: number;
  maxGroups?: number;
  maxSeenEdges?: number;
}

function observedAt(segment: LiveTrafficSegment, fallback: number): number {
  return 'observedAt' in segment && typeof segment.observedAt === 'number'
    ? segment.observedAt
    : fallback;
}

/** Schedules only ordered, confirmed runs; a shared directed hop flies once per packet. */
export class LiveTrafficAnimationScheduler {
  private readonly maxFlights: number;
  private readonly maxGroups: number;
  private readonly maxSeenEdges: number;
  private readonly groups = new Map<string, SeenGroup>();
  private seenEdges = 0;
  private active: LiveTrafficHop[] = [];
  private readonly predecessors = new Map<string, string>();

  constructor(options: LiveTrafficAnimationOptions = {}) {
    this.maxFlights = options.maxFlights ?? 64;
    this.maxGroups = options.maxGroups ?? 512;
    this.maxSeenEdges = options.maxSeenEdges ?? 16_384;
  }

  get flights(): readonly LiveTrafficHop[] {
    return this.active;
  }

  prune(now: number): void {
    // Preserve the array identity between admissions and arrivals for projection caching.
    if (this.active.some((hop) => now >= hop.endsAt + LIVE_TRAFFIC_ARRIVAL_DURATION_MS)) {
      for (const hop of this.active) {
        if (now >= hop.endsAt + LIVE_TRAFFIC_ARRIVAL_DURATION_MS) this.predecessors.delete(hop.key);
      }
      this.active = this.active.filter(
        (hop) => now < hop.endsAt + LIVE_TRAFFIC_ARRIVAL_DURATION_MS,
      );
    }
  }

  discard(): void {
    for (const hop of this.active) this.groups.get(hop.eventId)?.edges.set(hop.segmentKey, null);
    this.active = [];
    this.predecessors.clear();
  }

  update(
    inputs: readonly LiveTrafficAnimationInput[],
    now: number,
    wallNow: number,
    animate = true,
    maxFlights = this.maxFlights,
    observedSince = -Infinity,
  ): void {
    this.prune(now);
    if (!animate) this.discard();
    const visible = new Map(
      inputs.map((input) => [input.id, new Set(input.segments.map(liveTrafficSegmentKey))]),
    );
    const cancelled = this.pruneCancelledFlights(visible, now);
    this.cascadeCancelledFlights(cancelled);
    this.forgetStaleGroups(visible, wallNow);

    for (const input of inputs.slice(-this.maxGroups)) {
      const group = this.touchGroup(input, wallNow);
      const segments = new Map(
        input.segments.map((segment) => [liveTrafficSegmentKey(segment), segment]),
      );
      const newKeys = this.registerGroupEdges(group, segments);
      if (!animate || newKeys.size === 0) continue;

      const paths =
        input.observedPaths ??
        input.segments.map((segment) => ({
          observedAt: observedAt(segment, input.ts),
          segmentKeys: [liveTrafficSegmentKey(segment)],
        }));
      for (const path of paths) {
        this.admitObservedPath(input, path, group, segments, newKeys, {
          now,
          wallNow,
          observedSince,
          maxFlights,
        });
      }
    }
  }

  /** Drops flights whose segment vanished from the visible set; returns newly cancelled keys. */
  private pruneCancelledFlights(visible: Map<string, Set<string>>, now: number): Set<string> {
    const cancelled = new Set<string>();
    this.active = this.active.filter((hop) => {
      if (visible.get(hop.eventId)?.has(hop.segmentKey)) return true;
      if (hop.endsAt > now) cancelled.add(hop.key);
      else this.predecessors.delete(hop.key);
      this.groups.get(hop.eventId)?.edges.set(hop.segmentKey, null);
      return false;
    });
    return cancelled;
  }

  /** Propagates cancellation downstream until no flight depends on a cancelled predecessor. */
  private cascadeCancelledFlights(cancelled: Set<string>): void {
    if (cancelled.size === 0) return;
    let changed = true;
    while (changed) {
      changed = false;
      this.active = this.active.filter((hop) => {
        const predecessor = this.predecessors.get(hop.key);
        if (!predecessor || !cancelled.has(predecessor)) return true;
        cancelled.add(hop.key);
        this.groups.get(hop.eventId)?.edges.set(hop.segmentKey, null);
        changed = true;
        return false;
      });
    }
    for (const key of cancelled) this.predecessors.delete(key);
  }

  private forgetStaleGroups(visible: Map<string, Set<string>>, wallNow: number): void {
    for (const [id, group] of this.groups) {
      if (!visible.has(id) && wallNow - group.lastPresent > LIVE_TRAFFIC_MAX_AGE_MS) {
        this.forgetGroup(id, group);
      }
    }
  }

  /** Returns the live group for this event, creating/evicting/reordering as needed. */
  private touchGroup(input: LiveTrafficAnimationInput, wallNow: number): SeenGroup {
    let group = this.groups.get(input.id);
    if (group && wallNow - group.lastPresent > LIVE_TRAFFIC_MAX_AGE_MS) {
      this.forgetGroup(input.id, group);
      group = undefined;
    }
    if (!group) {
      if (this.groups.size >= this.maxGroups) {
        const oldest = this.groups.entries().next().value;
        if (oldest) this.forgetGroup(...oldest);
      }
      group = { lastPresent: wallNow, edges: new Map(), saturated: false };
    }
    group.lastPresent = wallNow;
    this.groups.delete(input.id);
    this.groups.set(input.id, group);
    return group;
  }

  /** Records unseen edges as historical tombstones; returns the keys newly admitted this pass. */
  private registerGroupEdges(
    group: SeenGroup,
    segments: Map<string, LiveTrafficSegment>,
  ): Set<string> {
    const newKeys = new Set<string>();
    for (const key of segments.keys()) {
      if (group.edges.has(key) || group.saturated) continue;
      if (this.seenEdges >= this.maxSeenEdges) {
        // Keep a compact tombstone for overflow instead of replaying it on every refresh.
        group.saturated = true;
        break;
      }
      group.edges.set(key, null);
      this.seenEdges += 1;
      newKeys.add(key);
    }
    return newKeys;
  }

  private resolvePathHop(
    input: LiveTrafficAnimationInput,
    key: string,
    segments: Map<string, LiveTrafficSegment>,
    group: SeenGroup,
    newKeys: Set<string>,
    cursor: number,
    wallNow: number,
    observedSince: number,
    pathObservedAt: number,
  ): { kind: 'planned'; hop: LiveTrafficHop } | { kind: 'historical' } | { kind: 'interrupt' } {
    const segment = segments.get(key);
    if (!segment) return { kind: 'interrupt' };
    const receivedAt = observedAt(segment, pathObservedAt);
    if (!Number.isFinite(receivedAt) || receivedAt > wallNow || receivedAt < observedSince) {
      return { kind: 'interrupt' };
    }
    if (wallNow - receivedAt > FRESH_EVENT_WINDOW_MS) {
      group.edges.set(key, 'historical');
      newKeys.delete(key);
      return { kind: 'historical' };
    }
    return {
      kind: 'planned',
      hop: {
        key: JSON.stringify([input.id, key]),
        eventId: input.id,
        segmentKey: key,
        segment,
        startedAt: cursor,
        endsAt: cursor + LIVE_TRAFFIC_HOP_DURATION_MS,
      },
    };
  }

  private advancePathCursor(
    previous: LiveTrafficHop,
    key: string,
    cursor: number,
    now: number,
    traversed: Set<string>,
  ): number {
    if (previous.startedAt > now && !traversed.has(key)) {
      return Math.max(cursor, Math.max(previous.startedAt, cursor) + LIVE_TRAFFIC_HOP_DURATION_MS);
    }
    return Math.max(cursor, previous.endsAt);
  }

  private planObservedPath(
    input: LiveTrafficAnimationInput,
    path: { observedAt: number; segmentKeys: readonly string[] },
    group: SeenGroup,
    segments: Map<string, LiveTrafficSegment>,
    newKeys: Set<string>,
    timing: { now: number; wallNow: number; observedSince: number },
  ): { planned: Map<string, LiveTrafficHop>; interrupted: boolean } {
    const { now, wallNow, observedSince } = timing;
    const planned = new Map<string, LiveTrafficHop>();
    const traversed = new Set<string>();
    let cursor = now;
    for (const key of path.segmentKeys) {
      const previous = planned.get(key) ?? group.edges.get(key);
      if (previous === 'historical') continue;
      if (previous) {
        cursor = this.advancePathCursor(previous, key, cursor, now, traversed);
        traversed.add(key);
        continue;
      }
      if (!newKeys.has(key)) return { planned, interrupted: true };
      const step = this.resolvePathHop(
        input,
        key,
        segments,
        group,
        newKeys,
        cursor,
        wallNow,
        observedSince,
        path.observedAt,
      );
      if (step.kind === 'interrupt') return { planned, interrupted: true };
      if (step.kind === 'historical') continue;
      planned.set(key, step.hop);
      traversed.add(key);
      cursor = step.hop.endsAt;
    }
    return { planned, interrupted: false };
  }

  private admitObservedPath(
    input: LiveTrafficAnimationInput,
    path: { observedAt: number; segmentKeys: readonly string[] },
    group: SeenGroup,
    segments: Map<string, LiveTrafficSegment>,
    newKeys: Set<string>,
    timing: { now: number; wallNow: number; observedSince: number; maxFlights: number },
  ): void {
    // A clipped run is not a new route starting at its remaining suffix.
    if (path.segmentKeys.some((key) => !segments.has(key) || !group.edges.has(key))) return;
    const { planned, interrupted } = this.planObservedPath(
      input,
      path,
      group,
      segments,
      newKeys,
      timing,
    );
    // Admit whole runs, so pressure never drops an accepted trunk but keeps its tail.
    if (interrupted || this.active.length + planned.size > timing.maxFlights) {
      for (const key of path.segmentKeys) newKeys.delete(key);
      return;
    }
    for (const [key, hop] of planned) {
      group.edges.set(key, hop);
      newKeys.delete(key);
      this.active.push(hop);
    }
    this.linkPathPredecessors(path.segmentKeys, group, planned, timing.now);
  }

  private linkPathPredecessors(
    segmentKeys: readonly string[],
    group: SeenGroup,
    planned: Map<string, LiveTrafficHop>,
    now: number,
  ): void {
    const visited = new Set<string>();
    let predecessor: LiveTrafficHop | undefined;
    for (const key of segmentKeys) {
      const hop = group.edges.get(key);
      if (hop === 'historical') {
        predecessor = undefined;
        continue;
      }
      if (!hop || visited.has(key)) continue;
      visited.add(key);
      if (predecessor && !this.dependsOn(predecessor.key, hop.key)) {
        if (planned.has(key) || hop.startedAt > now) {
          this.predecessors.set(hop.key, predecessor.key);
        }
        this.delayPending(hop, predecessor.endsAt, now);
      }
      predecessor = hop;
    }
  }

  private forgetGroup(id: string, group: SeenGroup): void {
    this.seenEdges -= group.edges.size;
    this.groups.delete(id);
    this.active = this.active.filter((hop) => {
      if (hop.eventId !== id) return true;
      this.predecessors.delete(hop.key);
      return false;
    });
  }

  private dependsOn(key: string, ancestor: string): boolean {
    let current: string | undefined = key;
    while (current) {
      if (current === ancestor) return true;
      current = this.predecessors.get(current);
    }
    return false;
  }

  private delayPending(hop: LiveTrafficHop, earliest: number, now: number): void {
    if (hop.startedAt <= now || hop.startedAt >= earliest) return;
    hop.startedAt = earliest;
    hop.endsAt = earliest + LIVE_TRAFFIC_HOP_DURATION_MS;
    for (const next of this.active) {
      if (this.predecessors.get(next.key) === hop.key) this.delayPending(next, hop.endsAt, now);
    }
  }
}
