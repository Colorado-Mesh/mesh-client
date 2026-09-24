import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { UpdateState } from '../App';
import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import UpdateStatusIndicator from './UpdateStatusIndicator';

describe('UpdateStatusIndicator', () => {
  const noop = vi.fn();

  const baseAvailable: UpdateState = {
    phase: 'available',
    version: '9.9.9',
    isPackaged: true,
    isMac: false,
  };

  it('downloads packaged updates on darwin', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    const onDownload = vi.fn();
    const onViewRelease = vi.fn();
    const user = userEvent.setup();
    render(
      <UpdateStatusIndicator
        updateState={baseAvailable}
        onCheck={noop}
        onDownload={onDownload}
        onInstall={noop}
        onViewRelease={onViewRelease}
      />,
    );
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onViewRelease).not.toHaveBeenCalled();
  });

  it('shows Download on win32 when packaged and not mac', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('win32');
    const onDownload = vi.fn();
    const onViewRelease = vi.fn();
    const user = userEvent.setup();
    render(
      <UpdateStatusIndicator
        updateState={baseAvailable}
        onCheck={noop}
        onDownload={onDownload}
        onInstall={noop}
        onViewRelease={onViewRelease}
      />,
    );
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onViewRelease).not.toHaveBeenCalled();
  });

  it('shows Download on linux when packaged and not mac', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    const onDownload = vi.fn();
    const onViewRelease = vi.fn();
    const user = userEvent.setup();
    render(
      <UpdateStatusIndicator
        updateState={baseAvailable}
        onCheck={noop}
        onDownload={onDownload}
        onInstall={noop}
        onViewRelease={onViewRelease}
      />,
    );
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onViewRelease).not.toHaveBeenCalled();
  });

  it('downloads packaged updates when the event reports macOS', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('win32');
    const onDownload = vi.fn();
    const user = userEvent.setup();
    render(
      <UpdateStatusIndicator
        updateState={{ ...baseAvailable, isMac: true }}
        onCheck={noop}
        onDownload={onDownload}
        onInstall={noop}
        onViewRelease={noop}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('shows View Release when not packaged', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('win32');
    const onViewRelease = vi.fn();
    const user = userEvent.setup();
    render(
      <UpdateStatusIndicator
        updateState={{ ...baseAvailable, isPackaged: false }}
        onCheck={noop}
        onDownload={noop}
        onInstall={noop}
        onViewRelease={onViewRelease}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'View Release' }));
    expect(onViewRelease).toHaveBeenCalledTimes(1);
  });

  it.each(['darwin', 'win32', 'linux'] as const)(
    'shows a green restart control when an update is ready on %s',
    async (platform) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
      const onInstall = vi.fn();
      const user = userEvent.setup();
      render(
        <UpdateStatusIndicator
          updateState={{ phase: 'ready', isPackaged: true }}
          onCheck={noop}
          onDownload={noop}
          onInstall={onInstall}
          onViewRelease={noop}
        />,
      );

      const restart = screen.getByRole('button', { name: 'Restart' });
      expect(restart).toHaveClass('text-bright-green');
      await user.click(restart);
      expect(onInstall).toHaveBeenCalledTimes(1);
    },
  );

  it('shows a muted offline state without amber warning chrome', async () => {
    const onCheck = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <UpdateStatusIndicator
        updateState={{ phase: 'offline' }}
        onCheck={onCheck}
        onDownload={noop}
        onInstall={noop}
        onViewRelease={noop}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Updates paused (offline)' });
    expect(btn).toHaveClass('text-gray-400');
    expect(container.querySelector('.text-amber-500')).toBeNull();
    await user.click(btn);
    expect(onCheck).toHaveBeenCalledTimes(1);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
