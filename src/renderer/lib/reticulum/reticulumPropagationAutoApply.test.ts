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
      setPreferredOnSidecar: vi.fn().mockResolvedValue(true),
      addFromDiscovered: vi.fn().mockResolvedValue(true),
      startSync: vi.fn().mockResolvedValue(true),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Auto one-time syncs best discovered by hash without Add or Preferred', async () => {
    const hash = 'dead'.repeat(8);
    const addFromDiscovered = vi.fn().mockResolvedValue(true);
    const setPreferred = vi.fn().mockResolvedValue(true);
    const startSync = vi.fn().mockResolvedValue(true);
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
    const startSync = vi.fn().mockResolvedValue(true);
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
    const startSync = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
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

  it('Manual tries the other added remotes before local-prop', async () => {
    writeReticulumPropagationMode('manual');
    const startSync = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
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
    const startSync = vi.fn().mockResolvedValue(true);
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
    const startSync = vi.fn().mockResolvedValue(true);
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
    const startSync = vi.fn().mockResolvedValue(true);
    useReticulumPropagationStore.setState({
      preferredId: 'pn-aabb1111',
      startSync,
    });
    await expect(startPropagationSyncCascade()).resolves.toBe(false);
    await expect(ensurePreferredThenStartSync('pn-aabb1111')).resolves.toBe(false);
    await expect(ensurePreferredThenStartSync('local-prop')).resolves.toBe(false);
    expect(startSync).not.toHaveBeenCalled();
  });

  it('honors persisted Auto mode key', () => {
    expect(localStorage.getItem(RETICULUM_PROPAGATION_MODE_KEY)).toBe('auto');
  });
});
