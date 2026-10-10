import { isMeshcoreRoomChatMessage } from '@/renderer/hooks/meshcore/meshcoreHookPreamble';
import type { ChatNotificationType } from '@/renderer/lib/chatNotifications';
import { isMecpMessage, type Severity, tryParseMecp } from '@/renderer/lib/mecp/mecpMessages';
import {
  clampReadWatermarkMs,
  effectiveMessageTimestampMs,
  isUnreasonablyFutureMessageTimestampMs,
} from '@/renderer/lib/nodeStatus';
import {
  findMeshtasticParentMessageForReply,
  findParentMessageForReply,
} from '@/renderer/lib/replyPreview';
import { reactionParentKeyFromChatMessage } from '@/renderer/lib/storeRecordAdapters';
import type { ChatMessage, MeshProtocol } from '@/renderer/lib/types';
import { isHiddenWeatherPost } from '@/renderer/stores/weatherFilterStore';
import { isMeshtasticBroadcastNodeNum } from '@/shared/nodeNameUtils';

/** Chat rows used for unread badges (excludes tapbacks and MeshCore room-server traffic). */
export function filterRegularChatMessages(
  messages: readonly ChatMessage[],
  protocol: MeshProtocol,
): ChatMessage[] {
  const regular: ChatMessage[] = [];
  for (const msg of messages) {
    if (protocol === 'meshcore' && isMeshcoreRoomChatMessage(msg)) continue;
    if (reactionParentKeyFromChatMessage(msg) !== undefined) continue;
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
  const effectiveTo = msg.to;
  const isOwn = (id: number) => ownNodeIds.has(id);
  if (effectiveTo == null) return undefined;
  let peer: number | undefined;
  if (isOwn(msg.sender_id) && !isOwn(effectiveTo)) peer = effectiveTo;
  else if (isOwn(effectiveTo) && !isOwn(msg.sender_id)) peer = msg.sender_id;
  if (
    peer === undefined &&
    protocol === 'meshcore' &&
    msg.channel === -1 &&
    msg.sender_id > 0 &&
    !isOwn(msg.sender_id)
  ) {
    peer = msg.sender_id;
  }
  if (peer === undefined) return undefined;
  if (protocol === 'meshtastic' && isMeshtasticBroadcastNodeNum(peer)) return undefined;
  const peerU32 = peer >>> 0;
  if (options?.excludeDmPeer?.(peerU32)) return undefined;
  return peerU32;
}

/** Channel index when `msg` counts as unread broadcast traffic, else undefined. */
function unreadChannelIndex(
  msg: ChatMessage,
  persistedLastRead: Readonly<Record<string, number>>,
  ownNodeIds: ReadonlySet<number>,
  protocol: MeshProtocol,
  nowMs: number,
  channelOptions?: ChatUnreadChannelOptions,
): number | undefined {
  const configured = channelOptions?.configuredChannelIndices;
  if (ownNodeIds.has(msg.sender_id)) return undefined;
  if (msg.to) return undefined;
  if (msg.channel < 0) return undefined;
  if (configured && configured.size > 0 && !configured.has(msg.channel)) return undefined;
  if (msg.isHistory) return undefined;
  if (isUnreasonablyFutureMessageTimestampMs(msg.timestamp, nowMs)) return undefined;
  if (isHiddenWeatherPost(msg, protocol)) return undefined;
  const lastRead = clampReadWatermarkMs(persistedLastRead[`ch:${msg.channel}`] ?? 0, nowMs);
  return effectiveMessageTimestampMs(msg.timestamp, nowMs) > lastRead ? msg.channel : undefined;
}

/** DM peer when `msg` counts as unread direct traffic, else undefined. */
function unreadDmPeer(
  msg: ChatMessage,
  persistedLastRead: Readonly<Record<string, number>>,
  ownNodeIds: ReadonlySet<number>,
  protocol: MeshProtocol,
  nowMs: number,
  options?: ChatUnreadDmOptions,
): number | undefined {
  if (msg.isHistory) return undefined;
  const peer = resolveChatDmPeer(msg, ownNodeIds, protocol, options);
  if (peer == null) return undefined;
  if (ownNodeIds.has(msg.sender_id)) return undefined;
  if (isUnreasonablyFutureMessageTimestampMs(msg.timestamp, nowMs)) return undefined;
  const lr = clampReadWatermarkMs(persistedLastRead[`dm:${peer}`] ?? 0, nowMs);
  return effectiveMessageTimestampMs(msg.timestamp, nowMs) > lr ? peer : undefined;
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
  const regular = filterRegularChatMessages(messages, protocol);
  for (const msg of regular) {
    const ch = unreadChannelIndex(
      msg,
      persistedLastRead,
      ownNodeIds,
      protocol,
      nowMs,
      channelOptions,
    );
    if (ch !== undefined) counts.set(ch, (counts.get(ch) ?? 0) + 1);
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
    const peer = unreadDmPeer(msg, persistedLastRead, ownNodeIds, protocol, nowMs, options);
    if (peer !== undefined) counts.set(peer, (counts.get(peer) ?? 0) + 1);
  }
  return counts;
}

export interface UnreadMecpSeverityByView {
  channels: Map<number, Severity>;
  dms: Map<number, Severity>;
}

/**
 * Most severe unread MECP per channel index / DM peer (lowest severity number wins).
 * Uses the same unread rules as the count badges so the marker clears with them.
 */
export function computeUnreadMecpSeverityByView(
  messages: readonly ChatMessage[],
  persistedLastRead: Readonly<Record<string, number>>,
  ownNodeIds: ReadonlySet<number>,
  protocol: MeshProtocol,
  dmOptions?: ChatUnreadDmOptions,
  channelOptions?: ChatUnreadChannelOptions,
  nowMs = Date.now(),
): UnreadMecpSeverityByView {
  const channels = new Map<number, Severity>();
  const dms = new Map<number, Severity>();
  const keepMostSevere = (map: Map<number, Severity>, key: number, severity: Severity) => {
    const prev = map.get(key);
    if (prev === undefined || severity < prev) map.set(key, severity);
  };
  for (const msg of filterRegularChatMessages(messages, protocol)) {
    if (!isMecpMessage(msg.payload)) continue;
    const severity = tryParseMecp(msg.payload)?.severity;
    if (severity == null) continue;
    const peer = unreadDmPeer(msg, persistedLastRead, ownNodeIds, protocol, nowMs, dmOptions);
    if (peer !== undefined) {
      keepMostSevere(dms, peer, severity);
      continue;
    }
    const ch = unreadChannelIndex(
      msg,
      persistedLastRead,
      ownNodeIds,
      protocol,
      nowMs,
      channelOptions,
    );
    if (ch !== undefined) keepMostSevere(channels, ch, severity);
  }
  return { channels, dms };
}

/** Most severe value among `keys` (lowest number), or null. */
export function mostSevereMecp(
  bySlot: ReadonlyMap<number, Severity>,
  keys: Iterable<number>,
): Severity | null {
  let best: Severity | null = null;
  for (const k of keys) {
    const s = bySlot.get(k);
    if (s !== undefined && (best === null || s < best)) best = s;
  }
  return best;
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
  for (const n of channel.values()) total += n;
  for (const n of dm.values()) total += n;
  return total;
}

/** Unread counts for the top protocol switcher. */
export function buildProtocolSwitcherUnreadByProtocol(
  meshtasticChatUnread: number,
  meshcoreChatUnread: number,
): Record<MeshProtocol, number> {
  return {
    meshtastic: meshtasticChatUnread,
    meshcore: meshcoreChatUnread,
  };
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
  // MECP tones are owned by useMecpAlertWatcher — not selected here
  mecp: -1,
  mecpSafety: -1,
  mecpSiren: -1,
  mecpEas: -1,
  // Operational alerts are not message-driven
  connectionLost: -1,
  batteryLow: -1,
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
  // MECP siren/tone owned by triggerMecpAlert (watcher + focused ChatPanel) — never channel/dm beep
  if (isMecpMessage(msg.payload)) return null;

  const peer = resolveChatDmPeer(msg, ownNodeIds, protocol, dmOptions);
  // Hidden weather posts never reach a visible channel view, so they must not beep either.
  if (peer == null && isHiddenWeatherPost(msg, protocol)) return null;

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

  if (peer != null) return 'dm';

  return 'channel';
}

export interface AudibleChatNotification {
  type: ChatNotificationType;
  /** Newest message at the winning priority — drives the OS notification preview and click target. */
  message: ChatMessage;
  /** `dm:<peer>` or `ch:<index>` (same key space as muted views). */
  viewKey: string;
}

export function pickAudibleNotification(
  messages: readonly ChatMessage[],
  protocol: MeshProtocol,
  mutedViews: ReadonlySet<string>,
  ownNodeIds: ReadonlySet<number>,
  dmOptions?: ChatUnreadDmOptions,
  allMessages?: readonly ChatMessage[],
): AudibleChatNotification | null {
  let best: AudibleChatNotification | null = null;
  let highestPriority = -1;
  const lookupMessages = allMessages ?? messages;

  const regular = filterRegularChatMessages(messages, protocol);
  for (const msg of regular) {
    if (ownNodeIds.has(msg.sender_id)) continue;
    if (msg.isHistory) continue;
    const viewKey = chatViewKeyForMessage(msg, protocol, ownNodeIds, dmOptions);
    if (mutedViews.has(viewKey)) continue;

    const type = resolveChatNotificationType(msg, lookupMessages, ownNodeIds, protocol, dmOptions);
    if (type == null) continue;

    const priority = NOTIFICATION_TYPE_PRIORITY[type];
    if (priority >= highestPriority) {
      highestPriority = priority;
      best = { type, message: msg, viewKey };
    }
  }

  return best;
}

export function pickAudibleNotificationType(
  messages: readonly ChatMessage[],
  protocol: MeshProtocol,
  mutedViews: ReadonlySet<string>,
  ownNodeIds: ReadonlySet<number>,
  dmOptions?: ChatUnreadDmOptions,
  allMessages?: readonly ChatMessage[],
): ChatNotificationType | null {
  return (
    pickAudibleNotification(messages, protocol, mutedViews, ownNodeIds, dmOptions, allMessages)
      ?.type ?? null
  );
}
