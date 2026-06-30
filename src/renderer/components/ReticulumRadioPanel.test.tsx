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
    sidecarApiReady: false,
    identity: null,
    statsSummary: null,
    appInfo: null,
    refreshIdentity: vi.fn(),
  }),
}));

vi.mock('./flasher/RNodeFlasherSection', () => ({
  RNodeFlasherSection: () => <div data-testid="flasher-mock" />,
}));

import { ReticulumRadioPanel } from './ReticulumRadioPanel';

describe('ReticulumRadioPanel', () => {
  it('renders collapsible flasher section title', () => {
    render(<ReticulumRadioPanel connecting={false} onStartStack={async () => {}} />);

    expect(screen.getByText('flasher.title')).toBeInTheDocument();
    expect(screen.queryByText('nomadNetwork.title')).not.toBeInTheDocument();
  });
});
