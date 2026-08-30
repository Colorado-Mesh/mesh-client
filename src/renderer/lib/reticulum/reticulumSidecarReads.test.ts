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
  fetchReticulumRmapDiscovered,
  fetchReticulumSerialPortOptions,
  fetchReticulumSerialPorts,
  formatReticulumPeerPathToast,
  formatReticulumPeerProbeToast,
  invalidateReticulumInterfacesCache,
  isReticulumRnsLiveReady,
  isReticulumSidecar404Error,
  isReticulumSidecarExpectedProxyError,
  isReticulumSidecarNotRunningError,
  isReticulumSidecarRateLimitError,
  isReticulumSidecarRunning,
  pingReticulumDestination,
  probeReticulumPeer,
  registerReticulumKnownIdentity,
  requestReticulumPeerPath,
} from './reticulumSidecarReads';

describe('reticulumSidecarReads', () => {
  beforeEach(() => {
    getStatus.mockReset();
    proxyGet.mockReset();
    proxyPost.mockReset();
    invalidateReticulumInterfacesCache();
  });

  it('isReticulumSidecarRunning returns true when sidecar reports running with port', async () => {
    getStatus.mockResolvedValue({ running: true, port: 19437, pid: 1 });
    await expect(isReticulumSidecarRunning()).resolves.toBe(true);
  });

  it('isReticulumSidecarRunning returns false when sidecar is down', async () => {
    getStatus.mockResolvedValue({ running: false, port: 0, pid: null });
    await expect(isReticulumSidecarRunning()).resolves.toBe(false);
  });

  it('isReticulumRnsLiveReady requires running sidecar and rns_ready', async () => {
    getStatus.mockResolvedValue({ running: true, port: 19437, pid: 1 });
    proxyGet.mockResolvedValue({ rns_ready: true });
    await expect(isReticulumRnsLiveReady()).resolves.toBe(true);
    proxyGet.mockResolvedValue({ rns_ready: false });
    await expect(isReticulumRnsLiveReady()).resolves.toBe(false);
    getStatus.mockResolvedValue({ running: false, port: 0, pid: null });
    await expect(isReticulumRnsLiveReady()).resolves.toBe(false);
  });

  it('isReticulumRnsLiveReady is false when proxyGet rejects while sidecar is running', async () => {
    getStatus.mockResolvedValue({ running: true, port: 19437, pid: 1 });
    proxyGet.mockRejectedValue(new Error('Reticulum sidecar is not running'));
    await expect(isReticulumRnsLiveReady()).resolves.toBe(false);
  });

  it('classifies not-running, 404, and rate-limit proxy errors', () => {
    expect(isReticulumSidecarNotRunningError(new Error('Reticulum sidecar is not running'))).toBe(
      true,
    );
    expect(isReticulumSidecar404Error(new Error('sidecar GET /api/v1/topology failed: 404'))).toBe(
      true,
    );
    expect(isReticulumSidecar404Error({ status: 404, message: 'missing route' })).toBe(true);
    expect(isReticulumSidecar404Error(new Error('payload size 4048 bytes'))).toBe(false);
    expect(
      isReticulumSidecarRateLimitError(new Error('reticulum:proxy: rate limit exceeded')),
    ).toBe(true);
    expect(
      isReticulumSidecarExpectedProxyError(new Error('reticulum:proxy: rate limit exceeded')),
    ).toBe(true);
  });

  it('fetchReticulumInterfaces rethrows rate-limit only when propagateRateLimit is set', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyGet.mockResolvedValueOnce({
      interfaces: [{ id: '1', name: 'tcp', type: 'tcp', enabled: true, status: 'up' }],
    });
    await expect(fetchReticulumInterfaces()).resolves.toHaveLength(1);
    expect(proxyGet).toHaveBeenCalledTimes(1);

    proxyGet.mockRejectedValue(new Error('reticulum:proxy: rate limit exceeded'));
    await expect(fetchReticulumInterfaces()).resolves.toHaveLength(1);
    await expect(fetchReticulumInterfaces()).resolves.toHaveLength(1);
    // Cache TTL still warm — no extra proxyGet after the seed call.
    expect(proxyGet).toHaveBeenCalledTimes(1);

    invalidateReticulumInterfacesCache();
    await expect(fetchReticulumInterfaces()).resolves.toHaveLength(1);
    expect(proxyGet).toHaveBeenCalledTimes(2);
    await expect(fetchReticulumInterfaces({ propagateRateLimit: true })).rejects.toThrow(
      'rate limit exceeded',
    );
    expect(proxyGet).toHaveBeenCalledTimes(3);
  });

  it('fetchReticulumInterfaces rethrows bypassCache failures instead of returning cache', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyGet.mockResolvedValueOnce({
      interfaces: [{ id: '1', name: 'tcp', type: 'tcp', enabled: true, status: 'up' }],
    });
    await expect(fetchReticulumInterfaces()).resolves.toHaveLength(1);

    proxyGet.mockRejectedValue(new Error('sidecar GET /api/v1/interfaces failed: 503'));
    await expect(fetchReticulumInterfaces({ bypassCache: true })).rejects.toThrow('failed: 503');
    await expect(fetchReticulumInterfaces()).resolves.toHaveLength(1);
  });

  it('fetchReticulumSerialPortOptions shares cache and rate-limit fallback with path helper', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyGet.mockResolvedValueOnce({
      ports: [{ path: '/dev/ttyUSB0', label: 'USB' }],
    });
    await expect(fetchReticulumSerialPortOptions()).resolves.toEqual([
      { path: '/dev/ttyUSB0', label: 'USB' },
    ]);
    await expect(fetchReticulumSerialPorts()).resolves.toEqual(['/dev/ttyUSB0']);
    expect(proxyGet).toHaveBeenCalledTimes(1);

    proxyGet.mockRejectedValue(new Error('reticulum:proxy: rate limit exceeded'));
    await expect(fetchReticulumSerialPortOptions()).resolves.toEqual([
      { path: '/dev/ttyUSB0', label: 'USB' },
    ]);
    await expect(fetchReticulumSerialPorts()).resolves.toEqual(['/dev/ttyUSB0']);
    expect(proxyGet).toHaveBeenCalledTimes(1);

    invalidateReticulumInterfacesCache();
    await expect(fetchReticulumSerialPortOptions()).resolves.toEqual([
      { path: '/dev/ttyUSB0', label: 'USB' },
    ]);
    expect(proxyGet).toHaveBeenCalledTimes(2);
    await expect(fetchReticulumSerialPortOptions({ propagateRateLimit: true })).rejects.toThrow(
      'rate limit exceeded',
    );
    await expect(fetchReticulumSerialPorts({ propagateRateLimit: true })).rejects.toThrow(
      'rate limit exceeded',
    );
    expect(proxyGet).toHaveBeenCalledTimes(4);
  });

  it('fetchReticulumIdentityStatus skips proxyGet when sidecar is down', async () => {
    getStatus.mockResolvedValue({ running: false, port: 0, pid: null });
    await expect(fetchReticulumIdentityStatus()).resolves.toEqual({
      configured: false,
      lxmfHash: null,
      displayName: null,
      identityHash: null,
      publicKey: null,
    });
    expect(proxyGet).not.toHaveBeenCalled();
  });

  it('fetchReticulumIdentityStatus returns lxmf hash and display name', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyGet.mockResolvedValue({
      configured: true,
      lxmf_hash: 'f8b4e04e1234567890abcdef',
      identity_hash: 'aabbccddeeff00112233445566778899',
      display_name: 'NV0N',
    });
    await expect(fetchReticulumIdentityStatus()).resolves.toEqual({
      configured: true,
      lxmfHash: 'f8b4e04e1234567890abcdef',
      displayName: 'NV0N',
      identityHash: 'aabbccddeeff00112233445566778899',
      publicKey: null,
    });
  });

  it('fetchReticulumIdentityStatus returns public_key when present', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    const pub = 'ab'.repeat(64);
    proxyGet.mockResolvedValue({
      configured: true,
      lxmf_hash: 'f8b4e04e1234567890abcdef01234567',
      identity_hash: 'aabbccddeeff00112233445566778899',
      display_name: 'NV0N',
      public_key: pub.toUpperCase(),
    });
    await expect(fetchReticulumIdentityStatus()).resolves.toEqual({
      configured: true,
      lxmfHash: 'f8b4e04e1234567890abcdef01234567',
      displayName: 'NV0N',
      identityHash: 'aabbccddeeff00112233445566778899',
      publicKey: pub,
    });
  });

  it('registerReticulumKnownIdentity posts to register-known', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyPost.mockResolvedValue({ ok: true });
    const dest = 'a'.repeat(32);
    const pub = 'b'.repeat(128);
    await expect(registerReticulumKnownIdentity(dest, pub)).resolves.toEqual({ ok: true });
    expect(proxyPost).toHaveBeenCalledWith('/api/v1/identity/register-known', {
      destination_hash: dest,
      public_key: pub,
    });
  });

  it('registerReticulumKnownIdentity rejects malformed ok field', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyPost.mockResolvedValue({ ok: 'false' });
    await expect(registerReticulumKnownIdentity('a'.repeat(32), 'b'.repeat(128))).resolves.toEqual({
      ok: false,
    });
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

  it('fetchReticulumRmapDiscovered returns empty when sidecar is down', async () => {
    getStatus.mockResolvedValue({ running: false, port: 0, pid: null });
    await expect(fetchReticulumRmapDiscovered()).resolves.toEqual([]);
    expect(proxyGet).not.toHaveBeenCalled();
  });

  it('fetchReticulumRmapDiscovered returns discovered rows on success', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyGet.mockResolvedValue({
      discovered: [{ discovery_hash: 'abc', transport_id: 'aa'.repeat(16), last_heard: 1 }],
    });
    await expect(fetchReticulumRmapDiscovered()).resolves.toHaveLength(1);
    expect(proxyGet).toHaveBeenCalledWith('/api/v1/rmap/discovered');
  });

  it('fetchReticulumRmapDiscovered throws on unexpected proxy errors', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyGet.mockRejectedValue(new Error('EACCES permission denied'));
    await expect(fetchReticulumRmapDiscovered()).rejects.toThrow('EACCES permission denied');
  });

  it('fetchReticulumRmapDiscovered returns empty on expected proxy errors', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    proxyGet.mockRejectedValueOnce(new Error('Reticulum sidecar is not running'));
    await expect(fetchReticulumRmapDiscovered()).resolves.toEqual([]);
    proxyGet.mockRejectedValueOnce(new Error('sidecar timeout'));
    await expect(fetchReticulumRmapDiscovered()).resolves.toEqual([]);
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

  it('probeReticulumPeer coalesces concurrent probes for the same hash', async () => {
    getStatus.mockResolvedValue({ running: true, port: 1, pid: 1 });
    let resolvePost!: (value: { ok: boolean; hops: number }) => void;
    const pending = new Promise<{ ok: boolean; hops: number }>((resolve) => {
      resolvePost = resolve;
    });
    proxyPost.mockReturnValueOnce(pending);
    const first = probeReticulumPeer('AABBCCDDEEFF00112233445566778899');
    const second = probeReticulumPeer('aabbccddeeff00112233445566778899');
    resolvePost({ ok: true, hops: 4 });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, hops: 4, mode: undefined, error: undefined },
      { ok: true, hops: 4, mode: undefined, error: undefined },
    ]);
    expect(proxyPost).toHaveBeenCalledTimes(1);
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

  it('formatReticulumPeerPathToast humanizes proxy rate-limit errors', () => {
    const t = ((key: string, opts?: { error?: string }) =>
      opts?.error != null ? `${key}:${opts.error}` : key) as TFunction;
    expect(
      formatReticulumPeerPathToast(t, {
        ok: false,
        error:
          "Error invoking remote method 'reticulum:proxyPost': Error: reticulum:proxy: rate limit exceeded",
      }),
    ).toEqual({
      message: 'peerDetailModal.pathFailed:rrc.errors.proxyRateLimit',
      variant: 'error',
    });
  });
});
