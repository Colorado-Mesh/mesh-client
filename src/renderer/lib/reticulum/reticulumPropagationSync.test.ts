import { beforeEach, describe, expect, it } from 'vitest';

import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

import {
  applyPropagationSyncEvent,
  clearPropagationSyncStallWatchdog,
  normalizePropagationSyncProgress,
} from './reticulumPropagationSync';

describe('reticulumPropagationSync', () => {
  beforeEach(() => {
    clearPropagationSyncStallWatchdog();
    useReticulumPropagationStore.setState({
      sync: { active: false, progress: 0, message: null },
      lastSyncError: null,
      lastPropagationSyncAt: null,
    });
  });

  it('normalizes fractional sidecar progress to percent width', () => {
    expect(normalizePropagationSyncProgress(0.1)).toBe(10);
    expect(normalizePropagationSyncProgress(0.7)).toBe(70);
    expect(normalizePropagationSyncProgress(100)).toBe(100);
  });

  it('records failure when sync ends with zero progress', () => {
    useReticulumPropagationStore.setState({
      sync: { active: true, progress: 10, message: null },
    });

    applyPropagationSyncEvent({ active: false, progress: 0 });

    expect(useReticulumPropagationStore.getState().sync.active).toBe(false);
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      'reticulumPropagation.syncFailed',
    );
  });

  it('clears active sync on completion event', () => {
    useReticulumPropagationStore.setState({
      sync: { active: true, progress: 70, message: null },
      lastPropagationSyncAt: null,
    });

    applyPropagationSyncEvent({ active: false, progress: 100 });

    expect(useReticulumPropagationStore.getState().sync.active).toBe(false);
    expect(useReticulumPropagationStore.getState().sync.progress).toBe(0);
    expect(useReticulumPropagationStore.getState().lastPropagationSyncAt).toBeTypeOf('number');
  });
});
