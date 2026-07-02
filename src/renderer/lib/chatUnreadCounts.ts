import { isMeshcoreRoomChatMessage } from '@/renderer/hooks/meshcore/meshcoreHookPreamble';
import type { ChatNotificationType } from '@/renderer/lib/chatNotifications';
import {
  clampReadWatermarkMs,
  effectiveMessageTimestampMs,
  isUnreasonablyFutureMessageTimestampMs,
} from '@/renderer/lib/nodeStatus';
import {
  findMeshtasticParentMessageForReply,
  findParentMessageForReply,
} from '@/renderer/lib/replyPreview';
import { normalizeReticulumNodeId, reticulumHashToNodeId } from '@/renderer/lib/reticulum/destHash';
import { reticulumUnsetDmTo } from '@/renderer/lib/reticulum/reticulumChatDmFilter';
import type { ChatMessage, MeshProtocol } from '@/renderer/lib/types';
import { isMeshtasticBroadcastNodeNum } from '@/shared/nodeNameUtils';

/** Chat rows used for unread badges (excludes tapbacks and MeshCore room-server traffic). */
export function filterRegularChatMessages(
  messages: readonly ChatMessage[],
  protocol: MeshProtocol,
): ChatMessage[] {
  const regular: ChatMessage[] = [];
  for (const msg of messages) {
    if (protocol === 'meshcore' && isMeshcoreRoomChatMessage(msg)) continue;
    if (msg.emoji && msg.replyId) continue;
    regular.push(msg);
  }
  return regular;
}

export interface ChatUnreadDmOptions {
  /** MeshCore: omit room-server node ids (BBS belongs in Rooms, not Chat DM unread). */
  excludeDmPeer?: (peer: number) => boolean;
}

/** Limit broadcast unread to channel slots visible in Chat (radio-programmed / configured). */
export interface ChatUnreadChannelOptions {
  configuredChannelIndices?: ReadonlySet<number>;
}

/** Persisted last-read / unread view key (`ch:N` or `dm:peer`). */
export function chatViewKeyForMessage(
  msg: Pick<ChatMessage, 'channel' | 'to' | 'sender_id'>,
  protocol: MeshProtocol,
  ownNodeIds: ReadonlySet<number>,
  dmOptions?: ChatUnreadDmOptions,
): string {
  const peer = resolveChatDmPeer(msg as ChatMessage, ownNodeIds, protocol, dmOptions);
  if (peer != null) return `dm:${peer}`;
  return `ch:${msg.channel}`;
}

export function resolveChatDmPeer(
  msg: ChatMessage,
  ownNodeIds: ReadonlySet<number>,
  protocol: MeshProtocol,
  options?: ChatUnreadDmOptions,
): number | undefined {
  if (protocol === 'meshcore' && isMeshcoreRoomChatMessage(msg)) return undefined;
  if (protocol === 'reticulum' && reticulumUnsetDmTo(msg.to) && msg.reticulum_sender_hash) {
    const isOwn = (id: number) => {
      const normalized = normalizeReticulumNodeId(id);
      for (const own of ownNodeIds) {
        if (normalizeReticulumNodeId(own) === normalized) return true;
      }
      return false;
    };
    const senderFromHash = Number.parseInt(
      msg.reticulum_sender_hash.replace(/[^0-9a-f]/gi, '').slice(0, 12) || '0',
      16,
    );
    const senderId = (Number.isFinite(senderFromHash) ? senderFromHash : 0) >>> 0;
    if (senderId > 0 && !isOwn(senderId) && !isOwn(msg.sender_id)) {
      return senderId;
    }
  }
  const effectiveTo = protocol === 'reticulum' && msg.to === 0 ? undefined : msg.to;
  const isOwn = (id: number) => {
    if (protocol === 'reticulum') {
      const normalized = normalizeReticulumNodeId(id);
      for (const own of ownNodeIds) {
        if (normalizeReticulumNodeId(own) === normalized) return true;
      }
      return false;
    }
    return ownNodeIds.has(id);
  };
  if (effectiveTo == null) {
    if (protocol === 'reticulum' && msg.to === 0 && msg.sender_id > 0 && !isOwn(msg.sender_id)) {
      const peerU32 = msg.sender_id >>> 0;
      if (options?.excludeDmPeer?.(peerU32)) return undefined;
      return peerU32;
    }
    return undefined;
  }
  let peer: number | undefined;
  if (isOwn(msg.sender_id) && !isOwn(effectiveTo)) peer = effectiveTo;
  else if (isOwn(effectiveTo) && !isOwn(msg.sender_id)) peer = msg.sender_id;
  if (
    peer == null &&
    protocol === 'meshcore' &&
    msg.channel === -1 &&
    msg.sender_id > 0 &&
    !isOwn(msg.sender_id)
  ) {
    peer = msg.sender_id;
  }
  if (peer == null && protocol === 'reticulum') {
    const fromU = msg.sender_id >>> 0;
    const toU = effectiveTo >>> 0;
    const isOwnU32 = (id: number) => ownNodeIds.has(id >>> 0);
    if (msg.reticulum_sender_hash && fromU !== toU) {
      const senderFromHash = reticulumHashToNodeId(msg.reticulum_sender_hash) >>> 0;
      if (senderFromHash === fromU && !isOwnU32(toU)) {
        peer = toU;
      } else if (senderFromHash === fromU && !isOwnU32(fromU)) {
        peer = fromU;
      } else if (!isOwnU32(fromU)) {
        peer = fromU;
      }
    } else if (fromU > 0 && !isOwnU32(fromU)) {
      peer = fromU;
    } else if (toU > 0 && !isOwnU32(toU)) {
      peer = toU;
    }
  }
  if (peer == null) return undefined;
  if (protocol === 'meshtastic' && isMeshtasticBroadcastNodeNum(peer)) return undefined;
  const peerU32 = peer >>> 0;
  if (options?.excludeDmPeer?.(peerU32)) return undefined;
  return peerU32;
}

