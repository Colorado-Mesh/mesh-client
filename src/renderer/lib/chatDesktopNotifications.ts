import type { AudibleChatNotification } from './chatUnreadCounts';
import { chatNotificationTag, showChatDesktopNotification } from './desktopNotification';
import i18n from './i18n';
import type { MeshProtocol } from './types';

/** Where a desktop chat notification click should land. */
export interface ChatNotificationTarget {
  kind: 'chat';
  protocol: MeshProtocol;
  dmPeer: number | null;
  channel: number | null;
}

/** Map a muted-view key (`dm:<peer>` / `ch:<index>`) to a chat navigation target. */
export function chatNotificationTargetFromViewKey(
  protocol: MeshProtocol,
  viewKey: string,
): ChatNotificationTarget {
  const sep = viewKey.indexOf(':');
  const kind = sep >= 0 ? viewKey.slice(0, sep) : viewKey;
  const raw = sep >= 0 ? viewKey.slice(sep + 1) : '';
  const value = Number(raw);
  const valid = raw !== '' && Number.isFinite(value);
  return {
    kind: 'chat',
    protocol,
    dmPeer: kind === 'dm' && valid ? value : null,
    channel: kind === 'ch' && valid ? value : null,
  };
}

function openFromNotification(
  target: ChatNotificationTarget,
  onOpen: (target: ChatNotificationTarget) => void,
): void {
  window.electronAPI.app.focusWindow().catch((e: unknown) => {
    console.debug(
      '[chatDesktopNotifications] focusWindow failed',
      e instanceof Error ? e.message : String(e),
    );
  });
  onOpen(target);
}

export interface NotifyInactiveChatArgs {
  protocol: MeshProtocol;
  notification: AudibleChatNotification;
  onOpen: (target: ChatNotificationTarget) => void;
}

/** Silent OS notification for a Chat-tab message; click focuses the window and opens the view. */
export function notifyInactiveChat({
  protocol,
  notification,
  onOpen,
}: NotifyInactiveChatArgs): void {
  const { message, viewKey } = notification;
  const sender = message.sender_name || String(message.sender_id);
  const target = chatNotificationTargetFromViewKey(protocol, viewKey);
  showChatDesktopNotification({
    title:
      target.dmPeer != null
        ? i18n.t('chatPanel.notificationDmTitle', { sender })
        : i18n.t('chatPanel.notificationMessageTitle', { sender }),
    body: message.payload,
    tag: chatNotificationTag(protocol, viewKey),
    onClick: () => {
      openFromNotification(target, onOpen);
    },
  });
}
