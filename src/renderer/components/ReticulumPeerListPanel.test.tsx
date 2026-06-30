import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

const reticulumSidecarMocks = vi.hoisted(() => ({
  isReticulumSidecarRunning: vi.fn(),
  requestReticulumPeerPath: vi.fn(),
  probeReticulumPeer: vi.fn(),
  refreshReticulumPeersFromSidecar: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string | number>) => {
      if (opts && 'count' in opts) return `${key}:${String(opts.count)}`;
      if (opts && 'error' in opts) return `${key}:${String(opts.error)}`;
      if (opts && 'hops' in opts) return `${key}:${String(opts.hops)}`;
      return key;
    },
  }),
}));

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  isReticulumSidecarRunning: reticulumSidecarMocks.isReticulumSidecarRunning,
  requestReticulumPeerPath: reticulumSidecarMocks.requestReticulumPeerPath,
  probeReticulumPeer: reticulumSidecarMocks.probeReticulumPeer,
  formatReticulumPeerPathToast: (
    _t: (key: string) => string,
    result: { ok: boolean; error?: string },
  ) =>
    result.ok
      ? { message: 'peerDetailModal.pathOk', variant: 'success' as const }
      : { message: `peerDetailModal.pathFailed:${result.error ?? ''}`, variant: 'error' as const },
  formatReticulumPeerProbeToast: (
    _t: (key: string) => string,
    result: { ok: boolean; hops?: number; error?: string },
  ) => {
    if (result.ok && result.hops != null) {
      return { message: `peerDetailModal.probeHops:${result.hops}`, variant: 'success' as const };
    }
    return {
      message: `peerDetailModal.probeFailed:${result.error ?? ''}`,
      variant: 'error' as const,
    };
  },
}));

vi.mock('../stores/reticulumPeerStore', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const actual = await importOriginal<typeof import('../stores/reticulumPeerStore')>();
  return {
    ...actual,
    refreshReticulumPeersFromSidecar: reticulumSidecarMocks.refreshReticulumPeersFromSidecar,
  };
});

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { useReticulumPeerStore } from '../stores/reticulumPeerStore';
import ReticulumPeerListPanel from './ReticulumPeerListPanel';
import { ToastProvider } from './Toast';

describe('ReticulumPeerListPanel', () => {
  beforeEach(() => {
    reticulumSidecarMocks.isReticulumSidecarRunning.mockResolvedValue(true);
    reticulumSidecarMocks.requestReticulumPeerPath.mockReset();
    reticulumSidecarMocks.probeReticulumPeer.mockReset();
    reticulumSidecarMocks.refreshReticulumPeersFromSidecar.mockResolvedValue([]);
    useReticulumPeerStore.setState({
      peers: new Map([
        [
          'abc',
          {
            destination_hash: 'abc',
            display_name: 'Alpha Peer',
            hops: 2,
            last_seen: Date.now() / 1000,
          },
        ],
        [
          'def',
          {
            destination_hash: 'def',
            display_name: 'Contact Peer',
            hops: 1,
            last_seen: Date.now() / 1000,
          },
        ],
      ]),
      contacts: new Map([
        [
          'def',
          {
            destination_hash: 'def',
            display_name: 'Contact Peer',
            last_heard: Date.now() / 1000,
          },
        ],
      ]),
      lastRefreshAt: null,
    });
  });

  it('renders peer rows with contact badge on peers tab', () => {
    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    expect(screen.getByText('Alpha Peer')).toBeInTheDocument();
    expect(screen.getByText('peerListPanel.colContact')).toBeInTheDocument();
    expect(screen.getAllByText('peerListPanel.contactNo').length).toBeGreaterThan(0);
    expect(screen.getByText('peerListPanel.contactYes')).toBeInTheDocument();
  });

  it('renders contacts tab with last heard column', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'peerListPanel.tabContacts' }));
    expect(screen.getByText('peerListPanel.colLastHeard')).toBeInTheDocument();
    expect(screen.getByText('Contact Peer')).toBeInTheDocument();
  });

  it('shows empty contacts state', async () => {
    useReticulumPeerStore.setState({ contacts: new Map() });
    const user = userEvent.setup();
    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'peerListPanel.tabContacts' }));
    expect(screen.getByText('peerListPanel.emptyContacts')).toBeInTheDocument();
  });

  it('filters peers by search query', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    const search = screen.getByLabelText('peerListPanel.searchAria');
    await user.type(search, 'nomatch');
    expect(screen.queryByText('Alpha Peer')).not.toBeInTheDocument();
  });

  it('shows toast after path and probe actions', async () => {
    const user = userEvent.setup();
    reticulumSidecarMocks.requestReticulumPeerPath.mockResolvedValue({ ok: true });
    reticulumSidecarMocks.probeReticulumPeer.mockResolvedValue({ ok: true, hops: 2 });

    render(
      <ToastProvider>
        <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />
      </ToastProvider>,
    );

    await user.click(
      screen.getAllByRole('button', { name: 'connectionPanel.reticulumPeers.path' })[0],
    );
    await waitFor(() => {
      expect(reticulumSidecarMocks.requestReticulumPeerPath).toHaveBeenCalledWith('abc');
    });
    expect(await screen.findByText('peerDetailModal.pathOk')).toBeInTheDocument();

    await user.click(
      screen.getAllByRole('button', { name: 'connectionPanel.reticulumPeers.probe' })[0],
    );
    await waitFor(() => {
      expect(reticulumSidecarMocks.probeReticulumPeer).toHaveBeenCalledWith('abc');
    });
    expect(await screen.findByText('peerDetailModal.probeHops:2')).toBeInTheDocument();
  });

  it('has no serious axe violations', async () => {
    const { container } = render(
      <ToastProvider>
        <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />
      </ToastProvider>,
    );
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
