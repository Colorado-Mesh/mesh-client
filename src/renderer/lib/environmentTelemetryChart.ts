/**
 * Build Device → Telemetry chart rows from persisted environment history.
 */
import {
  ENVIRONMENT_READING_FIELDS,
  ENVIRONMENT_TELEMETRY_CHART_WINDOWS,
  type EnvironmentReading,
  environmentReadingCsvHeader,
  type EnvironmentReadingField,
  type EnvironmentTelemetryChartWindowId,
} from '@/shared/environmentTelemetry';

import type { EnvironmentHistoryPoint } from '../stores/environmentTelemetryStore';
import { formatDisplayTime } from './formatDisplayTime';

export const ENV_CHART_ALL_NODES = 'all' as const;
export type EnvChartNodeSelection = number | typeof ENV_CHART_ALL_NODES;

export function environmentChartWindowMs(id: EnvironmentTelemetryChartWindowId): number {
  return (
    ENVIRONMENT_TELEMETRY_CHART_WINDOWS.find((w) => w.id === id)?.ms ??
    ENVIRONMENT_TELEMETRY_CHART_WINDOWS[2].ms
  );
}

/** Prefer connected radio if it has data, else newest reporting node, else null. */
export function defaultEnvironmentChartNode(
  nodeIds: readonly number[],
  lastHeardByNode: ReadonlyMap<number, number>,
  myNodeNum: number | null | undefined,
): number | null {
  if (nodeIds.length === 0) return null;
  if (myNodeNum != null && nodeIds.includes(myNodeNum)) return myNodeNum;
  let best: number | null = null;
  let bestT = -1;
  for (const id of nodeIds) {
    const t = lastHeardByNode.get(id) ?? 0;
    if (t >= bestT) {
      bestT = t;
      best = id;
    }
  }
  return best;
}

export type EnvChartRow = {
  t: number;
  time: string;
  nodeNum?: number;
} & Partial<Record<EnvironmentReadingField, number>> & {
    adc0?: number;
    adc1?: number;
    adc2?: number;
    adc3?: number;
    adc4?: number;
    adc5?: number;
    adc6?: number;
    adc7?: number;
    oneWire0?: number;
    oneWire1?: number;
    oneWire2?: number;
    oneWire3?: number;
    oneWire4?: number;
    oneWire5?: number;
    oneWire6?: number;
    oneWire7?: number;
  };

function applyTempUnit(celsius: number | undefined, useFahrenheit: boolean): number | undefined {
  if (celsius === undefined) return undefined;
  return useFahrenheit
    ? parseFloat(((celsius * 9) / 5 + 32).toFixed(1))
    : parseFloat(celsius.toFixed(1));
}

function expandArrays(reading: EnvironmentReading, row: EnvChartRow): void {
  const mutable = row as EnvChartRow & Record<string, number | undefined>;
  for (let ch = 0; ch < 8; ch++) {
    const adc = reading.adcVoltages?.[ch];
    if (typeof adc === 'number') mutable[`adc${ch}`] = adc;
    const ow = reading.oneWireTemperatures?.[ch];
    if (typeof ow === 'number') mutable[`oneWire${ch}`] = ow;
  }
}

/** Flatten history points in `[sinceMs, now]` for one node (or all nodes interleaved). */
export function buildEnvironmentChartRows(
  seriesByNode: ReadonlyMap<number, readonly EnvironmentHistoryPoint[]>,
  selection: EnvChartNodeSelection,
  sinceMs: number,
  useFahrenheit: boolean,
  use24Hour: boolean,
): EnvChartRow[] {
  const points: { t: number; nodeNum: number; reading: EnvironmentReading }[] = [];
  if (selection === ENV_CHART_ALL_NODES) {
    for (const [nodeNum, series] of seriesByNode) {
      for (const p of series) {
        if (p.t >= sinceMs) points.push({ t: p.t, nodeNum, reading: p.reading });
      }
    }
  } else {
    for (const p of seriesByNode.get(selection) ?? []) {
      if (p.t >= sinceMs) points.push({ t: p.t, nodeNum: selection, reading: p.reading });
    }
  }
  points.sort((a, b) => a.t - b.t || a.nodeNum - b.nodeNum);
  return points.map(({ t, nodeNum, reading }) => {
    const row: EnvChartRow = {
      t,
      time: formatDisplayTime(t, { withSeconds: true, use24Hour }),
      nodeNum,
    };
    for (const field of ENVIRONMENT_READING_FIELDS) {
      const v = reading[field];
      if (v === undefined) continue;
      if (field === 'temperature' || field === 'mcuTemperature' || field === 'pmTemperature') {
        row[field] = applyTempUnit(v, useFahrenheit);
      } else {
        row[field] = v;
      }
    }
    expandArrays(reading, row);
    return row;
  });
}

/** CSV headers derived from the shared field list (plus ADC / one-wire channels). */
export function environmentTelemetryCsvHeaders(): string[] {
  const headers = [
    'timestamp',
    'type',
    'node_id',
    'battery_level',
    'voltage',
    'snr',
    'rssi',
    ...ENVIRONMENT_READING_FIELDS.map(environmentReadingCsvHeader),
  ];
  for (let ch = 0; ch < 8; ch++) headers.push(`env_adc_voltage_ch${ch}`);
  for (let ch = 0; ch < 8; ch++) headers.push(`env_one_wire_temperature_ch${ch}`);
  return headers;
}

export function environmentReadingCsvCells(
  reading: EnvironmentReading,
  escape: (v: string | number | undefined) => string,
): string[] {
  const cells = ENVIRONMENT_READING_FIELDS.map((f) => escape(reading[f]));
  for (let ch = 0; ch < 8; ch++) cells.push(escape(reading.adcVoltages?.[ch]));
  for (let ch = 0; ch < 8; ch++) cells.push(escape(reading.oneWireTemperatures?.[ch]));
  return cells;
}
