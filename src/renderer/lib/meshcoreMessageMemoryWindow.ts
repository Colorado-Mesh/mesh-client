/**
 * In-memory MeshCore chat window matching SQL hydration floors.
 *
 * `selectMeshcoreMessagesForHydration` can return more than
 * `MAX_IN_MEMORY_CHAT_MESSAGES` (global 500 ∪ 100 per group/DM ∪ 200 room).
 * A newest-N slice drops the oldest quiet channels. This keeps each logical
 * channel's floor, then only a bounded surplus of newer overflow, so a live
 * insert cannot evict a quiet channel to make room for Public.
 */
import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '@/shared/meshcoreContactHwLabels';
import { meshcoreMessageChannelIndex } from '@/shared/meshcoreMessageChannel';
import {
  MESHCORE_DB_PER_CHANNEL_MESSAGE_LOAD_LIMIT,
  MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT,
} from '@/shared/meshcoreMessageHydration';

import { MAX_IN_MEMORY_CHAT_MESSAGES } from './chatInMemoryBuffer';
import type { ChatMessage } from './types';

/** Radio slots 0–39 plus DM and room, with a little slack for legacy indexes. */
export const MAX_MESHCORE_MEMORY_CHANNELS = 48;

export interface MeshcoreMemoryWindowFields {
  timestamp: number;
  localOrder?: number;
  channelIndex: number;
  to: number;
  roomServerId?: number;
  status?: string;
  trimId: string;
}

/** Recent messages kept for one logical channel (rooms use the larger floor). */
function floorForLogicalChannel(logical: number): number {
  return logical === MESHCORE_ROOM_MESSAGE_CHANNEL
    ? MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT
    : MESHCORE_DB_PER_CHANNEL_MESSAGE_LOAD_LIMIT;
}

/** Newest first, then higher local order, then id. */
function compareNewestFirst(a: MeshcoreMemoryWindowFields, b: MeshcoreMemoryWindowFields): number {
  if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
  const aOrder = a.localOrder ?? 0;
  const bOrder = b.localOrder ?? 0;
  if (aOrder !== bOrder) return bOrder - aOrder;
  return b.trimId.localeCompare(a.trimId);
}

/** Latest timestamp in a channel group, used only to rank extra channels. */
function newestTimestamp<T>(
  items: readonly T[],
  fieldsOf: (item: T) => MeshcoreMemoryWindowFields,
): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const ts = fieldsOf(item).timestamp;
    if (ts > best) best = ts;
  }
  return best;
}

/**
 * Keep per-channel floors plus surplus that still fits under `maxMessages`.
 * Floors are kept even when their sum exceeds `maxMessages`. Returns the input
 * array when nothing is dropped.
 */
export function trimMeshcoreMemoryWindow<T>(
  items: readonly T[],
  fieldsOf: (item: T) => MeshcoreMemoryWindowFields,
  maxMessages: number = MAX_IN_MEMORY_CHAT_MESSAGES,
): readonly T[] {
  if (items.length <= maxMessages) return items;

  const sending: T[] = [];
  const byChannel = new Map<number, T[]>();
  for (const item of items) {
    const fields = fieldsOf(item);
    if (fields.status === 'sending') {
      sending.push(item);
      continue;
    }
    const logical = meshcoreMessageChannelIndex(
      fields.channelIndex,
      fields.to,
      fields.roomServerId,
    );
    const list = byChannel.get(logical);
    if (list) list.push(item);
    else byChannel.set(logical, [item]);
  }

  let protectedChannels: Set<number> | null = null;
  if (byChannel.size > MAX_MESHCORE_MEMORY_CHANNELS) {
    const ranked = [...byChannel.entries()].sort(
      (a, b) => newestTimestamp(b[1], fieldsOf) - newestTimestamp(a[1], fieldsOf),
    );
    protectedChannels = new Set(
      ranked.slice(0, MAX_MESHCORE_MEMORY_CHANNELS).map(([logical]) => logical),
    );
  }

  const floors: T[] = [];
  const surplus: T[] = [];
  for (const [logical, list] of byChannel) {
    list.sort((a, b) => compareNewestFirst(fieldsOf(a), fieldsOf(b)));
    if (protectedChannels && !protectedChannels.has(logical)) {
      surplus.push(...list);
      continue;
    }
    const floor = floorForLogicalChannel(logical);
    floors.push(...list.slice(0, floor));
    if (list.length > floor) surplus.push(...list.slice(floor));
  }

  const surplusBudget = Math.max(0, maxMessages - floors.length - sending.length);
  if (surplusBudget < surplus.length) {
    surplus.sort((a, b) => compareNewestFirst(fieldsOf(a), fieldsOf(b)));
  }
  const kept = new Set<T>([...sending, ...floors, ...surplus.slice(0, surplusBudget)]);
  if (kept.size === items.length) return items;
  return items.filter((item) => kept.has(item));
}

/** Map a MeshCore chat row onto the fields the fair memory window groups by. */
export function meshcoreChatMessageWindowFields(message: ChatMessage): MeshcoreMemoryWindowFields {
  return {
    timestamp: message.timestamp,
    localOrder: message.localOrder,
    channelIndex: message.channel,
    to: message.to ?? 0,
    roomServerId: message.roomServerId,
    status: message.status,
    trimId: message.storeId ?? (message.id != null ? String(message.id) : ''),
  };
}

/** Fair trim for MeshCore `ChatMessage` arrays (runtime hydration and channel clear). */
export function trimMeshcoreChatMessages<T extends ChatMessage>(messages: readonly T[]): T[] {
  const trimmed = trimMeshcoreMemoryWindow(messages, meshcoreChatMessageWindowFields);
  return trimmed as T[];
}
