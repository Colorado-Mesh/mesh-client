import { describe, expect, it } from 'vitest';

import { ENVIRONMENT_CHART_ALL_NODES_MAX_OVERLAY } from '@/shared/environmentTelemetry';

import {
  buildEnvironmentChartRows,
  chartRowsHaveField,
  defaultEnvironmentChartNode,
  ENV_CHART_ALL_NODES,
  environmentTelemetryCsvHeaders,
  selectEnvironmentChartOverlayNodeIds,
} from './environmentTelemetryChart';

describe('environmentTelemetryChart', () => {
  it('defaults to myNodeNum when that node has data', () => {
    expect(
      defaultEnvironmentChartNode(
        [1, 2, 9],
        new Map([
          [2, 100],
          [9, 200],
        ]),
        9,
      ),
    ).toBe(9);
  });

  it('defaults to the newest reporting node otherwise', () => {
    expect(
      defaultEnvironmentChartNode(
        [1, 2],
        new Map([
          [1, 10],
          [2, 50],
        ]),
        null,
      ),
    ).toBe(2);
  });

  it('builds time-sorted rows for one node and per-node keys for all nodes', () => {
    const series = new Map([
      [
        1,
        [
          { t: 1000, reading: { temperature: 10 }, source: 'rf' as const },
          { t: 3000, reading: { temperature: 12 }, source: 'rf' as const },
        ],
      ],
      [2, [{ t: 2000, reading: { relativeHumidity: 40 }, source: 'mqtt' as const }]],
    ]);
    const one = buildEnvironmentChartRows(series, 1, 0, false, true);
    expect(one.map((r) => r.temperature)).toEqual([10, 12]);
    const all = buildEnvironmentChartRows(series, ENV_CHART_ALL_NODES, 1500, false, true);
    expect(all.map((r) => r.nodeNum)).toEqual([2, 1]);
    expect(all[0].relativeHumidity__2).toBe(40);
    expect(all[1].temperature__1).toBe(12);
    expect(all[0].temperature).toBeUndefined();
  });

  it('applies temperature unit preference to one-wire channels', () => {
    const series = new Map([
      [1, [{ t: 1000, reading: { oneWireTemperatures: [10] }, source: 'rf' as const }]],
    ]);
    const c = buildEnvironmentChartRows(series, 1, 0, false, true);
    expect(c[0].oneWire0).toBe(10);
    const f = buildEnvironmentChartRows(series, 1, 0, true, true);
    expect(f[0].oneWire0).toBe(50);
  });

  it('detects pmTemperature-only series for chart presence', () => {
    const series = new Map([
      [1, [{ t: 1000, reading: { pmTemperature: 22 }, source: 'rf' as const }]],
    ]);
    const rows = buildEnvironmentChartRows(series, 1, 0, false, true);
    expect(chartRowsHaveField(rows, 'pmTemperature')).toBe(true);
    expect(chartRowsHaveField(rows, 'temperature')).toBe(false);
    expect(chartRowsHaveField(rows, 'mcuTemperature')).toBe(false);
  });

  it('caps all-nodes overlay to newest reporting nodes', () => {
    const ids = Array.from(
      { length: ENVIRONMENT_CHART_ALL_NODES_MAX_OVERLAY + 5 },
      (_, i) => i + 1,
    );
    const lastHeard = new Map(ids.map((id, i) => [id, i * 1000]));
    const picked = selectEnvironmentChartOverlayNodeIds(
      ids,
      lastHeard,
      ENVIRONMENT_CHART_ALL_NODES_MAX_OVERLAY,
    );
    expect(picked).toHaveLength(ENVIRONMENT_CHART_ALL_NODES_MAX_OVERLAY);
    expect(picked[0]).toBe(ids[ids.length - 1]);
  });

  it('downsamples dense all-nodes chart rows', () => {
    const series = new Map([
      [
        1,
        Array.from({ length: 4000 }, (_, i) => ({
          t: i * 1000,
          reading: { temperature: i },
          source: 'rf' as const,
        })),
      ],
    ]);
    const rows = buildEnvironmentChartRows(series, ENV_CHART_ALL_NODES, 0, false, true);
    expect(rows.length).toBeLessThan(2000);
    expect(rows.at(-1)?.t).toBe(3_999_000);
  });

  it('includes every reading field in CSV headers', () => {
    const headers = environmentTelemetryCsvHeaders();
    expect(headers).toContain('env_mcu_temperature');
    expect(headers).toContain('env_pm_voc_idx');
    expect(headers).toContain('env_adc_voltage_ch0');
    expect(headers).toContain('env_one_wire_temperature_ch7');
  });
});
