import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

import {
  applyPropagationSyncEvent,
  awaitPropagationSyncSettled,
  clearPropagationSyncStallWatchdog,
  isPropagationSyncSoftDeferError,
  mapPropagationSyncError,
  normalizePropagationSyncProgress,
  PROPAGATION_SYNC_SUPERSEDED,
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
    expect(mapPropagationSyncError('PROPAGATION_PATH_UNKNOWN')).toBe(
      'reticulumPropagation.syncPathUnknown',
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
    expect(mapPropagationSyncError('PROPAGATION_OFFER_PROBE_FAILED')).toBe(
      'reticulumPropagation.offerProbeFailed',
    );
    expect(mapPropagationSyncError('propagation offer rejected: ErrorInvalidKey')).toBe(
      'reticulumPropagation.syncOfferInvalidKey',
    );
    expect(mapPropagationSyncError('propagation establish failed: LrproofIdentityMissing')).toBe(
      'reticulumPropagation.syncEstablishIdentityMissing',
    );
    expect(mapPropagationSyncError('propagation establish failed: LrproofInvalid')).toBe(
      'reticulumPropagation.syncEstablishInvalidProof',
    );
    expect(mapPropagationSyncError('propagation establish failed: NoLinkProof')).toBe(
      'reticulumPropagation.syncEstablishNoLinkProof',
    );
    expect(mapPropagationSyncError('propagation offer rejected: Unknown')).toBe(
      'reticulumPropagation.syncOfferUnknown',
    );
    expect(mapPropagationSyncError('PROPAGATION_SYNC_OUTBOUND_BUSY')).toBe(
      'reticulumPropagation.syncOutboundBusy',
    );
    expect(mapPropagationSyncError('PROPAGATION_RETRIEVE_BUSY')).toBe(
      'reticulumPropagation.syncRetrieveBusy',
    );
    expect(mapPropagationSyncError('PROPAGATION_STACK_NOT_LIVE')).toBe(
      'reticulumPropagation.syncStackNotLive',
    );
    expect(mapPropagationSyncError('RNS stack not live')).toBe(
      'reticulumPropagation.syncStackNotLive',
    );
    expect(isPropagationSyncSoftDeferError('PROPAGATION_SYNC_OUTBOUND_BUSY')).toBe(true);
    expect(isPropagationSyncSoftDeferError('PROPAGATION_RETRIEVE_BUSY')).toBe(true);
    expect(isPropagationSyncSoftDeferError('PROPAGATION_STACK_NOT_LIVE')).toBe(true);
    expect(isPropagationSyncSoftDeferError('RNS stack not live')).toBe(true);
    expect(isPropagationSyncSoftDeferError('PROPAGATION_PATH_UNKNOWN')).toBe(false);
    expect(mapPropagationSyncError('propagation sync cancelled')).toBe(
      'reticulumPropagation.syncCancelled',
    );
    expect(mapPropagationSyncError(PROPAGATION_SYNC_SUPERSEDED)).toBeNull();
    expect(mapPropagationSyncError('other')).toBe('reticulumPropagation.syncFailed');
  });

  it('supersede clears active sync without unreachable error', () => {
    useReticulumPropagationStore.setState({
      sync: { active: true, progress: 10, message: null },
      lastSyncError: null,
    });
    applyPropagationSyncEvent({
      active: false,
      progress: 0,
      message: PROPAGATION_SYNC_SUPERSEDED,
    });
    expect(useReticulumPropagationStore.getState().sync.active).toBe(false);
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(PROPAGATION_SYNC_SUPERSEDED);
  });

  it('maps cancel message to syncCancelled not syncFailed', () => {
    useReticulumPropagationStore.setState({
      sync: { active: true, progress: 10, message: null },
    });
    applyPropagationSyncEvent({
      active: false,
      progress: 0,
      message: 'propagation sync cancelled',
    });
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      'reticulumPropagation.syncCancelled',
    );
  });

  it('ignores late cancel after local settle already idle', () => {
    useReticulumPropagationStore.setState({
      sync: { active: false, progress: 0, message: null },
      lastSyncError: null,
      lastPropagationSyncAt: Date.now(),
    });
    applyPropagationSyncEvent({
      active: false,
      progress: 0,
      message: 'propagation sync cancelled',
    });
    expect(useReticulumPropagationStore.getState().lastSyncError).toBeNull();
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

  describe('awaitPropagationSyncSettled', () => {
    it('resolves immediately when the attempt already settled', async () => {
      useReticulumPropagationStore.setState({
        sync: { active: false, progress: 0, message: null },
        lastSyncError: null,
      });
      await expect(awaitPropagationSyncSettled()).resolves.toBe('success');

      useReticulumPropagationStore.setState({
        lastSyncError: 'reticulumPropagation.syncFailed',
      });
      await expect(awaitPropagationSyncSettled()).resolves.toBe('failed');
    });

    it('waits for the websocket terminal frame before reporting failure', async () => {
      useReticulumPropagationStore.setState({
        sync: { active: true, progress: 5, message: null },
        lastSyncError: null,
      });

      const settled = awaitPropagationSyncSettled();
      let resolvedEarly = false;
      void settled.then(() => {
        resolvedEarly = true;
      });
      await Promise.resolve();
      expect(resolvedEarly).toBe(false);

      applyPropagationSyncEvent({
        active: false,
        progress: 0,
        message: 'propagation establish failed: NoLinkProof',
      });

      await expect(settled).resolves.toBe('failed');
    });

    it('reports a user cancel separately so a cascade can stop', async () => {
      useReticulumPropagationStore.setState({
        sync: { active: true, progress: 5, message: null },
        lastSyncError: null,
      });

      const settled = awaitPropagationSyncSettled();
      useReticulumPropagationStore.setState({
        sync: { active: false, progress: 0, message: null },
        lastSyncError: 'reticulumPropagation.syncCancelled',
      });

      await expect(settled).resolves.toBe('cancelled');
    });

    it('does not resolve supersede as success', async () => {
      useReticulumPropagationStore.setState({
        sync: { active: true, progress: 5, message: null },
        lastSyncError: null,
      });

      const settled = awaitPropagationSyncSettled();
      applyPropagationSyncEvent({
        active: false,
        progress: 0,
        message: PROPAGATION_SYNC_SUPERSEDED,
      });

      await expect(settled).resolves.toBe('cancelled');
      expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
        PROPAGATION_SYNC_SUPERSEDED,
      );
    });

    it('cancels and reports failure when no terminal frame ever arrives', async () => {
      vi.useFakeTimers();
      const cancelSync = vi.fn(() => {
        useReticulumPropagationStore.setState({
          sync: { active: false, progress: 0, message: null },
          lastSyncError: 'reticulumPropagation.syncTimedOut',
        });
        return Promise.resolve(true);
      });
      useReticulumPropagationStore.setState({
        sync: { active: true, progress: 5, message: null },
        lastSyncError: null,
        cancelSync,
      });

      const settled = awaitPropagationSyncSettled({ timeoutMs: 1_000 });
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(settled).resolves.toBe('failed');
      expect(cancelSync).toHaveBeenCalledWith({
        reasonKey: 'reticulumPropagation.syncTimedOut',
      });
    });
  });
});
