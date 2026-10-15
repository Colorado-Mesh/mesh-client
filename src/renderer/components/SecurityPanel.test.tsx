import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hasMeshtasticDmKeyBackup } from '../lib/meshtasticDmKeyBackupStorage';
import { resetSecureSecretCacheForTests } from '../lib/secureSecretStorage';
import { renderWithToast } from '../lib/testRenderHelpers';
import SecurityPanel from './SecurityPanel';

vi.mock('../lib/writeClipboardText', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}));

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
    resetSecureSecretCacheForTests();
    vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
      available: true,
      persistent: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies the packet signature policy with the admin settings', async () => {
    const user = userEvent.setup();
    const onSetConfig = vi.fn().mockResolvedValue(undefined);
    renderWithToast(
      <SecurityPanel
        onSetConfig={onSetConfig}
        onCommit={vi.fn().mockResolvedValue(undefined)}
        isConnected
        securityConfig={{ ...makeSecurityConfig(), packetSignaturePolicy: 0 }}
      />,
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Packet signature policy' }),
      'Strict',
    );
    await user.click(screen.getByRole('button', { name: 'Apply Settings' }));
    await waitFor(() => {
      expect(onSetConfig).toHaveBeenCalledWith({
        payloadVariant: {
          case: 'security',
          value: expect.objectContaining({ packetSignaturePolicy: 2, isManaged: false }),
        },
      });
    });
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

  it('backs up keys per nodeNum when persistent secure storage is available', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
      available: true,
      persistent: true,
    });

    renderWithToast(
      <SecurityPanel
        onSetConfig={vi.fn().mockResolvedValue(undefined)}
        onCommit={vi.fn().mockResolvedValue(undefined)}
        isConnected
        securityConfig={makeSecurityConfig()}
        localNodeNum={0x100}
        localNodeLabel="Test Node"
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
      expect(window.electronAPI.secureSecrets.set).toHaveBeenCalled();
    });
    expect(hasMeshtasticDmKeyBackup(0x100)).toBe(true);
  });

  it('shows MeshCore sign section when protocol is meshcore', async () => {
    vi.mocked(window.electronAPI.secureSecrets.status).mockResolvedValue({
      available: true,
      persistent: true,
    });
    renderWithToast(
      <SecurityPanel
        onSetConfig={vi.fn().mockResolvedValue(undefined)}
        onCommit={vi.fn().mockResolvedValue(undefined)}
        isConnected
        securityConfig={null}
        protocol="meshcore"
        meshcorePublicKey={new Uint8Array(32).fill(0x05)}
        meshcoreNodeId={0x300}
        onSignData={vi.fn().mockResolvedValue(new Uint8Array(8))}
        onExportPrivateKey={vi.fn().mockResolvedValue(new Uint8Array(32))}
      />,
    );
    expect(screen.getByLabelText('Sign Data')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Backup Keys' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Regenerate Keys' })).not.toBeInTheDocument();
  });

  it('hides key backup when configuring a remote target', () => {
    renderWithToast(
      <SecurityPanel
        onSetConfig={vi.fn().mockResolvedValue(undefined)}
        onCommit={vi.fn().mockResolvedValue(undefined)}
        isConnected
        securityConfig={makeSecurityConfig()}
        configTarget={{ mode: 'remote', nodeNum: 0x200, isReady: true, isLoading: false }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Backup Keys' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regenerate Keys' })).not.toBeInTheDocument();
  });
});
