import { useCallback, useMemo } from 'react';
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

import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import type { EnvironmentTelemetryPoint, TelemetryPoint } from '../lib/types';
import RefreshButton from './RefreshButton';

function toF(c: number) {
  return (c * 9) / 5 + 32;
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
}: Props) {
  const showEnvironment = capabilities?.hasEnvironmentTelemetry !== false;
  const chartData = useMemo(
    () =>
      telemetry.map((t, i) => ({
        index: i,
        time: new Date(t.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        battery: t.batteryLevel,
        voltage: t.voltage,
      })),
    [telemetry],
  );

  const signalChartData = useMemo(
    () =>
      signalTelemetry.map((t, i) => ({
        index: i,
        time: new Date(t.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        snr: t.snr,
        rssi: t.rssi,
      })),
    [signalTelemetry],
  );

  const hasBatteryData = chartData.some((d) => d.battery !== undefined || d.voltage !== undefined);
  const hasSignalData = signalChartData.some((d) => d.snr !== undefined || d.rssi !== undefined);

  const envChartData = useMemo(
    () =>
      environmentTelemetry.map((t, i) => ({
        index: i,
        time: new Date(t.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        temperature:
          t.temperature !== undefined
            ? useFahrenheit
              ? parseFloat(toF(t.temperature).toFixed(1))
              : parseFloat(t.temperature.toFixed(1))
            : undefined,
        humidity: t.relativeHumidity,
        pressure: t.barometricPressure,
        iaq: t.iaq,
      })),
    [environmentTelemetry, useFahrenheit],
  );

  const hasTemp = envChartData.some((d) => d.temperature !== undefined);
  const hasHumidity = envChartData.some((d) => d.humidity !== undefined);
  const hasPressure = envChartData.some((d) => d.pressure !== undefined);
  const hasIaq = envChartData.some((d) => d.iaq !== undefined);

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
      'env_humidity_pct',
      'env_pressure_hpa',
      'env_iaq',
    ];
    const batteryRows = telemetry.map((t) => [
      escapeCsvCell(new Date(t.timestamp).toISOString()),
      escapeCsvCell('battery'),
      escapeCsvCell(t.batteryLevel),
      escapeCsvCell(t.voltage),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(''),
    ]);
    const signalRows = signalTelemetry.map((t) => [
      escapeCsvCell(new Date(t.timestamp).toISOString()),
      escapeCsvCell('signal'),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(t.snr),
      escapeCsvCell(t.rssi),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(''),
    ]);
    const envRows = environmentTelemetry.map((t) => [
      escapeCsvCell(new Date(t.timestamp).toISOString()),
      escapeCsvCell('environment'),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(t.temperature),
      escapeCsvCell(t.relativeHumidity),
      escapeCsvCell(t.barometricPressure),
      escapeCsvCell(t.iaq),
    ]);
    const rows = [...batteryRows, ...signalRows, ...envRows].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    const csv = [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.join(','))].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mesh-client-telemetry-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [telemetry, signalTelemetry, environmentTelemetry]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-200">Telemetry</h2>
        <div className="flex items-center gap-2">
          {showEnvironment && hasTemp && (
            <button
              onClick={onToggleFahrenheit}
              title="Toggle temperature unit"
              className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600"
            >
              {useFahrenheit ? '°F' : '°C'}
            </button>
          )}
          {(telemetry.length > 0 ||
            signalTelemetry.length > 0 ||
            environmentTelemetry.length > 0) && (
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 rounded-lg bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
              title="Export telemetry data as CSV"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Export CSV
            </button>
          )}
          <RefreshButton onRefresh={onRefresh} disabled={!isConnected} minimumAnimationMs={3000} />
        </div>
      </div>

      {telemetry.length === 0 &&
      signalTelemetry.length === 0 &&
      environmentTelemetry.length === 0 ? (
        <div className="text-muted py-12 text-center">
          {isConnected
            ? 'No telemetry data yet. Waiting for data from device…'
            : 'No telemetry data yet. Connect to a device to see real-time metrics.'}
        </div>
      ) : (
        <>
          {/* Battery / Voltage Chart */}
          {hasBatteryData && (
            <div className="bg-deep-black rounded-lg p-4">
              <h3 className="text-muted mb-3 text-sm font-medium">Battery & Voltage</h3>
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
                      background: '#1a202c',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  <Line
                    yAxisId="battery"
                    type="monotone"
                    dataKey="battery"
                    name="Battery %"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <Line
                    yAxisId="voltage"
                    type="monotone"
                    dataKey="voltage"
                    name="Voltage"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Signal Quality Chart */}
          {hasSignalData && (
            <div className="bg-deep-black rounded-lg p-4">
              <h3 className="text-muted mb-3 text-sm font-medium">Signal Quality</h3>
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
                      background: '#1a202c',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  <Line
                    yAxisId="snr"
                    type="monotone"
                    dataKey="snr"
                    name="SNR"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <Line
                    yAxisId="rssi"
                    type="monotone"
                    dataKey="rssi"
                    name="RSSI"
                    stroke="#f97316"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Temperature & Humidity Chart */}
          {showEnvironment && (hasTemp || hasHumidity) && (
            <div className="bg-deep-black rounded-lg p-4">
              <h3 className="text-muted mb-3 text-sm font-medium">
                Temperature {hasHumidity ? '& Humidity' : ''}
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={envChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 11 }} />
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
                      background: '#1a202c',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  {hasTemp && (
                    <Line
                      yAxisId="temp"
                      type="monotone"
                      dataKey="temperature"
                      name={useFahrenheit ? 'Temp °F' : 'Temp °C'}
                      stroke="#f59e0b"
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
                      name="Humidity %"
                      stroke="#06b6d4"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Barometric Pressure Chart */}
          {showEnvironment && hasPressure && (
            <div className="bg-deep-black rounded-lg p-4">
              <h3 className="text-muted mb-3 text-sm font-medium">Barometric Pressure</h3>
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
                      background: '#1a202c',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  <Line
                    yAxisId="pressure"
                    type="monotone"
                    dataKey="pressure"
                    name="Pressure hPa"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Air Quality (IAQ) Chart */}
          {showEnvironment && hasIaq && (
            <div className="bg-deep-black rounded-lg p-4">
              <h3 className="text-muted mb-3 text-sm font-medium">Air Quality (IAQ)</h3>
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
                      background: '#1a202c',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  <Line
                    yAxisId="iaq"
                    type="monotone"
                    dataKey="iaq"
                    name="IAQ (0–500)"
                    stroke="#34d399"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="text-center text-xs text-gray-600">
            Battery: {telemetry.length} pts &nbsp;·&nbsp; Signal: {signalTelemetry.length} pts
            {environmentTelemetry.length > 0 && (
              <> &nbsp;·&nbsp; Env: {environmentTelemetry.length} pts</>
            )}{' '}
            (max 50 each)
          </div>
        </>
      )}
    </div>
  );
}
