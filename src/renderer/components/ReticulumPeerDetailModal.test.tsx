import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string | number>) => {
      if (opts && 'error' in opts) return `${key}:${String(opts.error)}`;
      if (opts && 'hops' in opts) return `${key}:${String(opts.hops)}`;
      return key;
    },
  }),
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
    vi.mocked(window.electronAPI.db.getReticulumIdentityActivity).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getReticulumDestinations).mockResolvedValue([]);
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
