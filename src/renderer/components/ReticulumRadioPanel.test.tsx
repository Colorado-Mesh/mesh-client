import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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

import { ReticulumRadioPanel } from './ReticulumRadioPanel';

describe('ReticulumRadioPanel', () => {
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
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({ interfaces: [] });
      }
      return Promise.resolve({});
    });
    window.electronAPI.reticulum.proxyPut = vi.fn().mockResolvedValue({ ok: true });
  });

  it('does not render flasher or factory reset sections', () => {
    render(<ReticulumRadioPanel connecting={false} onStartStack={async () => {}} />);

    expect(screen.queryByText('flasher.title')).not.toBeInTheDocument();
    expect(screen.queryByText('radioPanel.reticulumFactoryReset.title')).not.toBeInTheDocument();
  });

  it('preserves announce_interval_sec when saving stack settings', async () => {
    const user = userEvent.setup();
    render(<ReticulumRadioPanel connecting={false} onStartStack={async () => {}} />);

    await user.click(screen.getByText('radioPanel.reticulumStackSettings.save'));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith('/api/v1/stack/settings', {
        enable_transport: true,
        share_instance: true,
        loglevel: 3,
        announce_interval_sec: 600,
      });
    });
  });

  it('shows offline reason on local serial interface rows', async () => {
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
        return Promise.resolve({
          interfaces: [
            {
              id: 'heltec',
              name: 'Heltec V3',
              type: 'rnode',
              enabled: true,
              status: 'down',
              serial_port: '/dev/cu.usbserial-7',
            },
          ],
        });
      }
      if (path === '/api/v1/serial/ports') {
        return Promise.resolve({ ports: [{ path: '/dev/cu.usbserial-0001' }] });
      }
      return Promise.resolve({});
    });

    render(<ReticulumRadioPanel connecting={false} onStartStack={async () => {}} />);

    await waitFor(() => {
      expect(
        screen.getByText('connectionPanel.reticulumInterfaces.localOfflineRowStale'),
      ).toBeInTheDocument();
    });
  });
});
