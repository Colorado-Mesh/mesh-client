import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockConsoleWarn } from '@/renderer/lib/vitestConsoleMock';

const getStatus = vi.fn();
const proxyGet = vi.fn();
const proxyPost = vi.fn();
const fetchReticulumInterfaces = vi.fn();

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    fetchReticulumInterfaces: () => fetchReticulumInterfaces(),
  };
});

vi.stubGlobal('window', {
  electronAPI: {
    reticulum: {
      getStatus,
      proxyGet,
      proxyPost,
    },
  },
});

import { resetNomadEgressCacheForTests, useNomadNetworkStore } from './nomadNetworkStore';

describe('nomadNetworkStore', () => {
  beforeEach(() => {
    getStatus.mockReset();
    proxyGet.mockReset();
    proxyPost.mockReset();
    fetchReticulumInterfaces.mockReset();
    fetchReticulumInterfaces.mockResolvedValue([{ type: 'tcp', enabled: true }]);
    resetNomadEgressCacheForTests();
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

  it('does not cache network egress when interfaces list is empty', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    fetchReticulumInterfaces
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ type: 'rnode', enabled: true }]);
    proxyGet.mockResolvedValue({ ok: true, content: 'page body', content_type: 'micron' });

    await useNomadNetworkStore.getState().fetchNomadPage('abc', '/page/index.mu');
    await useNomadNetworkStore.getState().fetchNomadPage('abc', '/page/index.mu');

    expect(fetchReticulumInterfaces).toHaveBeenCalledTimes(2);
    expect(proxyGet).toHaveBeenLastCalledWith(
      '/api/v1/nomadnetwork/page/abc?path=%2Fpage%2Findex.mu',
    );
  });

  it('fetchNomadPage requests page path without unused hops/egress query params', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    fetchReticulumInterfaces.mockResolvedValue([{ type: 'rnode', enabled: true }]);
    useNomadNetworkStore.setState({
      nodes: new Map([
        [
          'abc',
          {
            destination_hash: 'abc',
            display_name: 'Forum',
            favorited: false,
            hops: 3,
          },
        ],
      ]),
    });
    proxyGet.mockResolvedValue({ ok: true, content: 'page body', content_type: 'micron' });

    const res = await useNomadNetworkStore.getState().fetchNomadPage('abc', '/page/index.mu');

    expect(proxyGet).toHaveBeenCalledWith('/api/v1/nomadnetwork/page/abc?path=%2Fpage%2Findex.mu');
    expect(res).toEqual({ ok: true, content: 'page body', content_type: 'micron' });
  });

  it('fetchNomadPage includes force_path_refresh when requested', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    fetchReticulumInterfaces.mockResolvedValue([{ type: 'tcp', enabled: true }]);
    proxyGet.mockResolvedValue({ ok: true, content: 'page body', content_type: 'micron' });

    await useNomadNetworkStore
      .getState()
      .fetchNomadPage('abc', '/page/index.mu', undefined, { forcePathRefresh: true });

    expect(proxyGet).toHaveBeenCalledWith(
      '/api/v1/nomadnetwork/page/abc?path=%2Fpage%2Findex.mu&force_path_refresh=true',
    );
  });

  it('fetchNomadFile requests file path without unused hops/egress query params', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    fetchReticulumInterfaces.mockResolvedValue([{ type: 'tcp', enabled: true }]);
    useNomadNetworkStore.setState({
      nodes: new Map([
        [
          'abc',
          {
            destination_hash: 'abc',
            display_name: 'Forum',
            favorited: false,
            hops: 2,
          },
        ],
      ]),
    });
    proxyGet.mockResolvedValue({
      ok: true,
      file_name: 'readme.txt',
      content_base64: 'aGVsbG8=',
    });

    const res = await useNomadNetworkStore.getState().fetchNomadFile('abc', '/file/readme.txt');

    expect(proxyGet).toHaveBeenCalledWith(
      '/api/v1/nomadnetwork/file/abc?path=%2Ffile%2Freadme.txt',
    );
    expect(res).toEqual({ ok: true, file_name: 'readme.txt', content_base64: 'aGVsbG8=' });
  });

  it('logs failure warning with link budget when page fetch returns ok:false', async () => {
    const { spy, restore } = mockConsoleWarn();
    try {
      getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
      fetchReticulumInterfaces.mockResolvedValue([{ type: 'tcp', enabled: true }]);
      proxyGet.mockResolvedValue({
        ok: false,
        error: 'link_timeout',
        egress: 'tcp',
        path_hops: 1,
        link_hops: 3,
        proof_budget_secs: 45,
        timeout_secs: 45,
        force_path_ok: true,
        path_ensure_kind: 'rediscovered',
        elapsed_ms: 18250,
        raw_error: 'timed out waiting for link proof',
      });

      const res = await useNomadNetworkStore
        .getState()
        .fetchNomadPage('abcdef12', '/page/index.mu');

      expect(res).toMatchObject({ ok: false, error: 'link_timeout', link_hops: 3 });
      const messages = spy.mock.calls
        .map((c) => c[0])
        .filter((m): m is string => typeof m === 'string');
      const failed = messages.find((m) => m.includes('[nomadNetworkStore] page fetch failed'));
      expect(failed).toBeTruthy();
      expect(failed).toContain('error=link_timeout');
      expect(failed).toContain('hash=abcdef12');
      expect(failed).toContain('link_hops=3');
      expect(failed).toContain('proof_budget_secs=45');
      expect(failed).toContain('timeout_secs=45');
      expect(failed).toContain('force_path_ok=true');
      expect(failed).toContain('path_ensure=rediscovered');
      expect(failed).toContain('elapsed_ms=18250');
      expect(failed).toContain('raw=timed out waiting for link proof');
    } finally {
      restore();
    }
  });

  it('logs a warning when file fetch returns ok:false', async () => {
    const { spy, restore } = mockConsoleWarn();
    try {
      getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
      fetchReticulumInterfaces.mockResolvedValue([{ type: 'tcp', enabled: true }]);
      proxyGet.mockResolvedValue({ ok: false, error: 'path_timeout' });

      const res = await useNomadNetworkStore
        .getState()
        .fetchNomadFile('abcdef12', '/file/readme.txt');

      expect(res).toEqual({ ok: false, error: 'path_timeout' });
      const messages = spy.mock.calls
        .map((c) => c[0])
        .filter((m): m is string => typeof m === 'string');
      const failed = messages.find((m) => m.includes('[nomadNetworkStore] file fetch failed'));
      expect(failed).toBeTruthy();
      expect(failed).toContain('error=path_timeout');
    } finally {
      restore();
    }
  });
});
