import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { MqttNetworkPresetSelect } from './MqttNetworkPresetSelect';

describe('MqttNetworkPresetSelect', () => {
  const options = [
    { value: 'letsmesh', label: 'LetsMesh' },
    { value: 'waev', label: 'Waev' },
    { value: 'custom', label: 'Custom' },
  ];

  it('renders every option and reflects the selected value', () => {
    render(
      <div>
        <p id="preset-label">Network Preset</p>
        <MqttNetworkPresetSelect
          id="preset-select"
          labelledById="preset-label"
          value="waev"
          options={options}
          onSelect={vi.fn()}
        />
      </div>,
    );

    const select = screen.getByRole('combobox', { name: 'Network Preset' });
    expect(select).toHaveValue('waev');
    const labels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toEqual(['LetsMesh', 'Waev', 'Custom']);
  });

  it('fires onSelect with the chosen preset id', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <div>
        <p id="preset-label">Network Preset</p>
        <MqttNetworkPresetSelect
          id="preset-select"
          labelledById="preset-label"
          value="letsmesh"
          options={options}
          onSelect={onSelect}
        />
      </div>,
    );

    const select = screen.getByRole('combobox', { name: 'Network Preset' });
    await user.selectOptions(select, within(select).getByRole('option', { name: 'Custom' }));
    expect(onSelect).toHaveBeenCalledWith('custom');
  });

  it('has no axe violations with a visible label', async () => {
    hydrateAxeThemeColors(document.documentElement);
    const { container } = render(
      <div>
        <p id="preset-label">Network Preset</p>
        <MqttNetworkPresetSelect
          id="preset-select"
          labelledById="preset-label"
          value="letsmesh"
          options={options}
          onSelect={vi.fn()}
        />
      </div>,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
