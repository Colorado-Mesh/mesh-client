import { describe, expect, it } from 'vitest';

import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '../hooks/meshcore/meshcoreHookPreamble';
import { repairMeshcoreHydrationStaleRoomSends } from './meshcoreDbCacheHydration';
import type { ChatMessage } from './types';

describe('repairMeshcoreHydrationStaleRoomSends', () => {
  it('promotes stale sending room posts to acked', () => {
    const stale: ChatMessage = {
      sender_id: 1,
      sender_name: 'Me',
      payload: 'test 8',
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: Date.now() - 60_000,
      status: 'sending',
      roomServerId: 0xabc,
    };
    const [fixed] = repairMeshcoreHydrationStaleRoomSends([stale]);
    expect(fixed?.status).toBe('acked');
  });

  it('keeps fresh sending room posts unchanged', () => {
    const fresh: ChatMessage = {
      sender_id: 1,
      sender_name: 'Me',
      payload: 'test 9',
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      timestamp: Date.now(),
      status: 'sending',
      roomServerId: 0xabc,
    };
    const [out] = repairMeshcoreHydrationStaleRoomSends([fresh]);
    expect(out?.status).toBe('sending');
  });
});
