import { afterEach, describe, expect, it, vi } from 'vitest';

import { packetRouter } from '../drivers/PacketRouter';
import {
  attachMeshtasticTraceSideEffects,
  prunePendingTraceState,
} from './meshtasticTraceSideEffects';

describe('attachMeshtasticTraceSideEffects', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('correlates replyId to pending target and merges route results', () => {
    const pendingTracePacketIdToTargetRef = { current: new Map([[42, 99]]) };
    const pendingTraceRequestsRef = { current: new Map([[99, Date.now()]]) };
    const setTraceRouteResults = vi.fn();
    const touchLastData = vi.fn();
    const detach = attachMeshtasticTraceSideEffects('id-1', {
      pendingTracePacketIdToTargetRef,
      pendingTraceRequestsRef,
      setTraceRouteResults,
      touchLastData,
    });
    packetRouter.dispatch(
      {
        type: 'trace_route',
        payload: {
          from: 7,
          to: 0,
          route: [1, 2],
          routeBack: [3],
          timestamp: Date.now(),
          replyId: 42,
        },
      },
      'id-1',
    );
    expect(touchLastData).toHaveBeenCalled();
    expect(pendingTracePacketIdToTargetRef.current.has(42)).toBe(false);
    expect(setTraceRouteResults).toHaveBeenCalled();
    detach();
  });
});

describe('prunePendingTraceState', () => {
  it('drops requests older than the 2 minute TTL', () => {
    const now = 10_000_000;
    const pendingTraceRequestsRef = {
      current: new Map([
        [1, now - 130_000],
        [2, now - 10_000],
      ]),
    };
    const pendingTracePacketIdToTargetRef = { current: new Map<number, number>() };

    prunePendingTraceState({ pendingTraceRequestsRef, pendingTracePacketIdToTargetRef }, now);

    expect([...pendingTraceRequestsRef.current.keys()]).toEqual([2]);
  });

  it('drops packet-id mappings whose target is no longer pending', () => {
    const now = 10_000_000;
    const pendingTraceRequestsRef = { current: new Map([[2, now]]) };
    const pendingTracePacketIdToTargetRef = {
      current: new Map([
        [100, 1],
        [200, 2],
      ]),
    };

    prunePendingTraceState({ pendingTraceRequestsRef, pendingTracePacketIdToTargetRef }, now);

    expect([...pendingTracePacketIdToTargetRef.current.keys()]).toEqual([200]);
  });

  it('bounds unanswered requests so the maps cannot grow without limit', () => {
    const now = 10_000_000;
    const pendingTraceRequestsRef = { current: new Map<number, number>() };
    const pendingTracePacketIdToTargetRef = { current: new Map<number, number>() };
    for (let i = 0; i < 300; i++) {
      pendingTraceRequestsRef.current.set(i, now);
      pendingTracePacketIdToTargetRef.current.set(1000 + i, i);
    }

    prunePendingTraceState({ pendingTraceRequestsRef, pendingTracePacketIdToTargetRef }, now);

    expect(pendingTraceRequestsRef.current.size).toBe(128);
    expect(pendingTracePacketIdToTargetRef.current.size).toBe(128);
    // Oldest insertions are evicted first; the newest target survives.
    expect(pendingTraceRequestsRef.current.has(299)).toBe(true);
    expect(pendingTraceRequestsRef.current.has(0)).toBe(false);
  });
});
