// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  chatNotificationTag,
  DESKTOP_NOTIFICATION_BODY_MAX_CHARS,
  fireNotification,
  showChatDesktopNotification,
} from './desktopNotification';

interface FakeNotification {
  title: string;
  options: NotificationOptions;
  onclick: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
}

function installNotification(permission: NotificationPermission, requestResult = permission) {
  const created: FakeNotification[] = [];
  const Ctor = vi.fn(function (
    this: FakeNotification,
    title: string,
    options: NotificationOptions,
  ) {
    this.title = title;
    this.options = options;
    this.onclick = null;
    this.close = vi.fn();
    created.push(this);
  }) as unknown as typeof Notification & { permission: NotificationPermission };
  Object.assign(Ctor, {
    permission,
    requestPermission: vi.fn(() => Promise.resolve(requestResult)),
  });
  vi.stubGlobal('Notification', Ctor);
  return { Ctor, created };
}

describe('showChatDesktopNotification', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a silent, tagged notification with sanitized, capped text', () => {
    const { created } = installNotification('granted');
    showChatDesktopNotification({
      title: 'DM from \u0007Alpha',
      body: `line\u0000${'x'.repeat(500)}`,
      tag: 'meshtastic:dm:7',
    });
    expect(created).toHaveLength(1);
    const n = created[0];
    expect(n.title).toBe('DM from Alpha');
    expect(n.options.silent).toBe(true);
    expect(n.options.tag).toBe('meshtastic:dm:7');
    expect(n.options.body).not.toContain('\u0000');
    expect(n.options.body?.length).toBeLessThanOrEqual(DESKTOP_NOTIFICATION_BODY_MAX_CHARS + 1);
  });

  it('closes the notification and runs onClick when clicked', () => {
    const { created } = installNotification('granted');
    const onClick = vi.fn();
    showChatDesktopNotification({ title: 't', body: 'b', tag: 'x', onClick });
    created[0]?.onclick?.();
    expect(created[0]?.close).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('requests permission once when undecided and shows on grant', async () => {
    const { Ctor, created } = installNotification('default', 'granted');
    showChatDesktopNotification({ title: 't', body: 'b', tag: 'x' });
    await vi.waitFor(() => {
      expect(created).toHaveLength(1);
    });
    expect(Ctor.requestPermission).toHaveBeenCalledOnce();
  });

  it('does nothing when permission is denied', () => {
    const { Ctor, created } = installNotification('denied');
    showChatDesktopNotification({ title: 't', body: 'b', tag: 'x' });
    expect(created).toHaveLength(0);
    expect(Ctor.requestPermission).not.toHaveBeenCalled();
  });
});

describe('fireNotification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps node/ops alerts audible and untagged', () => {
    const { created } = installNotification('granted');
    fireNotification('Alpha is online', 'Meshtastic');
    expect(created[0]?.options).toEqual({ body: 'Meshtastic', silent: false });
  });
});

describe('chatNotificationTag', () => {
  it('scopes the tag per protocol and conversation', () => {
    expect(chatNotificationTag('meshcore', 'ch:2')).toBe('meshcore:ch:2');
  });
});
