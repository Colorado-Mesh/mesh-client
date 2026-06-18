import type { ChatNotificationType } from '@/renderer/lib/chatNotifications';
import {
  type ChatUnreadDmOptions,
  filterRegularChatMessages,
  pickAudibleNotificationType,
} from '@/renderer/lib/chatUnreadCounts';
import type { ChatMessage, MeshProtocol } from '@/renderer/lib/types';

export const CHAT_NOTIF_MUTED_STORAGE_KEY = 'mesh-client:notifMuted';

function filterInactiveNotificationMessages(
  newMessages: readonly ChatMessage[],
  protocol: MeshProtocol,
  ownSenderId: number,
): ChatMessage[] {
  const base =
    protocol === 'meshcore' ? filterRegularChatMessages(newMessages, protocol) : [...newMessages];
  return base.filter((m) => m.sender_id !== ownSenderId && !m.emoji && !m.isHistory);
}

export interface ResolveInactiveChatNotificationTypeArgs {
  newMessages: readonly ChatMessage[];
  allMessages: readonly ChatMessage[];
  protocol: MeshProtocol;
  ownNodeIds: ReadonlySet<number>;
  ownSenderId: number;
  mutedViews: ReadonlySet<string>;
  notifGloballyMuted: boolean;
  dmOptions?: ChatUnreadDmOptions;
}

/** Pick notification sound type for chat traffic while App chat panel is inactive or hidden. */
export function resolveInactiveChatNotificationType(
  args: ResolveInactiveChatNotificationTypeArgs,
): ChatNotificationType | null {
  if (args.notifGloballyMuted) return null;

  const realNew = filterInactiveNotificationMessages(
    args.newMessages,
    args.protocol,
    args.ownSenderId,
  );
  if (realNew.length === 0) return null;

  return pickAudibleNotificationType(
    realNew,
    args.protocol,
    args.mutedViews,
    args.ownNodeIds,
    args.dmOptions,
    args.allMessages,
  );
}
