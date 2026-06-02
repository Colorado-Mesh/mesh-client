import { describe, expect, it } from 'vitest';

import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '@/renderer/hooks/meshcore/meshcoreHookPreamble';
import type { ChatMessage } from '@/renderer/lib/types';

import {
  meshcoreRoomServerIdsFromContacts,
  repairMeshcoreMisfiledRoomDmMessages,
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
