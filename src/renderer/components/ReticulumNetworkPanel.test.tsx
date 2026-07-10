import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/lib/reticulum/useReticulumSidecarApi', () => ({
  useReticulumSidecarApi: () => ({
    sidecarApiReady: true,
    identity: { configured: true, identity_hash: 'abc', lxmf_hash: 'def' },
    statsSummary: null,
    appInfo: null,
    refreshIdentity: vi.fn(),
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
});
