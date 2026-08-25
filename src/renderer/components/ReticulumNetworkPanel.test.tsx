import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0 ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const refreshIdentity = vi.fn();

const identityState = vi.hoisted(() => ({
  configured: true,
  identity_hash: 'abc',
  lxmf_hash: 'def0123456789abcdef0123456789abc',
  display_name: 'Existing Name',
  public_key: null as string | null,
}));

vi.mock('@/renderer/lib/reticulum/useReticulumSidecarApi', () => ({
  useReticulumSidecarApi: () => ({
    sidecarApiReady: true,
    identity: identityState,
    statsSummary: null,
    appInfo: null,
    refreshIdentity,
  }),
}));

vi.mock('./QrCodeImage', () => ({
  default: ({ value, ariaLabel }: { value: string; ariaLabel?: string }) => (
    <img alt={ariaLabel} data-testid="identity-qr" data-value={value} />
  ),
}));

vi.mock('../stores/reticulumPeerStore', () => ({
  refreshReticulumPeersFromSidecar: vi.fn().mockResolvedValue([]),
  useReticulumPeerStore: (selector: (s: { peers: Map<string, unknown> }) => unknown) =>
    selector({ peers: new Map([['a', {}]]) }),
}));

import { buildLxmaContactUri } from '@/shared/meshClientDeepLink';

import { ReticulumNetworkPanel } from './ReticulumNetworkPanel';

