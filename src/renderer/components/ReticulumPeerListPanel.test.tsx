import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
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

  it('has no serious axe violations', async () => {
    const { container } = render(
      <ReticulumPeerListPanel isConnected={false} onPeerClick={vi.fn()} onSendMessage={vi.fn()} />,
    );
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
