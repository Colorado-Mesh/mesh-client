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
});
