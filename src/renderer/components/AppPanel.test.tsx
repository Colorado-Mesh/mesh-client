import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { FONT_SCALE_STORAGE_KEY } from '../lib/fontScale';
import { MESSAGE_RETENTION_KEYS } from '../lib/messageRetention';
import {
  resetLiveChannelKeyStoreForTests,
  setLiveChannelKeys,
} from '../stores/liveChannelKeyStore';
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

  it('places collapsed Translation above a collapsed MECP section', async () => {
    const { container } = render(
      <ToastProvider>
        <AppPanel {...defaultProps} />
      </ToastProvider>,
    );
    await act(async () => {});
    const translation = container.querySelector('details[data-setting-anchor="app.translation"]');
    const mecp = container
      .querySelector('[data-setting-anchor="app.mecp.showComposeButton"]')
      ?.closest('details');
    expect(translation).toBeInstanceOf(HTMLDetailsElement);
    expect(mecp).toBeInstanceOf(HTMLDetailsElement);
    expect((translation as HTMLDetailsElement).open).toBe(false);
    expect(mecp!.open).toBe(false);
    expect(
      (translation as Node).compareDocumentPosition(mecp as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

    // Wait on the id: findByLabelText re-scans the whole App panel every poll, which ran past the
    // 5s test timeout on CI coverage runners. Then check the label once.
    await waitFor(() => {
      expect(document.getElementById('apppanel-message-retention-meshtastic-count')).toHaveValue(
        7500,
      );
    });
    expect(screen.getByLabelText(/Cap stored messages, keep newest 7500 messages/i)).toBe(
      document.getElementById('apppanel-message-retention-meshtastic-count'),
    );
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

describe('AppPanel: theme presets', () => {
  const defaultProps = {
    protocol: 'meshtastic' as const,
    nodeCount: 0,
    messageCount: 0,
    channels: [] as { index: number; name: string }[],
    myNodeNum: null as number | null,
    onLocationFilterChange: vi.fn(),
  };

  beforeEach(() => {
    localStorage.removeItem('mesh-client:themeColors');
    localStorage.removeItem('mesh-client:themeSurface');
  });

  it('picks surfaces and an accent separately, one click each', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} />
      </ToastProvider>,
    );
    const charcoal = await screen.findByRole('button', { name: 'Charcoal' });
    const signature = screen.getByRole('button', { name: 'Signature orange' });
    expect(charcoal).toHaveAttribute('aria-pressed', 'true');
    expect(signature).toHaveAttribute('aria-pressed', 'true');

    // Slate replaces the neutrals everywhere (every ink-* class) and keeps the accent.
    fireEvent.click(screen.getByRole('button', { name: 'Slate' }));
    expect(screen.getByRole('button', { name: 'Slate' })).toHaveAttribute('aria-pressed', 'true');
    expect(charcoal).toHaveAttribute('aria-pressed', 'false');
    expect(signature).toHaveAttribute('aria-pressed', 'true');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--color-ink-800')).toBe('#1e293b');
    expect(root.style.getPropertyValue('--color-app-bg')).toBe('#020617');
    expect(localStorage.getItem('mesh-client:themeSurface')).toBe('slate');

    // Sky changes the accent and sent bubbles and keeps Slate.
    fireEvent.click(screen.getByRole('button', { name: 'Sky' }));
    expect(screen.getByRole('button', { name: 'Sky' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Slate' })).toHaveAttribute('aria-pressed', 'true');
    expect(root.style.getPropertyValue('--color-brand-green')).toBe('#38bdf8');

    fireEvent.click(charcoal);
    fireEvent.click(signature);
    expect(localStorage.getItem('mesh-client:themeColors')).toBeNull();
    expect(localStorage.getItem('mesh-client:themeSurface')).toBeNull();
    expect(root.style.getPropertyValue('--color-ink-800')).toBe('#333333');
  });

  it('says so when an unreadable accent is put back to the default', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} />
      </ToastProvider>,
    );
    const accentSwatches = await screen.findByRole('group', { name: /^Accent Primary/ });
    fireEvent.click(within(accentSwatches).getByRole('button', { name: 'Slate 950 #020617' }));
    expect(await screen.findByText(/too close to the app background to read/)).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue('--color-brand-green')).toBe('#ffa31a');
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

describe('AppPanel: font size control', () => {
  const defaultProps = {
    protocol: 'meshtastic' as const,
    nodeCount: 0,
    messageCount: 0,
    channels: [] as { index: number; name: string }[],
    myNodeNum: null as number | null,
    onLocationFilterChange: vi.fn(),
  };

  beforeEach(() => {
    localStorage.removeItem(FONT_SCALE_STORAGE_KEY);
    document.documentElement.style.fontSize = '';
  });

  it('hydrates the slider and percentage label from the stored scale', async () => {
    localStorage.setItem(FONT_SCALE_STORAGE_KEY, '1.2');
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} />
      </ToastProvider>,
    );

    const slider = await screen.findByRole('slider', { name: /font size/i });
    expect(slider).toHaveValue('1.2');
    expect(screen.getByText('120%')).toBeInTheDocument();
  });

  it('dragging the slider applies and persists the scale', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} />
      </ToastProvider>,
    );

    const slider = await screen.findByRole('slider', { name: /font size/i });
    act(() => {
      fireEvent.change(slider, { target: { value: '1.25' } });
    });

    expect(document.documentElement.style.fontSize).toBe('125%');
    expect(localStorage.getItem(FONT_SCALE_STORAGE_KEY)).toBe('1.25');
    expect(screen.getByText('125%')).toBeInTheDocument();
  });

  it('increase and decrease buttons step by FONT_SCALE_STEP', () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} />
      </ToastProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /increase font size/i }));
    });
    expect(localStorage.getItem(FONT_SCALE_STORAGE_KEY)).toBe('1.05');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /decrease font size/i }));
    });
    expect(localStorage.getItem(FONT_SCALE_STORAGE_KEY)).toBe('1');
  });

  it('reset clears storage and returns the label to 100%', async () => {
    localStorage.setItem(FONT_SCALE_STORAGE_KEY, '1.5');
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} />
      </ToastProvider>,
    );

    const fontSizeLabel = await screen.findByText('150%');
    expect(fontSizeLabel).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /reset font size/i }));
    });

    expect(localStorage.getItem(FONT_SCALE_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.style.fontSize).toBe('100%');
    expect(fontSizeLabel).toHaveTextContent('100%');
  });

  it('has no axe violations at the maximum scale', async () => {
    localStorage.setItem(FONT_SCALE_STORAGE_KEY, '1.5');
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

describe('AppPanel: Clear All Nodes success toast', () => {
  const defaultProps = {
    protocol: 'meshtastic' as const,
    nodeCount: 3,
    messageCount: 0,
    channels: [] as { index: number; name: string }[],
    myNodeNum: null as number | null,
    onLocationFilterChange: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValue({});
    vi.mocked(window.electronAPI.db.clearNodes).mockResolvedValue(undefined);
  });

  it('shows the resolved node count in the success toast', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Destructive actions'));
    fireEvent.click(screen.getByRole('button', { name: /Clear All Nodes \(3\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /Clear 3 Nodes/i }));

    expect(
      await screen.findByText('Clear All Nodes (3) completed successfully.'),
    ).toBeInTheDocument();
    expect(window.electronAPI.db.clearNodes).toHaveBeenCalled();
  });
});

describe('AppPanel: clear messages by channel (#1098)', () => {
  const props = {
    protocol: 'meshcore' as const,
    nodeCount: 0,
    messageCount: 12,
    channels: [{ index: 3, name: '#test' }],
    myNodeNum: null as number | null,
    onLocationFilterChange: vi.fn(),
  };

  it('reloads the channel list each time the panel is shown', async () => {
    const getChannels = vi.mocked(window.electronAPI.db.getMeshcoreMessageChannels);
    getChannels.mockReset();
    getChannels.mockResolvedValue([]);
    const { rerender } = render(
      <ToastProvider>
        <AppPanel {...props} isActive />
      </ToastProvider>,
    );
    const select = await screen.findByRole('combobox', { name: 'Channel' });
    expect(within(select).getAllByRole('option')).toHaveLength(1);

    // Messages arrive on channel 3 while another panel is open.
    getChannels.mockResolvedValue([{ channel: 3 }]);
    rerender(
      <ToastProvider>
        <AppPanel {...props} isActive={false} />
      </ToastProvider>,
    );
    rerender(
      <ToastProvider>
        <AppPanel {...props} isActive />
      </ToastProvider>,
    );
    expect(
      await within(select).findByRole('option', { name: 'Channel 3: #test' }),
    ).toBeInTheDocument();
    expect(getChannels).toHaveBeenCalledTimes(2);
  });

  it('clears the selected channel for the radio that was connected when Clear was clicked', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreMessageChannels).mockResolvedValue([{ channel: 3 }]);
    const clearByChannel = vi.mocked(window.electronAPI.db.clearMeshcoreMessagesByChannel);
    clearByChannel.mockReset();
    clearByChannel.mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <AppPanel {...props} myNodeNum={1} isActive />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Destructive actions'));
    const select = await screen.findByRole('combobox', { name: 'Channel' });
    fireEvent.change(select, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear Messages (12)' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Clear Channel 3: #test',
      }),
    );
    await waitFor(() => {
      expect(clearByChannel).toHaveBeenCalledWith(3, 1, undefined);
    });
  });

  it('clears by live channel identity key when the slot key is known', async () => {
    setLiveChannelKeys('meshcore', { radioNodeId: 1, keyByIndex: { 3: 'abcdef0123456789' } });
    vi.mocked(window.electronAPI.db.getMeshcoreMessageChannels).mockResolvedValue([{ channel: 3 }]);
    const clearByChannel = vi.mocked(window.electronAPI.db.clearMeshcoreMessagesByChannel);
    clearByChannel.mockReset();
    clearByChannel.mockResolvedValue(undefined);
    try {
      render(
        <ToastProvider>
          <AppPanel {...props} myNodeNum={1} isActive />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByText('Destructive actions'));
      const select = await screen.findByRole('combobox', { name: 'Channel' });
      fireEvent.change(select, { target: { value: '3' } });
      fireEvent.click(screen.getByRole('button', { name: 'Clear Messages (12)' }));
      fireEvent.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'Clear Channel 3: #test',
        }),
      );
      await waitFor(() => {
        expect(clearByChannel).toHaveBeenCalledWith(3, 1, 'abcdef0123456789');
      });
    } finally {
      resetLiveChannelKeyStoreForTests();
    }
  });

  it('clears nothing if another radio connected before the clear was confirmed', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreMessageChannels).mockResolvedValue([{ channel: 3 }]);
    const clearByChannel = vi.mocked(window.electronAPI.db.clearMeshcoreMessagesByChannel);
    clearByChannel.mockReset();
    clearByChannel.mockResolvedValue(undefined);
    const { rerender } = render(
      <ToastProvider>
        <AppPanel {...props} myNodeNum={1} isActive />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Destructive actions'));
    const select = await screen.findByRole('combobox', { name: 'Channel' });
    fireEvent.change(select, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear Messages (12)' }));
    rerender(
      <ToastProvider>
        <AppPanel {...props} myNodeNum={2} isActive />
      </ToastProvider>,
    );
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Clear Channel 3: #test',
      }),
    );
    expect(clearByChannel).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        'The connected radio changed while this was open, so messages in Channel 3: #test were not cleared.',
      ),
    ).toBeInTheDocument();
  });

  it('does not clear a Meshtastic channel when no live key was captured', async () => {
    vi.mocked(window.electronAPI.db.getMessageChannels).mockResolvedValue([{ channel: 3 }]);
    const clearByChannel = vi.mocked(window.electronAPI.db.clearMessagesByChannel);
    clearByChannel.mockReset();
    clearByChannel.mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <AppPanel {...props} protocol="meshtastic" myNodeNum={1} isActive />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Destructive actions'));
    const select = await screen.findByRole('combobox', { name: 'Channel' });
    fireEvent.change(select, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear Messages (12)' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Clear Channel 3: #test',
      }),
    );
    expect(clearByChannel).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        'Channel 3: #test is no longer in that slot on the radio, so nothing was cleared.',
      ),
    ).toBeInTheDocument();
  });

  it('clears nothing if the slot channel key changed before the clear was confirmed', async () => {
    setLiveChannelKeys('meshcore', { radioNodeId: 1, keyByIndex: { 3: 'abcdef0123456789' } });
    vi.mocked(window.electronAPI.db.getMeshcoreMessageChannels).mockResolvedValue([{ channel: 3 }]);
    const clearByChannel = vi.mocked(window.electronAPI.db.clearMeshcoreMessagesByChannel);
    clearByChannel.mockReset();
    clearByChannel.mockResolvedValue(undefined);
    try {
      render(
        <ToastProvider>
          <AppPanel {...props} myNodeNum={1} isActive />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByText('Destructive actions'));
      const select = await screen.findByRole('combobox', { name: 'Channel' });
      fireEvent.change(select, { target: { value: '3' } });
      fireEvent.click(screen.getByRole('button', { name: 'Clear Messages (12)' }));
      setLiveChannelKeys('meshcore', { radioNodeId: 1, keyByIndex: { 3: '0123456789abcdef' } });
      fireEvent.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'Clear Channel 3: #test',
        }),
      );
      expect(clearByChannel).not.toHaveBeenCalled();
      expect(
        await screen.findByText(
          'Channel 3: #test is no longer in that slot on the radio, so nothing was cleared.',
        ),
      ).toBeInTheDocument();
    } finally {
      resetLiveChannelKeyStoreForTests();
    }
  });
});
