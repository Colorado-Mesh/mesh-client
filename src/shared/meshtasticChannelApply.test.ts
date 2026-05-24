// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  channelNameExists,
  type ChannelSlotSnapshot,
  countFreeChannelSlots,
  findNextFreeChannelSlot,
} from './meshtasticChannelApply';
import { MESHTASTIC_CHANNEL_ROLE } from './meshtasticUrlEncoder';

const primary: ChannelSlotSnapshot = {
  index: 0,
  role: MESHTASTIC_CHANNEL_ROLE.PRIMARY,
  name: 'Primary',
};

describe('meshtasticChannelApply', () => {
  it('findNextFreeChannelSlot returns first free index 1–7', () => {
    expect(findNextFreeChannelSlot([primary], new Set())).toBe(1);
  });

  it('findNextFreeChannelSlot skips reserved indexes from current apply batch', () => {
    const channels: ChannelSlotSnapshot[] = [
      primary,
      { index: 1, role: MESHTASTIC_CHANNEL_ROLE.DISABLED, name: '' },
    ];
    expect(findNextFreeChannelSlot(channels, new Set([1]))).toBe(2);
  });

  it('findNextFreeChannelSlot returns null when all slots taken or reserved', () => {
    const channels: ChannelSlotSnapshot[] = [
      primary,
      ...[1, 2, 3, 4, 5, 6, 7].map((i) => ({
        index: i,
        role: MESHTASTIC_CHANNEL_ROLE.SECONDARY,
        name: `Ch${i}`,
      })),
    ];
    expect(findNextFreeChannelSlot(channels, new Set())).toBe(null);
    expect(findNextFreeChannelSlot([primary], new Set([1, 2, 3, 4, 5, 6, 7]))).toBe(null);
  });

  it('channelNameExists ignores disabled channels', () => {
    const channels: ChannelSlotSnapshot[] = [
      { index: 1, role: MESHTASTIC_CHANNEL_ROLE.DISABLED, name: 'Old' },
    ];
    expect(channelNameExists(channels, 'Old')).toBe(false);
    expect(channelNameExists(channels, 'New')).toBe(false);
  });

  it('channelNameExists matches enabled secondary by name', () => {
    const channels: ChannelSlotSnapshot[] = [
      { index: 1, role: MESHTASTIC_CHANNEL_ROLE.SECONDARY, name: 'Mesh' },
    ];
    expect(channelNameExists(channels, 'Mesh')).toBe(true);
  });

  it('countFreeChannelSlots counts disabled and empty secondary slots', () => {
    expect(countFreeChannelSlots([primary])).toBe(7);
    expect(
      countFreeChannelSlots([
        primary,
        { index: 1, role: MESHTASTIC_CHANNEL_ROLE.SECONDARY, name: 'Used' },
      ]),
    ).toBe(6);
  });
});
