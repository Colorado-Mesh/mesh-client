/**
 * Store-backed environment sensor charts for Device → Telemetry.
 */
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useNowMs } from '@/renderer/hooks/useNowMs';
import {
  buildEnvironmentChartRows,
  chartRowsHaveField,
  defaultEnvironmentChartNode,
  ENV_CHART_ALL_NODES,
  ENV_CHART_ALL_NODES_MAX_OVERLAY,
  envChartMetricKey,
  type EnvChartNodeSelection,
  environmentChartWindowMs,
  selectEnvironmentChartOverlayNodeIds,
} from '@/renderer/lib/environmentTelemetryChart';
import { formatDisplayDateTime, formatDisplayTime } from '@/renderer/lib/formatDisplayTime';
import { resolveIdentityIdForProtocol } from '@/renderer/lib/identityByProtocol';
import { nodeDisplayName } from '@/renderer/lib/nodeLongNameOrHex';
import type { ProtocolCapabilities } from '@/renderer/lib/radio/BaseRadioProvider';
import type { MeshNode } from '@/renderer/lib/types';
import {
  type EnvironmentHistoryPoint,
  selectEnvironmentNodes,
  useEnvironmentTelemetryStore,
} from '@/renderer/stores/environmentTelemetryStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';
import { useTimeFormatStore } from '@/renderer/stores/timeFormatStore';
import {
  ENVIRONMENT_TELEMETRY_CHART_WINDOWS,
  type EnvironmentTelemetryChartWindowId,
} from '@/shared/environmentTelemetry';
import type { MeshProtocol } from '@/shared/meshProtocol';

