import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

const VIRTUALIZER_VISIBLE_CAP = 3;

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: Record<string, unknown> & { count: number; enabled?: boolean }) => {
    const enabled = opts.enabled !== false;
    const total = opts.count;
    const visible = enabled && total > 100 ? Math.min(total, VIRTUALIZER_VISIBLE_CAP) : total;
    return {
      getVirtualItems: () =>
        Array.from({ length: visible }, (_, index) => ({
          index,
          start: index * 44,
          end: (index + 1) * 44,
          size: 44,
          key: index,
          lane: 0,
        })),
      getTotalSize: () => total * 44,
      measureElement: vi.fn(),
      measure: vi.fn(),
    };
  },
}));

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
import { reticulumHashToNodeId } from '../lib/reticulum/destHash';
import { useNomadNetworkStore } from '../stores/nomadNetworkStore';
import { useReticulumPeerStore } from '../stores/reticulumPeerStore';
import ReticulumPeerListPanel from './ReticulumPeerListPanel';
import { ToastProvider } from './Toast';

function fillLargePeerMap(count: number, buried?: { hash: string; name: string }) {
  const peers = new Map<string, { destination_hash: string; display_name: string; hops: number }>();
  for (let i = 0; i < count; i++) {
    const hash = `peer${i.toString(16).padStart(8, '0')}`;
    peers.set(hash, {
      destination_hash: hash,
      display_name: `Peer ${i}`,
      hops: i % 5,
    });
  }
  if (buried) {
    peers.set(buried.hash, {
      destination_hash: buried.hash,
      display_name: buried.name,
      hops: 1,
    });
  }
  return peers;
}

