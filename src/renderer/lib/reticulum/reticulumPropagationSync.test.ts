import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

import {
  applyPropagationSyncEvent,
  clearPropagationSyncStallWatchdog,
  mapPropagationSyncError,
  normalizePropagationSyncProgress,
  schedulePropagationSyncStallWatchdog,
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

  afterEach(() => {
    clearPropagationSyncStallWatchdog();
    vi.useRealTimers();
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
    const attemptAt = 42_000;
    useReticulumPropagationStore.setState({
      sync: { active: true, progress: 70, message: null },
      lastPropagationSyncAt: null,
      lastPropagationSyncAttemptAt: attemptAt,
      activePropagationSyncAttemptAt: attemptAt,
    });

    applyPropagationSyncEvent({ active: false, progress: 100 });

    expect(useReticulumPropagationStore.getState().sync.active).toBe(false);
    expect(useReticulumPropagationStore.getState().sync.progress).toBe(0);
    expect(useReticulumPropagationStore.getState().lastPropagationSyncAt).toBeTypeOf('number');
    expect(useReticulumPropagationStore.getState().lastPropagationSyncAttemptAt).toBeNull();
  });

  it('late complete for an older attempt leaves a newer failed attempt stamp', () => {
    const olderAttempt = 1_000;
    const newerAttempt = 2_000;
    useReticulumPropagationStore.setState({
      sync: { active: false, progress: 0, message: null },
      lastSyncError: null,
      lastPropagationSyncAt: null,
      lastPropagationSyncAttemptAt: newerAttempt,
      // Stale complete still carrying the older run's active stamp.
      activePropagationSyncAttemptAt: olderAttempt,
    });

    applyPropagationSyncEvent({ active: false, progress: 100 });

    expect(useReticulumPropagationStore.getState().lastPropagationSyncAt).toBeTypeOf('number');
    expect(useReticulumPropagationStore.getState().lastPropagationSyncAttemptAt).toBe(newerAttempt);
    expect(useReticulumPropagationStore.getState().activePropagationSyncAttemptAt).toBeNull();
  });

  it('maps sidecar sync error codes to i18n keys', () => {
    expect(mapPropagationSyncError('LOCAL_PROPAGATION_SYNC_UNSUPPORTED')).toBe(
      'reticulumPropagation.syncLocalNotSupported',
    );
    expect(mapPropagationSyncError('PROPAGATION_IDENTITY_UNKNOWN')).toBe(
      'reticulumPropagation.syncIdentityUnknown',
    );
    expect(mapPropagationSyncError('PROPAGATION_TARGET_NOT_PN')).toBe(
      'reticulumPropagation.syncTargetNotPropagationNode',
    );
    expect(mapPropagationSyncError('PROPAGATION_PEERING_STAMP_FAILED')).toBe(
      'reticulumPropagation.syncPeeringStampFailed',
    );
    expect(mapPropagationSyncError('PROPAGATION_PEER_COST_EXCEEDS_MAX')).toBe(
      'reticulumPropagation.syncPeerCostExceedsMax',
    );
    expect(mapPropagationSyncError('PROPAGATION_OFFER_UNSUPPORTED')).toBe(
      'reticulumPropagation.offerUnsupported',
    );
    expect(mapPropagationSyncError('PROPAGATION_OFFER_PROBE_TIMEOUT')).toBe(
      'reticulumPropagation.offerProbeTimeout',
    );
    expect(mapPropagationSyncError('propagation offer rejected: ErrorInvalidKey')).toBe(
      'reticulumPropagation.syncOfferInvalidKey',
    );
    expect(mapPropagationSyncError('propagation establish failed: LrproofIdentityMissing')).toBe(
      'reticulumPropagation.syncEstablishIdentityMissing',
    );
    expect(mapPropagationSyncError('propagation establish failed: NoLinkProof')).toBe(
      'reticulumPropagation.syncEstablishNoLinkProof',
    );
    expect(mapPropagationSyncError('propagation offer rejected: Unknown')).toBe(
      'reticulumPropagation.syncOfferUnknown',
    );
    expect(mapPropagationSyncError('other')).toBe('reticulumPropagation.syncFailed');
  });

  it('maps WS failure message when sync ends with zero progress', () => {
    useReticulumPropagationStore.setState({
      sync: { active: true, progress: 10, message: null },
    });

    applyPropagationSyncEvent({
      active: false,
      progress: 0,
      message: 'propagation establish failed: LrproofIdentityMissing',
    });

    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      'reticulumPropagation.syncEstablishIdentityMissing',
    );
  });

  it('ignores late complete after cancel marked an error', () => {
    useReticulumPropagationStore.setState({
      sync: { active: false, progress: 0, message: null },
      lastSyncError: 'reticulumPropagation.syncCancelled',
      lastPropagationSyncAt: null,
    });

    applyPropagationSyncEvent({ active: false, progress: 100 });

    expect(useReticulumPropagationStore.getState().lastPropagationSyncAt).toBeNull();
  });

  it('stall watchdog only cancels while still establishing', async () => {
    vi.useFakeTimers();
    const cancelSync = vi.fn((opts?: { reasonKey?: string }) => {
      useReticulumPropagationStore.setState({
        sync: { active: false, progress: 0, message: null },
        lastSyncError: opts?.reasonKey ?? 'reticulumPropagation.syncCancelled',
      });
      return Promise.resolve(true);
    });
    useReticulumPropagationStore.setState({
      sync: { active: true, progress: 40, message: null },
      lastSyncError: null,
      cancelSync,
    });

    schedulePropagationSyncStallWatchdog();
    await vi.advanceTimersByTimeAsync(45_000);

    expect(cancelSync).not.toHaveBeenCalled();
    expect(useReticulumPropagationStore.getState().sync.active).toBe(true);
    expect(useReticulumPropagationStore.getState().lastSyncError).toBeNull();

    useReticulumPropagationStore.setState({
      sync: { active: true, progress: 10, message: null },
    });
    schedulePropagationSyncStallWatchdog();
    await vi.advanceTimersByTimeAsync(45_000);

    expect(cancelSync).toHaveBeenCalledWith({
      reasonKey: 'reticulumPropagation.syncTimedOut',
    });
    expect(useReticulumPropagationStore.getState().sync.active).toBe(false);
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      'reticulumPropagation.syncTimedOut',
    );
  });
});
