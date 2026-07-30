import { describe, expect, it } from 'vitest';

import type { MessageRecord } from '@/renderer/stores/messageStore';

import { reticulumHashToNodeId } from './destHash';
import { mergeReticulumIngestRecord } from './reticulumIngestMerge';

describe('mergeReticulumIngestRecord', () => {
  const selfHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const selfId = reticulumHashToNodeId(selfHash);
  const peerId = reticulumHashToNodeId('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

  it('ignores inbound overwrite of outbound DM from self', () => {
    const existing: MessageRecord = {
      id: 'msg1',
      from: selfId,
      senderName: 'Me',
      to: peerId,
      payload: 'hello',
      channelIndex: 0,
      timestamp: 1000,
      status: 'acked',
      receivedVia: 'tcp',
    };
    const incoming: MessageRecord = {
      id: 'msg1',
      from: peerId,
      senderName: 'Peer',
      to: selfId,
      payload: 'hello',
      channelIndex: 0,
      timestamp: 1000,
      status: 'acked',
      receivedVia: 'tcp',
    };
    const merged = mergeReticulumIngestRecord(
      existing,
      incoming,
      { direction: 'inbound' },
      {
        selfLxmfHash: selfHash,
      },
    );
    expect(merged.from).toBe(selfId);
    expect(merged.to).toBe(peerId);
  });

  it('forces outbound sender to self lxmf hash', () => {
    const incoming: MessageRecord = {
      id: 'msg2',
      from: peerId,
      senderName: 'Wrong',
      to: peerId,
      payload: 'hello',
      channelIndex: 0,
      timestamp: 1000,
      status: 'acked',
    };
    const merged = mergeReticulumIngestRecord(
      undefined,
      incoming,
      { direction: 'outbound' },
      {
        selfLxmfHash: selfHash,
      },
    );
    expect(merged.from).toBe(selfId);
  });

  it('prefers sidecar sent_via over stale optimistic receivedVia on outbound ack', () => {
    const existing: MessageRecord = {
      id: 'msg3',
      from: selfId,
      senderName: 'Me',
      to: peerId,
      payload: 'hello',
      channelIndex: 0,
      timestamp: 1000,
      status: 'sending',
      receivedVia: 'network',
    };
    const incoming: MessageRecord = {
      id: 'msg3',
      from: selfId,
      senderName: 'Me',
      to: peerId,
      payload: 'hello',
      channelIndex: 0,
      timestamp: 1000,
      status: 'acked',
      receivedVia: 'rf',
    };
    const merged = mergeReticulumIngestRecord(
      existing,
      incoming,
      { direction: 'outbound' },
      { selfLxmfHash: selfHash },
    );
    expect(merged.receivedVia).toBe('rf');
  });

  it('preserves reply quote metadata when a later tick omits them', () => {
    const parentHash = 'cc'.repeat(32);
    const existing: MessageRecord = {
      id: 'msg4',
      from: peerId,
      senderName: 'Peer',
      to: selfId,
      payload: 'reply',
      channelIndex: 0,
      timestamp: 1000,
      status: 'acked',
      reticulumReplyToHash: parentHash,
      replyPreviewText: 'Quoted',
      replyPreviewSender: 'Alice',
    };
    const incoming: MessageRecord = {
      id: 'msg4',
      from: peerId,
      senderName: 'Peer',
      to: selfId,
      payload: 'reply',
      channelIndex: 0,
      timestamp: 1000,
      status: 'acked',
    };
    const merged = mergeReticulumIngestRecord(
      existing,
      incoming,
      { direction: 'inbound' },
      { selfLxmfHash: selfHash },
    );
    expect(merged.reticulumReplyToHash).toBe(parentHash);
    expect(merged.replyPreviewText).toBe('Quoted');
    expect(merged.replyPreviewSender).toBe('Alice');
  });

  it('overwrites reply preview when incoming provides new quote fields', () => {
    const existing: MessageRecord = {
      id: 'msg5',
      from: peerId,
      senderName: 'Peer',
      to: selfId,
      payload: 'reply',
      channelIndex: 0,
      timestamp: 1000,
      status: 'acked',
      replyPreviewText: 'Old',
      replyPreviewSender: 'OldSender',
    };
    const incoming: MessageRecord = {
      id: 'msg5',
      from: peerId,
      senderName: 'Peer',
      to: selfId,
      payload: 'reply',
      channelIndex: 0,
      timestamp: 1000,
      status: 'acked',
      replyPreviewText: 'New quote',
      replyPreviewSender: 'Bob',
    };
    const merged = mergeReticulumIngestRecord(
      existing,
      incoming,
      { direction: 'inbound' },
      { selfLxmfHash: selfHash },
    );
    expect(merged.replyPreviewText).toBe('New quote');
    expect(merged.replyPreviewSender).toBe('Bob');
  });

  it('does not demote an acked Completes to sending on outbound ingest echo', () => {
    const existing: MessageRecord = {
      id: 'msg-acked',
      from: selfId,
      senderName: 'Me',
      to: peerId,
      payload: 'just sent',
      channelIndex: 0,
      timestamp: 2000,
      status: 'acked',
      receivedVia: 'tcp',
      reticulumDeliveryMethod: 'propagated',
    };
    const incoming: MessageRecord = {
      id: 'msg-acked',
      from: selfId,
      senderName: 'Me',
      to: peerId,
      payload: 'just sent',
      channelIndex: 0,
      timestamp: 2000,
      status: 'sending',
      receivedVia: 'tcp',
      reticulumDeliveryMethod: 'propagated',
    };
    const merged = mergeReticulumIngestRecord(
      existing,
      incoming,
      { direction: 'outbound' },
      { selfLxmfHash: selfHash },
    );
    expect(merged.status).toBe('acked');
    expect(merged.reticulumDeliveryMethod).toBe('propagated');
  });

  it('still allows failed → sending on outbound ingest (manual retry / PN fallback)', () => {
    const existing: MessageRecord = {
      id: 'msg-failed',
      from: selfId,
      senderName: 'Me',
      to: peerId,
      payload: 'retry me',
      channelIndex: 0,
      timestamp: 1000,
      status: 'failed',
      error: 'delivery failed',
    };
    const incoming: MessageRecord = {
      id: 'msg-failed',
      from: selfId,
      senderName: 'Me',
      to: peerId,
      payload: 'retry me',
      channelIndex: 0,
      timestamp: 1000,
      status: 'sending',
    };
    const merged = mergeReticulumIngestRecord(
      existing,
      incoming,
      { direction: 'outbound' },
      { selfLxmfHash: selfHash },
    );
    expect(merged.status).toBe('sending');
  });
});
