import type { ChatNotificationType } from '@/renderer/lib/chatNotifications';
import { classifyRrcNotificationType, isRrcRoomMuted } from '@/renderer/lib/rrcMention';
import type { RrcChatMessage } from '@/shared/rrc-types';

export interface ResolveInactiveRrcNotificationTypeArgs {
  newMessages: readonly RrcChatMessage[];
  nickname: string;
  hubDestHash: string | null;
  mutedViews: ReadonlySet<string>;
  notifGloballyMuted: boolean;
  localIdentityHash: string | null;
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
 * Priority: dm (whisper / @nick) over channel.
 */
export function resolveInactiveRrcNotificationType(
  args: ResolveInactiveRrcNotificationTypeArgs,
): ChatNotificationType | null {
  if (args.notifGloballyMuted) return null;

  let best: ChatNotificationType | null = null;
  for (const msg of args.newMessages) {
    if (isSelfRrcMessage(msg, args.localIdentityHash, args.nickname)) continue;
    if (args.hubDestHash) {
      const room = msg.room.trim() || '[hub]';
      if (isRrcRoomMuted(args.hubDestHash, room, args.mutedViews)) continue;
    }
    const type = classifyRrcNotificationType(msg, args.nickname);
    if (!type) continue;
    if (type === 'dm') return 'dm';
    best = best ?? type;
  }
  return best;
}
