import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ALERTS_CHANNEL,
  createMobileNotifications,
  type LocalNotificationsApi,
  MESSAGES_CHANNEL,
  notificationIdForTag,
} from './webNotifications';

function fakePlugin(display = 'granted') {
  const ln = {
    checkPermissions: vi.fn<LocalNotificationsApi['checkPermissions']>(() =>
      Promise.resolve({ display }),
    ),
    requestPermissions: vi.fn<LocalNotificationsApi['requestPermissions']>(() =>
      Promise.resolve({ display }),
    ),
    schedule: vi.fn<LocalNotificationsApi['schedule']>(() => Promise.resolve({})),
    cancel: vi.fn<LocalNotificationsApi['cancel']>(() => Promise.resolve()),
    addListener: vi.fn<LocalNotificationsApi['addListener']>(() => Promise.resolve({})),
  } satisfies LocalNotificationsApi;
  return ln;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mobile Notification stand-in', () => {
  it('posts a chat notification on the silent Messages channel with a stable id per tag', async () => {
    const ln = fakePlugin();
    const kit = createMobileNotifications(ln);
    kit.setPermission('granted');
    new kit.Notification('Message from bea7', {
      body: 'hello',
      tag: 'meshtastic:ch:0',
      silent: true,
    });
    new kit.Notification('Message from bea7', {
      body: 'again',
      tag: 'meshtastic:ch:0',
      silent: true,
    });
    await Promise.resolve();
    const calls = ln.schedule.mock.calls.map((c) => c[0].notifications[0]);
    expect(calls).toHaveLength(2);
    // Same tag, same id: the second replaces the first, like a tag on desktop.
    expect(calls[0]?.id).toBe(calls[1]?.id);
    expect(calls[0]?.id).toBe(notificationIdForTag('meshtastic:ch:0'));
    expect(calls[1]).toMatchObject({
      title: 'Message from bea7',
      body: 'again',
      channelId: MESSAGES_CHANNEL,
      // Shown at once: an exact alarm would send Android 12+ users to a permission page.
      isExactNotification: false,
    });
  });

  it('puts notifications that are not silent on the Alerts channel', () => {
    const ln = fakePlugin();
    const kit = createMobileNotifications(ln);
    kit.setPermission('granted');
    new kit.Notification('Node offline', { body: 'bea7' });
    expect(ln.schedule.mock.calls[0]?.[0].notifications[0]?.channelId).toBe(ALERTS_CHANNEL);
  });

  it('posts nothing until permission is granted, and reports the decision', async () => {
    const ln = fakePlugin('denied');
    const kit = createMobileNotifications(ln);
    expect(kit.Notification.permission).toBe('default');
    new kit.Notification('x', { body: 'y' });
    expect(ln.schedule).not.toHaveBeenCalled();
    await expect(kit.Notification.requestPermission()).resolves.toBe('denied');
    expect(kit.Notification.permission).toBe('denied');
  });

  it('runs the renderer onclick when the notification is tapped, once', () => {
    const ln = fakePlugin();
    const kit = createMobileNotifications(ln);
    kit.setPermission('granted');
    const n = new kit.Notification('Message', { tag: 'meshcore:dm:abc', silent: true });
    const onclick = vi.fn();
    n.onclick = onclick;
    const id = ln.schedule.mock.calls[0]?.[0].notifications[0]?.id ?? -1;
    kit.activate(id);
    kit.activate(id);
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it('close() cancels the notification after its post finishes, so it cannot overtake it', async () => {
    const ln = fakePlugin();
    const order: string[] = [];
    let finishPost: () => void = () => {};
    ln.schedule.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPost = () => {
            order.push('posted');
            resolve({});
          };
        }),
    );
    ln.cancel.mockImplementation(() => {
      order.push('cancelled');
      return Promise.resolve();
    });
    const kit = createMobileNotifications(ln);
    kit.setPermission('granted');
    const n = new kit.Notification('Message', { tag: 'rrc:hub:room', silent: true });
    n.close();
    await Promise.resolve();
    expect(order).toEqual([]);
    finishPost();
    await vi.waitFor(() => {
      expect(order).toEqual(['posted', 'cancelled']);
    });
    expect(ln.cancel).toHaveBeenCalledWith({
      notifications: [{ id: notificationIdForTag('rrc:hub:room') }],
    });
  });

  it('keeps ids in [2^30, 2^31), clear of the foreground service notification', () => {
    for (const tag of ['', 'a', 'meshtastic:ch:0', 'x'.repeat(500)]) {
      const id = notificationIdForTag(tag);
      expect(id).toBeGreaterThanOrEqual(2 ** 30);
      expect(id).toBeLessThan(2 ** 31);
    }
  });
});
