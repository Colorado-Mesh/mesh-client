import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { RETICULUM_DEFAULT_HUB_PRESETS } from '@/renderer/lib/reticulum/reticulumDefaultHubPresets';
import { isForeignSystemReticulum } from '@/renderer/lib/reticulum/reticulumInstanceStatus';
import { withMockedConsoleWarn } from '@/renderer/lib/vitestConsoleMock';
import { useReticulumSetupGuideStore } from '@/renderer/stores/reticulumSetupGuideStore';

import { ReticulumSetupGuide } from './ReticulumSetupGuide';

const hub = RETICULUM_DEFAULT_HUB_PRESETS[0];
const address = 'ab'.repeat(16);
const identity = {
  configured: true,
  identity_hash: 'cd'.repeat(16),
  lxmf_hash: address,
  display_name: 'Newcomer',
};
const onlineHub = {
  id: 'hub',
  name: hub.name,
  type: 'tcp',
  host: hub.host,
  port: hub.port,
  enabled: true,
  status: 'connected',
};
let interfaces: Record<string, unknown>[];
let live: boolean;

function props() {
  return {
    running: true,
    apiReady: true,
    connecting: false,
    identity,
    onStart: vi.fn().mockResolvedValue(undefined),
    onRestart: vi.fn().mockResolvedValue(undefined),
    onRefreshIdentity: vi.fn().mockResolvedValue(undefined),
    onShowInterfaces: vi.fn(),
    onNavigate: vi.fn().mockReturnValue(true),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useReticulumSetupGuideStore.setState({ dismissed: false, open: false });
  interfaces = [onlineHub];
  live = true;
  vi.mocked(window.electronAPI.reticulum.proxyGet).mockImplementation((path) => {
    if (path === '/api/v1/identity/status') return Promise.resolve(identity);
    if (path === '/api/v1/interfaces') return Promise.resolve({ interfaces });
    if (path === '/api/v1/status') return Promise.resolve({ rns_ready: live, lxmf_ready: live });
    return Promise.resolve({});
  });
  vi.mocked(window.electronAPI.reticulum.proxyPost).mockResolvedValue({ ok: true });
  vi.mocked(window.electronAPI.reticulum.proxyPut).mockResolvedValue({ ok: true });
  vi.mocked(window.electronAPI.clipboard.writeText).mockResolvedValue(undefined);
});

async function openConnectionStep() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Open setup guide' }));
  await user.click(screen.getByRole('button', { name: 'Let’s get started' }));
  await user.click(screen.getByRole('button', { name: 'Save name and continue' }));
  await screen.findByRole('heading', { name: 'Get connected' });
  return user;
}

