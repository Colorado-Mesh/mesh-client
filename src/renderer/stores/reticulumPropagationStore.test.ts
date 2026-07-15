import { beforeEach, describe, expect, it, vi } from 'vitest';

const getStatus = vi.fn();
const proxyGet = vi.fn();
const proxyPost = vi.fn();
const proxyPut = vi.fn();
const proxyDelete = vi.fn();

import { RETICULUM_PROPAGATION_AUTO_SYNC_DEFAULT_SEC } from '@/shared/reticulumPropagationAutoSync';

vi.stubGlobal('window', {
  electronAPI: {
    reticulum: {
      getStatus,
      proxyGet,
      proxyPost,
      proxyPut,
      proxyDelete,
    },
  },
});

import { useReticulumPropagationStore } from './reticulumPropagationStore';

describe('reticulumPropagationStore', () => {
  beforeEach(() => {
    getStatus.mockReset();
    proxyGet.mockReset();
    proxyPost.mockReset();
    proxyPut.mockReset();
    proxyDelete.mockReset();
    useReticulumPropagationStore.setState({
      nodes: [],
      preferredId: null,
      autoSyncIntervalSec: RETICULUM_PROPAGATION_AUTO_SYNC_DEFAULT_SEC,
      sync: { active: false, progress: 0, message: null },
      lastSyncError: null,
      lastRefreshedAt: null,
      lastPropagationSyncAt: null,
      lastPropagationSyncAttemptAt: null,
    });
  });

  it('refreshFromSidecar sets nodes and preferred id', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyGet.mockResolvedValue({
      propagation: [{ id: 'p1', name: 'Node', enabled: true, status: 'ok' }],
      preferred_id: 'p1',
      auto_sync_interval_sec: 120,
    });

    await useReticulumPropagationStore.getState().refreshFromSidecar();

    expect(useReticulumPropagationStore.getState().nodes).toHaveLength(1);
    expect(useReticulumPropagationStore.getState().preferredId).toBe('p1');
    expect(useReticulumPropagationStore.getState().autoSyncIntervalSec).toBe(120);
    expect(useReticulumPropagationStore.getState().lastRefreshedAt).toBeTypeOf('number');
  });

  it('refreshFromSidecar skips when sidecar is down', async () => {
    getStatus.mockResolvedValue({ running: false, port: 0, pid: null });
    await useReticulumPropagationStore.getState().refreshFromSidecar();
    expect(proxyGet).not.toHaveBeenCalled();
  });

  it('setAutoSyncIntervalOnSidecar persists interval', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyPost.mockResolvedValueOnce({ ok: true });

    await expect(
      useReticulumPropagationStore.getState().setAutoSyncIntervalOnSidecar(1800),
    ).resolves.toBe(true);

    expect(proxyPost).toHaveBeenCalledWith('/api/v1/propagation/auto-sync-interval', {
      interval_sec: 1800,
    });
    expect(useReticulumPropagationStore.getState().autoSyncIntervalSec).toBe(1800);
  });

  it('startSync and cancelSync update sync state', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    useReticulumPropagationStore.setState({ preferredId: 'p1' });
    proxyPost.mockResolvedValueOnce({ ok: true });
    await expect(useReticulumPropagationStore.getState().startSync()).resolves.toBe(true);
    expect(useReticulumPropagationStore.getState().sync.active).toBe(true);
    expect(useReticulumPropagationStore.getState().lastPropagationSyncAttemptAt).toBeTypeOf(
      'number',
    );

    proxyPost.mockResolvedValueOnce({});
    await expect(useReticulumPropagationStore.getState().cancelSync()).resolves.toBe(true);
    expect(useReticulumPropagationStore.getState().sync.active).toBe(false);
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      'reticulumPropagation.syncCancelled',
    );
  });

  it('startSync settles local-prop in-process without a stall watchdog error', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyPost.mockResolvedValueOnce({ ok: true });
    await expect(useReticulumPropagationStore.getState().startSync('local-prop')).resolves.toBe(
      true,
    );
    expect(proxyPost).toHaveBeenCalledWith('/api/v1/propagation/sync', {
      propagation_id: 'local-prop',
    });
    expect(useReticulumPropagationStore.getState().lastSyncError).toBeNull();
    expect(useReticulumPropagationStore.getState().sync.active).toBe(false);
    expect(useReticulumPropagationStore.getState().lastPropagationSyncAt).toBeTypeOf('number');
  });

  it('startSync maps sidecar identity errors to i18n keys', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    useReticulumPropagationStore.setState({ preferredId: 'pn-vegas' });
    proxyPost.mockResolvedValueOnce({ ok: false, error: 'PROPAGATION_IDENTITY_UNKNOWN' });
    await expect(useReticulumPropagationStore.getState().startSync()).resolves.toBe(false);
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      'reticulumPropagation.syncIdentityUnknown',
    );
  });

  it('startSync maps non-PN destination errors to i18n keys', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    useReticulumPropagationStore.setState({ preferredId: 'pn-vegas' });
    proxyPost.mockResolvedValueOnce({ ok: false, error: 'PROPAGATION_TARGET_NOT_PN' });
    await expect(useReticulumPropagationStore.getState().startSync()).resolves.toBe(false);
    expect(useReticulumPropagationStore.getState().lastSyncError).toBe(
      'reticulumPropagation.syncTargetNotPropagationNode',
    );
  });

  it('removePropagationNode deletes then refreshes', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyDelete.mockResolvedValueOnce({ ok: true });
    proxyGet.mockResolvedValueOnce({
      propagation: [{ id: 'local-prop', name: 'Local', enabled: true, status: 'ok' }],
      preferred_id: null,
    });

    await expect(
      useReticulumPropagationStore.getState().removePropagationNode('pn-aabb'),
    ).resolves.toBe(true);

    expect(proxyDelete).toHaveBeenCalledWith('/api/v1/propagation/pn-aabb');
    expect(useReticulumPropagationStore.getState().nodes).toHaveLength(1);
  });

  it('removePropagationNode returns false when proxy rejects', async () => {
    proxyDelete.mockResolvedValueOnce({ ok: false });
    await expect(
      useReticulumPropagationStore.getState().removePropagationNode('pn-aabb'),
    ).resolves.toBe(false);
    expect(proxyGet).not.toHaveBeenCalled();
  });

  it('renamePropagationNode renames then refreshes', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyPut.mockResolvedValueOnce({ ok: true });
    proxyGet.mockResolvedValueOnce({
      propagation: [{ id: 'pn-aabb', name: 'Renamed hub', enabled: true, status: 'known' }],
      preferred_id: null,
    });

    await expect(
      useReticulumPropagationStore.getState().renamePropagationNode('pn-aabb', 'Renamed hub'),
    ).resolves.toBe(true);

    expect(proxyPut).toHaveBeenCalledWith('/api/v1/propagation/pn-aabb', {
      name: 'Renamed hub',
    });
    expect(useReticulumPropagationStore.getState().nodes[0]?.name).toBe('Renamed hub');
  });

  it('renamePropagationNode returns false when proxy rejects', async () => {
    proxyPut.mockResolvedValueOnce({ ok: false });
    await expect(
      useReticulumPropagationStore.getState().renamePropagationNode('pn-aabb', 'Nope'),
    ).resolves.toBe(false);
    expect(proxyGet).not.toHaveBeenCalled();
  });
});
