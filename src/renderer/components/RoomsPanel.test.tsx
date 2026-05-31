import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { buildMeshcoreRoomIncomingMessage } from '@/renderer/lib/meshcoreChannelText';
import {
  meshcoreApplyRoomSession,
  meshcoreClearAllRoomSessions,
} from '@/renderer/lib/meshcoreRoomSession';
import { computeRoomUnreadCounts } from '@/renderer/lib/meshcoreRoomsUnread';
import type { ChatMessage, MeshNode } from '@/renderer/lib/types';

import RoomsPanel from './RoomsPanel';

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
  const onLoginRoomWithSaved = props.onLoginRoomWithSaved ?? vi.fn().mockResolvedValue(undefined);
  const onCancelRoomLogin = props.onCancelRoomLogin ?? vi.fn();
  render(
    <RoomsPanel
      nodes={nodes}
      messages={[]}
      myNodeNum={1}
      isConnected
      onLoginRoom={onLoginRoom}
      onLoginRoomWithSaved={onLoginRoomWithSaved}
      onCancelRoomLogin={onCancelRoomLogin}
      onSendRoomPost={vi.fn()}
      onSendRoomAdminCli={vi.fn()}
      {...props}
    />,
  );
  return { onLoginRoom, onLoginRoomWithSaved, onCancelRoomLogin };
}

describe('RoomsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    meshcoreClearAllRoomSessions();
  });

  it('shows login overlay for selected room when not logged in', () => {
    const room = makeRoom(0x1001, 'Test Room');
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);

    renderRoomsPanel(nodes, { initialRoomTarget: room.node_id });

    expect(screen.getByText('roomsPanel.loginTitle')).toBeInTheDocument();
    expect(screen.getByText('roomsPanel.rememberPassword')).toBeInTheDocument();
  });

  it('disables composer when session is read-only', () => {
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
    expect(screen.getByText('roomsPanel.autoSync')).toBeInTheDocument();
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

  it('allows starting login on room B while room A login is in progress', () => {
    meshcoreClearAllRoomSessions();
    const roomA = makeRoom(0x1001, 'Room A');
    const roomB = makeRoom(0x1002, 'Room B');
    const nodes = new Map<number, MeshNode>([
      [roomA.node_id, roomA],
      [roomB.node_id, roomB],
    ]);
    const onLoginRoom = vi.fn((nodeId: number) => {
      if (nodeId === roomA.node_id) {
        return new Promise<void>(() => {
          /* hang */
        });
      }
      return Promise.resolve();
    });

    renderRoomsPanel(nodes, { initialRoomTarget: roomA.node_id, onLoginRoom });
    fireEvent.click(screen.getByText('roomsPanel.loginButton'));
    fireEvent.click(screen.getByText('Room B'));
    fireEvent.click(screen.getByText('roomsPanel.loginButton'));

    expect(onLoginRoom).toHaveBeenCalledWith(
      roomB.node_id,
      expect.any(String),
      expect.objectContaining({ guestPassword: expect.any(String) }),
    );
    expect(screen.getByText('roomsPanel.loggingIn')).toBeInTheDocument();
  });

  it('cancel login calls onCancelRoomLogin and restores the login form', () => {
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
    expect(screen.getByText('roomsPanel.loggingIn')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('roomsPanel.cancelLogin'));
    expect(onCancelRoomLogin).toHaveBeenCalledWith(room.node_id);
    expect(screen.getByText('roomsPanel.loginTitle')).toBeInTheDocument();
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
        onLoginRoomWithSaved={vi.fn().mockResolvedValue(undefined)}
        onCancelRoomLogin={vi.fn()}
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
        onLoginRoomWithSaved={vi.fn().mockResolvedValue(undefined)}
        onCancelRoomLogin={vi.fn()}
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
        onLoginRoomWithSaved={vi.fn().mockResolvedValue(undefined)}
        onCancelRoomLogin={vi.fn()}
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
});
