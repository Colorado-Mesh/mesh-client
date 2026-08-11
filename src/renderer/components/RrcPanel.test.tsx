import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import {
  isRrcHubDisconnectSuppressed,
  resetRrcHubDisconnectSuppressForTests,
} from '@/renderer/lib/rrcHubDisconnectSuppress';
import { saveRrcHubAutoJoin } from '@/renderer/lib/rrcHubPrefs';
import { clearRrcOpenDms, loadRrcOpenDms, upsertRrcOpenDm } from '@/renderer/lib/rrcOpenDms';
import { resetRrcRoomHistoryForTests } from '@/renderer/lib/rrcRoomHistory';
import { useRrcHubStore } from '@/renderer/stores/rrcHubStore';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

import RrcPanel from './RrcPanel';

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  isReticulumSidecarRunning: vi.fn(() => Promise.resolve(false)),
}));

const hubA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const hubB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function whoSendCalls(): unknown[][] {
  return vi.mocked(window.electronAPI.reticulum.rrc.send).mock.calls.filter((args) => {
    const body = (args[0] as { body?: string } | undefined)?.body;
    return typeof body === 'string' && body.startsWith('/who');
  });
}

describe('RrcPanel', () => {
  beforeEach(() => {
    useRrcSessionStore.getState().clearSession();
    useRrcHubStore.setState({ hubs: new Map() });
    resetRrcHubDisconnectSuppressForTests();
    resetRrcRoomHistoryForTests();
    hydrateAxeThemeColors(document.documentElement);
    vi.mocked(isReticulumSidecarRunning).mockResolvedValue(false);
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.reticulum.rrc.disconnect).mockReset();
    vi.mocked(window.electronAPI.reticulum.rrc.disconnect).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockReset();
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.reticulum.rrc.join).mockReset();
    vi.mocked(window.electronAPI.reticulum.rrc.join).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.reticulum.rrc.setNickname).mockReset();
    vi.mocked(window.electronAPI.reticulum.rrc.setNickname).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.db.deleteRrcMessagesByRoom).mockClear();
    vi.mocked(window.electronAPI.db.deleteRrcMessagesByRoom).mockResolvedValue({ changes: 1 });
    localStorage.removeItem('mesh-client:rrc:hubAutoJoin');
    clearRrcOpenDms(hubA);
    clearRrcOpenDms(hubB);
    vi.mocked(window.electronAPI.db.listRrcMessages).mockResolvedValue([]);
  });

  it('renders amber hub chrome and select-hub prompt', async () => {
    const { container } = render(<RrcPanel isActive />);
    expect(screen.getAllByText(/Select an RRC hub/i).length).toBeGreaterThan(0);
    expect(container.querySelector('[class*="border-amber"]')).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows Cancel while connecting so a stuck hub connect can be aborted', () => {
    useRrcSessionStore.getState().applyStatus('connecting', hubA, 'Slow Hub');
    render(<RrcPanel isActive />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });

  it('keeps sibling hub sessions when focusing another connected hub', () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('#lobby');
    store.setFocusedHub(hubA);
    store.applyStatus('active', hubB, 'Hub B');
    store.setFocusedHub(hubB);

    const state = useRrcSessionStore.getState();
    expect(state.focusedHubHash).toBe(hubB);
    expect(state.sessionsByHub.get(hubA)?.status).toBe('active');
    expect(state.sessionsByHub.get(hubA)?.rooms.has('#lobby')).toBe(true);
    expect(state.sessionsByHub.get(hubB)?.status).toBe('active');
  });

  it('batch-connects auto-join hubs when the sidecar becomes ready', async () => {
    vi.mocked(isReticulumSidecarRunning).mockResolvedValue(true);
    saveRrcHubAutoJoin([hubA, hubB]);

    render(<RrcPanel isActive />);

    await waitFor(() => {
      expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalled();
    });
    const hashes = vi
      .mocked(window.electronAPI.reticulum.rrc.connect)
      .mock.calls.map((c) => (c[0] as { dest_hash: string }).dest_hash)
      .sort();
    expect(hashes).toEqual([hubA, hubB]);
  });

  it('skips auto-join connect for hubs already active', async () => {
    vi.mocked(isReticulumSidecarRunning).mockResolvedValue(true);
    saveRrcHubAutoJoin([hubA]);
    useRrcSessionStore.getState().applyStatus('active', hubA, 'Hub A');

    render(<RrcPanel isActive />);

    await waitFor(() => {
      expect(isReticulumSidecarRunning).toHaveBeenCalled();
    });
    // Give the auto-connect effect a tick; it should no-op because hub A is linked.
    await new Promise((r) => setTimeout(r, 20));
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
  });

  it('Cancel disconnects a connecting hub and sets disconnect intent', async () => {
    vi.mocked(window.electronAPI.reticulum.rrc.disconnect).mockResolvedValue({ ok: true });
    useRrcSessionStore.getState().applyStatus('connecting', hubA, 'Slow Hub');
    useRrcHubStore.setState({
      hubs: new Map([
        [
          hubA,
          {
            destination_hash: hubA,
            display_name: 'Slow Hub',
            source: 'manual',
            recommended: false,
          },
        ],
      ]),
    });
    render(<RrcPanel isActive />);
    screen.getByRole('button', { name: 'Cancel' }).click();
    await waitFor(() => {
      expect(window.electronAPI.reticulum.rrc.disconnect).toHaveBeenCalledWith({
        dest_hash: hubA,
      });
    });
    expect(useRrcSessionStore.getState().sessionsByHub.has(hubA)).toBe(false);
  });

  it('resets disconnect intent when disconnect IPC fails', async () => {
    vi.mocked(window.electronAPI.reticulum.rrc.disconnect).mockResolvedValue({
      ok: false,
    });
    useRrcSessionStore.getState().applyStatus('active', hubA, 'Hub A');
    useRrcHubStore.setState({
      hubs: new Map([
        [
          hubA,
          {
            destination_hash: hubA,
            display_name: 'Hub A',
            source: 'manual',
            recommended: false,
          },
        ],
      ]),
    });
    render(<RrcPanel isActive />);
    screen.getByRole('button', { name: /Disconnect/i }).click();
    await waitFor(() => {
      expect(window.electronAPI.reticulum.rrc.disconnect).toHaveBeenCalled();
    });
    expect(useRrcSessionStore.getState().sessionsByHub.get(hubA)?.disconnectIntent).toBe(false);
    expect(useRrcSessionStore.getState().sessionsByHub.has(hubA)).toBe(true);
    expect(isRrcHubDisconnectSuppressed(hubA)).toBe(false);
  });

  it('shows clear-history confirmation and deletes on confirm', async () => {
    const user = userEvent.setup();
    useRrcSessionStore.getState().applyStatus('active', hubA, 'Hub A');
    useRrcSessionStore.getState().roomJoined('#lobby');
    useRrcSessionStore.getState().setActiveRoom('#lobby');
    useRrcSessionStore.getState().addMessage({
      id: 'm1',
      room: '#lobby',
      kind: 'msg',
      body: 'hello',
      timestamp: Date.now(),
    });
    render(<RrcPanel isActive />);
    const clearBtn = screen.getByRole('button', { name: 'Clear history' });
    expect(clearBtn).toHaveAttribute('title', 'Clear history');
    await user.click(clearBtn);
    expect(screen.getByRole('alertdialog', { name: 'Clear room history' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete history' }));
    await waitFor(() => {
      expect(window.electronAPI.db.deleteRrcMessagesByRoom).toHaveBeenCalledWith(hubA, 'lobby');
    });
    expect(useRrcSessionStore.getState().messages.get(`${hubA}::lobby`)).toBeUndefined();
  });

  it('Disconnect with hub auto-join does not reconnect via rrc.connect', async () => {
    vi.mocked(isReticulumSidecarRunning).mockResolvedValue(true);
    saveRrcHubAutoJoin([hubA]);
    useRrcSessionStore.getState().applyStatus('active', hubA, 'Hub A');
    useRrcHubStore.setState({
      hubs: new Map([
        [
          hubA,
          {
            destination_hash: hubA,
            display_name: 'Hub A',
            source: 'manual',
            recommended: false,
          },
        ],
      ]),
    });
    render(<RrcPanel isActive />);
    // Initial mount may attempt batch for other hubs; clear before Disconnect.
    await waitFor(() => {
      expect(isReticulumSidecarRunning).toHaveBeenCalled();
    });
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();

    screen.getByRole('button', { name: /Disconnect/i }).click();
    await waitFor(() => {
      expect(window.electronAPI.reticulum.rrc.disconnect).toHaveBeenCalledWith({
        dest_hash: hubA,
      });
    });
    expect(useRrcSessionStore.getState().sessionsByHub.has(hubA)).toBe(false);
    expect(isRrcHubDisconnectSuppressed(hubA)).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
  });

  it('opens a per-peer DM on /msg and replies with NOTICE to that peer', async () => {
    const user = userEvent.setup();
    const peerHash = 'dddddddddddddddddddddddddddddddd';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.setCapabilities({ direct_notice: true });
    store.roomJoined('#general', [{ identity_hash: peerHash, nickname: 'Alice' }]);
    store.setActiveRoom('#general');
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockResolvedValue({ ok: true });

    render(<RrcPanel isActive />);

    const composer = screen.getByRole('textbox', { name: /Message or \/command/i });
    await user.clear(composer);
    await user.type(composer, '/msg Alice first whisper');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.rrc.send).toHaveBeenCalledWith({
        hub_dest_hash: hubA,
        body: 'first whisper',
        type: 'notice',
        dst_hash: peerHash,
      });
    });
    expect(useRrcSessionStore.getState().activeRoom).toBe(`@${peerHash}`);
    expect(useRrcSessionStore.getState().rooms.has(`@${peerHash}`)).toBe(true);

    const whisperKey = useRrcSessionStore.getState().roomMessageKey(`@${peerHash}`);
    const outbound = useRrcSessionStore
      .getState()
      .messages.get(whisperKey ?? '')
      ?.find((m) => m.body === 'first whisper');
    expect(outbound).toMatchObject({
      kind: 'msg',
      body: 'first whisper',
      dst_hash: peerHash,
      room: `@${peerHash}`,
    });
    expect(outbound?.body).not.toContain('→');

    // Sidebar + header show peer nick, not the @hash key.
    expect(screen.getByRole('button', { name: 'Open room Alice' })).toBeInTheDocument();
    expect(screen.getByText(/· Alice/)).toBeInTheDocument();

    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();
    const whisperComposer = screen.getByRole('textbox', { name: /Reply to Alice/i });
    await user.clear(whisperComposer);
    await user.type(whisperComposer, 'second whisper');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.rrc.send).toHaveBeenCalledWith({
        hub_dest_hash: hubA,
        body: 'second whisper',
        type: 'notice',
        dst_hash: peerHash,
      });
    });
  });

  it('keeps separate DM tabs when whispering two peers', async () => {
    const user = userEvent.setup();
    const aliceHash = 'dddddddddddddddddddddddddddddddd';
    const bobHash = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.setCapabilities({ direct_notice: true });
    store.roomJoined('#general', [
      { identity_hash: aliceHash, nickname: 'Alice' },
      { identity_hash: bobHash, nickname: 'Bob' },
    ]);
    store.setActiveRoom('#general');
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockResolvedValue({ ok: true });

    render(<RrcPanel isActive />);

    const composer = screen.getByRole('textbox', { name: /Message or \/command/i });
    await user.clear(composer);
    await user.type(composer, '/msg Alice hello Alice');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(useRrcSessionStore.getState().activeRoom).toBe(`@${aliceHash}`);
    });

    // Inbound-style open of Bob's DM must not replace Alice's tab.
    useRrcSessionStore.getState().openDm({ identity_hash: bobHash, nickname: 'Bob' }, hubA, {
      focus: false,
    });
    expect(useRrcSessionStore.getState().rooms.has(`@${aliceHash}`)).toBe(true);
    expect(useRrcSessionStore.getState().rooms.has(`@${bobHash}`)).toBe(true);
    expect(useRrcSessionStore.getState().activeRoom).toBe(`@${aliceHash}`);

    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();
    const whisperComposer = screen.getByRole('textbox', { name: /Reply to Alice/i });
    await user.clear(whisperComposer);
    await user.type(whisperComposer, 'still Alice');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.rrc.send).toHaveBeenCalledWith({
        hub_dest_hash: hubA,
        body: 'still Alice',
        type: 'notice',
        dst_hash: aliceHash,
      });
    });
  });

  it('leaves a DM locally without hub PART and keeps history', async () => {
    const user = userEvent.setup();
    const peerHash = 'dddddddddddddddddddddddddddddddd';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.setCapabilities({ direct_notice: true });
    store.roomJoined('#general', [{ identity_hash: peerHash, nickname: 'Alice' }]);
    store.openDm({ identity_hash: peerHash, nickname: 'Alice' }, hubA, { focus: true });
    store.addMessage({
      id: 'keep-me',
      room: `@${peerHash}`,
      kind: 'msg',
      body: 'saved',
      timestamp: 1,
      dst_hash: peerHash,
    });
    vi.mocked(window.electronAPI.reticulum.rrc.part).mockClear();

    render(<RrcPanel isActive />);
    await user.click(screen.getByRole('button', { name: /Leave room/i }));

    await waitFor(() => {
      expect(useRrcSessionStore.getState().rooms.has(`@${peerHash}`)).toBe(false);
    });
    expect(window.electronAPI.reticulum.rrc.part).not.toHaveBeenCalled();
    expect(loadRrcOpenDms(hubA)).toEqual([]);
    const key = useRrcSessionStore.getState().roomMessageKey(`@${peerHash}`, hubA);
    expect(useRrcSessionStore.getState().messages.get(key ?? '')?.[0]?.body).toBe('saved');
  });

  it('restores open DMs from localStorage when the hub becomes active', async () => {
    const peerHash = 'dddddddddddddddddddddddddddddddd';
    upsertRrcOpenDm(hubA, { identity_hash: peerHash, nickname: 'Alice' });
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.setCapabilities({ direct_notice: true });
    store.roomJoined('#general');

    render(<RrcPanel isActive />);

    await waitFor(() => {
      expect(useRrcSessionStore.getState().rooms.has(`@${peerHash}`)).toBe(true);
    });
    expect(screen.getByRole('button', { name: 'Open room Alice' })).toBeInTheDocument();
    // Restore must not steal focus from the active channel.
    expect(useRrcSessionStore.getState().activeRoom).toBe('#general');
  });

  it('does not hub-JOIN an @hash DM room name', async () => {
    const user = userEvent.setup();
    const peerHash = 'dddddddddddddddddddddddddddddddd';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.setCapabilities({ direct_notice: true });
    store.openDm({ identity_hash: peerHash, nickname: 'Alice' }, hubA, { focus: false });
    store.setActiveRoom('#general');
    vi.mocked(window.electronAPI.reticulum.rrc.join).mockClear();

    render(<RrcPanel isActive />);

    const composer = screen.getByRole('textbox', { name: /Message or \/command/i });
    await user.clear(composer);
    await user.type(composer, `/join @${peerHash}`);
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(useRrcSessionStore.getState().activeRoom).toBe(`@${peerHash}`);
    });
    expect(window.electronAPI.reticulum.rrc.join).not.toHaveBeenCalled();
  });

  it('does not issue /who for an open DM room', async () => {
    const peerHash = 'dddddddddddddddddddddddddddddddd';
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.setCapabilities({ direct_notice: true });
    store.roomJoined('#general');
    store.openDm({ identity_hash: peerHash, nickname: 'Alice' }, hubA, { focus: true });
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();

    render(<RrcPanel isActive />);

    await waitFor(() => {
      expect(useRrcSessionStore.getState().rooms.has(`@${peerHash}`)).toBe(true);
    });
    // Allow the joined-room /who effect to run.
    await new Promise((r) => setTimeout(r, 30));
    const whoCalls = vi.mocked(window.electronAPI.reticulum.rrc.send).mock.calls.filter((args) => {
      const body = (args[0] as { body?: string } | undefined)?.body;
      return typeof body === 'string' && body.startsWith('/who');
    });
    expect(whoCalls.every((args) => !(args[0] as { room?: string }).room?.startsWith('@'))).toBe(
      true,
    );
    expect(whoCalls.some((args) => (args[0] as { room?: string }).room === `@${peerHash}`)).toBe(
      false,
    );
    expect(whoCalls.some((args) => (args[0] as { body?: string }).body === '/who general')).toBe(
      true,
    );
    expect(whoCalls.every((args) => (args[0] as { room?: string }).room == null)).toBe(true);
  });

  it('does not re-send /who or reconnect when remounting a populated roster', async () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('general', [
      { identity_hash: 'cccccccccccccccccccccccccccccccc', nickname: 'Alice' },
    ]);
    store.setActiveRoom('general');
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();
    vi.mocked(window.electronAPI.reticulum.rrc.disconnect).mockClear();

    const { unmount } = render(<RrcPanel isActive />);
    await waitFor(() => {
      expect(whoSendCalls()).toHaveLength(1);
    });
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
    expect(window.electronAPI.reticulum.rrc.disconnect).not.toHaveBeenCalled();

    unmount();
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();
    vi.mocked(window.electronAPI.reticulum.rrc.disconnect).mockClear();

    render(<RrcPanel isActive />);
    await new Promise((r) => setTimeout(r, 40));
    expect(whoSendCalls()).toHaveLength(0);
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
    expect(window.electronAPI.reticulum.rrc.disconnect).not.toHaveBeenCalled();
  });

  it('does not re-send /who when isActive toggles on a still-mounted panel', async () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('general', [
      { identity_hash: 'cccccccccccccccccccccccccccccccc', nickname: 'Alice' },
    ]);
    store.setActiveRoom('general');
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();
    vi.mocked(window.electronAPI.reticulum.rrc.disconnect).mockClear();

    const { rerender } = render(<RrcPanel isActive={false} />);
    await waitFor(() => {
      expect(whoSendCalls()).toHaveLength(1);
    });
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();
    rerender(<RrcPanel isActive />);
    await new Promise((r) => setTimeout(r, 40));
    expect(whoSendCalls()).toHaveLength(0);
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
    expect(window.electronAPI.reticulum.rrc.disconnect).not.toHaveBeenCalled();
  });

  it('sends one hub-global /who for an empty joined roster', async () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('general');
    store.setActiveRoom('general');
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();

    render(<RrcPanel isActive />);
    await waitFor(() => {
      expect(whoSendCalls()).toHaveLength(1);
    });
    expect(whoSendCalls()[0]?.[0]).toEqual({
      hub_dest_hash: hubA,
      body: '/who general',
      type: 'msg',
    });
  });

  it('sends one /who per empty joined room and none after remount', async () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('general');
    store.roomJoined('lobby');
    store.setActiveRoom('general');
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();

    const { unmount } = render(<RrcPanel isActive />);
    await waitFor(() => {
      expect(whoSendCalls()).toHaveLength(2);
    });
    const bodies = whoSendCalls()
      .map((args) => (args[0] as { body: string }).body)
      .sort();
    expect(bodies).toEqual(['/who general', '/who lobby']);

    unmount();
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();
    render(<RrcPanel isActive />);
    await new Promise((r) => setTimeout(r, 40));
    expect(whoSendCalls()).toHaveLength(0);
  });

  it('does not force /who when /join targets an already-joined room', async () => {
    const user = userEvent.setup();
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('general', [
      { identity_hash: 'cccccccccccccccccccccccccccccccc', nickname: 'Alice' },
    ]);
    store.setActiveRoom('[hub]');
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();
    vi.mocked(window.electronAPI.reticulum.rrc.join).mockClear();

    render(<RrcPanel isActive />);
    await waitFor(() => {
      expect(whoSendCalls()).toHaveLength(1);
    });
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();

    const composer = screen.getByRole('textbox', { name: /Message or \/command/i });
    await user.clear(composer);
    await user.type(composer, '/join general');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(useRrcSessionStore.getState().activeRoom).toBe('general');
    });
    expect(window.electronAPI.reticulum.rrc.join).not.toHaveBeenCalled();
    expect(whoSendCalls()).toHaveLength(0);
  });

  it('still sends /who from the nicklist refresh button', async () => {
    const user = userEvent.setup();
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('general', [
      { identity_hash: 'cccccccccccccccccccccccccccccccc', nickname: 'Alice' },
    ]);
    store.setActiveRoom('general');
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();

    render(<RrcPanel isActive />);
    await waitFor(() => {
      expect(whoSendCalls()).toHaveLength(1);
    });
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();

    await user.click(screen.getByRole('button', { name: 'Refresh members (/who)' }));
    await waitFor(() => {
      expect(whoSendCalls()).toHaveLength(1);
    });
    expect(whoSendCalls()[0]?.[0]).toEqual({
      hub_dest_hash: hubA,
      body: '/who general',
      type: 'msg',
    });
  });

  it('still sends hub /who after /nick', async () => {
    const user = userEvent.setup();
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('general', [
      { identity_hash: 'cccccccccccccccccccccccccccccccc', nickname: 'Alice' },
    ]);
    store.setActiveRoom('general');
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();

    render(<RrcPanel isActive />);
    const composer = screen.getByRole('textbox', { name: /Message or \/command/i });
    await user.clear(composer);
    await user.type(composer, '/nick NewNick');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.rrc.setNickname).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(whoSendCalls().some((args) => (args[0] as { body?: string }).body === '/who')).toBe(
        true,
      );
    });
  });

  it('allows auto /who again after part then rejoin', async () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('general');
    store.setActiveRoom('general');
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();

    render(<RrcPanel isActive />);
    await waitFor(() => {
      expect(whoSendCalls()).toHaveLength(1);
    });

    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();
    store.roomParted('general');
    store.roomJoined('general');
    await waitFor(() => {
      expect(whoSendCalls()).toHaveLength(1);
    });
    expect(whoSendCalls()[0]?.[0]).toEqual({
      hub_dest_hash: hubA,
      body: '/who general',
      type: 'msg',
    });
  });

  it('retries auto /who after a failed send', async () => {
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockRejectedValueOnce(new Error('offline'));
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('general');
    store.setActiveRoom('general');

    const { unmount } = render(<RrcPanel isActive />);
    await waitFor(() => {
      expect(whoSendCalls()).toHaveLength(1);
    });
    unmount();
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockResolvedValue({ ok: true });
    render(<RrcPanel isActive />);
    await waitFor(() => {
      expect(whoSendCalls()).toHaveLength(1);
    });
  });

  it('sends one /who per hub when switching focus', async () => {
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.roomJoined('general', undefined, hubA);
    store.setFocusedHub(hubA);
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();

    render(<RrcPanel isActive />);
    await waitFor(() => {
      expect(whoSendCalls()).toHaveLength(1);
      expect(whoSendCalls()[0]?.[0]).toMatchObject({
        hub_dest_hash: hubA,
        body: '/who general',
      });
    });

    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();
    store.applyStatus('active', hubB, 'Hub B');
    store.roomJoined('lobby', undefined, hubB);
    store.setFocusedHub(hubB);
    await waitFor(() => {
      expect(whoSendCalls()).toHaveLength(1);
      expect(whoSendCalls()[0]?.[0]).toMatchObject({
        hub_dest_hash: hubB,
        body: '/who lobby',
      });
    });

    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();
    store.setFocusedHub(hubA);
    await new Promise((r) => setTimeout(r, 40));
    expect(whoSendCalls()).toHaveLength(0);
  });

  it('rejects plain text in [hub] with join-room prompt', async () => {
    const user = userEvent.setup();
    const store = useRrcSessionStore.getState();
    store.applyStatus('active', hubA, 'Hub A');
    store.setCapabilities({ direct_notice: true });
    store.setActiveRoom('[hub]');
    vi.mocked(window.electronAPI.reticulum.rrc.send).mockClear();

    render(<RrcPanel isActive />);

    const composer = screen.getByRole('textbox', { name: /Message or \/command/i });
    await user.type(composer, 'hello hub');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(useRrcSessionStore.getState().lastError).toBe('Join a room to start chatting.');
    });
    expect(window.electronAPI.reticulum.rrc.send).not.toHaveBeenCalled();
  });
});
