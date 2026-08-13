// @vitest-environment jsdom
/**
 * Source contract + executable ingest tests for RRC unread alert gating.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from '@/renderer/lib/appSettingsStorage';
import { resetReticulumManualStackStopSuppressForTests } from '@/renderer/lib/reticulum/reticulumManualStackStopSuppress';
import { rrcMuteViewKey } from '@/renderer/lib/rrcMention';
import { loadRuntimeSource } from '@/renderer/lib/sourceContractTestHelpers';
import { useReticulumRuntime } from '@/renderer/runtime/useReticulumRuntime';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

vi.mock('@/renderer/lib/reticulum/fetchRecentInboundLxmf', () => ({
  fetchRecentInboundLxmf: vi.fn().mockResolvedValue([]),
  fetchRecentInboundLxmfDetailed: vi.fn().mockResolvedValue({ messages: [], ringLen: 0 }),
}));

vi.mock('@/renderer/lib/reticulum/useReticulumNobleBleYieldWatcher', () => ({
  useReticulumNobleBleYieldWatcher: () => {},
}));

vi.mock('@/renderer/lib/reticulum/useReticulumPropagationAutoSync', () => ({
  useReticulumPropagationAutoSync: () => {},
}));

vi.mock('@/renderer/components/Toast', () => ({
  pushAppToast: vi.fn(),
  useToast: () => ({ addToast: vi.fn() }),
}));

const SOURCE = loadRuntimeSource('useReticulumRuntime.ts');

const HUB = '28c7c1a68c735693aa8e6b8193ed44b2';
const PEER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SELF = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('useReticulumRuntime RRC alert gating (source contract)', () => {
  it('gates bumpUnread with resolveRrcAlertType and the live unread-all setting', () => {
    expect(SOURCE).toContain('resolveRrcAlertType');
    expect(SOURCE).toContain('isRrcUnreadAllRoomMessagesEnabled');
    expect(SOURCE).toMatch(
      /bumpUnread:\s*Boolean\(view\.hub\)\s*&&\s*resolveRrcAlertType\([\s\S]*?notifyMode:\s*isRrcUnreadAllRoomMessagesEnabled\(\)\s*\?\s*'all'\s*:\s*'mentions'/,
    );
  });
});

describe('useReticulumRuntime RRC unread ingest (handleSidecarEvent)', () => {
  let eventHandler: ((evt: ReticulumSidecarEvent) => void) | null = null;

  beforeEach(() => {
    resetReticulumManualStackStopSuppressForTests();
    localStorage.removeItem(APP_SETTINGS_STORAGE_KEY);
    localStorage.removeItem('mesh-client:mutedViews:reticulum');
    useRrcSessionStore.getState().clearSession();
    useRrcSessionStore.getState().setNickname('nv0n');
    useRrcSessionStore.getState().setLocalIdentityHash(SELF);
    useRrcSessionStore.getState().applyStatus('active', HUB, 'Community');
    useRrcSessionStore.getState().roomJoined('#other');
    useRrcSessionStore.getState().setActiveRoom('#other');
    eventHandler = null;
    vi.mocked(window.electronAPI.db.insertRrcMessage).mockReset();
    vi.mocked(window.electronAPI.db.insertRrcMessage).mockResolvedValue({ changes: 1 });
    vi.mocked(window.electronAPI.reticulum.onEvent).mockImplementation((cb) => {
      eventHandler = cb;
      return () => {
        if (eventHandler === cb) eventHandler = null;
      };
    });
    vi.mocked(window.electronAPI.reticulum.start).mockResolvedValue({
      running: true,
      port: 19437,
      pid: 1,
    });
    vi.mocked(window.electronAPI.reticulum.stop).mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue({
      running: true,
      port: 19437,
      pid: 1,
      healthy: true,
    });
  });

  afterEach(() => {
    vi.mocked(window.electronAPI.reticulum.onEvent).mockReset();
    vi.mocked(window.electronAPI.reticulum.onEvent).mockReturnValue(() => {});
    useRrcSessionStore.getState().clearSession();
  });

  async function connectAndGetOnEvent() {
    const { result, unmount } = renderHook(() => useReticulumRuntime());
    await act(async () => {
      await result.current.connect();
    });
    expect(eventHandler).toBeTruthy();
    return { onEvent: eventHandler!, unmount };
  }

  function sendRrcMessage(
    onEvent: (evt: ReticulumSidecarEvent) => void,
    payload: Record<string, unknown>,
  ): void {
    act(() => {
      onEvent({
        type: 'rrc.message',
        payload: {
          hub_dest_hash: HUB,
          sender_hash: PEER,
          timestamp: Date.now(),
          ...payload,
        },
      });
    });
  }

  function lobbyUnread(): number {
    return useRrcSessionStore.getState().unreadByRoom.get('lobby') ?? 0;
  }

  it('bumps unread for plain room traffic in all mode', async () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ rrcUnreadAllRoomMessages: true }),
    );
    const { onEvent, unmount } = await connectAndGetOnEvent();
    sendRrcMessage(onEvent, { id: 'all-1', room: '#lobby', kind: 'msg', body: 'hello all' });
    expect(lobbyUnread()).toBe(1);
    unmount();
  });

  it('skips plain room traffic in mentions mode and bumps @nick', async () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ rrcUnreadAllRoomMessages: false }),
    );
    const { onEvent, unmount } = await connectAndGetOnEvent();
    sendRrcMessage(onEvent, { id: 'mentions-1', room: '#lobby', kind: 'msg', body: 'hello all' });
    expect(lobbyUnread()).toBe(0);
    sendRrcMessage(onEvent, { id: 'mentions-2', room: '#lobby', kind: 'msg', body: 'hey @nv0n' });
    expect(lobbyUnread()).toBe(1);
    unmount();
  });

  it('does not bump muted rooms even for @nick in all mode', async () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ rrcUnreadAllRoomMessages: true }),
    );
    localStorage.setItem(
      'mesh-client:mutedViews:reticulum',
      JSON.stringify([rrcMuteViewKey(HUB, '#lobby')]),
    );
    const { onEvent, unmount } = await connectAndGetOnEvent();
    sendRrcMessage(onEvent, { id: 'mute-1', room: '#lobby', kind: 'msg', body: 'hey @nv0n' });
    expect(lobbyUnread()).toBe(0);
    unmount();
  });

  it('does not bump hub notices that mention @nick', async () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ rrcUnreadAllRoomMessages: true }),
    );
    const { onEvent, unmount } = await connectAndGetOnEvent();
    sendRrcMessage(onEvent, {
      id: 'notice-1',
      room: '#lobby',
      kind: 'notice',
      body: 'hey @nv0n topic changed',
    });
    expect(lobbyUnread()).toBe(0);
    unmount();
  });
});
