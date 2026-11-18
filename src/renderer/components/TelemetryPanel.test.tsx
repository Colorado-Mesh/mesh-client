import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  it('shows environment empty hint when battery data exists but no env history', async () => {
    const { container } = render(
      <TelemetryPanel
        telemetry={[{ timestamp: Date.now(), batteryLevel: 80, voltage: 3.9 }]}
        signalTelemetry={[]}
        environmentTelemetry={[]}
        useFahrenheit={false}
        onToggleFahrenheit={() => {}}
        onRefresh={async () => {}}
        isConnected
        capabilities={MESHCORE_CAPABILITIES}
      />,
    );
    expect(screen.getByTestId('env-telemetry-empty-hint')).toBeInTheDocument();
    expect(screen.getByText(/No environment sensor data heard yet/i)).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('shows environment section when store has MeshCore-style env data', async () => {
    const { useEnvironmentTelemetryStore } = await import('../stores/environmentTelemetryStore');
    const { useIdentityStore, addIdentity, setActiveIdentity } =
      await import('../stores/identityStore');
    const { meshcoreProtocol } = await import('../lib/protocols/MeshCoreProtocol');
    const { MESHCORE_CAPABILITIES: caps } = await import('../lib/radio/BaseRadioProvider');
    useEnvironmentTelemetryStore.setState({ history: new Map() });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    addIdentity({
      id: 'id-mc',
      protocol: meshcoreProtocol,
      signature: 'test',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setActiveIdentity('id-mc');
    useEnvironmentTelemetryStore
      .getState()
      .recordReading(
        'meshcore',
        'id-mc',
        0x1234abcd,
        { temperature: 21.25, relativeHumidity: 55 },
        'rpc',
      );
    const { container } = render(
      <TelemetryPanel
        telemetry={[]}
        signalTelemetry={[]}
        environmentTelemetry={[]}
        useFahrenheit={false}
        onToggleFahrenheit={() => {}}
        onRefresh={async () => {}}
        isConnected
        capabilities={caps}
      />,
    );
    expect(screen.queryByTestId('env-telemetry-empty-hint')).not.toBeInTheDocument();
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

  it('bounds the legend in All nodes mode so the plot keeps its space', async () => {
    const { useEnvironmentTelemetryStore } = await import('../stores/environmentTelemetryStore');
    const { useIdentityStore, addIdentity, setActiveIdentity } =
      await import('../stores/identityStore');
    const { meshcoreProtocol } = await import('../lib/protocols/MeshCoreProtocol');
    const { MESHCORE_CAPABILITIES: caps } = await import('../lib/radio/BaseRadioProvider');
    useEnvironmentTelemetryStore.setState({ history: new Map() });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    addIdentity({
      id: 'id-mc-all',
      protocol: meshcoreProtocol,
      signature: 'test-all',
      transports: [],
      createdAt: 1,
      lastSeenAt: 1,
    });
    setActiveIdentity('id-mc-all');
    const store = useEnvironmentTelemetryStore.getState();
    for (let i = 0; i < 6; i++) {
      const nodeId = 0x1000 + i;
      store.recordReading(
        'meshcore',
        'id-mc-all',
        nodeId,
        { temperature: 20 + i, relativeHumidity: 40 + i },
        'rpc',
      );
      store.recordReading(
        'meshcore',
        'id-mc-all',
        nodeId,
        { temperature: 21 + i, relativeHumidity: 41 + i },
        'rpc',
      );
    }
    const { container } = render(
      <TelemetryPanel
        telemetry={[]}
        signalTelemetry={[]}
        environmentTelemetry={[]}
        useFahrenheit={false}
        onToggleFahrenheit={() => {}}
        onRefresh={async () => {}}
        isConnected
        capabilities={caps}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: /Sensor node/i }), {
      target: { value: 'all' },
    });
    const wrappers = container.querySelectorAll('.recharts-legend-wrapper');
    expect(wrappers.length).toBeGreaterThan(0);
    for (const w of wrappers) {
      expect(w).toHaveStyle({ maxHeight: '64px', overflowY: 'auto' });
    }
    expect(container.querySelector('.recharts-cartesian-grid')).not.toBeNull();
  });

  it('shows MeshCore flood send percent with raw flood/direct counts', () => {
    render(
      <TelemetryPanel
        telemetry={[]}
        signalTelemetry={[]}
        environmentTelemetry={[]}
        useFahrenheit={false}
        onToggleFahrenheit={() => {}}
        onRefresh={async () => {}}
        isConnected
        capabilities={MESHCORE_CAPABILITIES}
        meshcorePacketStats={{
          sent: 100,
          recv: 50,
          nSentFlood: 95,
          nSentDirect: 5,
          nRecvFlood: 40,
          nRecvDirect: 10,
        }}
      />,
    );
    expect(screen.getByText('95')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('95%')).toBeInTheDocument();
    expect(screen.getByLabelText(/About flood send percentage/i)).toBeInTheDocument();
  });
});
