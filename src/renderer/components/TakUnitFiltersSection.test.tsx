import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { TakStyleSettings } from '@/shared/tak-types';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import TakUnitFiltersSection from './TakUnitFiltersSection';

const tak = () => window.electronAPI.tak;

const SAVED: TakStyleSettings = {
  sendUnmatched: true,
  filters: [
    {
      enabled: true,
      op: 'startsWith',
      patterns: ['EMS-', 'Medic'],
      stripMatch: true,
      style: { cotType: 'a-f-G-U-S-M', group: 'White', role: 'Medic', color: '#FF8800' },
    },
  ],
};

async function renderSection() {
  const result = render(<TakUnitFiltersSection />);
  await act(async () => {});
  return result;
}

describe('TakUnitFiltersSection', () => {
  beforeEach(() => {
    vi.mocked(tak().getStyleSettings).mockReset().mockResolvedValue(SAVED);
    vi.mocked(tak().setStyleSettings)
      .mockReset()
      .mockImplementation((s) => Promise.resolve(s));
  });

  it('fills rows from saved settings', async () => {
    await renderSection();
    expect(screen.getByLabelText('Name patterns for filter 1')).toHaveValue('EMS-, Medic');
    expect(screen.getByLabelText('Unit type for filter 1')).toHaveValue('a-f-G-U-S-M');
    expect(screen.getByLabelText('Team color for filter 1')).toHaveValue('White');
    expect(screen.getByLabelText('Marker color for filter 1')).toHaveValue('#ff8800');
    expect(screen.getByLabelText('Relay nodes that no filter matches')).toBeChecked();
  });

  it('adds a filter and saves the parsed settings', async () => {
    const user = userEvent.setup();
    await renderSection();
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.type(screen.getByLabelText('Name patterns for filter 2'), 'K9 , ,rex');
    await user.selectOptions(screen.getByLabelText('Team role for filter 2'), 'K9');
    await user.click(screen.getByLabelText('Relay nodes that no filter matches'));
    await user.click(screen.getByRole('button', { name: 'Save styles' }));

    expect(tak().setStyleSettings).toHaveBeenCalledWith({
      sendUnmatched: false,
      filters: [
        SAVED.filters[0],
        {
          enabled: true,
          op: 'startsWith',
          patterns: ['K9', 'rex'],
          stripMatch: false,
          style: { cotType: 'a-f-G-U-C', group: 'Cyan', role: 'K9' },
        },
      ],
    });
    expect(await screen.findByText('Saved and applied')).toBeInTheDocument();
  });

  it('removes a filter', async () => {
    const user = userEvent.setup();
    await renderSection();
    await user.click(screen.getByRole('button', { name: 'Remove filter 1' }));
    await user.click(screen.getByRole('button', { name: 'Save styles' }));
    expect(tak().setStyleSettings).toHaveBeenCalledWith({ sendUnmatched: true, filters: [] });
  });

  it('shows the save error from main', async () => {
    vi.mocked(tak().setStyleSettings).mockRejectedValueOnce(
      new Error("Error invoking remote method 'tak:setStyleSettings': Error: bad role"),
    );
    const user = userEvent.setup();
    await renderSection();
    await user.click(screen.getByRole('button', { name: 'Save styles' }));
    expect(await screen.findByText('bad role')).toBeInTheDocument();
  });

  it('previews which filter applies to a typed name', async () => {
    const user = userEvent.setup();
    await renderSection();
    await user.type(screen.getByLabelText('Test a node name'), 'EMS-Unit 3');
    expect(screen.getByText('Filter 1 applies; shown as "Unit 3"')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Test a node name'));
    await user.type(screen.getByLabelText('Test a node name'), 'Ridge');
    expect(
      screen.getByText('No filter matches; drawn from its advertised role'),
    ).toBeInTheDocument();
  });

  it('caps the list at eight filters', async () => {
    vi.mocked(tak().getStyleSettings).mockResolvedValue({
      sendUnmatched: true,
      filters: Array.from({ length: 8 }, () => SAVED.filters[0]),
    });
    await renderSection();
    expect(screen.getByRole('button', { name: 'Add filter' })).toBeDisabled();
  });

  it('has no axe violations', async () => {
    const { container } = await renderSection();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
