import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  meshcoreApplyRoomSession,
  meshcoreClearAllRoomSessions,
} from '@/renderer/lib/meshcoreRoomSession';
import type { MeshNode } from '@/renderer/lib/types';

import RoomsPanel from './RoomsPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/renderer/hooks/useMeshcoreRoomAuth', () => ({
  useMeshcoreRoomAuth: () => ({
    ensureRoomAuth: vi.fn().mockResolvedValue({ ok: true, guestPassword: '', adminPassword: '' }),
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
});
