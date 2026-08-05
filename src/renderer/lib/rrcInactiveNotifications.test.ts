import { describe, expect, it } from 'vitest';

import { resolveInactiveRrcNotificationType } from './rrcInactiveNotifications';

describe('resolveInactiveRrcNotificationType', () => {
  const base = {
    nickname: 'nv0n',
    hubDestHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    mutedViews: new Set<string>(),
    notifGloballyMuted: false,
    localIdentityHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  };

  it('returns null when globally muted', () => {
    expect(
      resolveInactiveRrcNotificationType({
        ...base,
        notifGloballyMuted: true,
        newMessages: [{ id: '1', room: '#lobby', kind: 'msg', body: 'hi', timestamp: 1 }],
      }),
    ).toBeNull();
  });

  it('prefers dm for whispers and @mentions', () => {
    expect(
      resolveInactiveRrcNotificationType({
        ...base,
        newMessages: [
          { id: '1', room: '#lobby', kind: 'msg', body: 'hello', timestamp: 1 },
          { id: '2', room: '[whispers]', kind: 'notice', body: 'psst', timestamp: 2 },
        ],
      }),
    ).toBe('dm');
    expect(
      resolveInactiveRrcNotificationType({
        ...base,
        newMessages: [{ id: '1', room: '#lobby', kind: 'msg', body: 'hey @nv0n', timestamp: 1 }],
      }),
    ).toBe('dm');
  });

  it('returns channel for ordinary room traffic', () => {
    expect(
      resolveInactiveRrcNotificationType({
        ...base,
        newMessages: [{ id: '1', room: '#lobby', kind: 'msg', body: 'hello', timestamp: 1 }],
      }),
    ).toBe('channel');
  });

  it('skips muted rooms and self messages', () => {
    expect(
      resolveInactiveRrcNotificationType({
        ...base,
        mutedViews: new Set(['rrc:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:#lobby']),
        newMessages: [{ id: '1', room: '#lobby', kind: 'msg', body: 'hey @nv0n', timestamp: 1 }],
      }),
    ).toBeNull();
    expect(
      resolveInactiveRrcNotificationType({
        ...base,
        newMessages: [
          {
            id: '1',
            room: '#lobby',
            kind: 'msg',
            body: 'hi',
            sender_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            timestamp: 1,
          },
        ],
      }),
    ).toBeNull();
  });
});
