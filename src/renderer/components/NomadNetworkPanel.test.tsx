import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string | number>) => {
      if (opts && 'count' in opts) return `${key}:${String(opts.count)}`;
      return key;
    },
  }),
}));

const isReticulumSidecarRunning = vi.fn();

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  isReticulumSidecarRunning: () => isReticulumSidecarRunning(),
}));

import { useNomadNetworkStore } from '../stores/nomadNetworkStore';
import NomadNetworkPanel from './NomadNetworkPanel';

describe('NomadNetworkPanel', () => {
  beforeEach(() => {
    isReticulumSidecarRunning.mockResolvedValue(false);
    useNomadNetworkStore.setState({
      nodes: new Map([
        [
          'abc',
          {
            destination_hash: 'abc1234567890',
            display_name: 'TOPICS! The Nomad Forum',
            favorited: true,
          },
        ],
        [
          'def',
          {
            destination_hash: 'def1234567890',
            display_name: 'Announce only',
            favorited: false,
          },
        ],
      ]),
      lastRefreshAt: Date.now(),
      nomadApiAvailable: true,
      refreshFromSidecar: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('filters favourites tab and search query', async () => {
    const user = userEvent.setup();
    render(<NomadNetworkPanel />);

    expect(screen.getByText('TOPICS! The Nomad Forum')).toBeInTheDocument();
    expect(screen.queryByText('Announce only')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'nomadNetwork.announces' }));
    expect(screen.getByText('Announce only')).toBeInTheDocument();

    const search = screen.getByRole('searchbox');
    await user.type(search, 'topics');
    expect(screen.getByText('TOPICS! The Nomad Forum')).toBeInTheDocument();
    expect(screen.queryByText('Announce only')).not.toBeInTheDocument();
  });

  it('calls toggleFavorite when star is clicked', async () => {
    const user = userEvent.setup();
    const toggleFavorite = vi.fn().mockResolvedValue(undefined);
    useNomadNetworkStore.setState({
      toggleFavorite,
      nodes: new Map([
        [
          'abc1234567890',
          {
            destination_hash: 'abc1234567890',
            display_name: 'TOPICS! The Nomad Forum',
            favorited: true,
          },
        ],
      ]),
    });

    render(<NomadNetworkPanel />);
    await user.click(screen.getByRole('button', { name: 'nomadNetwork.toggleFavorite' }));

    expect(toggleFavorite).toHaveBeenCalledWith('abc1234567890', false);
  });
});
