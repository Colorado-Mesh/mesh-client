import { describe, expect, it, vi } from 'vitest';

import { type UnreadAppBadgeHost, updateUnreadAppBadge } from './unreadAppBadge';

function createHost(platform: NodeJS.Platform): UnreadAppBadgeHost {
  return {
    platform,
    initializeNotifications: vi.fn(),
    suppressDockBadge: vi.fn().mockReturnValue(false),
    setDockBadge: vi.fn(),
    setLauncherBadge: vi.fn(),
    setTaskbarBadge: vi.fn(),
  };
}

describe('updateUnreadAppBadge', () => {
  it.each(['darwin', 'linux', 'win32'] as const)(
    'sets and clears the native unread badge on %s',
    (platform) => {
      const host = createHost(platform);
      updateUnreadAppBadge(3, host);
      updateUnreadAppBadge(0, host);

      if (platform === 'darwin') {
        expect(host.initializeNotifications).toHaveBeenCalledTimes(1);
        expect(host.setDockBadge).toHaveBeenNthCalledWith(1, '3');
        expect(host.setDockBadge).toHaveBeenNthCalledWith(2, '');
      } else {
        expect(host.initializeNotifications).not.toHaveBeenCalled();
        expect(host.setDockBadge).not.toHaveBeenCalled();
      }
      for (const [target, setter] of [
        ['linux', host.setLauncherBadge],
        ['win32', host.setTaskbarBadge],
      ] as const) {
        if (platform === target) {
          expect(setter).toHaveBeenNthCalledWith(1, 3);
          expect(setter).toHaveBeenNthCalledWith(2, 0);
        } else {
          expect(setter).not.toHaveBeenCalled();
        }
      }
    },
  );

  it('initializes macOS notification authorization before setting the Dock badge', () => {
    const host = createHost('darwin');
    const calls: string[] = [];
    host.initializeNotifications = () => {
      calls.push('authorize');
    };
    host.setDockBadge = (text) => {
      calls.push(text);
    };
    updateUnreadAppBadge(7, host);
    expect(calls).toEqual(['authorize', '7']);
  });

  it('reapplies the current count after focus returns from notification settings', () => {
    const host = createHost('darwin');
    updateUnreadAppBadge(2, host);
    updateUnreadAppBadge(2, host);
    updateUnreadAppBadge(1, host);
    expect(host.setDockBadge).toHaveBeenNthCalledWith(1, '2');
    expect(host.setDockBadge).toHaveBeenNthCalledWith(2, '2');
    expect(host.setDockBadge).toHaveBeenNthCalledWith(3, '1');
  });

  it('preserves the restart nudge until it is dismissed', () => {
    const host = createHost('darwin');
    vi.mocked(host.suppressDockBadge).mockReturnValue(true);
    updateUnreadAppBadge(4, host);
    expect(host.setDockBadge).not.toHaveBeenCalled();
    vi.mocked(host.suppressDockBadge).mockReturnValue(false);
    updateUnreadAppBadge(4, host);
    expect(host.setDockBadge).toHaveBeenCalledWith('4');
  });
});
