import { describe, expect, it } from 'vitest';

import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '@/renderer/hooks/meshcore/meshcoreHookPreamble';
import type { ChatMessage } from '@/renderer/lib/types';

import {
  meshcoreRoomServerIdsFromContacts,
  repairMeshcoreHydratedDmRfDuplicates,
  repairMeshcoreHydratedMessages,
  repairMeshcoreMisfiledRoomDmMessages,
  repairMeshcoreRoomStoredPostPayloads,
} from './meshcoreDbCacheHydration';

describe('repairMeshcoreMisfiledRoomDmMessages', () => {
  it('reclassifies DM-shaped rows from room server peers', () => {
    const roomId = 0xac200e59;
    const roomIds = meshcoreRoomServerIdsFromContacts([{ node_id: roomId, contact_type: 3 }]);
    const dm: ChatMessage = {
      sender_id: roomId,
      sender_name: 'Unknown',
      payload: 'Bot Stats (24h):',
      channel: 0,
      timestamp: 1_700_000_000,
      to: 1,
    };
    const [fixed] = repairMeshcoreMisfiledRoomDmMessages([dm], roomIds);
    expect(fixed.roomServerId).toBe(roomId);
    expect(fixed.channel).toBe(MESHCORE_ROOM_MESSAGE_CHANNEL);
    expect(fixed.payload).toBe('Bot Stats (24h):');
  });
});

describe('repairMeshcoreRoomStoredPostPayloads', () => {
  it('strips garbled prefix from stored room posts on hydration', () => {
    const authorPrefix = String.fromCharCode(0x93, 0x6c, 0x73, 0x49);
    const garbled: ChatMessage = {
      sender_id: 0,
      sender_name: 'Unknown',
      payload: `${authorPrefix}Test from og app`,
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: 1_700_000_000,
      roomServerId: 0xac200e59,
      to: 0xac200e59,
    };
    const [fixed] = repairMeshcoreRoomStoredPostPayloads([garbled]);
    expect(fixed.payload).toBe('Test from og app');
  });

  it('repairs garbled room rows via repairMeshcoreHydratedMessages', () => {
    const authorPrefix = String.fromCharCode(0x93, 0x6c, 0x73, 0x49);
    const roomId = 0xac200e59;
    const garbled: ChatMessage = {
      sender_id: 0,
      sender_name: 'Unknown',
      payload: `${authorPrefix}Persisted post`,
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: 1_700_000_000,
      roomServerId: roomId,
      to: roomId,
    };
    const [fixed] = repairMeshcoreHydratedMessages([garbled], new Set([roomId]));
    expect(fixed.payload).toBe('Persisted post');
  });
});

describe('repairMeshcoreHydratedDmRfDuplicates', () => {
  it('drops duplicate RF DM rows loaded from SQLite', () => {
    const base: ChatMessage = {
      sender_id: 0x123,
      sender_name: 'durk',
      payload: 'N99157 3700ft',
      channel: -1,
      to: 0xabc,
      timestamp: 1_700_000_000_000,
      receivedVia: 'rf',
    };
    const dup: ChatMessage = {
      ...base,
      timestamp: base.timestamp + 52_000,
    };
    expect(repairMeshcoreHydratedDmRfDuplicates([base, dup])).toHaveLength(1);
  });
});
