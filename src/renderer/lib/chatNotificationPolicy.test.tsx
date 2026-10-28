import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RrcChatMessage } from '@/shared/rrc-types';

import { useIdentityStore } from '../stores/identityStore';
import { useNodeStore } from '../stores/nodeStore';
import { resolveInactiveChatNotification } from './chatInactiveNotifications';
import {
  CHAT_NOTIFICATION_MODE_KEY,
  getChatNotificationMode,
  mentionsChatName,
  saveChatNotificationMode,
} from './chatNotificationPolicy';
import { getProtocolForType } from './protocols/protocolRegistry';
import { resolveInactiveRrcNotificationType } from './rrcInactiveNotifications';
import type { ChatMessage, MeshProtocol } from './types';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 12,
    sender_id: 2,
    channel: 0,
    payload: 'hello',
    sender_name: 'Other',
    timestamp: 1000,
    ...overrides,
  };
}
function classify(
  protocol: MeshProtocol,
  msg: ChatMessage,
  mutedViews = new Set<string>(),
  globalMute = false,
  allMessages = [msg],
) {
  return resolveInactiveChatNotification({
    newMessages: [msg],
    allMessages,
    protocol,
    ownNodeIds: new Set([1]),
    ownSenderId: 1,
    mutedViews,
    notifGloballyMuted: globalMute,
  });
}

describe('chat notification policy', () => {
  beforeEach(() => {
    localStorage.clear();
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    useNodeStore.setState({ nodes: {} });
  });

  it('keeps all-message defaults and existing master/sound preferences', () => {
    localStorage.setItem('mesh-client:notifMuted', '1');
    localStorage.setItem('mesh-client:notificationSounds', 'keep');
    expect(getChatNotificationMode()).toBe('all');
    localStorage.setItem(CHAT_NOTIFICATION_MODE_KEY, 'invalid');
    expect(getChatNotificationMode()).toBe('all');
    expect(saveChatNotificationMode('mentions')).toBe(true);
    expect(localStorage.getItem('mesh-client:notifMuted')).toBe('1');
    expect(localStorage.getItem('mesh-client:notificationSounds')).toBe('keep');
  });

  it.each([
    ['hello @[Joey Stanford]!', ['Joey Stanford'], true],
    ['@[ jOeY ]', ['Joey'], true],
    ['@[Cafe\u0301]', ['Café'], true],
    ['@[J.*]', ['J.*'], true],
    ['@[Joey Jr]', ['Joey'], false],
    ['@[Other] @[Joey]', ['Joey'], true],
    ['@Joey', ['Joey'], false],
    ['me@Joey.test', ['Joey'], false],
    ['@[Joey', ['Joey'], false],
    ['Joey', ['Joey'], false],
    ['@[]', [''], false],
  ])('matches complete protocol mention tokens: %s', (payload, names, expected) => {
    expect(mentionsChatName(payload, names)).toBe(expected);
  });

  it.each(['meshtastic', 'meshcore'] as const)(
    'filters %s channels but permits mentions, DMs and replies',
    (protocol) => {
      useIdentityStore.setState({
        activeIdentityId: 'radio',
        identities: {
          radio: {
            id: 'radio',
            protocol: getProtocolForType(protocol)!,
            signature: 'device',
            selfNodeNum: 1,
            displayName: 'Joey Stanford',
            shortName: 'JST',
            transports: [],
            createdAt: 1,
            lastSeenAt: 1,
          },
        },
      });
      saveChatNotificationMode('mentions');
      expect(classify(protocol, message())).toBeNull();
      expect(classify(protocol, message({ payload: '@[JST] hello' }))?.type).toBe('channel');
      expect(
        classify(protocol, message({ payload: 'hello', replyPreviewSender: 'Joey Stanford' }))
          ?.type,
      ).toBe('channel');
      expect(
        classify(protocol, message({ payload: 'hello', replyPreviewSender: 'Other' })),
      ).toBeNull();
      expect(classify(protocol, message({ channel: -1, to: 1 }))?.type).toBe('dm');
      const parent = message({ id: 99, sender_id: 1, packetId: 99, timestamp: 900 });
      const reply = message({ replyId: 99 });
      expect(classify(protocol, reply, new Set(), false, [parent, reply])?.type).toBe('reply');
      const mention = message({ payload: '@[Joey Stanford]' });
      expect(classify(protocol, mention, new Set(['ch:0']))).toBeNull();
      expect(classify(protocol, mention, new Set(), true)).toBeNull();
      expect(classify(protocol, message({ ...mention, sender_id: 1 }))).toBeNull();
      expect(classify(protocol, message({ ...mention, isHistory: true }))).toBeNull();
      expect(classify(protocol, message({ ...mention, emoji: 128077, replyId: 99 }))).toBeNull();
    },
  );

  it('keeps Reticulum DMs eligible without requiring a mention', () => {
    saveChatNotificationMode('mentions');
    expect(classify('reticulum', message({ channel: -1, to: 1 }))?.type).toBe('dm');
  });

  it('combines RRC global and existing room mode, with whispers explicit', () => {
    const msg = { id: 'rrc1', timestamp: 1, body: 'hello', room: 'general', kind: 'msg' as const };
    const resolveRrcAlertType = (args: {
      msg: RrcChatMessage;
      nickname: string;
      notifyMode: 'all' | 'mentions';
      muted: boolean;
    }) =>
      resolveInactiveRrcNotificationType({
        newMessages: [args.msg],
        nickname: args.nickname,
        notifyMode: args.notifyMode,
        hubDestHash: 'abc',
        mutedViews: new Set(args.muted ? ['rrc:abc:general'] : []),
        notifGloballyMuted: false,
        localIdentityHash: null,
      });
    saveChatNotificationMode('mentions');
    expect(
      resolveRrcAlertType({ msg, nickname: 'Joey', notifyMode: 'all', muted: false }),
    ).toBeNull();
    expect(
      resolveRrcAlertType({
        msg: { ...msg, body: '@joey!' },
        nickname: 'Joey',
        notifyMode: 'all',
        muted: false,
      }),
    ).toBe('dm');
    expect(
      resolveRrcAlertType({
        msg: { ...msg, room: '@' + 'a'.repeat(32) },
        nickname: 'Joey',
        notifyMode: 'mentions',
        muted: false,
      }),
    ).toBe('dm');
    expect(
      resolveRrcAlertType({
        msg: { ...msg, body: '@Joey' },
        nickname: 'Joey',
        notifyMode: 'all',
        muted: true,
      }),
    ).toBeNull();
  });

  it('reports failed persistence without changing the selected mode', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(saveChatNotificationMode('mentions')).toBe(false);
    expect(getChatNotificationMode()).toBe('all');
    write.mockRestore();
  });
});