describe('ReticulumNetworkPanel', () => {
  beforeEach(() => {
    refreshIdentity.mockReset();
    identityState.public_key = null;
    identityState.lxmf_hash = 'def0123456789abcdef0123456789abc';
    identityState.identity_hash = 'abc';
    identityState.display_name = 'Existing Name';
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/stack/settings') {
        return Promise.resolve({
          enable_transport: true,
          share_instance: true,
          loglevel: 3,
          announce_interval_sec: 600,
        });
      }
      return Promise.resolve({});
    });
    window.electronAPI.reticulum.proxyPut = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPost = vi.fn().mockResolvedValue({ ok: true });
  });

  it('does not render flasher or factory reset sections', () => {
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    expect(screen.queryByText('flasher.title')).not.toBeInTheDocument();
    expect(screen.queryByText('adminPanel.reticulumFactoryReset.title')).not.toBeInTheDocument();
  });

  it('renders RMAP discovery section when sidecar is ready', async () => {
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/stack/settings') {
        return Promise.resolve({
          enable_transport: true,
          share_instance: true,
          loglevel: 3,
          announce_interval_sec: 600,
        });
      }
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({ interfaces: [] });
      }
      return Promise.resolve({});
    });
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);
    expect(await screen.findByText('reticulumRmapDiscovery.sectionTitle')).toBeInTheDocument();
  });

  it('preserves announce_interval_sec when saving stack settings', async () => {
    const user = userEvent.setup();
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    await user.click(screen.getByText('networkPanel.reticulumStackSettings.save'));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith('/api/v1/stack/settings', {
        enable_transport: true,
        share_instance: true,
        loglevel: 3,
        announce_interval_sec: 600,
      });
    });
  });

  it('defaults announce_interval_sec to 3600 when saving stack settings without the field', async () => {
    const user = userEvent.setup();
    window.electronAPI.reticulum.proxyGet = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/stack/settings') {
        return Promise.resolve({
          enable_transport: true,
          share_instance: true,
          loglevel: 3,
        });
      }
      return Promise.resolve({});
    });
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    await user.click(screen.getByText('networkPanel.reticulumStackSettings.save'));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith('/api/v1/stack/settings', {
        enable_transport: true,
        share_instance: true,
        loglevel: 3,
        announce_interval_sec: 3600,
      });
    });
  });

  it('renders private key and backup import controls when identity is configured', async () => {
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);
    expect(
      await screen.findByLabelText('connectionPanel.reticulumIdentity.importPrivateKeyLabel'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('connectionPanel.reticulumIdentity.importBackupLabel'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('connectionPanel.reticulumIdentity.importBackupPin'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumIdentity.replaceIdentitySection'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'connectionPanel.reticulumIdentity.exportAria' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'connectionPanel.reticulumIdentity.exportRawAria' }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('connectionPanel.reticulumIdentity.exportPassphraseConfirm'),
    ).toBeInTheDocument();
  });

  it('renders lxma identity QR when public_key is 128 hex', async () => {
    const user = userEvent.setup();
    const pub = 'ab'.repeat(64);
    identityState.public_key = pub;
    const expected = buildLxmaContactUri(identityState.lxmf_hash, pub);
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);
    await user.click(await screen.findByRole('button', { name: 'qrIngest.showIdentityQrAria' }));
    const img = await screen.findByTestId('identity-qr');
    expect(img.getAttribute('data-value')).toBe(expected);
  });

  it('renders identity hash label when identity is configured', async () => {
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    expect(
      await screen.findByText('connectionPanel.reticulumIdentity.identityHashLabel'),
    ).toBeInTheDocument();
    expect(screen.getByText('abc…')).toBeInTheDocument();
  });

  it('writes full identity hash to clipboard via electronAPI', async () => {
    const user = userEvent.setup();
    const writeText = vi.mocked(window.electronAPI.clipboard.writeText);
    writeText.mockClear();

    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    await user.click(
      await screen.findByRole('button', {
        name: 'connectionPanel.reticulumIdentity.copyIdentityHash',
      }),
    );
    expect(writeText).toHaveBeenCalledWith('abc');
  });

  it('writes full LXMF hash to clipboard via electronAPI', async () => {
    const user = userEvent.setup();
    const writeText = vi.mocked(window.electronAPI.clipboard.writeText);
    writeText.mockClear();

    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    await user.click(
      await screen.findByRole('button', { name: 'connectionPanel.reticulumIdentity.copyLxmfHash' }),
    );
    expect(writeText).toHaveBeenCalledWith('def0123456789abcdef0123456789abc');
  });

  it('saves display name via identity display-name API and refreshes identity', async () => {
    const user = userEvent.setup();
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    const nameInput = await screen.findByLabelText('connectionPanel.reticulumIdentity.displayName');
    expect(nameInput).toHaveValue('Existing Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'NV0N');
    await user.click(screen.getByText('connectionPanel.reticulumIdentity.saveDisplayName'));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledWith(
        '/api/v1/identity/display-name',
        { display_name: 'NV0N' },
      );
    });
    expect(refreshIdentity).toHaveBeenCalled();
    expect(
      await screen.findByText('connectionPanel.reticulumIdentity.displayNameSaved'),
    ).toBeInTheDocument();
  });

  it('shows replace confirm when importing private key over existing identity', async () => {
    const user = userEvent.setup();
    window.electronAPI.reticulum.proxyPost = vi.fn().mockResolvedValue({
      ok: false,
      error: 'identity_already_configured',
    });
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    const textarea = await screen.findByLabelText(
      'connectionPanel.reticulumIdentity.importPrivateKeyLabel',
    );
    await user.type(textarea, 'aa'.repeat(64));
    await user.click(screen.getByText('connectionPanel.reticulumIdentity.importPrivateKey'));

    expect(
      await screen.findByText('connectionPanel.reticulumIdentity.replaceIdentityConfirmTitle'),
    ).toBeInTheDocument();
  });

  it('blocks .rsi export when backup PINs do not match', async () => {
    const user = userEvent.setup();
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPost = proxyPost;
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    await user.type(
      await screen.findByLabelText('connectionPanel.reticulumIdentity.exportPassphrase'),
      '123456',
    );
    await user.type(
      screen.getByLabelText('connectionPanel.reticulumIdentity.exportPassphraseConfirm'),
      '654321',
    );
    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumIdentity.exportAria' }),
    );

    expect(
      await screen.findByText('connectionPanel.reticulumIdentity.exportPassphraseMismatch'),
    ).toBeInTheDocument();
    expect(proxyPost).not.toHaveBeenCalledWith('/api/v1/identity/export', expect.anything());
  });

  it('blocks .rsi export when backup PIN is empty', async () => {
    const user = userEvent.setup();
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPost = proxyPost;
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    await user.click(
      await screen.findByRole('button', { name: 'connectionPanel.reticulumIdentity.exportAria' }),
    );

    expect(
      await screen.findByText('connectionPanel.reticulumIdentity.exportPassphraseRequired'),
    ).toBeInTheDocument();
    expect(proxyPost).not.toHaveBeenCalledWith('/api/v1/identity/export', expect.anything());
  });

  it('blocks raw identity export when backup PIN is empty', async () => {
    const user = userEvent.setup();
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    await user.click(
      await screen.findByRole('button', {
        name: 'connectionPanel.reticulumIdentity.exportRawAria',
      }),
    );

    expect(
      await screen.findByText('connectionPanel.reticulumIdentity.exportPassphraseRequired'),
    ).toBeInTheDocument();
  });

  it('blocks raw identity export when backup PINs do not match', async () => {
    const user = userEvent.setup();
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    await user.type(
      await screen.findByLabelText('connectionPanel.reticulumIdentity.exportPassphrase'),
      '123456',
    );
    await user.type(
      screen.getByLabelText('connectionPanel.reticulumIdentity.exportPassphraseConfirm'),
      '654321',
    );
    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumIdentity.exportRawAria' }),
    );

    expect(
      await screen.findByText('connectionPanel.reticulumIdentity.exportPassphraseMismatch'),
    ).toBeInTheDocument();
  });

  it('saves .rsi export via dialog and clears PIN fields', async () => {
    const user = userEvent.setup();
    const saveDialog = vi.fn().mockResolvedValue({ path: '/tmp/out.rsi', error: null });
    window.electronAPI.reticulum.saveIdentityExportDialog = saveDialog;
    window.electronAPI.reticulum.proxyPost = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/identity/export') {
        return Promise.resolve({
          ok: true,
          backup: { format: 'ratspeak.identity.v2', file_name: 'abc-ratspeak-identity.rsi' },
          file_name: 'abc-ratspeak-identity.rsi',
        });
      }
      return Promise.resolve({ ok: true });
    });
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    const pin = await screen.findByLabelText('connectionPanel.reticulumIdentity.exportPassphrase');
    const confirm = screen.getByLabelText(
      'connectionPanel.reticulumIdentity.exportPassphraseConfirm',
    );
    await user.type(pin, '123456');
    await user.type(confirm, '123456');
    await user.click(
      screen.getByRole('button', { name: 'connectionPanel.reticulumIdentity.exportAria' }),
    );

    await waitFor(() => {
      expect(saveDialog).toHaveBeenCalledWith(
        expect.objectContaining({ defaultPath: 'abc-ratspeak-identity.rsi' }),
      );
    });
    expect(pin).toHaveValue('');
    expect(confirm).toHaveValue('');
    expect(screen.queryByDisplayValue(/ratspeak\.identity\.v2/)).not.toBeInTheDocument();
  });

  it('sends backup PIN and opens save dialog for raw identity export', async () => {
    const user = userEvent.setup();
    const saveDialog = vi.fn().mockResolvedValue({ path: '/tmp/out.identity', error: null });
    window.electronAPI.reticulum.saveIdentityExportDialog = saveDialog;
    window.electronAPI.reticulum.proxyPost = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/v1/identity/export-raw') {
        return Promise.resolve({
          ok: true,
          raw: { data_base64: Buffer.alloc(64, 1).toString('base64'), file_name: 'id.identity' },
        });
      }
      return Promise.resolve({ ok: true });
    });
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    await user.type(
      await screen.findByLabelText('connectionPanel.reticulumIdentity.exportPassphrase'),
      '123456',
    );
    await user.type(
      screen.getByLabelText('connectionPanel.reticulumIdentity.exportPassphraseConfirm'),
      '123456',
    );
    await user.click(
      await screen.findByRole('button', {
        name: 'connectionPanel.reticulumIdentity.exportRawAria',
      }),
    );
    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledWith(
        '/api/v1/identity/export-raw',
        { passphrase: '123456' },
      );
    });
    expect(saveDialog).toHaveBeenCalled();
  });

  it('rejects non-object .rsi JSON (null and array) without calling import-backup', async () => {
    const user = userEvent.setup();
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum.proxyPost = proxyPost;
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    const textarea = await screen.findByLabelText(
      'connectionPanel.reticulumIdentity.importBackupLabel',
    );
    await user.clear(textarea);
    await user.click(textarea);
    await user.paste('null');
    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumIdentity.importBackupAria',
      }),
    );
    expect(await screen.findByText('connectionPanel.reticulumIdentity.failed')).toBeInTheDocument();
    expect(proxyPost).not.toHaveBeenCalledWith('/api/v1/identity/import-backup', expect.anything());

    await user.clear(textarea);
    await user.click(textarea);
    await user.paste('[]');
    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumIdentity.importBackupAria',
      }),
    );
    expect(await screen.findByText('connectionPanel.reticulumIdentity.failed')).toBeInTheDocument();
    expect(proxyPost).not.toHaveBeenCalledWith('/api/v1/identity/import-backup', expect.anything());
  });

  it('loads .rsi backup text from the open dialog', async () => {
    const user = userEvent.setup();
    window.electronAPI.reticulum.showIdentityBackupImportDialog = vi.fn().mockResolvedValue({
      path: '/tmp/id.rsi',
      contentText: '{"format":"ratspeak.identity.v2"}',
      error: null,
    });
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    await user.click(
      await screen.findByRole('button', {
        name: 'connectionPanel.reticulumIdentity.importBackupFromFileAria',
      }),
    );
    expect(
      await screen.findByDisplayValue('{"format":"ratspeak.identity.v2"}'),
    ).toBeInTheDocument();
  });

  it('renders Check config ok result via validateConfig', async () => {
    const user = userEvent.setup();
    const validateConfig = vi.fn().mockResolvedValue({ ok: true, issues: [] });
    window.electronAPI.reticulum.validateConfig = validateConfig;
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    await user.click(
      screen.getByRole('button', { name: 'networkPanel.reticulumConfigValidate.aria' }),
    );
    await waitFor(() => {
      expect(validateConfig).toHaveBeenCalled();
    });
    expect(await screen.findByText('networkPanel.reticulumConfigValidate.ok')).toBeInTheDocument();
  });

  it('renders Check config issues via audit i18n keys', async () => {
    const user = userEvent.setup();
    window.electronAPI.reticulum.validateConfig = vi.fn().mockResolvedValue({
      ok: false,
      issues: [
        {
          kind: 'shared_instance_client',
          severity: 'warning',
          message: 'English sidecar message',
          interface_name: null,
        },
      ],
    });
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    await user.click(
      screen.getByRole('button', { name: 'networkPanel.reticulumConfigValidate.aria' }),
    );
    expect(
      await screen.findByText(
        'diagnosticsPanel.reticulum.audit.shared_instance_client:{"name":"","message":"English sidecar message"}',
      ),
    ).toBeInTheDocument();
  });

  it('renders Scan / import as its own section outside Identity', async () => {
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);
    expect(await screen.findByText('networkPanel.reticulumScanImport.title')).toBeInTheDocument();
    expect(screen.getByText('networkPanel.reticulumScanImport.hint')).toBeInTheDocument();
    expect(screen.getByText('connectionPanel.reticulumIdentity.title')).toBeInTheDocument();
    // Identity no longer nests the multi-purpose QR ingest control.
    const identityHeading = screen.getByText('connectionPanel.reticulumIdentity.title');
    const scanHeading = screen.getByText('networkPanel.reticulumScanImport.title');
    expect(
      scanHeading.compareDocumentPosition(identityHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders Check config failure when validateConfig throws', async () => {
    const user = userEvent.setup();
    window.electronAPI.reticulum.validateConfig = vi
      .fn()
      .mockRejectedValue(new Error('spawn failed'));
    render(<ReticulumNetworkPanel connecting={false} onStartStack={async () => {}} />);

    await user.click(
      screen.getByRole('button', { name: 'networkPanel.reticulumConfigValidate.aria' }),
    );
    expect(
      await screen.findByText(
        'networkPanel.reticulumConfigValidate.failed:{"message":"spawn failed"}',
      ),
    ).toBeInTheDocument();
  });
});
