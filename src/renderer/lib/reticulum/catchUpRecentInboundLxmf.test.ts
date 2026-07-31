import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';
import { fetchRecentInboundLxmfDetailed } from '@/renderer/lib/reticulum/fetchRecentInboundLxmf';

import { catchUpRecentInboundLxmf } from './catchUpRecentInboundLxmf';

vi.mock('@/renderer/lib/reticulum/fetchRecentInboundLxmf', () => ({
  fetchRecentInboundLxmfDetailed: vi.fn(),
}));

function sample(hash: string, timestamp: number): ReticulumLxmfPayload {
  return {
    sender_hash: 'e16af7d675a0ae7f3067185800a46678',
    text: 'hi',
    timestamp,
    direction: 'inbound',
    message_hash: hash,
  };
}

describe('catchUpRecentInboundLxmf', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    warnSpy.mockClear();
    vi.mocked(fetchRecentInboundLxmfDetailed).mockReset();
  });

  it('returns null when identityId is empty', async () => {
    await expect(catchUpRecentInboundLxmf({ identityId: '', ingest: vi.fn() })).resolves.toBeNull();
    expect(fetchRecentInboundLxmfDetailed).not.toHaveBeenCalled();
  });

  it('returns null when the ring is empty', async () => {
    vi.mocked(fetchRecentInboundLxmfDetailed).mockResolvedValue({ messages: [], ringLen: 0 });
    await expect(
      catchUpRecentInboundLxmf({ identityId: 'id-1', ingest: vi.fn() }),
    ).resolves.toBeNull();
  });

  it('ingests rows, warns, and returns count plus watermark', async () => {
    const ingest = vi.fn();
    vi.mocked(fetchRecentInboundLxmfDetailed).mockResolvedValue({
      messages: [sample('aa'.repeat(32), 1_000), sample('bb'.repeat(32), 2_500)],
      ringLen: 2,
    });

    const outcome = await catchUpRecentInboundLxmf({
      identityId: 'id-1',
      ingest,
      sinceTs: 500,
      reason: 'periodic',
    });

    expect(fetchRecentInboundLxmfDetailed).toHaveBeenCalledWith({ limit: 200, sinceTs: 500 });
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ count: 2, watermarkTs: 2_500 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('count=2 reason=periodic'));
  });
});
