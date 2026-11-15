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

import {
  environmentReadingCsvCells,
  environmentTelemetryCsvHeaders,
} from '@/renderer/lib/environmentTelemetryChart';
import { formatDisplayTime } from '@/renderer/lib/formatDisplayTime';
import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import { resolveIdentityIdForProtocol } from '@/renderer/lib/identityByProtocol';
import {
  selectEnvironmentNodes,
  useEnvironmentTelemetryStore,
} from '@/renderer/stores/environmentTelemetryStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';

import { downloadBlob } from '../lib/downloadBlob';
import { meshcoreFloodSendPercent } from '../lib/meshcore/meshcoreFloodSendPercent';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import type {
  EnvironmentTelemetryPoint,
  MeshCoreLocalStats,
  MeshNode,
  TelemetryPoint,
} from '../lib/types';
import { useTimeFormatStore } from '../stores/timeFormatStore';
import CayenneTelemetrySection from './CayenneTelemetrySection';
import EnvironmentTelemetryCharts from './EnvironmentTelemetryCharts';
import { HelpTooltip } from './HelpTooltip';
import RefreshButton from './RefreshButton';
import SignalMeter from './SignalMeter';

const SIGNAL_SNR_COLOR = 'var(--color-orange-400)';
const SIGNAL_RSSI_COLOR = 'var(--color-blue-400)';

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
  /** Session stream kept for CSV merge; charts read the persisted store. */
  environmentTelemetry: EnvironmentTelemetryPoint[];
  useFahrenheit: boolean;
  onToggleFahrenheit: () => void;
  onRefresh: () => Promise<void>;
  isConnected: boolean;
  /** Protocol capabilities — hides environment section when not supported. */
  capabilities?: ProtocolCapabilities;
  /** Connected radio node id (default sensor selection). */
  myNodeNum?: number | null;
  /** Node lookup for sensor selector labels. */
  nodesById?: ReadonlyMap<number, MeshNode>;
  /** MeshCore: request sensor telemetry for a contact. */
  onRequestSensorTelemetry?: (nodeId: number) => void;
  /** MeshCore packet stats for packets chart */
  meshcorePacketStats?: Pick<
    MeshCoreLocalStats,
    'sent' | 'recv' | 'nSentFlood' | 'nSentDirect' | 'nRecvFlood' | 'nRecvDirect'
  > | null;
}

