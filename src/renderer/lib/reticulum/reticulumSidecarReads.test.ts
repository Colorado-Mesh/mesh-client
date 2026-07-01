import type { TFunction } from 'i18next';
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

import {
  fetchReticulumIdentityStatus,
  fetchReticulumInterfaces,
  formatReticulumPeerProbeToast,
  isReticulumSidecar404Error,
  isReticulumSidecarNotRunningError,
  isReticulumSidecarRunning,
  pingReticulumDestination,
  probeReticulumPeer,
  requestReticulumPeerPath,
} from './reticulumSidecarReads';

describe('reticulumSidecarReads', () => {
  beforeEach(() => {
    getStatus.mockReset();
    proxyGet.mockReset();
    proxyPost.mockReset();
  });

  it('isReticulumSidecarRunning returns true when sidecar reports running with port', async () => {
    getStatus.mockResolvedValue({ running: true, port: 19437, pid: 1 });
    await expect(isReticulumSidecarRunning()).resolves.toBe(true);
  });

  it('isReticulumSidecarRunning returns false when sidecar is down', async () => {
    getStatus.mockResolvedValue({ running: false, port: 0, pid: null });
    await expect(isReticulumSidecarRunning()).resolves.toBe(false);
  });

  it('classifies not-running and 404 proxy errors', () => {
    expect(isReticulumSidecarNotRunningError(new Error('Reticulum sidecar is not running'))).toBe(
      true,
    );
    expect(isReticulumSidecar404Error(new Error('sidecar GET /api/v1/topology failed: 404'))).toBe(
      true,
    );
  });

  it('fetchReticulumIdentityStatus skips proxyGet when sidecar is down', async () => {
    getStatus.mockResolvedValue({ running: false, port: 0, pid: null });
    await expect(fetchReticulumIdentityStatus()).resolves.toEqual({
      configured: false,
      lxmfHash: null,
    });
    expect(proxyGet).not.toHaveBeenCalled();
  });

  it('fetchReticulumInterfaces caches results for a short interval', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyGet.mockResolvedValue({
      interfaces: [{ id: '1', name: 'tcp', type: 'tcp', enabled: true, status: 'up' }],
    });
    await expect(fetchReticulumInterfaces()).resolves.toHaveLength(1);
    await expect(fetchReticulumInterfaces()).resolves.toHaveLength(1);
    expect(proxyGet).toHaveBeenCalledTimes(1);
  });

  it('requestReticulumPeerPath parses ok response', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyPost.mockResolvedValue({ ok: true });
    await expect(requestReticulumPeerPath('abc')).resolves.toEqual({ ok: true, error: undefined });
  });

  it('probeReticulumPeer parses hops and failure bodies', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyPost.mockResolvedValueOnce({ ok: true, hops: 2 });
    await expect(probeReticulumPeer('abc')).resolves.toEqual({
      ok: true,
      hops: 2,
      mode: undefined,
      error: undefined,
    });

    proxyPost.mockResolvedValueOnce({ ok: false, error: 'timeout' });
    await expect(probeReticulumPeer('abc')).resolves.toEqual({
      ok: false,
      hops: undefined,
      mode: undefined,
      error: 'timeout',
    });
  });

  it('pingReticulumDestination merges ping RTT and probe hops', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyPost
      .mockResolvedValueOnce({ ok: true, rtt_ms: 42 })
      .mockResolvedValueOnce({ ok: true, hops: 3 });
    await expect(pingReticulumDestination('abc')).resolves.toEqual({
      ok: true,
      rttMs: 42,
      hops: 3,
      error: undefined,
    });
  });

  it('formatReticulumPeerProbeToast treats ok without hops as success', () => {
    const t = ((key: string) => key) as TFunction;
    expect(formatReticulumPeerProbeToast(t, { ok: true })).toEqual({
      message: 'peerDetailModal.probeOk',
      variant: 'success',
    });
  });
});
