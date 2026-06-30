import { beforeEach, describe, expect, it, vi } from 'vitest';

const getStatus = vi.fn();
const proxyGet = vi.fn();
const proxyPost = vi.fn();

vi.stubGlobal('window', {
  electronAPI: {
    reticulum: {
      getStatus,
      proxyGet,
      proxyPost,
    },
  },
});

import { useReticulumPropagationStore } from './reticulumPropagationStore';

describe('reticulumPropagationStore', () => {
  beforeEach(() => {
    getStatus.mockReset();
    proxyGet.mockReset();
    proxyPost.mockReset();
    useReticulumPropagationStore.setState({
      nodes: [],
      preferredId: null,
      autoSyncIntervalSec: 0,
      sync: { active: false, progress: 0, message: null },
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
  });

  it('refreshFromSidecar skips when sidecar is down', async () => {
    getStatus.mockResolvedValue({ running: false, port: 0, pid: null });
    await useReticulumPropagationStore.getState().refreshFromSidecar();
    expect(proxyGet).not.toHaveBeenCalled();
  });

  it('startSync and cancelSync update sync state', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    useReticulumPropagationStore.setState({ preferredId: 'p1' });
    proxyPost.mockResolvedValueOnce({ ok: true });
    await expect(useReticulumPropagationStore.getState().startSync()).resolves.toBe(true);
    expect(useReticulumPropagationStore.getState().sync.active).toBe(true);

    proxyPost.mockResolvedValueOnce({});
    await expect(useReticulumPropagationStore.getState().cancelSync()).resolves.toBe(true);
    expect(useReticulumPropagationStore.getState().sync.active).toBe(false);
  });
});
