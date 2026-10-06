import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../../lib/a11yTestHelpers';
import { useWeatherFilterStore } from '../../stores/weatherFilterStore';
import { WeatherFilterSettings } from './WeatherFilterSettings';

describe('WeatherFilterSettings', () => {
  afterEach(() => {
    useWeatherFilterStore.getState().setOnlinePlaceLookup(false);
  });

  it('toggles online place lookup, off by default', () => {
    render(<WeatherFilterSettings />);
    const box = screen.getByRole('checkbox', { name: 'Look up forecast places online' });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(useWeatherFilterStore.getState().onlinePlaceLookup).toBe(true);
    expect(box).toBeChecked();
  });

  it('has no axe violations', async () => {
    const { container } = render(<WeatherFilterSettings />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
