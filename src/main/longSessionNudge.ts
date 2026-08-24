/**
 * Long-session Noble BLE restart OS cues (macOS notification + Dock badge, Windows flash).
 * Extracted for unit tests; wired from index.ts IPC handlers.
 */

import type { LongSessionRestartPayload } from '../shared/electron-api.types';

export type { LongSessionRestartPayload };

export const LONG_SESSION_DOCK_BADGE = '↻';

export interface LongSessionNudgeHost {
  platform: NodeJS.Platform;
  isNotificationSupported: () => boolean;
  createNotification: (opts: {
    title: string;
    body: string;
    silent: boolean;
    actions?: { text: string; type: 'button' }[];
    closeButtonText?: string;
  }) => {
    on: (event: 'action' | 'click', listener: (...args: unknown[]) => void) => unknown;
    show: () => void;
    close: () => void;
  };
  setDockBadge: (badge: string) => void;
  flashFrame: (flash: boolean) => void;
  showAndFocusMainWindow: () => void;
  relaunchApp: () => void;
  getLastUnreadCount: () => number;
  logWarn: (message: string) => void;
}

export interface LongSessionNudgeController {
  show: (payload: LongSessionRestartPayload) => void;
  clear: () => void;
  isActive: () => boolean;
  /** Call from set-tray-unread dock path — returns true if caller should skip writing unread badge. */
  shouldSuppressUnreadDockBadge: () => boolean;
  /** Windows: stop flash when the window is focused while nudge is active. */
  onMainWindowFocus: () => void;
}

function sanitizePayload(raw: unknown): LongSessionRestartPayload | null {
  const p = (raw ?? {}) as Record<string, unknown>;
  const title = typeof p.title === 'string' ? p.title.slice(0, 128) : '';
  const body = typeof p.body === 'string' ? p.body.slice(0, 512) : '';
  const restartLabel = typeof p.restartLabel === 'string' ? p.restartLabel.slice(0, 32) : '';
  const laterLabel = typeof p.laterLabel === 'string' ? p.laterLabel.slice(0, 32) : '';
  if (!title) return null;
  return { title, body, restartLabel, laterLabel };
}

export function parseLongSessionRestartPayload(raw: unknown): LongSessionRestartPayload | null {
  return sanitizePayload(raw);
}

export function createLongSessionNudgeController(
  host: LongSessionNudgeHost,
): LongSessionNudgeController {
  let active = false;
  let activeNotification: { close: () => void } | null = null;

  const clearOsCues = (): void => {
    if (activeNotification) {
      try {
        activeNotification.close();
      } catch {
        // catch-no-log-ok notification may already be dismissed
      }
      activeNotification = null;
    }
    if (host.platform === 'darwin') {
      try {
        const n = host.getLastUnreadCount();
        host.setDockBadge(n > 0 ? String(n) : '');
      } catch {
        // catch-no-log-ok Dock badge restore is best-effort
      }
    }
    if (host.platform === 'win32') {
      try {
        host.flashFrame(false);
      } catch {
        // catch-no-log-ok flashFrame clear is best-effort
      }
    }
  };

  return {
    isActive: () => active,
    shouldSuppressUnreadDockBadge: () => active && host.platform === 'darwin',
    onMainWindowFocus: () => {
      if (!active || host.platform !== 'win32') return;
      try {
        host.flashFrame(false);
      } catch {
        // catch-no-log-ok flashFrame clear on focus is best-effort
      }
    },
    clear: () => {
      clearOsCues();
      active = false;
    },
    show: (payload: LongSessionRestartPayload) => {
      if (active) return;
      active = true;
      const isMac = host.platform === 'darwin';
      const isWin = host.platform === 'win32';

      try {
        if (host.isNotificationSupported()) {
          const hasActions = isMac && payload.restartLabel.length > 0;
          const note = host.createNotification({
            title: payload.title,
            body: payload.body,
            silent: false,
            ...(hasActions
              ? {
                  actions: [{ text: payload.restartLabel, type: 'button' as const }],
                  ...(payload.laterLabel ? { closeButtonText: payload.laterLabel } : {}),
                }
              : {}),
          });
          activeNotification = note;
          if (hasActions) {
            note.on('action', (_e, index) => {
              if (index === 0) {
                clearOsCues();
                active = false;
                host.relaunchApp();
              }
            });
          }
          note.on('click', () => {
            host.showAndFocusMainWindow();
          });
          note.show();
        }
      } catch (e) {
        // catch-no-log-ok routed via host.logWarn → console.warn in main
        host.logWarn(
          `[IPC] notify:longSessionRestart notification failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }

      if (isMac) {
        try {
          host.setDockBadge(LONG_SESSION_DOCK_BADGE);
        } catch {
          // catch-no-log-ok Dock badge set is best-effort
        }
      }
      if (isWin) {
        try {
          host.flashFrame(true);
        } catch {
          // catch-no-log-ok flashFrame start is best-effort
        }
      }
    },
  };
}