export function computeChannelUnreadCounts(
  messages: readonly ChatMessage[],
  persistedLastRead: Readonly<Record<string, number>>,
  ownNodeIds: ReadonlySet<number>,
  protocol: MeshProtocol,
  nowMs = Date.now(),
  channelOptions?: ChatUnreadChannelOptions,
): Map<number, number> {
  const counts = new Map<number, number>();
  const configured = channelOptions?.configuredChannelIndices;
  const regular = filterRegularChatMessages(messages, protocol);
  for (const msg of regular) {
    if (ownNodeIds.has(msg.sender_id)) continue;
    if (msg.to) continue;
    if (msg.channel < 0) continue;
    if (configured && configured.size > 0 && !configured.has(msg.channel)) continue;
    if (msg.isHistory) continue;
    if (isUnreasonablyFutureMessageTimestampMs(msg.timestamp, nowMs)) continue;
    const viewKey = `ch:${msg.channel}`;
    const lastRead = clampReadWatermarkMs(persistedLastRead[viewKey] ?? 0, nowMs);
    const msgTs = effectiveMessageTimestampMs(msg.timestamp, nowMs);
    if (msgTs > lastRead) {
      counts.set(msg.channel, (counts.get(msg.channel) ?? 0) + 1);
    }
  }
  return counts;
}

export function computeDmUnreadCounts(
  messages: readonly ChatMessage[],
  persistedLastRead: Readonly<Record<string, number>>,
  ownNodeIds: ReadonlySet<number>,
  protocol: MeshProtocol,
  options?: ChatUnreadDmOptions,
  nowMs = Date.now(),
): Map<number, number> {
  const counts = new Map<number, number>();
  const regular = filterRegularChatMessages(messages, protocol);
  for (const msg of regular) {
    if (msg.isHistory) continue;
    const peer = resolveChatDmPeer(msg, ownNodeIds, protocol, options);
    if (peer == null) continue;
    if (ownNodeIds.has(msg.sender_id)) continue;
    if (isUnreasonablyFutureMessageTimestampMs(msg.timestamp, nowMs)) continue;
    const lr = clampReadWatermarkMs(persistedLastRead[`dm:${peer}`] ?? 0, nowMs);
    const msgTs = effectiveMessageTimestampMs(msg.timestamp, nowMs);
    if (msgTs > lr) {
      counts.set(peer, (counts.get(peer) ?? 0) + 1);
    }
  }
  return counts;
}

