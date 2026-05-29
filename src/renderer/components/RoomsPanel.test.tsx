import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { meshcoreApplyRoomSession } from '@/renderer/lib/meshcoreRoomSession';
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

describe('RoomsPanel', () => {
  it('shows login overlay for selected room when not logged in', () => {
    const room: MeshNode = {
      node_id: 0x1001,
      long_name: 'Test Room',
      short_name: '',
      hw_model: 'Room',
      battery: 0,
      snr: 0,
      rssi: 0,
      last_heard: Date.now() / 1000,
      latitude: null,
      longitude: null,
    };
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);

    render(
      <RoomsPanel
        nodes={nodes}
        messages={[]}
        myNodeNum={1}
        isConnected
        initialRoomTarget={room.node_id}
        onLoginRoom={vi.fn()}
        onLoginRoomWithSaved={vi.fn()}
        onSendRoomPost={vi.fn()}
        onSendRoomAdminCli={vi.fn()}
      />,
    );

    expect(screen.getByText('roomsPanel.loginTitle')).toBeInTheDocument();
    expect(screen.getByText('roomsPanel.rememberPassword')).toBeInTheDocument();
  });

  it('disables composer when session is read-only', () => {
    const room: MeshNode = {
      node_id: 0x1002,
      long_name: 'Readonly Room',
      short_name: '',
      hw_model: 'Room',
      battery: 0,
      snr: 0,
      rssi: 0,
      last_heard: Date.now() / 1000,
      latitude: null,
      longitude: null,
    };
    const nodes = new Map<number, MeshNode>([[room.node_id, room]]);

    meshcoreApplyRoomSession(room.node_id, {
      guestPassword: '',
      adminPassword: '',
      role: 'readonly',
    });

    render(
      <RoomsPanel
        nodes={nodes}
        messages={[]}
        myNodeNum={1}
        isConnected
        initialRoomTarget={room.node_id}
        onLoginRoom={vi.fn()}
        onLoginRoomWithSaved={vi.fn()}
        onSendRoomPost={vi.fn()}
        onSendRoomAdminCli={vi.fn()}
      />,
    );

    expect(screen.getByText('roomsPanel.readOnlyHint')).toBeInTheDocument();
    expect(screen.getByText('roomsPanel.autoSync')).toBeInTheDocument();
  });
});
