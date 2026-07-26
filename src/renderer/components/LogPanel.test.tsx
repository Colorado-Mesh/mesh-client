import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import LogPanel from './LogPanel';

interface LogLine {
  ts: number;
  level: string;
  source: string;
  message: string;
}

async function renderWithRecentLines(lines: LogLine[], props?: Parameters<typeof LogPanel>[0]) {
  vi.mocked(window.electronAPI.log.getRecentLines).mockResolvedValue(lines);
  const view = render(<LogPanel {...props} />);
  await waitFor(() => {
    expect(window.electronAPI.log.getRecentLines).toHaveBeenCalled();
  });
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

describe('LogPanel accessibility', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.log.getRecentLines).mockResolvedValue([]);
    vi.mocked(window.electronAPI.log.onLine).mockReturnValue(() => {});
  });

  it('has no axe violations with empty log', async () => {
    const { container } = render(<LogPanel />);
    await act(async () => {});
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('shows role="alert" when clear log rejects', async () => {
    const user = userEvent.setup();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(window.electronAPI.log.clear).mockRejectedValueOnce(new Error('clear failed'));
    render(<LogPanel />);
    await act(async () => {});
    await user.click(screen.getByRole('button', { name: 'Delete log' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('clear failed');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[LogPanel\].*clear failed/s),
    );
    consoleWarnSpy.mockRestore();
  });
});

describe('LogPanel filtering / resize / virtualization', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.log.getRecentLines).mockResolvedValue([]);
    vi.mocked(window.electronAPI.log.onLine).mockReturnValue(() => {});
  });

  it('filters app lines by level checkboxes', async () => {
    const user = userEvent.setup();
    await renderWithRecentLines([
      { ts: 1, level: 'info', source: 'main', message: 'info line' },
      { ts: 2, level: 'warn', source: 'main', message: 'warn line' },
      { ts: 3, level: 'debug', source: 'main', message: 'debug line' },
    ]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'App (3)' })).toBeInTheDocument();
    });

    // Default filters hide debug; turning all levels off shows the empty-state copy.
    await user.click(screen.getByRole('checkbox', { name: 'Log / Info' }));
    await user.click(screen.getByRole('checkbox', { name: 'Warn / Error' }));
    expect(screen.getByText(/All level filters are off/)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Debug' }));
    expect(screen.queryByText(/All level filters are off/)).not.toBeInTheDocument();
    expect(screen.getByRole('log').querySelector('.relative')).toHaveStyle({ height: '18px' });
  });

  it('switches between app and device sources', async () => {
    const user = userEvent.setup();
    await renderWithRecentLines(
      [{ ts: 1, level: 'info', source: 'main', message: 'app only line' }],
      {
        protocol: 'meshcore',
        deviceLogs: [{ ts: 2, level: 'info', source: 'meshcore', message: 'device only line' }],
      },
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'App (1)' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Device (1)' })).toBeInTheDocument();
    });

    const appBtn = screen.getByRole('button', { name: 'App (1)' });
    const deviceBtn = screen.getByRole('button', { name: 'Device (1)' });
    expect(appBtn.className).toContain('text-brand-green');

    await user.click(deviceBtn);
    expect(deviceBtn.className).toContain('text-brand-green');
    expect(appBtn.className).not.toContain('text-brand-green');
    expect(screen.getByRole('log').querySelector('.relative')).toHaveStyle({ height: '18px' });
  });

  it('widens and narrows the sidebar panel width', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mesh-client:logPanelWidth', '320');
    render(<LogPanel />);
    await act(async () => {});
    expect(screen.getByText('320px')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Widen log panel' }));
    expect(screen.getByText('400px')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Narrow log panel' }));
    expect(screen.getByText('320px')).toBeInTheDocument();
  });

  it('virtualizes a large device log list via total height', async () => {
    const deviceLogs = Array.from({ length: 200 }, (_, i) => ({
      ts: i + 1,
      level: 'info',
      source: 'meshcore',
      message: `device line ${i}`,
    }));
    render(<LogPanel protocol="meshcore" deviceLogs={deviceLogs} />);
    await act(async () => {});
    await userEvent.setup().click(screen.getByRole('button', { name: /Device \(200\)/ }));

    const virtualRoot = screen.getByRole('log').querySelector('.relative');
    expect(virtualRoot).toHaveStyle({ height: '3600px' }); // 200 × estimateSize 18
  });

  it('persists drag resize width on mouse up', async () => {
    localStorage.setItem('mesh-client:logPanelWidth', '320');
    render(<LogPanel />);
    await act(async () => {});
    const handle = screen.getByRole('button', { name: 'Drag to resize log panel' });
    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(document, { clientX: 400 });
    fireEvent.mouseUp(document);
    await waitFor(() => {
      expect(Number(localStorage.getItem('mesh-client:logPanelWidth'))).toBeGreaterThan(320);
    });
  });
});
