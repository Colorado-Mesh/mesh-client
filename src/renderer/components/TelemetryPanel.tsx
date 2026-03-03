import { useCallback, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { TelemetryPoint } from "../lib/types";
import RefreshButton from "./RefreshButton";

interface Props {
  telemetry: TelemetryPoint[];
  signalTelemetry: TelemetryPoint[];
  onRefresh: () => Promise<void>;
  isConnected: boolean;
}

export default function TelemetryPanel({ telemetry, signalTelemetry, onRefresh, isConnected }: Props) {
  const chartData = useMemo(
    () =>
      telemetry.map((t, i) => ({
        index: i,
        time: new Date(t.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        battery: t.batteryLevel,
        voltage: t.voltage,
      })),
    [telemetry]
  );

  const signalChartData = useMemo(
    () =>
      signalTelemetry.map((t, i) => ({
        index: i,
        time: new Date(t.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        snr: t.snr,
        rssi: t.rssi,
      })),
    [signalTelemetry]
  );

  const hasBatteryData = chartData.some(
    (d) => d.battery !== undefined || d.voltage !== undefined
  );
  const hasSignalData = signalChartData.some(
    (d) => d.snr !== undefined || d.rssi !== undefined
  );

  const handleExportCsv = useCallback(() => {
    if (telemetry.length === 0 && signalTelemetry.length === 0) return;

    function escapeCsvCell(v: string | number | undefined): string {
      const s = String(v ?? "");
      return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }

    const headers = ["timestamp", "type", "battery_level", "voltage", "snr", "rssi"];
    const batteryRows = telemetry.map((t) => [
      escapeCsvCell(new Date(t.timestamp).toISOString()),
      escapeCsvCell("battery"),
      escapeCsvCell(t.batteryLevel),
      escapeCsvCell(t.voltage),
      escapeCsvCell(""),
      escapeCsvCell(""),
    ]);
    const signalRows = signalTelemetry.map((t) => [
      escapeCsvCell(new Date(t.timestamp).toISOString()),
      escapeCsvCell("signal"),
      escapeCsvCell(""),
      escapeCsvCell(""),
      escapeCsvCell(t.snr),
      escapeCsvCell(t.rssi),
    ]);
    const rows = [...batteryRows, ...signalRows].sort((a, b) =>
      a[0].localeCompare(b[0])
    );

    const csv = [
      headers.map(escapeCsvCell).join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mesh-client-telemetry-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [telemetry, signalTelemetry]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-200">Telemetry</h2>
        <div className="flex items-center gap-2">
          {(telemetry.length > 0 || signalTelemetry.length > 0) && (
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium rounded-lg transition-colors"
              title="Export telemetry data as CSV"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </button>
          )}
          <RefreshButton onRefresh={onRefresh} disabled={!isConnected} minimumAnimationMs={3000} />
        </div>
      </div>

      {telemetry.length === 0 && signalTelemetry.length === 0 ? (
        <div className="text-center text-muted py-12">
          No telemetry data yet. Connect to a device to see real-time metrics.
        </div>
      ) : (
        <>
          {/* Battery / Voltage Chart */}
          {hasBatteryData && (
            <div className="bg-deep-black rounded-lg p-4">
              <h3 className="text-sm font-medium text-muted mb-3">
                Battery & Voltage
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="time"
                    stroke="#6b7280"
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    yAxisId="battery"
                    domain={[0, 100]}
                    stroke="#3b82f6"
                    tick={{ fontSize: 11 }}
                    label={{
                      value: "%",
                      angle: -90,
                      position: "insideLeft",
                      style: { fill: "#3b82f6" },
                    }}
                  />
                  <YAxis
                    yAxisId="voltage"
                    orientation="right"
                    domain={[3.0, 4.5]}
                    stroke="#8b5cf6"
                    tick={{ fontSize: 11 }}
                    label={{
                      value: "V",
                      angle: 90,
                      position: "insideRight",
                      style: { fill: "#8b5cf6" },
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#1a202c",
                      border: "1px solid #374151",
                      borderRadius: "8px",
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
              <h3 className="text-sm font-medium text-muted mb-3">
                Signal Quality
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={signalChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="time"
                    stroke="#6b7280"
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    yAxisId="snr"
                    stroke="#ef4444"
                    tick={{ fontSize: 11 }}
                    label={{
                      value: "dB",
                      angle: -90,
                      position: "insideLeft",
                      style: { fill: "#ef4444" },
                    }}
                  />
                  <YAxis
                    yAxisId="rssi"
                    orientation="right"
                    stroke="#f97316"
                    tick={{ fontSize: 11 }}
                    label={{
                      value: "dBm",
                      angle: 90,
                      position: "insideRight",
                      style: { fill: "#f97316" },
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#1a202c",
                      border: "1px solid #374151",
                      borderRadius: "8px",
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

          <div className="text-xs text-gray-600 text-center">
            Battery: {telemetry.length} pts &nbsp;·&nbsp; Signal: {signalTelemetry.length} pts (max 50 each)
          </div>
        </>
      )}
    </div>
  );
}
