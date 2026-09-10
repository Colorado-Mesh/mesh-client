export interface UnreadAppBadgeHost {
  platform: NodeJS.Platform;
  initializeNotifications: () => void;
  suppressDockBadge: () => boolean;
  setDockBadge: (text: string) => void;
  setLauncherBadge: (count: number) => void;
  setTaskbarBadge: (count: number) => void;
}

/** Apply unread counts through each platform's native app-icon badge API. */
export function updateUnreadAppBadge(count: number, host: UnreadAppBadgeHost): void {
  if (host.platform === 'darwin') {
    if (count > 0) host.initializeNotifications();
    if (!host.suppressDockBadge()) {
      host.setDockBadge(count > 0 ? String(count) : '');
    }
  } else if (host.platform === 'linux') {
    host.setLauncherBadge(count);
  } else if (host.platform === 'win32') {
    host.setTaskbarBadge(count);
  }
}
