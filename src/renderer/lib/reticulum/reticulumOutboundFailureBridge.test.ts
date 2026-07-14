// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import { failReticulumSendingOutboundToDestHash } from '@/renderer/lib/reticulum/reticulumOutboundFailureBridge';
import { useMessageStore } from '@/renderer/stores/messageStore';
import { createElectronAPIMock } from '@/renderer/vitest.electronApiMock';

const DEST = '5526a65d0b4d23448206fd3485b76f5b';
const SELF = '8fd7a9361aca12360c7985bc934bdd20';
const identityId = 'reticulum-test';

describe('failReticulumSendingOutboundToDestHash', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    window.electronAPI = createElectronAPIMock();
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
            reticulumSenderHash: SELF,
          },
        },
      },
    });

    const count = failReticulumSendingOutboundToDestHash(identityId, DEST, 'send failed');
    expect(count).toBe(1);
    expect(useMessageStore.getState().messages[identityId]?.['msg-hash']?.status).toBe('failed');
  });

  it('persists failed delivery_status to SQLite', () => {
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
            reticulumMessageHash: 'msg-hash',
            reticulumSenderHash: SELF,
          },
        },
      },
    });

    failReticulumSendingOutboundToDestHash(identityId, DEST, 'link timeout');
    expect(window.electronAPI.db.saveReticulumMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        identity_id: identityId,
        message_hash: 'msg-hash',
        delivery_status: 'failed',
        to_hash: DEST,
      }),
    );
  });
});
