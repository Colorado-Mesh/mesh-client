import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  selectNoiseFloorSeries,
  useNoiseFloorHistoryStore,
} from '../stores/noiseFloorHistoryStore';
import { useRfNoiseFloorHistory } from './useRfNoiseFloorHistory';

describe('useRfNoiseFloorHistory', () => {
  beforeEach(() => {
    useNoiseFloorHistoryStore.getState().clearAll();
    vi.useRealTimers();
  });

  it('records nothing when disabled', () => {
    renderHook(() => {
      useRfNoiseFloorHistory({
        enabled: false,
        nodeId: 7,
        noiseFloor: -108,
        observedAt: 1_000,
      });
    });
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 7)).toHaveLength(0);
  });

  it('records a plausible sample with observedAt', () => {
    renderHook(() => {
      useRfNoiseFloorHistory({
        enabled: true,
        nodeId: 7,
        noiseFloor: -108,
        observedAt: 1_000,
      });
    });
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 7)).toEqual([
      { t: 1_000, noiseFloor: -108 },
    ]);
  });

  it('rejects firmware sentinel 0 and undefined', () => {
    renderHook(() => {
      useRfNoiseFloorHistory({
        enabled: true,
        nodeId: 7,
        noiseFloor: 0,
        observedAt: 1_000,
      });
    });
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 7)).toHaveLength(0);

    renderHook(() => {
      useRfNoiseFloorHistory({
        enabled: true,
        nodeId: 8,
        noiseFloor: undefined,
        observedAt: 1_000,
      });
    });
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 8)).toHaveLength(0);
  });

  it('rejects nodeId 0 / null', () => {
    renderHook(() => {
      useRfNoiseFloorHistory({
        enabled: true,
        nodeId: 0,
        noiseFloor: -108,
        observedAt: 1_000,
      });
    });
    renderHook(() => {
      useRfNoiseFloorHistory({
        enabled: true,
        nodeId: null,
        noiseFloor: -108,
        observedAt: 1_000,
      });
    });
    expect(useNoiseFloorHistoryStore.getState().history.size).toBe(0);
  });

  it('defaults timestamp to now when observedAt is omitted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    renderHook(() => {
      useRfNoiseFloorHistory({
        enabled: true,
        nodeId: 9,
        noiseFloor: -110,
      });
    });
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 9)).toEqual([
      { t: 5_000, noiseFloor: -110 },
    ]);
    vi.useRealTimers();
  });
});
