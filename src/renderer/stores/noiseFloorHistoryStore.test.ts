import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NOISE_FLOOR_HISTORY_MAX_POINTS,
  NOISE_FLOOR_SAMPLE_DEDUP_MS,
} from '../lib/meshcore/noiseFloorHistory';
import { selectNoiseFloorSeries, useNoiseFloorHistoryStore } from './noiseFloorHistoryStore';

describe('noiseFloorHistoryStore', () => {
  beforeEach(() => {
    useNoiseFloorHistoryStore.setState({ history: new Map() });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records finite readings including zero and ignores invalid node ids', () => {
    const store = useNoiseFloorHistoryStore.getState();
    expect(store.recordSample(0, -100)).toBe(false);
    expect(store.recordSample(7, Number.NaN)).toBe(false);
    expect(store.recordSample(7, 0)).toBe(true);
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 7)).toEqual([
      { t: expect.any(Number), noiseFloor: 0 },
    ]);
  });

  it('dedupes identical consecutive samples inside the dedup window', () => {
    const store = useNoiseFloorHistoryStore.getState();
    expect(store.recordSample(3, -105, 1_000)).toBe(true);
    expect(store.recordSample(3, -105, 1_000 + NOISE_FLOOR_SAMPLE_DEDUP_MS - 1)).toBe(false);
    expect(store.recordSample(3, -104, 1_000 + 10)).toBe(true);
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 3)).toHaveLength(2);
  });

  it('caps points per node', () => {
    const store = useNoiseFloorHistoryStore.getState();
    for (let i = 0; i < NOISE_FLOOR_HISTORY_MAX_POINTS + 3; i++) {
      store.recordSample(9, -100 - (i % 2), 1_000 + i * NOISE_FLOOR_SAMPLE_DEDUP_MS);
    }
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 9)).toHaveLength(
      NOISE_FLOOR_HISTORY_MAX_POINTS,
    );
  });

  it('clearNode removes only that series', () => {
    const store = useNoiseFloorHistoryStore.getState();
    store.recordSample(1, -110);
    store.recordSample(2, -100);
    store.clearNode(1);
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 1)).toHaveLength(0);
    expect(selectNoiseFloorSeries(useNoiseFloorHistoryStore.getState(), 2)).toHaveLength(1);
  });
});
