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

describe('fetchRecentInboundLxmf', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    proxyGet.mockReset();
    warnSpy.mockClear();
    resetReticulumInboundLxmfDiagnosticsForTests();
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
});
