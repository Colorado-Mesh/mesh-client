import { afterEach, describe, expect, it, vi } from 'vitest';

import { packetRouter } from '../drivers/PacketRouter';
import { attachMeshtasticTraceSideEffects } from './meshtasticTraceSideEffects';

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
