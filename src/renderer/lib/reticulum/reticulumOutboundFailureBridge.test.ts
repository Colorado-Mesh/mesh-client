// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { applyReticulumOutboundDeliveryStatus } from '@/renderer/lib/reticulum/applyReticulumOutboundDeliveryStatus';
import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import {
  failReticulumSendingOutboundToDestHash,
  shouldApplyLinkDeliveryTimeoutFailureBridge,
} from '@/renderer/lib/reticulum/reticulumOutboundFailureBridge';
import { useMessageStore } from '@/renderer/stores/messageStore';
import type { PropagationNodeRow } from '@/renderer/stores/reticulumPropagationStore';
import { createElectronAPIMock } from '@/renderer/vitest.electronApiMock';

const DEST = '5526a65d0b4d23448206fd3485b76f5b';
const SELF = '8fd7a9361aca12360c7985bc934bdd20';
const identityId = 'reticulum-test';

const remoteNode: PropagationNodeRow = {
  id: 'pn-remote',
  name: 'Remote PN',
  enabled: true,
  status: 'active',
  preferred: true,
  destination_hash: '473a7d8a6fce3314e61915cc20060915',
};

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

  it('skips outbound rows already on propagated (Direct→PN fallback)', () => {
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
            reticulumDeliveryMethod: 'propagated',
          },
        },
      },
    });

    const count = failReticulumSendingOutboundToDestHash(identityId, DEST, 'link timeout');
    expect(count).toBe(0);
    expect(useMessageStore.getState().messages[identityId]?.['msg-hash']?.status).toBe('sending');
  });

  it('requires full 32-hex equality (prefix must not fail unrelated peers)', () => {
    const peerA = DEST;
    const peerB = `${DEST.slice(0, 8)}${'ff'.repeat(12)}`;
    const toA = reticulumHashToNodeId(peerA);
    const toB = reticulumHashToNodeId(peerB);
    registerReticulumDestinationHash(toA, peerA);
    registerReticulumDestinationHash(toB, peerB);
    useMessageStore.setState({
      messages: {
        [identityId]: {
          'msg-a': {
            id: 'msg-a',
            from: 1,
            senderName: 'self',
            payload: 'a',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'sending',
            to: toA,
            reticulumSenderHash: SELF,
          },
          'msg-b': {
            id: 'msg-b',
            from: 1,
            senderName: 'self',
            payload: 'b',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'sending',
            to: toB,
            reticulumSenderHash: SELF,
          },
        },
      },
    });

    expect(failReticulumSendingOutboundToDestHash(identityId, peerA.slice(0, 16), 'timeout')).toBe(
      0,
    );
    expect(useMessageStore.getState().messages[identityId]?.['msg-a']?.status).toBe('sending');
    expect(useMessageStore.getState().messages[identityId]?.['msg-b']?.status).toBe('sending');

    expect(failReticulumSendingOutboundToDestHash(identityId, peerA, 'timeout')).toBe(1);
    expect(useMessageStore.getState().messages[identityId]?.['msg-a']?.status).toBe('failed');
    expect(useMessageStore.getState().messages[identityId]?.['msg-b']?.status).toBe('sending');
  });

  it('race: bridge Failed then WS sending+propagated revives via apply', () => {
    const toNodeId = reticulumHashToNodeId(DEST);
    registerReticulumDestinationHash(toNodeId, DEST);
    const messageHash = '0079618cd4762a8edb2adbeed0e2d1d4f0e034b8991c3f28976d4b8629bcee76';
    useMessageStore.setState({
      messages: {
        [identityId]: {
          [messageHash]: {
            id: messageHash,
            from: 1,
            senderName: 'self',
            payload: 'hello',
            channelIndex: 0,
            timestamp: Date.now(),
            status: 'sending',
            to: toNodeId,
            reticulumMessageHash: messageHash,
            reticulumSenderHash: SELF,
            reticulumDeliveryMethod: 'direct',
          },
        },
      },
    });

    expect(failReticulumSendingOutboundToDestHash(identityId, DEST, 'link timeout')).toBe(1);
    expect(useMessageStore.getState().messages[identityId]?.[messageHash]?.status).toBe('failed');

    applyReticulumOutboundDeliveryStatus(identityId, messageHash, 'sending', {
      deliveryMethod: 'propagated',
    });
    const row = useMessageStore.getState().messages[identityId]?.[messageHash];
    expect(row?.status).toBe('sending');
    expect(row?.reticulumDeliveryMethod).toBe('propagated');
  });
});

describe('shouldApplyLinkDeliveryTimeoutFailureBridge', () => {
  it('returns false when preferred remote PN is set (sidecar owns Direct→PN fallback)', () => {
    expect(shouldApplyLinkDeliveryTimeoutFailureBridge([remoteNode], 'pn-remote', 'off')).toBe(
      false,
    );
  });

  it('returns false for mode manual when preferred remote PN is set', () => {
    expect(shouldApplyLinkDeliveryTimeoutFailureBridge([remoteNode], 'pn-remote', 'manual')).toBe(
      false,
    );
  });

  it('returns true when only local-prop is available', () => {
    const localOnly: PropagationNodeRow = {
      id: 'local-prop',
      name: 'Local',
      enabled: true,
      status: 'active',
      preferred: true,
    };
    expect(shouldApplyLinkDeliveryTimeoutFailureBridge([localOnly], 'local-prop', 'auto')).toBe(
      true,
    );
  });

  it('returns true when no remote PN target exists', () => {
    expect(shouldApplyLinkDeliveryTimeoutFailureBridge([], null, 'off')).toBe(true);
  });
});
