import { MESHTASTIC_CHANNEL_ROLE } from './meshtasticUrlEncoder';

export interface ChannelSlotSnapshot {
  index: number;
  role: number;
  name: string;
}

/** True when an enabled channel already uses this name. */
export function channelNameExists(channels: ChannelSlotSnapshot[], name: string): boolean {
  return channels.some((c) => c.role !== MESHTASTIC_CHANNEL_ROLE.DISABLED && c.name === name);
}

/**
 * Next free secondary slot (indexes 1–7), excluding reserved indexes from the current apply batch.
 */
export function findNextFreeChannelSlot(
  channels: ChannelSlotSnapshot[],
  reserved: ReadonlySet<number>,
): number | null {
  for (let i = 1; i < 8; i++) {
    if (reserved.has(i)) continue;
    const cfg = channels.find((c) => c.index === i);
    if (!cfg || cfg.role === MESHTASTIC_CHANNEL_ROLE.DISABLED) {
      return i;
    }
  }
  return null;
}
