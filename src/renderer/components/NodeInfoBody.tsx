import { useState } from 'react';

import { getRecommendedAction } from '../lib/diagnostics/RemediationEngine';
import {
  diagnoseConnectedNode,
  diagnoseOtherNode,
  hasLocalStatsData,
  type RFDiagnosis,
} from '../lib/diagnostics/RFDiagnosticEngine';
import { RoleDisplay } from '../lib/roleInfo';
import type { HopHistoryPoint, MeshNode } from '../lib/types';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';

export const CATEGORY_STYLES: Record<string, string> = {
  Configuration: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  Physical: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  Hardware: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
  Software: 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30',
};

const EMPTY_HOP_HISTORY: HopHistoryPoint[] = [];

export function formatTime(ts: number): string {
  if (!ts) return 'Never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

export function InfoRow({
  label,
  value,
  className,
}: {
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-700/50 last:border-b-0">
      <span className="text-sm text-muted">{label}</span>
      <span className={`text-sm font-medium ${className || 'text-gray-200'}`}>{value}</span>
    </div>
  );
}

export interface NodeInfoBodyProps {
  node: MeshNode;
  homeNode?: MeshNode | null;
  traceRouteHops?: string[];
}

const SEVERITY_STYLES: Record<RFDiagnosis['severity'], string> = {
  warning: 'text-orange-400',
  info: 'text-blue-400',
};

const SEVERITY_ICON: Record<RFDiagnosis['severity'], string> = {
  warning: '⚠',
  info: 'ℹ',
};

export default function NodeInfoBody({ node, homeNode, traceRouteHops }: NodeInfoBodyProps) {
  const anomaly = useDiagnosticsStore((s) => s.anomalies.get(node.node_id));
  const nodePacketStats = useDiagnosticsStore((s) => s.packetStats.get(node.node_id));
  const hopHistory = useDiagnosticsStore(
    (s) => s.hopHistory.get(node.node_id) ?? EMPTY_HOP_HISTORY,
  );
  const nodeRedundancy = useDiagnosticsStore((s) => s.nodeRedundancy.get(node.node_id));
  const [pathHistoryOpen, setPathHistoryOpen] = useState(false);

  const batteryColor =
    node.battery > 50
      ? 'text-bright-green'
      : node.battery > 20
        ? 'text-yellow-400'
        : node.battery > 0
          ? 'text-red-400'
          : 'text-muted';

  const snrColor =
    node.snr > 5
      ? 'text-bright-green'
      : node.snr > 0
        ? 'text-yellow-400'
        : node.snr !== 0
          ? 'text-red-400'
          : 'text-muted';

  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
  const recentHour = hopHistory.filter((p) => p.t >= oneHourAgo);
  const recentHistory = hopHistory.filter((p) => p.t >= twentyFourHoursAgo);
  const hasSparkline = recentHistory.length >= 2;

  let hopChanges = 0;
  for (let i = 1; i < recentHour.length; i++) {
    if (recentHour[i].h !== recentHour[i - 1].h) hopChanges++;
  }
  const stability =
    recentHour.length < 2
      ? 'Unknown'
      : hopChanges === 0
        ? 'Stable'
        : hopChanges <= 2
          ? 'Moderate'
          : 'Unstable';
  const stabilityColor =
    stability === 'Stable'
      ? 'text-brand-green'
      : stability === 'Moderate'
        ? 'text-yellow-400'
        : stability === 'Unknown'
          ? 'text-muted'
          : 'text-red-400';

  const offenseSummary = anomaly
    ? anomaly.type === 'hop_goblin'
      ? 'Node is over-hopping for its distance or signal strength'
      : anomaly.type === 'bad_route'
        ? 'Possible routing loop — high packet duplication detected'
        : anomaly.type === 'route_flapping'
          ? 'Route is unstable — hop count changing frequently'
          : 'Reported as 0 hops but GPS data suggests otherwise'
    : null;

  return (
    <>
      {/* Names */}
      {node.long_name && <InfoRow label="Long Name" value={node.long_name} />}
      {node.short_name && <InfoRow label="Short Name" value={node.short_name} />}

      {/* Role */}
      <div className="flex justify-between items-center py-2 border-b border-gray-700/50">
        <span className="text-sm text-muted">Role</span>
        <RoleDisplay role={node.role} />
      </div>

      {/* Signal */}
      <InfoRow
        label="SNR"
        value={node.snr != null && node.snr !== 0 ? `${node.snr.toFixed(1)} dB` : '—'}
        className={snrColor}
      />

      {/* Battery */}
      <div className="flex justify-between items-center py-2 border-b border-gray-700/50">
        <span className="text-sm text-muted">Battery</span>
        <div className="flex items-center gap-2">
          {node.battery > 0 && (
            <div className="w-16 h-2 bg-secondary-dark rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  node.battery > 50
                    ? 'bg-brand-green'
                    : node.battery > 20
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                }`}
                style={{ width: `${Math.min(node.battery, 100)}%` }}
              />
            </div>
          )}
          <span className={`text-sm font-medium ${batteryColor}`}>
            {node.battery > 0 ? `${node.battery}%` : '—'}
          </span>
        </div>
      </div>

      {/* Timing */}
      <InfoRow label="Last Heard" value={formatTime(node.last_heard)} />

      {/* Location */}
      {node.latitude != null &&
        node.longitude != null &&
        (node.latitude !== 0 || node.longitude !== 0) && (
          <InfoRow
            label="Position"
            value={`${node.latitude.toFixed(5)}, ${node.longitude.toFixed(5)}`}
            className="text-gray-300 font-mono text-xs"
          />
        )}

      {/* GPS warning */}
      {node.lastPositionWarning && node.latitude === 0 && node.longitude === 0 && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 mt-1 rounded bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs">
          <span>⚠</span>
          <span>GPS Warning: {node.lastPositionWarning}</span>
        </div>
      )}

      {/* Routing Health */}
      <div className="mt-3 p-3 bg-primary-dark rounded-lg">
        <div className="text-xs text-gray-400 mb-1.5">Routing Health</div>

        {/* Remedy badge */}
        {(() => {
          const remedy = getRecommendedAction(node, homeNode ?? null, nodePacketStats);
          if (!remedy) return null;
          return (
            <div
              className={`flex items-start gap-2 p-2 mb-2 rounded-lg text-xs border ${CATEGORY_STYLES[remedy.category]}`}
            >
              <span className="font-semibold shrink-0">{remedy.category}</span>
              <span>{remedy.title}</span>
            </div>
          );
        })()}

        {/* Offense */}
        {anomaly ? (
          <div
            className={`flex items-start gap-1.5 text-xs ${
              anomaly.severity === 'error' ? 'text-red-400' : 'text-orange-400'
            }`}
          >
            <svg
              className="w-3.5 h-3.5 shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <div className="font-medium mb-0.5">{offenseSummary}</div>
              <div className="text-gray-400">{anomaly.description}</div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-brand-green">No routing issues detected</div>
        )}

        {/* Stability metric */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700/50">
          <span className="text-[10px] text-gray-500">Route stability (1h)</span>
          <span className={`text-xs font-medium ${stabilityColor}`}>
            {stability}
            {recentHour.length >= 2 && hopChanges > 0 && (
              <span className="text-gray-500 font-normal ml-1">
                ({hopChanges} change{hopChanges !== 1 ? 's' : ''})
              </span>
            )}
          </span>
        </div>

        {hasSparkline &&
          (() => {
            const minH = Math.min(...recentHistory.map((p) => p.h));
            const maxH = Math.max(...recentHistory.map((p) => p.h));
            const range = maxH - minH || 1;
            const minT = recentHistory[0].t;
            const maxT = recentHistory[recentHistory.length - 1].t;
            const timeRange = maxT - minT || 1;
            const points = recentHistory
              .map((p) => {
                const x = ((p.t - minT) / timeRange) * 200;
                const y = 40 - ((p.h - minH) / range) * 36 - 2;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(' ');
            return (
              <div className="mt-2">
                <div className="text-[10px] text-gray-500 mb-0.5">Hop count — 24h</div>
                <svg viewBox="0 0 200 40" className="w-full h-8 text-brand-green/60">
                  <polyline
                    points={points}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            );
          })()}

        {/* Connection Health (packet redundancy) — only shown once echoes have been observed */}
        {nodeRedundancy && nodeRedundancy.maxPaths > 1 && (
          <div
            className="mt-2 pt-2 border-t border-gray-700/50"
            title="Based on same packet received via multiple paths (e.g. RF + MQTT or multiple RF receptions)."
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-500">Connection Health</span>
              <span
                className={`text-xs font-medium ${
                  nodeRedundancy.score >= 67
                    ? 'text-lime-400'
                    : nodeRedundancy.score >= 33
                      ? 'text-yellow-400'
                      : 'text-muted'
                }`}
              >
                {nodeRedundancy.score}%
                {nodeRedundancy.maxPaths >= 3 && (
                  <span className="ml-1 text-[10px] text-lime-400/80">Highly Redundant</span>
                )}
              </span>
            </div>

            {/* Path History toggle — only shown when there are echoes to display */}
            {(() => {
              const totalEchoes = nodeRedundancy.recentPackets.reduce(
                (s, r) => s + r.paths.length - 1,
                0,
              );
              const echoPackets = nodeRedundancy.recentPackets.filter((r) => r.paths.length > 1);
              if (totalEchoes === 0) return null;
              return (
                <div className="mt-1.5">
                  <button
                    onClick={() => setPathHistoryOpen((o) => !o)}
                    className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
                  >
                    <span>{pathHistoryOpen ? '▾' : '▸'}</span>
                    Path History ({totalEchoes} echo{totalEchoes !== 1 ? 'es' : ''})
                  </button>

                  {pathHistoryOpen && (
                    <div className="mt-1.5 flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                      {echoPackets.map((rec) => (
                        <div
                          key={rec.packetId}
                          className="text-[10px] bg-deep-black/50 rounded p-1.5"
                        >
                          <div className="text-gray-400 mb-0.5 font-mono">
                            #{rec.packetId.toString(16).toUpperCase()} — {rec.paths.length} paths
                          </div>
                          {rec.paths.map((p, i) => (
                            <div key={i} className="text-gray-500 pl-1.5 leading-tight">
                              {i === 0 ? 'Original' : `Echo ${i}`}:{' '}
                              <span
                                className={
                                  p.transport === 'rf' ? 'text-brand-green/80' : 'text-blue-400/80'
                                }
                              >
                                {p.transport.toUpperCase()}
                              </span>
                              {p.snr != null && (
                                <span className="ml-1">
                                  SNR {p.snr > 0 ? '+' : ''}
                                  {p.snr.toFixed(1)} dB
                                </span>
                              )}
                              {p.rssi != null && <span className="ml-1">{p.rssi} dBm</span>}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Trace route result */}
      {traceRouteHops && (
        <div className="mt-3 p-2 bg-primary-dark rounded-lg">
          <div className="text-xs text-gray-400 mb-1">Route Path</div>
          <div className="text-sm text-gray-200 flex flex-wrap items-center gap-1">
            {traceRouteHops.map((hop, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-gray-500">→</span>}
                <span
                  className={
                    i === 0 || i === traceRouteHops.length - 1
                      ? 'text-green-400 font-medium'
                      : 'text-gray-200'
                  }
                >
                  {hop}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* RF Diagnostics */}
      <RFDiagnosticsSection node={node} isOurNode={node.node_id === homeNode?.node_id} />
    </>
  );
}

function RFDiagnosticsSection({ node, isOurNode }: { node: MeshNode; isOurNode: boolean }) {
  let findings: RFDiagnosis[] | null;
  let totalChecks: number | null = null;
  let noTelemetry = false;

  if (isOurNode) {
    findings = diagnoseConnectedNode(node);
    totalChecks = 7;
    // If no LocalStats and no channel_utilization, we have no data at all
    if (!hasLocalStatsData(node) && node.channel_utilization == null) {
      noTelemetry = true;
    }
  } else {
    findings = diagnoseOtherNode(node);
    if (findings === null) noTelemetry = true;
  }

  const flagged = findings?.length ?? 0;

  return (
    <div className="mt-3 p-3 bg-primary-dark rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-gray-400">RF Diagnostics</div>
        {!noTelemetry && totalChecks !== null && (
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
              flagged === 0 ? 'bg-green-900/40 text-green-400' : 'bg-orange-900/40 text-orange-400'
            }`}
          >
            {flagged}/{totalChecks} flagged
          </span>
        )}
      </div>

      {noTelemetry ? (
        <div className="text-xs text-muted">No node telemetry. Node diagnostics unavailable.</div>
      ) : flagged === 0 ? (
        <div className="text-xs text-brand-green">All RF diagnostics OK</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {findings!.map((f, i) => (
            <div
              key={i}
              className={`flex items-start gap-1.5 text-xs ${SEVERITY_STYLES[f.severity]}`}
            >
              <span className="shrink-0 mt-0.5">{SEVERITY_ICON[f.severity]}</span>
              <div>
                <span className="font-semibold">{f.condition}</span>
                <span className="text-gray-400 ml-1">— {f.cause}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
