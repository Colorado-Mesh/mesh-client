/**
 * The renderer raises OS notifications through the web Notification API: chat messages that arrive
 * while the app is in the background (`showChatDesktopNotification`) and node status / operational
 * alerts (`fireNotification`). Android's WebView and WKWebView have no Notification API, so on the
 * phone those calls returned early and nothing was shown. This installs a stand-in backed by
 * Capacitor Local Notifications:
 *
 * - A tag maps to a stable id, so a new message replaces the previous one for that conversation,
 *   the way tags work on desktop.
 * - Tapping a notification brings the app forward (native) and runs the renderer's `onclick`,
 *   which opens the conversation.
 * - `silent` keeps desktop's split: chat notifications are silent because App plays its own tone
 *   (Web Audio keeps running while the app is in the background), so they go to a silent
 *   "Messages" channel; other notifications go to an alerting "Alerts" channel.
 *
 * Android 13+ also needs the POST_NOTIFICATIONS permission at runtime. It is asked for in context,
 * when the first radio or network link goes live while the app is in front
 * (`askNotificationPermissionInContext`, called from backgroundKeeper); a background request
 * could not show its dialog.
 */
import i18n from '@/renderer/lib/i18n';

import { getPlugin } from '../bridge/nativePlugins';

export const MESSAGES_CHANNEL = 'mesh_messages';
export const ALERTS_CHANNEL = 'mesh_alerts';
const SMALL_ICON = 'ic_stat_mesh';
const MAX_LIVE = 200;

interface ScheduledNotification {
  id: number;
  title: string;
  body: string;
  smallIcon: string;
  channelId: string;
  autoCancel: boolean;
  /**
   * Always false: these show at once and need no alarm. The plugin's default (true) makes
   * Android 12+ open the "Alarms & reminders" permission page on the first notification.
   */
  isExactNotification: false;
}

interface ChannelSpec {
  id: string;
  name: string;
  importance: 1 | 2 | 3 | 4 | 5;
  visibility?: -1 | 0 | 1;
}

export interface LocalNotificationsApi {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  schedule(o: { notifications: ScheduledNotification[] }): Promise<unknown>;
  cancel(o: { notifications: { id: number }[] }): Promise<void>;
  createChannel?(c: ChannelSpec): Promise<void>;
  addListener(
    event: 'localNotificationActionPerformed',
    cb: (action: { notification: { id: number } }) => void,
  ): Promise<unknown>;
}

/** Stable id in [2^30, 2^31) for a tag: clear of the foreground-service id (4711). */
export function notificationIdForTag(tag: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 0x40000000 | ((h >>> 0) % 0x40000000);
}

function mapPermission(display: string): NotificationPermission {
  if (display === 'granted') return 'granted';
  if (display === 'denied') return 'denied';
  return 'default';
}

export interface MobileNotificationKit {
  /** The constructor installed as `window.Notification`. */
  Notification: typeof globalThis.Notification;
  setPermission(display: string): void;
  /** A notification was tapped: run that instance's `onclick`. */
  activate(id: number): void;
}

