import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReticulumSharedInstanceClientBanner } from './ReticulumSharedInstanceClientBanner';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('ReticulumSharedInstanceClientBanner', () => {
  beforeEach(() => {
    vi.stubGlobal('electronAPI', {
      reticulum: {
        proxyGet: vi.fn().mockResolvedValue({
          enable_transport: false,
          share_instance: true,
          loglevel: 4,
          announce_interval_sec: 3600,
        }),
        proxyPut: vi.fn().mockResolvedValue({ ok: true }),
      },
    });
  });

  it('disables share instance then restarts via callback', async () => {
    const user = userEvent.setup();
    const onRestartStack = vi.fn().mockResolvedValue(undefined);
    render(<ReticulumSharedInstanceClientBanner onRestartStack={onRestartStack} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumSharedInstance.disableShareAria',
      }),
    );

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith(
        '/api/v1/stack/settings',
        expect.objectContaining({ share_instance: false }),
      );
      expect(onRestartStack).toHaveBeenCalled();
    });
  });

  it('shows error and skips restart when settings PUT fails', async () => {
    const user = userEvent.setup();
    const onRestartStack = vi.fn();
    vi.mocked(window.electronAPI.reticulum.proxyPut).mockResolvedValue({
      ok: false,
      error: 'put failed',
    });
    render(<ReticulumSharedInstanceClientBanner onRestartStack={onRestartStack} />);

    await user.click(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumSharedInstance.disableShareAria',
      }),
    );

    await waitFor(() => {
      expect(screen.getByText('put failed')).toBeInTheDocument();
    });
    expect(onRestartStack).not.toHaveBeenCalled();
  });
});
