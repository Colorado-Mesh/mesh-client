import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

import {
  ensurePreferredThenStartSync,
  startPropagationSyncCascade,
} from './reticulumPropagationAutoApply';
import {
  RETICULUM_PROPAGATION_MODE_KEY,
  writeReticulumPropagationMode,
} from './reticulumPropagationMode';

describe('reticulumPropagationAutoApply', () => {
  beforeEach(() => {
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
  });

  it('Auto syncs configured remotes without adding discovered or writing Preferred', async () => {
    const hash = 'dead'.repeat(8);
    const addFromDiscovered = vi.fn().mockResolvedValue(true);
    const setPreferred = vi.fn().mockResolvedValue(true);
    const startSync = vi.fn().mockResolvedValue(true);
    useReticulumPropagationStore.setState({
      preferredId: null,
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
    await expect(startPropagationSyncCascade()).resolves.toBe(true);
    expect(startSync).toHaveBeenCalledWith('pn-aabb1111');
    expect(addFromDiscovered).not.toHaveBeenCalled();
    expect(setPreferred).not.toHaveBeenCalled();
  });

  it('Auto cascade falls back to local-prop when remote sync fails', async () => {
    const startSync = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    useReticulumPropagationStore.setState({
      preferredId: 'pn-aabb1111',
      startSync,
    });
    await expect(ensurePreferredThenStartSync('pn-aabb1111')).resolves.toBe(true);
    expect(startSync).toHaveBeenCalledWith('pn-aabb1111');
    expect(startSync).toHaveBeenCalledWith('local-prop');
  });

  it('Auto with only local settles local without Preferred write', async () => {
    const startSync = vi.fn().mockResolvedValue(true);
    const setPreferred = vi.fn().mockResolvedValue(true);
    useReticulumPropagationStore.setState({
      nodes: [
        {
          id: 'local-prop',
          name: 'Local',
          enabled: true,
          status: 'known',
        },
      ],
      preferredId: null,
      startSync,
      setPreferredOnSidecar: setPreferred,
    });
    await expect(startPropagationSyncCascade()).resolves.toBe(true);
    expect(startSync).toHaveBeenCalledWith('local-prop');
    expect(setPreferred).not.toHaveBeenCalled();
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

  it('honors persisted Auto mode key', () => {
    expect(localStorage.getItem(RETICULUM_PROPAGATION_MODE_KEY)).toBe('auto');
  });
});