function latestDefinedNumber(
  rows: readonly Record<string, unknown>[],
  field: string,
): number | undefined {
  const prefix = `${field}__`;
  for (let i = rows.length - 1; i >= 0; i--) {
    const d = rows[i];
    if (!d) continue;
    const direct = d[field];
    if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
    for (const k of Object.keys(d)) {
      if (!k.startsWith(prefix)) continue;
      const v = d[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  return undefined;
}

function formatChartValue(value: number | undefined, fallback: string): string {
  return value === undefined ? fallback : String(value);
}

/** Tooltip labels: date+time for multi-day windows; time-only for 1h/24h. */
function formatChartTooltipLabel(value: unknown, use24Hour: boolean, multiDay: boolean): string {
  if (typeof value !== 'number') return typeof value === 'string' ? value : '';
  return multiDay
    ? formatDisplayDateTime(value, { use24Hour })
    : formatDisplayTime(value, { withSeconds: true, use24Hour });
}

interface MetricSeries {
  key: string;
  name: string;
  stroke: string;
}

/**
 * Recharts measures the legend wrapper and reserves that height inside the fixed
 * 250px ResponsiveContainer. "All nodes" expands each metric into one series per
 * node (up to ENVIRONMENT_CHART_ALL_NODES_MAX_OVERLAY), so an unbounded legend can
 * consume the whole card. Clamping keeps the plot area visible and scrolls entries.
 */
const ENV_CHART_LEGEND_WRAPPER_STYLE = { maxHeight: 64, overflowY: 'auto' } as const;

function expandMetricSeries(
  field: string,
  name: string,
  stroke: string,
  nodeIds: readonly number[],
  allNodes: boolean,
  nodeLabel: (id: number) => string,
): MetricSeries[] {
  if (!allNodes) return [{ key: field, name, stroke }];
  return nodeIds.map((id) => ({
    key: envChartMetricKey(field, id, true),
    name: `${name} (${nodeLabel(id)})`,
    stroke,
  }));
}

export interface Props {
  protocol: MeshProtocol;
  capabilities?: ProtocolCapabilities;
  useFahrenheit: boolean;
  myNodeNum?: number | null;
  nodesById?: ReadonlyMap<number, MeshNode>;
  /** MeshCore: request telemetry for the selected contact node. */
  onRequestSensorTelemetry?: (nodeId: number) => void;
  isConnected?: boolean;
}

export default function EnvironmentTelemetryCharts({
  protocol,
  capabilities,
  useFahrenheit,
  myNodeNum,
  nodesById,
  onRequestSensorTelemetry,
  isConnected,
}: Props) {
  const { t } = useTranslation();
  const use24HourTime = useTimeFormatStore((s) => s.use24HourTime);
  const nowMs = useNowMs();
  const identityId = useIdentityStore((s) =>
    resolveIdentityIdForProtocol(s.identities, s.activeIdentityId, protocol),
  );

  useEffect(() => {
    if (!identityId) return;
    void useEnvironmentTelemetryStore.getState().claimLegacyIdentity(protocol, identityId);
  }, [identityId, protocol]);

  const seriesByNode = useEnvironmentTelemetryStore((s) =>
    selectEnvironmentNodes(s, protocol, identityId),
  );

  const historyNodeIds = useMemo(() => [...seriesByNode.keys()], [seriesByNode]);
  const requestableNodeIds = useMemo(() => {
    const ids = new Set<number>();
    for (const id of historyNodeIds) ids.add(id);
    if (myNodeNum != null && myNodeNum > 0) ids.add(myNodeNum);
    if (nodesById) {
      for (const id of nodesById.keys()) {
        if (id > 0) ids.add(id);
      }
    }
    return [...ids].sort((a, b) => a - b);
  }, [historyNodeIds, myNodeNum, nodesById]);

  const lastHeard = useMemo(() => {
    const m = new Map<number, number>();
    for (const [id, series] of seriesByNode) {
      m.set(id, series.at(-1)?.t ?? 0);
    }
    return m;
  }, [seriesByNode]);

  const [selected, setSelected] = useState<EnvChartNodeSelection | null>(null);
  const [windowId, setWindowId] = useState<EnvironmentTelemetryChartWindowId>('24h');
  const [requestTargetId, setRequestTargetId] = useState<number | null>(null);

  const activeSelection: EnvChartNodeSelection | null = useMemo(() => {
    if (selected === ENV_CHART_ALL_NODES) return ENV_CHART_ALL_NODES;
    if (typeof selected === 'number' && seriesByNode.has(selected)) return selected;
    return defaultEnvironmentChartNode(historyNodeIds, lastHeard, myNodeNum);
  }, [selected, seriesByNode, historyNodeIds, lastHeard, myNodeNum]);

  const allNodes = activeSelection === ENV_CHART_ALL_NODES;
  const seriesNodeIds = useMemo(() => {
    if (allNodes) {
      return selectEnvironmentChartOverlayNodeIds(
        historyNodeIds,
        lastHeard,
        ENV_CHART_ALL_NODES_MAX_OVERLAY,
      );
    }
    if (typeof activeSelection === 'number') return [activeSelection];
    return [];
  }, [allNodes, historyNodeIds, lastHeard, activeSelection]);

  const chartSeriesByNode = useMemo(() => {
    if (!allNodes) return seriesByNode;
    const keep = new Set(seriesNodeIds);
    const filtered = new Map<number, readonly EnvironmentHistoryPoint[]>();
    for (const [id, series] of seriesByNode) {
      if (keep.has(id)) filtered.set(id, series);
    }
    return filtered;
  }, [allNodes, seriesByNode, seriesNodeIds]);

  const sinceMs = (nowMs > 0 ? nowMs : 0) - environmentChartWindowMs(windowId);
  const multiDayWindow = windowId === '7d';
  const envChartData = useMemo(
    () =>
      activeSelection == null
        ? []
        : buildEnvironmentChartRows(
            chartSeriesByNode,
            activeSelection,
            sinceMs,
            useFahrenheit,
            use24HourTime,
          ),
    [chartSeriesByNode, activeSelection, sinceMs, useFahrenheit, use24HourTime],
  );

  const hasAnyEnvHistory = historyNodeIds.length > 0;
  const chartValueUnavailable = t('telemetryPanel.chartValueUnavailable');

  const nodeLabel = (id: number) => {
    const node = nodesById?.get(id);
    return node ? nodeDisplayName(node, protocol) : String(id);
  };

  const metric = (field: string, name: string, stroke: string): MetricSeries[] =>
    expandMetricSeries(field, name, stroke, seriesNodeIds, allNodes, nodeLabel);

  const resolvedRequestTargetId = useMemo(() => {
    if (requestTargetId != null && requestableNodeIds.includes(requestTargetId)) {
      return requestTargetId;
    }
    if (myNodeNum != null && requestableNodeIds.includes(myNodeNum)) return myNodeNum;
    return requestableNodeIds[0] ?? null;
  }, [requestTargetId, requestableNodeIds, myNodeNum]);

  const showRequest =
    capabilities?.hasRepeaterStatus === true &&
    typeof onRequestSensorTelemetry === 'function' &&
    resolvedRequestTargetId != null;

  const requestControl = showRequest ? (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-muted flex items-center gap-2 text-xs">
        {t('telemetryPanel.envNode')}
        <select
          className="bg-ink-800 text-ink-200 rounded px-2 py-1 text-xs"
          value={String(resolvedRequestTargetId)}
          onChange={(e) => {
            setRequestTargetId(Number(e.target.value));
          }}
          aria-label={t('telemetryPanel.requestSensorTelemetry')}
          data-testid="env-telemetry-request-target"
        >
          {requestableNodeIds.map((n) => (
            <option key={n} value={n}>
              {nodeLabel(n)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="bg-ink-700 text-ink-300 hover:bg-ink-600 rounded px-2 py-1 text-xs"
        disabled={!isConnected}
        onClick={() => {
          onRequestSensorTelemetry(resolvedRequestTargetId);
        }}
        aria-label={t('telemetryPanel.requestSensorTelemetry')}
      >
        {t('telemetryPanel.requestSensorTelemetry')}
      </button>
    </div>
  ) : null;

  if (!hasAnyEnvHistory) {
    const isMeshcoreHint = capabilities?.hasRepeaterStatus === true;
    return (
      <div
        className="bg-ink-800/60 border-ink-700 space-y-3 rounded-lg border p-4"
        data-testid="env-telemetry-empty-hint"
        role="status"
      >
        <p className="text-ink-200 text-sm font-medium">{t('telemetryPanel.envEmptyTitle')}</p>
        <p className="text-muted text-xs">
          {isMeshcoreHint
            ? t('telemetryPanel.envEmptyMeshcoreBody')
            : t('telemetryPanel.envEmptyMeshtasticBody')}
        </p>
        {!isMeshcoreHint ? (
          <p className="text-muted text-xs">{t('telemetryPanel.envEmptyMeshtasticHint')}</p>
        ) : null}
        {requestControl}
      </div>
    );
  }

  const hasTemp =
    chartRowsHaveField(envChartData, 'temperature') ||
    chartRowsHaveField(envChartData, 'mcuTemperature') ||
    chartRowsHaveField(envChartData, 'pmTemperature');
  const hasHumidity =
    chartRowsHaveField(envChartData, 'relativeHumidity') ||
    chartRowsHaveField(envChartData, 'pmHumidity');
  const hasPressure = chartRowsHaveField(envChartData, 'barometricPressure');
  const hasIaq =
    chartRowsHaveField(envChartData, 'iaq') || chartRowsHaveField(envChartData, 'gasResistance');
  const hasPm =
    chartRowsHaveField(envChartData, 'pm10Standard') ||
    chartRowsHaveField(envChartData, 'pm25Standard') ||
    chartRowsHaveField(envChartData, 'pm40Standard') ||
    chartRowsHaveField(envChartData, 'pm100Standard') ||
    chartRowsHaveField(envChartData, 'co2');
  const hasVoc =
    chartRowsHaveField(envChartData, 'pmVocIdx') || chartRowsHaveField(envChartData, 'pmNoxIdx');
  const hasLux = chartRowsHaveField(envChartData, 'lux');
  const hasWind =
    chartRowsHaveField(envChartData, 'windSpeed') ||
    chartRowsHaveField(envChartData, 'windGust') ||
    chartRowsHaveField(envChartData, 'windLull') ||
    chartRowsHaveField(envChartData, 'windDirection');
  const hasRain =
    chartRowsHaveField(envChartData, 'rainfall1h') ||
    chartRowsHaveField(envChartData, 'rainfall24h') ||
    chartRowsHaveField(envChartData, 'weight');
  const hasLightning =
    chartRowsHaveField(envChartData, 'lightningStrikeCount1h') ||
    chartRowsHaveField(envChartData, 'lightningDistanceKm');
  const hasAdc = [0, 1, 2, 3, 4, 5, 6, 7].some((ch) =>
    chartRowsHaveField(envChartData, `adc${ch}`),
  );
  const hasOneWire = [0, 1, 2, 3, 4, 5, 6, 7].some((ch) =>
    chartRowsHaveField(envChartData, `oneWire${ch}`),
  );

  const tempHumidityChartAria = t('telemetryPanel.chartAriaTempHumidity', {
    temperature: formatChartValue(
      latestDefinedNumber(envChartData, 'temperature') ??
        latestDefinedNumber(envChartData, 'pmTemperature'),
      chartValueUnavailable,
    ),
    humidity: formatChartValue(
      latestDefinedNumber(envChartData, 'relativeHumidity'),
      chartValueUnavailable,
    ),
    count: envChartData.length,
  });

  const tickFmt = (v: unknown) =>
    typeof v === 'number' ? formatDisplayTime(v, { use24Hour: use24HourTime }) : '';
  const labelFmt = (v: unknown) => formatChartTooltipLabel(v, use24HourTime, multiDayWindow);

  const visibleLines = (series: MetricSeries[]) =>
    series.filter((s) => envChartData.some((d) => typeof d[s.key] === 'number'));

  return (
    <div className="space-y-4" data-testid="env-telemetry-charts">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-ink-200 text-lg font-semibold">
          {t('telemetryPanel.envSectionTitle')}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-muted flex items-center gap-2 text-xs">
            {t('telemetryPanel.envNode')}
            <select
              className="bg-ink-800 text-ink-200 rounded px-2 py-1 text-xs"
              value={
                activeSelection === ENV_CHART_ALL_NODES ? 'all' : String(activeSelection ?? '')
              }
              onChange={(e) => {
                const v = e.target.value;
                setSelected(v === 'all' ? ENV_CHART_ALL_NODES : Number(v));
              }}
              aria-label={t('telemetryPanel.envNode')}
            >
              {historyNodeIds.map((n) => (
                <option key={n} value={n}>
                  {nodeLabel(n)}
                </option>
              ))}
              {historyNodeIds.length > 1 ? (
                <option value="all">{t('telemetryPanel.envNodeAll')}</option>
              ) : null}
            </select>
          </label>
          <label className="text-muted flex items-center gap-2 text-xs">
            {t('telemetryPanel.envWindowLabel')}
            <select
              className="bg-ink-800 text-ink-200 rounded px-2 py-1 text-xs"
              value={windowId}
              onChange={(e) => {
                setWindowId(e.target.value as EnvironmentTelemetryChartWindowId);
              }}
              aria-label={t('telemetryPanel.envWindowLabel')}
            >
              {ENVIRONMENT_TELEMETRY_CHART_WINDOWS.map((w) => (
                <option key={w.id} value={w.id}>
                  {t(`telemetryPanel.envWindow.${w.id}`)}
                </option>
              ))}
            </select>
          </label>
          {requestControl}
        </div>
      </div>
      <p className="text-muted text-xs">
        {capabilities?.hasRepeaterStatus === true
          ? t('telemetryPanel.envHistoryHintMeshcore')
          : t('telemetryPanel.envHistoryHintMeshtastic')}
      </p>
      {capabilities?.hasEnvironmentTelemetry !== false &&
      envChartData.length === 0 &&
      hasAnyEnvHistory ? (
        <p className="text-muted text-xs" role="status">
          {t('telemetryPanel.envEmptyWindow')}
        </p>
      ) : null}

      {hasTemp || hasHumidity ? (
        <ChartCard
          title={t('telemetryPanel.sectionTemperatureHumidity')}
          aria={tempHumidityChartAria}
        >
          <LineChart data={envChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#364156" />
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={tickFmt}
              stroke="#65738c"
              tick={{ fontSize: 11 }}
            />
            {hasTemp && (
              <YAxis
                yAxisId="temp"
                stroke="#f59e0b"
                tick={{ fontSize: 11 }}
                label={{
                  value: useFahrenheit ? '°F' : '°C',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fill: '#f59e0b' },
                }}
              />
            )}
            {hasHumidity && (
              <YAxis
                yAxisId="humidity"
                orientation="right"
                domain={[0, 100]}
                stroke="#06b6d4"
                tick={{ fontSize: 11 }}
                label={{
                  value: '%',
                  angle: 90,
                  position: 'insideRight',
                  style: { fill: '#06b6d4' },
                }}
              />
            )}
            <Tooltip
              contentStyle={{
                background: '#19212d',
                border: '1px solid #364156',
                borderRadius: '8px',
              }}
              labelFormatter={labelFmt}
            />
            <Legend wrapperStyle={ENV_CHART_LEGEND_WRAPPER_STYLE} />
            {visibleLines(
              metric(
                'temperature',
                useFahrenheit ? t('telemetryPanel.seriesTempF') : t('telemetryPanel.seriesTempC'),
                '#f59e0b',
              ),
            ).map((s) => (
              <Line
                key={s.key}
                yAxisId="temp"
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.stroke}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
            {visibleLines(
              metric(
                'mcuTemperature',
                useFahrenheit
                  ? t('telemetryPanel.seriesMcuTempF')
                  : t('telemetryPanel.seriesMcuTempC'),
                '#fb923c',
              ),
            ).map((s) => (
              <Line
                key={s.key}
                yAxisId="temp"
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.stroke}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
            {visibleLines(metric('pmTemperature', t('telemetryPanel.seriesPmTemp'), '#fcd34d')).map(
              (s) => (
                <Line
                  key={s.key}
                  yAxisId="temp"
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.stroke}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ),
            )}
            {visibleLines(
              metric('relativeHumidity', t('telemetryPanel.seriesHumidityPct'), '#06b6d4'),
            ).map((s) => (
              <Line
                key={s.key}
                yAxisId="humidity"
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.stroke}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
            {visibleLines(
              metric('pmHumidity', t('telemetryPanel.seriesPmHumidity'), '#67e8f9'),
            ).map((s) => (
              <Line
                key={s.key}
                yAxisId="humidity"
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.stroke}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ChartCard>
      ) : null}

      {hasPressure ? (
        <MultiKeyCard
          title={t('telemetryPanel.sectionBarometricPressure')}
          data={envChartData}
          series={metric('barometricPressure', t('telemetryPanel.seriesPressureHpa'), '#a78bfa')}
          use24HourTime={use24HourTime}
          multiDayWindow={multiDayWindow}
          aria={t('telemetryPanel.chartAriaPressure', {
            pressure: formatChartValue(
              latestDefinedNumber(envChartData, 'barometricPressure'),
              chartValueUnavailable,
            ),
            count: envChartData.length,
          })}
        />
      ) : null}

      {hasIaq ? (
        <ChartCard
          title={t('telemetryPanel.sectionAirQuality')}
          aria={t('telemetryPanel.chartAriaIaq', {
            iaq: formatChartValue(latestDefinedNumber(envChartData, 'iaq'), chartValueUnavailable),
            count: envChartData.length,
          })}
        >
          <LineChart data={envChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#364156" />
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={tickFmt}
              stroke="#65738c"
              tick={{ fontSize: 11 }}
            />
            <YAxis yAxisId="iaq" domain={[0, 500]} stroke="#34d399" tick={{ fontSize: 11 }} />
            {chartRowsHaveField(envChartData, 'gasResistance') ? (
              <YAxis yAxisId="gas" orientation="right" stroke="#86efac" tick={{ fontSize: 11 }} />
            ) : null}
            <Tooltip
              contentStyle={{
                background: '#19212d',
                border: '1px solid #364156',
                borderRadius: '8px',
              }}
              labelFormatter={labelFmt}
            />
            <Legend wrapperStyle={ENV_CHART_LEGEND_WRAPPER_STYLE} />
            {visibleLines(metric('iaq', t('telemetryPanel.seriesIaq'), '#34d399')).map((s) => (
              <Line
                key={s.key}
                yAxisId="iaq"
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.stroke}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
            {visibleLines(
              metric('gasResistance', t('telemetryPanel.seriesGasResistance'), '#86efac'),
            ).map((s) => (
              <Line
                key={s.key}
                yAxisId="gas"
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.stroke}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ChartCard>
      ) : null}

      {hasPm ? (
        <ChartCard
          title={t('telemetryPanel.sectionParticulates')}
          aria={t('telemetryPanel.chartAriaParticulates', {
            pm25: formatChartValue(
              latestDefinedNumber(envChartData, 'pm25Standard'),
              chartValueUnavailable,
            ),
            co2: formatChartValue(latestDefinedNumber(envChartData, 'co2'), chartValueUnavailable),
            count: envChartData.length,
          })}
        >
          <LineChart data={envChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#364156" />
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={tickFmt}
              stroke="#65738c"
              tick={{ fontSize: 11 }}
            />
            <YAxis yAxisId="pm" stroke="#a78bfa" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="co2" orientation="right" stroke="#fbbf24" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: '#19212d',
                border: '1px solid #364156',
                borderRadius: '8px',
              }}
              labelFormatter={labelFmt}
            />
            <Legend wrapperStyle={ENV_CHART_LEGEND_WRAPPER_STYLE} />
            {(
              [
                ['pm10Standard', t('telemetryPanel.seriesPm10'), '#c4b5fd'],
                ['pm25Standard', t('telemetryPanel.seriesPm25'), '#a78bfa'],
                ['pm40Standard', t('telemetryPanel.seriesPm40'), '#8b5cf6'],
                ['pm100Standard', t('telemetryPanel.seriesPm100'), '#7c3aed'],
              ] as const
            ).flatMap(([field, name, stroke]) =>
              visibleLines(metric(field, name, stroke)).map((s) => (
                <Line
                  key={s.key}
                  yAxisId="pm"
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.stroke}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              )),
            )}
            {visibleLines(metric('co2', t('telemetryPanel.seriesCo2'), '#fbbf24')).map((s) => (
              <Line
                key={s.key}
                yAxisId="co2"
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.stroke}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ChartCard>
      ) : null}

      {hasVoc ? (
        <MultiKeyCard
          title={t('telemetryPanel.sectionVocNox')}
          data={envChartData}
          series={[
            ...metric('pmVocIdx', t('telemetryPanel.seriesVoc'), '#f472b6'),
            ...metric('pmNoxIdx', t('telemetryPanel.seriesNox'), '#e879f9'),
          ]}
          use24HourTime={use24HourTime}
          multiDayWindow={multiDayWindow}
        />
      ) : null}

      {hasLux ? (
        <MultiKeyCard
          title={t('telemetryPanel.sectionLight')}
          data={envChartData}
          series={metric('lux', t('telemetryPanel.seriesLux'), '#fde047')}
          use24HourTime={use24HourTime}
          multiDayWindow={multiDayWindow}
          aria={t('telemetryPanel.chartAriaLux', {
            lux: formatChartValue(latestDefinedNumber(envChartData, 'lux'), chartValueUnavailable),
            count: envChartData.length,
          })}
        />
      ) : null}

      {hasWind ? (
        <MultiKeyCard
          title={t('telemetryPanel.sectionWind')}
          data={envChartData}
          series={[
            ...metric('windSpeed', t('telemetryPanel.seriesWindSpeed'), '#38bdf8'),
            ...metric('windGust', t('telemetryPanel.seriesWindGust'), '#0ea5e9'),
            ...metric('windLull', t('telemetryPanel.seriesWindLull'), '#7dd3fc'),
            ...metric('windDirection', t('telemetryPanel.seriesWindDirection'), '#0284c7'),
          ]}
          use24HourTime={use24HourTime}
          multiDayWindow={multiDayWindow}
        />
      ) : null}

      {hasRain ? (
        <MultiKeyCard
          title={t('telemetryPanel.sectionRainWeight')}
          data={envChartData}
          series={[
            ...metric('rainfall1h', t('telemetryPanel.seriesRain1h'), '#60a5fa'),
            ...metric('rainfall24h', t('telemetryPanel.seriesRain24h'), '#3b82f6'),
            ...metric('weight', t('telemetryPanel.seriesWeight'), '#93c5fd'),
          ]}
          use24HourTime={use24HourTime}
          multiDayWindow={multiDayWindow}
        />
      ) : null}

      {hasLightning ? (
        <MultiKeyCard
          title={t('telemetryPanel.sectionLightning')}
          data={envChartData}
          series={[
            ...metric(
              'lightningStrikeCount1h',
              t('telemetryPanel.seriesLightningStrikes'),
              '#f87171',
            ),
            ...metric(
              'lightningDistanceKm',
              t('telemetryPanel.seriesLightningDistance'),
              '#fb7185',
            ),
          ]}
          use24HourTime={use24HourTime}
          multiDayWindow={multiDayWindow}
        />
      ) : null}

      {hasAdc ? (
        <MultiKeyCard
          title={t('telemetryPanel.sectionAdc')}
          data={envChartData}
          series={[0, 1, 2, 3, 4, 5, 6, 7].flatMap((ch) =>
            metric(
              `adc${ch}`,
              t('telemetryPanel.seriesAdcChannel', { channel: ch }),
              `hsl(${200 + ch * 20} 70% 60%)`,
            ),
          )}
          use24HourTime={use24HourTime}
          multiDayWindow={multiDayWindow}
        />
      ) : null}

      {hasOneWire ? (
        <MultiKeyCard
          title={t('telemetryPanel.sectionOneWire')}
          data={envChartData}
          series={[0, 1, 2, 3, 4, 5, 6, 7].flatMap((ch) =>
            metric(
              `oneWire${ch}`,
              t('telemetryPanel.seriesOneWireChannel', { channel: ch }),
              `hsl(${30 + ch * 15} 80% 55%)`,
            ),
          )}
          use24HourTime={use24HourTime}
          multiDayWindow={multiDayWindow}
        />
      ) : null}
    </div>
  );
}

function ChartCard({
  title,
  aria,
  children,
}: {
  title: string;
  aria: string;
  children: ReactElement;
}) {
  return (
    <div className="bg-deep-black rounded-lg p-4">
      <h3 className="text-muted mb-3 text-sm font-medium">{title}</h3>
      <div role="img" aria-label={aria}>
        <ResponsiveContainer width="100%" height={250}>
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MultiKeyCard({
  title,
  data,
  series,
  use24HourTime,
  multiDayWindow,
  aria,
}: {
  title: string;
  data: readonly Record<string, unknown>[];
  series: readonly MetricSeries[];
  use24HourTime: boolean;
  multiDayWindow: boolean;
  aria?: string;
}) {
  const visible = series.filter((s) => data.some((d) => typeof d[s.key] === 'number'));
  if (visible.length === 0) return null;
  const tickFmt = (v: unknown) =>
    typeof v === 'number' ? formatDisplayTime(v, { use24Hour: use24HourTime }) : '';
  const labelFmt = (v: unknown) => formatChartTooltipLabel(v, use24HourTime, multiDayWindow);
  return (
    <ChartCard title={title} aria={aria ?? title}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#364156" />
        <XAxis
          dataKey="t"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={tickFmt}
          stroke="#65738c"
          tick={{ fontSize: 11 }}
        />
        <YAxis stroke="#65738c" tick={{ fontSize: 11 }} />
        <Tooltip
          contentStyle={{
            background: '#19212d',
            border: '1px solid #364156',
            borderRadius: '8px',
          }}
          labelFormatter={labelFmt}
        />
        <Legend wrapperStyle={ENV_CHART_LEGEND_WRAPPER_STYLE} />
        {visible.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.stroke}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ChartCard>
  );
}
