import { Download, PARENT_HOVER_ATTR } from 'lucide-react-motion';
import { useCallback, useMemo } from 'react';
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

import { formatDisplayTime } from '@/renderer/lib/formatDisplayTime';
import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';

import { downloadBlob } from '../lib/downloadBlob';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import type { EnvironmentTelemetryPoint, MeshCoreLocalStats, TelemetryPoint } from '../lib/types';
import { useTimeFormatStore } from '../stores/timeFormatStore';
import RefreshButton from './RefreshButton';
import SignalMeter from './SignalMeter';

function toF(c: number) {
  return (c * 9) / 5 + 32;
}

/** ADC and one-wire temperature channels exposed by EnvironmentMetrics (`*_ch0`…`*_ch7`). */
const ADC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

/** Latest finite number for `key` walking chart rows newest-first. */
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

interface Props {
  telemetry: TelemetryPoint[];
  signalTelemetry: TelemetryPoint[];
  environmentTelemetry: EnvironmentTelemetryPoint[];
  useFahrenheit: boolean;
  onToggleFahrenheit: () => void;
  onRefresh: () => Promise<void>;
  isConnected: boolean;
  /** Protocol capabilities — hides environment section when not supported. */
  capabilities?: ProtocolCapabilities;
  /** MeshCore packet stats for packets chart */
  meshcorePacketStats?: Pick<
    MeshCoreLocalStats,
    'sent' | 'recv' | 'nSentFlood' | 'nSentDirect' | 'nRecvFlood' | 'nRecvDirect'
  > | null;
}

