import { describe, expect, it } from 'vitest';

import {
  LIVE_TRAFFIC_ARRIVAL_DURATION_MS,
  LIVE_TRAFFIC_HOP_DURATION_MS,
  type LiveTrafficAnimationInput,
  LiveTrafficAnimationScheduler,
} from './liveTrafficAnimation';
import { liveTrafficSegmentKey } from './liveTrafficGroups';
import { LIVE_TRAFFIC_MAX_AGE_MS, type LiveTrafficSegment } from './liveTrafficModel';

const WALL_NOW = 100_000;

function edge(
  from: number,
  to: number,
  receivedAt = WALL_NOW,
): LiveTrafficSegment & { observedAt: number } {
  return {
    from: { nodeId: from, lat: from, lon: from, label: `${from}` },
    to: { nodeId: to, lat: to, lon: to, label: `${to}` },
    observedAt: receivedAt,
  };
}

function packet(
  paths: readonly (readonly LiveTrafficSegment[])[],
  id = 'packet',
): LiveTrafficAnimationInput {
  return {
    id,
    ts: WALL_NOW,
    segments: [
      ...new Map(paths.flat().map((segment) => [liveTrafficSegmentKey(segment), segment])).values(),
    ],
    observedPaths: paths.map((segments) => ({
      observedAt: WALL_NOW,
      segmentKeys: segments.map(liveTrafficSegmentKey),
    })),
  };
}

function timings(scheduler: LiveTrafficAnimationScheduler) {
  return scheduler.flights.map((hop) => [
    hop.segment.from.nodeId,
    hop.segment.to.nodeId,
    hop.startedAt,
    hop.endsAt,
  ]);
}

