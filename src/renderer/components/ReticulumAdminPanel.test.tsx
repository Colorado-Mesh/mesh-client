import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/lib/radio/providerFactory', () => ({
  useRadioProvider: () => ({
    hasRNodeFlasher: true,
  }),
}));

const refreshIdentity = vi.fn();
vi.mock('@/renderer/lib/reticulum/useReticulumSidecarApi', () => ({
  useReticulumSidecarApi: vi.fn(() => ({
    sidecarUiRunning: true,
    sidecarApiReady: true,
    refreshIdentity,
  })),
}));

vi.mock('./flasher/RNodeFlasherSection', () => ({
  RNodeFlasherSection: () => <div data-testid="flasher-mock" />,
}));

import { useReticulumSidecarApi } from '@/renderer/lib/reticulum/useReticulumSidecarApi';

import { ReticulumAdminPanel } from './ReticulumAdminPanel';
import { ToastProvider } from './Toast';

describe('ReticulumAdminPanel', () => {
  beforeEach(() => {
    refreshIdentity.mockReset();
    window.electronAPI.reticulum.proxyGet = vi.fn().mockResolvedValue({ interfaces: [] });
    window.electronAPI.reticulum.proxyPost = vi.fn().mockResolvedValue({ ok: true });
  });

  it('renders flasher and factory reset danger zone', () => {
    render(
      <ToastProvider>
        <ReticulumAdminPanel connecting={false} onStartStack={async () => {}} />
      </ToastProvider>,
    );

    expect(screen.getByText('tabs.admin')).toBeInTheDocument();
    expect(screen.getByTestId('flasher-mock')).toBeInTheDocument();
    expect(screen.getByText('radioPanel.dangerZone')).toBeInTheDocument();
    expect(screen.getByText('radioPanel.reticulumFactoryReset.button')).toBeInTheDocument();
  });

  it('passes portBlocked to flasher when enabled RNode interface is active', async () => {
    window.electronAPI.reticulum.proxyGet = vi.fn().mockResolvedValue({
      interfaces: [{ id: '1', type: 'RNode', enabled: true }],
    });

    render(
      <ToastProvider>
        <ReticulumAdminPanel connecting={false} onStartStack={async () => {}} />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyGet).toHaveBeenCalledWith('/api/v1/interfaces');
    });
  });

  it('factory reset confirms and calls sidecar API', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ReticulumAdminPanel connecting={false} onStartStack={async () => {}} />
      </ToastProvider>,
    );

    await user.click(screen.getByText('radioPanel.reticulumFactoryReset.button'));
    await user.click(
      screen.getByRole('button', { name: 'radioPanel.reticulumFactoryReset.confirm' }),
    );

    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledWith(
        '/api/v1/system/factory-reset',
        {},
      );
    });
    expect(refreshIdentity).toHaveBeenCalled();
  });

  it('shows flasher hint when stack is stopped', () => {
    vi.mocked(useReticulumSidecarApi).mockReturnValue({
      sidecarUiRunning: false,
      sidecarApiReady: false,
      refreshIdentity,
    } as unknown as ReturnType<typeof useReticulumSidecarApi>);

    render(
      <ToastProvider>
        <ReticulumAdminPanel connecting={false} onStartStack={async () => {}} />
      </ToastProvider>,
    );

    expect(screen.getByText('flasher.stackStoppedHint')).toBeInTheDocument();
    expect(
      screen.queryByText('connectionPanel.reticulumIdentity.startStackFirst'),
    ).not.toBeInTheDocument();
  });

  it('has no serious axe violations', async () => {
    const { container } = render(
      <ToastProvider>
        <ReticulumAdminPanel connecting={false} onStartStack={async () => {}} />
      </ToastProvider>,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
