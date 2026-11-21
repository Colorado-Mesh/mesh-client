import { beforeEach, describe, expect, it } from 'vitest';

import { useMessageStore } from '../stores/messageStore';
import { CHAT_SEND_ERROR_DEST_KEY_KEY } from './chatSendErrorI18n';
import { markOutboundBlocked } from './markOutboundBlocked';

describe('markOutboundBlocked', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('sets status blocked with persistable missing-key error', () => {
    useMessageStore.setState({
      messages: {
        id1: {
          m1: {
            id: 'm1',
            from: 1,
            to: 2,
            payload: 'hi',
            channelIndex: -1,
            timestamp: 1,
            status: 'sending',
          },
        },
      },
    });
    markOutboundBlocked('id1', 'm1');
    const bucket = useMessageStore.getState().messages.id1;
    expect(bucket).toBeDefined();
    expect(bucket.m1.status).toBe('blocked');
    expect(bucket.m1.error).toBe(CHAT_SEND_ERROR_DEST_KEY_KEY);
  });
});
