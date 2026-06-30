import { beforeEach, describe, expect, it } from 'vitest';

import { useMessageStore } from '@/renderer/stores/messageStore';

import {
  markStaleReticulumOutboundInStore,
  RETICULUM_STALE_OUTBOUND_MS,
} from './markStaleReticulumOutbound';

describe('markStaleReticulumOutboundInStore', () => {
  const identityId = 'reticulum-test';

  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('marks old sending messages as failed', () => {
    const oldTs = Date.now() - RETICULUM_STALE_OUTBOUND_MS - 1000;
    useMessageStore.setState({
      messages: {
        [identityId]: {
          msg1: {
            id: 'msg1',
            from: 1,
            to: 2,
            payload: 'hello',
            channelIndex: 0,
            timestamp: oldTs,
            status: 'sending',
          },
        },
      },
    });
    const count = markStaleReticulumOutboundInStore(identityId);
    expect(count).toBe(1);
    expect(useMessageStore.getState().messages[identityId]?.msg1.status).toBe('failed');
  });

  it('leaves recent sending messages unchanged', () => {
    useMessageStore.setState({
      messages: {
        [identityId]: {
          msg2: {
            id: 'msg2',
            from: 1,
            to: 2,
            payload: 'recent',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'sending',
          },
        },
      },
    });
    const count = markStaleReticulumOutboundInStore(identityId);
    expect(count).toBe(0);
    expect(useMessageStore.getState().messages[identityId]?.msg2.status).toBe('sending');
  });
});
