import { describe, expect, it } from 'vitest';

import { MESHCORE_ROOM_MESSAGE_CHANNEL } from './meshcoreContactHwLabels';
import { MESHCORE_DM_MESSAGE_CHANNEL, meshcoreMessageChannelIndex } from './meshcoreMessageChannel';

describe('meshcoreMessageChannelIndex', () => {
  it('returns MESHCORE_ROOM_MESSAGE_CHANNEL when roomServerId is provided', () => {
    expect(meshcoreMessageChannelIndex(0, 0x12345678, 42)).toBe(MESHCORE_ROOM_MESSAGE_CHANNEL);
    expect(meshcoreMessageChannelIndex(1, null, 1)).toBe(MESHCORE_ROOM_MESSAGE_CHANNEL);
    expect(meshcoreMessageChannelIndex(0, undefined, 0)).toBe(MESHCORE_ROOM_MESSAGE_CHANNEL);
  });

  it('returns MESHCORE_ROOM_MESSAGE_CHANNEL when channelIndex is already room channel', () => {
    expect(meshcoreMessageChannelIndex(MESHCORE_ROOM_MESSAGE_CHANNEL, null, null)).toBe(
      MESHCORE_ROOM_MESSAGE_CHANNEL,
    );
    expect(meshcoreMessageChannelIndex(MESHCORE_ROOM_MESSAGE_CHANNEL, 0x12345678, null)).toBe(
      MESHCORE_ROOM_MESSAGE_CHANNEL,
    );
  });

  it('returns MESHCORE_DM_MESSAGE_CHANNEL for unicast toNode peers', () => {
    expect(meshcoreMessageChannelIndex(0, 12345, null)).toBe(MESHCORE_DM_MESSAGE_CHANNEL);
    expect(meshcoreMessageChannelIndex(2, 0xabcd1234, undefined)).toBe(MESHCORE_DM_MESSAGE_CHANNEL);
  });

  it('returns channelIndex for broadcast (0xffffffff) and zero/null toNode', () => {
    expect(meshcoreMessageChannelIndex(3, 0xffffffff, null)).toBe(3);
    expect(meshcoreMessageChannelIndex(0, 0, null)).toBe(0);
    expect(meshcoreMessageChannelIndex(1, null, null)).toBe(1);
    expect(meshcoreMessageChannelIndex(2, undefined, undefined)).toBe(2);
  });
});