export default function TelemetryPanel({
  telemetry,
  signalTelemetry,
  useFahrenheit,
  onToggleFahrenheit,
  onRefresh,
  isConnected,
  capabilities,
  myNodeNum,
  nodesById,
  onRequestSensorTelemetry,
  meshcorePacketStats,
}: Props) {
  const { t } = useTranslation();
  const parentIconTrigger = useParentIconTrigger();
  const use24HourTime = useTimeFormatStore((s) => s.use24HourTime);
  const protocol = capabilities?.protocol ?? 'meshtastic';
  const showEnvironment = capabilities?.hasEnvironmentTelemetry !== false;
  const showPacketStats = capabilities?.hasRfStats === true && meshcorePacketStats != null;
  const identityId = useIdentityStore((s) =>
    resolveIdentityIdForProtocol(s.identities, s.activeIdentityId, protocol),
  );
  const envNodes = useEnvironmentTelemetryStore((s) =>
    selectEnvironmentNodes(s, protocol, identityId),
  );
  const hasEnvHistory = envNodes.size > 0;

  const chartData = useMemo(
    () =>
      telemetry.map((pt, i) => ({
        index: i,
        time: formatDisplayTime(pt.timestamp, { withSeconds: true, use24Hour: use24HourTime }),
        battery: pt.batteryLevel,
        voltage: pt.voltage,
      })),
    [telemetry, use24HourTime],
  );

  const signalChartData = useMemo(
    () =>
      signalTelemetry.map((pt, i) => ({
        index: i,
        time: formatDisplayTime(pt.timestamp, { withSeconds: true, use24Hour: use24HourTime }),
        snr: pt.snr,
        rssi: pt.rssi,
      })),
    [signalTelemetry, use24HourTime],
  );

  const hasBatteryData = chartData.some((d) => d.battery !== undefined || d.voltage !== undefined);
  const hasSignalData = signalChartData.some((d) => d.snr !== undefined || d.rssi !== undefined);
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

  const handleExportCsv = useCallback(() => {
    if (telemetry.length === 0 && signalTelemetry.length === 0 && !hasEnvHistory) return;

    function escapeCsvCell(v: string | number | undefined): string {
      const s = String(v ?? '');
      return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }

    const headers = environmentTelemetryCsvHeaders();
    const envColCount = headers.length - 7;
    const envPadding = Array.from({ length: envColCount }, () => '');
    const batteryRows = telemetry.map((pt) => [
      escapeCsvCell(new Date(pt.timestamp).toISOString()),
      escapeCsvCell('battery'),
      escapeCsvCell(''),
      escapeCsvCell(pt.batteryLevel),
      escapeCsvCell(pt.voltage),
      escapeCsvCell(''),
      escapeCsvCell(''),
      ...envPadding,
    ]);
    const signalRows = signalTelemetry.map((pt) => [
      escapeCsvCell(new Date(pt.timestamp).toISOString()),
      escapeCsvCell('signal'),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(''),
      escapeCsvCell(pt.snr),
      escapeCsvCell(pt.rssi),
      ...envPadding,
    ]);
    const envRows: string[][] = [];
    for (const [nodeId, series] of envNodes) {
      for (const p of series) {
        const reading = p.reading;
        envRows.push([
          escapeCsvCell(new Date(p.t).toISOString()),
          escapeCsvCell('environment'),
          escapeCsvCell(nodeId),
          escapeCsvCell(''),
          escapeCsvCell(''),
          escapeCsvCell(''),
          escapeCsvCell(''),
          ...environmentReadingCsvCells(reading, escapeCsvCell),
        ]);
      }
    }
    const rows = [...batteryRows, ...signalRows, ...envRows].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    const csv = [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.join(','))].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `mesh-client-telemetry-${new Date().toISOString().slice(0, 10)}.csv`);
  }, [telemetry, signalTelemetry, envNodes, hasEnvHistory]);

  return (
    <div data-panel-anchor="Telemetry" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-ink-200 text-xl font-semibold">{t('telemetryPanel.title')}</h2>
          {showLiveSignalMeter && <SignalMeter rssi={latestSignal?.rssi} snr={latestSignal?.snr} />}
        </div>
        <div className="flex items-center gap-2">
          {showEnvironment ? (
            <button
              type="button"
              onClick={onToggleFahrenheit}
              data-setting-anchor="telemetry.display.temperatureUnit"
              title={t('telemetryPanel.toggleTempUnit')}
              className="bg-ink-700 text-ink-300 hover:bg-ink-600 rounded px-2 py-1 text-xs"
            >
              {useFahrenheit ? t('telemetryPanel.tempUnitF') : t('telemetryPanel.tempUnitC')}
            </button>
          ) : null}
          {(telemetry.length > 0 || signalTelemetry.length > 0 || hasEnvHistory) && (
            <button
              type="button"
              onClick={handleExportCsv}
              data-setting-anchor="telemetry.data.exportCsv"
              {...{ [PARENT_HOVER_ATTR]: '' }}
              className="bg-ink-700 text-ink-300 hover:bg-ink-600 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
              title={t('telemetryPanel.exportCsv')}
            >
              <Download aria-hidden className="h-4 w-4" trigger={parentIconTrigger} size={16} />
              {t('telemetryPanel.exportCsvButton')}
            </button>
          )}
          <RefreshButton onRefresh={onRefresh} disabled={!isConnected} minimumAnimationMs={3000} />
        </div>
      </div>
      {showEnvironment && capabilities?.hasRepeaterStatus !== true ? (
        <p className="text-muted text-xs" data-testid="meshtastic-refresh-help">
          {t('telemetryPanel.meshtasticRefreshHelp')}
        </p>
      ) : null}

      {telemetry.length === 0 &&
      signalTelemetry.length === 0 &&
      !hasEnvHistory &&
      !showPacketStats &&
      !showEnvironment ? (
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#364156" />
                    <XAxis dataKey="time" stroke="#65738c" tick={{ fontSize: 11 }} />
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
                        background: '#19212d',
                        border: '1px solid #364156',
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#364156" />
                    <XAxis dataKey="time" stroke="#65738c" tick={{ fontSize: 11 }} />
                    <YAxis
                      yAxisId="snr"
                      stroke={SIGNAL_SNR_COLOR}
                      tick={{ fontSize: 11 }}
                      label={{
                        value: 'dB',
                        angle: -90,
                        position: 'insideLeft',
                        style: { fill: SIGNAL_SNR_COLOR },
                      }}
                    />
                    <YAxis
                      yAxisId="rssi"
                      orientation="right"
                      stroke={SIGNAL_RSSI_COLOR}
                      tick={{ fontSize: 11 }}
                      label={{
                        value: 'dBm',
                        angle: 90,
                        position: 'insideRight',
                        style: { fill: SIGNAL_RSSI_COLOR },
                      }}
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
                      yAxisId="snr"
                      type="monotone"
                      dataKey="snr"
                      name={t('telemetryPanel.seriesSnr')}
                      stroke={SIGNAL_SNR_COLOR}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                    <Line
                      yAxisId="rssi"
                      type="monotone"
                      dataKey="rssi"
                      name={t('telemetryPanel.seriesRssi')}
                      stroke={SIGNAL_RSSI_COLOR}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {showEnvironment ? (
            <EnvironmentTelemetryCharts
              protocol={protocol}
              capabilities={capabilities}
              useFahrenheit={useFahrenheit}
              myNodeNum={myNodeNum}
              nodesById={nodesById}
              onRequestSensorTelemetry={onRequestSensorTelemetry}
              isConnected={isConnected}
            />
          ) : null}

          {/* MeshCore Packet Stats Chart */}
          {showPacketStats && (
            <div className="bg-deep-black rounded-lg p-4">
              <h3 className="text-muted mb-3 text-sm font-medium">
                {t('telemetryPanel.sectionPacketsMeshCore')}
              </h3>
              <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                <div className="text-center">
                  <div className="text-2xl font-semibold text-cyan-400">
                    {meshcorePacketStats.sent}
                  </div>
                  <div className="text-muted text-xs">{t('telemetryPanel.statSent')}</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-semibold text-purple-400">
                    {meshcorePacketStats.recv}
                  </div>
                  <div className="text-muted text-xs">{t('telemetryPanel.statReceived')}</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-cyan-600">
                    {meshcorePacketStats.nSentFlood}
                  </div>
                  <div className="text-muted text-xs">{t('telemetryPanel.statFlood')}</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-cyan-600">
                    {meshcorePacketStats.nSentDirect}
                  </div>
                  <div className="text-muted text-xs">{t('telemetryPanel.statDirect')}</div>
                </div>
                {(() => {
                  const floodPct = meshcoreFloodSendPercent(
                    meshcorePacketStats.nSentFlood,
                    meshcorePacketStats.nSentDirect,
                  );
                  if (floodPct === null) return null;
                  return (
                    <div className="text-center">
                      <div className="text-lg font-semibold text-cyan-600">{floodPct}%</div>
                      <div className="text-muted inline-flex items-center justify-center gap-1 text-xs">
                        <span>{t('telemetryPanel.statFloodPercent')}</span>
                        <HelpTooltip
                          text={t('telemetryPanel.statFloodPercentHint')}
                          ariaLabel={t('telemetryPanel.statFloodPercentHintAria')}
                        />
                      </div>
                    </div>
                  );
                })()}
                <div className="text-center">
                  <div className="text-lg font-semibold text-purple-600">
                    {meshcorePacketStats.nRecvFlood}
                  </div>
                  <div className="text-muted text-xs">{t('telemetryPanel.statFlood')}</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-purple-600">
                    {meshcorePacketStats.nRecvDirect}
                  </div>
                  <div className="text-muted text-xs">{t('telemetryPanel.statDirect')}</div>
                </div>
              </div>
            </div>
          )}

          <div className="text-ink-600 text-center text-xs">
            {t('telemetryPanel.footerBattery', { count: telemetry.length })} &nbsp;·&nbsp;{' '}
            {t('telemetryPanel.footerSignal', { count: signalTelemetry.length })}
            {hasEnvHistory ? (
              <>
                {' '}
                &nbsp;·&nbsp;{' '}
                {t('telemetryPanel.footerEnv', {
                  count: [...envNodes.values()].reduce((n, s) => n + s.length, 0),
                })}
              </>
            ) : null}
          </div>
        </>
      )}

      {/* Cayenne LPP sensor charts (Meshtastic CAYENNE_APP; hidden when capability/data absent). */}
      <CayenneTelemetrySection capabilities={capabilities} />
    </div>
  );
}
