import { beforeEach, describe, expect, it, vi } from 'vitest';

import { upsertMessage, useMessageStore } from '@/renderer/stores/messageStore';

import {
  assertReticulumSendAcked,
  waitForReticulumOutboundTerminal,
} from './reticulumOutboundReceipt';

describe('reticulumOutboundReceipt', () => {
  const identityId = 'id-reticulum';

  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('treats propagation-node cascade as acked so outbox retries do not spam', async () => {
    upsertMessage(identityId, {
      id: 'pending-1',
      from: 1,
      to: 2,
      payload: 'MECP/0/M01',
      channelIndex: 0,
      timestamp: Date.now(),
      status: 'sending',
      reticulumDeliveryMethod: 'propagated',
    });
    await expect(waitForReticulumOutboundTerminal(identityId, 'pending-1', 1_000)).resolves.toBe(
      'acked',
    );
    await expect(assertReticulumSendAcked(identityId, 'pending-1', 1_000)).resolves.toBeUndefined();
  });

  it('still times out while direct delivery stays sending', async () => {
    vi.useFakeTimers();
    try {
      upsertMessage(identityId, {
        id: 'pending-2',
        from: 1,
        to: 2,
        payload: 'hi',
        channelIndex: 0,
        timestamp: Date.now(),
        status: 'sending',
        reticulumDeliveryMethod: 'direct',
      });
      const pending = waitForReticulumOutboundTerminal(identityId, 'pending-2', 500);
      await vi.advanceTimersByTimeAsync(500);
      await expect(pending).resolves.toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });
});
