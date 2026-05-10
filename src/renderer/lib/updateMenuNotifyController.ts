import type { UpdateCheckingPayload } from '@/shared/electron-api.types';

import {
  type MenuUpdateSettledKind,
  titlesForMenuUpdateSettled,
  type UpdateMenuNotifyTranslate,
} from './updateMenuNotifications';

/**
 * Encapsulates menu-driven “check for updates” OS notification gating (mirrors App.tsx).
 * Failure point: notifyShow rejects — caller should catch (e.g. OS notifications disabled).
 */
export function createUpdateMenuNotifyController(
  t: UpdateMenuNotifyTranslate,
  notifyShow: (title: string, body: string) => Promise<void>,
) {
  let pendingMenuUpdateNotify = false;

  return {
    onChecking(payload?: UpdateCheckingPayload) {
      if (payload?.notifyOnSettled === true) {
        pendingMenuUpdateNotify = true;
      }
    },
    flushSettled(kind: MenuUpdateSettledKind, extras?: { version?: string; message?: string }) {
      if (!pendingMenuUpdateNotify) return;
      pendingMenuUpdateNotify = false;
      const { title, body } = titlesForMenuUpdateSettled(kind, t, extras);
      void notifyShow(title, body).catch(() => {
        // catch-no-log-ok OS notification may be disabled or unsupported
      });
    },
  };
}
