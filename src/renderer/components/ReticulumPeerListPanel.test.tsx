import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReticulumPeerStore } from '../stores/reticulumPeerStore';
import ReticulumPeerListPanel from './ReticulumPeerListPanel';

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

describe('ReticulumPeerListPanel', () => {
  beforeEach(() => {
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
      ]),
      contacts: new Map(),
      lastRefreshAt: null,
    });
  });

  it('renders peer rows and empty contacts state', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    expect(screen.getByText('Alpha Peer')).toBeInTheDocument();
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
});