describe('Reticulum first connection guide', () => {
  it('removes the entire banner when dismissed and stays hidden after remounting', async () => {
    const view = render(<ReticulumSetupGuide {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hide guide' }));
    expect(
      screen.queryByRole('heading', { name: 'Your first connection' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open setup guide' })).not.toBeInTheDocument();
    view.unmount();
    render(<ReticulumSetupGuide {...props()} />);
    expect(screen.queryByRole('button', { name: 'Open setup guide' })).not.toBeInTheDocument();
    await act(async () => {
      useReticulumSetupGuideStore.getState().setOpen(true);
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'Start here' })).toBeInTheDocument();
    expect(window.electronAPI.reticulum.proxyPost).not.toHaveBeenCalled();
  });

  it('does not start services or change configuration just by displaying the guide', async () => {
    const actions = props();
    render(<ReticulumSetupGuide {...actions} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open setup guide' }));
    expect(actions.onStart).not.toHaveBeenCalled();
    expect(window.electronAPI.reticulum.proxyPost).not.toHaveBeenCalled();
    expect(window.electronAPI.reticulum.proxyGet).not.toHaveBeenCalled();
  });

  it('starts through the existing lifecycle action and keeps a failed start retryable', async () => {
    await withMockedConsoleWarn(async () => {
      const actions = props();
      actions.onStart.mockRejectedValueOnce(new Error('sidecar unavailable'));
      render(<ReticulumSetupGuide {...actions} running={false} apiReady={false} identity={null} />);
      await userEvent.click(screen.getByRole('button', { name: 'Open setup guide' }));
      const start = screen.getByRole('button', { name: 'Let’s get started' });
      await userEvent.click(start);
      expect(screen.getByRole('alert')).toHaveTextContent('That step did not finish');
      expect(screen.getByRole('alert').querySelector('details')).toHaveTextContent(
        'sidecar unavailable',
      );
      expect(start).toBeEnabled();
      await userEvent.click(start);
      expect(actions.onStart).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('heading', { name: 'Your identity' })).toBeInTheDocument();
    });
  });

  it.each([
    ['SETUP_PRIVATE_INTERFACE', 'This hub already has private network settings'],
    ['SETUP_INTERFACES_UNAVAILABLE', 'Could not read your connections'],
    ['SETUP_IDENTITY_UNAVAILABLE', 'Could not read your identity'],
    ['SETUP_INTERFACE_SAVE_FAILED', 'Could not save this connection'],
    ['SETUP_IDENTITY_SAVE_FAILED', 'Could not save your identity settings'],
  ])('explains %s without exposing the internal code', async (code, message) => {
    await withMockedConsoleWarn(async () => {
      const actions = props();
      actions.onStart.mockRejectedValueOnce(new Error(code));
      render(<ReticulumSetupGuide {...actions} running={false} apiReady={false} />);
      await userEvent.click(screen.getByRole('button', { name: 'Open setup guide' }));
      await userEvent.click(screen.getByRole('button', { name: 'Let’s get started' }));
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(message);
      expect(alert).not.toHaveTextContent(code);
    });
  });

  it('preserves an existing identity and focuses the next step heading', async () => {
    render(<ReticulumSetupGuide {...props()} />);
    await openConnectionStep();
    expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledWith(
      '/api/v1/identity/display-name',
      { display_name: 'Newcomer' },
    );
    expect(screen.getByRole('heading', { name: 'Get connected' })).toHaveFocus();
  });

  it('shows recovery words and requires acknowledgement before continuing', async () => {
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockResolvedValue({ configured: false });
    vi.mocked(window.electronAPI.reticulum.proxyPost).mockResolvedValue({
      ok: true,
      mnemonic: 'example recovery phrase',
    });
    render(<ReticulumSetupGuide {...props()} identity={null} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open setup guide' }));
    await user.click(screen.getByRole('button', { name: 'Let’s get started' }));
    await user.type(screen.getByRole('textbox', { name: 'Name or callsign' }), 'New friend');
    await user.click(screen.getByRole('button', { name: 'Save name and continue' }));
    expect(screen.getByText('example recovery phrase')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(window.electronAPI.clipboard.writeText).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: 'I have saved my recovery words' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByText('example recovery phrase')).not.toBeInTheDocument();
    expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/identity/generate',
      { display_name: 'New friend', replace: false },
    );
  });

  it('waits for live networking and messaging instead of just a running process', async () => {
    live = false;
    render(<ReticulumSetupGuide {...props()} />);
    await openConnectionStep();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
    });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    live = true;
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    });
  });

  it('checks the selected hub, rather than claiming a local-only connection reaches it', async () => {
    interfaces = [{ id: 'auto', name: 'Local network', type: 'auto', enabled: true, status: 'up' }];
    render(<ReticulumSetupGuide {...props()} />);
    const user = await openConnectionStep();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Existing mesh-client setup' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    });
    await user.click(screen.getByRole('radio', { name: 'RNode radio' }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('connects the chosen hub on demand and keeps restart failure retryable', async () => {
    await withMockedConsoleWarn(async () => {
      interfaces = [];
      const actions = props();
      actions.onRestart.mockRejectedValueOnce(new Error('restart unavailable'));
      render(<ReticulumSetupGuide {...actions} />);
      const user = await openConnectionStep();
      await user.click(screen.getByRole('button', { name: 'Connect to this hub' }));
      expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledWith(
        '/api/v1/interfaces',
        expect.objectContaining({ host: hub.host, enabled: true }),
      );
      expect(screen.getByRole('alert')).toHaveTextContent('restart unavailable');
      interfaces = [onlineHub];
      await user.click(screen.getByRole('button', { name: 'Connect to this hub' }));
      expect(actions.onRestart).toHaveBeenCalledTimes(2);
      expect(
        vi
          .mocked(window.electronAPI.reticulum.proxyPost)
          .mock.calls.filter(([path]) => path === '/api/v1/interfaces'),
      ).toHaveLength(1);
    });
  });

  it('opens the existing radio controls without inventing RF settings', async () => {
    const actions = props();
    render(<ReticulumSetupGuide {...actions} />);
    const user = await openConnectionStep();
    await user.click(screen.getByRole('radio', { name: 'RNode radio' }));
    await user.click(screen.getByRole('button', { name: 'Open connection settings below' }));
    expect(actions.onShowInterfaces).toHaveBeenCalledOnce();
    expect(window.electronAPI.reticulum.proxyPut).not.toHaveBeenCalled();
  });

  it('discards readiness when the service stops', async () => {
    const actions = props();
    const view = render(<ReticulumSetupGuide {...actions} />);
    await openConnectionStep();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    });
    view.rerender(<ReticulumSetupGuide {...actions} running={false} apiReady={false} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    live = false;
    view.rerender(<ReticulumSetupGuide {...actions} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
    });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('copies the public messaging address and opens the real Peers tab', async () => {
    const actions = props();
    render(<ReticulumSetupGuide {...actions} />);
    const user = await openConnectionStep();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Copy my messaging address' }));
    expect(window.electronAPI.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(address);
    await user.click(screen.getByRole('button', { name: 'Open Peers' }));
    expect(actions.onNavigate).toHaveBeenCalledWith('Nodes');
    expect(screen.getByRole('button', { name: 'Open setup guide' })).toBeInTheDocument();
  });

  it('keeps the guide open with help when a destination tab is hidden', async () => {
    const actions = props();
    actions.onNavigate.mockReturnValue(false);
    render(<ReticulumSetupGuide {...actions} />);
    const user = await openConnectionStep();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Open group chat' }));
    expect(screen.getByRole('alert')).toHaveTextContent('This tab is hidden');
    expect(screen.getByRole('heading', { name: 'Try it out' })).toBeInTheDocument();
  });

  it('does not poll or apply a late status response after the guide closes', async () => {
    let settle: (value: unknown) => void = () => {};
    const actions = props();
    render(<ReticulumSetupGuide {...actions} />);
    const user = await openConnectionStep();
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockImplementation((path) =>
      path === '/api/v1/status'
        ? new Promise((resolve) => {
            settle = resolve;
          })
        : Promise.resolve({ interfaces: [onlineHub] }),
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await user.click(screen.getByRole('button', { name: 'Hide guide' }));
    await act(async () => {
      settle({ rns_ready: true, lxmf_ready: true });
      await Promise.resolve();
    });
    expect(screen.queryByText('Your connection is available')).not.toBeInTheDocument();
    act(() => {
      useReticulumSetupGuideStore.getState().setOpen(true);
    });
    expect(screen.queryByText('Your connection is available')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await act(async () => {
      settle({ rns_ready: true, lxmf_ready: true });
      await Promise.resolve();
    });
    expect(await screen.findByText('Your connection is available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('has accessible controls and contrast on the connection step', async () => {
    const { container } = render(<ReticulumSetupGuide {...props()} />);
    await openConnectionStep();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    });
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
    expect(
      within(screen.getByRole('group', { name: 'How to connect' })).getAllByRole('radio'),
    ).toHaveLength(3);
  });
});

describe('system Reticulum detection', () => {
  const runningRnsd = {
    configPath: '/home/u/.reticulum/config',
    shareInstance: true,
    sharedInstanceType: 'tcp' as const,
    endpoint: '127.0.0.1:37428',
    running: true,
    serialPorts: ['/dev/ttyACM0'],
  };

  it('explains why another running Reticulum app is not used and lists its serial ports', async () => {
    vi.mocked(window.electronAPI.reticulum.detectSystemInstance).mockResolvedValue(runningRnsd);
    const { container } = render(<ReticulumSetupGuide {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open setup guide' }));
    const notice = await screen.findByRole('note', {
      name: 'Another Reticulum app is running on this computer',
    });
    expect(within(notice).getByText(/127\.0\.0\.1:37428/)).toBeInTheDocument();
    expect(within(notice).getByText(/Ratspeak features/)).toBeInTheDocument();
    expect(within(notice).getByText(/\/dev\/ttyACM0/)).toBeInTheDocument();
    expect(
      within(notice).getByRole('link', { name: /using mesh-client with other Reticulum apps/i }),
    ).toHaveAttribute(
      'href',
      expect.stringContaining('#using-mesh-client-with-other-reticulum-apps'),
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('does not flag mesh-client’s own shared TCP listener', async () => {
    vi.mocked(window.electronAPI.reticulum.detectSystemInstance).mockResolvedValue(runningRnsd);
    render(<ReticulumSetupGuide {...props()} selfHostsSharedInstance />);
    await userEvent.click(screen.getByRole('button', { name: 'Open setup guide' }));
    await waitFor(() => {
      expect(window.electronAPI.reticulum.detectSystemInstance).toHaveBeenCalled();
    });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('shows nothing when no other instance is running', async () => {
    vi.mocked(window.electronAPI.reticulum.detectSystemInstance).mockResolvedValue({
      ...runningRnsd,
      running: false,
    });
    render(<ReticulumSetupGuide {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open setup guide' }));
    await waitFor(() => {
      expect(window.electronAPI.reticulum.detectSystemInstance).toHaveBeenCalled();
    });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});

describe('isForeignSystemReticulum', () => {
  const probe = {
    configPath: null,
    shareInstance: true,
    sharedInstanceType: 'unix' as const,
    endpoint: 'rns/default',
    running: true,
    serialPorts: [],
  };

  it('treats a non-running probe as absent', () => {
    expect(isForeignSystemReticulum({ ...probe, running: false }, false)).toBe(false);
    expect(isForeignSystemReticulum(null, false)).toBe(false);
  });

  it('keeps a unix-socket instance foreign even when mesh-client hosts its own', () => {
    expect(isForeignSystemReticulum(probe, true)).toBe(true);
  });

  it('ignores a TCP hit only when mesh-client hosts the shared instance', () => {
    const tcp = { ...probe, sharedInstanceType: 'tcp' as const, endpoint: '127.0.0.1:37428' };
    expect(isForeignSystemReticulum(tcp, true)).toBe(false);
    expect(isForeignSystemReticulum(tcp, false)).toBe(true);
  });
});
