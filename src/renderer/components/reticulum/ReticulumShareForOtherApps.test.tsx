import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { withMockedConsoleWarn } from '@/renderer/lib/vitestConsoleMock';

import { ReticulumShareForOtherApps } from './ReticulumShareForOtherApps';

const hostingTcp = {
  hosting: true,
  shared_instance_type: 'tcp',
  shared_instance_port: 37428,
  instance_control_port: 37429,
  instance_name: 'mesh-client',
  rpc_key: 'feedface',
};

describe('ReticulumShareForOtherApps', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.clipboard.writeText).mockResolvedValue(undefined);
  });

  it('explains why other apps should attach to mesh-client, with a docs link', async () => {
    const { container } = render(<ReticulumShareForOtherApps sidecarApiReady />);
    expect(screen.getByText(/Ratspeak features/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /using mesh-client with other Reticulum apps/i }),
    ).toHaveAttribute(
      'href',
      expect.stringContaining('#using-mesh-client-with-other-reticulum-apps'),
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows and copies the [reticulum] snippet while hosting', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockResolvedValue(hostingTcp);
    render(<ReticulumShareForOtherApps sidecarApiReady />);
    await user.click(screen.getByRole('button', { name: /Show the Reticulum config settings/ }));
    const snippet = await screen.findByLabelText('Reticulum config settings for other apps');
    expect(window.electronAPI.reticulum.proxyGet).toHaveBeenCalledWith(
      '/api/v1/stack/shared-instance',
    );
    expect(snippet.textContent).toContain('shared_instance_port = 37428');
    expect(snippet.textContent).toContain('rpc_key = feedface');
    await user.click(
      screen.getByRole('button', { name: 'Copy the Reticulum config settings for other apps' }),
    );
    expect(window.electronAPI.clipboard.writeText).toHaveBeenCalledWith(snippet.textContent);
    expect(await screen.findByText('Settings copied')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Hide the Reticulum config settings for other apps' }),
    );
    expect(
      screen.queryByLabelText('Reticulum config settings for other apps'),
    ).not.toBeInTheDocument();
  });

  it('tells the user to enable Share when mesh-client is not hosting', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockResolvedValue({
      ...hostingTcp,
      hosting: false,
    });
    render(<ReticulumShareForOtherApps sidecarApiReady />);
    await user.click(screen.getByRole('button', { name: /Show the Reticulum config settings/ }));
    expect(await screen.findByText(/not hosting a shared instance/)).toBeInTheDocument();
  });

  it('reports a load failure', async () => {
    await withMockedConsoleWarn(async () => {
      const user = userEvent.setup();
      vi.mocked(window.electronAPI.reticulum.proxyGet).mockRejectedValue(new Error('down'));
      render(<ReticulumShareForOtherApps sidecarApiReady />);
      await user.click(screen.getByRole('button', { name: /Show the Reticulum config settings/ }));
      expect(
        await screen.findByText(/Could not read the shared instance settings/),
      ).toBeInTheDocument();
    });
  });

  it('disables the show button until the sidecar API is ready', () => {
    render(<ReticulumShareForOtherApps sidecarApiReady={false} />);
    expect(
      screen.getByRole('button', { name: /Show the Reticulum config settings/ }),
    ).toBeDisabled();
  });
});
