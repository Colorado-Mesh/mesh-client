import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ingestReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';
import { useMessageStore } from '@/renderer/stores/messageStore';

import { fetchRecentInboundLxmf } from './fetchRecentInboundLxmf';

vi.mock('./fetchRecentInboundLxmf', () => ({
  fetchRecentInboundLxmf: vi.fn(),
}));

/**
 * Catch-up path used by useReticulumRuntime after WS lag/reconnect:
 * fetch recent inbound → ingest (dedupe by message hash).
 */
async function catchUpInboundForTest(identityId: string): Promise<number> {
  const rows = await fetchRecentInboundLxmf({ limit: 200 });
  let applied = 0;
  for (const p of rows) {
    if (ingestReticulumLxmfPayload(identityId, p)) applied += 1;
  }
  return applied;
}

describe('inbound LXMF catch-up ingest', () => {
  const identityId = 'offline-reticulum';

  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    vi.mocked(fetchRecentInboundLxmf).mockReset();
  });

  it('ingests buffered inbound messages that were never seen live', async () => {
    const hash = 'ab'.repeat(32);
    vi.mocked(fetchRecentInboundLxmf).mockResolvedValue([
      {
        sender_hash: 'e16af7d675a0ae7f3067185800a46678',
        sender_name: 'Runr02',
        text: 'Test back 1',
        timestamp: 1_000,
        direction: 'inbound',
        message_hash: hash,
        received_via: 'tcp',
      },
    ]);

    const applied = await catchUpInboundForTest(identityId);
    expect(applied).toBe(1);
    const bucket = useMessageStore.getState().messages[identityId];
    expect(bucket).toBeDefined();
    expect(bucket[hash].payload).toBe('Test back 1');
  });

  it('dedupes when the same hash was already ingested live', async () => {
    const hash = 'cd'.repeat(32);
    const payload = {
      sender_hash: 'e16af7d675a0ae7f3067185800a46678',
      sender_name: 'Runr02',
      text: 'already live',
      timestamp: 2_000,
      direction: 'inbound' as const,
      message_hash: hash,
    };
    expect(ingestReticulumLxmfPayload(identityId, payload)).toBe(true);

    vi.mocked(fetchRecentInboundLxmf).mockResolvedValue([payload]);
    await catchUpInboundForTest(identityId);
    const byId = useMessageStore.getState().messages[identityId] ?? {};
    const matches = Object.values(byId).filter((m) => m.payload === 'already live');
    expect(matches).toHaveLength(1);
  });
});
