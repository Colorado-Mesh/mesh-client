import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ENVIRONMENT_TELEMETRY_DEDUP_WINDOW_MS,
  ENVIRONMENT_TELEMETRY_MAX_PER_NODE,
  type EnvironmentTelemetryRow,
} from '@/shared/environmentTelemetry';

import { mockConsoleWarn } from '../lib/vitestConsoleMock';
import {
  latestEnvironmentReading,
  latestEnvironmentValue,
  selectEnvironmentNodes,
  selectEnvironmentSeries,
  useEnvironmentTelemetryStore,
} from './environmentTelemetryStore';

function row(partial: Partial<EnvironmentTelemetryRow>): EnvironmentTelemetryRow {
  return {
    protocol: 'meshtastic',
    node_id: 1,
    recorded_at: Date.now(),
    source: 'rf',
    temperature: null,
    relative_humidity: null,
    barometric_pressure: null,
    iaq: null,
    gas_resistance: null,
    lux: null,
    wind_speed: null,
    wind_direction: null,
    pm25_standard: null,
    co2: null,
    ...partial,
  };
}

describe('environmentTelemetryStore', () => {
  beforeEach(() => {
    useEnvironmentTelemetryStore.setState({ history: new Map() });
    vi.mocked(window.electronAPI.db.saveEnvironmentTelemetry).mockClear();
    vi.mocked(window.electronAPI.db.saveEnvironmentTelemetry).mockResolvedValue({ changes: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a sanitized reading and persists it', () => {
    const kept = useEnvironmentTelemetryStore
      .getState()
      .recordReading('meshtastic', 42, { temperature: 20, relativeHumidity: Number.NaN }, 'rf');
    expect(kept).toBe(true);
    const series = selectEnvironmentSeries(
      useEnvironmentTelemetryStore.getState(),
      'meshtastic',
      42,
    );
    expect(series).toHaveLength(1);
    expect(series[0].reading).toEqual({ temperature: 20 });
    expect(window.electronAPI.db.saveEnvironmentTelemetry).toHaveBeenCalledWith(
      'meshtastic',
      42,
      expect.any(Number),
      { temperature: 20 },
      'rf',
    );
  });

  it('drops the MQTT copy of an RF reading inside the dedup window', () => {
    vi.useFakeTimers();
    const store = useEnvironmentTelemetryStore.getState();
    expect(store.recordReading('meshtastic', 7, { temperature: 18 }, 'rf')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(store.recordReading('meshtastic', 7, { temperature: 18 }, 'mqtt')).toBe(false);
    vi.advanceTimersByTime(ENVIRONMENT_TELEMETRY_DEDUP_WINDOW_MS);
    expect(store.recordReading('meshtastic', 7, { temperature: 18 }, 'mqtt')).toBe(true);
    expect(window.electronAPI.db.saveEnvironmentTelemetry).toHaveBeenCalledTimes(2);
  });

  it('keeps a changed reading inside the dedup window', () => {
    const store = useEnvironmentTelemetryStore.getState();
    store.recordReading('meshtastic', 7, { temperature: 18 }, 'rf');
    expect(store.recordReading('meshtastic', 7, { temperature: 18.5 }, 'rf')).toBe(true);
  });

  it('ignores invalid node ids and empty readings', () => {
    const store = useEnvironmentTelemetryStore.getState();
    expect(store.recordReading('meshtastic', 0, { temperature: 1 }, 'rf')).toBe(false);
    expect(store.recordReading('meshtastic', 3, {}, 'rf')).toBe(false);
    expect(window.electronAPI.db.saveEnvironmentTelemetry).not.toHaveBeenCalled();
  });

  it('caps points per node', () => {
    vi.useFakeTimers();
    const store = useEnvironmentTelemetryStore.getState();
    for (let i = 0; i < ENVIRONMENT_TELEMETRY_MAX_PER_NODE + 5; i++) {
      store.recordReading('meshtastic', 5, { co2: i }, 'rf');
      vi.advanceTimersByTime(1000);
    }
    const series = selectEnvironmentSeries(
      useEnvironmentTelemetryStore.getState(),
      'meshtastic',
      5,
    );
    expect(series).toHaveLength(ENVIRONMENT_TELEMETRY_MAX_PER_NODE);
    expect(series[0].reading.co2).toBe(5);
  });

  it('warns but does not throw when the DB write fails', async () => {
    const { spy: warn, restore } = mockConsoleWarn();
    vi.mocked(window.electronAPI.db.saveEnvironmentTelemetry).mockRejectedValueOnce(
      new Error('disk full'),
    );
    expect(() =>
      useEnvironmentTelemetryStore.getState().recordReading('meshcore', 9, { co2: 400 }, 'rpc'),
    ).not.toThrow();
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('DB write failed'));
    });
    expect(
      selectEnvironmentSeries(useEnvironmentTelemetryStore.getState(), 'meshcore', 9),
    ).toHaveLength(1);
    restore();
  });

  it('returns stable empty selectors when there is no data', () => {
    const s = useEnvironmentTelemetryStore.getState();
    expect(selectEnvironmentSeries(s, 'meshtastic', 1)).toBe(
      selectEnvironmentSeries(s, 'meshcore', 2),
    );
    expect(selectEnvironmentNodes(s, 'meshtastic')).toBe(selectEnvironmentNodes(s, 'meshcore'));
  });

  it('merges partial readings for the latest values', () => {
    const series = [
      { t: 1, reading: { temperature: 10, relativeHumidity: 50 }, source: 'rf' as const },
      { t: 2, reading: { co2: 600 }, source: 'rf' as const },
    ];
    expect(latestEnvironmentReading(series)).toEqual({
      temperature: 10,
      relativeHumidity: 50,
      co2: 600,
    });
    expect(latestEnvironmentValue(series, 'temperature')).toEqual({ value: 10, t: 1 });
    expect(latestEnvironmentValue(series, 'lux')).toBeNull();
  });

  it('hydrates from the DB and keeps readings recorded during the load', async () => {
    const now = Date.now();
    let resolve: (rows: EnvironmentTelemetryRow[]) => void = () => {};
    vi.mocked(window.electronAPI.db.getEnvironmentTelemetry).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const pending = useEnvironmentTelemetryStore.getState().loadFromDb();
    useEnvironmentTelemetryStore
      .getState()
      .recordReading('meshtastic', 1, { temperature: 30 }, 'rf');
    resolve([
      row({ node_id: 1, recorded_at: now - 5000, temperature: 25 }),
      row({ protocol: 'meshcore', node_id: 2, recorded_at: now - 4000, temperature: 12 }),
      row({ protocol: 'not-a-protocol', node_id: 3, temperature: 1 }),
    ]);
    await pending;
    const s = useEnvironmentTelemetryStore.getState();
    expect(selectEnvironmentSeries(s, 'meshtastic', 1).map((p) => p.reading.temperature)).toEqual([
      25, 30,
    ]);
    expect(selectEnvironmentSeries(s, 'meshcore', 2)).toHaveLength(1);
  });
});