export function totalUnreadCount(
  messages: readonly ChatMessage[],
  persistedLastRead: Readonly<Record<string, number>>,
  ownNodeIds: ReadonlySet<number>,
  protocol: MeshProtocol,
  dmOptions?: ChatUnreadDmOptions,
  channelOptions?: ChatUnreadChannelOptions,
  nowMs = Date.now(),
): number {
  const channel = computeChannelUnreadCounts(
    messages,
    persistedLastRead,
    ownNodeIds,
    protocol,
    nowMs,
    channelOptions,
  );
  const dm = computeDmUnreadCounts(
    messages,
    persistedLastRead,
    ownNodeIds,
    protocol,
    dmOptions,
    nowMs,
  );
  let total = 0;
  // Reticulum chat is DM-only; channel-indexed rows must not inflate the badge.
  if (protocol !== 'reticulum') {
    for (const n of channel.values()) total += n;
  }
  for (const n of dm.values()) total += n;
  return total;
}

const RETICULUM_OPERATIONAL_STATUSES = new Set(['connected', 'configured', 'stale']);

/** Reticulum LXMF chat unread for sidebar/tray badges. */
export function computeReticulumChatUnread(
  messages: readonly ChatMessage[],
  connectionStatus: string | undefined,
  persistedLastRead: Readonly<Record<string, number>>,
): number {
  if (!connectionStatus || !RETICULUM_OPERATIONAL_STATUSES.has(connectionStatus)) return 0;
  if (messages.length === 0) return 0;
  return totalUnreadCount(messages, persistedLastRead, new Set(), 'reticulum');
}

/** True when at least one message maps to a view that is not per-conversation muted. */
export function hasAudibleBackgroundMessages(
  messages: readonly ChatMessage[],
  protocol: MeshProtocol,
  mutedViews: ReadonlySet<string>,
  ownNodeIds: ReadonlySet<number>,
  dmOptions?: ChatUnreadDmOptions,
): boolean {
  return messages.some(
    (m) => !mutedViews.has(chatViewKeyForMessage(m, protocol, ownNodeIds, dmOptions)),
  );
}

const NOTIFICATION_TYPE_PRIORITY: Record<ChatNotificationType, number> = {
  channel: 0,
  dm: 1,
  reply: 2,
};

export function resolveChatNotificationType(
  msg: ChatMessage,
  allMessages: readonly ChatMessage[],
  ownNodeIds: ReadonlySet<number>,
  protocol: MeshProtocol,
  dmOptions?: ChatUnreadDmOptions,
): ChatNotificationType | null {
  if (protocol === 'meshcore' && isMeshcoreRoomChatMessage(msg)) return null;
  if (msg.emoji && msg.replyId) return null;
  if (ownNodeIds.has(msg.sender_id)) return null;

  if (msg.replyId != null) {
    const parent =
      protocol === 'meshtastic'
        ? findMeshtasticParentMessageForReply(allMessages, msg.replyId, {
            replyPreviewSender: msg.replyPreviewSender,
            beforeTimestamp: msg.timestamp,
            channel: msg.channel,
            to: msg.to,
            excludeSenderId: msg.sender_id,
          })
        : findParentMessageForReply(allMessages, msg.replyId);
    if (parent && ownNodeIds.has(parent.sender_id)) return 'reply';
  }

  const peer = resolveChatDmPeer(msg, ownNodeIds, protocol, dmOptions);
  if (peer != null) return 'dm';

  return 'channel';
}

export function pickAudibleNotificationType(
  messages: readonly ChatMessage[],
  protocol: MeshProtocol,
  mutedViews: ReadonlySet<string>,
  ownNodeIds: ReadonlySet<number>,
  dmOptions?: ChatUnreadDmOptions,
  allMessages?: readonly ChatMessage[],
): ChatNotificationType | null {
  let highest: ChatNotificationType | null = null;
  let highestPriority = -1;
  const lookupMessages = allMessages ?? messages;

  const regular = filterRegularChatMessages(messages, protocol);
  for (const msg of regular) {
    if (ownNodeIds.has(msg.sender_id)) continue;
    if (msg.isHistory) continue;
    if (mutedViews.has(chatViewKeyForMessage(msg, protocol, ownNodeIds, dmOptions))) continue;

    const type = resolveChatNotificationType(msg, lookupMessages, ownNodeIds, protocol, dmOptions);
    if (type == null) continue;

    const priority = NOTIFICATION_TYPE_PRIORITY[type];
    if (priority > highestPriority) {
      highestPriority = priority;
      highest = type;
    }
  }

  return highest;
}
