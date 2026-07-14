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

vi.mock('@/renderer/lib/reticulum/useReticulumSidecarApi', () => ({
  useReticulumSidecarApi: () => ({
    sidecarApiReady: true,
    identity: {
      configured: true,
      identity_hash: 'abc',
      lxmf_hash: 'def0123456789abcdef0123456789abc',
      display_name: 'Existing Name',
    },
    statsSummary: null,
    appInfo: null,
    refreshIdentity,
  }),
}));

vi.mock('../stores/reticulumPeerStore', () => ({
  refreshReticulumPeersFromSidecar: vi.fn().mockResolvedValue([]),
  useReticulumPeerStore: (selector: (s: { peers: Map<string, unknown> }) => unknown) =>
    selector({ peers: new Map([['a', {}]]) }),
}));

import { ReticulumNetworkPanel } from './ReticulumNetworkPanel';

describe('ReticulumNetworkPanel', () => {
  beforeEach(() => {
    refreshIdentity.mockReset();
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
      screen.getByText('connectionPanel.reticulumIdentity.replaceIdentitySection'),
    ).toBeInTheDocument();
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
