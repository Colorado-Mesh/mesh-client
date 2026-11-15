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
  defaultEnvironmentChartNode,
  ENV_CHART_ALL_NODES,
  type EnvChartNodeSelection,
  environmentChartWindowMs,
} from '@/renderer/lib/environmentTelemetryChart';
import { resolveIdentityIdForProtocol } from '@/renderer/lib/identityByProtocol';
import { nodeDisplayName } from '@/renderer/lib/nodeLongNameOrHex';
import type { ProtocolCapabilities } from '@/renderer/lib/radio/BaseRadioProvider';
import type { MeshNode } from '@/renderer/lib/types';
import {
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
  key: string,
): number | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i]?.[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

function formatChartValue(value: number | undefined, fallback: string): string {
  return value === undefined ? fallback : String(value);
}

function hasKey(rows: readonly Record<string, unknown>[], key: string): boolean {
  return rows.some((d) => typeof d[key] === 'number');
}

interface Props {
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

  const nodeIds = useMemo(() => [...seriesByNode.keys()], [seriesByNode]);
  const lastHeard = useMemo(() => {
    const m = new Map<number, number>();
    for (const [id, series] of seriesByNode) {
      m.set(id, series.at(-1)?.t ?? 0);
    }
    return m;
  }, [seriesByNode]);

  const [selected, setSelected] = useState<EnvChartNodeSelection | null>(null);
  const [windowId, setWindowId] = useState<EnvironmentTelemetryChartWindowId>('24h');

  const activeSelection: EnvChartNodeSelection | null = useMemo(() => {
    if (selected === ENV_CHART_ALL_NODES) return ENV_CHART_ALL_NODES;
    if (typeof selected === 'number' && seriesByNode.has(selected)) return selected;
    return defaultEnvironmentChartNode(nodeIds, lastHeard, myNodeNum);
  }, [selected, seriesByNode, nodeIds, lastHeard, myNodeNum]);

  const sinceMs = (nowMs > 0 ? nowMs : 0) - environmentChartWindowMs(windowId);
  const envChartData = useMemo(
    () =>
      activeSelection == null
        ? []
        : buildEnvironmentChartRows(
            seriesByNode,
            activeSelection,
            sinceMs,
            useFahrenheit,
            use24HourTime,
          ),
    [seriesByNode, activeSelection, sinceMs, useFahrenheit, use24HourTime],
  );

  const hasAnyEnvHistory = nodeIds.length > 0;
  const chartValueUnavailable = t('telemetryPanel.chartValueUnavailable');

  const nodeLabel = (id: number) => {
    const node = nodesById?.get(id);
    return node ? nodeDisplayName(node, protocol) : String(id);
  };

  if (!hasAnyEnvHistory) {
    const isMeshcoreHint = capabilities?.hasRepeaterStatus === true;
    return (
      <div
        className="bg-ink-800/60 border-ink-700 rounded-lg border p-4"
        data-testid="env-telemetry-empty-hint"
        role="status"
      >
        <p className="text-ink-200 text-sm font-medium">{t('telemetryPanel.envEmptyTitle')}</p>
        <p className="text-muted mt-1 text-xs">
          {isMeshcoreHint
            ? t('telemetryPanel.envEmptyMeshcoreBody')
            : t('telemetryPanel.envEmptyMeshtasticBody')}
        </p>
        {!isMeshcoreHint ? (
          <p className="text-muted mt-2 text-xs">{t('telemetryPanel.envEmptyMeshtasticHint')}</p>
        ) : null}
      </div>
    );
  }

  const hasTemp = hasKey(envChartData, 'temperature') || hasKey(envChartData, 'mcuTemperature');
  const hasHumidity =
    hasKey(envChartData, 'relativeHumidity') || hasKey(envChartData, 'pmHumidity');
  const hasPressure = hasKey(envChartData, 'barometricPressure');
  const hasIaq = hasKey(envChartData, 'iaq') || hasKey(envChartData, 'gasResistance');
  const hasPm =
    hasKey(envChartData, 'pm10Standard') ||
    hasKey(envChartData, 'pm25Standard') ||
    hasKey(envChartData, 'pm40Standard') ||
    hasKey(envChartData, 'pm100Standard') ||
    hasKey(envChartData, 'co2');
  const hasVoc = hasKey(envChartData, 'pmVocIdx') || hasKey(envChartData, 'pmNoxIdx');
  const hasLux = hasKey(envChartData, 'lux');
  const hasWind =
    hasKey(envChartData, 'windSpeed') ||
    hasKey(envChartData, 'windGust') ||
    hasKey(envChartData, 'windLull') ||
    hasKey(envChartData, 'windDirection');
  const hasRain =
    hasKey(envChartData, 'rainfall1h') ||
    hasKey(envChartData, 'rainfall24h') ||
    hasKey(envChartData, 'weight');
  const hasLightning =
    hasKey(envChartData, 'lightningStrikeCount1h') || hasKey(envChartData, 'lightningDistanceKm');
  const hasAdc = [0, 1, 2, 3, 4, 5, 6, 7].some((ch) => hasKey(envChartData, `adc${ch}`));
  const hasOneWire = [0, 1, 2, 3, 4, 5, 6, 7].some((ch) => hasKey(envChartData, `oneWire${ch}`));

  const tempHumidityChartAria = t('telemetryPanel.chartAriaTempHumidity', {
    temperature: formatChartValue(
      latestDefinedNumber(envChartData, 'temperature'),
      chartValueUnavailable,
    ),
    humidity: formatChartValue(
      latestDefinedNumber(envChartData, 'relativeHumidity'),
      chartValueUnavailable,
    ),
    count: envChartData.length,
  });

  const requestNodeId =
    typeof activeSelection === 'number' ? activeSelection : (myNodeNum ?? nodeIds[0] ?? null);

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
              {nodeIds.map((n) => (
                <option key={n} value={n}>
                  {nodeLabel(n)}
                </option>
              ))}
              {nodeIds.length > 1 ? (
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
          {capabilities?.hasRepeaterStatus === true &&
          onRequestSensorTelemetry &&
          requestNodeId != null ? (
            <button
              type="button"
              className="bg-ink-700 text-ink-300 hover:bg-ink-600 rounded px-2 py-1 text-xs"
              disabled={!isConnected}
              onClick={() => {
                onRequestSensorTelemetry(requestNodeId);
              }}
              aria-label={t('telemetryPanel.requestSensorTelemetry')}
            >
              {t('telemetryPanel.requestSensorTelemetry')}
            </button>
          ) : null}
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
              tickFormatter={(v) =>
                typeof v === 'number'
                  ? new Date(v).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''
              }
              stroke="#65738c"
              tick={{ fontSize: 11 }}
            />
            {(hasKey(envChartData, 'temperature') || hasKey(envChartData, 'mcuTemperature')) && (
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
              labelFormatter={(v) =>
                typeof v === 'number'
                  ? new Date(v).toLocaleString()
                  : typeof v === 'string'
                    ? v
                    : ''
              }
            />
            <Legend />
            {hasKey(envChartData, 'temperature') && (
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="temperature"
                name={
                  useFahrenheit ? t('telemetryPanel.seriesTempF') : t('telemetryPanel.seriesTempC')
                }
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            )}
            {hasKey(envChartData, 'mcuTemperature') && (
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="mcuTemperature"
                name={
                  useFahrenheit
                    ? t('telemetryPanel.seriesMcuTempF')
                    : t('telemetryPanel.seriesMcuTempC')
                }
                stroke="#fb923c"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            )}
            {hasKey(envChartData, 'pmTemperature') && (
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="pmTemperature"
                name={t('telemetryPanel.seriesPmTemp')}
                stroke="#fcd34d"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            )}
            {hasKey(envChartData, 'relativeHumidity') && (
              <Line
                yAxisId="humidity"
                type="monotone"
                dataKey="relativeHumidity"
                name={t('telemetryPanel.seriesHumidityPct')}
                stroke="#06b6d4"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            )}
            {hasKey(envChartData, 'pmHumidity') && (
              <Line
                yAxisId="humidity"
                type="monotone"
                dataKey="pmHumidity"
                name={t('telemetryPanel.seriesPmHumidity')}
                stroke="#67e8f9"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            )}
          </LineChart>
        </ChartCard>
      ) : null}

      {hasPressure ? (
        <SimpleLineCard
          title={t('telemetryPanel.sectionBarometricPressure')}
          data={envChartData}
          dataKey="barometricPressure"
          name={t('telemetryPanel.seriesPressureHpa')}
          unit="hPa"
          stroke="#a78bfa"
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
              stroke="#65738c"
              tick={{ fontSize: 11 }}
            />
            <YAxis yAxisId="iaq" domain={[0, 500]} stroke="#34d399" tick={{ fontSize: 11 }} />
            {hasKey(envChartData, 'gasResistance') ? (
              <YAxis yAxisId="gas" orientation="right" stroke="#86efac" tick={{ fontSize: 11 }} />
            ) : null}
            <Tooltip
              contentStyle={{
                background: '#19212d',
                border: '1px solid #364156',
                borderRadius: '8px',
              }}
            />
            <Legend />
            {hasKey(envChartData, 'iaq') ? (
              <Line
                yAxisId="iaq"
                type="monotone"
                dataKey="iaq"
                name={t('telemetryPanel.seriesIaq')}
                stroke="#34d399"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ) : null}
            {hasKey(envChartData, 'gasResistance') ? (
              <Line
                yAxisId="gas"
                type="monotone"
                dataKey="gasResistance"
                name={t('telemetryPanel.seriesGasResistance')}
                stroke="#86efac"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ) : null}
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
            />
            <Legend />
            {(
              [
                ['pm10Standard', t('telemetryPanel.seriesPm10'), '#c4b5fd'],
                ['pm25Standard', t('telemetryPanel.seriesPm25'), '#a78bfa'],
                ['pm40Standard', t('telemetryPanel.seriesPm40'), '#8b5cf6'],
                ['pm100Standard', t('telemetryPanel.seriesPm100'), '#7c3aed'],
              ] as const
            ).map(([key, name, stroke]) =>
              hasKey(envChartData, key) ? (
                <Line
                  key={key}
                  yAxisId="pm"
                  type="monotone"
                  dataKey={key}
                  name={name}
                  stroke={stroke}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ) : null,
            )}
            {hasKey(envChartData, 'co2') ? (
              <Line
                yAxisId="co2"
                type="monotone"
                dataKey="co2"
                name={t('telemetryPanel.seriesCo2')}
                stroke="#fbbf24"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ) : null}
          </LineChart>
        </ChartCard>
      ) : null}

      {hasVoc ? (
        <MultiKeyCard
          title={t('telemetryPanel.sectionVocNox')}
          data={envChartData}
          series={[
            { key: 'pmVocIdx', name: t('telemetryPanel.seriesVoc'), stroke: '#f472b6' },
            { key: 'pmNoxIdx', name: t('telemetryPanel.seriesNox'), stroke: '#e879f9' },
          ]}
        />
      ) : null}

      {hasLux ? (
        <SimpleLineCard
          title={t('telemetryPanel.sectionLight')}
          data={envChartData}
          dataKey="lux"
          name={t('telemetryPanel.seriesLux')}
          unit="lx"
          stroke="#fde047"
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
            { key: 'windSpeed', name: t('telemetryPanel.seriesWindSpeed'), stroke: '#38bdf8' },
            { key: 'windGust', name: t('telemetryPanel.seriesWindGust'), stroke: '#0ea5e9' },
            { key: 'windLull', name: t('telemetryPanel.seriesWindLull'), stroke: '#7dd3fc' },
            {
              key: 'windDirection',
              name: t('telemetryPanel.seriesWindDirection'),
              stroke: '#0284c7',
            },
          ]}
        />
      ) : null}

      {hasRain ? (
        <MultiKeyCard
          title={t('telemetryPanel.sectionRainWeight')}
          data={envChartData}
          series={[
            { key: 'rainfall1h', name: t('telemetryPanel.seriesRain1h'), stroke: '#60a5fa' },
            { key: 'rainfall24h', name: t('telemetryPanel.seriesRain24h'), stroke: '#3b82f6' },
            { key: 'weight', name: t('telemetryPanel.seriesWeight'), stroke: '#93c5fd' },
          ]}
        />
      ) : null}

      {hasLightning ? (
        <MultiKeyCard
          title={t('telemetryPanel.sectionLightning')}
          data={envChartData}
          series={[
            {
              key: 'lightningStrikeCount1h',
              name: t('telemetryPanel.seriesLightningStrikes'),
              stroke: '#f87171',
            },
            {
              key: 'lightningDistanceKm',
              name: t('telemetryPanel.seriesLightningDistance'),
              stroke: '#fb7185',
            },
          ]}
        />
      ) : null}

      {hasAdc ? (
        <MultiKeyCard
          title={t('telemetryPanel.sectionAdc')}
          data={envChartData}
          series={[0, 1, 2, 3, 4, 5, 6, 7].map((ch) => ({
            key: `adc${ch}`,
            name: t('telemetryPanel.seriesAdcChannel', { channel: ch }),
            stroke: `hsl(${200 + ch * 20} 70% 60%)`,
          }))}
        />
      ) : null}

      {hasOneWire ? (
        <MultiKeyCard
          title={t('telemetryPanel.sectionOneWire')}
          data={envChartData}
          series={[0, 1, 2, 3, 4, 5, 6, 7].map((ch) => ({
            key: `oneWire${ch}`,
            name: t('telemetryPanel.seriesOneWireChannel', { channel: ch }),
            stroke: `hsl(${30 + ch * 15} 80% 55%)`,
          }))}
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

function SimpleLineCard({
  title,
  data,
  dataKey,
  name,
  unit,
  stroke,
  aria,
}: {
  title: string;
  data: readonly Record<string, unknown>[];
  dataKey: string;
  name: string;
  unit: string;
  stroke: string;
  aria: string;
}) {
  return (
    <ChartCard title={title} aria={aria}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#364156" />
        <XAxis
          dataKey="t"
          type="number"
          domain={['dataMin', 'dataMax']}
          stroke="#65738c"
          tick={{ fontSize: 11 }}
        />
        <YAxis
          yAxisId="y"
          stroke={stroke}
          tick={{ fontSize: 11 }}
          label={{ value: unit, angle: -90, position: 'insideLeft', style: { fill: stroke } }}
        />
        <Tooltip
          contentStyle={{
            background: '#19212d',
            border: '1px solid #364156',
            borderRadius: '8px',
          }}
        />
        <Legend />
        <Line
          yAxisId="y"
          type="monotone"
          dataKey={dataKey}
          name={name}
          stroke={stroke}
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </LineChart>
    </ChartCard>
  );
}

function MultiKeyCard({
  title,
  data,
  series,
}: {
  title: string;
  data: readonly Record<string, unknown>[];
  series: readonly { key: string; name: string; stroke: string }[];
}) {
  const visible = series.filter((s) => hasKey(data, s.key));
  if (visible.length === 0) return null;
  return (
    <ChartCard title={title} aria={title}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#364156" />
        <XAxis
          dataKey="t"
          type="number"
          domain={['dataMin', 'dataMax']}
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
        />
        <Legend />
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
