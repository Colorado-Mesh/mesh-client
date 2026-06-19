import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import {
  mergeRoomLastReadWatermark,
  savePersistedRoomsLastRead,
  saveStarred,
  type StarredMessage,
} from '@/renderer/lib/chatPanelProtocolStorage';
import { VIRTUALIZER_SCROLL_END_THRESHOLD } from '@/renderer/lib/chatScrollUtils';
import { buildMeshcoreRoomIncomingMessage } from '@/renderer/lib/meshcoreChannelText';
import {
  clearAllMeshcoreRoomAutoLoginFailures,
  getMeshcoreRoomAutoLoginFailure,
  setMeshcoreRoomAutoLoginFailure,
} from '@/renderer/lib/meshcoreRoomAutoLoginFailure';
import {
  getMeshcoreRoomCredential,
  meshcoreRoomCredentialSettingForNode,
} from '@/renderer/lib/meshcoreRoomCredentialStorage';
import {
  meshcoreApplyRoomSession,
  meshcoreClearAllRoomSessions,
  meshcoreClearRoomSession,
} from '@/renderer/lib/meshcoreRoomSession';
import { computeRoomUnreadCounts } from '@/renderer/lib/meshcoreRoomsUnread';
import { getMeshcoreRoomSyncConfig } from '@/renderer/lib/meshcoreRoomSyncStorage';
import type { ChatMessage, MeshNode } from '@/renderer/lib/types';

import * as chatScrollUtils from '../lib/chatScrollUtils';
import RoomsPanel from './RoomsPanel';

const mockScrollToEnd = vi.fn();
const mockScrollToIndex = vi.fn();
let lastRoomsVirtualizerOptions: Record<string, unknown> | undefined;

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: Record<string, unknown> & { count: number }) => {
    lastRoomsVirtualizerOptions = opts;
    const count = opts.count;
    const instance = {
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          index,
          key: index,
          start: index * 96,
        })),
      getTotalSize: () => count * 96,
      measureElement: () => {},
      containerRef: { current: null },
      isAtEnd: () => false,
      scrollToEnd: mockScrollToEnd,
      scrollToIndex: mockScrollToIndex,
      scrollDirection: 'forward' as const,
      shouldAdjustScrollPositionOnItemSizeChange: undefined as
        | ((item: { index: number }) => boolean)
        | undefined,
    };
    return instance;
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/renderer/hooks/useMeshcoreRoomAuth', () => ({
  useMeshcoreRoomAuth: () => ({
    ensureRoomAuth: vi.fn().mockResolvedValue({
      ok: true,
      guestPassword: '',
      adminPassword: 'password',
    }),
    RemoteAuthModal: null,
  }),
}));

function makeRoom(nodeId: number, longName: string): MeshNode {
  return {
    node_id: nodeId,
    long_name: longName,
    short_name: '',
    hw_model: 'Room',
    battery: 0,
    snr: 0,
    rssi: 0,
    last_heard: Date.now() / 1000,
    latitude: null,
    longitude: null,
  };
}

function renderRoomsPanel(
  nodes: Map<number, MeshNode>,
  props: Partial<ComponentProps<typeof RoomsPanel>> = {},
) {
  const onLoginRoom = props.onLoginRoom ?? vi.fn().mockResolvedValue(undefined);
  const onCancelRoomLogin = props.onCancelRoomLogin ?? vi.fn();
  const onLeaveRoom = props.onLeaveRoom ?? vi.fn().mockResolvedValue(undefined);
  render(
    <RoomsPanel
      nodes={nodes}
      messages={[]}
      myNodeNum={1}
      isConnected
      onLoginRoom={onLoginRoom}
      onCancelRoomLogin={onCancelRoomLogin}
      onLeaveRoom={onLeaveRoom}
      onSendRoomPost={vi.fn()}
      onSendRoomAdminCli={vi.fn()}
      {...props}
    />,
  );
  return { onLoginRoom, onCancelRoomLogin, onLeaveRoom };
}