export function createMobileNotifications(ln: LocalNotificationsApi): MobileNotificationKit {
  let permission: NotificationPermission = 'default';
  let untagged = 0;
  const live = new Map<number, MobileNotification>();

  class MobileNotification {
    static get permission(): NotificationPermission {
      return permission;
    }

    static async requestPermission(): Promise<NotificationPermission> {
      try {
        permission = mapPermission((await ln.requestPermissions()).display);
      } catch (e: unknown) {
        console.debug('[mobile] notification permission request failed', e);
      }
      return permission;
    }

    readonly title: string;
    readonly body: string;
    readonly tag: string;
    readonly silent: boolean;
    onclick: ((this: MobileNotification, ev: Event) => unknown) | null = null;
    onclose: ((this: MobileNotification, ev: Event) => unknown) | null = null;
    onerror: ((this: MobileNotification, ev: Event) => unknown) | null = null;
    onshow: ((this: MobileNotification, ev: Event) => unknown) | null = null;
    readonly #id: number;
    /** Settles once the post finished (or failed); close() waits for it. */
    #posted: Promise<unknown> = Promise.resolve();

    constructor(title: string, options: NotificationOptions = {}) {
      this.title = title;
      this.body = options.body ?? '';
      this.tag = options.tag ?? '';
      this.silent = options.silent === true;
      untagged += 1;
      this.#id = notificationIdForTag(this.tag || `untagged:${Date.now()}:${untagged}`);
      live.delete(this.#id);
      live.set(this.#id, this);
      if (live.size > MAX_LIVE) {
        const oldest = live.keys().next().value;
        if (oldest !== undefined) live.delete(oldest);
      }
      if (permission !== 'granted') return;
      this.#posted = ln
        .schedule({
          notifications: [
            {
              id: this.#id,
              title: this.title,
              body: this.body,
              smallIcon: SMALL_ICON,
              channelId: this.silent ? MESSAGES_CHANNEL : ALERTS_CHANNEL,
              autoCancel: true,
              isExactNotification: false,
            },
          ],
        })
        .catch((e: unknown) => {
          console.warn(
            `mcM0024 [mobile] notification failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        });
    }

    close(): void {
      live.delete(this.#id);
      // After the post: a cancel that overtook it would leave the notification showing.
      const id = this.#id;
      void this.#posted
        .then(() => ln.cancel({ notifications: [{ id }] }))
        .catch((e: unknown) => {
          console.debug('[mobile] notification cancel failed', e);
        });
    }

    get id(): number {
      return this.#id;
    }
  }

  return {
    Notification: MobileNotification as unknown as typeof globalThis.Notification,
    setPermission(display) {
      permission = mapPermission(display);
    },
    activate(id) {
      const n = live.get(id);
      if (!n) return;
      live.delete(id);
      n.onclick?.(new Event('click'));
    },
  };
}

/**
 * Provide `window.Notification` where the WebView has none (Android, iOS). The browser harness
 * runs in Chromium, which has the real API, so this does nothing there.
 */
export async function installMobileNotifications(): Promise<void> {
  if ('Notification' in window) return;
  const ln = getPlugin('LocalNotifications') as unknown as LocalNotificationsApi;
  const kit = createMobileNotifications(ln);
  Object.defineProperty(window, 'Notification', {
    value: kit.Notification,
    configurable: true,
    writable: true,
  });
  if (typeof ln.createChannel === 'function') {
    // Android only (iOS has no channels). Importance 2 = low (no sound), 4 = high.
    const channels: ChannelSpec[] = [
      {
        id: MESSAGES_CHANNEL,
        name: i18n.t('mobile.messagesChannel'),
        importance: 2,
        visibility: 0,
      },
      { id: ALERTS_CHANNEL, name: i18n.t('mobile.alertsChannel'), importance: 4, visibility: 0 },
    ];
    for (const channel of channels) {
      await ln.createChannel(channel).catch((e: unknown) => {
        console.debug('[mobile] notification channel unavailable', e);
      });
    }
  }
  try {
    kit.setPermission((await ln.checkPermissions()).display);
  } catch (e: unknown) {
    console.debug('[mobile] notification permission check failed', e);
  }
  await ln
    .addListener('localNotificationActionPerformed', (action) => {
      kit.activate(action.notification.id);
    })
    .catch((e: unknown) => {
      console.debug('[mobile] notification tap listener unavailable', e);
    });
}

/**
 * Ask for notification permission once it is useful and its dialog can show: the first time a
 * radio or network link goes live while the app is in front. Does nothing once decided.
 */
export function askNotificationPermissionInContext(): void {
  const N = (window as { Notification?: typeof globalThis.Notification }).Notification;
  if (N?.permission !== 'default' || document.hidden) return;
  void N.requestPermission().catch((e: unknown) => {
    console.debug('[mobile] notification permission request failed', e);
  });
}
