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
import { normalizeReticulumNodeId, reticulumHashToNodeId } from '@/renderer/lib/reticulum/destHash';
import { canonicalizeReticulumChatDmNodeId } from '@/renderer/lib/reticulum/resolveReticulumChatLxmfDest';
import { reticulumUnsetDmTo } from '@/renderer/lib/reticulum/reticulumChatDmFilter';
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
  msg: Pick<ChatMessage, 'channel' | 'to' | 'sender_id' | 'reticulum_sender_hash'>,
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
      const peerU32 = canonicalizeReticulumChatDmNodeId(senderId);
      if (options?.excludeDmPeer?.(peerU32)) return undefined;
      return peerU32;
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
      const peerU32 = canonicalizeReticulumChatDmNodeId(msg.sender_id >>> 0);
      if (options?.excludeDmPeer?.(peerU32)) return undefined;
      return peerU32;
    }
    return undefined;
  }
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
  if (peer === undefined && protocol === 'reticulum') {
    const fromU = msg.sender_id >>> 0;
    const toU = effectiveTo >>> 0;
    const isOwnU32 = (id: number) => {
      for (const own of ownNodeIds) {
        if (normalizeReticulumNodeId(own) === normalizeReticulumNodeId(id)) return true;
      }
      return false;
    };
    if (msg.reticulum_sender_hash && fromU !== toU) {
      const senderFromHash = reticulumHashToNodeId(msg.reticulum_sender_hash) >>> 0;
      // Prefer the hash-backed sender as the peer. When own is still unknown, treating `to`
      // as the peer opens a sticky self-DM on launch (inbound hydrate before identity).
      if (senderFromHash === fromU) {
        if (!isOwnU32(fromU)) {
          peer = fromU;
        } else if (!isOwnU32(toU)) {
          peer = toU;
        }
      } else if (!isOwnU32(fromU)) {
        peer = fromU;
      }
    } else if (fromU > 0 && !isOwnU32(fromU)) {
      peer = fromU;
    } else if (toU > 0 && !isOwnU32(toU)) {
      peer = toU;
    }
  }
  if (peer === undefined) return undefined;
  if (protocol === 'meshtastic' && isMeshtasticBroadcastNodeNum(peer)) return undefined;
  let peerU32 = peer >>> 0;
  if (protocol === 'reticulum') {
    peerU32 = canonicalizeReticulumChatDmNodeId(peerU32);
  }
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
  ownNodeIds: ReadonlySet<number>,
): number {
  if (!connectionStatus || !RETICULUM_OPERATIONAL_STATUSES.has(connectionStatus)) return 0;
  if (messages.length === 0) return 0;
  return totalUnreadCount(messages, persistedLastRead, ownNodeIds, 'reticulum');
}

/**
 * Unread counts for the top protocol switcher.
 * Reticulum includes RRC so inactive-protocol RRC traffic badges the Reticulum pill;
 * Chat sidebar must keep using chat-only totals (not this map).
 */
export function buildProtocolSwitcherUnreadByProtocol(
  meshtasticChatUnread: number,
  meshcoreChatUnread: number,
  reticulumChatUnread: number,
  rrcUnread: number,
  gamesUnread = 0,
): Record<MeshProtocol, number> {
  return {
    meshtastic: meshtasticChatUnread,
    meshcore: meshcoreChatUnread,
    reticulum: reticulumChatUnread + rrcUnread + gamesUnread,
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
