import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY, mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import { clearAllRoomEphemeralAdminPasswords } from '@/renderer/lib/meshcoreInfraAdminSecrets';
import { meshcoreRepeaterCredentialSettingForNode } from '@/renderer/lib/meshcoreRepeaterCredentialStorage';
import {
  clearAllMeshcoreRepeaterEphemeralPasswords,
  setMeshcoreRepeaterEphemeralPassword,
} from '@/renderer/lib/meshcoreRepeaterSession';
import {
  getMeshcoreRoomCredential,
  meshcoreRoomCredentialSettingForNode,
  setMeshcoreRoomCredential,
} from '@/renderer/lib/meshcoreRoomCredentialStorage';

import { useMeshcoreRepeaterRemoteAuth } from './useMeshcoreRepeaterRemoteAuth';

const addToastMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

function RepeaterAuthProbe({
  nodeId,
  repeaterName,
  hwModel,
  onAuthed,
}: {
  nodeId: number;
  repeaterName: string;
  hwModel?: string;
  onAuthed?: () => void;
}) {
  const { ensureRepeaterAuth, RemoteAuthModal } = useMeshcoreRepeaterRemoteAuth();
  const [result, setResult] = useState<{ ok: boolean; saved?: boolean } | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void ensureRepeaterAuth(nodeId, repeaterName, hwModel)
            .then((auth) => {
              setResult(auth);
              if (auth.ok) onAuthed?.();
            })
            .catch(() => {
              // catch-no-log-ok: test probe — rejection asserted via UI state absence
            });
        }}
      >
        request-auth
      </button>
      {result != null && <output data-testid="auth-result">{JSON.stringify(result)}</output>}
      {RemoteAuthModal}
    </>
  );
}

describe('useMeshcoreRepeaterRemoteAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllMeshcoreRepeaterEphemeralPasswords();
    clearAllRoomEphemeralAdminPasswords();
    vi.mocked(window.electronAPI.appSettings.set).mockClear();
    addToastMock.mockClear();
  });

  it('resolves immediately when a saved credential exists', async () => {
    mergeAppSetting(
      meshcoreRepeaterCredentialSettingForNode(0xabc),
      JSON.stringify({ password: 'secret' }),
      'useMeshcoreRepeaterRemoteAuth.test',
    );

    render(<RepeaterAuthProbe nodeId={0xabc} repeaterName="Test Repeater" />);
    fireEvent.click(screen.getByText('request-auth'));

    await waitFor(() => {
      expect(screen.getByTestId('auth-result')).toHaveTextContent(JSON.stringify({ ok: true }));
    });
    expect(screen.queryByText('repeatersPanel.remoteAuthTitle')).not.toBeInTheDocument();
  });

  it('opens modal when no saved credential exists', async () => {
    render(<RepeaterAuthProbe nodeId={0xdef} repeaterName="Fresh Repeater" />);
    fireEvent.click(screen.getByText('request-auth'));

    expect(await screen.findByText('repeatersPanel.remoteAuthTitle')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-result')).not.toBeInTheDocument();
  });

  it('resolves immediately when an ephemeral session password exists', async () => {
    setMeshcoreRepeaterEphemeralPassword(0xdef, 'session-only');

    render(<RepeaterAuthProbe nodeId={0xdef} repeaterName="Fresh Repeater" />);
    fireEvent.click(screen.getByText('request-auth'));

    await waitFor(() => {
      expect(screen.getByTestId('auth-result')).toHaveTextContent(JSON.stringify({ ok: true }));
    });
    expect(screen.queryByText('repeatersPanel.remoteAuthTitle')).not.toBeInTheDocument();
  });

  it('continues the awaiting action after Continue even when Remember persist fails', async () => {
    const onAuthed = vi.fn();
    vi.mocked(window.electronAPI.appSettings.set).mockRejectedValueOnce(new Error('ipc down'));

    const user = userEvent.setup();
    render(<RepeaterAuthProbe nodeId={0xdef} repeaterName="Fresh Repeater" onAuthed={onAuthed} />);

    await user.click(screen.getByText('request-auth'));
    await user.type(screen.getByLabelText('repeatersPanel.remoteAuthLabel'), 'secret');
    await user.click(screen.getByText('repeatersPanel.remoteAuthContinue'));

    await waitFor(() => {
      expect(screen.getByTestId('auth-result')).toHaveTextContent(
        JSON.stringify({ ok: true, saved: false }),
      );
    });
    expect(onAuthed).toHaveBeenCalledTimes(1);
    expect(addToastMock).toHaveBeenCalledWith('repeatersPanel.rememberPasswordSaveFailed', 'error');
  });

  it('skips modal when room has saved admin password', async () => {
    await setMeshcoreRoomCredential(0x111, { guestPassword: '', adminPassword: 'room-admin' });
    render(<RepeaterAuthProbe nodeId={0x111} repeaterName="Room A" hwModel="Room" />);
    fireEvent.click(screen.getByText('request-auth'));
    await waitFor(() => {
      expect(screen.getByTestId('auth-result')).toHaveTextContent(JSON.stringify({ ok: true }));
    });
    expect(screen.queryByText('repeatersPanel.remoteAuthTitle')).not.toBeInTheDocument();
  });

  it('Remember for Room writes room credential adminPassword not repeater key', async () => {
    const user = userEvent.setup();
    render(<RepeaterAuthProbe nodeId={0x222} repeaterName="Room B" hwModel="Room" />);
    await user.click(screen.getByText('request-auth'));
    await user.type(screen.getByLabelText('repeatersPanel.remoteAuthLabel'), 'room-secret');
    await user.click(screen.getByText('repeatersPanel.remoteAuthContinue'));

    await waitFor(() => {
      expect(screen.getByTestId('auth-result')).toHaveTextContent(
        JSON.stringify({ ok: true, saved: true }),
      );
    });
    expect(getMeshcoreRoomCredential(0x222)?.adminPassword).toBe('room-secret');
    expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '').toContain(
      meshcoreRoomCredentialSettingForNode(0x222),
    );
    expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '').not.toContain(
      meshcoreRepeaterCredentialSettingForNode(0x222),
    );
  });
});
