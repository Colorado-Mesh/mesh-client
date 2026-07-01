import { describe, expect, it } from 'vitest';

import { MESHTASTIC_BROADCAST_NODE_NUM } from '@/shared/nodeNameUtils';

import type { MessageRecord } from '../stores/messageStore';
import type { NodeRecord } from '../stores/nodeStore';
import {
  chatMessageToMessageRecord,
  groupChatReactionsByParentKey,
  meshNodeToNodeRecord,
  messageRecordsToChatMessages,
  messageRecordToChatMessage,
  nodeRecordsToMeshNodeMap,
  nodeRecordToMeshNode,
  reticulumDbRowToMessageRecord,
} from './storeRecordAdapters';
import type { ChatMessage, MeshNode } from './types';

describe('store record adapters (merge precedence)', () => {
  it('messageRecordsToChatMessages preserves packet id keys', () => {
    const records: MessageRecord[] = [
      {
        id: '42',
        from: 1,
        to: 0xffffffff,
        payload: 'from store',
        channelIndex: 0,
        timestamp: 100,
      },
    ];
    const msgs = messageRecordsToChatMessages(records);
    expect(msgs[0].packetId).toBe(42);
    expect(msgs[0].payload).toBe('from store');
    expect(msgs[0].to).toBeUndefined();
  });

  it('messageRecordToChatMessage falls back to hex node id when senderName is missing', () => {
    const record: MessageRecord = {
      id: '99',
      from: 0x51f1662,
      to: 0xffffffff,
      payload: 'Hi from UA1662!',
      channelIndex: 0,
      timestamp: 100,
    };
    expect(messageRecordToChatMessage(record).sender_name).toBe('!051f1662');
  });

  it('round-trips tapback reactions via tapback flag and payload glyph', () => {
    const reaction: ChatMessage = {
      sender_id: 1,
      sender_name: 'Me',
      payload: '👍',
      channel: 0,
      timestamp: 2000,
      emoji: 128077,
      replyId: 424242,
      packetId: 77,
    };
    const record = chatMessageToMessageRecord(reaction);
    expect(record.tapback).toBe(true);
    expect(record.replyTo).toBe('424242');
    const back = messageRecordToChatMessage(record);
    expect(back.emoji).toBe(128077);
    expect(back.replyId).toBe(424242);
    expect(back.packetId).toBe(77);
  });

  it('round-trips channel messages without treating broadcast as DM', () => {
    const channelMsg: ChatMessage = {
      sender_id: 3,
      sender_name: 'Node',
      payload: 'hello channel',
      channel: 0,
      timestamp: 1000,
    };
    const record = chatMessageToMessageRecord(channelMsg);
    expect(record.to).toBe(MESHTASTIC_BROADCAST_NODE_NUM);
    const back = messageRecordToChatMessage(record);
    expect(back.to).toBeUndefined();
  });

  it('round-trips channel utilization and air util between NodeRecord and MeshNode', () => {
    const record: NodeRecord = {
      nodeId: 1,
      longName: 'Alpha',
      channelUtilization: 42.5,
      airUtilTx: 3.1,
    };
    const node = nodeRecordToMeshNode(record);
    expect(node.channel_utilization).toBe(42.5);
    expect(node.air_util_tx).toBe(3.1);
    const back = meshNodeToNodeRecord({
      ...node,
      node_id: 1,
      long_name: 'Alpha',
      short_name: 'AL',
      hw_model: 'T-Beam',
      snr: 0,
      rssi: 0,
      battery: 0,
      last_heard: 0,
      latitude: null,
      longitude: null,
    });
    expect(back.channelUtilization).toBe(42.5);
    expect(back.airUtilTx).toBe(3.1);
  });

  it('nodeRecordsToMeshNodeMap merges legacy fields when spread under hook merge pattern', () => {
    const storeNodes: NodeRecord[] = [
      { nodeId: 9, longName: 'Store', shortName: 'ST', lastHeardAt: 100 },
    ];
    const legacy = new Map<number, MeshNode>([
      [
        9,
        {
          node_id: 9,
          long_name: 'Legacy',
          short_name: 'LG',
          hw_model: 'T-Beam',
          snr: 7,
          rssi: -80,
          battery: 90,
          last_heard: 200,
          latitude: null,
          longitude: null,
        },
      ],
    ]);
    const fromStore = nodeRecordsToMeshNodeMap(storeNodes);
    const merged = new Map(fromStore);
    for (const [id, node] of legacy) {
      merged.set(id, { ...merged.get(id), ...node });
    }
    expect(merged.get(9)?.long_name).toBe('Legacy');
    expect(merged.get(9)?.hw_model).toBe('T-Beam');
    expect(merged.get(9)?.last_heard).toBe(200);
  });

  it('legacy-only message not in store list stays out of store-derived array', () => {
    const legacyOnly: ChatMessage = {
      sender_id: 2,
      sender_name: 'Bob',
      payload: 'legacy only',
      channel: 1,
      timestamp: 50,
    };
    const fromStore = messageRecordsToChatMessages([]);
    expect(fromStore).not.toContainEqual(expect.objectContaining({ payload: 'legacy only' }));
    expect([...fromStore, legacyOnly]).toHaveLength(1);
  });

  it('round-trips Reticulum LXMF hash and reply fields from DB rows', () => {
    const record = reticulumDbRowToMessageRecord({
      sender_id: 'aa'.repeat(16),
      sender_name: 'Peer',
      payload: 'hello',
      timestamp: 1_700_000_000_000,
      to_hash: 'bb'.repeat(16),
      reply_to_hash: 'cc'.repeat(16),
      message_hash: 'dd'.repeat(16),
    });
    expect(record.reticulumMessageHash).toBe('dd'.repeat(16));
    expect(record.reticulumReplyToHash).toBe('cc'.repeat(16));
    const chat = messageRecordToChatMessage(record);
    expect(chat.reticulum_reply_to_hash).toBe('cc'.repeat(16));
  });

  it('rehydrates Reticulum tapbacks from DB rows using reply_to_hash parent linkage', () => {
    const parentHash = 'ee'.repeat(16);
    const record = reticulumDbRowToMessageRecord({
      sender_id: 'aa'.repeat(16),
      sender_name: 'Peer',
      payload: '👍',
      timestamp: 1_700_000_000_001,
      reply_to_hash: parentHash,
      message_hash: 'ff'.repeat(16),
    });
    expect(record.tapback).toBe(true);
    expect(record.reticulumReplyToHash).toBe(parentHash);
    const chat = messageRecordToChatMessage(record);
    expect(chat.emoji).toBe(0x1f44d);
    expect(chat.reticulum_reply_to_hash).toBe(parentHash);

    const parent: ChatMessage = {
      sender_id: 1,
      sender_name: 'You',
      payload: 'parent',
      channel: 0,
      timestamp: 1_700_000_000_000,
      reticulum_message_hash: parentHash,
    };
    const { regularMessages, reactionsByParentKey } = groupChatReactionsByParentKey([parent, chat]);
    expect(regularMessages).toHaveLength(1);
    expect(reactionsByParentKey.get(parentHash)).toEqual([
      expect.objectContaining({ emoji: 0x1f44d, payload: '👍' }),
    ]);
  });
});
