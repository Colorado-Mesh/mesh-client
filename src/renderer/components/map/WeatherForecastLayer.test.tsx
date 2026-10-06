// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { SENSOR_COLOR_NEUTRAL, sensorColorForValue } from '@/renderer/lib/environmentSensorDisplay';
import { formatDisplayDateTime } from '@/renderer/lib/formatDisplayTime';
import {
  FORECAST_AREA_DEFAULT_RADIUS_M,
  FORECAST_AREA_MAX_RADIUS_M,
  FORECAST_AREA_MIN_RADIUS_M,
  forecastAreaColor,
  forecastAreaRadiusMeters,
  forecastDisplayTemp,
} from '@/renderer/lib/weatherForecastArea';
import {
  useWeatherForecastStore,
  type WeatherForecastEntry,
} from '@/renderer/stores/weatherForecastStore';

import { WeatherForecastLayer } from './WeatherForecastLayer';

interface PathOptions {
  color: string;
  dashArray?: string;
}

vi.mock('react-leaflet', () => ({
  Circle: ({
    children,
    center,
    radius,
    pathOptions,
    eventHandlers,
  }: {
    children?: ReactNode;
    center: [number, number];
    radius: number;
    pathOptions: PathOptions;
    eventHandlers?: { click?: () => void };
  }) => (
    <div
      data-testid="forecast-area"
      data-center={center.join(',')}
      data-radius={radius}
      data-color={pathOptions.color}
      data-dashed={pathOptions.dashArray ? 'yes' : 'no'}
    >
      {eventHandlers?.click ? (
        <button type="button" aria-label="open sender" onClick={eventHandlers.click} />
      ) : null}
      {children}
    </div>
  ),
  Marker: ({ title, icon }: { title: string; icon: { options: { html: string } } }) => (
    <div data-testid="forecast-label" data-title={title} data-html={icon.options.html} />
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

function entry(key: string, extra: Partial<WeatherForecastEntry> = {}): WeatherForecastEntry {
  return {
    key,
    placeLabel: 'Aurora, CO 80013',
    resolvedLabel: 'Aurora, Colorado, US',
    lat: 39.73,
    lon: -104.83,
    population: 359407,
    positionSource: 'gazetteer',
    profileId: 'nwsPipe',
    period: 'Tonight',
    tempValue: 59,
    tempUnit: 'F',
    summary: 'Tonight: 59°F Mostly Clear',
    segments: ['Tonight: 59°F Mostly Clear | S 6 to 9 mph | precip 2%'],
    issuedAt: '10/05 12:46 MDT',
    hasAlerts: false,
    receivedAt: Date.now() - 1000,
    protocol: 'meshcore',
    senderId: 42,
    senderName: 'WX Bot',
    messageId: 'm1',
    ...extra,
  };
}

describe('weatherForecastArea', () => {
  it('scales the radius with population and clamps it', () => {
    expect(forecastAreaRadiusMeters(undefined)).toBe(FORECAST_AREA_DEFAULT_RADIUS_M);
    expect(forecastAreaRadiusMeters(0)).toBe(FORECAST_AREA_DEFAULT_RADIUS_M);
    expect(forecastAreaRadiusMeters(100)).toBe(FORECAST_AREA_MIN_RADIUS_M);
    expect(forecastAreaRadiusMeters(100_000)).toBeCloseTo(12_000);
    expect(forecastAreaRadiusMeters(10_000_000)).toBe(FORECAST_AREA_MAX_RADIUS_M);
  });

  it('colors by temperature on the sensor ramp, falling back to the high', () => {
    expect(forecastAreaColor({ tempValue: 88, tempUnit: 'F' })).toBe(
      sensorColorForValue('temperature', 31.1),
    );
    expect(forecastAreaColor({ tempValue: -5, tempUnit: 'C' })).toBe(
      sensorColorForValue('temperature', -5),
    );
    expect(forecastAreaColor({ highLow: { high: 75, low: 52 } })).toBe(
      sensorColorForValue('temperature', 23.9),
    );
    expect(forecastAreaColor({})).toBe(SENSOR_COLOR_NEUTRAL);
    expect(forecastDisplayTemp({ highLow: { high: 75, low: 52 } })).toEqual({
      value: 75,
      unit: 'F',
    });
  });
});

describe('WeatherForecastLayer', () => {
  beforeEach(() => {
    useWeatherForecastStore.getState().clearForecasts();
  });

  it('draws a population-sized area with a temperature label and tooltip', () => {
    useWeatherForecastStore.getState().upsertForecast(entry('place:aurora|co'));
    render(<WeatherForecastLayer />);
    const area = screen.getByTestId('forecast-area');
    expect(area.dataset.center).toBe('39.73,-104.83');
    expect(Number(area.dataset.radius)).toBe(forecastAreaRadiusMeters(359407));
    expect(area.dataset.dashed).toBe('no');
    expect(screen.getByText('Aurora, CO 80013')).toBeTruthy();
    expect(screen.getByText('Aurora, Colorado, US')).toBeTruthy();
    expect(
      screen.getByText(
        'weatherForecast.via:{"sender":"WX Bot","protocol":"weatherForecast.protocol.meshcore"}',
      ),
    ).toBeTruthy();
    const label = screen.getByTestId('forecast-label');
    expect(label.dataset.title).toContain('weatherForecast.areaAria');
    expect(label.dataset.html).not.toContain('<script');
  });

  it('dashes approximate areas and uses the default radius', () => {
    useWeatherForecastStore
      .getState()
      .upsertForecast(entry('place:x', { positionSource: 'senderApprox', population: undefined }));
    render(<WeatherForecastLayer />);
    const area = screen.getByTestId('forecast-area');
    expect(area.dataset.dashed).toBe('yes');
    expect(Number(area.dataset.radius)).toBe(FORECAST_AREA_DEFAULT_RADIUS_M);
    expect(screen.getByText('weatherForecast.positionApprox')).toBeTruthy();
  });

  it('shows the issued time when the Issued line is complete', () => {
    useWeatherForecastStore.getState().upsertForecast(entry('place:aurora|co'));
    render(<WeatherForecastLayer />);
    expect(screen.getByText('weatherForecast.issued:{"when":"10/05 12:46 MDT"}')).toBeTruthy();
  });

  it('shows the received time instead of a cut-off issued date', () => {
    const receivedAt = Date.now() - 60_000;
    useWeatherForecastStore
      .getState()
      .upsertForecast(
        entry('place:brighton|co', { issuedAt: '10/05', issuedTruncated: true, receivedAt }),
      );
    render(<WeatherForecastLayer />);
    expect(
      screen.getByText(
        `weatherForecast.received:${JSON.stringify({ when: formatDisplayDateTime(receivedAt) })}`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/weatherForecast\.issued/)).toBeNull();
  });

  it('labels requester-located forecasts by the node that asked', () => {
    useWeatherForecastStore.getState().upsertForecast(
      entry('req:x', {
        placeLabel: undefined,
        resolvedLabel: undefined,
        positionSource: 'requester',
        requesterName: 'Asker',
      }),
    );
    render(<WeatherForecastLayer />);
    expect(screen.getByText('weatherForecast.nearRequester:{"name":"Asker"}')).toBeTruthy();
  });

  it('keeps place names out of the label HTML', () => {
    useWeatherForecastStore
      .getState()
      .upsertForecast(entry('place:evil', { placeLabel: '<img src=x onerror=alert(1)>' }));
    render(<WeatherForecastLayer />);
    expect(screen.getByTestId('forecast-label').dataset.html).not.toContain('<img');
  });

  it('opens the sender when clicked', () => {
    const onSenderClick = vi.fn();
    useWeatherForecastStore.getState().upsertForecast(entry('place:aurora|co'));
    render(<WeatherForecastLayer onSenderClick={onSenderClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'open sender' }));
    expect(onSenderClick).toHaveBeenCalledWith('meshcore', 42);
  });

  it('has no axe violations', async () => {
    useWeatherForecastStore.getState().upsertForecast(entry('place:aurora|co'));
    const { container } = render(<WeatherForecastLayer />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
