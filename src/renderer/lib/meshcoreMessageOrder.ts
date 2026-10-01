import {
  MESHCORE_DM_MESSAGE_CHANNEL,
  meshcoreMessageChannelIndex,
} from '@/shared/meshcoreMessageChannel';

import type { ChatMessage } from './types';

let lastLocalOrder = 0;

export function observeMeshcoreMessageLocalOrder(order: number): void {
  lastLocalOrder = Math.max(lastLocalOrder, order);
}

/** Independent of packet IDs and sender timestamps; persisted on the first local observation. */
export function nextMeshcoreMessageLocalOrder(): number {
  lastLocalOrder = Math.max(lastLocalOrder + 1, Date.now() * 1000);
  return lastLocalOrder;
}

/** Reorder only DM slots within a wire second; leave channel/room rows and other seconds alone. */
export function orderMeshcoreDmsWithinSecond(sorted: ChatMessage[]): ChatMessage[] {
  const buckets = new Map<number, { indices: number[]; messages: ChatMessage[] }>();
  sorted.forEach((message, index) => {
    if (
      message.localOrder == null ||
      meshcoreMessageChannelIndex(message.channel, message.to, message.roomServerId) !==
        MESHCORE_DM_MESSAGE_CHANNEL
    ) {
      return;
    }
    const second = Math.floor(message.timestamp / 1000);
    const bucket = buckets.get(second) ?? { indices: [], messages: [] };
    bucket.indices.push(index);
    bucket.messages.push(message);
    buckets.set(second, bucket);
  });
  const ordered = [...sorted];
  for (const { indices, messages } of buckets.values()) {
    messages.sort((a, b) => a.localOrder! - b.localOrder!);
    indices.forEach((index, offset) => {
      ordered[index] = messages[offset];
    });
  }
  return ordered;
}
