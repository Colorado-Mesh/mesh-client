// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { useInternetWeatherStore } from '@/renderer/stores/internetWeatherStore';
import { useMapLayerStore } from '@/renderer/stores/mapLayerStore';

import { MapLayerControl } from './MapLayerControl';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('./OfflineMapsSection', () => ({
  OfflineMapsSection: () => null,
}));

describe('MapLayerControl internet weather', () => {
  beforeEach(() => {
    useInternetWeatherStore.getState().clear();
    useInternetWeatherStore.setState({ enabled: false });
    useMapLayerStore.setState({ layersPanelOpen: true });
  });

  it('hides radar/temp/wind toggles when master enable is off', () => {
    render(<MapLayerControl />);
    expect(screen.getByText('internetWeather.heading')).toBeTruthy();
    expect(screen.queryByText('internetWeather.layerRadar')).toBeNull();
  });

  it('shows radar/temp/wind toggles when master enable is on', () => {
    useInternetWeatherStore.setState({ enabled: true });
    render(<MapLayerControl />);
    expect(screen.getByText('internetWeather.layerRadar')).toBeTruthy();
    expect(screen.getByText('internetWeather.layerTemperature')).toBeTruthy();
    expect(screen.getByText('internetWeather.layerWind')).toBeTruthy();
  });

  it('has no axe violations with weather section expanded', async () => {
    useInternetWeatherStore.setState({ enabled: true });
    useMapLayerStore.setState({
      layersPanelOpen: true,
      showRadar: true,
    });
    const { container } = render(<MapLayerControl />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