export default function TelemetryPanel({
  telemetry,
  signalTelemetry,
  environmentTelemetry,
  useFahrenheit,
  onToggleFahrenheit,
  onRefresh,
  isConnected,
  capabilities,
  meshcorePacketStats,
}: Props) {
  const { t } = useTranslation();
  const parentIconTrigger = useParentIconTrigger();
  const use24HourTime = useTimeFormatStore((s) => s.use24HourTime);
  const showEnvironment = capabilities?.hasEnvironmentTelemetry !== false;
  const showPacketStats = capabilities?.hasRfStats === true && meshcorePacketStats != null;
  const chartData = useMemo(
    () =>
      telemetry.map((t, i) => ({
        index: i,
        time: formatDisplayTime(t.timestamp, { withSeconds: true, use24Hour: use24HourTime }),
        battery: t.batteryLevel,
        voltage: t.voltage,
      })),
    [telemetry, use24HourTime],
  );

  const signalChartData = useMemo(
    () =>
      signalTelemetry.map((t, i) => ({
        index: i,
        time: formatDisplayTime(t.timestamp, { withSeconds: true, use24Hour: use24HourTime }),
        snr: t.snr,
        rssi: t.rssi,
      })),
    [signalTelemetry, use24HourTime],
  );

  const hasBatteryData = chartData.some((d) => d.battery !== undefined || d.voltage !== undefined);
  const hasSignalData = signalChartData.some((d) => d.snr !== undefined || d.rssi !== undefined);

  const envChartData = useMemo(
    () =>
      environmentTelemetry.map((t, i) => ({
        index: i,
        time: formatDisplayTime(t.timestamp, { withSeconds: true, use24Hour: use24HourTime }),
        temperature:
          t.temperature !== undefined
            ? useFahrenheit
              ? parseFloat(toF(t.temperature).toFixed(1))
              : parseFloat(t.temperature.toFixed(1))
            : undefined,
        mcuTemperature:
          t.mcuTemperature !== undefined
            ? useFahrenheit
              ? parseFloat(toF(t.mcuTemperature).toFixed(1))
              : parseFloat(t.mcuTemperature.toFixed(1))
            : undefined,
        humidity: t.relativeHumidity,
        pressure: t.barometricPressure,
        iaq: t.iaq,
        pm25: t.pm25Standard,
        co2: t.co2,
        lightningStrikes: t.lightningStrikeCount1h,
      })),
    [environmentTelemetry, useFahrenheit, use24HourTime],
  );

  const hasTemp = envChartData.some((d) => d.temperature !== undefined);
  const hasMcuTemp = envChartData.some((d) => d.mcuTemperature !== undefined);
  const hasHumidity = envChartData.some((d) => d.humidity !== undefined);
  const hasPressure = envChartData.some((d) => d.pressure !== undefined);
  const hasIaq = envChartData.some((d) => d.iaq !== undefined);
  const hasParticulates = envChartData.some(
    (d) => d.pm25 !== undefined || d.co2 !== undefined || d.lightningStrikes !== undefined,
  );
  const latestSignal =
    signalTelemetry.length > 0 ? signalTelemetry[signalTelemetry.length - 1] : null;
  const showLiveSignalMeter = capabilities?.hasRfStats === true;
  const chartValueUnavailable = t('telemetryPanel.chartValueUnavailable');
  const batteryChartAria = t('telemetryPanel.chartAriaBattery', {
    battery: formatChartValue(latestDefinedNumber(chartData, 'battery'), chartValueUnavailable),
    voltage: formatChartValue(latestDefinedNumber(chartData, 'voltage'), chartValueUnavailable),
    count: chartData.length,
  });
  const signalChartAria = t('telemetryPanel.chartAriaSignal', {
    snr: formatChartValue(latestDefinedNumber(signalChartData, 'snr'), chartValueUnavailable),
    rssi: formatChartValue(latestDefinedNumber(signalChartData, 'rssi'), chartValueUnavailable),
    count: signalChartData.length,
  });
  const tempHumidityChartAria = t('telemetryPanel.chartAriaTempHumidity', {
    temperature: formatChartValue(
      latestDefinedNumber(envChartData, 'temperature'),
      chartValueUnavailable,
    ),
    humidity: formatChartValue(
      latestDefinedNumber(envChartData, 'humidity'),
      chartValueUnavailable,
    ),
    count: envChartData.length,
  });
  const pressureChartAria = t('telemetryPanel.chartAriaPressure', {
    pressure: formatChartValue(
      latestDefinedNumber(envChartData, 'pressure'),
      chartValueUnavailable,
    ),
    count: envChartData.length,
  });
  const iaqChartAria = t('telemetryPanel.chartAriaIaq', {
    iaq: formatChartValue(latestDefinedNumber(envChartData, 'iaq'), chartValueUnavailable),
    count: envChartData.length,
  });
  const particulateChartAria = t('telemetryPanel.chartAriaParticulates', {
    pm25: formatChartValue(latestDefinedNumber(envChartData, 'pm25'), chartValueUnavailable),
    co2: formatChartValue(latestDefinedNumber(envChartData, 'co2'), chartValueUnavailable),
    count: envChartData.length,
  });

  const handleExportCsv = useCallback(() => {
    if (telemetry.length === 0 && signalTelemetry.length === 0 && environmentTelemetry.length === 0)
      return;

    function escapeCsvCell(v: string | number | undefined): string {
      const s = String(v ?? '');
      return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }

    const headers = [
      'timestamp',
      'type',
      'battery_level',
      'voltage',
      'snr',
      'rssi',
      'env_temperature_c',
      'mcu_temperature_c',
      'env_humidity_pct',
      'env_pressure_hpa',
      'env_iaq',
      'env_pm25_standard',
      'env_pm100_standard',
      'env_co2_ppm',
      'env_voc_idx',
      'env_nox_idx',
      'env_lightning_strikes_1h',
      'env_lightning_distance_km',
      ...ADC_CHANNELS.map((ch) => `env_adc_voltage_ch${ch}`),
      ...ADC_CHANNELS.map((ch) => `env_one_wire_temperature_ch${ch}`),
    ];
    /** Trailing blank cells so battery/signal rows line up with the environment columns. */
    const envPadding = Array.from({ length: headers.length - 6 }, () => '');
    const batteryRows = telemetry.map((t) => [
      escapeCsvCell(new Date(t.timestamp).toISOString()),
      escapeCsvCell('battery'),
      escapeCsvCell(t.batteryLevel),
      escapeCsvCell(t.voltage),
      escapeCsvCell(''),
      escapeCsvCell(''),
      ...envPadding,
    ]);
    const signalRows = signalTelemetry.map((t) => [
      escapeCsvCell(new Date(t.timestamp).toISOString()),
      escapeCsvCell('signal'),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(t.snr),
      escapeCsvCell(t.rssi),
      ...envPadding,
    ]);
    const envRows = environmentTelemetry.map((t) => [
      escapeCsvCell(new Date(t.timestamp).toISOString()),
      escapeCsvCell('environment'),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(t.temperature),
      escapeCsvCell(t.mcuTemperature),
      escapeCsvCell(t.relativeHumidity),
      escapeCsvCell(t.barometricPressure),
      escapeCsvCell(t.iaq),
      escapeCsvCell(t.pm25Standard),
      escapeCsvCell(t.pm100Standard),
      escapeCsvCell(t.co2),
      escapeCsvCell(t.pmVocIdx),
      escapeCsvCell(t.pmNoxIdx),
      escapeCsvCell(t.lightningStrikeCount1h),
      escapeCsvCell(t.lightningDistanceKm),
      ...ADC_CHANNELS.map((ch) => escapeCsvCell(t.adcVoltages?.[ch])),
      ...ADC_CHANNELS.map((ch) => escapeCsvCell(t.oneWireTemperatures?.[ch])),
    ]);
    const rows = [...batteryRows, ...signalRows, ...envRows].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    const csv = [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.join(','))].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `mesh-client-telemetry-${new Date().toISOString().slice(0, 10)}.csv`);
  }, [telemetry, signalTelemetry, environmentTelemetry]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold text-gray-200">{t('telemetryPanel.title')}</h2>
          {showLiveSignalMeter && <SignalMeter rssi={latestSignal?.rssi} snr={latestSignal?.snr} />}
        </div>
        <div className="flex items-center gap-2">
          {showEnvironment && (hasTemp || hasMcuTemp) && (
            <button
              type="button"
              onClick={onToggleFahrenheit}
              title={t('telemetryPanel.toggleTempUnit')}
              className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600"
            >
              {useFahrenheit ? t('telemetryPanel.tempUnitF') : t('telemetryPanel.tempUnitC')}
            </button>
          )}
          {(telemetry.length > 0 ||
            signalTelemetry.length > 0 ||
            environmentTelemetry.length > 0) && (
            <button
              type="button"
              onClick={handleExportCsv}
              {...{ [PARENT_HOVER_ATTR]: '' }}
              className="flex items-center gap-1.5 rounded-lg bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
              title={t('telemetryPanel.exportCsv')}
            >
              <Download aria-hidden className="h-4 w-4" trigger={parentIconTrigger} size={16} />
              {t('telemetryPanel.exportCsvButton')}
            </button>
          )}
          <RefreshButton onRefresh={onRefresh} disabled={!isConnected} minimumAnimationMs={3000} />
        </div>
      </div>

      {telemetry.length === 0 &&
      signalTelemetry.length === 0 &&
      environmentTelemetry.length === 0 &&
      !showPacketStats ? (
        <div className="text-muted py-12 text-center">
          {isConnected
            ? t('telemetryPanel.emptyWaitingConnected')
            : t('telemetryPanel.emptyWaitingDisconnected')}
        </div>
      ) : (
        <>
          {/* Battery / Voltage Chart */}
          {hasBatteryData && (
            <div className="bg-deep-black rounded-lg p-4">
              <h3 className="text-muted mb-3 text-sm font-medium">
                {t('telemetryPanel.sectionBatteryVoltage')}
              </h3>
              <div role="img" aria-label={batteryChartAria}>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 11 }} />
                    <YAxis
                      yAxisId="battery"
                      domain={[0, 100]}
                      stroke="#3b82f6"
                      tick={{ fontSize: 11 }}
                      label={{
                        value: '%',
                        angle: -90,
                        position: 'insideLeft',
                        style: { fill: '#3b82f6' },
                      }}
                    />
                    <YAxis
                      yAxisId="voltage"
                      orientation="right"
                      domain={[3.0, 4.5]}
                      stroke="#8b5cf6"
                      tick={{ fontSize: 11 }}
                      label={{
                        value: 'V',
                        angle: 90,
                        position: 'insideRight',
                        style: { fill: '#8b5cf6' },
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    <Line
                      yAxisId="battery"
                      type="monotone"
                      dataKey="battery"
                      name={t('telemetryPanel.seriesBatteryPct')}
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                    <Line
                      yAxisId="voltage"
                      type="monotone"
                      dataKey="voltage"
                      name={t('telemetryPanel.seriesVoltage')}
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Signal Quality Chart */}
          {hasSignalData && (
            <div className="bg-deep-black rounded-lg p-4">
              <h3 className="text-muted mb-3 text-sm font-medium">
                {t('telemetryPanel.sectionSignalQuality')}
              </h3>
              <div role="img" aria-label={signalChartAria}>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={signalChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 11 }} />
                    <YAxis
                      yAxisId="snr"
                      stroke="#ef4444"
                      tick={{ fontSize: 11 }}
                      label={{
                        value: 'dB',
                        angle: -90,
                        position: 'insideLeft',
                        style: { fill: '#ef4444' },
                      }}
                    />
                    <YAxis
                      yAxisId="rssi"
                      orientation="right"
                      stroke="#f97316"
                      tick={{ fontSize: 11 }}
                      label={{
                        value: 'dBm',
                        angle: 90,
                        position: 'insideRight',
                        style: { fill: '#f97316' },
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    <Line
                      yAxisId="snr"
                      type="monotone"
                      dataKey="snr"
                      name={t('telemetryPanel.seriesSnr')}
                      stroke="#f97316"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                    <Line
                      yAxisId="rssi"
                      type="monotone"
                      dataKey="rssi"
                      name={t('telemetryPanel.seriesRssi')}
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Temperature & Humidity Chart */}
          {showEnvironment && (hasTemp || hasMcuTemp || hasHumidity) && (
            <div className="bg-deep-black rounded-lg p-4">
              <h3 className="text-muted mb-3 text-sm font-medium">
                {t('telemetryPanel.sectionTemperatureHumidity')}
              </h3>
              <div role="img" aria-label={tempHumidityChartAria}>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={envChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 11 }} />
                    {(hasTemp || hasMcuTemp) && (
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
                        background: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    {hasTemp && (
                      <Line
                        yAxisId="temp"
                        type="monotone"
                        dataKey="temperature"
                        name={
                          useFahrenheit
                            ? t('telemetryPanel.seriesTempF')
                            : t('telemetryPanel.seriesTempC')
                        }
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    )}
                    {hasMcuTemp && (
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
                    {hasHumidity && (
                      <Line
                        yAxisId="humidity"
                        type="monotone"
                        dataKey="humidity"
                        name={t('telemetryPanel.seriesHumidityPct')}
                        stroke="#06b6d4"
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Barometric Pressure Chart */}
          {showEnvironment && hasPressure && (
            <div className="bg-deep-black rounded-lg p-4">
              <h3 className="text-muted mb-3 text-sm font-medium">
                {t('telemetryPanel.sectionBarometricPressure')}
              </h3>
              <div role="img" aria-label={pressureChartAria}>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={envChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 11 }} />
                    <YAxis
                      yAxisId="pressure"
                      stroke="#a78bfa"
                      tick={{ fontSize: 11 }}
                      label={{
                        value: 'hPa',
                        angle: -90,
                        position: 'insideLeft',
                        style: { fill: '#a78bfa' },
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    <Line
                      yAxisId="pressure"
                      type="monotone"
                      dataKey="pressure"
                      name={t('telemetryPanel.seriesPressureHpa')}
                      stroke="#a78bfa"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Air Quality (IAQ) Chart */}
          {showEnvironment && hasIaq && (
            <div className="bg-deep-black rounded-lg p-4">
              <h3 className="text-muted mb-3 text-sm font-medium">
                {t('telemetryPanel.sectionAirQuality')}
              </h3>
              <div role="img" aria-label={iaqChartAria}>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={envChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 11 }} />
                    <YAxis
                      yAxisId="iaq"
                      domain={[0, 500]}
                      stroke="#34d399"
                      tick={{ fontSize: 11 }}
                      label={{
                        value: 'IAQ',
                        angle: -90,
                        position: 'insideLeft',
                        style: { fill: '#34d399' },
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
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
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Particulates / CO2 / lightning (SEN5X, SEN6X, SCD4X, AS3935) */}
          {showEnvironment && hasParticulates && (
            <div className="bg-deep-black rounded-lg p-4">
              <h3 className="text-muted mb-3 text-sm font-medium">
                {t('telemetryPanel.sectionParticulates')}
              </h3>
              <div role="img" aria-label={particulateChartAria}>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={envChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 11 }} />
                    <YAxis
                      yAxisId="pm"
                      stroke="#a78bfa"
                      tick={{ fontSize: 11 }}
                      label={{
                        value: t('telemetryPanel.axisParticulates'),
                        angle: -90,
                        position: 'insideLeft',
                        style: { fill: '#a78bfa' },
                      }}
                    />
                    <YAxis
                      yAxisId="co2"
                      orientation="right"
                      stroke="#fbbf24"
                      tick={{ fontSize: 11 }}
                      label={{
                        value: t('telemetryPanel.axisCo2'),
                        angle: 90,
                        position: 'insideRight',
                        style: { fill: '#fbbf24' },
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    <Line
                      yAxisId="pm"
                      type="monotone"
                      dataKey="pm25"
                      name={t('telemetryPanel.seriesPm25')}
                      stroke="#a78bfa"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
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
                    <Line
                      yAxisId="pm"
                      type="monotone"
                      dataKey="lightningStrikes"
                      name={t('telemetryPanel.seriesLightningStrikes')}
                      stroke="#f87171"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* MeshCore Packet Stats Chart */}
          {showPacketStats && (
            <div className="bg-deep-black rounded-lg p-4">
              <h3 className="text-muted mb-3 text-sm font-medium">
                {t('telemetryPanel.sectionPacketsMeshCore')}
              </h3>
              <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                <div className="text-center">
                  <div className="text-2xl font-bold text-cyan-400">{meshcorePacketStats.sent}</div>
                  <div className="text-xs text-gray-500">{t('telemetryPanel.statSent')}</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-400">
                    {meshcorePacketStats.recv}
                  </div>
                  <div className="text-xs text-gray-500">{t('telemetryPanel.statReceived')}</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-cyan-600">
                    {meshcorePacketStats.nSentFlood}
                  </div>
                  <div className="text-xs text-gray-500">{t('telemetryPanel.statFlood')}</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-cyan-600">
                    {meshcorePacketStats.nSentDirect}
                  </div>
                  <div className="text-xs text-gray-500">{t('telemetryPanel.statDirect')}</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-purple-600">
                    {meshcorePacketStats.nRecvFlood}
                  </div>
                  <div className="text-xs text-gray-500">{t('telemetryPanel.statFlood')}</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-purple-600">
                    {meshcorePacketStats.nRecvDirect}
                  </div>
                  <div className="text-xs text-gray-500">{t('telemetryPanel.statDirect')}</div>
                </div>
              </div>
            </div>
          )}

          <div className="text-center text-xs text-gray-600">
            {t('telemetryPanel.footerBattery', { count: telemetry.length })} &nbsp;·&nbsp;{' '}
            {t('telemetryPanel.footerSignal', { count: signalTelemetry.length })}
            {environmentTelemetry.length > 0 && (
              <>
                {' '}
                &nbsp;·&nbsp;{' '}
                {t('telemetryPanel.footerEnv', { count: environmentTelemetry.length })}
              </>
            )}{' '}
            {t('telemetryPanel.footerMax')}
          </div>
        </>
      )}
    </div>
  );
}
