import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { MESHCORE_CAPABILITIES } from '../lib/radio/BaseRadioProvider';
import TelemetryPanel from './TelemetryPanel';

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
});
