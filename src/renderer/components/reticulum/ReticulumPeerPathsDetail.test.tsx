import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => {
      if (key === 'peerListPanel.pathsPreferAria') return 'Preferred path medium for this peer';
      if (key === 'peerListPanel.pathsHeading') return `Paths · ${opts?.hash ?? ''}…`;
      if (key === 'peerListPanel.pathsDetailAria') return `Ranked paths for ${opts?.hash ?? ''}`;
      if (key === 'peerListPanel.pathsGlobalPreference') return `Global: ${opts?.preference ?? ''}`;
      if (key === 'peerListPanel.pathsLoadFailed') return 'peerListPanel.pathsLoadFailed';
      if (key === 'peerListPanel.pathsPinFailed') return 'peerListPanel.pathsPinFailed';
      if (key === 'peerListPanel.pathsPreferAuto') return 'Auto (global)';
      if (key === 'networkPanel.reticulumStackSettings.pathMediumLowest') {
        return 'Lowest path (hop count)';
      }
      if (key === 'networkPanel.reticulumStackSettings.pathMediumNetwork') {
        return 'Network (non-RF)';
      }
      if (key === 'networkPanel.reticulumStackSettings.pathMediumRf') {
        return 'RF (RNode)';
      }
      return key;
    },
  }),
}));

const fetchReticulumPeerPaths = vi.fn();
const setReticulumPeerMediumPin = vi.fn();

vi.mock('@/renderer/lib/reticulum/reticulumPathMedium', async () => {
  const actual = await vi.importActual('@/renderer/lib/reticulum/reticulumPathMedium');
  return {
    ...(actual as Record<string, unknown>),
    fetchReticulumPeerPaths: (...args: unknown[]) => fetchReticulumPeerPaths(...args),
    setReticulumPeerMediumPin: (...args: unknown[]) => setReticulumPeerMediumPin(...args),
  };
});

import { pathMediumPreferenceLabelKey, ReticulumPeerPathsDetail } from './ReticulumPeerPathsDetail';

const DEST = 'aabbccddeeff00112233445566778899';

function okPathsResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    destination_hash: DEST,
    preference: 'lowest',
    pin: null,
    effective_preference: 'lowest',
    live: true,
    paths: [
      {
        active: true,
        hops: 2,
        via_hash: null,
        interface: 'RNode 41F4',
        interface_id: 1,
        medium: 'rf',
        timestamp: 1,
        expires: 2,
        expired: false,
      },
      {
        active: false,
        hops: 4,
        via_hash: 'dddddddddddddddddddddddddddddddd',
        interface: 'Ratspeak',
        interface_id: 2,
        medium: 'network',
        timestamp: 1,
        expires: 2,
        expired: false,
      },
    ],
    ...overrides,
  };
}

describe('pathMediumPreferenceLabelKey', () => {
  it('maps wire tokens to Network-tab path-medium keys', () => {
    expect(pathMediumPreferenceLabelKey('lowest')).toBe(
      'networkPanel.reticulumStackSettings.pathMediumLowest',
    );
    expect(pathMediumPreferenceLabelKey('RF')).toBe(
      'networkPanel.reticulumStackSettings.pathMediumRf',
    );
    expect(pathMediumPreferenceLabelKey('network')).toBe(
      'networkPanel.reticulumStackSettings.pathMediumNetwork',
    );
    expect(pathMediumPreferenceLabelKey('wired')).toBeNull();
  });
});

describe('ReticulumPeerPathsDetail', () => {
  let onEventHandler: ((evt: { type: string; payload: unknown }) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    onEventHandler = null;
    vi.mocked(window.electronAPI.reticulum.onEvent).mockImplementation((cb) => {
      onEventHandler = cb;
      return () => {
        onEventHandler = null;
      };
    });
    fetchReticulumPeerPaths.mockResolvedValue(okPathsResult());
    setReticulumPeerMediumPin.mockResolvedValue({ ok: true });
  });

  it('renders path slots and has no axe violations', async () => {
    const { container } = render(
      <ReticulumPeerPathsDetail destinationHash={DEST} onClose={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/RNode 41F4/)).toBeInTheDocument();
    });
    expect(screen.getByText('Global: Lowest path (hop count)')).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('pins RF via the prefer control', async () => {
    const user = userEvent.setup();
    render(<ReticulumPeerPathsDetail destinationHash={DEST} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Preferred path medium/i)).toBeInTheDocument();
    });
    await user.selectOptions(screen.getByLabelText(/Preferred path medium/i), 'rf');
    await waitFor(() => {
      expect(setReticulumPeerMediumPin).toHaveBeenCalledWith(DEST, 'rf');
    });
  });

  it('rolls back the prefer control when pin fails', async () => {
    setReticulumPeerMediumPin.mockResolvedValue({ ok: false });
    render(<ReticulumPeerPathsDetail destinationHash={DEST} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Preferred path medium/i)).not.toBeDisabled();
    });
    const select = screen.getByLabelText(/Preferred path medium/i);
    expect(select).toHaveValue('auto');
    fireEvent.change(select, { target: { value: 'rf' } });
    await waitFor(() => {
      expect(setReticulumPeerMediumPin).toHaveBeenCalledWith(DEST, 'rf');
      expect(select).toHaveValue('auto');
      expect(screen.getByText('peerListPanel.pathsPinFailed')).toBeInTheDocument();
    });
  });

  it('renders pathsLoadFailed when fetch returns ok: false', async () => {
    fetchReticulumPeerPaths.mockResolvedValue({ ok: false, paths: [] });
    render(<ReticulumPeerPathsDetail destinationHash={DEST} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('peerListPanel.pathsLoadFailed')).toBeInTheDocument();
    });
  });

  it('refreshes when path_medium_preference WS event arrives', async () => {
    render(<ReticulumPeerPathsDetail destinationHash={DEST} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('Global: Lowest path (hop count)')).toBeInTheDocument();
    });
    fetchReticulumPeerPaths.mockResolvedValue(
      okPathsResult({
        preference: 'rf',
        effective_preference: 'rf',
        paths: [
          {
            active: true,
            hops: 1,
            via_hash: null,
            interface: 'RNode 41F4',
            interface_id: 1,
            medium: 'rf',
            timestamp: 1,
            expires: 2,
            expired: false,
          },
        ],
      }),
    );
    expect(onEventHandler).toBeTruthy();
    act(() => {
      onEventHandler?.({ type: 'path_medium_preference', payload: { preference: 'rf' } });
    });
    await waitFor(() => {
      expect(screen.getByText('Global: RF (RNode)')).toBeInTheDocument();
    });
    expect(fetchReticulumPeerPaths.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
