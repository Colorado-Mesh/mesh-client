import { render, screen, waitFor } from '@testing-library/react';
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
const onReticulumStatus = vi.fn();

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  isReticulumSidecarRunning: () => isReticulumSidecarRunning(),
}));

import { useNomadNetworkStore } from '../stores/nomadNetworkStore';
import NomadNetworkPanel from './NomadNetworkPanel';

describe('NomadNetworkPanel', () => {
  beforeEach(() => {
    isReticulumSidecarRunning.mockResolvedValue(false);
    onReticulumStatus.mockReturnValue(() => {});
    window.electronAPI.reticulum.onStatus = onReticulumStatus;
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
      fetchNomadPage: vi.fn().mockResolvedValue({ ok: true, content: 'hello' }),
      fetchNomadFile: vi.fn().mockResolvedValue({ ok: true, content_base64: 'aGVsbG8=' }),
    });
  });

  it('filters favourites tab and search query', async () => {
    const user = userEvent.setup();
    render(<NomadNetworkPanel />);

    expect(screen.getByText('TOPICS! The Nomad Forum')).toBeInTheDocument();
    expect(screen.getByText('Announce only')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'nomadNetwork.favourites' }));
    expect(screen.getByText('TOPICS! The Nomad Forum')).toBeInTheDocument();
    expect(screen.queryByText('Announce only')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'nomadNetwork.announces' }));
    const search = screen.getByRole('searchbox');
    await user.type(search, 'topics');
    expect(screen.getByText('TOPICS! The Nomad Forum')).toBeInTheDocument();
    expect(screen.queryByText('Announce only')).not.toBeInTheDocument();
  });

  it('renders formatted micron page content', async () => {
    const user = userEvent.setup();
    const fetchNomadPage = vi.fn().mockResolvedValue({
      ok: true,
      content: '`!Hello Nomad:`!\n`[More`:/page/other.mu`]',
      content_type: 'micron',
    });
    useNomadNetworkStore.setState({
      fetchNomadPage,
      nodes: new Map([
        [
          'abc1234567890',
          {
            destination_hash: 'abc1234567890',
            display_name: 'Test Node',
            favorited: false,
          },
        ],
      ]),
    });

    render(<NomadNetworkPanel />);
    await user.click(screen.getByRole('button', { name: 'nomadNetwork.openNode' }));

    await waitFor(() => {
      const micronRoot = document.querySelector('.nomad-micron-page');
      expect(micronRoot?.textContent).toContain('Hello Nomad');
    });
    const micronRoot = document.querySelector('.nomad-micron-page')!;
    const internalLink = micronRoot.querySelector('[data-action="openNode"]');
    expect(internalLink?.textContent).toContain('More');
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