describe('ReticulumPeerListPanel', () => {
  beforeEach(() => {
    reticulumSidecarMocks.isReticulumSidecarRunning.mockResolvedValue(true);
    reticulumSidecarMocks.requestReticulumPeerPath.mockReset();
    reticulumSidecarMocks.probeReticulumPeer.mockReset();
    reticulumSidecarMocks.refreshReticulumPeersFromSidecar.mockReset();
    reticulumSidecarMocks.refreshReticulumPeersFromSidecar.mockResolvedValue([]);
    useNomadNetworkStore.setState({ nodes: new Map() });
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
            is_contact: true,
          },
        ],
      ]),
      history: new Map([
        [
          'def',
          {
            destination_hash: 'def',
            display_name: 'Contact Peer',
            last_heard: Date.now() / 1000,
          },
        ],
        [
          'hist1',
          {
            destination_hash: 'hist1',
            display_name: 'History Peer',
            last_heard: Date.now() / 1000,
          },
        ],
      ]),
      lastRefreshAt: null,
      peerAppearanceByHash: new Map(),
      peersRevision: 0,
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

  it('shows empty outline avatar when peer has no custom icon', () => {
    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    const label = screen.getByText('Alpha Peer');
    const rowLabel = label.closest('span.inline-flex');
    expect(rowLabel?.querySelector('.border-dashed')).toBeTruthy();
    expect(rowLabel?.querySelector('svg')).toBeNull();
  });

  it('shows people icon when peer has user appearance', () => {
    useReticulumPeerStore.setState({
      peerAppearanceByHash: new Map([['abc', { icon_name: 'user', icon_color: 'green' }]]),
    });
    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    const label = screen.getByText('Alpha Peer');
    const rowLabel = label.closest('span.inline-flex');
    expect(rowLabel?.querySelector('.border-dashed')).toBeNull();
    expect(rowLabel?.querySelector('svg')).toBeTruthy();
  });

  it('renders contacts tab with last heard column', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    await user.click(screen.getByRole('tab', { name: 'peerListPanel.tabContacts' }));
    expect(screen.getByText('peerListPanel.colLastHeard')).toBeInTheDocument();
    expect(screen.getByText('Contact Peer')).toBeInTheDocument();
    expect(screen.queryByText('History Peer')).not.toBeInTheDocument();
  });

  it('renders history tab with messaged peers that are not saved contacts', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    await user.click(screen.getByRole('tab', { name: 'peerListPanel.tabHistory' }));
    expect(screen.getByText('peerListPanel.colLastHeard')).toBeInTheDocument();
    expect(screen.getByText('History Peer')).toBeInTheDocument();
    expect(screen.getByText('Contact Peer')).toBeInTheDocument();
  });

  it('shows empty history state', async () => {
    useReticulumPeerStore.setState({ history: new Map() });
    const user = userEvent.setup();
    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    await user.click(screen.getByRole('tab', { name: 'peerListPanel.tabHistory' }));
    expect(screen.getByText('peerListPanel.emptyHistory')).toBeInTheDocument();
  });

  it('shows empty contacts state', async () => {
    useReticulumPeerStore.setState({ contacts: new Map() });
    const user = userEvent.setup();
    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    await user.click(screen.getByRole('tab', { name: 'peerListPanel.tabContacts' }));
    expect(screen.getByText('peerListPanel.emptyContacts')).toBeInTheDocument();
  });

  it('does not show path-table peers on contacts tab when LXMF contacts are empty', async () => {
    useReticulumPeerStore.setState({ contacts: new Map() });
    const contactNodes = new Map([
      [
        0xabc123,
        {
          node_id: 0xabc123,
          reticulum_destination_hash: 'abc123',
          long_name: 'Path Table Peer',
          short_name: 'Pat',
          hw_model: 'Reticulum',
          snr: 0,
          battery: 0,
          last_heard: Date.now(),
          latitude: null,
          longitude: null,
          favorited: false,
          source: 'rf' as const,
        },
      ],
    ]);
    const user = userEvent.setup();
    render(
      <ReticulumPeerListPanel
        isConnected={false}
        onPeerClick={vi.fn()}
        onSendMessage={vi.fn()}
        contactNodes={contactNodes}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'peerListPanel.tabContacts' }));
    expect(screen.getByText('peerListPanel.emptyContacts')).toBeInTheDocument();
    expect(screen.queryByText('Path Table Peer')).not.toBeInTheDocument();
  });

  it('filters peers by search query', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    const search = screen.getByLabelText('peerListPanel.searchAria');
    await user.type(search, 'nomatch');
    await waitFor(() => {
      expect(screen.queryByText('Alpha Peer')).not.toBeInTheDocument();
    });
  });

  it('virtualizes large peer lists to a small DOM window', async () => {
    useReticulumPeerStore.setState({
      peers: fillLargePeerMap(150),
      contacts: new Map(),
    });
    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText('Peer 0')).toBeInTheDocument();
    });
    expect(screen.queryByText('Peer 50')).not.toBeInTheDocument();
    expect(screen.getByText(/peerListPanel\.heading/)).toHaveTextContent('(150)');
  });

  it('finds a buried peer by display name after search', async () => {
    const user = userEvent.setup();
    useReticulumPeerStore.setState({
      peers: fillLargePeerMap(150, {
        hash: 'burieddeadbeef01',
        name: 'Unique Buried Peer',
      }),
      contacts: new Map(),
    });
    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    expect(screen.queryByText('Unique Buried Peer')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('peerListPanel.searchAria'), 'Unique Buried');
    await waitFor(() => {
      expect(screen.getByText('Unique Buried Peer')).toBeInTheDocument();
    });
    expect(screen.queryByText('Peer 0')).not.toBeInTheDocument();
  });

  it('finds a buried peer by destination hash fragment', async () => {
    const user = userEvent.setup();
    useReticulumPeerStore.setState({
      peers: fillLargePeerMap(150, {
        hash: 'cafe1234buried99',
        name: 'Hash Target Peer',
      }),
      contacts: new Map(),
    });
    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );

    await user.type(screen.getByLabelText('peerListPanel.searchAria'), 'cafe1234');
    await waitFor(() => {
      expect(screen.getByText('Hash Target Peer')).toBeInTheDocument();
    });
  });

  it('finds a peer via Nomad overlay label when path-table name is a hash alias', async () => {
    const user = userEvent.setup();
    const hash = 'aa'.repeat(16);
    useReticulumPeerStore.setState({
      peers: new Map([
        ...fillLargePeerMap(120),
        [
          hash,
          {
            destination_hash: hash,
            display_name: hash.slice(0, 12),
            hops: 1,
          },
        ],
      ]),
      contacts: new Map(),
    });
    useNomadNetworkStore.setState({
      nodes: new Map([
        [
          hash,
          {
            destination_hash: hash,
            display_name: 'Nomad Overlay Friend',
            hops: 1,
            last_heard: Date.now() / 1000,
            favorited: false,
          },
        ],
      ]),
    });

    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    await user.type(screen.getByLabelText('peerListPanel.searchAria'), 'Overlay Friend');
    await waitFor(() => {
      expect(screen.getByText('Nomad Overlay Friend')).toBeInTheDocument();
    });
  });

  it('finds a peer via contactNodes long_name overlay', async () => {
    const user = userEvent.setup();
    const hash = 'bb'.repeat(16);
    const nodeId = reticulumHashToNodeId(hash);
    useReticulumPeerStore.setState({
      peers: new Map([
        ...fillLargePeerMap(120),
        [
          hash,
          {
            destination_hash: hash,
            display_name: hash.slice(0, 12),
            hops: 2,
          },
        ],
      ]),
      contacts: new Map(),
    });
    const contactNodes = new Map([
      [
        nodeId,
        {
          node_id: nodeId,
          reticulum_destination_hash: hash,
          long_name: 'LXMF Contact Overlay',
          short_name: 'LXMF',
          hw_model: 'Reticulum',
          snr: 0,
          battery: 0,
          last_heard: Date.now(),
          latitude: null,
          longitude: null,
          favorited: false,
          source: 'rf' as const,
        },
      ],
    ]);

    render(
      <ReticulumPeerListPanel
        isConnected={false}
        onPeerClick={vi.fn()}
        onSendMessage={vi.fn()}
        contactNodes={contactNodes}
      />,
    );
    await user.type(screen.getByLabelText('peerListPanel.searchAria'), 'LXMF Contact');
    await waitFor(() => {
      expect(screen.getByText('LXMF Contact Overlay')).toBeInTheDocument();
    });
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

  it('looks up a destination hash with path and probe', async () => {
    const user = userEvent.setup();
    const onPeerClick = vi.fn();
    const hash = '368f994c056de0d8882855eb0d627497';
    reticulumSidecarMocks.requestReticulumPeerPath.mockResolvedValue({ ok: true });
    reticulumSidecarMocks.probeReticulumPeer.mockResolvedValue({ ok: true, hops: 3 });
    reticulumSidecarMocks.refreshReticulumPeersFromSidecar.mockImplementation(() => {
      useReticulumPeerStore
        .getState()
        .replacePeers([{ destination_hash: hash, display_name: 'Looked Up', hops: 3 }]);
      return Promise.resolve([]);
    });

    render(
      <ToastProvider>
        <ReticulumPeerListPanel isConnected onPeerClick={onPeerClick} onSendMessage={vi.fn()} />
      </ToastProvider>,
    );

    await user.type(screen.getByLabelText('peerListPanel.lookupAria'), hash);
    await user.click(screen.getByRole('button', { name: 'peerListPanel.lookupSubmitAria' }));

    await waitFor(() => {
      expect(reticulumSidecarMocks.requestReticulumPeerPath).toHaveBeenCalledWith(hash);
    });
    expect(reticulumSidecarMocks.probeReticulumPeer).toHaveBeenCalledWith(hash);
    await waitFor(() => {
      expect(onPeerClick).toHaveBeenCalledWith(hash);
    });
  });

  it('shows lookup validation error for invalid hash', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ReticulumPeerListPanel isConnected onPeerClick={vi.fn()} onSendMessage={vi.fn()} />
      </ToastProvider>,
    );
    await user.type(screen.getByLabelText('peerListPanel.lookupAria'), 'not-a-hash');
    await user.click(screen.getByRole('button', { name: 'peerListPanel.lookupSubmitAria' }));
    expect(await screen.findByText('peerListPanel.lookupInvalid')).toBeInTheDocument();
    expect(reticulumSidecarMocks.requestReticulumPeerPath).not.toHaveBeenCalled();
  });

  it('skips mount refresh when peers are already in the store', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onSoftRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <ReticulumPeerListPanel
        isConnected
        onPeerClick={vi.fn()}
        onSendMessage={vi.fn()}
        onRefresh={onRefresh}
        onSoftRefresh={onSoftRefresh}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('Alpha Peer')).toBeInTheDocument();
    });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onSoftRefresh).not.toHaveBeenCalled();
    expect(reticulumSidecarMocks.refreshReticulumPeersFromSidecar).not.toHaveBeenCalled();
  });

  it('soft-refreshes on mount when connected and the peer store is empty', async () => {
    useReticulumPeerStore.setState({
      peers: new Map(),
      contacts: new Map(),
    });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onSoftRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <ReticulumPeerListPanel
        isConnected
        onPeerClick={vi.fn()}
        onSendMessage={vi.fn()}
        onRefresh={onRefresh}
        onSoftRefresh={onSoftRefresh}
      />,
    );
    await waitFor(() => {
      expect(onSoftRefresh).toHaveBeenCalledTimes(1);
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('forced Refresh button uses onRefresh, not soft refresh', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onSoftRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <ReticulumPeerListPanel
        isConnected
        onPeerClick={vi.fn()}
        onSendMessage={vi.fn()}
        onRefresh={onRefresh}
        onSoftRefresh={onSoftRefresh}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'common.refresh' }));
    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
    expect(onSoftRefresh).not.toHaveBeenCalled();
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
