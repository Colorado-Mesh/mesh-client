import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { MESSAGE_RETENTION_KEYS } from '../lib/messageRetention';
import AppPanel from './AppPanel';
import { ToastProvider } from './Toast';

describe('AppPanel accessibility', () => {
  const defaultProps = {
    protocol: 'meshtastic' as const,
    nodeCount: 0,
    messageCount: 0,
    channels: [] as { index: number; name: string }[],
    myNodeNum: null as number | null,
    onLocationFilterChange: vi.fn(),
  };

  it('has no axe violations with empty state', async () => {
    const { container } = render(
      <ToastProvider>
        <AppPanel {...defaultProps} />
      </ToastProvider>,
    );
    await act(async () => {});
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('AppPanel: DB-backed message retention card (issue #387)', () => {
  const defaultProps = {
    nodeCount: 0,
    messageCount: 0,
    channels: [] as { index: number; name: string }[],
    myNodeNum: null as number | null,
    onLocationFilterChange: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(window.electronAPI.appSettings.getAll).mockReset();
    vi.mocked(window.electronAPI.appSettings.set).mockReset();
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValue({
      [MESSAGE_RETENTION_KEYS.meshtasticEnabled]: '1',
      [MESSAGE_RETENTION_KEYS.meshtasticCount]: '4000',
      [MESSAGE_RETENTION_KEYS.meshcoreEnabled]: '1',
      [MESSAGE_RETENTION_KEYS.meshcoreCount]: '4000',
    });
    vi.mocked(window.electronAPI.appSettings.set).mockResolvedValue({ changes: 1 });
  });

  it('hydrates the meshtastic count from the SQLite-backed app_settings IPC', async () => {
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValueOnce({
      [MESSAGE_RETENTION_KEYS.meshtasticEnabled]: '1',
      [MESSAGE_RETENTION_KEYS.meshtasticCount]: '7500',
      [MESSAGE_RETENTION_KEYS.meshcoreEnabled]: '1',
      [MESSAGE_RETENTION_KEYS.meshcoreCount]: '4000',
    });

    render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="meshtastic" />
      </ToastProvider>,
    );

    const input = await screen.findByLabelText(/Cap stored messages, keep newest 7500 messages/i);
    expect(input).toHaveValue(7500);
  });

  it('debounces count edits and persists via appSettings.set with the meshtastic key', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="meshtastic" />
      </ToastProvider>,
    );

    const input = await screen.findByLabelText(/Cap stored messages, keep newest 4000 messages/i);

    fireEvent.change(input, { target: { value: '6000' } });
    expect(window.electronAPI.appSettings.set).not.toHaveBeenCalledWith(
      MESSAGE_RETENTION_KEYS.meshtasticCount,
      expect.anything(),
    );

    await waitFor(
      () => {
        expect(window.electronAPI.appSettings.set).toHaveBeenCalledWith(
          MESSAGE_RETENTION_KEYS.meshtasticCount,
          '6000',
        );
      },
      { timeout: 1500 },
    );
  });

  it('toggling the checkbox writes "1"/"0" via appSettings.set', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="meshtastic" />
      </ToastProvider>,
    );

    // Distinguish the checkbox (no count suffix) from the number input.
    const checkbox = await screen.findByRole('checkbox', {
      name: /^Cap stored messages, keep newest$/,
    });

    await waitFor(() => {
      expect(checkbox).toBeChecked();
    });

    act(() => {
      fireEvent.click(checkbox);
    });

    await waitFor(() => {
      expect(window.electronAPI.appSettings.set).toHaveBeenCalledWith(
        MESSAGE_RETENTION_KEYS.meshtasticEnabled,
        '0',
      );
    });
  });

  it('shows the meshcore field when protocol is meshcore', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="meshcore" />
      </ToastProvider>,
    );

    const input = await screen.findByLabelText(/Cap stored messages, keep newest 4000 messages/i);
    expect(input.id).toBe('apppanel-message-retention-meshcore-count');
  });
});

describe('AppPanel: sound notification toggle', () => {
  const defaultProps = {
    protocol: 'meshtastic' as const,
    nodeCount: 0,
    messageCount: 0,
    channels: [] as { index: number; name: string }[],
    myNodeNum: null as number | null,
    onLocationFilterChange: vi.fn(),
  };

  beforeEach(() => {
    localStorage.removeItem('mesh-client:notifMuted');
  });

  it('renders checked by default when localStorage has no mute value', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} />
      </ToastProvider>,
    );
    const checkbox = await screen.findByRole('checkbox', { name: /sound notifications/i });
    expect(checkbox).toBeChecked();
  });

  it('renders unchecked when localStorage notifMuted is 1', async () => {
    localStorage.setItem('mesh-client:notifMuted', '1');
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} />
      </ToastProvider>,
    );
    const checkbox = await screen.findByRole('checkbox', { name: /sound notifications/i });
    expect(checkbox).not.toBeChecked();
  });

  it('unchecking writes notifMuted=1 to localStorage', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} />
      </ToastProvider>,
    );
    const checkbox = await screen.findByRole('checkbox', { name: /sound notifications/i });
    act(() => {
      fireEvent.click(checkbox);
    });
    expect(checkbox).not.toBeChecked();
    expect(localStorage.getItem('mesh-client:notifMuted')).toBe('1');
  });

  it('checking restores notifMuted=0 in localStorage', async () => {
    localStorage.setItem('mesh-client:notifMuted', '1');
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} />
      </ToastProvider>,
    );
    const checkbox = await screen.findByRole('checkbox', { name: /sound notifications/i });
    act(() => {
      fireEvent.click(checkbox);
    });
    expect(checkbox).toBeChecked();
    expect(localStorage.getItem('mesh-client:notifMuted')).toBe('0');
  });
});

