import { describe, expect, it } from 'vitest';

import { messageRecordsToChatMessages, nodeRecordsToMeshNodeMap } from '../lib/storeRecordAdapters';
import type { ChatMessage, MeshNode } from '../lib/types';
import type { MessageRecord } from '../stores/messageStore';
import type { NodeRecord } from '../stores/nodeStore';

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
});
