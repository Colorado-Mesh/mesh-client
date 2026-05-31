import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  meshcoreApplyRoomSession,
  meshcoreClearAllRoomSessions,
} from '@/renderer/lib/meshcoreRoomSession';

import { useMeshcoreRoomAuth } from './useMeshcoreRoomAuth';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function RoomAuthProbe({
  nodeId,
  mode,
  roomName,
}: {
  nodeId: number;
  mode: 'guest' | 'admin';
  roomName: string;
}) {
  const { ensureRoomAuth, RemoteAuthModal } = useMeshcoreRoomAuth();
  const [result, setResult] = useState<{
    ok: boolean;
    guestPassword: string;
    adminPassword: string;
  } | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void ensureRoomAuth(nodeId, mode, roomName).then(setResult);
        }}
      >
        request-auth
      </button>
      {result != null && (
        <output data-testid="auth-result">
          {JSON.stringify({ ok: result.ok, guestPassword: result.guestPassword })}
        </output>
      )}
      {RemoteAuthModal}
    </>
  );
}

describe('useMeshcoreRoomAuth', () => {
  beforeEach(() => {
    meshcoreClearAllRoomSessions();
  });

  it('resolves guest auth immediately for readwrite session', async () => {
    meshcoreApplyRoomSession(0xabc, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });

    render(<RoomAuthProbe nodeId={0xabc} mode="guest" roomName="Test Room" />);
    fireEvent.click(screen.getByText('request-auth'));

    await waitFor(() => {
      expect(screen.getByTestId('auth-result')).toHaveTextContent(
        JSON.stringify({ ok: true, guestPassword: 'hello' }),
      );
    });
    expect(screen.queryByText('roomsPanel.loginTitle')).not.toBeInTheDocument();
  });

  it('opens guest modal for read-only session without continue read-only', async () => {
    meshcoreApplyRoomSession(0xabc, {
      guestPassword: '',
      adminPassword: '',
      role: 'readonly',
    });

    render(<RoomAuthProbe nodeId={0xabc} mode="guest" roomName="Test Room" />);
    fireEvent.click(screen.getByText('request-auth'));

    expect(await screen.findByText('roomsPanel.loginTitle')).toBeInTheDocument();
    expect(screen.queryByText('roomsPanel.continueReadOnly')).not.toBeInTheDocument();
    expect(screen.queryByTestId('auth-result')).not.toBeInTheDocument();
  });

  it('shows continue read-only in guest modal when not logged in', async () => {
    render(<RoomAuthProbe nodeId={0xdef} mode="guest" roomName="Fresh Room" />);
    fireEvent.click(screen.getByText('request-auth'));

    expect(await screen.findByText('roomsPanel.loginTitle')).toBeInTheDocument();
    expect(screen.getByText('roomsPanel.continueReadOnly')).toBeInTheDocument();
  });
});
