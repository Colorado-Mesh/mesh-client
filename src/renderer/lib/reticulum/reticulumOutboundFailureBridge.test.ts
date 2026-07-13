import { beforeEach, describe, expect, it } from 'vitest';

import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import { failReticulumSendingOutboundToDestHash } from '@/renderer/lib/reticulum/reticulumOutboundFailureBridge';
import { useMessageStore } from '@/renderer/stores/messageStore';

const DEST = '5526a65d0b4d23448206fd3485b76f5b';
const identityId = 'reticulum-test';

describe('failReticulumSendingOutboundToDestHash', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
  });

  it('marks sending outbound messages to the destination as failed', () => {
    const toNodeId = reticulumHashToNodeId(DEST);
    registerReticulumDestinationHash(toNodeId, DEST);
    useMessageStore.setState({
      messages: {
        [identityId]: {
          'msg-hash': {
            id: 'msg-hash',
            from: 1,
            senderName: 'self',
            payload: 'hello',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'sending',
            to: toNodeId,
          },
        },
      },
    });

    const count = failReticulumSendingOutboundToDestHash(identityId, DEST, 'send failed');
    expect(count).toBe(1);
    expect(useMessageStore.getState().messages[identityId]?.['msg-hash']?.status).toBe('failed');
  });
});
