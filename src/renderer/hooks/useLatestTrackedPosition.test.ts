import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { usePositionHistoryStore } from '../stores/positionHistoryStore';
import { useLatestTrackedPosition } from './useLatestTrackedPosition';

const initialPositionHistoryState = usePositionHistoryStore.getInitialState();

describe('useLatestTrackedPosition', () => {
  beforeEach(() => {
    usePositionHistoryStore.setState(initialPositionHistoryState, true);
  });

  it('returns null when history is empty', () => {
    const { result } = renderHook(() => useLatestTrackedPosition(42));
    expect(result.current).toBeNull();
  });

  it('returns newest point without re-rendering when store updates unrelated nodes', () => {
    usePositionHistoryStore.setState({
      history: new Map([[42, [{ t: 1_000, lat: 40.1, lon: -105.1 }]]]),
    });

    const { result, rerender } = renderHook(() => useLatestTrackedPosition(42));
    expect(result.current).toEqual({ lat: 40.1, lon: -105.1 });
    const firstRef = result.current;

    usePositionHistoryStore.getState().recordPosition(99, 1, 2);
    rerender();
    expect(result.current).toBe(firstRef);
  });

  it('updates when the tracked point for this node changes', () => {
    usePositionHistoryStore.setState({
      history: new Map([[42, [{ t: 1_000, lat: 40.1, lon: -105.1 }]]]),
    });

    const { result } = renderHook(() => useLatestTrackedPosition(42));
    act(() => {
      // >10 m from prior point so recordPosition accepts the update
      usePositionHistoryStore.getState().recordPosition(42, 41.0, -106.0);
    });

    expect(result.current).toEqual({ lat: 41.0, lon: -106.0 });
  });
});
