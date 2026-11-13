import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHCORE_NOISE_FLOOR_TREND_POLL_MS } from '../lib/meshcore/noiseFloorHistory';
import {
  selectNoiseFloorSeries,
  useNoiseFloorHistoryStore,
} from '../stores/noiseFloorHistoryStore';
import { useMeshcoreNoiseFloorTrend } from './useMeshcoreNoiseFloorTrend';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useMeshcoreNoiseFloorTrend', () => {
  beforeEach(() => {
    useNoiseFloorHistoryStore.setState({ history: new Map() });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('samples a snapshot including zero only while enabled and visible', () => {
    const visible = vi.fn(() => true);
    const { rerender } = renderHook(
      (props: {
        enabled: boolean;
        noiseFloor: number | undefined;
        observedAt: number | undefined;
      }) => {
        useMeshcoreNoiseFloorTrend({
          enabled: props.enabled,
          nodeId: 42,
          noiseFloor: props.noiseFloor,
          observedAt: props.observedAt,
          pollRemote: false,
          isDocumentVisible: visible,
        });
      },
      { initialProps: { enabled: false, noiseFloor: 0, observedAt: 1_000 } },
    );
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 42)).toHaveLength(0);

    rerender({ enabled: true, noiseFloor: 0, observedAt: 1_000 });
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 42)).toEqual([
      { t: 1_000, noiseFloor: 0 },
    ]);

    visible.mockReturnValue(false);
    useNoiseFloorHistoryStore.getState().clearAll();
    rerender({ enabled: true, noiseFloor: -90, observedAt: 2_000 });
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 42)).toHaveLength(0);
  });

  it('records a new point only when observedAt advances, even for identical noiseFloor', () => {
    const { rerender } = renderHook(
      (props: { noiseFloor: number; observedAt: number }) => {
        useMeshcoreNoiseFloorTrend({
          enabled: true,
          nodeId: 7,
          noiseFloor: props.noiseFloor,
          observedAt: props.observedAt,
          pollRemote: false,
          isDocumentVisible: () => true,
        });
      },
      { initialProps: { noiseFloor: -100, observedAt: 10 } },
    );
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 7)).toEqual([
      { t: 10, noiseFloor: -100 },
    ]);

    // Same observation again (panel remount / re-render) — no duplicate.
    rerender({ noiseFloor: -100, observedAt: 10 });
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 7)).toHaveLength(1);

    // New Status observation with same reading — new point.
    rerender({ noiseFloor: -100, observedAt: 10 + MESHCORE_NOISE_FLOOR_TREND_POLL_MS });
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 7)).toHaveLength(2);
  });

  it('polls remote status on an interval only when pollRemote is enabled', async () => {
    const onRequestRepeaterStatus = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      (props: { pollRemote: boolean }) => {
        useMeshcoreNoiseFloorTrend({
          enabled: true,
          nodeId: 99,
          noiseFloor: -112,
          observedAt: 5_000,
          pollRemote: props.pollRemote,
          onRequestRepeaterStatus,
          pollIntervalMs: MESHCORE_NOISE_FLOOR_TREND_POLL_MS,
          isDocumentVisible: () => true,
        });
      },
      { initialProps: { pollRemote: false } },
    );

    await act(async () => {
      vi.advanceTimersByTime(MESHCORE_NOISE_FLOOR_TREND_POLL_MS);
      await flushMicrotasks();
    });
    expect(onRequestRepeaterStatus).not.toHaveBeenCalled();

    rerender({ pollRemote: true });
    await act(async () => {
      vi.advanceTimersByTime(MESHCORE_NOISE_FLOOR_TREND_POLL_MS);
      await flushMicrotasks();
    });
    expect(onRequestRepeaterStatus).toHaveBeenCalledTimes(1);
    expect(onRequestRepeaterStatus).toHaveBeenCalledWith(99);

    await act(async () => {
      vi.advanceTimersByTime(MESHCORE_NOISE_FLOOR_TREND_POLL_MS);
      await flushMicrotasks();
    });
    expect(onRequestRepeaterStatus).toHaveBeenCalledTimes(2);
  });

  it('skips remote poll ticks while the document is hidden', async () => {
    const onRequestRepeaterStatus = vi.fn().mockResolvedValue(undefined);
    let visible = true;
    renderHook(() => {
      useMeshcoreNoiseFloorTrend({
        enabled: true,
        nodeId: 5,
        noiseFloor: -100,
        observedAt: 9_000,
        pollRemote: true,
        onRequestRepeaterStatus,
        pollIntervalMs: 1_000,
        isDocumentVisible: () => visible,
      });
    });

    visible = false;
    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await flushMicrotasks();
    });
    expect(onRequestRepeaterStatus).not.toHaveBeenCalled();

    visible = true;
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await flushMicrotasks();
    });
    expect(onRequestRepeaterStatus).toHaveBeenCalledTimes(1);
  });
});
