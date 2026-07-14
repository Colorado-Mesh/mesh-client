import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
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

import { clearNomadPageCache } from '@/renderer/lib/nomad/nomadPageCache';

import { useNomadNetworkStore } from '../stores/nomadNetworkStore';
import NomadNetworkPanel from './NomadNetworkPanel';

async function openAnnouncesNode(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'nomadNetwork.announces' }));
  await user.click(screen.getByRole('button', { name: 'nomadNetwork.openNode' }));
}

describe('NomadNetworkPanel', () => {
  beforeEach(() => {
    clearNomadPageCache();
    localStorage.removeItem('mesh-client:nomadPageFitWidth');
    localStorage.removeItem('mesh-client:nomadNodeListCollapsed');
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

  it('defaults to favourites tab and filters search query', async () => {
    const user = userEvent.setup();
    render(<NomadNetworkPanel />);

    expect(screen.getByRole('tab', { name: 'nomadNetwork.favourites' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'nomadNetwork.announces' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByText('TOPICS! The Nomad Forum')).toBeInTheDocument();
    expect(screen.queryByText('Announce only')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'nomadNetwork.announces' }));
    expect(screen.getByText('TOPICS! The Nomad Forum')).toBeInTheDocument();
    expect(screen.getByText('Announce only')).toBeInTheDocument();

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
    await openAnnouncesNode(user);

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

  it('calls onOpenDm when Message button is clicked', async () => {
    const user = userEvent.setup();
    const onOpenDm = vi.fn();
    isReticulumSidecarRunning.mockResolvedValue(true);
    const fetchNomadPage = vi.fn().mockResolvedValue({
      ok: true,
      content: 'hello',
      content_type: 'text/plain',
    });
    useNomadNetworkStore.setState({
      fetchNomadPage,
      nodes: new Map([
        [
          'abc1234567890abcdef1234567890ab',
          {
            destination_hash: 'abc1234567890abcdef1234567890ab',
            display_name: 'Test Node',
            favorited: false,
          },
        ],
      ]),
    });

    render(<NomadNetworkPanel onOpenDm={onOpenDm} />);
    await openAnnouncesNode(user);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'nomadNetwork.sendMessageAria' }),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'nomadNetwork.sendMessageAria' }));
    expect(onOpenDm).toHaveBeenCalledWith('abc1234567890abcdef1234567890ab');
  });

  it('uses page cache on second load of the same address', async () => {
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
    await openAnnouncesNode(user);
    await waitFor(() => {
      expect(document.querySelector('.nomad-micron-page')?.textContent).toContain('Hello Nomad');
    });

    await user.click(screen.getByRole('button', { name: 'nomadNetwork.homePage' }));
    await waitFor(() => {
      expect(document.querySelector('.nomad-micron-page')?.textContent).toContain('Hello Nomad');
    });
    expect(fetchNomadPage).toHaveBeenCalledTimes(1);
  });

  it('reload bypasses cache and refetches', async () => {
    const user = userEvent.setup();
    const fetchNomadPage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: '`!Hello Nomad:`!',
        content_type: 'micron',
      })
      .mockResolvedValueOnce({
        ok: true,
        content: '`!Reloaded:`!',
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
    await openAnnouncesNode(user);
    await waitFor(() => {
      expect(document.querySelector('.nomad-micron-page')?.textContent).toContain('Hello Nomad');
    });
    await user.click(screen.getByRole('button', { name: 'nomadNetwork.reloadPage' }));
    await waitFor(() => {
      expect(document.querySelector('.nomad-micron-page')?.textContent).toContain('Reloaded');
    });
    expect(fetchNomadPage).toHaveBeenCalledTimes(2);
  });

  it('navigates back without refetching when page is cached', async () => {
    const user = userEvent.setup();
    const fetchNomadPage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        content: '`!Hello Nomad:`!\n`[Other`:/page/other.mu`]',
        content_type: 'micron',
      })
      .mockResolvedValueOnce({
        ok: true,
        content: '`!Other Page:`!',
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
    await openAnnouncesNode(user);
    await waitFor(() => {
      expect(document.querySelector('.nomad-micron-page')?.textContent).toContain('Hello Nomad');
    });

    const micronRoot = document.querySelector('.nomad-micron-page')!;
    const internalLink = micronRoot.querySelector('[data-action="openNode"]');
    expect(internalLink).toBeTruthy();
    await user.click(internalLink!);
    await waitFor(() => {
      expect(document.querySelector('.nomad-micron-page')?.textContent).toContain('Other Page');
    });

    const backButton = screen.getByRole('button', { name: 'nomadNetwork.back' });
    expect(backButton).toBeEnabled();
    await user.click(backButton);
    await waitFor(() => {
      expect(document.querySelector('.nomad-micron-page')?.textContent).toContain('Hello Nomad');
    });
    expect(fetchNomadPage).toHaveBeenCalledTimes(2);
  });

  it('resets to favourites when becoming active without an open page', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [isActive, setIsActive] = useState(true);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setIsActive((prev) => !prev);
            }}
          >
            toggle-active
          </button>
          <NomadNetworkPanel isActive={isActive} />
        </>
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('tab', { name: 'nomadNetwork.announces' }));
    expect(screen.getByRole('tab', { name: 'nomadNetwork.announces' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'toggle-active' }));
    await user.click(screen.getByRole('button', { name: 'toggle-active' }));

    expect(screen.getByRole('tab', { name: 'nomadNetwork.favourites' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'nomadNetwork.announces' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('keeps announces tab when becoming active with an open page', async () => {
    const user = userEvent.setup();
    const fetchNomadPage = vi.fn().mockResolvedValue({
      ok: true,
      content: 'hello',
      content_type: 'text/plain',
    });
    useNomadNetworkStore.setState({
      fetchNomadPage,
      nodes: new Map([
        [
          'def1234567890',
          {
            destination_hash: 'def1234567890',
            display_name: 'Announce only',
            favorited: false,
          },
        ],
      ]),
    });

    function Harness() {
      const [isActive, setIsActive] = useState(true);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setIsActive((prev) => !prev);
            }}
          >
            toggle-active
          </button>
          <NomadNetworkPanel isActive={isActive} />
        </>
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('tab', { name: 'nomadNetwork.announces' }));
    await user.click(screen.getByRole('button', { name: 'nomadNetwork.openNode' }));
    await waitFor(() => {
      expect(document.querySelector('.nomad-micron-page')?.textContent).toContain('hello');
    });

    await user.click(screen.getByRole('button', { name: 'toggle-active' }));
    await user.click(screen.getByRole('button', { name: 'toggle-active' }));

    expect(screen.getByRole('tab', { name: 'nomadNetwork.announces' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(document.querySelector('.nomad-micron-page')?.textContent).toContain('hello');
  });

  it('collapses node list and persists preference', async () => {
    localStorage.removeItem('mesh-client:nomadNodeListCollapsed');
    const user = userEvent.setup();
    render(<NomadNetworkPanel />);

    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    await user.click(screen.getByLabelText('nomadNetwork.collapseNodeList'));

    expect(localStorage.getItem('mesh-client:nomadNodeListCollapsed')).toBe('true');
    expect(screen.getByLabelText('nomadNetwork.expandNodeList')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'nomadNetwork.favourites' })).not.toBeInTheDocument();
    expect(screen.getByText('TT')).toBeInTheDocument();
    expect(screen.getByLabelText('nomadNetwork.openNode')).toBeInTheDocument();
  });

  it('opens a node from the collapsed node list', async () => {
    localStorage.setItem('mesh-client:nomadNodeListCollapsed', 'true');
    const user = userEvent.setup();
    const fetchNomadPage = vi.fn().mockResolvedValue({
      ok: true,
      content: '`!Collapsed browse:`!',
      content_type: 'micron',
    });
    useNomadNetworkStore.setState({
      fetchNomadPage,
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
    await user.click(screen.getByLabelText('nomadNetwork.openNode'));

    await waitFor(() => {
      expect(document.querySelector('.nomad-micron-page')?.textContent).toContain(
        'Collapsed browse',
      );
    });
  });

  it('keeps page content in a dual-axis scroll shell like Rooms', async () => {
    localStorage.removeItem('mesh-client:nomadNodeListCollapsed');
    const user = userEvent.setup();
    const fetchNomadPage = vi.fn().mockResolvedValue({
      ok: true,
      content: '`!Hello Nomad:`!',
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

    render(
      <div className="flex flex-col" style={{ height: '600px' }}>
        <NomadNetworkPanel />
      </div>,
    );
    await openAnnouncesNode(user);

    await waitFor(() => {
      expect(screen.getByTestId('nomad-page-scroll')).toBeInTheDocument();
    });

    const scroll = screen.getByTestId('nomad-page-scroll');
    expect(scroll).toHaveClass('nomad-page-scroll', 'overflow-auto');
    expect(scroll.parentElement).toHaveClass('min-h-0', 'min-w-0', 'flex-1');
  });

  it('defaults to fit-width and toggles/persists open width', async () => {
    localStorage.removeItem('mesh-client:nomadPageFitWidth');
    const user = userEvent.setup();
    const fetchNomadPage = vi.fn().mockResolvedValue({
      ok: true,
      content: '`!Hello Nomad:`!',
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
    await openAnnouncesNode(user);

    await waitFor(() => {
      expect(document.querySelector('.nomad-micron-page')).toHaveClass(
        'nomad-micron-page--fit-width',
      );
    });

    const toggle = screen.getByLabelText('nomadNetwork.openWidth');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);

    expect(localStorage.getItem('mesh-client:nomadPageFitWidth')).toBe('false');
    expect(document.querySelector('.nomad-micron-page')).not.toHaveClass(
      'nomad-micron-page--fit-width',
    );
    expect(screen.getByLabelText('nomadNetwork.fitWidth')).toHaveAttribute('aria-pressed', 'false');
  });

  it('restores open-width preference from localStorage', async () => {
    localStorage.setItem('mesh-client:nomadPageFitWidth', 'false');
    const user = userEvent.setup();
    const fetchNomadPage = vi.fn().mockResolvedValue({
      ok: true,
      content: '`!Hello Nomad:`!',
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
    await openAnnouncesNode(user);

    await waitFor(() => {
      expect(document.querySelector('.nomad-micron-page')).toBeTruthy();
    });
    expect(document.querySelector('.nomad-micron-page')).not.toHaveClass(
      'nomad-micron-page--fit-width',
    );
    expect(screen.getByLabelText('nomadNetwork.fitWidth')).toHaveAttribute('aria-pressed', 'false');
  });
});
