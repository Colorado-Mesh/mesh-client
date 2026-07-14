// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyReticulumOutboundDeliveryStatus,
  mapLxmfOutboundWireStatus,
  persistReticulumOutboundMessageStatus,
} from '@/renderer/lib/reticulum/applyReticulumOutboundDeliveryStatus';
import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import { useMessageStore } from '@/renderer/stores/messageStore';
import { createElectronAPIMock } from '@/renderer/vitest.electronApiMock';

const DEST = '5526a65d0b4d23448206fd3485b76f5b';
const SELF = '8fd7a9361aca12360c7985bc934bdd20';
const identityId = 'reticulum-persist-test';
const messageHash = 'abc123deliveredhash';

describe('applyReticulumOutboundDeliveryStatus', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    window.electronAPI = createElectronAPIMock();
  });

  it('maps delivered/failed/other wire statuses', () => {
    expect(mapLxmfOutboundWireStatus('delivered')).toBe('acked');
    expect(mapLxmfOutboundWireStatus('failed')).toBe('failed');
    expect(mapLxmfOutboundWireStatus('sending')).toBe('sending');
  });

  it('marks Completes as acked and persists delivery_status delivered', () => {
    const toNodeId = reticulumHashToNodeId(DEST);
    const selfNodeId = reticulumHashToNodeId(SELF);
    registerReticulumDestinationHash(toNodeId, DEST);
    registerReticulumDestinationHash(selfNodeId, SELF);
    useMessageStore.setState({
      messages: {
        [identityId]: {
          [messageHash]: {
            id: messageHash,
            from: selfNodeId,
            to: toNodeId,
            senderName: 'Me',
            payload: 'test 11',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'sending',
            reticulumMessageHash: messageHash,
            reticulumSenderHash: SELF,
          },
        },
      },
    });

    applyReticulumOutboundDeliveryStatus(identityId, messageHash, 'delivered');

    expect(useMessageStore.getState().messages[identityId]?.[messageHash]?.status).toBe('acked');
    expect(window.electronAPI.db.saveReticulumMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        identity_id: identityId,
        message_hash: messageHash,
        delivery_status: 'delivered',
        to_hash: DEST,
        sender_id: SELF,
      }),
    );
  });

  it('marks fails as failed and persists delivery_status failed', () => {
    const toNodeId = reticulumHashToNodeId(DEST);
    registerReticulumDestinationHash(toNodeId, DEST);
    useMessageStore.setState({
      messages: {
        [identityId]: {
          [messageHash]: {
            id: messageHash,
            from: 1,
            to: toNodeId,
            senderName: 'Me',
            payload: 'boom',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'sending',
            reticulumMessageHash: messageHash,
            reticulumSenderHash: SELF,
          },
        },
      },
    });

    applyReticulumOutboundDeliveryStatus(identityId, messageHash, 'failed');

    expect(useMessageStore.getState().messages[identityId]?.[messageHash]?.status).toBe('failed');
    expect(window.electronAPI.db.saveReticulumMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message_hash: messageHash,
        delivery_status: 'failed',
      }),
    );
  });

  it('does not re-persist intermediate sending status to SQLite', () => {
    useMessageStore.setState({
      messages: {
        [identityId]: {
          [messageHash]: {
            id: messageHash,
            from: 1,
            to: 2,
            payload: 'pending',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'sending',
            reticulumSenderHash: SELF,
          },
        },
      },
    });

    persistReticulumOutboundMessageStatus(identityId, messageHash, 'sending');
    expect(window.electronAPI.db.saveReticulumMessage).not.toHaveBeenCalled();
  });
});
