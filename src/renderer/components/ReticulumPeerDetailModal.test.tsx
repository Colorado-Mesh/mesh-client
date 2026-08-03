import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addToast = vi.fn();
const refreshReticulumPeersFromSidecarMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const refreshReticulumPeerRouteFromPathsMock = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const requestReticulumPeerPathMock = vi.hoisted(() => vi.fn());
const probeReticulumPeerMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string | number>) => {
      if (opts && 'error' in opts) return `${key}:${String(opts.error)}`;
      if (opts && 'hops' in opts) return `${key}:${String(opts.hops)}`;
      return key;
    },
  }),
}));

vi.mock('./Toast', () => ({
  useToast: () => ({ addToast }),
}));

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  requestReticulumPeerPath: (...args: unknown[]) => requestReticulumPeerPathMock(...args),
  probeReticulumPeer: (...args: unknown[]) => probeReticulumPeerMock(...args),
  formatReticulumPeerPathToast: () => ({ message: 'peerDetailModal.pathOk', variant: 'success' }),
  formatReticulumPeerProbeToast: (_t: unknown, result: { hops?: number }) =>
    result.hops != null
      ? { message: `peerDetailModal.probeHops:${result.hops}`, variant: 'success' }
      : { message: 'peerDetailModal.probeOk', variant: 'success' },
}));

vi.mock('@/renderer/lib/reticulum/reticulumPathMedium', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    refreshReticulumPeerRouteFromPaths: (...args: unknown[]) =>
      refreshReticulumPeerRouteFromPathsMock(...args),
  };
});

vi.mock('../stores/reticulumPeerStore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    refreshReticulumPeersFromSidecar: (...args: unknown[]) =>
      refreshReticulumPeersFromSidecarMock(...args),
  };
});

import { useReticulumPeerStore } from '../stores/reticulumPeerStore';
import ReticulumPeerDetailModal from './ReticulumPeerDetailModal';

const PEER_HASH = 'abcdef1234567890abcdef1234567890';

describe('ReticulumPeerDetailModal — copy hash', () => {
  beforeEach(() => {
    addToast.mockClear();
    refreshReticulumPeerRouteFromPathsMock.mockClear();
    refreshReticulumPeerRouteFromPathsMock.mockResolvedValue(false);
    requestReticulumPeerPathMock.mockReset();
    probeReticulumPeerMock.mockReset();
    vi.mocked(window.electronAPI.db.getReticulumIdentityActivity).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getReticulumDestinations).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.upsertReticulumDestination).mockResolvedValue(undefined);
    useReticulumPeerStore.setState({
      peers: new Map([
        [
          PEER_HASH,
          {
            destination_hash: PEER_HASH,
            display_name: 'Test Peer',
            hops: 2,
            last_seen: Date.now() / 1000,
          },
        ],
      ]),
      contacts: new Map(),
      history: new Map(),
      peerAppearanceByHash: new Map(),
      lastRefreshAt: null,
    });
  });

  it('writes destination hash to clipboard via electronAPI', async () => {
    const user = userEvent.setup();
    const writeText = vi.mocked(window.electronAPI.clipboard.writeText);

    render(
      <ReticulumPeerDetailModal peerHash={PEER_HASH} onClose={vi.fn()} onSendMessage={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'peerDetailModal.copyHash' }));
    expect(writeText).toHaveBeenCalledWith(PEER_HASH);
  });

  it('Save as contact upserts last_heard and refreshes peers', async () => {
    const user = userEvent.setup();
    const upsert = vi.mocked(window.electronAPI.db.upsertReticulumDestination);
    const refreshSpy = refreshReticulumPeersFromSidecarMock;

    render(
      <ReticulumPeerDetailModal peerHash={PEER_HASH} onClose={vi.fn()} onSendMessage={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'peerDetailModal.saveContact' }));
    await waitFor(() => {
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          destination_hash: PEER_HASH,
          display_name: 'Test Peer',
          last_heard: expect.any(Number),
          is_contact: true,
        }),
      );
    });
    expect(refreshSpy).toHaveBeenCalled();
  });
});

