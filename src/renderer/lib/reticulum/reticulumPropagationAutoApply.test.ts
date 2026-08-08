import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type PropagationStartSyncResult,
  useReticulumPropagationStore,
} from '@/renderer/stores/reticulumPropagationStore';

import {
  PROPAGATION_SYNC_LOCAL_LOADING_KEY,
  PROPAGATION_SYNC_NO_TARGET_KEY,
  resetPropagationSyncCascadeState,
  startPropagationSyncCascade,
  startPropagationSyncWithTarget,
} from './reticulumPropagationAutoApply';
import {
  RETICULUM_PROPAGATION_MODE_KEY,
  writeReticulumPropagationMode,
} from './reticulumPropagationMode';
import {
  hasRecentReticulumPropagationSyncFailure,
  resetReticulumPropagationSyncFailures,
} from './reticulumPropagationSyncBackoff';

type SettleOutcome = 'success' | 'failure' | 'cancel';

const SETTLE_ERROR_KEYS: Record<SettleOutcome, string | null> = {
  success: null,
  failure: 'reticulumPropagation.syncFailed',
  cancel: 'reticulumPropagation.syncCancelled',
};

/**
 * Mimics the real `startSync`: the sidecar accepts the request now and the outcome only
 * arrives later on the websocket stream.
 */
function deferredStartSync(outcomeFor: (id: string) => SettleOutcome) {
  return vi.fn((id?: string): Promise<PropagationStartSyncResult> => {
    const target = id ?? '';
    useReticulumPropagationStore.setState({
      sync: { active: true, progress: 5, message: null },
      lastSyncError: null,
      syncTargetId: target,
    });
    setTimeout(() => {
      useReticulumPropagationStore.setState({
        sync: { active: false, progress: 0, message: null },
        lastSyncError: SETTLE_ERROR_KEYS[outcomeFor(target)],
      });
    }, 0);
    return Promise.resolve('accepted');
  });
}

