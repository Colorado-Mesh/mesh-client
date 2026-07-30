import { beforeEach, describe, expect, it } from 'vitest';

import { ingestReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';
import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import {
  renameMessageId,
  updateMessageStatus,
  useMessageStore,
} from '@/renderer/stores/messageStore';

/**
 * Regression: Retrying a failed LXMF row must not flip an unrelated just-delivered
 * Completes bubble back to ⏳ (ingest echo / rename collision).
 */
describe('Reticulum outbound retry vs Completes status', () => {
  const identityId = 'rt-retry-status';
  const selfHash = 'aa'.repeat(16);
  const peerHash = 'bb'.repeat(16);
  const successHash = '11'.repeat(32);
  const failedHash = '22'.repeat(32);
  const retryHash = '33'.repeat(32);
  const selfId = reticulumHashToNodeId(selfHash);
  const peerId = reticulumHashToNodeId(peerHash);

  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    registerReticulumDestinationHash(selfId, selfHash);
    registerReticulumDestinationHash(peerId, peerHash);
    useMessageStore.setState({
      messages: {
        [identityId]: {
          [successHash]: {
            id: successHash,
            from: selfId,
            senderName: 'Me',
            to: peerId,
            payload: 'just sent ok',
            channelIndex: 0,
            timestamp: 2_000,
            status: 'acked',
            reticulumMessageHash: successHash,
            reticulumSenderHash: selfHash,
            reticulumDeliveryMethod: 'propagated',
          },
          [failedHash]: {
            id: failedHash,
            from: selfId,
            senderName: 'Me',
            to: peerId,
            payload: 'older failed',
            channelIndex: 0,
            timestamp: 1_000,
            status: 'failed',
            error: 'delivery failed',
            reticulumMessageHash: failedHash,
            reticulumSenderHash: selfHash,
          },
        },
      },
    });
  });

  it('keeps Completes acked when a sending ingest echo targets that hash', () => {
    updateMessageStatus(identityId, failedHash, 'sending');
    ingestReticulumLxmfPayload(identityId, {
      sender_hash: selfHash,
      sender_name: 'Me',
      text: 'just sent ok',
      timestamp: 2_000,
      to_hash: peerHash,
      message_hash: successHash,
      direction: 'outbound',
      delivery_status: 'sending',
      delivery_method: 'propagated',
    });

    const bucket = useMessageStore.getState().messages[identityId] ?? {};
    expect(bucket[successHash].status).toBe('acked');
    expect(bucket[failedHash].status).toBe('sending');
  });

  it('rekeys retry onto a new hash without demoting Completes', () => {
    updateMessageStatus(identityId, failedHash, 'sending');
    renameMessageId(identityId, failedHash, retryHash);
    ingestReticulumLxmfPayload(identityId, {
      sender_hash: selfHash,
      sender_name: 'Me',
      text: 'older failed',
      timestamp: 3_000,
      to_hash: peerHash,
      message_hash: retryHash,
      direction: 'outbound',
      delivery_status: 'sending',
      delivery_method: 'propagated',
    });
    updateMessageStatus(identityId, retryHash, 'sending');

    const bucket = useMessageStore.getState().messages[identityId] ?? {};
    expect(bucket[successHash].status).toBe('acked');
    expect(bucket[failedHash]).toBeUndefined();
    expect(bucket[retryHash].status).toBe('sending');
  });

  it('rename onto Completes hash drops retry row and leaves Completes acked', () => {
    updateMessageStatus(identityId, failedHash, 'sending');
    renameMessageId(identityId, failedHash, successHash);

    const bucket = useMessageStore.getState().messages[identityId] ?? {};
    expect(bucket[failedHash]).toBeUndefined();
    expect(bucket[successHash].status).toBe('acked');
    expect(bucket[successHash].payload).toBe('just sent ok');
  });
});
