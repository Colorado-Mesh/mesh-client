import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pushAppToast } from '@/renderer/components/Toast';
import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

import {
  applyAutoPropagationPreferredIfNeeded,
  bumpPropagationModeGeneration,
  ensurePreferredThenStartSync,
  getPropagationModeGeneration,
  resetPropagationAutoApplyForTests,
} from './reticulumPropagationAutoApply';
import {
  RETICULUM_PROPAGATION_MODE_KEY,
  writeReticulumPropagationMode,
} from './reticulumPropagationMode';

vi.mock('@/renderer/components/Toast', () => ({
  pushAppToast: vi.fn(),
}));

vi.mock('@/renderer/lib/i18n', () => ({
  default: { t: (key: string) => key },
}));

describe('reticulumPropagationAutoApply', () => {
  beforeEach(() => {
    resetPropagationAutoApplyForTests();
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
      setPreferredOnSidecar: vi.fn().mockResolvedValue(true),
      addFromDiscovered: vi.fn().mockResolvedValue(true),
      startSync: vi.fn().mockResolvedValue(true),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetPropagationAutoApplyForTests();
  });

  it('sets Preferred to the best configured remote in Auto', async () => {
    const setPreferred = vi.mocked(useReticulumPropagationStore.getState().setPreferredOnSidecar);
    await expect(applyAutoPropagationPreferredIfNeeded()).resolves.toBe('applied');
    expect(setPreferred).toHaveBeenCalledWith('pn-aabb1111');
  });

  it('soft-upserts a closer discovered node', async () => {
    const hash = 'dead'.repeat(8);
    useReticulumPropagationStore.setState({
      discovered: [
        {
          destination_hash: hash,
          node_state: true,
          peering_cost: 0,
          hops: 0,
        },
      ],
    });
    const addFromDiscovered = vi.mocked(useReticulumPropagationStore.getState().addFromDiscovered);
    await expect(applyAutoPropagationPreferredIfNeeded()).resolves.toBe('applied');
    expect(addFromDiscovered).toHaveBeenCalledWith(hash, { prefer: true });
  });

  it('skips when mode is not Auto', async () => {
    writeReticulumPropagationMode('manual');
    await expect(applyAutoPropagationPreferredIfNeeded()).resolves.toBe('skipped');
    expect(useReticulumPropagationStore.getState().setPreferredOnSidecar).not.toHaveBeenCalled();
  });

  it('skips when a sync is active', async () => {
    useReticulumPropagationStore.setState({
      sync: { active: true, progress: 10, message: null },
    });
    await expect(applyAutoPropagationPreferredIfNeeded()).resolves.toBe('skipped');
  });

  it('discards results after mode generation bump', async () => {
    let resolvePreferred!: (ok: boolean) => void;
    useReticulumPropagationStore.setState({
      setPreferredOnSidecar: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolvePreferred = resolve;
          }),
      ),
    });
    const pending = applyAutoPropagationPreferredIfNeeded();
    bumpPropagationModeGeneration();
    writeReticulumPropagationMode('manual');
    resolvePreferred(true);
    await expect(pending).resolves.toBe('skipped');
  });

  it('ensurePreferredThenStartSync aligns Preferred then syncs remote', async () => {
    const setPreferred = vi.mocked(useReticulumPropagationStore.getState().setPreferredOnSidecar);
    const startSync = vi.mocked(useReticulumPropagationStore.getState().startSync);
    useReticulumPropagationStore.setState({ preferredId: null });
    // After setPreferred, store must reflect preferred for ensurePreferredThenStartSync path.
    setPreferred.mockImplementation((id: string) => {
      useReticulumPropagationStore.setState({ preferredId: id });
      return Promise.resolve(true);
    });
    await expect(ensurePreferredThenStartSync('pn-aabb1111')).resolves.toBe(true);
    expect(setPreferred).toHaveBeenCalledWith('pn-aabb1111');
    expect(startSync).toHaveBeenCalledWith('pn-aabb1111');
  });

  it('Auto cascade falls back to local-prop when remote sync fails', async () => {
    const startSync = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    useReticulumPropagationStore.setState({
      preferredId: 'pn-aabb1111',
      startSync,
      setPreferredOnSidecar: vi.fn().mockResolvedValue(true),
    });
    await expect(ensurePreferredThenStartSync('pn-aabb1111')).resolves.toBe(true);
    expect(startSync).toHaveBeenCalledWith('pn-aabb1111');
    expect(startSync).toHaveBeenCalledWith('local-prop');
  });

  it('Manual Preferred local-prop syncs local settle', async () => {
    writeReticulumPropagationMode('manual');
    const startSync = vi.fn().mockResolvedValue(true);
    useReticulumPropagationStore.setState({
      preferredId: 'local-prop',
      startSync,
    });
    await expect(ensurePreferredThenStartSync('local-prop')).resolves.toBe(true);
    expect(startSync).toHaveBeenCalledWith('local-prop');
    expect(startSync).toHaveBeenCalledTimes(1);
  });

  it('Manual remote failure falls back to local-prop', async () => {
    writeReticulumPropagationMode('manual');
    const startSync = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    useReticulumPropagationStore.setState({
      preferredId: 'pn-aabb1111',
      startSync,
    });
    await expect(ensurePreferredThenStartSync('pn-aabb1111')).resolves.toBe(true);
    expect(startSync.mock.calls.map((c) => c[0])).toEqual(['pn-aabb1111', 'local-prop']);
  });

  it('noop when Preferred already matches', async () => {
    useReticulumPropagationStore.setState({ preferredId: 'pn-aabb1111' });
    await expect(applyAutoPropagationPreferredIfNeeded()).resolves.toBe('noop');
    expect(useReticulumPropagationStore.getState().setPreferredOnSidecar).not.toHaveBeenCalled();
  });

  it('awaits a stale in-flight apply then runs for a newer generation', async () => {
    let call = 0;
    let resolveFirst!: (ok: boolean) => void;
    const setPreferred = vi.fn(() => {
      call += 1;
      if (call === 1) {
        return new Promise<boolean>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(true);
    });
    useReticulumPropagationStore.setState({ setPreferredOnSidecar: setPreferred });

    const stale = applyAutoPropagationPreferredIfNeeded({
      generation: getPropagationModeGeneration(),
    });
    await Promise.resolve();
    bumpPropagationModeGeneration();
    const fresh = applyAutoPropagationPreferredIfNeeded({
      generation: getPropagationModeGeneration(),
    });

    resolveFirst(true);
    await expect(stale).resolves.toBe('skipped');
    await expect(fresh).resolves.toBe('applied');
    expect(setPreferred).toHaveBeenCalledTimes(2);
  });

  it('retries once before toasting on preferred failure', async () => {
    vi.useFakeTimers();
    const setPreferred = vi.fn().mockResolvedValue(false);
    useReticulumPropagationStore.setState({ setPreferredOnSidecar: setPreferred });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const pending = applyAutoPropagationPreferredIfNeeded();
    await vi.advanceTimersByTimeAsync(800);
    await expect(pending).resolves.toBe('failed');
    expect(setPreferred).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    expect(pushAppToast).toHaveBeenCalledWith('reticulumPropagation.autoApplyFailed', 'error');

    warn.mockRestore();
    vi.useRealTimers();
  });

  it('honors persisted Auto mode key', () => {
    expect(localStorage.getItem(RETICULUM_PROPAGATION_MODE_KEY)).toBe('auto');
  });
});
