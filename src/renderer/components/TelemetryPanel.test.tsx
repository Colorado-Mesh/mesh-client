import { render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as Recharts from 'recharts';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { MESHCORE_CAPABILITIES } from '../lib/radio/BaseRadioProvider';
import TelemetryPanel from './TelemetryPanel';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof Recharts>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <actual.ResponsiveContainer width={800} height={250}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});

describe('TelemetryPanel', () => {
  it('shows environment section when MeshCore-style env data is present', async () => {
    const { container } = render(
      <TelemetryPanel
        telemetry={[]}
        signalTelemetry={[]}
        environmentTelemetry={[
          {
            timestamp: Date.now(),
            nodeNum: 0x1234abcd,
            temperature: 21.25,
            relativeHumidity: 55,
          },
        ]}
        useFahrenheit={false}
        onToggleFahrenheit={() => {}}
        onRefresh={async () => {}}
        isConnected
        capabilities={MESHCORE_CAPABILITIES}
      />,
    );
    expect(screen.getByRole('heading', { name: /Temperature & Humidity/i })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Temperature and humidity chart/i }),
    ).toHaveAccessibleName(/21\.3/);
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('exposes battery chart aria-label with latest values', () => {
    render(
      <TelemetryPanel
        telemetry={[
          { timestamp: Date.now() - 1000, batteryLevel: 80, voltage: 3.9 },
          { timestamp: Date.now(), batteryLevel: 78, voltage: 3.85 },
        ]}
        signalTelemetry={[]}
        environmentTelemetry={[]}
        useFahrenheit={false}
        onToggleFahrenheit={() => {}}
        onRefresh={async () => {}}
        isConnected
      />,
    );
    expect(screen.getByRole('img', { name: /Battery and voltage chart/i })).toHaveAccessibleName(
      /78 percent.*3\.85 V/,
    );
  });
  it('matches signal axes, unit labels, legend and curves to their series', async () => {
    render(
      <TelemetryPanel
        telemetry={[]}
        signalTelemetry={[
          { timestamp: Date.now() - 1000, snr: 4, rssi: -90 },
          { timestamp: Date.now(), snr: 5, rssi: -88 },
        ]}
        environmentTelemetry={[]}
        useFahrenheit={false}
        onToggleFahrenheit={() => {}}
        onRefresh={async () => {}}
        isConnected
      />,
    );
    const chart = screen.getByRole('img', { name: /Signal quality chart/i });
    expect(chart).toHaveAccessibleName(/5 dB.*-88 dBm/);
    for (const [index, unit, series, color] of [
      [0, 'dB', 'SNR', 'var(--color-orange-400)'],
      [1, 'dBm', 'RSSI', 'var(--color-blue-400)'],
    ] as const) {
      const axis = chart.querySelectorAll('.recharts-yAxis')[index];
      expect(axis?.querySelector('.recharts-cartesian-axis-line')).toHaveAttribute('stroke', color);
      expect(within(chart).getByText(unit)).toHaveStyle({ fill: color });
      expect(within(chart).getByText(series)).toHaveStyle({ color });
      await waitFor(() => {
        expect(chart.querySelectorAll('.recharts-line-curve')[index]).toHaveAttribute(
          'stroke',
          color,
        );
      });
    }
  });
});