describe('live packet hop scheduling', () => {
  it('advances at 660ms per hop and fans out after a shared predecessor arrives', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    scheduler.update(
      [
        packet([
          [edge(1, 2), edge(2, 3)],
          [edge(1, 2), edge(2, 4)],
        ]),
      ],
      0,
      WALL_NOW,
    );
    expect(timings(scheduler)).toEqual([
      [1, 2, 0, 660],
      [2, 3, 660, 1320],
      [2, 4, 660, 1320],
    ]);
  });

  it('starts separate confirmed runs concurrently without connecting a gap', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    scheduler.update([packet([[edge(1, 2)], [edge(4, 5), edge(5, 6)]])], 0, WALL_NOW);
    expect(timings(scheduler)).toEqual([
      [1, 2, 0, 660],
      [4, 5, 0, 660],
      [5, 6, 660, 1320],
    ]);
  });

  it('anchors a late branch to an in-flight prefix without replaying the prefix', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    scheduler.update([packet([[edge(1, 2), edge(2, 3)]])], 0, WALL_NOW);
    scheduler.update(
      [
        packet([
          [edge(1, 2), edge(2, 3)],
          [edge(1, 2), edge(2, 4)],
        ]),
      ],
      330,
      WALL_NOW,
    );
    expect(timings(scheduler)).toEqual([
      [1, 2, 0, 660],
      [2, 3, 660, 1320],
      [2, 4, 660, 1320],
    ]);
  });

  it('starts a new branch now once its shared prefix has finished', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    scheduler.update([packet([[edge(1, 2)]])], 0, WALL_NOW);
    scheduler.update([packet([[edge(1, 2), edge(2, 3)]])], 2000, WALL_NOW);
    expect(timings(scheduler)).toEqual([[2, 3, 2000, 2660]]);
  });

  it('does not rewind an already flying hop when an older report arrives late', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    scheduler.update([packet([[edge(2, 3)]])], 0, WALL_NOW);
    scheduler.update([packet([[edge(1, 2), edge(2, 3), edge(3, 4)]])], 100, WALL_NOW);
    expect(timings(scheduler)).toEqual([
      [2, 3, 0, 660],
      [1, 2, 100, 760],
      [3, 4, 760, 1420],
    ]);
  });

  it('delays a pending shared hop and its descendants when its predecessor arrives late', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    scheduler.update([packet([[edge(7, 2), edge(2, 3), edge(3, 4)]])], 0, WALL_NOW);
    scheduler.update(
      [
        packet([
          [edge(7, 2), edge(2, 3), edge(3, 4)],
          [edge(1, 2), edge(2, 3)],
        ]),
      ],
      100,
      WALL_NOW,
    );
    expect(timings(scheduler)).toEqual([
      [7, 2, 0, 660],
      [2, 3, 760, 1420],
      [3, 4, 1420, 2080],
      [1, 2, 100, 760],
    ]);
  });

  it('deduplicates repeated reports, content refreshes, and loops by directed edge', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    const input = packet([[edge(1, 2), edge(2, 1), edge(1, 2), edge(2, 3)]]);
    scheduler.update([input], 0, WALL_NOW);
    expect(timings(scheduler)).toEqual([
      [1, 2, 0, 660],
      [2, 1, 660, 1320],
      [2, 3, 1320, 1980],
    ]);
    scheduler.update([{ ...input, ts: WALL_NOW + 100 }], 100, WALL_NOW + 100);
    expect(scheduler.flights).toHaveLength(3);
    scheduler.update([input], 3000, WALL_NOW);
    expect(scheduler.flights).toEqual([]);
  });

  it('uses the first edge observation time instead of refreshed group or path time', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    scheduler.update([packet([[edge(1, 2, WALL_NOW - 10_001), edge(2, 3)]])], 0, WALL_NOW);
    expect(timings(scheduler)).toEqual([[2, 3, 0, 660]]);
  });

  it('does not animate future timestamps', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    scheduler.update([packet([[edge(1, 2, WALL_NOW + 1)]])], 0, WALL_NOW);
    expect(scheduler.flights).toEqual([]);
  });

  it('treats segments without path provenance as independent confirmed edges', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    scheduler.update(
      [{ id: 'legacy', ts: WALL_NOW, segments: [edge(1, 2), edge(2, 3)] }],
      0,
      WALL_NOW,
    );
    expect(timings(scheduler)).toEqual([
      [1, 2, 0, 660],
      [2, 3, 0, 660],
    ]);
  });

  it('rejects a clipped run instead of animating its remaining suffix', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    const input = packet([[edge(1, 2), edge(2, 3)]]);
    scheduler.update([{ ...input, segments: [edge(2, 3)] }], 0, WALL_NOW);
    expect(scheduler.flights).toEqual([]);
  });

  it('admits complete paths under pressure and never retries rejected tails later', () => {
    const scheduler = new LiveTrafficAnimationScheduler({ maxFlights: 3 });
    const input = packet([[edge(1, 2)], [edge(4, 5), edge(5, 6), edge(6, 7)]]);
    scheduler.update([input], 0, WALL_NOW);
    expect(timings(scheduler)).toEqual([[1, 2, 0, 660]]);
    scheduler.update([input], 2000, WALL_NOW);
    expect(scheduler.flights).toEqual([]);
  });

  it('never anchors a new branch to a trunk rejected under load', () => {
    const scheduler = new LiveTrafficAnimationScheduler({ maxFlights: 1 });
    scheduler.update([packet([[edge(1, 2), edge(2, 3)]])], 0, WALL_NOW);
    scheduler.update([packet([[edge(1, 2), edge(2, 4)]])], 100, WALL_NOW);
    expect(scheduler.flights).toEqual([]);
  });

  it('does not retain a tail when the pending shared trunk is filtered out', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    scheduler.update([packet([[edge(1, 2), edge(2, 3), edge(3, 4)]])], 0, WALL_NOW);
    scheduler.update([packet([[edge(3, 4)]])], 100, WALL_NOW);
    expect(scheduler.flights).toEqual([]);
  });

  it('consumes observations received while hidden instead of replaying them after resume', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    const hidden = packet([[edge(1, 2, WALL_NOW - 100)]]);
    scheduler.update([hidden], 0, WALL_NOW, true, 64, WALL_NOW);
    expect(scheduler.flights).toEqual([]);
    scheduler.update([hidden], 100, WALL_NOW + 100);
    expect(scheduler.flights).toEqual([]);
  });

  it('reserves capacity for point pulses through the per-update flight limit', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    scheduler.update([packet([[edge(1, 2), edge(2, 3), edge(3, 4)]])], 0, WALL_NOW, true, 2);
    expect(scheduler.flights).toEqual([]);
  });

  it('keeps completed hops through the arrival pulse and sleeps after expiry', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    scheduler.update([packet([[edge(1, 2)]])], 0, WALL_NOW);
    const sameFlights = scheduler.flights;
    scheduler.prune(LIVE_TRAFFIC_HOP_DURATION_MS + LIVE_TRAFFIC_ARRIVAL_DURATION_MS - 1);
    expect(scheduler.flights).toBe(sameFlights);
    scheduler.prune(LIVE_TRAFFIC_HOP_DURATION_MS + LIVE_TRAFFIC_ARRIVAL_DURATION_MS);
    expect(scheduler.flights).toEqual([]);
  });

  it('consumes paused observations and forgets discarded future animation timing', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    scheduler.update([packet([[edge(1, 2), edge(2, 3)]])], 0, WALL_NOW);
    scheduler.update([packet([[edge(1, 2), edge(2, 3)], [edge(7, 8)]])], 100, WALL_NOW, false);
    expect(scheduler.flights).toEqual([]);
    scheduler.update([packet([[edge(1, 2), edge(2, 3), edge(3, 4)], [edge(7, 8)]])], 200, WALL_NOW);
    expect(scheduler.flights).toEqual([]);
  });

  it('removes filtered geometry immediately without replay when it returns', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    const input = packet([
      [edge(1, 2), edge(2, 3)],
      [edge(1, 2), edge(2, 4)],
    ]);
    scheduler.update([input], 0, WALL_NOW);
    scheduler.update([packet([[edge(1, 2), edge(2, 3)]])], 100, WALL_NOW);
    expect(scheduler.flights.map((hop) => hop.segment.to.nodeId)).toEqual([2, 3]);
    scheduler.update([input], 200, WALL_NOW);
    expect(scheduler.flights.map((hop) => hop.segment.to.nodeId)).toEqual([2, 3]);
  });

  it('allows a fresh transmission after its group has been absent for a minute', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    const input = packet([[edge(1, 2)]]);
    scheduler.update([input], 0, WALL_NOW);
    const later = WALL_NOW + LIVE_TRAFFIC_MAX_AGE_MS + 1;
    scheduler.update([], 1, later);
    scheduler.update([packet([[edge(1, 2, later)]])], 2, later);
    expect(scheduler.flights).toHaveLength(1);
  });

  it('expires an absent group even when no updates run before the group returns', () => {
    const scheduler = new LiveTrafficAnimationScheduler();
    scheduler.update([packet([[edge(1, 2)]])], 0, WALL_NOW);
    scheduler.update([], 4000, WALL_NOW + 4000);
    const later = WALL_NOW + LIVE_TRAFFIC_MAX_AGE_MS + 1;
    scheduler.update([packet([[edge(1, 2, later)]])], 5000, later);
    expect(timings(scheduler)).toEqual([[1, 2, 5000, 5660]]);
  });

  it('bounds group memory and suppresses overflow geometry without bursts', () => {
    const scheduler = new LiveTrafficAnimationScheduler({ maxGroups: 2, maxSeenEdges: 2 });
    scheduler.update([packet([[edge(1, 2)]], 'one'), packet([[edge(3, 4)]], 'two')], 0, WALL_NOW);
    scheduler.update([packet([[edge(1, 2), edge(2, 5)]], 'one')], 100, WALL_NOW);
    expect(scheduler.flights.map((hop) => hop.segment.to.nodeId)).toEqual([2]);
    scheduler.update([packet([[edge(6, 7)]], 'three')], 200, WALL_NOW);
    expect(scheduler.flights.map((hop) => hop.eventId)).toEqual(['three']);
    scheduler.update([packet([[edge(1, 2), edge(2, 5)]], 'one')], 300, WALL_NOW);
    expect(scheduler.flights).toEqual([]);
  });
});
