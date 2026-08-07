import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyGet = vi.fn();

vi.stubGlobal('window', {
  electronAPI: {
    reticulum: {
      proxyGet,
    },
  },
});

import { fetchRecentInboundLxmf, fetchRecentInboundLxmfDetailed } from './fetchRecentInboundLxmf';
import {
  getReticulumInboundLxmfDiagnostics,
  resetReticulumInboundLxmfDiagnosticsForTests,
} from './reticulumInboundLxmfDiagnostics';
import {
  isReticulumProxyRateLimitBackoffActive,
  noteReticulumProxyRateLimitHit,
  resetReticulumProxyRateLimitBackoffForTests,
} from './reticulumProxyRateLimitBackoff';

describe('fetchRecentInboundLxmf', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    proxyGet.mockReset();
    warnSpy.mockClear();
    resetReticulumInboundLxmfDiagnosticsForTests();
    resetReticulumProxyRateLimitBackoffForTests();
  });

  it('returns inbound rows from sidecar recent API', async () => {
    proxyGet.mockResolvedValue({
      messages: [
        {
          sender_hash: 'aa'.repeat(16),
          text: 'hello',
          direction: 'inbound',
          message_hash: 'bb'.repeat(32),
          timestamp: 1000,
        },
        {
          sender_hash: 'cc'.repeat(16),
          text: 'skip outbound',
          direction: 'outbound',
        },
        { sender_hash: 'dd'.repeat(16) },
      ],
      ring_len: 3,
    });

    const rows = await fetchRecentInboundLxmf({ sinceTs: 500, sinceSeq: 3, limit: 50 });
    expect(proxyGet).toHaveBeenCalledWith('/api/v1/lxmf/recent?since_ts=500&since_seq=3&limit=50');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe('hello');
    expect(getReticulumInboundLxmfDiagnostics().lastInboundRingLen).toBe(3);
  });

  it('returns empty array and warns on proxy failure', async () => {
    proxyGet.mockRejectedValue(new Error('offline'));
    await expect(fetchRecentInboundLxmf()).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    const detailed = await fetchRecentInboundLxmfDetailed();
    expect(detailed).toEqual({ messages: [], ringLen: null, rateLimited: false });
  });

  it('skips proxyGet when lxmfRecent backoff is active', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    noteReticulumProxyRateLimitHit('lxmfRecent');
    const detailed = await fetchRecentInboundLxmfDetailed();
    expect(proxyGet).not.toHaveBeenCalled();
    expect(detailed).toEqual({ messages: [], ringLen: null, rateLimited: true });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('skipped'));
  });

  it('does not skip when only shared backoff is active', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    noteReticulumProxyRateLimitHit('shared');
    proxyGet.mockResolvedValue({ messages: [], ring_len: 0 });
    await fetchRecentInboundLxmfDetailed();
    expect(proxyGet).toHaveBeenCalled();
  });

  it('arms lxmfRecent backoff on rate-limit error', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    proxyGet.mockRejectedValue(new Error('reticulum:proxy: rate limit exceeded'));
    const detailed = await fetchRecentInboundLxmfDetailed();
    expect(detailed.rateLimited).toBe(true);
    // Second call should skip without hitting proxy again.
    proxyGet.mockClear();
    const skipped = await fetchRecentInboundLxmfDetailed();
    expect(proxyGet).not.toHaveBeenCalled();
    expect(skipped.rateLimited).toBe(true);
  });

  it('clears lxmfRecent backoff after success', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const now = 1_000_000;
    noteReticulumProxyRateLimitHit('lxmfRecent', now);
    expect(isReticulumProxyRateLimitBackoffActive('lxmfRecent', now)).toBe(true);
    proxyGet.mockResolvedValue({ messages: [], ring_len: 0 });
    vi.spyOn(Date, 'now').mockReturnValue(now + 120_000);
    await fetchRecentInboundLxmfDetailed();
    expect(proxyGet).toHaveBeenCalled();
    expect(isReticulumProxyRateLimitBackoffActive('lxmfRecent', now)).toBe(false);
  });
});
