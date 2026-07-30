import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyGet = vi.fn();

vi.stubGlobal('window', {
  electronAPI: {
    reticulum: {
      proxyGet,
    },
  },
});

import { fetchRecentInboundLxmf } from './fetchRecentInboundLxmf';

describe('fetchRecentInboundLxmf', () => {
  beforeEach(() => {
    proxyGet.mockReset();
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
    });

    const rows = await fetchRecentInboundLxmf({ sinceTs: 500, limit: 50 });
    expect(proxyGet).toHaveBeenCalledWith('/api/v1/lxmf/recent?since_ts=500&limit=50');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe('hello');
  });

  it('returns empty array on proxy failure', async () => {
    proxyGet.mockRejectedValue(new Error('offline'));
    await expect(fetchRecentInboundLxmf()).resolves.toEqual([]);
  });
});
