import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/lib/radio/providerFactory', () => ({
  useRadioProvider: () => ({
    hasRNodeFlasher: true,
  }),
}));

vi.mock('@/renderer/lib/reticulum/useReticulumSidecarApi', () => ({
  useReticulumSidecarApi: () => ({
    sidecarApiReady: true,
    refreshIdentity: vi.fn(),
  }),
}));

vi.mock('./flasher/RNodeFlasherSection', () => ({
  RNodeFlasherSection: () => <div data-testid="flasher-mock" />,
}));

import { ReticulumAdminPanel } from './ReticulumAdminPanel';
import { ToastProvider } from './Toast';

describe('ReticulumAdminPanel', () => {
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
});