describe('RoomsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    meshcoreClearAllRoomSessions();
    clearAllMeshcoreRoomAutoLoginFailures();
  });

  it('shows login overlay for selected room when not logged in', () => {
    const room = makeRoom(0x1001, 'Test Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);

    renderRoomsPanel(nodes, { initialRoomTarget: room.node_id });

    expect(screen.getByText('roomsPanel.loginTitle')).toBeInTheDocument();
    expect(screen.getByText('roomsPanel.rememberPassword')).toBeInTheDocument();
  });

  it('disables composer when session is read-only and shows upgrade form', () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x1002, 'Readonly Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);

    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: '',
      adminPassword: '',
      role: 'readonly',
    });

    renderRoomsPanel(nodes, { initialRoomTarget: room.node_id });

    expect(screen.getByText('roomsPanel.readOnlyHint')).toBeInTheDocument();
    expect(screen.getByLabelText('roomsPanel.guestPasswordLabel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'roomsPanel.upgradeAccess' })).toBeInTheDocument();
    expect(screen.getByText('roomsPanel.autoSync')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('calls onLoginRoom when read-only user upgrades with guest password', async () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x100b, 'Upgrade Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: '',
      adminPassword: '',
      role: 'readonly',
    });
    const onLoginRoom = vi.fn().mockResolvedValue(undefined);
    renderRoomsPanel(nodes, { initialRoomTarget: room.node_id, onLoginRoom });

    fireEvent.click(screen.getByRole('button', { name: 'roomsPanel.upgradeAccess' }));

    await waitFor(() => {
      expect(onLoginRoom).toHaveBeenCalledWith(
        room.node_id,
        'hello',
        expect.objectContaining({ guestPassword: 'hello', forceRelogin: true }),
      );
    });
  });

  it('forces admin relogin when managing from a read-only session', async () => {
    const room = makeRoom(0x100c, 'Admin Elevate Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: '',
      adminPassword: '',
      role: 'readonly',
    });
    const onLoginRoom = vi.fn().mockResolvedValue(undefined);
    renderRoomsPanel(nodes, { initialRoomTarget: room.node_id, onLoginRoom });

    fireEvent.click(screen.getByText('roomsPanel.manageRoom'));

    await waitFor(() => {
      expect(onLoginRoom).toHaveBeenCalledWith(
        room.node_id,
        'password',
        expect.objectContaining({
          adminPassword: 'password',
          forceRelogin: true,
        }),
      );
    });
  });

  it('shows login form for room B while room A login is in progress', () => {
    meshcoreClearAllRoomSessions();
    const roomA = makeRoom(0x1001, 'Room A');
    const roomB = makeRoom(0x1002, 'Room B');
    const nodes = new Map<number, MeshNode>([
      [roomA.node_id, roomA],
      [roomB.node_id, roomB],
    ]);
    const onLoginRoom = vi.fn(
      () =>
        new Promise<void>(() => {
          /* hang */
        }),
    );

    renderRoomsPanel(nodes, { initialRoomTarget: roomA.node_id, onLoginRoom });
    fireEvent.click(screen.getByText('roomsPanel.loginButton'));
    expect(screen.getByText('roomsPanel.loggingIn')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Room B'));
    expect(screen.getByText('roomsPanel.loginTitle')).toBeInTheDocument();
    expect(screen.queryByText('roomsPanel.loggingIn')).not.toBeInTheDocument();
  });

  it('queues room B login while room A login is in progress', () => {
    meshcoreClearAllRoomSessions();
    const roomA = makeRoom(0x1001, 'Room A');
    const roomB = makeRoom(0x1002, 'Room B');
    const nodes = new Map<number, MeshNode>([
      [roomA.node_id, roomA],
      [roomB.node_id, roomB],
    ]);
    const onLoginRoom = vi.fn(
      () =>
        new Promise<void>(() => {
          /* hang */
        }),
    );

    renderRoomsPanel(nodes, { initialRoomTarget: roomA.node_id, onLoginRoom });
    fireEvent.click(screen.getByText('roomsPanel.loginButton'));
    fireEvent.click(screen.getByText('Room B'));
    fireEvent.click(screen.getByText('roomsPanel.loginButton'));

    expect(onLoginRoom).toHaveBeenCalledTimes(2);
    expect(
      screen.getAllByLabelText('roomsPanel.loggingInMarkerAria').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('cancel login calls onCancelRoomLogin and restores the login form', async () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x1003, 'Cancel Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    const onLoginRoom = vi.fn(
      () =>
        new Promise<void>(() => {
          /* hang */
        }),
    );
    const onCancelRoomLogin = vi.fn();

    renderRoomsPanel(nodes, {
      initialRoomTarget: room.node_id,
      onLoginRoom,
      onCancelRoomLogin,
    });
    fireEvent.click(screen.getByText('roomsPanel.loginButton'));
    await waitFor(() => {
      expect(screen.getByText('roomsPanel.loggingIn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('roomsPanel.cancelLogin'));
    expect(onCancelRoomLogin).toHaveBeenCalledWith(room.node_id);
    await waitFor(() => {
      expect(screen.getByText('roomsPanel.loginTitle')).toBeInTheDocument();
    });
  });

  it('disables Login when guest password field is empty', () => {
    const room = makeRoom(0x1004, 'Empty Guest Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    renderRoomsPanel(nodes, { initialRoomTarget: room.node_id });
    fireEvent.change(screen.getByLabelText('roomsPanel.guestPasswordLabel'), {
      target: { value: '' },
    });
    expect(screen.getByText('roomsPanel.loginButton')).toBeDisabled();
    expect(screen.getByText('roomsPanel.emptyGuestLoginHint')).toBeInTheDocument();
  });

  it('shows inbound room posts from messages prop when logged in', () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x1005, 'Live Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: '',
      adminPassword: '',
      role: 'readonly',
    });
    const messages: ChatMessage[] = [
      buildMeshcoreRoomIncomingMessage({
        rawText: 'From Android',
        roomServerId: room.node_id,
        authorId: 0x200,
        authorName: 'Alice',
        timestamp: 5000,
        receivedVia: 'rf',
      }),
    ];
    renderRoomsPanel(nodes, {
      initialRoomTarget: room.node_id,
      messages,
      myNodeNum: 0x100,
      isActive: true,
    });
    expect(screen.getByText('From Android')).toBeInTheDocument();
  });

  it('shows unread count on unselected room row', () => {
    meshcoreClearAllRoomSessions();
    const roomA = makeRoom(0x1005, 'Room A');
    const roomB = makeRoom(0x1006, 'Room B');
    const nodes = new Map<number, MeshNode>([
      [roomA.node_id, roomA],
      [roomB.node_id, roomB],
    ]);
    meshcoreApplyRoomSession(roomB.node_id, {
      guestPassword: '',
      adminPassword: '',
      role: 'readonly',
    });
    const messages: ChatMessage[] = [
      buildMeshcoreRoomIncomingMessage({
        rawText: 'New post',
        roomServerId: roomA.node_id,
        authorId: 0x200,
        authorName: 'Alice',
        timestamp: 5000,
        receivedVia: 'rf',
      }),
    ];
    expect(computeRoomUnreadCounts(messages, {}, new Set([0x100])).get(roomA.node_id)).toBe(1);
    renderRoomsPanel(nodes, {
      initialRoomTarget: roomB.node_id,
      messages,
      myNodeNum: 0x100,
    });
    const roomAButton = screen.getByRole('button', { name: /Room A/i });
    expect(roomAButton).toHaveAttribute('data-unread', '1');
  });

  it('clears compose input after successful post', async () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x1007, 'Post Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    const onSendRoomPost = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <RoomsPanel
        nodes={nodes}
        messages={[]}
        myNodeNum={1}
        isConnected
        initialRoomTarget={room.node_id}
        onLoginRoom={vi.fn().mockResolvedValue(undefined)}
        onCancelRoomLogin={vi.fn()}
        onLeaveRoom={vi.fn().mockResolvedValue(undefined)}
        onSendRoomPost={onSendRoomPost}
        onSendRoomAdminCli={vi.fn()}
      />,
    );
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hello');
    await user.click(screen.getByRole('button', { name: 'roomsPanel.postButton' }));
    await waitFor(() => {
      expect(onSendRoomPost).toHaveBeenCalledWith(room.node_id, 'hello');
    });
    expect(textarea).toHaveValue('');
  });

  it('shows inline error when post fails and keeps draft', async () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x1008, 'Fail Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    const onSendRoomPost = vi.fn().mockRejectedValue(new Error('timeout'));
    const user = userEvent.setup();
    render(
      <RoomsPanel
        nodes={nodes}
        messages={[]}
        myNodeNum={1}
        isConnected
        initialRoomTarget={room.node_id}
        onLoginRoom={vi.fn().mockResolvedValue(undefined)}
        onCancelRoomLogin={vi.fn()}
        onLeaveRoom={vi.fn().mockResolvedValue(undefined)}
        onSendRoomPost={onSendRoomPost}
        onSendRoomAdminCli={vi.fn()}
      />,
    );
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'retry me');
    await user.click(screen.getByRole('button', { name: 'roomsPanel.postButton' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('timeout');
    });
    expect(textarea).toHaveValue('retry me');
  });

  it('closes manage section when Close is clicked', async () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x1009, 'Admin Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: '',
      adminPassword: 'password',
      role: 'admin',
    });
    render(
      <RoomsPanel
        nodes={nodes}
        messages={[]}
        myNodeNum={1}
        isConnected
        initialRoomTarget={room.node_id}
        onLoginRoom={vi.fn().mockResolvedValue(undefined)}
        onCancelRoomLogin={vi.fn()}
        onLeaveRoom={vi.fn().mockResolvedValue(undefined)}
        onSendRoomPost={vi.fn()}
        onSendRoomAdminCli={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('roomsPanel.manageRoom'));
    await waitFor(() => {
      expect(screen.getByText('roomsPanel.manageHeading')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('roomsPanel.closeManage'));
    expect(screen.queryByText('roomsPanel.cliPlaceholder')).not.toBeInTheDocument();
  });

  it('shows delivery status badge on own room posts', () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x100a, 'Status Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: '',
      adminPassword: '',
      role: 'readonly',
    });
    const messages: ChatMessage[] = [
      {
        ...buildMeshcoreRoomIncomingMessage({
          rawText: 'My post',
          roomServerId: room.node_id,
          authorId: 0x100,
          authorName: 'Me',
          timestamp: 6000,
          receivedVia: 'rf',
        }),
        status: 'acked',
      },
    ];
    renderRoomsPanel(nodes, {
      initialRoomTarget: room.node_id,
      messages,
      myNodeNum: 0x100,
      connectionType: 'ble',
    });
    expect(screen.getByText(/BT/)).toBeInTheDocument();
  });

  it('shows leave in progress while onLeaveRoom is pending', async () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x100b, 'Leave Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    let resolveLeave!: () => void;
    const onLeaveRoom = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLeave = resolve;
        }),
    );

    renderRoomsPanel(nodes, {
      initialRoomTarget: room.node_id,
      onLeaveRoom,
    });

    fireEvent.click(screen.getByLabelText('roomsPanel.leaveRoom'));
    expect(screen.getByText('roomsPanel.leaveRoomInProgress')).toBeInTheDocument();
    expect(screen.getByLabelText('roomsPanel.leavingRoom')).toBeDisabled();

    resolveLeave();
    await waitFor(() => {
      expect(onLeaveRoom).toHaveBeenCalledWith(room.node_id);
    });
  });

  it('shows login overlay after leave completes and session is cleared', async () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x100c, 'Left Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    const onLeaveRoom = vi.fn((nodeId: number) => {
      meshcoreClearRoomSession(nodeId);
      return Promise.resolve();
    });

    renderRoomsPanel(nodes, {
      initialRoomTarget: room.node_id,
      onLeaveRoom,
    });

    fireEvent.click(screen.getByLabelText('roomsPanel.leaveRoom'));
    await waitFor(() => {
      expect(screen.getByText('roomsPanel.loginTitle')).toBeInTheDocument();
    });
  });

  it('shows leave error and keeps composer when onLeaveRoom fails', async () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x100d, 'Stuck Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    const onLeaveRoom = vi.fn().mockRejectedValue(new Error('Room logout timed out'));

    renderRoomsPanel(nodes, {
      initialRoomTarget: room.node_id,
      onLeaveRoom,
    });

    fireEvent.click(screen.getByLabelText('roomsPanel.leaveRoom'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Room logout timed out');
    });
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows message poster control when poster has a public key', () => {
    meshcoreClearAllRoomSessions();
    const roomId = 0x2001;
    const posterId = 0xabcd1234;
    const room = makeRoom(roomId, 'Chat Room');
    const poster: MeshNode = {
      node_id: posterId,
      long_name: 'Poster',
      short_name: '',
      hw_model: 'Companion',
      battery: 0,
      snr: 0,
      rssi: 0,
      last_heard: Date.now() / 1000,
      latitude: null,
      longitude: null,
      public_key_hex: 'aa'.repeat(32),
    };
    const nodes = new Map<number, MeshNode>([
      [room.node_id, room],
      [poster.node_id, poster],
    ]);
    meshcoreApplyRoomSession(roomId, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    const msg = buildMeshcoreRoomIncomingMessage({
      rawText: 'Hello',
      roomServerId: roomId,
      authorId: posterId,
      authorName: 'Poster',
      timestamp: Date.now(),
      receivedVia: 'rf',
    });
    const onMessageNode = vi.fn();

    renderRoomsPanel(nodes, {
      initialRoomTarget: roomId,
      messages: [msg],
      onMessageNode,
    });

    const dmButtons = screen.getAllByLabelText('nodeDetailModal.messageButton');
    const lastDmButton = dmButtons.at(-1);
    if (lastDmButton == null) throw new Error('expected DM button on room post');
    fireEvent.click(lastDmButton);
    expect(onMessageNode).toHaveBeenCalledWith(posterId);
  });

  it('persists starred room posts under meshcore storage', async () => {
    meshcoreClearAllRoomSessions();
    const roomId = 0x2002;
    const room = makeRoom(roomId, 'Star Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(roomId, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    const msg = buildMeshcoreRoomIncomingMessage({
      rawText: 'Bookmark me',
      roomServerId: roomId,
      authorId: 0x11,
      authorName: 'Author',
      timestamp: 1_700_000_000_000,
      receivedVia: 'rf',
    });

    renderRoomsPanel(nodes, { initialRoomTarget: roomId, messages: [msg] });

    await userEvent.click(screen.getByLabelText('chatPanel.starMessage'));
    const raw = localStorage.getItem('mesh-client:starred:meshcore');
    expect(raw).toBeTruthy();
    expect(raw).toContain('Bookmark me');
  });

  it('shows saved passwords section collapsed by default when credentials exist', async () => {
    const room = makeRoom(0x1020, 'Saved List Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    mergeAppSetting(
      meshcoreRoomCredentialSettingForNode(room.node_id),
      JSON.stringify({ guestPassword: 'hello' }),
      'RoomsPanel.test saved list',
    );

    renderRoomsPanel(nodes);

    expect(screen.getByText('roomsPanel.savedPasswordsCount')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'roomsPanel.forgetSavedPasswordAria' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('roomsPanel.savedPasswordsCount'));
    expect(
      screen.getAllByRole('button', { name: 'roomsPanel.forgetSavedPasswordAria' }).length,
    ).toBeGreaterThan(0);
  });

  it('forget saved password clears credential from storage', async () => {
    const room = makeRoom(0x1021, 'Forget Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    mergeAppSetting(
      meshcoreRoomCredentialSettingForNode(room.node_id),
      JSON.stringify({ guestPassword: 'hello' }),
      'RoomsPanel.test forget',
    );
    mergeAppSetting(
      `meshcoreRoomSync:${String(room.node_id >>> 0)}`,
      JSON.stringify({ enabled: true, intervalMinutes: 60, autoLoginOnConnect: true }),
      'RoomsPanel.test forget sync',
    );

    renderRoomsPanel(nodes, { initialRoomTarget: room.node_id });

    await userEvent.click(
      screen.getAllByRole('button', { name: 'roomsPanel.forgetSavedPasswordAria' })[0],
    );
    await userEvent.click(screen.getByRole('button', { name: 'roomsPanel.forgetSavedPassword' }));

    await waitFor(() => {
      expect(getMeshcoreRoomCredential(room.node_id)).toBeUndefined();
    });
    expect(getMeshcoreRoomSyncConfig(room.node_id).enabled).toBe(false);
    expect(getMeshcoreRoomSyncConfig(room.node_id).autoLoginOnConnect).toBe(false);
    expect(screen.queryByText('roomsPanel.savedPasswordsCount')).not.toBeInTheDocument();
  });

  it('login overlay shows stop auto-login when saved credential has auto-login enabled', async () => {
    const room = makeRoom(0x1022, 'Stop Auto Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    mergeAppSetting(
      meshcoreRoomCredentialSettingForNode(room.node_id),
      JSON.stringify({ guestPassword: 'hello' }),
      'RoomsPanel.test stop auto',
    );

    renderRoomsPanel(nodes, { initialRoomTarget: room.node_id });

    await waitFor(() => {
      expect(screen.getByText('roomsPanel.loginTitle')).toBeInTheDocument();
    });
    expect(screen.getByText('roomsPanel.statusPasswordSaved')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'roomsPanel.stopAutoLoginAria' }).length,
    ).toBeGreaterThan(0);
  });

  it('does not auto-login on room select when saved credentials exist', async () => {
    const room = makeRoom(0x100e, 'Saved Creds Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    mergeAppSetting(
      meshcoreRoomCredentialSettingForNode(room.node_id),
      JSON.stringify({ guestPassword: 'hello' }),
      'RoomsPanel.test saved cred',
    );

    renderRoomsPanel(nodes, {
      initialRoomTarget: room.node_id,
    });

    await waitFor(() => {
      expect(screen.getByText('roomsPanel.loginTitle')).toBeInTheDocument();
    });
  });

  it('shows red ring on room marker when auto-login failed', () => {
    const room = makeRoom(0x100f, 'Failed Auto Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    setMeshcoreRoomAutoLoginFailure(room.node_id, 'timeout');

    renderRoomsPanel(nodes);

    const marker = screen.getByLabelText('roomsPanel.autoLoginFailedAria');
    expect(marker.className).toContain('ring-red-500');
  });

  it('clears auto-login failure when re-enabling auto-login on connect', async () => {
    const room = makeRoom(0x1023, 'Re-enable Auto Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    mergeAppSetting(
      meshcoreRoomCredentialSettingForNode(room.node_id),
      JSON.stringify({ guestPassword: 'hello' }),
      'RoomsPanel.test re-enable auto',
    );
    mergeAppSetting(
      `meshcoreRoomSync:${String(room.node_id >>> 0)}`,
      JSON.stringify({ enabled: false, intervalMinutes: 60, autoLoginOnConnect: false }),
      'RoomsPanel.test re-enable sync',
    );
    setMeshcoreRoomAutoLoginFailure(room.node_id, 'wrong password');
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });

    renderRoomsPanel(nodes, { initialRoomTarget: room.node_id });

    const checkbox = screen.getByRole('checkbox', { name: 'roomsPanel.autoLoginOnConnect' });
    expect(checkbox).not.toBeChecked();
    await userEvent.click(checkbox);

    await waitFor(() => {
      expect(getMeshcoreRoomSyncConfig(room.node_id).autoLoginOnConnect).toBe(true);
    });
    expect(getMeshcoreRoomAutoLoginFailure(room.node_id)).toBeUndefined();
    expect(screen.queryByLabelText('roomsPanel.autoLoginFailedAria')).not.toBeInTheDocument();
  });

  it('clears auto-login failure marker after successful manual login', async () => {
    const room = makeRoom(0x1010, 'Recover Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    setMeshcoreRoomAutoLoginFailure(room.node_id, 'timeout');
    const onLoginRoom = vi.fn().mockImplementation(() => {
      meshcoreApplyRoomSession(room.node_id, {
        guestPassword: 'hello',
        adminPassword: '',
        role: 'readwrite',
      });
    });

    renderRoomsPanel(nodes, { initialRoomTarget: room.node_id, onLoginRoom });

    await userEvent.click(screen.getByRole('button', { name: 'roomsPanel.loginButton' }));
    await waitFor(() => {
      expect(onLoginRoom).toHaveBeenCalled();
    });
    expect(screen.queryByLabelText('roomsPanel.autoLoginFailedAria')).not.toBeInTheDocument();
  });

  it('locks post stream scroll inside a fixed-height flex column', () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x1011, 'Scroll Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });

    render(
      <div className="flex flex-col" style={{ height: '600px' }}>
        <RoomsPanel
          nodes={nodes}
          messages={[]}
          myNodeNum={1}
          isConnected
          isActive
          initialRoomTarget={room.node_id}
          onLoginRoom={vi.fn().mockResolvedValue(undefined)}
          onCancelRoomLogin={vi.fn()}
          onLeaveRoom={vi.fn().mockResolvedValue(undefined)}
          onSendRoomPost={vi.fn()}
          onSendRoomAdminCli={vi.fn()}
        />
      </div>,
    );

    const stream = screen.getByTestId('rooms-post-stream');
    expect(stream).toHaveClass('overflow-y-auto', 'overscroll-contain', '[overflow-anchor:none]');
    expect(stream.parentElement).toHaveClass('min-h-0', 'flex-1');
    expect(screen.getByTestId('rooms-composer-footer')).toHaveClass('shrink-0');
  });

  it('restores stream scrollTop on tab re-entry instead of leaving it at the value set while hidden', () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x1017, 'Scroll Restore Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    const commonProps = {
      nodes,
      messages: [],
      myNodeNum: 1,
      isConnected: true,
      initialRoomTarget: room.node_id,
      onLoginRoom: vi.fn().mockResolvedValue(undefined),
      onCancelRoomLogin: vi.fn(),
      onLeaveRoom: vi.fn().mockResolvedValue(undefined),
      onSendRoomPost: vi.fn(),
      onSendRoomAdminCli: vi.fn(),
    };

    const { rerender } = render(<RoomsPanel {...commonProps} isActive />);

    const stream = screen.getByTestId('rooms-post-stream');
    Object.defineProperty(stream, 'scrollTop', {
      value: 500,
      writable: true,
      configurable: true,
    });
    // isAtEnd is mocked false, so this marks the user as reading history (not
    // pinned) before leaving — otherwise the pinned-snapshot branch would
    // scrollToEnd() on return instead of restoring the raw scrollTop.
    fireEvent.scroll(stream);

    rerender(<RoomsPanel {...commonProps} isActive={false} />);

    // Simulate the scroll position drifting while the tab is hidden (e.g. a stale
    // virtualizer recalculation against the collapsed 0x0 `display: none` container).
    (stream as HTMLDivElement).scrollTop = 0;

    rerender(<RoomsPanel {...commonProps} isActive />);

    expect((stream as HTMLDivElement).scrollTop).toBe(500);
  });

  it('scrolls to end on tab re-entry when pinned and posts grew while away', () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x1018, 'Pinned Restore Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    const commonProps = {
      nodes,
      messages: [],
      myNodeNum: 1,
      isConnected: true,
      initialRoomTarget: room.node_id,
      onLoginRoom: vi.fn().mockResolvedValue(undefined),
      onCancelRoomLogin: vi.fn(),
      onLeaveRoom: vi.fn().mockResolvedValue(undefined),
      onSendRoomPost: vi.fn(),
      onSendRoomAdminCli: vi.fn(),
    };

    const { rerender } = render(<RoomsPanel {...commonProps} isActive />);

    const stream = screen.getByTestId('rooms-post-stream');
    Object.defineProperty(stream, 'scrollTop', {
      value: 400,
      writable: true,
      configurable: true,
    });
    // Stays pinned (no scroll event fired — isPinnedToBottomRef defaults true).
    rerender(<RoomsPanel {...commonProps} isActive={false} />);

    mockScrollToEnd.mockClear();
    mockScrollToEnd.mockImplementation(() => {
      (stream as HTMLDivElement).scrollTop = 900;
    });

    rerender(<RoomsPanel {...commonProps} isActive />);

    // The pinned snapshot must win outright — a stale raw-scrollTop restore
    // running after scrollToEnd() would clobber it back to the pre-thaw value.
    expect(mockScrollToEnd).toHaveBeenCalled();
    expect((stream as HTMLDivElement).scrollTop).toBe(900);
  });

  it('does not re-fire the unread-divider scroll on a bare tab return (only the raw restore should run)', () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x1019, 'Divider Restore Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    savePersistedRoomsLastRead(mergeRoomLastReadWatermark({}, room.node_id, 1000));
    const messages: ChatMessage[] = [
      buildMeshcoreRoomIncomingMessage({
        rawText: 'Older post',
        roomServerId: room.node_id,
        authorId: 0x200,
        authorName: 'Alice',
        timestamp: 2000,
        receivedVia: 'rf',
      }),
      buildMeshcoreRoomIncomingMessage({
        rawText: 'Unread post',
        roomServerId: room.node_id,
        authorId: 0x201,
        authorName: 'Bob',
        timestamp: 5000,
        receivedVia: 'rf',
      }),
    ];
    const commonProps = {
      nodes,
      messages,
      myNodeNum: 1,
      isConnected: true,
      initialRoomTarget: room.node_id,
      onLoginRoom: vi.fn().mockResolvedValue(undefined),
      onCancelRoomLogin: vi.fn(),
      onLeaveRoom: vi.fn().mockResolvedValue(undefined),
      onSendRoomPost: vi.fn(),
      onSendRoomAdminCli: vi.fn(),
    };
    // Keeps distFromBottom large so applyNearBottomReadState doesn't clear the
    // divider via setUnreadDividerTimestamp(0) before the test exercises it.
    const distSpy = vi.spyOn(chatScrollUtils, 'getDistFromChatBottom').mockReturnValue(300);

    try {
      const { rerender } = render(<RoomsPanel {...commonProps} isActive />);

      const stream = screen.getByTestId('rooms-post-stream');
      Object.defineProperty(stream, 'scrollTop', {
        value: 250,
        writable: true,
        configurable: true,
      });
      fireEvent.scroll(stream);

      mockScrollToIndex.mockClear();

      rerender(<RoomsPanel {...commonProps} isActive={false} />);
      rerender(<RoomsPanel {...commonProps} isActive />);

      expect(mockScrollToIndex).not.toHaveBeenCalled();
      expect((stream as HTMLDivElement).scrollTop).toBe(250);
    } finally {
      distSpy.mockRestore();
    }
  });

  it('lets an explicit Go to message jump win over the room-switch unread/end scroll', async () => {
    meshcoreClearAllRoomSessions();
    const roomA = makeRoom(0x1021, 'Origin Room');
    const roomB = makeRoom(0x1022, 'Target Room');
    const nodes = new Map<number, MeshNode>([
      [roomA.node_id, roomA],
      [roomB.node_id, roomB],
    ]);
    meshcoreApplyRoomSession(roomA.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    meshcoreApplyRoomSession(roomB.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });

    const targetMsg = buildMeshcoreRoomIncomingMessage({
      rawText: 'Find me',
      roomServerId: roomB.node_id,
      authorId: 0x200,
      authorName: 'Alice',
      timestamp: 5000,
      receivedVia: 'rf',
    });
    const starId = `room:${roomB.node_id}:${Math.floor(targetMsg.timestamp / 1000)}:${targetMsg.sender_id}`;
    const starred: StarredMessage[] = [
      {
        starId,
        timestamp: targetMsg.timestamp,
        payload: targetMsg.payload,
        sender_name: targetMsg.sender_name,
        sender_id: targetMsg.sender_id,
        viewKey: `room:${roomB.node_id}`,
        channel: targetMsg.channel,
        to: targetMsg.to ?? null,
        starredAt: Date.now(),
      },
    ];
    saveStarred('meshcore', starred);

    renderRoomsPanel(nodes, {
      initialRoomTarget: roomA.node_id,
      messages: [targetMsg],
      isActive: true,
    });

    await userEvent.click(screen.getByLabelText('chatPanel.starredMessages'));
    mockScrollToEnd.mockClear();
    mockScrollToIndex.mockClear();

    await userEvent.click(screen.getByLabelText('chatPanel.goToMessage'));

    // The room switch (roomA -> roomB) has no unread divider, so without the
    // scrollToRowKey guard it would also call scrollToEnd() here — clobbering
    // the explicit jump-to-message the user actually asked for.
    expect(mockScrollToEnd).not.toHaveBeenCalled();
    expect(mockScrollToIndex).toHaveBeenCalledWith(0, { align: 'center', behavior: 'smooth' });
  });

  it('shows new messages divider when selecting a room with unread posts', async () => {
    meshcoreClearAllRoomSessions();
    const roomA = makeRoom(0x1012, 'Unread Room');
    const roomB = makeRoom(0x1013, 'Current Room');
    const nodes = new Map<number, MeshNode>([
      [roomA.node_id, roomA],
      [roomB.node_id, roomB],
    ]);
    meshcoreApplyRoomSession(roomA.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    meshcoreApplyRoomSession(roomB.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    savePersistedRoomsLastRead(mergeRoomLastReadWatermark({}, roomA.node_id, 1000));
    const messages: ChatMessage[] = [
      buildMeshcoreRoomIncomingMessage({
        rawText: 'Unread post',
        roomServerId: roomA.node_id,
        authorId: 0x200,
        authorName: 'Alice',
        timestamp: 5000,
        receivedVia: 'rf',
      }),
    ];
    const distSpy = vi.spyOn(chatScrollUtils, 'getDistFromChatBottom').mockReturnValue(300);

    try {
      renderRoomsPanel(nodes, {
        initialRoomTarget: roomB.node_id,
        messages,
        isActive: true,
      });

      await userEvent.click(screen.getByRole('button', { name: /Unread Room/i }));
      expect(await screen.findByText('roomsPanel.newMessagesDivider')).toBeInTheDocument();
    } finally {
      distSpy.mockRestore();
    }
  });

  it('jump-to-unread button scrolls toward the unread divider', async () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x1014, 'Jump Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    savePersistedRoomsLastRead(mergeRoomLastReadWatermark({}, room.node_id, 1000));
    const messages: ChatMessage[] = [
      buildMeshcoreRoomIncomingMessage({
        rawText: 'Older post',
        roomServerId: room.node_id,
        authorId: 0x200,
        authorName: 'Alice',
        timestamp: 2000,
        receivedVia: 'rf',
      }),
      buildMeshcoreRoomIncomingMessage({
        rawText: 'Unread post',
        roomServerId: room.node_id,
        authorId: 0x201,
        authorName: 'Bob',
        timestamp: 5000,
        receivedVia: 'rf',
      }),
    ];
    const distSpy = vi.spyOn(chatScrollUtils, 'getDistFromChatBottom').mockReturnValue(300);
    const scrollIntoView = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrollIntoView);
    mockScrollToIndex.mockClear();

    renderRoomsPanel(nodes, {
      initialRoomTarget: room.node_id,
      messages,
      isActive: true,
    });

    const jumpButton = await screen.findByRole('button', { name: 'roomsPanel.jumpToUnread' });
    await userEvent.click(jumpButton);

    expect(mockScrollToIndex).toHaveBeenLastCalledWith(0, {
      align: 'start',
      behavior: 'smooth',
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
    distSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('configures TanStack Virtual with rooms scroll contract', () => {
    meshcoreClearAllRoomSessions();
    const room = makeRoom(0x1015, 'Virtual Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);
    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    renderRoomsPanel(nodes, {
      initialRoomTarget: room.node_id,
      messages: [
        buildMeshcoreRoomIncomingMessage({
          rawText: 'hello',
          roomServerId: room.node_id,
          authorId: 0x200,
          authorName: 'Alice',
          timestamp: 2000,
          receivedVia: 'rf',
        }),
      ],
      isActive: true,
    });
    expect(lastRoomsVirtualizerOptions?.anchorTo).toBe('end');
    expect(lastRoomsVirtualizerOptions?.followOnAppend).toBe(true);
    expect(lastRoomsVirtualizerOptions?.scrollEndThreshold).toBe(VIRTUALIZER_SCROLL_END_THRESHOLD);
    expect(lastRoomsVirtualizerOptions?.measureElement).toBeTypeOf('function');
  });
});
