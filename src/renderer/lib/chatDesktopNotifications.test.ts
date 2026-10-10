import { describe, expect, it, vi } from 'vitest';

const { showMock } = vi.hoisted(() => ({ showMock: vi.fn() }));
vi.mock('./desktopNotification', () => ({
  chatNotificationTag: (protocol: string, key: string) => `${protocol}:${key}`,
  showChatDesktopNotification: showMock,
}));

import { chatNotificationTargetFromViewKey } from './chatDesktopNotifications';

describe('chatNotificationTargetFromViewKey', () => {
  it.each([
    ['dm:123', { dmPeer: 123, channel: null }],
    ['ch:2', { dmPeer: null, channel: 2 }],
    ['ch:', { dmPeer: null, channel: null }],
    ['bogus', { dmPeer: null, channel: null }],
  ])('%s', (key, expected) => {
    expect(chatNotificationTargetFromViewKey('meshcore', key)).toEqual({
      kind: 'chat',
      protocol: 'meshcore',
      ...expected,
    });
  });
});
