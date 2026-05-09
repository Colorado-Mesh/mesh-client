import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SecurityPanel from './SecurityPanel';
import { ToastProvider } from './Toast';

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

function makeSecurityConfig() {
  return {
    publicKey: new Uint8Array(32).fill(0x01),
    privateKey: new Uint8Array(32).fill(0x02),
    adminKey: [] as Uint8Array[],
    isManaged: false,
    serialEnabled: false,
    debugLogApiEnabled: false,
    adminChannelEnabled: false,
  };
}

describe('SecurityPanel', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.clear();
    vi.mocked(window.electronAPI.safeStorage.isAvailable).mockResolvedValue(false);
    vi.mocked(window.electronAPI.safeStorage.encrypt).mockResolvedValue(null);
    vi.mocked(window.electronAPI.safeStorage.decrypt).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows connect hint when disconnected', () => {
    renderWithToast(
      <SecurityPanel
        onSetConfig={vi.fn().mockResolvedValue(undefined)}
        onCommit={vi.fn().mockResolvedValue(undefined)}
        isConnected={false}
        securityConfig={makeSecurityConfig()}
      />,
    );
    expect(
      screen.getByText('Connect to a device to manage security settings.'),
    ).toBeInTheDocument();
  });

  it('does not show connect hint when connected with config', () => {
    renderWithToast(
      <SecurityPanel
        onSetConfig={vi.fn().mockResolvedValue(undefined)}
        onCommit={vi.fn().mockResolvedValue(undefined)}
        isConnected
        securityConfig={makeSecurityConfig()}
      />,
    );
    expect(
      screen.queryByText('Connect to a device to manage security settings.'),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Public Key')).toBeInTheDocument();
  });

  it('shows validation error for invalid admin key base64', async () => {
    const user = userEvent.setup();
    renderWithToast(
      <SecurityPanel
        onSetConfig={vi.fn().mockResolvedValue(undefined)}
        onCommit={vi.fn().mockResolvedValue(undefined)}
        isConnected
        securityConfig={makeSecurityConfig()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '+ Add Admin Key' }));
    await user.type(screen.getByRole('textbox', { name: 'Admin key 1' }), 'not-valid-base64!!!');
    await user.click(screen.getByRole('button', { name: 'Apply Admin Keys' }));

    expect(
      await screen.findByText('Must be a valid base64-encoded 32-byte key'),
    ).toBeInTheDocument();
    expect(vi.mocked(window.electronAPI.safeStorage.encrypt)).not.toHaveBeenCalled();
  });

  it('backs up keys when safeStorage is available', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.safeStorage.isAvailable).mockResolvedValue(true);
    vi.mocked(window.electronAPI.safeStorage.encrypt).mockResolvedValue('encrypted-blob');

    renderWithToast(
      <SecurityPanel
        onSetConfig={vi.fn().mockResolvedValue(undefined)}
        onCommit={vi.fn().mockResolvedValue(undefined)}
        isConnected
        securityConfig={makeSecurityConfig()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.queryByText(
          'System keychain encryption is not available on this platform. Backup and restore are disabled.',
        ),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Backup Keys' }));

    await waitFor(() => {
      expect(window.electronAPI.safeStorage.encrypt).toHaveBeenCalled();
    });
    expect(localStorage.getItem('mesh-client:key-backup')).toBe('encrypted-blob');
  });

  it('shows MeshCore sign section when protocol is meshcore and onSignData is set', () => {
    renderWithToast(
      <SecurityPanel
        onSetConfig={vi.fn().mockResolvedValue(undefined)}
        onCommit={vi.fn().mockResolvedValue(undefined)}
        isConnected
        securityConfig={makeSecurityConfig()}
        protocol="meshcore"
        onSignData={vi.fn().mockResolvedValue(new Uint8Array(8))}
      />,
    );
    expect(screen.getByLabelText('Sign Data')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign Data' })).toBeDisabled();
  });

  it('confirms regenerate before calling apply', async () => {
    const user = userEvent.setup();
    const onSetConfig = vi.fn().mockResolvedValue(undefined);
    const onCommit = vi.fn().mockResolvedValue(undefined);

    renderWithToast(
      <SecurityPanel
        onSetConfig={onSetConfig}
        onCommit={onCommit}
        isConnected
        securityConfig={makeSecurityConfig()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Regenerate Keys' }));
    expect(
      screen.getByText(/Regenerating keys will replace your current DM public and private keys/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(onSetConfig).toHaveBeenCalled();
      expect(onCommit).toHaveBeenCalled();
    });
  });
});
