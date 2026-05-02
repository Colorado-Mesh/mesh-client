import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { UpdateState } from '../App';
import UpdateStatusIndicator from './UpdateStatusIndicator';

describe('UpdateStatusIndicator', () => {
  const noop = vi.fn();

  const baseAvailable: UpdateState = {
    phase: 'available',
    version: '9.9.9',
    isPackaged: true,
    isMac: false,
  };

  it('shows View Release on darwin even when isMac is false (footer hardening)', async () => {
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
    expect(screen.getByRole('button', { name: 'View Release' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View Release' }));
    expect(onViewRelease).toHaveBeenCalledTimes(1);
    expect(onDownload).not.toHaveBeenCalled();
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

  it('shows View Release when isMac is true regardless of getPlatform', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('win32');
    const onViewRelease = vi.fn();
    const user = userEvent.setup();
    render(
      <UpdateStatusIndicator
        updateState={{ ...baseAvailable, isMac: true }}
        onCheck={noop}
        onDownload={noop}
        onInstall={noop}
        onViewRelease={onViewRelease}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'View Release' }));
    expect(onViewRelease).toHaveBeenCalledTimes(1);
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
});
