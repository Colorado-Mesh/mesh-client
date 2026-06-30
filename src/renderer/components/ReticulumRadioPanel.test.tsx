import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

import { ReticulumRadioPanel } from './ReticulumRadioPanel';

describe('ReticulumRadioPanel', () => {
  it('does not render flasher or factory reset sections', () => {
    render(<ReticulumRadioPanel connecting={false} onStartStack={async () => {}} />);

    expect(screen.queryByText('flasher.title')).not.toBeInTheDocument();
    expect(screen.queryByText('radioPanel.reticulumFactoryReset.title')).not.toBeInTheDocument();
  });
});
