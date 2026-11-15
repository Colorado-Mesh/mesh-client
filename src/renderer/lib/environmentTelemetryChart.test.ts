import { describe, expect, it } from 'vitest';

import {
  buildEnvironmentChartRows,
  defaultEnvironmentChartNode,
  ENV_CHART_ALL_NODES,
  environmentTelemetryCsvHeaders,
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

  it('builds time-sorted rows for one node and all nodes', () => {
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
    expect(all[0].relativeHumidity).toBe(40);
  });

  it('includes every reading field in CSV headers', () => {
    const headers = environmentTelemetryCsvHeaders();
    expect(headers).toContain('env_mcu_temperature');
    expect(headers).toContain('env_pm_voc_idx');
    expect(headers).toContain('env_adc_voltage_ch0');
    expect(headers).toContain('env_one_wire_temperature_ch7');
  });
});
