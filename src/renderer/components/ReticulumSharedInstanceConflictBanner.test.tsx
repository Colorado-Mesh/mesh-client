import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ReticulumSharedInstanceConflictBanner } from './ReticulumSharedInstanceConflictBanner';

describe('ReticulumSharedInstanceConflictBanner', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockResolvedValue({
      enable_transport: false,
      share_instance: true,
      loglevel: 4,
      announce_interval_sec: 3600,
    });
    vi.mocked(window.electronAPI.reticulum.proxyPut).mockResolvedValue({ ok: true });
  });

  it('names the busy endpoint and explains why mesh-client does not attach', async () => {
    const { container } = render(
      <ReticulumSharedInstanceConflictBanner endpoint="127.0.0.1:37428" onRestartStack={vi.fn()} />,
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/127\.0\.0\.1:37428 is already in use/)).toBeInTheDocument();
    expect(within(alert).getByText(/Ratspeak features/)).toBeInTheDocument();
    expect(
      within(alert).getByRole('link', { name: /using mesh-client with other Reticulum apps/i }),
    ).toHaveAttribute(
      'href',
      expect.stringContaining('#using-mesh-client-with-other-reticulum-apps'),
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('disables share instance then restarts via callback', async () => {
    const user = userEvent.setup();
    const onRestartStack = vi.fn().mockResolvedValue(undefined);
    render(
      <ReticulumSharedInstanceConflictBanner
        endpoint="rns/default"
        onRestartStack={onRestartStack}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Turn off Share instance and restart the stack' }),
    );
    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPut).toHaveBeenCalledWith(
        '/api/v1/stack/settings',
        expect.objectContaining({ share_instance: false }),
      );
      expect(onRestartStack).toHaveBeenCalled();
    });
  });

  it('shows the error and skips restart when the settings PUT fails', async () => {
    const user = userEvent.setup();
    const onRestartStack = vi.fn();
    vi.mocked(window.electronAPI.reticulum.proxyPut).mockResolvedValue({
      ok: false,
      error: 'put failed',
    });
    render(
      <ReticulumSharedInstanceConflictBanner
        endpoint="rns/default"
        onRestartStack={onRestartStack}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Turn off Share instance and restart the stack' }),
    );
    expect(await screen.findByText('put failed')).toBeInTheDocument();
    expect(onRestartStack).not.toHaveBeenCalled();
  });
});
