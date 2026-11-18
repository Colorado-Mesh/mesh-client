import type { ChatNotificationType } from '@/renderer/lib/chatNotifications';
import { isRrcRoomMuted, resolveRrcAlertType, type RrcNotifyMode } from '@/renderer/lib/rrcMention';
import type { RrcChatMessage } from '@/shared/rrc-types';

import { getChatNotificationMode } from './chatNotificationPolicy';
import { compareChatReceiveOrder } from './chatReceiveOrder';

export interface ResolveInactiveRrcNotificationTypeArgs {
  newMessages: readonly RrcChatMessage[];
  nickname: string;
  hubDestHash: string | null;
  mutedViews: ReadonlySet<string>;
  notifGloballyMuted: boolean;
  localIdentityHash: string | null;
  /** App toggle (or effective per-room mode): all chat lines vs IRC-style mention/DM. */
  notifyMode: RrcNotifyMode;
}

function isSelfRrcMessage(
  msg: RrcChatMessage,
  localIdentityHash: string | null,
  nickname: string,
): boolean {
  if (localIdentityHash && msg.sender_hash?.toLowerCase() === localIdentityHash.toLowerCase()) {
    return true;
  }
  return Boolean(msg.nickname && msg.nickname === nickname && !msg.sender_hash);
}

/**
 * Pick notification sound type for RRC traffic while the RRC panel is inactive or hidden.
 * Priority: dm (whisper / @nick) over channel. `notifyMode: 'mentions'` drops channel.
 */
export function resolveInactiveRrcNotificationType(
  args: ResolveInactiveRrcNotificationTypeArgs,
): ChatNotificationType | null {
  return resolveInactiveRrcNotification(args)?.type ?? null;
}

export interface RrcNotification {
  type: ChatNotificationType;
  message: RrcChatMessage;
  /** Trimmed room name, `[hub]` for hub-level lines. */
  room: string;
}

/**
 * The `count` lines that reached this app last, oldest first. A line's `timestamp` is its
 * sender's clock, so "newest" goes by arrival (`chatReceiveOrder.ts`). A line without a receipt
 * was saved before receipt times were kept, so it came before every line that has one, whatever
 * its sender's clock says.
 */
export function newestRrcMessagesByArrival(
  messages: readonly RrcChatMessage[],
  count: number,
): RrcChatMessage[] {
  if (count <= 0) return [];
  return [...messages]
    .sort(
      (a, b) =>
        Number(a.receivedAt != null) - Number(b.receivedAt != null) ||
        compareChatReceiveOrder(a, b),
    )
    .slice(-count);
}

/** Same priority as {@link resolveInactiveRrcNotificationType}, plus the triggering line. */
export function resolveInactiveRrcNotification(
  args: ResolveInactiveRrcNotificationTypeArgs,
): RrcNotification | null {
  if (args.notifGloballyMuted) return null;

  let best: RrcNotification | null = null;
  for (const msg of args.newMessages) {
    if (isSelfRrcMessage(msg, args.localIdentityHash, args.nickname)) continue;
    const room = msg.room.trim() || '[hub]';
    const muted = args.hubDestHash
      ? isRrcRoomMuted(args.hubDestHash, room, args.mutedViews)
      : false;
    const type = resolveRrcAlertType({
      msg,
      nickname: args.nickname,
      notifyMode: getChatNotificationMode() === 'mentions' ? 'mentions' : args.notifyMode,
      muted,
    });
    if (!type) continue;
    if (type === 'dm') return { type, message: msg, room };
    best = best ?? { type, message: msg, room };
  }
  return best;
}
