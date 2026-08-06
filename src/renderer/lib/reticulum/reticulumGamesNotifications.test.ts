// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as chatNotifications from '@/renderer/lib/chatNotifications';

import {
  isReticulumGamesTabFocused,
  maybeNotifyInboundGamesChallenge,
  setReticulumGamesTabFocused,
  shouldNotifyInboundGamesChallenge,
  totalGamesUnread,
} from './reticulumGamesNotifications';

vi.mock('@/renderer/lib/chatNotifications', () => ({
  playMessageNotification: vi.fn(),
}));

function challengePayload(
  overrides: { direction?: string; session?: Record<string, unknown> } = {},
) {
  return {
    app_id: 'ttt',
    session_id: 's1',
    direction: overrides.direction ?? 'inbound',
    session: {
      session_id: 's1',
      identity_id: 'me',
      app_id: 'ttt',
      initiator: 'peer',
      status: 'pending',
      unread: 1,
      ...overrides.session,
    },
  };
}

describe('reticulumGamesNotifications', () => {
  beforeEach(() => {
    setReticulumGamesTabFocused(false);
    localStorage.removeItem('mesh-client:notifMuted');
    vi.mocked(chatNotifications.playMessageNotification).mockClear();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  afterEach(() => {
    setReticulumGamesTabFocused(false);
  });

  it('sums positive unread counts', () => {
    expect(totalGamesUnread([{ unread: 1 }, { unread: 2 }, { unread: 0 }, { unread: -1 }])).toBe(3);
  });

  it('detects inbound pending challenges for the local responder', () => {
    expect(shouldNotifyInboundGamesChallenge(challengePayload())).toBe(true);
  });

  it('skips outbound updates and initiator sessions', () => {
    expect(shouldNotifyInboundGamesChallenge(challengePayload({ direction: 'outbound' }))).toBe(
      false,
    );
    expect(
      shouldNotifyInboundGamesChallenge(
        challengePayload({ session: { initiator: 'me', identity_id: 'me', status: 'pending' } }),
      ),
    ).toBe(false);
  });

  it('skips non-pending sessions', () => {
    expect(
      shouldNotifyInboundGamesChallenge(
        challengePayload({
          session: {
            session_id: 's1',
            identity_id: 'me',
            initiator: 'peer',
            status: 'active',
          },
        }),
      ),
    ).toBe(false);
  });

  it('plays a dm notification when Games is not focused', () => {
    maybeNotifyInboundGamesChallenge(challengePayload());
    expect(chatNotifications.playMessageNotification).toHaveBeenCalledWith('dm');
  });

  it('suppresses notification when Games tab is focused and visible', () => {
    setReticulumGamesTabFocused(true);
    expect(isReticulumGamesTabFocused()).toBe(true);
    maybeNotifyInboundGamesChallenge(challengePayload());
    expect(chatNotifications.playMessageNotification).not.toHaveBeenCalled();
  });

  it('still notifies when Games is focused but the window is hidden', () => {
    setReticulumGamesTabFocused(true);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    maybeNotifyInboundGamesChallenge(challengePayload());
    expect(chatNotifications.playMessageNotification).toHaveBeenCalledWith('dm');
  });

  it('respects global notification mute', () => {
    localStorage.setItem('mesh-client:notifMuted', '1');
    maybeNotifyInboundGamesChallenge(challengePayload());
    expect(chatNotifications.playMessageNotification).not.toHaveBeenCalled();
  });
});