describe('reticulumPropagationAutoApply', () => {
  beforeEach(() => {
    resetPropagationSyncCascadeState();
    resetReticulumPropagationSyncFailures();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
    });
    vi.stubGlobal('electronAPI', {
      reticulum: {
        proxyGet: vi.fn().mockResolvedValue({
          interfaces: [{ id: 'tcp1', enabled: true }],
        }),
      },
    });
    // electronAPI is on window in renderer
    Object.defineProperty(globalThis, 'window', {
      value: {
        electronAPI: {
          reticulum: {
            proxyGet: vi.fn().mockResolvedValue({
              interfaces: [{ id: 'tcp1', enabled: true }],
            }),
          },
        },
      },
      writable: true,
      configurable: true,
    });
    writeReticulumPropagationMode('auto');
    useReticulumPropagationStore.setState({
      nodes: [
        {
          id: 'local-prop',
          name: 'Local',
          enabled: true,
          status: 'known',
        },
        {
          id: 'pn-aabb1111',
          name: 'Remote',
          enabled: true,
          status: 'known',
          hops: 2,
          destination_hash: 'aabb'.repeat(8),
        },
      ],
      discovered: [],
      preferredId: null,
      sync: { active: false, progress: 0, message: null },
      lastSyncError: null,
      syncTargetId: null,
      setPreferredOnSidecar: vi.fn().mockResolvedValue(true),
      addFromDiscovered: vi.fn().mockResolvedValue(true),
      startSync: vi.fn().mockResolvedValue('accepted'),
      refreshFromSidecar: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Auto one-time syncs best discovered by hash without Add or Preferred', async () => {
    const hash = 'dead'.repeat(8);
    const addFromDiscovered = vi.fn().mockResolvedValue(true);
    const setPreferred = vi.fn().mockResolvedValue(true);
    const startSync = vi.fn().mockResolvedValue('accepted');
    useReticulumPropagationStore.setState({
      preferredId: null,
      nodes: [
        {
          id: 'local-prop',
          name: 'Local',
          enabled: true,
          status: 'known',
        },
      ],
      discovered: [
        {
          destination_hash: hash,
          node_state: true,
          peering_cost: 0,
          hops: 0,
        },
      ],
      addFromDiscovered,
      setPreferredOnSidecar: setPreferred,
      startSync,
    });
    await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(true);
    expect(startSync).toHaveBeenCalledWith(hash);
    expect(addFromDiscovered).not.toHaveBeenCalled();
    expect(setPreferred).not.toHaveBeenCalled();
    expect(startSync).not.toHaveBeenCalledWith('local-prop');
  });

  it('Auto with no enabled interfaces settles local only', async () => {
    const hash = 'dead'.repeat(8);
    const addFromDiscovered = vi.fn().mockResolvedValue(true);
    const startSync = vi.fn().mockResolvedValue('accepted');
    useReticulumPropagationStore.setState({
      nodes: [
        {
          id: 'local-prop',
          name: 'Local',
          enabled: true,
          status: 'known',
        },
      ],
      discovered: [
        {
          destination_hash: hash,
          node_state: true,
          peering_cost: 0,
          hops: 0,
        },
      ],
      addFromDiscovered,
      startSync,
    });
    await expect(startPropagationSyncCascade({ hasEnabledInterfaces: false })).resolves.toBe(true);
    expect(startSync).toHaveBeenCalledWith('local-prop');
    expect(startSync).toHaveBeenCalledTimes(1);
    expect(addFromDiscovered).not.toHaveBeenCalled();
  });

  it('Auto syncs configured remote without Preferred write when no discoveries', async () => {
    const setPreferred = vi.mocked(useReticulumPropagationStore.getState().setPreferredOnSidecar);
    const startSync = vi.mocked(useReticulumPropagationStore.getState().startSync);
    const addFromDiscovered = vi.mocked(useReticulumPropagationStore.getState().addFromDiscovered);
    await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(true);
    expect(startSync).toHaveBeenCalledWith('pn-aabb1111');
    expect(addFromDiscovered).not.toHaveBeenCalled();
    expect(setPreferred).not.toHaveBeenCalled();
  });

  it('Auto cascade falls back to local-prop when remote sync fails', async () => {
    const startSync = vi.fn().mockResolvedValueOnce('failed').mockResolvedValueOnce('accepted');
    useReticulumPropagationStore.setState({
      preferredId: 'pn-aabb1111',
      startSync,
    });
    await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(true);
    expect(startSync).toHaveBeenCalledWith('pn-aabb1111');
    expect(startSync).toHaveBeenCalledWith('local-prop');
  });

  it('Manual Preferred local-prop syncs local settle', async () => {
    writeReticulumPropagationMode('manual');
    const startSync = vi.fn().mockResolvedValue('accepted');
    useReticulumPropagationStore.setState({
      preferredId: 'local-prop',
      startSync,
    });
    await expect(startPropagationSyncWithTarget('local-prop')).resolves.toBe(true);
    expect(startSync).toHaveBeenCalledWith('local-prop');
    expect(startSync).toHaveBeenCalledTimes(1);
  });

  it('Manual remote failure falls back to local-prop', async () => {
    writeReticulumPropagationMode('manual');
    const startSync = vi.fn().mockResolvedValueOnce('failed').mockResolvedValueOnce('accepted');
    useReticulumPropagationStore.setState({
      preferredId: 'pn-aabb1111',
      startSync,
    });
    await expect(startPropagationSyncWithTarget('pn-aabb1111')).resolves.toBe(true);
    expect(startSync.mock.calls.map((c) => c[0])).toEqual(['pn-aabb1111', 'local-prop']);
  });

  it('Manual tries the other added remotes before local-prop', async () => {
    writeReticulumPropagationMode('manual');
    const startSync = vi
      .fn()
      .mockResolvedValueOnce('failed')
      .mockResolvedValueOnce('failed')
      .mockResolvedValueOnce('accepted');
    useReticulumPropagationStore.setState({
      nodes: [
        { id: 'local-prop', name: 'Local', enabled: true, status: 'known' },
        { id: 'pn-near', name: 'Near', enabled: true, status: 'known', hops: 1 },
        { id: 'pn-far', name: 'Far', enabled: true, status: 'known', hops: 4 },
      ],
      preferredId: 'pn-far',
      startSync,
    });
    await expect(startPropagationSyncCascade()).resolves.toBe(true);
    expect(startSync.mock.calls.map((c) => c[0])).toEqual(['pn-far', 'pn-near', 'local-prop']);
  });

  it('Manual without Preferred picks the closest remote without writing Preferred', async () => {
    writeReticulumPropagationMode('manual');
    const setPreferred = vi.fn().mockResolvedValue(true);
    const addFromDiscovered = vi.fn().mockResolvedValue(true);
    const startSync = vi.fn().mockResolvedValue('accepted');
    useReticulumPropagationStore.setState({
      nodes: [
        { id: 'local-prop', name: 'Local', enabled: true, status: 'known' },
        { id: 'pn-near', name: 'Near', enabled: true, status: 'known', hops: 1 },
        { id: 'pn-far', name: 'Far', enabled: true, status: 'known', hops: 4 },
      ],
      preferredId: null,
      setPreferredOnSidecar: setPreferred,
      addFromDiscovered,
      startSync,
    });
    await expect(startPropagationSyncCascade()).resolves.toBe(true);
    expect(startSync).toHaveBeenCalledWith('pn-near');
    expect(startSync).toHaveBeenCalledTimes(1);
    expect(setPreferred).not.toHaveBeenCalled();
    expect(addFromDiscovered).not.toHaveBeenCalled();
  });

  it('Manual with no added remotes settles local-prop only', async () => {
    writeReticulumPropagationMode('manual');
    const startSync = vi.fn().mockResolvedValue('accepted');
    useReticulumPropagationStore.setState({
      nodes: [{ id: 'local-prop', name: 'Local', enabled: true, status: 'known' }],
      preferredId: null,
      startSync,
    });
    await expect(startPropagationSyncCascade()).resolves.toBe(true);
    expect(startSync.mock.calls.map((c) => c[0])).toEqual(['local-prop']);
  });

  it('Off never syncs, even with an explicit target or Preferred', async () => {
    writeReticulumPropagationMode('off');
    const startSync = vi.fn().mockResolvedValue('accepted');
    useReticulumPropagationStore.setState({
      preferredId: 'pn-aabb1111',
      startSync,
    });
    await expect(startPropagationSyncCascade()).resolves.toBe(false);
    await expect(startPropagationSyncWithTarget('pn-aabb1111')).resolves.toBe(false);
    await expect(startPropagationSyncWithTarget('local-prop')).resolves.toBe(false);
    expect(startSync).not.toHaveBeenCalled();
  });

  it('Auto with nothing available reports no target instead of an unreachable node', async () => {
    const startSync = vi.fn().mockResolvedValue('accepted');
    useReticulumPropagationStore.setState({
      nodes: [{ id: 'local-prop', name: 'Local', enabled: false, status: 'idle' }],
      discovered: [],
      preferredId: null,
      lastSyncError: null,
      startSync,
    });
    await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(false);
    expect(startSync).not.toHaveBeenCalled();
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      PROPAGATION_SYNC_NO_TARGET_KEY,
    );
  });

  it('Auto reports the local inbox as loading while its messagestore is read', async () => {
    const startSync = vi.fn().mockResolvedValue('accepted');
    useReticulumPropagationStore.setState({
      nodes: [{ id: 'local-prop', name: 'Local', enabled: false, status: 'loading' }],
      discovered: [],
      preferredId: null,
      lastSyncError: null,
      startSync,
    });
    await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(false);
    expect(startSync).not.toHaveBeenCalled();
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      PROPAGATION_SYNC_LOCAL_LOADING_KEY,
    );
  });

  it('keeps the real sync error when a node was actually contacted', async () => {
    const startSync = vi.fn().mockImplementation(() => {
      useReticulumPropagationStore.setState({
        lastSyncError: 'reticulumPropagation.syncEstablishNoLinkProof',
      });
      return Promise.resolve('failed');
    });
    useReticulumPropagationStore.setState({
      nodes: [
        { id: 'local-prop', name: 'Local', enabled: false, status: 'idle' },
        { id: 'pn-aabb1111', name: 'Remote', enabled: true, status: 'known', hops: 2 },
      ],
      discovered: [],
      preferredId: null,
      lastSyncError: null,
      startSync,
    });
    await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(false);
    expect(startSync).toHaveBeenCalledWith('pn-aabb1111');
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      'reticulumPropagation.syncEstablishNoLinkProof',
    );
  });

  it('leaves the sync target naming the last node tried', async () => {
    const startSync = vi.fn().mockImplementation((id: string) => {
      useReticulumPropagationStore.setState({ syncTargetId: id });
      return Promise.resolve('failed');
    });
    useReticulumPropagationStore.setState({
      nodes: [
        { id: 'local-prop', name: 'Local', enabled: true, status: 'known' },
        { id: 'pn-aabb1111', name: 'Remote', enabled: true, status: 'known', hops: 2 },
      ],
      discovered: [],
      preferredId: null,
      syncTargetId: null,
      startSync,
    });
    await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(false);
    expect(startSync).toHaveBeenLastCalledWith('local-prop');
    expect(useReticulumPropagationStore.getState().syncTargetId).toBe('local-prop');
  });

  it('clears the sync target when the cascade contacts nobody', async () => {
    useReticulumPropagationStore.setState({
      nodes: [{ id: 'local-prop', name: 'Local', enabled: false, status: 'idle' }],
      discovered: [],
      preferredId: null,
      // Stale target from an earlier sync must not be blamed for "nothing to sync with".
      syncTargetId: 'pn-aabb1111',
      startSync: vi.fn().mockResolvedValue('accepted'),
    });
    await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(false);
    expect(useReticulumPropagationStore.getState().syncTargetId).toBeNull();
  });

  it('honors persisted Auto mode key', () => {
    expect(localStorage.getItem(RETICULUM_PROPAGATION_MODE_KEY)).toBe('auto');
  });

  describe('attempts that fail after the sidecar accepts them', () => {
    const near = 'aa11'.repeat(8);
    const far = 'bb22'.repeat(8);

    const setUpTwoDiscovered = (startSync: ReturnType<typeof deferredStartSync>) => {
      useReticulumPropagationStore.setState({
        nodes: [
          { id: 'local-prop', name: 'Local', enabled: true, status: 'known' },
          {
            id: 'pn-aabb1111',
            name: 'Remote',
            enabled: true,
            status: 'known',
            hops: 2,
            destination_hash: 'aabb'.repeat(8),
          },
        ],
        discovered: [
          { destination_hash: near, node_state: true, peering_cost: 0, hops: 0 },
          { destination_hash: far, node_state: true, peering_cost: 0, hops: 1 },
        ],
        preferredId: null,
        startSync,
      });
    };

    it('Auto moves on to the next discovered node instead of stopping', async () => {
      const startSync = deferredStartSync((id) => (id === near ? 'failure' : 'success'));
      setUpTwoDiscovered(startSync);

      await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(true);
      expect(startSync.mock.calls.map((c) => c[0])).toEqual([near, far]);
    });

    it('Auto reaches the local inbox after every remote fails', async () => {
      const startSync = deferredStartSync((id) => (id === 'local-prop' ? 'success' : 'failure'));
      setUpTwoDiscovered(startSync);

      await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(true);
      expect(startSync.mock.calls.map((c) => c[0])).toEqual([
        near,
        far,
        'pn-aabb1111',
        'local-prop',
      ]);
    });

    it('Manual moves on to the next added remote instead of stopping', async () => {
      writeReticulumPropagationMode('manual');
      const startSync = deferredStartSync((id) => (id === 'pn-far' ? 'failure' : 'success'));
      useReticulumPropagationStore.setState({
        nodes: [
          { id: 'local-prop', name: 'Local', enabled: true, status: 'known' },
          { id: 'pn-near', name: 'Near', enabled: true, status: 'known', hops: 1 },
          { id: 'pn-far', name: 'Far', enabled: true, status: 'known', hops: 4 },
        ],
        preferredId: 'pn-far',
        startSync,
      });

      await expect(startPropagationSyncCascade()).resolves.toBe(true);
      expect(startSync.mock.calls.map((c) => c[0])).toEqual(['pn-far', 'pn-near']);
    });

    it('stops the cascade when the user cancels the attempt', async () => {
      const startSync = deferredStartSync(() => 'cancel');
      setUpTwoDiscovered(startSync);

      await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(
        false,
      );
      expect(startSync).toHaveBeenCalledTimes(1);
      expect(startSync).toHaveBeenCalledWith(near);
    });

    it('omits a node that failed recently on the next cascade', async () => {
      const startSync = deferredStartSync((id) => (id === near ? 'failure' : 'success'));
      setUpTwoDiscovered(startSync);

      await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(true);
      expect(startSync.mock.calls.map((c) => c[0])).toEqual([near, far]);

      startSync.mockClear();
      await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(true);
      expect(startSync.mock.calls.map((c) => c[0])).toEqual([far]);
    });

    it('refreshes sidecar nodes before local fallback when local looks disabled', async () => {
      const startSync = deferredStartSync((id) => (id === 'local-prop' ? 'success' : 'failure'));
      const refreshFromSidecar = vi.fn().mockImplementation(() => {
        useReticulumPropagationStore.setState({
          nodes: [
            { id: 'local-prop', name: 'Local', enabled: true, status: 'known' },
            {
              id: 'pn-aabb1111',
              name: 'Remote',
              enabled: true,
              status: 'known',
              hops: 2,
              destination_hash: 'aabb'.repeat(8),
            },
          ],
        });
        return Promise.resolve();
      });
      useReticulumPropagationStore.setState({
        nodes: [
          { id: 'local-prop', name: 'Local', enabled: false, status: 'loading' },
          {
            id: 'pn-aabb1111',
            name: 'Remote',
            enabled: true,
            status: 'known',
            hops: 2,
            destination_hash: 'aabb'.repeat(8),
          },
        ],
        discovered: [{ destination_hash: near, node_state: true, peering_cost: 0, hops: 0 }],
        preferredId: null,
        startSync,
        refreshFromSidecar,
      });

      await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(true);
      expect(refreshFromSidecar).toHaveBeenCalled();
      expect(startSync.mock.calls.map((c) => c[0])).toEqual([near, 'pn-aabb1111', 'local-prop']);
    });

    it('skips straight to local when every discovered node failed recently', async () => {
      const startSync = deferredStartSync((id) => (id === 'local-prop' ? 'success' : 'failure'));
      setUpTwoDiscovered(startSync);

      await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(true);
      expect(startSync.mock.calls.map((c) => c[0])).toEqual([
        near,
        far,
        'pn-aabb1111',
        'local-prop',
      ]);

      startSync.mockClear();
      await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(true);
      expect(startSync.mock.calls.map((c) => c[0])).toEqual(['local-prop']);
    });

    it('settles the local inbox once the remote budget is spent', async () => {
      let nowMs = 1_000_000;
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
      const startSync = deferredStartSync((id) => (id === 'local-prop' ? 'success' : 'failure'));
      const slowStartSync = vi.fn((id?: string) => {
        nowMs += 6 * 60_000;
        return startSync(id);
      });
      setUpTwoDiscovered(slowStartSync);

      await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(true);
      expect(slowStartSync.mock.calls.map((c) => c[0])).toEqual([near, 'local-prop']);
      nowSpy.mockRestore();
    });

    it('shares one run when auto-sync ticks overlap', async () => {
      const startSync = deferredStartSync((id) => (id === 'local-prop' ? 'success' : 'failure'));
      setUpTwoDiscovered(startSync);

      // The second tick must join the running cascade rather than start a competing chain.
      const first = startPropagationSyncCascade({ hasEnabledInterfaces: true });
      const second = startPropagationSyncCascade({ hasEnabledInterfaces: true });

      await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
      expect(startSync.mock.calls.map((c) => c[0])).toEqual([
        near,
        far,
        'pn-aabb1111',
        'local-prop',
      ]);
    });

    it('OUTBOUND_BUSY advances without 15-minute backoff', async () => {
      const settleOk = deferredStartSync(() => 'success');
      const startSync = vi.fn((id?: string) => {
        if (id === near) return Promise.resolve('deferred' as const);
        return settleOk(id);
      });
      setUpTwoDiscovered(startSync);

      await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(true);
      expect(startSync.mock.calls.map((c) => c[0])).toEqual([near, far]);
      expect(hasRecentReticulumPropagationSyncFailure(near)).toBe(false);

      startSync.mockClear();
      await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(true);
      // Near was deferred, not failed — next cascade may try it again.
      expect(startSync.mock.calls.map((c) => c[0])[0]).toBe(near);
    });

    it('skips a configured remote whose hash was already tried as the Manual seed', async () => {
      writeReticulumPropagationMode('manual');
      const shared = 'ccccdddd'.repeat(4);
      const startSync = deferredStartSync((id) => (id === 'local-prop' ? 'success' : 'failure'));
      useReticulumPropagationStore.setState({
        nodes: [
          { id: 'local-prop', name: 'Local', enabled: true, status: 'known' },
          {
            id: 'pn-shared',
            name: 'Same hash as seed',
            enabled: true,
            status: 'known',
            hops: 1,
            destination_hash: shared,
          },
          {
            id: 'pn-other',
            name: 'Other',
            enabled: true,
            status: 'known',
            hops: 2,
            destination_hash: 'ddddcccc'.repeat(4),
          },
        ],
        preferredId: null,
        startSync,
      });

      await expect(
        startPropagationSyncCascade({ firstTargetId: shared, hasEnabledInterfaces: true }),
      ).resolves.toBe(true);
      // Seed hash failed; pn-shared shares that hash so it is skipped; pn-other then local.
      expect(startSync.mock.calls.map((c) => c[0])).toEqual([
        shared.toLowerCase(),
        'pn-other',
        'local-prop',
      ]);
    });

    it('explicit Sync supersedes an in-flight auto cascade', async () => {
      let releaseNear!: () => void;
      const nearBlocked = new Promise<void>((resolve) => {
        releaseNear = resolve;
      });
      const startSync = vi.fn((id?: string) => {
        useReticulumPropagationStore.setState({
          sync: { active: true, progress: 5, message: null },
          lastSyncError: null,
          syncTargetId: id ?? '',
        });
        if (id === near) {
          return nearBlocked.then(() => {
            useReticulumPropagationStore.setState({
              sync: { active: false, progress: 0, message: null },
              lastSyncError: 'reticulumPropagation.syncFailed',
            });
            return 'accepted' as const;
          });
        }
        setTimeout(() => {
          useReticulumPropagationStore.setState({
            sync: { active: false, progress: 0, message: null },
            lastSyncError: null,
          });
        }, 0);
        return Promise.resolve('accepted' as const);
      });
      setUpTwoDiscovered(startSync);

      const autoRun = startPropagationSyncCascade({ hasEnabledInterfaces: true });
      // Wait until the first discovered attempt is in flight.
      await vi.waitFor(() => {
        expect(startSync).toHaveBeenCalledWith(near);
      });
      const callsWhileBlocked = startSync.mock.calls.length;

      // firstTargetId is ignored in Auto for cascade order, but still bumps generation
      // so this explicit Sync supersedes the in-flight auto tick.
      const explicit = startPropagationSyncCascade({
        firstTargetId: 'pn-aabb1111',
        hasEnabledInterfaces: true,
      });
      releaseNear();
      await expect(autoRun).resolves.toBe(false);
      await expect(explicit).resolves.toBe(true);
      expect(startSync.mock.calls.length).toBeGreaterThan(callsWhileBlocked);
    });

    it('stops the cascade when mode flips to Off mid-run', async () => {
      let releaseNear!: () => void;
      const nearBlocked = new Promise<void>((resolve) => {
        releaseNear = resolve;
      });
      const startSync = vi.fn((id?: string) => {
        useReticulumPropagationStore.setState({
          sync: { active: true, progress: 5, message: null },
          lastSyncError: null,
          syncTargetId: id ?? '',
        });
        if (id === near) {
          return nearBlocked.then(() => {
            useReticulumPropagationStore.setState({
              sync: { active: false, progress: 0, message: null },
              lastSyncError: 'reticulumPropagation.syncFailed',
            });
            return 'accepted' as const;
          });
        }
        return Promise.resolve('accepted' as const);
      });
      setUpTwoDiscovered(startSync);

      const autoRun = startPropagationSyncCascade({ hasEnabledInterfaces: true });
      await vi.waitFor(() => {
        expect(startSync).toHaveBeenCalledWith(near);
      });
      writeReticulumPropagationMode('off');
      releaseNear();
      await expect(autoRun).resolves.toBe(false);
      expect(startSync).toHaveBeenCalledTimes(1);
    });

    it('keeps a remote error when local is still loading after remotes failed', async () => {
      const startSync = vi.fn((id?: string) => {
        useReticulumPropagationStore.setState({
          syncTargetId: id ?? null,
          lastSyncError: 'reticulumPropagation.syncEstablishNoLinkProof',
        });
        return Promise.resolve('failed' as const);
      });
      useReticulumPropagationStore.setState({
        nodes: [
          { id: 'local-prop', name: 'Local', enabled: false, status: 'loading' },
          {
            id: 'pn-aabb1111',
            name: 'Remote',
            enabled: true,
            status: 'known',
            hops: 2,
            destination_hash: 'aabb'.repeat(8),
          },
        ],
        discovered: [],
        preferredId: null,
        lastSyncError: null,
        startSync,
      });

      await expect(startPropagationSyncCascade({ hasEnabledInterfaces: true })).resolves.toBe(
        false,
      );
      expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
        'reticulumPropagation.syncEstablishNoLinkProof',
      );
      expect(useReticulumPropagationStore.getState().syncTargetId).toBe('pn-aabb1111');
    });
  });
});
