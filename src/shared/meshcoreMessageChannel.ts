import { MESHCORE_ROOM_MESSAGE_CHANNEL } from './meshcoreContactHwLabels';

export const MESHCORE_DM_MESSAGE_CHANNEL = -1;

/** Older sends retained the selected group channel even when addressed to a DM peer. */
export function meshcoreMessageChannelIndex(
  channelIndex: number,
  toNode?: number | null,
  roomServerId?: number | null,
): number {
  if (roomServerId != null || channelIndex === MESHCORE_ROOM_MESSAGE_CHANNEL) {
    return MESHCORE_ROOM_MESSAGE_CHANNEL;
  }
  if (toNode != null && toNode > 0 && toNode !== 0xffffffff) {
    return MESHCORE_DM_MESSAGE_CHANNEL;
  }
  return channelIndex;
}
