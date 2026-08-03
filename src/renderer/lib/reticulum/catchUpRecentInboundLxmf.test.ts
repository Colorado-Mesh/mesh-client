import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';
import { fetchRecentInboundLxmfDetailed } from '@/renderer/lib/reticulum/fetchRecentInboundLxmf';
import { type MessageRecord, useMessageStore } from '@/renderer/stores/messageStore';

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

function seedKnown(identityId: string, hash: string): void {
  const record: MessageRecord = {
    id: hash,
    from: 1,
    to: 0,
    payload: 'hi',
    channelIndex: 0,
    timestamp: 1_000,
    reticulumMessageHash: hash,
  };
  useMessageStore.setState({
    messages: {
      ...useMessageStore.getState().messages,
      [identityId]: {
        ...(useMessageStore.getState().messages[identityId] ?? {}),
        [hash]: record,
      },
    },
  });
}

describe('catchUpRecentInboundLxmf', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

  beforeEach(() => {
    warnSpy.mockClear();
    debugSpy.mockClear();
    useMessageStore.setState({ messages: {} });
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
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('returns null on a second pass when the watermark fetch is empty', async () => {
    vi.mocked(fetchRecentInboundLxmfDetailed).mockResolvedValue({ messages: [], ringLen: 1 });
    await expect(
      catchUpRecentInboundLxmf({
        identityId: 'id-1',
        ingest: vi.fn(),
        sinceTs: 2_500,
        reason: 'periodic',
      }),
    ).resolves.toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('demotes warn to debug when every hash is already in the message store', async () => {
    const known = 'aa'.repeat(32);
    seedKnown('id-1', known);
    const ingest = vi.fn();
    vi.mocked(fetchRecentInboundLxmfDetailed).mockResolvedValue({
      messages: [sample(known, 1_000)],
      ringLen: 1,
    });

    const outcome = await catchUpRecentInboundLxmf({
      identityId: 'id-1',
      ingest,
      reason: 'periodic',
    });

    expect(outcome).toEqual({ count: 1, watermarkTs: 1_000 });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('count=1 reason=periodic'));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('still warns when a mixed batch includes an unknown hash', async () => {
    const known = 'aa'.repeat(32);
    const unknown = 'bb'.repeat(32);
    seedKnown('id-1', known);
    const ingest = vi.fn();
    vi.mocked(fetchRecentInboundLxmfDetailed).mockResolvedValue({
      messages: [sample(known, 1_000), sample(unknown, 2_000)],
      ringLen: 2,
    });

    await catchUpRecentInboundLxmf({
      identityId: 'id-1',
      ingest,
      reason: 'periodic',
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('count=2 reason=periodic'));
    expect(debugSpy).not.toHaveBeenCalledWith(expect.stringContaining('catch-up count='));
  });
});
