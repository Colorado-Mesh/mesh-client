import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { PickerSortControls } from './PickerSortControls';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('PickerSortControls', () => {
  beforeEach(() => {
    hydrateAxeThemeColors(document.documentElement);
  });

  it('renders Name and RSSI in BLE mode', () => {
    render(<PickerSortControls mode="ble" sortKey="rssi" sortDir="desc" onSortClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'connectionPanel.sortByRssiDesc' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'connectionPanel.sortByNameAsc' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('renders Name only in serial mode', () => {
    render(<PickerSortControls mode="serial" sortKey="name" sortDir="asc" onSortClick={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'connectionPanel.sortByNameAsc' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /connectionPanel\.sortByRssi/ }),
    ).not.toBeInTheDocument();
  });

  it('clicking an inactive key selects it; clicking active flips dir', async () => {
    const user = userEvent.setup();
    const onSortClick = vi.fn();
    const { rerender } = render(
      <PickerSortControls mode="ble" sortKey="rssi" sortDir="desc" onSortClick={onSortClick} />,
    );
    await user.click(screen.getByRole('button', { name: 'connectionPanel.sortByNameAsc' }));
    expect(onSortClick).toHaveBeenCalledWith('name');

    rerender(
      <PickerSortControls mode="ble" sortKey="name" sortDir="asc" onSortClick={onSortClick} />,
    );
    await user.click(screen.getByRole('button', { name: 'connectionPanel.sortByNameAsc' }));
    expect(onSortClick).toHaveBeenLastCalledWith('name');
  });

  it('has no axe violations on the control row', async () => {
    const { container } = render(
      <PickerSortControls mode="ble" sortKey="rssi" sortDir="desc" onSortClick={vi.fn()} />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