describe('ReticulumPeerDetailModal — avatar icon', () => {
  beforeEach(() => {
    addToast.mockClear();
    refreshReticulumPeerRouteFromPathsMock.mockClear();
    refreshReticulumPeerRouteFromPathsMock.mockResolvedValue(false);
    vi.mocked(window.electronAPI.db.getReticulumIdentityActivity).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getReticulumDestinations).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.upsertReticulumDestination).mockResolvedValue(undefined);
    useReticulumPeerStore.setState({
      peers: new Map([
        [
          PEER_HASH,
          {
            destination_hash: PEER_HASH,
            display_name: 'Test Peer',
            hops: 2,
            last_seen: Date.now() / 1000,
          },
        ],
      ]),
      contacts: new Map(),
      history: new Map(),
      peerAppearanceByHash: new Map(),
      lastRefreshAt: null,
    });
  });

  it('selects People and persists icon_name user', async () => {
    const user = userEvent.setup();
    const upsert = vi.mocked(window.electronAPI.db.upsertReticulumDestination);

    render(
      <ReticulumPeerDetailModal peerHash={PEER_HASH} onClose={vi.fn()} onSendMessage={vi.fn()} />,
    );

    const select = screen.getByLabelText('reticulumProfileIcon.iconNameAria');
    await user.selectOptions(select, 'user');

    await waitFor(() => {
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          destination_hash: PEER_HASH,
          icon_name: 'user',
          icon_color: 'green',
        }),
      );
    });
    expect(useReticulumPeerStore.getState().peerAppearanceByHash.get(PEER_HASH)).toEqual({
      icon_name: 'user',
      icon_color: 'green',
    });
    expect(select).toHaveValue('user');
  });

  it('loads wire people icon into People select option', async () => {
    vi.mocked(window.electronAPI.db.getReticulumDestinations).mockResolvedValue([
      {
        destination_hash: PEER_HASH,
        icon_name: 'people',
        icon_color: 'cyan',
      },
    ]);

    render(
      <ReticulumPeerDetailModal peerHash={PEER_HASH} onClose={vi.fn()} onSendMessage={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('reticulumProfileIcon.iconNameAria')).toHaveValue('user');
    });
  });

  it('toasts and reverts when upsert fails', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.db.upsertReticulumDestination).mockRejectedValue(
      new Error('db down'),
    );

    render(
      <ReticulumPeerDetailModal peerHash={PEER_HASH} onClose={vi.fn()} onSendMessage={vi.fn()} />,
    );

    const select = screen.getByLabelText('reticulumProfileIcon.iconNameAria');
    await user.selectOptions(select, 'user');

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('reticulumProfileIcon.iconSaveFailed', 'error');
    });
    expect(select).toHaveValue('circle');
    expect(useReticulumPeerStore.getState().peerAppearanceByHash.get(PEER_HASH)).toEqual({
      icon_name: 'circle',
      icon_color: 'green',
    });
  });
});

describe('ReticulumPeerDetailModal — Network route hydrate', () => {
  beforeEach(() => {
    addToast.mockClear();
    refreshReticulumPeerRouteFromPathsMock.mockClear();
    refreshReticulumPeerRouteFromPathsMock.mockResolvedValue(false);
    requestReticulumPeerPathMock.mockReset();
    probeReticulumPeerMock.mockReset();
    vi.mocked(window.electronAPI.db.getReticulumIdentityActivity).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getReticulumDestinations).mockResolvedValue([]);
    useReticulumPeerStore.setState({
      peers: new Map(),
      contacts: new Map([
        [
          PEER_HASH,
          {
            destination_hash: PEER_HASH,
            display_name: 'Contact Peer',
            last_heard: 100,
            is_contact: true,
            hops: null,
            interface: null,
          },
        ],
      ]),
      history: new Map(),
      peerAppearanceByHash: new Map(),
      lastRefreshAt: null,
      peersRevision: 0,
    });
  });

  it('hydrates path slots on open', async () => {
    render(
      <ReticulumPeerDetailModal peerHash={PEER_HASH} onClose={vi.fn()} onSendMessage={vi.fn()} />,
    );
    await waitFor(() => {
      expect(refreshReticulumPeerRouteFromPathsMock).toHaveBeenCalledWith(PEER_HASH);
    });
  });

  it('probe applies hops and refreshes path slots', async () => {
    const user = userEvent.setup();
    probeReticulumPeerMock.mockResolvedValue({ ok: true, hops: 3 });
    refreshReticulumPeerRouteFromPathsMock.mockImplementation((hash: string) => {
      useReticulumPeerStore.getState().updatePeer(hash, {
        hops: 3,
        interface: 'RMAP World',
        path_hash: '11'.repeat(16),
        via_hash: '11'.repeat(16),
      });
      return Promise.resolve(true);
    });

    render(
      <ReticulumPeerDetailModal peerHash={PEER_HASH} onClose={vi.fn()} onSendMessage={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'connectionPanel.reticulumPeers.probe' }));

    await waitFor(() => {
      expect(probeReticulumPeerMock).toHaveBeenCalledWith(PEER_HASH);
    });
    await waitFor(() => {
      const peer = useReticulumPeerStore.getState().getPeer(PEER_HASH);
      expect(peer?.hops).toBe(3);
      expect(peer?.interface).toBe('RMAP World');
      expect(peer?.path_hash).toBe('11'.repeat(16));
    });
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('RMAP World')).toBeInTheDocument();
  });

  it('path success refreshes route with settle options', async () => {
    const user = userEvent.setup();
    requestReticulumPeerPathMock.mockResolvedValue({ ok: true });

    render(
      <ReticulumPeerDetailModal peerHash={PEER_HASH} onClose={vi.fn()} onSendMessage={vi.fn()} />,
    );
    refreshReticulumPeerRouteFromPathsMock.mockClear();

    await user.click(screen.getByRole('button', { name: 'connectionPanel.reticulumPeers.path' }));

    await waitFor(() => {
      expect(requestReticulumPeerPathMock).toHaveBeenCalledWith(PEER_HASH);
      expect(refreshReticulumPeerRouteFromPathsMock).toHaveBeenCalledWith(
        PEER_HASH,
        expect.objectContaining({ settleMs: expect.any(Number), retryMs: expect.any(Number) }),
      );
    });
  });
});
