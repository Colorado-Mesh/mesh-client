import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from '../lib/appSettingsStorage';
import { clearAllRoomEphemeralAdminPasswords } from '../lib/meshcoreInfraAdminSecrets';
import { meshcoreRepeaterCredentialSettingForNode } from '../lib/meshcoreRepeaterCredentialStorage';
import { clearAllMeshcoreRepeaterEphemeralPasswords } from '../lib/meshcoreRepeaterSession';
import {
  getMeshcoreRoomCredential,
  meshcoreRoomCredentialSettingForNode,
  setMeshcoreRoomCredential,
} from '../lib/meshcoreRoomCredentialStorage';
import type { MeshNode } from '../lib/types';
import RepeatersPanel from './RepeatersPanel';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number; enabled?: boolean }) => {
    const total = opts.count;
    return {
      getVirtualItems: () =>
        Array.from({ length: total }, (_, index) => ({
          index,
          start: index * 48,
          end: (index + 1) * 48,
          size: 48,
          key: index,
          lane: 0,
        })),
      getTotalSize: () => total * 48,
      measureElement: vi.fn(),
      measure: vi.fn(),
    };
  },
}));

vi.mock('./Toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

const repeater: MeshNode = {
  node_id: 0xabc,
  long_name: 'Test Repeater',
  short_name: 'TR',
  hw_model: 'Repeater',
  snr: 2,
  battery: 100,
  last_heard: Math.floor(Date.now() / 1000),
  latitude: null,
  longitude: null,
};

const room: MeshNode = {
  node_id: 0xdef,
  long_name: 'Test Room',
  short_name: 'RM',
  hw_model: 'Room',
  snr: 2,
  battery: 100,
  last_heard: Math.floor(Date.now() / 1000),
  latitude: null,
  longitude: null,
};

function makeProps(
  overrides: Partial<ComponentProps<typeof RepeatersPanel>> = {},
): ComponentProps<typeof RepeatersPanel> {
  return {
    nodes: new Map([[repeater.node_id, repeater]]),
    meshcoreNodeStatus: new Map(),
    meshcoreTraceResults: new Map(),
    onRequestRepeaterStatus: vi.fn().mockResolvedValue(undefined),
    onPing: vi.fn().mockResolvedValue(undefined),
    onDeleteRepeater: vi.fn().mockResolvedValue(undefined),
    isConnected: true,
    ...overrides,
  };
}

describe('RepeatersPanel repeater auth', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllMeshcoreRepeaterEphemeralPasswords();
    clearAllRoomEphemeralAdminPasswords();
    vi.mocked(window.electronAPI.appSettings.set).mockClear();
    vi.mocked(window.electronAPI.appSettings.set).mockResolvedValue({ changes: 1 });
  });

  it('continues Status after Continue with password in auth modal', async () => {
    const user = userEvent.setup();
    const onRequestRepeaterStatus = vi.fn().mockResolvedValue(undefined);
    render(<RepeatersPanel {...makeProps({ onRequestRepeaterStatus })} />);

    await user.click(screen.getByRole('button', { name: 'Request status' }));
    await user.type(screen.getByLabelText('Admin password (optional)'), 'repeater-secret');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onRequestRepeaterStatus).toHaveBeenCalledWith(repeater.node_id);
  });

  it('continues Status after Continue when Remember persist fails', async () => {
    vi.mocked(window.electronAPI.appSettings.set).mockRejectedValueOnce(new Error('ipc down'));
    const user = userEvent.setup();
    const onRequestRepeaterStatus = vi.fn().mockResolvedValue(undefined);
    render(<RepeatersPanel {...makeProps({ onRequestRepeaterStatus })} />);

    await user.click(screen.getByRole('button', { name: 'Request status' }));
    await user.type(screen.getByLabelText('Admin password (optional)'), 'repeater-secret');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onRequestRepeaterStatus).toHaveBeenCalledWith(repeater.node_id);
  });

  it('Room Status Remember writes room adminPassword not repeater key', async () => {
    const user = userEvent.setup();
    const onRequestRepeaterStatus = vi.fn().mockResolvedValue(undefined);
    render(
      <RepeatersPanel
        {...makeProps({
          nodes: new Map([[room.node_id, room]]),
          onRequestRepeaterStatus,
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Request status' }));
    await user.type(screen.getByLabelText('Admin password (optional)'), 'room-admin');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(onRequestRepeaterStatus).toHaveBeenCalledWith(room.node_id);
    });
    expect(getMeshcoreRoomCredential(room.node_id)?.adminPassword).toBe('room-admin');
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '';
    expect(raw).toContain(meshcoreRoomCredentialSettingForNode(room.node_id));
    expect(raw).not.toContain(meshcoreRepeaterCredentialSettingForNode(room.node_id));
  });

  it('Room Status skips auth modal when admin password is already saved', async () => {
    await setMeshcoreRoomCredential(room.node_id, {
      guestPassword: '',
      adminPassword: 'saved',
    });
    const onRequestRepeaterStatus = vi.fn().mockResolvedValue(undefined);
    render(
      <RepeatersPanel
        {...makeProps({
          nodes: new Map([[room.node_id, room]]),
          onRequestRepeaterStatus,
        })}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Request status' }));
    expect(screen.queryByLabelText('Admin password (optional)')).not.toBeInTheDocument();
    expect(onRequestRepeaterStatus).toHaveBeenCalledWith(room.node_id);
  });
});
