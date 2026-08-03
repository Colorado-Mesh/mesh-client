import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ReticulumDefaultHubsPickerModal } from './ReticulumDefaultHubsPickerModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ReticulumDefaultHubsPickerModal', () => {
  it('does not re-focus the first control when onCancel identity changes', () => {
    const { rerender } = render(
      <ReticulumDefaultHubsPickerModal
        interfaces={[]}
        confirming={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const firstFocusable = document.activeElement;
    expect(firstFocusable).toBeInstanceOf(HTMLElement);

    const europe = screen.getByRole('checkbox', {
      name: 'connectionPanel.reticulumInterfaces.defaultHubRegion.europe',
    });
    europe.focus();
    expect(document.activeElement).toBe(europe);

    rerender(
      <ReticulumDefaultHubsPickerModal
        interfaces={[]}
        confirming={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(europe);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <ReticulumDefaultHubsPickerModal
        interfaces={[]}
        confirming={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('defaults Primary & Global checked and Specialty unchecked', () => {
    render(
      <ReticulumDefaultHubsPickerModal
        interfaces={[]}
        confirming={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('checkbox', {
        name: 'connectionPanel.reticulumInterfaces.defaultHubRegion.primary_global',
      }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', {
        name: 'connectionPanel.reticulumInterfaces.defaultHubRegion.north_america',
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', {
        name: 'connectionPanel.reticulumInterfaces.defaultHubRegion.specialty',
      }),
    ).not.toBeChecked();
    expect(screen.getByText('RNS_Transport_US-East')).toBeInTheDocument();
    expect(screen.getByText('noDNS1')).toBeInTheDocument();
  });

  it('shows already-configured hubs as checked and disabled', () => {
    render(
      <ReticulumDefaultHubsPickerModal
        interfaces={[
          {
            id: 'rmap',
            name: 'RMAP World',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: 'rmap.world',
            port: 4242,
            mode: 'boundary',
          },
        ]}
        confirming={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const rmapLabel = screen.getByText('RMAP World').closest('label');
    expect(rmapLabel).toBeTruthy();
    const rmap = rmapLabel!.querySelector('input[type="checkbox"]');
    expect(rmap).toBeChecked();
    expect(rmap).toBeDisabled();
    expect(
      screen.getByText(/connectionPanel.reticulumInterfaces.defaultHubAlreadyAdded/),
    ).toBeInTheDocument();
  });
});
