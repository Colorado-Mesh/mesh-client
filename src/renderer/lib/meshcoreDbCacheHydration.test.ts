import { describe, expect, it } from 'vitest';

import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '../hooks/meshcore/meshcoreHookPreamble';
import {
  repairMeshcoreHydratedDmToNode,
  repairMeshcoreHydrationStaleRoomSends,
} from './meshcoreDbCacheHydration';
import type { ChatMessage } from './types';

describe('repairMeshcoreHydratedDmToNode', () => {
  it('sets to to self for inbound DM rows hydrated with to_node 0', () => {
    const inbound: ChatMessage = {
      sender_id: 0xdef,
      sender_name: 'Alice',
      payload: 'hello',
      channel: -1,
      timestamp: 5000,
      status: 'acked',
      to: 0,
    };
    const [fixed] = repairMeshcoreHydratedDmToNode([inbound], 0xabc);
    expect(fixed.to).toBe(0xabc);
  });

  it('leaves outbound DMs and channel messages unchanged', () => {
    const outbound: ChatMessage = {
      sender_id: 0xabc,
      sender_name: 'Me',
      payload: 'out',
      channel: -1,
      timestamp: 5000,
      status: 'acked',
      to: 0xdef,
    };
    const channel: ChatMessage = {
      sender_id: 0xdef,
      sender_name: 'Alice',
      payload: 'ch',
      channel: 0,
      timestamp: 5000,
      status: 'acked',
    };
    const [out, ch] = repairMeshcoreHydratedDmToNode([outbound, channel], 0xabc);
    expect(out.to).toBe(0xdef);
    expect(ch.to).toBeUndefined();
  });
});

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