describe('AppPanel: RRC unread all room messages toggle', () => {
  const defaultProps = {
    nodeCount: 0,
    messageCount: 0,
    channels: [] as { index: number; name: string }[],
    myNodeNum: null as number | null,
    onLocationFilterChange: vi.fn(),
  };

  beforeEach(() => {
    localStorage.removeItem('mesh-client:appSettings');
  });

  it('shows the toggle only on the Reticulum protocol tab, checked by default', async () => {
    const { unmount } = render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="meshtastic" />
      </ToastProvider>,
    );
    expect(
      screen.queryByRole('checkbox', { name: /RRC unread for all room messages/i }),
    ).toBeNull();
    unmount();

    const { unmount: unmountMeshcore } = render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="meshcore" />
      </ToastProvider>,
    );
    expect(
      screen.queryByRole('checkbox', { name: /RRC unread for all room messages/i }),
    ).toBeNull();
    unmountMeshcore();

    render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="reticulum" />
      </ToastProvider>,
    );
    const checkbox = await screen.findByRole('checkbox', {
      name: /RRC unread for all room messages/i,
    });
    expect(checkbox).toBeChecked();
  });

  it('persists rrcUnreadAllRoomMessages false and remounts unchecked', async () => {
    const { unmount } = render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="reticulum" />
      </ToastProvider>,
    );
    const checkbox = await screen.findByRole('checkbox', {
      name: /RRC unread for all room messages/i,
    });
    act(() => {
      fireEvent.click(checkbox);
    });
    await waitFor(() => {
      const raw = localStorage.getItem('mesh-client:appSettings');
      expect(raw).toContain('"rrcUnreadAllRoomMessages":false');
    });
    unmount();

    render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="reticulum" />
      </ToastProvider>,
    );
    expect(
      await screen.findByRole('checkbox', { name: /RRC unread for all room messages/i }),
    ).not.toBeChecked();
  });
});

describe('AppPanel: MeshCore Radio-owned settings are not on App', () => {
  const defaultProps = {
    nodeCount: 0,
    messageCount: 0,
    channels: [] as { index: number; name: string }[],
    myNodeNum: null as number | null,
    onLocationFilterChange: vi.fn(),
  };

  beforeEach(() => {
    localStorage.removeItem('mesh-client:appSettings');
  });

  it('does not stamp meshcorePathHashMode or Open-wire into app settings on mount', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="meshcore" />
      </ToastProvider>,
    );
    await screen.findByText('App Settings');
    await waitFor(
      () => {
        const raw = localStorage.getItem('mesh-client:appSettings');
        expect(raw).toBeTruthy();
      },
      { timeout: 1500 },
    );
    const raw = localStorage.getItem('mesh-client:appSettings');
    expect(raw).not.toContain('meshcorePathHashMode');
    expect(raw).not.toContain('meshcoreOpenWireCompatEnabled');
  });

  it('does not show Open-wire or path-hash controls on App', async () => {
    const { container } = render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="meshcore" />
      </ToastProvider>,
    );
    await screen.findByText('App Settings');
    expect(
      screen.queryByRole('checkbox', { name: /Enable MeshCore Open compatibility/i }),
    ).toBeNull();
    expect(screen.queryByLabelText(/Default path hash size/i)).toBeNull();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('AppPanel: support bundle exports', () => {
  const defaultProps = {
    nodeCount: 0,
    messageCount: 0,
    channels: [] as { index: number; name: string }[],
    myNodeNum: null as number | null,
    onLocationFilterChange: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(window.electronAPI.support.exportBundle).mockReset();
    vi.mocked(window.electronAPI.support.exportBundle).mockResolvedValue(
      '/tmp/mesh-client-github-report.zip',
    );
  });

  it('invokes support.exportBundle with github mode', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="meshtastic" />
      </ToastProvider>,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: /Export support bundle for GitHub/i }),
    );

    await waitFor(() => {
      expect(window.electronAPI.support.exportBundle).toHaveBeenCalledWith(
        'github',
        expect.stringContaining('"capturedAt"'),
      );
    });
  });

  it('invokes support.exportBundle with developer mode', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="meshtastic" />
      </ToastProvider>,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: /Export support bundle for developer/i }),
    );

    await waitFor(() => {
      expect(window.electronAPI.support.exportBundle).toHaveBeenCalledWith(
        'developer',
        expect.stringContaining('"capturedAt"'),
      );
    });
  });
});

describe('AppPanel: Reticulum clear contacts danger zone', () => {
  const defaultProps = {
    nodeCount: 0,
    messageCount: 0,
    channels: [] as { index: number; name: string }[],
    myNodeNum: null as number | null,
    onLocationFilterChange: vi.fn(),
  };

  it('shows clear-all contacts only on the Reticulum tab when sidecar is ready', async () => {
    const { rerender } = render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="meshtastic" reticulumSidecarReady />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Destructive actions'));
    expect(screen.queryByRole('button', { name: /Clear All Contacts/i })).not.toBeInTheDocument();

    rerender(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="reticulum" reticulumSidecarReady />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Destructive actions'));
    expect(await screen.findByRole('button', { name: /Clear All Contacts \(0\)/i })).toBeEnabled();
  });

  it('disables clear-all contacts when the sidecar is not ready', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="reticulum" reticulumSidecarReady={false} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Destructive actions'));
    expect(await screen.findByRole('button', { name: /Clear All Contacts \(0\)/i })).toBeDisabled();
  });
});
