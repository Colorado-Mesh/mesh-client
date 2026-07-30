import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addToast = vi.fn();

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
  requestReticulumPeerPath: vi.fn(),
  probeReticulumPeer: vi.fn(),
  formatReticulumPeerPathToast: () => ({ message: 'peerDetailModal.pathOk', variant: 'success' }),
  formatReticulumPeerProbeToast: () => ({ message: 'peerDetailModal.probeOk', variant: 'success' }),
}));

import { useReticulumPeerStore } from '../stores/reticulumPeerStore';
import ReticulumPeerDetailModal from './ReticulumPeerDetailModal';

const PEER_HASH = 'abcdef1234567890abcdef1234567890';

describe('ReticulumPeerDetailModal — copy hash', () => {
  beforeEach(() => {
    addToast.mockClear();
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
});

describe('ReticulumPeerDetailModal — avatar icon', () => {
  beforeEach(() => {
    addToast.mockClear();
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
