// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyReticulumOutboundDeliveryStatus,
  clearPendingReticulumOutboundDeliveryStatusesForTests,
  flushPendingReticulumOutboundDeliveryStatus,
  mapLxmfOutboundWireStatus,
  persistReticulumOutboundMessageStatus,
} from '@/renderer/lib/reticulum/applyReticulumOutboundDeliveryStatus';
import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import { renameMessageId, useMessageStore } from '@/renderer/stores/messageStore';
import { createElectronAPIMock } from '@/renderer/vitest.electronApiMock';

const DEST = '5526a65d0b4d23448206fd3485b76f5b';
const SELF = '8fd7a9361aca12360c7985bc934bdd20';
const identityId = 'reticulum-persist-test';
const messageHash = 'abc123def4567890abc123def4567890abc123def4567890abc123def4567890';

describe('applyReticulumOutboundDeliveryStatus', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    clearPendingReticulumOutboundDeliveryStatusesForTests();
    window.electronAPI = createElectronAPIMock();
  });

  it('maps delivered/failed/sending; drops unknown wire statuses', () => {
    expect(mapLxmfOutboundWireStatus('delivered')).toBe('acked');
    expect(mapLxmfOutboundWireStatus('failed')).toBe('failed');
    expect(mapLxmfOutboundWireStatus('sending')).toBe('sending');
    expect(mapLxmfOutboundWireStatus('queued')).toBeNull();
    expect(mapLxmfOutboundWireStatus('garbage')).toBeNull();
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

  it('buffers early terminal status until the message row is rekeyed', () => {
    const pendingId = 'reticulum-pending-1';
    const toNodeId = reticulumHashToNodeId(DEST);
    registerReticulumDestinationHash(toNodeId, DEST);
    useMessageStore.setState({
      messages: {
        [identityId]: {
          [pendingId]: {
            id: pendingId,
            from: 1,
            to: toNodeId,
            payload: 'race',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'sending',
            reticulumSenderHash: SELF,
          },
        },
      },
    });

    applyReticulumOutboundDeliveryStatus(identityId, messageHash, 'delivered');
    expect(useMessageStore.getState().messages[identityId]?.[pendingId]?.status).toBe('sending');
    expect(window.electronAPI.db.saveReticulumMessage).not.toHaveBeenCalled();

    renameMessageId(identityId, pendingId, messageHash);
    expect(flushPendingReticulumOutboundDeliveryStatus(identityId, messageHash)).toBe(true);
    expect(useMessageStore.getState().messages[identityId]?.[messageHash]?.status).toBe('acked');
    expect(window.electronAPI.db.saveReticulumMessage).toHaveBeenCalled();
  });

  it('does not regress terminal status back to sending', () => {
    useMessageStore.setState({
      messages: {
        [identityId]: {
          [messageHash]: {
            id: messageHash,
            from: 1,
            to: 2,
            payload: 'done',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'acked',
            reticulumSenderHash: SELF,
          },
        },
      },
    });

    persistReticulumOutboundMessageStatus(identityId, messageHash, 'sending');
    expect(useMessageStore.getState().messages[identityId]?.[messageHash]?.status).toBe('acked');
  });

  it('upgrades receivedVia from lxmf_outbound_status sent_via evidence', () => {
    useMessageStore.setState({
      messages: {
        [identityId]: {
          [messageHash]: {
            id: messageHash,
            from: 1,
            to: 2,
            payload: 'dual',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'sending',
            receivedVia: 'rf',
            reticulumMessageHash: messageHash,
            reticulumSenderHash: SELF,
          },
        },
      },
    });

    applyReticulumOutboundDeliveryStatus(identityId, messageHash, 'sending', {
      sentVia: 'rf+tcp',
    });

    expect(useMessageStore.getState().messages[identityId]?.[messageHash]?.receivedVia).toBe(
      'rf+tcp',
    );
    expect(useMessageStore.getState().messages[identityId]?.[messageHash]?.status).toBe('sending');
    expect(window.electronAPI.db.saveReticulumMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message_hash: messageHash,
        received_via: 'rf+tcp',
        delivery_status: 'sending',
      }),
    );
  });

  it('upgrades reticulumDeliveryMethod on Direct→PN fallback and persists', () => {
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
            payload: 'fallback',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'sending',
            reticulumMessageHash: messageHash,
            reticulumSenderHash: SELF,
            reticulumDeliveryMethod: 'direct',
          },
        },
      },
    });

    applyReticulumOutboundDeliveryStatus(identityId, messageHash, 'sending', {
      deliveryMethod: 'propagated',
    });
    expect(
      useMessageStore.getState().messages[identityId]?.[messageHash]?.reticulumDeliveryMethod,
    ).toBe('propagated');

    applyReticulumOutboundDeliveryStatus(identityId, messageHash, 'delivered', {
      deliveryMethod: 'propagated',
    });
    expect(useMessageStore.getState().messages[identityId]?.[messageHash]?.status).toBe('acked');
    expect(
      useMessageStore.getState().messages[identityId]?.[messageHash]?.reticulumDeliveryMethod,
    ).toBe('propagated');
    expect(window.electronAPI.db.saveReticulumMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message_hash: messageHash,
        delivery_status: 'delivered',
        delivery_method: 'propagated',
      }),
    );
  });

  it('buffers early deliveryMethod upgrade until flush after rekey', () => {
    applyReticulumOutboundDeliveryStatus(identityId, messageHash, 'sending', {
      deliveryMethod: 'propagated',
    });
    expect(useMessageStore.getState().messages[identityId]?.[messageHash]).toBeUndefined();

    useMessageStore.setState({
      messages: {
        [identityId]: {
          [messageHash]: {
            id: messageHash,
            from: 1,
            to: 2,
            payload: 'early',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'sending',
            reticulumMessageHash: messageHash,
            reticulumSenderHash: SELF,
            reticulumDeliveryMethod: 'direct',
          },
        },
      },
    });

    expect(flushPendingReticulumOutboundDeliveryStatus(identityId, messageHash)).toBe(true);
    expect(
      useMessageStore.getState().messages[identityId]?.[messageHash]?.reticulumDeliveryMethod,
    ).toBe('propagated');
  });

  it('patches deliveryMethod on terminal row without regressing status', () => {
    useMessageStore.setState({
      messages: {
        [identityId]: {
          [messageHash]: {
            id: messageHash,
            from: 1,
            to: 2,
            payload: 'done',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'acked',
            reticulumMessageHash: messageHash,
            reticulumSenderHash: SELF,
            reticulumDeliveryMethod: 'direct',
          },
        },
      },
    });

    applyReticulumOutboundDeliveryStatus(identityId, messageHash, 'sending', {
      deliveryMethod: 'propagated',
    });
    expect(useMessageStore.getState().messages[identityId]?.[messageHash]?.status).toBe('acked');
    expect(
      useMessageStore.getState().messages[identityId]?.[messageHash]?.reticulumDeliveryMethod,
    ).toBe('propagated');
  });

  it('revives Failed to sending when Direct→PN fallback WS arrives after link-timeout bridge', () => {
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
            payload: 'race',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'failed',
            error: 'Failed to send',
            reticulumMessageHash: messageHash,
            reticulumSenderHash: SELF,
            reticulumDeliveryMethod: 'direct',
          },
        },
      },
    });

    applyReticulumOutboundDeliveryStatus(identityId, messageHash, 'sending', {
      deliveryMethod: 'propagated',
    });

    const row = useMessageStore.getState().messages[identityId]?.[messageHash];
    expect(row?.status).toBe('sending');
    expect(row?.reticulumDeliveryMethod).toBe('propagated');
    expect(row?.error).toBeUndefined();
    expect(window.electronAPI.db.saveReticulumMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message_hash: messageHash,
        delivery_status: 'sending',
        delivery_method: 'propagated',
      }),
    );
  });

  it('drops invalid message_hash and unknown wire status', () => {
    useMessageStore.setState({
      messages: {
        [identityId]: {
          [messageHash]: {
            id: messageHash,
            from: 1,
            to: 2,
            payload: 'x',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'sending',
          },
        },
      },
    });
    applyReticulumOutboundDeliveryStatus(identityId, 'not-a-hash!!!', 'delivered');
    applyReticulumOutboundDeliveryStatus(identityId, messageHash, 'queued');
    expect(useMessageStore.getState().messages[identityId]?.[messageHash]?.status).toBe('sending');
  });
});
