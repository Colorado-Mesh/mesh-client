// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import {
  SENSOR_COLOR_NEUTRAL,
  SENSOR_LAYER_MAX_AGE_MS,
  sensorColorForValue,
} from '@/renderer/lib/environmentSensorDisplay';
import type { MeshNode } from '@/renderer/lib/types';
import {
  type EnvironmentHistoryPoint,
  useEnvironmentTelemetryStore,
} from '@/renderer/stores/environmentTelemetryStore';

import { EnvironmentSensorLayer, sensorMarkersFor } from './environmentSensorLayer';
import { EnvironmentSparklines, sparklinePoints } from './EnvironmentSparklines';

vi.mock('react-leaflet', () => ({
  CircleMarker: ({
    children,
    center,
    radius,
    eventHandlers,
  }: {
    children?: ReactNode;
    center: [number, number];
    radius: number;
    eventHandlers?: { click?: () => void };
  }) =>
    eventHandlers?.click ? (
      <button type="button" data-testid="sensor-circle" onClick={eventHandlers.click}>
        {children}
      </button>
    ) : (
      <div
        data-testid={radius > 0 ? 'sensor-circle' : 'sensor-label-anchor'}
        data-center={center.join(',')}
      >
        {children}
      </div>
    ),
  Tooltip: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

function node(id: number, lat?: number, lon?: number): MeshNode {
  return {
    node_id: id,
    long_name: `Node ${id}`,
    short_name: `N${id}`,
    latitude: lat,
    longitude: lon,
  } as MeshNode;
}

function seed(nodeId: number, points: EnvironmentHistoryPoint[]) {
  useEnvironmentTelemetryStore.setState({
    history: new Map([['meshtastic', new Map([[nodeId, points]])]]),
  });
}

describe('sensorMarkersFor', () => {
  it('keeps positioned nodes with a fresh reading for the metric', () => {
    const now = 1_000_000_000;
    const series = new Map<number, EnvironmentHistoryPoint[]>([
      [1, [{ t: now - 1000, reading: { temperature: 21.5 }, source: 'rf' }]],
      [2, [{ t: now - 1000, reading: { relativeHumidity: 40 }, source: 'rf' }]],
      [3, [{ t: now - SENSOR_LAYER_MAX_AGE_MS - 1, reading: { temperature: 5 }, source: 'rf' }]],
      [4, [{ t: now - 1000, reading: { temperature: 10 }, source: 'mqtt' }]],
    ]);
    const out = sensorMarkersFor(
      [node(1, 39.7, -105), node(2, 39.8, -105), node(3, 39.9, -105), node(4)],
      series,
      'temperature',
      'meshtastic',
      now,
    );
    expect(out.map((m) => m.nodeId)).toEqual([1]);
    expect(out[0].value).toBe(21.5);
  });
});

describe('sensorColorForValue', () => {
  it('maps value bands to distinct colors', () => {
    expect(sensorColorForValue('temperature', -10)).not.toBe(
      sensorColorForValue('temperature', 35),
    );
    expect(sensorColorForValue('temperature', Number.NaN)).toBe(SENSOR_COLOR_NEUTRAL);
  });
});

describe('EnvironmentSensorLayer', () => {
  beforeEach(() => {
    useEnvironmentTelemetryStore.setState({ history: new Map() });
  });

  it('renders nothing without readings', () => {
    const { container } = render(
      <EnvironmentSensorLayer
        nodes={[node(1, 39.7, -105)]}
        protocol="meshtastic"
        metric="temperature"
        useFahrenheit={false}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('labels the selected metric, honors Fahrenheit, and opens the node on click', async () => {
    seed(1, [{ t: Date.now(), reading: { temperature: 20, relativeHumidity: 55 }, source: 'rf' }]);
    const onNodeClick = vi.fn();
    const { container } = render(
      <EnvironmentSensorLayer
        nodes={[node(1, 39.7, -105)]}
        protocol="meshtastic"
        metric="temperature"
        useFahrenheit
        onNodeClick={onNodeClick}
      />,
    );
    expect(screen.getByTestId('sensor-label-1').textContent).toBe(
      'sensorLayer.valueTempF:{"value":"68.0"}',
    );
    expect(screen.getByText('sensorLayer.valueHumidity:{"value":"55"}')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sensor-circle'));
    expect(onNodeClick).toHaveBeenCalledWith(1);

    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('ignores readings stored under another protocol', () => {
    useEnvironmentTelemetryStore.setState({
      history: new Map([
        [
          'meshcore',
          new Map([[1, [{ t: Date.now(), reading: { temperature: 20 }, source: 'rpc' }]]]),
        ],
      ]),
    });
    const { container } = render(
      <EnvironmentSensorLayer
        nodes={[node(1, 39.7, -105)]}
        protocol="meshtastic"
        metric="temperature"
        useFahrenheit={false}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('EnvironmentSparklines', () => {
  beforeEach(() => {
    useEnvironmentTelemetryStore.setState({ history: new Map() });
  });

  it('builds points only for samples carrying the metric inside the window', () => {
    const pts: EnvironmentHistoryPoint[] = [
      { t: 0, reading: { temperature: 10 }, source: 'rf' },
      { t: 100, reading: { relativeHumidity: 40 }, source: 'rf' },
      { t: 200, reading: { temperature: 20 }, source: 'rf' },
    ];
    expect(sparklinePoints(pts, 'temperature', 0)).toBe('0.0,38.0 200.0,2.0');
    expect(sparklinePoints(pts, 'relativeHumidity', 0)).toBeNull();
    expect(sparklinePoints(pts, 'temperature', 150)).toBeNull();
  });

  it('renders a temperature sparkline for the node', () => {
    const now = Date.now();
    seed(7, [
      { t: now - 2000, reading: { temperature: 10 }, source: 'rf' },
      { t: now - 1000, reading: { temperature: 12 }, source: 'rf' },
    ]);
    render(<EnvironmentSparklines protocol="meshtastic" nodeId={7} />);
    expect(screen.getByTestId('env-sparkline-temperature')).toBeTruthy();
    expect(screen.queryByTestId('env-sparkline-relativeHumidity')).toBeNull();
  });
});
