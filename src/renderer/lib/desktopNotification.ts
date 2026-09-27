import { truncatePacketText } from './packetPayload';
import { stripControlCharacters } from './stripControlCharacters';

/** OS notification field caps (title line / body preview). */
export const DESKTOP_NOTIFICATION_TITLE_MAX_CHARS = 120;
export const DESKTOP_NOTIFICATION_BODY_MAX_CHARS = 100;

function withNotificationPermission(show: () => void): void {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    show();
  } else if (Notification.permission !== 'denied') {
    void Notification.requestPermission()
      .then((perm) => {
        if (perm === 'granted') show();
      })
      .catch(() => {
        // catch-no-log-ok: best-effort notification permission
      });
  }
}

/** Audible OS notification for node status / operational alerts (no in-app sound path). */
export function fireNotification(title: string, body: string): void {
  try {
    withNotificationPermission(() => {
      new Notification(title, { body, silent: false });
    });
  } catch {
    // catch-no-log-ok: best-effort desktop notification
  }
}

export interface ChatDesktopNotificationArgs {
  title: string;
  body: string;
  /** Same tag replaces the previous OS notification for that conversation instead of stacking. */
  tag: string;
  onClick?: () => void;
}

export function chatNotificationTag(protocol: string, conversationKey: string): string {
  return `${protocol}:${conversationKey}`;
}

/**
 * Silent OS notification for inbound chat. Silent on purpose: App.tsx owns typed Web Audio via
 * chatNotifications.ts, so sounding here would double-notify. Title/body are wire-derived, so
 * control characters are stripped and lengths capped before reaching the OS notification center.
 */
export function showChatDesktopNotification(args: ChatDesktopNotificationArgs): void {
  try {
    const title = truncatePacketText(
      stripControlCharacters(args.title),
      DESKTOP_NOTIFICATION_TITLE_MAX_CHARS,
    );
    const body = truncatePacketText(
      stripControlCharacters(args.body),
      DESKTOP_NOTIFICATION_BODY_MAX_CHARS,
    );
    withNotificationPermission(() => {
      const notification = new Notification(title, { body, tag: args.tag, silent: true });
      const { onClick } = args;
      if (onClick) {
        notification.onclick = () => {
          notification.close();
          onClick();
        };
      }
    });
  } catch (e) {
    console.debug(
      '[desktopNotification] chat notification unavailable',
      e instanceof Error ? e.message : String(e),
    );
  }
}
