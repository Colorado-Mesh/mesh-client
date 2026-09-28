import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { showMock } = vi.hoisted(() => ({ showMock: vi.fn() }));
vi.mock('./desktopNotification', () => ({
  chatNotificationTag: (protocol: string, key: string) => `${protocol}:${key}`,
  showChatDesktopNotification: showMock,
}));

import {
  chatNotificationTargetFromViewKey,
  focusRrcNotificationTarget,
  notifyInactiveChat,
  notifyInactiveRrc,
} from './chatDesktopNotifications';
import type { ChatDesktopNotificationArgs } from './desktopNotification';
import type { ChatMessage } from './types';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    sender_id: 7,
    sender_name: 'Alpha',
    payload: 'hello',
    channel: 0,
    timestamp: Date.now(),
    ...overrides,
  };
}

function lastArgs(): ChatDesktopNotificationArgs {
  const call = showMock.mock.calls.at(-1) as [ChatDesktopNotificationArgs] | undefined;
  if (!call) throw new Error('expected a desktop notification');
  return call[0];
}

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

describe('focusRrcNotificationTarget', () => {
  function actions() {
    return { setFocusedHub: vi.fn(), setActiveRoom: vi.fn() };
  }

  it('focuses the originating hub before opening the room on it', () => {
    const rrc = actions();
    focusRrcNotificationTarget({ kind: 'rrc', room: '#ops', hubHash: 'abc123' }, rrc);
    expect(rrc.setFocusedHub).toHaveBeenCalledWith('abc123');
    expect(rrc.setActiveRoom).toHaveBeenCalledWith('#ops', 'abc123');
    expect(rrc.setFocusedHub.mock.invocationCallOrder[0]).toBeLessThan(
      rrc.setActiveRoom.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('focuses the hub but does not open the hub stream as a room', () => {
    const rrc = actions();
    focusRrcNotificationTarget({ kind: 'rrc', room: '[hub]', hubHash: 'abc123' }, rrc);
    expect(rrc.setFocusedHub).toHaveBeenCalledWith('abc123');
    expect(rrc.setActiveRoom).not.toHaveBeenCalled();
  });

  it('opens the room on the focused hub when the hub is unknown', () => {
    const rrc = actions();
    focusRrcNotificationTarget({ kind: 'rrc', room: '#ops', hubHash: null }, rrc);
    expect(rrc.setFocusedHub).not.toHaveBeenCalled();
    expect(rrc.setActiveRoom).toHaveBeenCalledWith('#ops');
  });
});

describe('notifyInactiveChat / notifyInactiveRrc', () => {
  const focusWindow = vi.fn(() => Promise.resolve());
  beforeEach(() => {
    showMock.mockReset();
    focusWindow.mockClear();
    vi.stubGlobal('electronAPI', { app: { focusWindow } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['meshtastic', 'meshcore', 'reticulum'] as const)(
    'DM on %s: DM title, per-conversation tag, click focuses and opens the DM',
    (protocol) => {
      const onOpen = vi.fn();
      notifyInactiveChat({
        protocol,
        notification: { type: 'dm', message: message({ payload: 'secret' }), viewKey: 'dm:7' },
        onOpen,
      });
      const args = lastArgs();
      expect(args.title).toBe('DM from Alpha');
      expect(args.body).toBe('secret');
      expect(args.tag).toBe(`${protocol}:dm:7`);
      args.onClick?.();
      expect(focusWindow).toHaveBeenCalledOnce();
      expect(onOpen).toHaveBeenCalledWith({ kind: 'chat', protocol, dmPeer: 7, channel: null });
    },
  );

  it('channel message uses the message title and opens the channel', () => {
    const onOpen = vi.fn();
    notifyInactiveChat({
      protocol: 'meshtastic',
      notification: { type: 'channel', message: message({ channel: 3 }), viewKey: 'ch:3' },
      onOpen,
    });
    const args = lastArgs();
    expect(args.title).toBe('Message from Alpha');
    args.onClick?.();
    expect(onOpen).toHaveBeenCalledWith({
      kind: 'chat',
      protocol: 'meshtastic',
      dmPeer: null,
      channel: 3,
    });
  });

  it('RRC line names the room and opens it on click', () => {
    const onOpen = vi.fn();
    notifyInactiveRrc({
      message: {
        id: '1',
        room: '#ops',
        kind: 'message',
        body: '@me ping',
        nickname: 'bob',
        timestamp: 1,
      } as never,
      room: '#ops',
      hubHash: 'abc',
      onOpen,
    });
    const args = lastArgs();
    expect(args.title).toBe('bob in #ops');
    expect(args.body).toBe('@me ping');
    expect(args.tag).toBe('rrc:abc:#ops');
    args.onClick?.();
    expect(focusWindow).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith({ kind: 'rrc', room: '#ops', hubHash: 'abc' });
  });

  it('still routes the click when focusWindow rejects', async () => {
    focusWindow.mockRejectedValueOnce(new Error('gone'));
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const onOpen = vi.fn();
    notifyInactiveChat({
      protocol: 'meshtastic',
      notification: { type: 'dm', message: message(), viewKey: 'dm:7' },
      onOpen,
    });
    lastArgs().onClick?.();
    expect(onOpen).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(debug).toHaveBeenCalled();
    });
    debug.mockRestore();
  });
});
