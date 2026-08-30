// @vitest-environment jsdom
/**
 * Source contract + executable ingest tests for RRC multi-hub WebSocket event routing.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetReticulumManualStackStopSuppressForTests } from '@/renderer/lib/reticulum/reticulumManualStackStopSuppress';
import { rrcDmRoomKey } from '@/renderer/lib/rrcDmRoom';
import {
  isRrcHubAutoJoinBlocked,
  resetRrcHubAutoJoinBackoffForTests,
} from '@/renderer/lib/rrcHubAutoJoinBackoff';
import { RRC_HUB_STREAM_ROOM } from '@/renderer/lib/rrcRoomName';
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
const DM_ROOM = rrcDmRoomKey(PEER);

describe('useReticulumRuntime RRC event routing (regression)', () => {
  it('honors will_reconnect=false by clearing the hub session', () => {
    expect(SOURCE).toMatch(/will_reconnect\?: boolean/);
    expect(SOURCE).toMatch(/p\.will_reconnect === false/);
    expect(SOURCE).toMatch(
      /p\.reason === 'local_disconnect'[\s\S]*?disconnectIntentForHub[\s\S]*?p\.will_reconnect === false[\s\S]*?clearHubSession/,
    );
  });

  it('records auto-join backoff on will_reconnect=false handshake failures', async () => {
    resetRrcHubAutoJoinBackoffForTests();
    useRrcSessionStore.getState().clearSession();
    useRrcSessionStore.getState().applyStatus('awaiting_welcome', HUB, null);
    let eventHandler: ((evt: ReticulumSidecarEvent) => void) | null = null;
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
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue({
      running: true,
      port: 19437,
      pid: 1,
      healthy: true,
    });

    const { result, unmount } = renderHook(() => useReticulumRuntime());
    await act(async () => {
      await result.current.connect();
    });
    expect(eventHandler).toBeTruthy();

    act(() => {
      eventHandler!({
        type: 'rrc.disconnected',
        payload: {
          hub_dest_hash: HUB,
          reason: 'timed out waiting for WELCOME',
          will_reconnect: false,
        },
      });
    });
    expect(isRrcHubAutoJoinBlocked(HUB)).toBe(true);

    act(() => {
      eventHandler!({
        type: 'rrc.connected',
        payload: {
          hub_dest_hash: HUB,
          hub_name: 'Community',
          status: 'active',
          capabilities: {
            direct_notice: true,
            action: false,
            resource_envelope: false,
          },
        },
      });
    });
    expect(isRrcHubAutoJoinBlocked(HUB)).toBe(false);
    unmount();
    resetRrcHubAutoJoinBackoffForTests();
  });

  it('keeps rooms while sidecar auto-reconnects when will_reconnect is true or omitted', () => {
    expect(SOURCE).toMatch(/willReconnect \|\| p\.will_reconnect === undefined/);
    expect(SOURCE).toMatch(/applyStatus\('reconnecting'/);
  });

  it('routes rrc.connected status and capabilities to the addressed hub', () => {
    expect(SOURCE).toMatch(/evt\.type === 'rrc\.connected'/);
    expect(SOURCE).toMatch(/applyStatus\(st, hubDestHash/);
    expect(SOURCE).toMatch(/setCapabilities\([\s\S]*?hubDestHash/);
    expect(SOURCE).toMatch(/applyWelcomeName\(hubDestHash/);
  });

  it('routes room join/part and messages with hub_dest_hash', () => {
    expect(SOURCE).toMatch(/evt\.type === 'rrc\.room\.joined'/);
    expect(SOURCE).toMatch(/roomJoined\(p\.room, p\.members, p\.hub_dest_hash/);
    expect(SOURCE).toMatch(/evt\.type === 'rrc\.room\.parted'/);
    expect(SOURCE).toMatch(/roomParted\(p\.room, \{ forced: !voluntary \}, hubDestHash\)/);
    expect(SOURCE).toMatch(/evt\.type === 'rrc\.message'/);
    expect(SOURCE).toMatch(/hub_dest_hash\?: string \| null/);
    expect(SOURCE).toMatch(/addMessage\([\s\S]*?\{ hubDestHash \}/);
  });

  it('routes /who notices through applyRrcWhoInboundNotice and drops unmatched rooms', () => {
    expect(SOURCE).toContain('applyRrcWhoInboundNotice');
    expect(SOURCE).toMatch(
      /whoResult\.action === 'unjoined' \|\| whoResult\.action === 'nicklist-only'[\s\S]*?return;/,
    );
    expect(SOURCE).toMatch(/whoResult\.action === 'transcript'[\s\S]*?room = whoResult\.room/);
  });

  it('routes direct NOTICE into per-peer @hash DMs via applyRrcDirectMessageRoom', () => {
    expect(SOURCE).toContain('applyRrcDirectMessageRoom');
    expect(SOURCE).toMatch(/applyRrcDirectMessageRoom\(\{[\s\S]*?openDm:/);
    expect(SOURCE).not.toMatch(/RRC_WHISPERS_ROOM/);
    expect(SOURCE).not.toMatch(/setLastWhisperPeer/);
  });

  it('never treats synthetic [hub] / @dm names as JOIN targets from join-info NOTICE', () => {
    expect(SOURCE).toContain('Never treat synthetic `[hub]` / `@dm` names as hub JOIN targets');
    expect(SOURCE).toMatch(/!topic\.room\.startsWith\('\['\)/);
    expect(SOURCE).toMatch(/!topic\.room\.startsWith\('@'\)/);
  });

  it('uses neutral hubParted banner for involuntary parts (not kick/ban wording)', () => {
    expect(SOURCE).toMatch(/resolveRrcInvoluntaryPartBannerKey/);
    expect(SOURCE).toMatch(/sessionStatus: view\.status/);
    expect(SOURCE).toMatch(
      /if \(bannerKey\) session\.setModerationBanner\(bannerKey, hubDestHash\)/,
    );
    // Parted path must not hard-code the kick/ban key (moderation NOTICE/ERROR still may).
    expect(SOURCE).toMatch(
      /evt\.type === 'rrc\.room\.parted'[\s\S]*?resolveRrcInvoluntaryPartBannerKey\([\s\S]*?if \(bannerKey\) session\.setModerationBanner\(bannerKey/,
    );
    expect(SOURCE).toMatch(
      /i18n\.t\('rrc\.moderation\.removedFromRoomSystem',\s*\{\s*room:\s*p\.room\s*\}\)/,
    );
    expect(SOURCE).not.toMatch(/Removed from \$\{p\.room\}/);
  });

  it('reserves removedFromRoom banner for moderation NOTICE/ERROR language', () => {
    expect(SOURCE).toMatch(
      /isRrcModerationLanguage\(p\.body\)[\s\S]*?setModerationBanner\('rrc\.moderation\.removedFromRoom'/,
    );
    expect(SOURCE).toMatch(
      /isRrcModerationLanguage\(p\.message\)[\s\S]*?setModerationBanner\('rrc\.moderation\.removedFromRoom'/,
    );
  });

  it('debug-logs rrc.disconnected and rrc.room.parted with hub/room/voluntary', () => {
    expect(SOURCE).toMatch(/console\.debug\(\s*'\[useReticulumRuntime\] rrc\.disconnected hub='/);
    expect(SOURCE).toMatch(/console\.debug\(\s*'\[useReticulumRuntime\] rrc\.room\.parted hub='/);
    expect(SOURCE).toMatch(/voluntary='/);
    expect(SOURCE).toMatch(/will_reconnect='/);
  });
});

describe('useReticulumRuntime RRC empty-K_ROOM hub-scoped routing', () => {
  let eventHandler: ((evt: ReticulumSidecarEvent) => void) | null = null;

  beforeEach(() => {
    resetReticulumManualStackStopSuppressForTests();
    useRrcSessionStore.getState().clearSession();
    useRrcSessionStore.getState().setNickname('nv0n');
    useRrcSessionStore.getState().setLocalIdentityHash(SELF);
    useRrcSessionStore.getState().applyStatus('active', HUB, 'Community');
    useRrcSessionStore.getState().roomJoined('general');
    useRrcSessionStore.getState().setActiveRoom('general');
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

  function roomBodies(room: string): string[] {
    const key = useRrcSessionStore.getState().roomMessageKey(room, HUB);
    return (useRrcSessionStore.getState().messages.get(key ?? '') ?? []).map((m) => m.body);
  }

  function roomMembers(room: string) {
    const session = useRrcSessionStore.getState().sessionsByHub.get(HUB);
    const info = session
      ? [...session.rooms.values()].find((r) => r.name === room || r.name === `#${room}`)
      : undefined;
    return info?.members ?? [];
  }

  function sendEmptyRoomMessage(
    onEvent: (evt: ReticulumSidecarEvent) => void,
    kind: 'notice' | 'error' | 'system',
    body: string,
    id: string,
  ): void {
    act(() => {
      onEvent({
        type: 'rrc.message',
        payload: {
          id,
          hub_dest_hash: HUB,
          room: '',
          kind,
          body,
          sender_hash: PEER,
          timestamp: Date.now(),
        },
      });
    });
  }

  it('seeds self into nicklist on join-info when actor JOINED roster is missing', async () => {
    const { onEvent, unmount } = await connectAndGetOnEvent();
    act(() => {
      onEvent({
        type: 'rrc.message',
        payload: {
          id: 'join-info-1',
          hub_dest_hash: HUB,
          room: 'general',
          kind: 'notice',
          body: 'room general: registered; mode=+nrt; topic=(none)',
          sender_hash: HUB,
          timestamp: Date.now(),
        },
      });
    });
    const members = roomMembers('general');
    expect(members.some((m) => m.identity_hash === SELF)).toBe(true);
    expect(members.find((m) => m.identity_hash === SELF)?.nickname).toBe('nv0n');
    unmount();
  });

  it.each(['notice', 'error', 'system'] as const)(
    'stores empty-room %s in the focused real room',
    async (kind) => {
      const { onEvent, unmount } = await connectAndGetOnEvent();
      const body = `hub-${kind}-reply`;
      sendEmptyRoomMessage(onEvent, kind, body, `${kind}-real`);
      expect(roomBodies('general')).toContain(body);
      expect(roomBodies(RRC_HUB_STREAM_ROOM)).not.toContain(body);
      unmount();
    },
  );

  it.each(['notice', 'error', 'system'] as const)(
    'stores empty-room %s in [hub] when a DM is focused',
    async (kind) => {
      useRrcSessionStore.getState().openDm({ identity_hash: PEER, nickname: 'Bob' }, HUB, {
        focus: true,
      });
      expect(useRrcSessionStore.getState().activeRoom).toBe(DM_ROOM);
      const { onEvent, unmount } = await connectAndGetOnEvent();
      const body = `dm-focus-${kind}`;
      sendEmptyRoomMessage(onEvent, kind, body, `${kind}-dm`);
      expect(roomBodies(RRC_HUB_STREAM_ROOM)).toContain(body);
      expect(roomBodies(DM_ROOM)).not.toContain(body);
      expect(roomBodies('general')).not.toContain(body);
      unmount();
    },
  );

  it.each(['notice', 'error', 'system'] as const)(
    'stores empty-room %s in [hub] when synthetic focus is active',
    async (kind) => {
      useRrcSessionStore.getState().setActiveRoom(RRC_HUB_STREAM_ROOM);
      const { onEvent, unmount } = await connectAndGetOnEvent();
      const body = `synth-focus-${kind}`;
      sendEmptyRoomMessage(onEvent, kind, body, `${kind}-synth`);
      expect(roomBodies(RRC_HUB_STREAM_ROOM)).toContain(body);
      expect(roomBodies('general')).not.toContain(body);
      unmount();
    },
  );

  it('routes rrc.error into the focused real room via resolveRrcHubScopedNoticeRoom', async () => {
    const { onEvent, unmount } = await connectAndGetOnEvent();
    act(() => {
      onEvent({
        type: 'rrc.error',
        payload: { message: 'link proof timeout', hub_dest_hash: HUB },
      });
    });
    expect(roomBodies('general')).toContain('link proof timeout');
    expect(roomBodies(RRC_HUB_STREAM_ROOM)).not.toContain('link proof timeout');
    unmount();
  });

  it('routes rrc.error into [hub] when a DM is focused', async () => {
    useRrcSessionStore.getState().openDm({ identity_hash: PEER, nickname: 'Bob' }, HUB, {
      focus: true,
    });
    const { onEvent, unmount } = await connectAndGetOnEvent();
    act(() => {
      onEvent({
        type: 'rrc.error',
        payload: { message: 'path timeout', hub_dest_hash: HUB },
      });
    });
    expect(roomBodies(RRC_HUB_STREAM_ROOM)).toContain('path timeout');
    expect(roomBodies(DM_ROOM)).not.toContain('path timeout');
    unmount();
  });
});
