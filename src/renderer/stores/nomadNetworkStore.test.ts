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

import { useNomadNetworkStore } from './nomadNetworkStore';

describe('nomadNetworkStore', () => {
  beforeEach(() => {
    getStatus.mockReset();
    proxyGet.mockReset();
    proxyPost.mockReset();
    useNomadNetworkStore.setState({
      nodes: new Map(),
      lastRefreshAt: null,
      nomadApiAvailable: true,
    });
  });

  it('refreshFromSidecar maps nodes from sidecar', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyGet.mockResolvedValue({
      nodes: [
        {
          destination_hash: 'ABC',
          display_name: 'Forum',
          favorited: true,
        },
      ],
    });

    await useNomadNetworkStore.getState().refreshFromSidecar();

    const node = useNomadNetworkStore.getState().getNode('abc');
    expect(node?.display_name).toBe('Forum');
    expect(node?.favorited).toBe(true);
    expect(useNomadNetworkStore.getState().lastRefreshAt).not.toBeNull();
  });

  it('refreshFromSidecar skips proxy when sidecar is not running', async () => {
    getStatus.mockResolvedValue({ running: false, port: 0, pid: null });
    await useNomadNetworkStore.getState().refreshFromSidecar();
    expect(proxyGet).not.toHaveBeenCalled();
  });

  it('refreshFromSidecar marks nomad API unavailable on 404', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyGet.mockRejectedValue(new Error('sidecar GET /api/v1/nomadnetwork/nodes failed: 404'));
    await useNomadNetworkStore.getState().refreshFromSidecar();
    expect(useNomadNetworkStore.getState().nomadApiAvailable).toBe(false);
  });

  it('toggleFavorite posts and patches local state', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    useNomadNetworkStore.setState({
      nodes: new Map([
        [
          'abc',
          {
            destination_hash: 'abc',
            display_name: 'Forum',
            favorited: false,
          },
        ],
      ]),
    });
    proxyPost.mockResolvedValue({ ok: true });

    await useNomadNetworkStore.getState().toggleFavorite('abc', true);

    expect(proxyPost).toHaveBeenCalledWith('/api/v1/nomadnetwork/nodes/favorite', {
      destination_hash: 'abc',
      favorited: true,
    });
    expect(useNomadNetworkStore.getState().getNode('abc')?.favorited).toBe(true);
  });
});
