import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  diagnosticRowsToRoutingMap,
  meshHasRoutingAnomaliesFromRows,
} from '../lib/diagnostics/diagnosticRows';
import {
  MESH_ROUTING_ANOMALY_LINE,
  meshCongestionDetailLines,
  summarizeMeshCongestionAttribution,
  summarizeRfDuplicateOriginators,
} from '../lib/diagnostics/meshCongestionAttribution';
import {
  getRecommendedAction,
  getRecommendedActionForRfCondition,
} from '../lib/diagnostics/RemediationEngine';
import { diagnoseConnectedNode, hasLocalStatsData } from '../lib/diagnostics/RFDiagnosticEngine';
import type { OurPosition } from '../lib/gpsSource';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../lib/timeConstants';
import type { DiagnosticRow, MeshNode } from '../lib/types';
import { routingRowToNodeAnomaly } from '../lib/types';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import MeshCongestionAttributionBlock from './MeshCongestionAttributionBlock';

const CATEGORY_STYLES: Record<string, string> = {
  Configuration: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  Physical: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  Hardware: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
  Software: 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30',
};

const TRACE_TIMEOUT_MS = 30_000;

interface Props {
  nodes: Map<number, MeshNode>;
  myNodeNum: number;
  onTraceRoute: (nodeNum: number) => Promise<void>;
  isConnected: boolean;
  traceRouteResults: Map<number, { route: number[]; from: number; timestamp: number }>;
  getFullNodeLabel: (nodeNum: number) => string;
  ourPosition?: OurPosition | null;
  /** When set, clicking an anomaly row opens the node detail modal (same as NodeListPanel). */
  onNodeClick?: (node: MeshNode) => void;
  /** Protocol capabilities — controls which sections are shown (MQTT controls hidden for MeshCore). */
  capabilities?: ProtocolCapabilities;
}

function AlertTriangleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
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
  );
}

function InfoCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function formatTime(ts: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < MS_PER_MINUTE) return 'Just now';
  if (diff < MS_PER_HOUR) return `${Math.floor(diff / MS_PER_MINUTE)}m ago`;
  if (diff < MS_PER_DAY) return `${Math.floor(diff / MS_PER_HOUR)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function DiagnosticsPanel({
  nodes,
  myNodeNum,
  onTraceRoute,
  isConnected,
  traceRouteResults,
  getFullNodeLabel,
  ourPosition,
  onNodeClick,
  capabilities,
}: Props) {
  const showMqttControls = capabilities?.hasMqttHybrid !== false;
  const diagnosticRows = useDiagnosticsStore((s) => s.diagnosticRows);
  const diagnosticRowsRestoredAt = useDiagnosticsStore((s) => s.diagnosticRowsRestoredAt);
  const clearDiagnosticRowsSnapshot = useDiagnosticsStore((s) => s.clearDiagnosticRowsSnapshot);
  const routingAnomaliesMap = useMemo(
    () => diagnosticRowsToRoutingMap(diagnosticRows),
    [diagnosticRows],
  );
  const packetStats = useDiagnosticsStore((s) => s.packetStats);
  const packetCache = useDiagnosticsStore((s) => s.packetCache);
  const getCuStats24h = useDiagnosticsStore((s) => s.getCuStats24h);
  const homeNode = nodes.get(myNodeNum) ?? null;
  const congestionHalosEnabled = useDiagnosticsStore((s) => s.congestionHalosEnabled);
  const setCongestionHalosEnabled = useDiagnosticsStore((s) => s.setCongestionHalosEnabled);
  const anomalyHalosEnabled = useDiagnosticsStore((s) => s.anomalyHalosEnabled);
  const setAnomalyHalosEnabled = useDiagnosticsStore((s) => s.setAnomalyHalosEnabled);
  const ignoreMqttEnabled = useDiagnosticsStore((s) => s.ignoreMqttEnabled);
  const setIgnoreMqttEnabled = useDiagnosticsStore((s) => s.setIgnoreMqttEnabled);
  const mqttIgnoredNodes = useDiagnosticsStore((s) => s.mqttIgnoredNodes);
  const setNodeMqttIgnored = useDiagnosticsStore((s) => s.setNodeMqttIgnored);
  const envMode = useDiagnosticsStore((s) => s.envMode);
  const setEnvMode = useDiagnosticsStore((s) => s.setEnvMode);
  const diagnosticRowsMaxAgeHours = useDiagnosticsStore((s) => s.diagnosticRowsMaxAgeHours);
  const setDiagnosticRowsMaxAgeHours = useDiagnosticsStore((s) => s.setDiagnosticRowsMaxAgeHours);
  const getForeignLoraDetectionsList = useDiagnosticsStore((s) => s.getForeignLoraDetectionsList);

  const [search, setSearch] = useState('');
  const [tracePending, setTracePending] = useState<number | null>(null);
  const [traceFailed, setTraceFailed] = useState<Set<number>>(new Set());
  const traceStartTimes = useRef<Map<number, number>>(new Map());
  const traceTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Detect when a trace result arrives for the pending node
  useEffect(() => {
    if (tracePending === null) return;
    const result = traceRouteResults.get(tracePending);
    const startTime = traceStartTimes.current.get(tracePending);
    if (result && startTime !== undefined && result.timestamp >= startTime) {
      const timer = traceTimers.current.get(tracePending);
      if (timer) clearTimeout(timer);
      traceTimers.current.delete(tracePending);
      setTracePending(null);
    }
  }, [traceRouteResults, tracePending]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = traceTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  /**
   * Match Node List Ch.Util / Air Tx columns: count nodes where at least one is non-null
   * (same gate as diagnoseOtherNode). Hop/cu store maps count nodes with any hop sample and
   * inflate vs list; connected node with LocalStats only still counts if no CU/air_util.
   */
  const nodesWithTelemetryCount = useMemo(() => {
    let n = 0;
    for (const node of nodes.values()) {
      const hasCuOrAir = node.channel_utilization != null || node.air_util_tx != null;
      const isConnectedWithLocalStats = node.node_id === myNodeNum && hasLocalStatsData(node);
      if (hasCuOrAir || isConnectedWithLocalStats) n++;
    }
    return n;
  }, [nodes, myNodeNum]);

  /** Routing error rows — red/Degraded only when count is high enough to avoid alarm on small meshes. */
  const DEGRADED_ERROR_THRESHOLD = 3;

  /** Mesh-wide status from absolute counts only (no node-percentage; scales to large meshes). */
  const meshHealth = useMemo(() => {
    const errors = diagnosticRows.filter(
      (r) => r.kind === 'routing' && r.severity === 'error',
    ).length;
    const warnings =
      diagnosticRows.filter((r) => r.kind === 'routing' && r.severity === 'warning').length +
      diagnosticRows.filter((r) => r.kind === 'rf' && r.severity === 'warning').length;
    if (errors >= DEGRADED_ERROR_THRESHOLD) {
      return {
        status: 'degraded' as const,
        label: 'Degraded',
        textColor: 'text-red-400',
        bg: 'bg-red-500/10 border-red-500/30',
      };
    }
    if (errors > 0 || warnings > 0) {
      return {
        status: 'attention' as const,
        label: 'Attention',
        textColor: 'text-yellow-400',
        bg: 'bg-yellow-500/10 border-yellow-500/30',
      };
    }
    return {
      status: 'healthy' as const,
      label: 'Healthy',
      textColor: 'text-brand-green',
      bg: 'bg-brand-green/10 border-brand-green/30',
    };
  }, [diagnosticRows]);

  /** Connected node only — same threshold as mesh so small error counts stay attention/orange. */
  const connectedHealth = useMemo(() => {
    const rows = diagnosticRows.filter((r) => r.nodeId === myNodeNum);
    const errors = rows.filter((r) => r.kind === 'routing' && r.severity === 'error').length;
    const warnings =
      rows.filter((r) => r.kind === 'routing' && r.severity === 'warning').length +
      rows.filter((r) => r.kind === 'rf' && r.severity === 'warning').length;
    const infos =
      rows.filter((r) => r.kind === 'routing' && r.severity === 'info').length +
      rows.filter((r) => r.kind === 'rf' && r.severity === 'info').length;
    if (errors >= DEGRADED_ERROR_THRESHOLD) {
      return {
        label: 'Degraded',
        textColor: 'text-red-400',
        bg: 'bg-red-500/10 border-red-500/20',
        errors,
        warnings,
        infos,
      };
    }
    if (errors > 0 || warnings > 0) {
      return {
        label: 'Attention',
        textColor: 'text-yellow-400',
        bg: 'bg-yellow-500/10 border-yellow-500/20',
        errors,
        warnings,
        infos,
      };
    }
    return {
      label: 'Healthy',
      textColor: 'text-brand-green',
      bg: 'bg-brand-green/10 border-brand-green/20',
      errors,
      warnings,
      infos,
    };
  }, [diagnosticRows, myNodeNum]);

  const matchesSearchRow = (row: DiagnosticRow) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const node = nodes.get(row.nodeId);
    const hexMatch = row.nodeId.toString(16).includes(q);
    const nameMatch =
      node?.long_name?.toLowerCase().includes(q) || node?.short_name?.toLowerCase().includes(q);
    if (row.kind === 'routing') {
      return (
        nameMatch || hexMatch || row.type.includes(q) || row.description.toLowerCase().includes(q)
      );
    }
    return (
      nameMatch ||
      hexMatch ||
      row.condition.toLowerCase().includes(q) ||
      row.cause.toLowerCase().includes(q)
    );
  };

  const showRoutingAnomalyBanner = meshHasRoutingAnomaliesFromRows(diagnosticRows);

  const meshCongestionBlock = useMemo(() => {
    if (!homeNode) return null;
    if (!hasLocalStatsData(homeNode) && homeNode.channel_utilization == null) return null;
    const cuStats24h = getCuStats24h(homeNode.node_id);
    const findings = diagnoseConnectedNode(homeNode, {
      cuStats24h: cuStats24h ?? undefined,
    });
    if (!findings?.some((f) => f.condition === 'Mesh Congestion')) return null;
    const attr = summarizeMeshCongestionAttribution(packetCache, routingAnomaliesMap);
    const lines = meshCongestionDetailLines(attr, {
      alwaysIncludeRoutingAnomalies: true,
    });
    const originators = packetCache.size > 0 ? summarizeRfDuplicateOriginators(packetCache) : [];
    if (lines.length === 0 && originators.length === 0) return null;
    return { lines, originators };
  }, [homeNode, packetCache, routingAnomaliesMap, getCuStats24h]);

  const anomalyList = diagnosticRows.filter(matchesSearchRow).sort((a, b) => {
    const order = (s: string) => (s === 'error' ? 0 : s === 'warning' ? 1 : 2);
    const sevA = a.kind === 'routing' ? a.severity : a.severity;
    const sevB = b.kind === 'routing' ? b.severity : b.severity;
    return order(sevA) - order(sevB);
  });

  const selfRows = anomalyList.filter((r) => r.nodeId === myNodeNum);
  const meshRows = anomalyList.filter((r) => r.nodeId !== myNodeNum);

  const errorCount = diagnosticRows.filter(
    (r) => r.kind === 'routing' && r.severity === 'error',
  ).length;
  const warningCount =
    diagnosticRows.filter((r) => r.kind === 'routing' && r.severity === 'warning').length +
    diagnosticRows.filter((r) => r.kind === 'rf' && r.severity === 'warning').length;
  const infoCount =
    diagnosticRows.filter((r) => r.kind === 'routing' && r.severity === 'info').length +
    diagnosticRows.filter((r) => r.kind === 'rf' && r.severity === 'info').length;

  const handleTraceRoute = async (nodeId: number) => {
    // Clear any prior failure for this node
    setTraceFailed((prev) => {
      const s = new Set(prev);
      s.delete(nodeId);
      return s;
    });
    setTracePending(nodeId);
    traceStartTimes.current.set(nodeId, Date.now());

    const timer = setTimeout(() => {
      setTracePending((prev) => (prev === nodeId ? null : prev));
      setTraceFailed((prev) => new Set([...prev, nodeId]));
      traceTimers.current.delete(nodeId);
    }, TRACE_TIMEOUT_MS);
    traceTimers.current.set(nodeId, timer);

    try {
      await onTraceRoute(nodeId);
      // Result arrival is detected via useEffect watching traceRouteResults
    } catch (e) {
      console.warn('[DiagnosticsPanel] trace route failed', e);
      clearTimeout(timer);
      traceTimers.current.delete(nodeId);
      setTracePending(null);
      setTraceFailed((prev) => new Set([...prev, nodeId]));
    }
  };

  const renderTableBody = (list: DiagnosticRow[]) => {
    const severityOf = (r: DiagnosticRow) => (r.kind === 'routing' ? r.severity : r.severity);
    const countSev = (sev: string) => list.filter((r) => severityOf(r) === sev).length;
    let lastSeverity: string | null = null;
    return list.flatMap((row) => {
      const sev = severityOf(row);
      const rows: React.ReactNode[] = [];
      if (sev !== lastSeverity) {
        lastSeverity = sev;
        const label =
          sev === 'error'
            ? `Errors (${countSev('error')})`
            : sev === 'warning'
              ? `Warnings (${countSev('warning')})`
              : `Notes (${countSev('info')})`;
        const rowClass =
          sev === 'error'
            ? 'bg-red-950/40 text-red-400'
            : sev === 'warning'
              ? 'bg-orange-950/20 text-orange-400'
              : 'bg-blue-950/20 text-blue-400';
        rows.push(
          <tr key={`hdr-${sev}-${row.nodeId}-${row.id}`} className={rowClass}>
            <td colSpan={6} className="px-4 py-2 text-xs font-semibold">
              {label}
            </td>
          </tr>,
        );
      }
      if (row.kind === 'rf') {
        const rf = row;
        const node = nodes.get(rf.nodeId);
        const isInfo = rf.severity === 'info';
        const colorClass = isInfo ? 'text-blue-400' : 'text-orange-400';
        const hexId = `!${rf.nodeId.toString(16)}`;
        const displayName = node?.long_name || node?.short_name || hexId;
        const remedy = getRecommendedActionForRfCondition(rf.condition);
        rows.push(
          <tr
            key={rf.id}
            onClick={() => node && onNodeClick?.(node)}
            className={`hover:bg-secondary-dark/50 transition-colors ${
              onNodeClick && node ? 'cursor-pointer' : ''
            }`}
          >
            <td className="px-4 py-2.5">
              <div className="flex items-center gap-2">
                {isInfo ? (
                  <InfoCircleIcon className={`h-4 w-4 shrink-0 ${colorClass}`} />
                ) : (
                  <AlertTriangleIcon className={`h-4 w-4 shrink-0 ${colorClass}`} />
                )}
                <div>
                  <div className="font-medium text-gray-200">{displayName}</div>
                  <div className="text-muted font-mono text-xs">{hexId}</div>
                </div>
              </div>
            </td>
            <td className="px-4 py-2.5">
              <div className={`text-xs font-medium ${colorClass} mb-0.5`}>
                {rf.condition}
                {rf.isLastHop && (
                  <span className="ml-1 rounded border border-blue-500/30 bg-blue-500/20 px-1 py-0 text-[10px] text-blue-300">
                    Last-Hop
                  </span>
                )}
              </div>
              <div className="max-w-xs text-xs text-gray-400">{rf.cause}</div>
            </td>
            <td className="px-4 py-2.5 text-right text-xs text-gray-300">—</td>
            <td className="text-muted px-4 py-2.5 text-right text-xs">
              {formatTime(rf.detectedAt)}
            </td>
            <td className="px-4 py-2.5">
              {remedy ? (
                <span
                  title={remedy.description}
                  className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${CATEGORY_STYLES[remedy.category]}`}
                >
                  {remedy.title}
                </span>
              ) : (
                <span className="text-muted text-xs">—</span>
              )}
            </td>
            <td className="text-muted px-4 py-2.5 text-right text-xs">RF — trace N/A</td>
          </tr>,
        );
        return rows;
      }
      const anomaly = routingRowToNodeAnomaly(row);
      const node = nodes.get(anomaly.nodeId);
      const isError = anomaly.severity === 'error';
      const isInfo = anomaly.severity === 'info';
      const colorClass = isError ? 'text-red-400' : isInfo ? 'text-blue-400' : 'text-orange-400';
      const hexId = `!${anomaly.nodeId.toString(16)}`;
      const displayName = node?.long_name || node?.short_name || hexId;
      const isPending = tracePending === anomaly.nodeId;
      const isFailed = traceFailed.has(anomaly.nodeId);
      const traceResult = traceRouteResults.get(anomaly.nodeId);
      const startTime = traceStartTimes.current.get(anomaly.nodeId);
      const hasResult =
        traceResult && startTime !== undefined && traceResult.timestamp >= startTime;
      const traceHops = hasResult
        ? [
            getFullNodeLabel(myNodeNum) || 'Me',
            ...traceResult.route.map((id) => getFullNodeLabel(id)),
            getFullNodeLabel(traceResult.from),
          ]
        : null;
      rows.push(
        <tr
          key={row.id}
          onClick={() => {
            if (node && onNodeClick) onNodeClick(node);
          }}
          className={`hover:bg-secondary-dark/50 transition-colors ${
            onNodeClick && node ? 'cursor-pointer' : ''
          }`}
        >
          <td className="px-4 py-2.5">
            <div className="flex items-center gap-2">
              {isInfo ? (
                <InfoCircleIcon className={`h-4 w-4 shrink-0 ${colorClass}`} />
              ) : (
                <AlertTriangleIcon className={`h-4 w-4 shrink-0 ${colorClass}`} />
              )}
              <div>
                <div className="font-medium text-gray-200">{displayName}</div>
                <div className="text-muted font-mono text-xs">{hexId}</div>
              </div>
            </div>
          </td>
          <td className="px-4 py-2.5">
            <div className={`text-xs font-medium tracking-wide uppercase ${colorClass} mb-0.5`}>
              {anomaly.type.replace(/_/g, ' ')}
            </div>
            <div className="max-w-xs text-xs text-gray-400">{anomaly.description}</div>
            {showMqttControls &&
              anomaly.type === 'hop_goblin' &&
              node?.heard_via_mqtt === true &&
              !node?.heard_via_mqtt_only && (
                <div className="mt-1 text-xs text-yellow-400/70">
                  Warning: Hybrid Node. MQTT latency may be skewing hop data. Suggest: Filter MQTT.
                </div>
              )}
          </td>
          <td className="px-4 py-2.5 text-right text-xs text-gray-300">
            {anomaly.hopsAway ?? '—'}
          </td>
          <td className="text-muted px-4 py-2.5 text-right text-xs">
            {isPending ? (
              <span className="animate-pulse text-blue-400">Tracing...</span>
            ) : (
              formatTime(anomaly.detectedAt)
            )}
          </td>
          <td className="px-4 py-2.5">
            {(() => {
              if (!node) return <span className="text-muted text-xs">—</span>;
              const remedy = getRecommendedAction(node, homeNode, packetStats.get(anomaly.nodeId));
              if (!remedy) return <span className="text-muted text-xs">—</span>;
              return (
                <span
                  title={remedy.description}
                  className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${CATEGORY_STYLES[remedy.category]}`}
                >
                  {remedy.title}
                </span>
              );
            })()}
          </td>
          <td
            className="px-4 py-2.5 text-right"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="flex flex-col items-end gap-1.5">
              {isPending ? (
                <span className="flex items-center justify-end gap-1.5 text-xs text-blue-400">
                  <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Tracing...
                </span>
              ) : traceHops ? (
                <div className="text-right">
                  <div className="text-muted mb-0.5 text-[10px]">Route</div>
                  <div className="flex flex-wrap justify-end gap-0.5 font-mono text-xs text-gray-300">
                    {traceHops.map((hop, i) => (
                      <span key={i} className="flex items-center gap-0.5">
                        {i > 0 && <span className="text-gray-600">›</span>}
                        <span
                          className={
                            i === 0 || i === traceHops.length - 1 ? 'text-brand-green' : ''
                          }
                        >
                          {hop}
                        </span>
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => handleTraceRoute(anomaly.nodeId)}
                    disabled={!isConnected}
                    className="bg-secondary-dark mt-1 rounded px-2 py-0.5 text-[10px] text-gray-400 hover:bg-gray-600 disabled:opacity-40"
                  >
                    Re-trace
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleTraceRoute(anomaly.nodeId)}
                  disabled={!isConnected || tracePending !== null}
                  title={isFailed ? 'Trace route timed out — click to retry' : undefined}
                  className={`rounded px-2.5 py-1 text-xs whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    isFailed
                      ? 'border border-red-800/50 bg-red-900/40 text-red-300 hover:bg-red-900/60'
                      : 'bg-secondary-dark text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {isFailed ? 'Retry Trace' : 'Trace Route'}
                </button>
              )}
              {showMqttControls &&
                (mqttIgnoredNodes.has(anomaly.nodeId) ? (
                  <button
                    onClick={() => {
                      setNodeMqttIgnored(anomaly.nodeId, false);
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/20 px-2 py-0.5 text-[10px] whitespace-nowrap text-yellow-300 transition-colors hover:bg-yellow-500/30"
                    title="Click to stop ignoring MQTT for this node"
                  >
                    MQTT Ignored ✕
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setNodeMqttIgnored(anomaly.nodeId, true);
                    }}
                    className="bg-secondary-dark text-muted rounded px-2 py-0.5 text-[10px] whitespace-nowrap transition-colors hover:bg-gray-600 hover:text-gray-300"
                    title="Exclude this node's MQTT data from diagnostics"
                  >
                    Ignore MQTT
                  </button>
                ))}
            </div>
          </td>
        </tr>,
      );
      return rows;
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-200">Network Diagnostics</h2>
        <a
          href="https://github.com/Colorado-Mesh/mesh-client/blob/main/DIAGNOSTICS.md"
          target="_blank"
          rel="noreferrer"
          className="text-muted hover:text-brand-green text-xs transition-colors"
        >
          Docs ↗
        </a>
      </div>

      {diagnosticRowsRestoredAt != null && diagnosticRows.length > 0 && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
          <span>
            Showing diagnostics restored from last session (
            {new Date(diagnosticRowsRestoredAt).toLocaleString()}) — they will refresh as new
            packets arrive.
          </span>
          <button
            type="button"
            onClick={() => {
              clearDiagnosticRowsSnapshot();
            }}
            className="shrink-0 rounded bg-blue-900/50 px-2 py-1 text-xs text-blue-100 hover:bg-blue-800/50"
          >
            Stop restoring on next launch
          </button>
        </div>
      )}

      {/* Network health: single band + counts; nodes count = telemetry only; tooltip for notes */}
      <div
        className={`rounded-xl border p-4 ${meshHealth.bg}`}
        title={
          infoCount > 0
            ? `${infoCount} heuristic note(s) not shown below — see diagnostics table.`
            : undefined
        }
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-muted text-sm">Network health</span>
            <span className={`text-lg font-semibold ${meshHealth.textColor}`}>
              {meshHealth.label}
            </span>
          </div>
          <div className="text-sm text-gray-300">
            <span className="text-muted">{nodesWithTelemetryCount} nodes with telemetry</span>
            {errorCount > 0 && (
              <>
                <span className="text-muted"> · </span>
                <span className="text-red-400">
                  {errorCount} error{errorCount !== 1 ? 's' : ''}
                </span>
              </>
            )}
            {warningCount > 0 && (
              <>
                <span className="text-muted"> · </span>
                <span className="text-orange-400">
                  {warningCount} warning{warningCount !== 1 ? 's' : ''}
                </span>
              </>
            )}
            {errorCount === 0 && warningCount === 0 && diagnosticRows.length === 0 && (
              <>
                <span className="text-muted"> · </span>
                <span className="text-brand-green">no issues</span>
              </>
            )}
          </div>
          {(connectedHealth.errors > 0 || connectedHealth.warnings > 0) &&
            (connectedHealth.errors !== errorCount ||
              connectedHealth.warnings !== warningCount) && (
              <div className="text-muted border-t border-gray-700/40 pt-1 text-xs">
                This node:{' '}
                {connectedHealth.errors > 0 && (
                  <span className="text-red-400">
                    {connectedHealth.errors} error{connectedHealth.errors !== 1 ? 's' : ''}
                  </span>
                )}
                {connectedHealth.errors > 0 && connectedHealth.warnings > 0 && (
                  <span className="text-muted">, </span>
                )}
                {connectedHealth.warnings > 0 && (
                  <span className="text-orange-400">
                    {connectedHealth.warnings} warning{connectedHealth.warnings !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            )}
        </div>
      </div>

      {/* Foreign LoRa activity (last 90 min) — connected node only */}
      {isConnected &&
        (() => {
          const foreignList = getForeignLoraDetectionsList(myNodeNum);
          if (foreignList.length === 0) return null;
          const classLabels: Record<string, string> = {
            meshcore: 'MeshCore Activity',
            meshtastic: 'Meshtastic Traffic',
            'unknown-lora': 'Unknown LoRa Signal',
          };
          const proximityLabels: Record<string, string> = {
            'very-close': 'Very Close',
            nearby: 'Nearby',
            distant: 'Distant',
            unknown: 'Unknown Distance',
          };
          return (
            <div className="space-y-3 rounded-xl border border-orange-500/30 bg-orange-500/5 p-4">
              <h3 className="flex items-center gap-1.5 text-sm font-medium text-orange-400">
                <AlertTriangleIcon className="h-4 w-4 shrink-0" />
                Foreign LoRa Activity (last 90 min)
              </h3>
              <div className="space-y-2">
                {foreignList.map((d, i) => {
                  const minutesAgo = Math.floor((Date.now() - d.detectedAt) / 60_000);
                  const senderName =
                    d.longName ??
                    (d.lastSenderId
                      ? nodes.get(d.lastSenderId)?.long_name ||
                        nodes.get(d.lastSenderId)?.short_name
                      : undefined);
                  return (
                    <div
                      key={`${d.packetClass}-${d.lastSenderId ?? 'na'}-${d.detectedAt}-${i}`}
                      className="bg-secondary-dark grid grid-cols-2 gap-x-4 gap-y-1 rounded p-2 text-xs"
                    >
                      <div className="text-muted">Class</div>
                      <div className="text-gray-200">
                        {classLabels[d.packetClass] ?? d.packetClass}
                      </div>
                      <div className="text-muted">Proximity</div>
                      <div className="text-gray-200">
                        {proximityLabels[d.proximity] ?? d.proximity}
                      </div>
                      <div className="text-muted">Last Seen</div>
                      <div className="text-gray-200">
                        {minutesAgo < 1 ? 'Just now' : `${minutesAgo}m ago`}
                      </div>
                      <div className="text-muted">Count</div>
                      <div className="text-gray-200">{d.count}×</div>
                      {(d.rssi !== undefined || d.snr !== undefined) && (
                        <>
                          <div className="text-muted">Signal</div>
                          <div className="font-mono text-gray-200">
                            {d.rssi !== undefined ? `RSSI ${d.rssi} dBm` : ''}
                            {d.rssi !== undefined && d.snr !== undefined ? ', ' : ''}
                            {d.snr !== undefined ? `SNR ${d.snr.toFixed(1)} dB` : ''}
                          </div>
                        </>
                      )}
                      {d.lastSenderId != null && (
                        <>
                          <div className="text-muted">Sender</div>
                          <div className="font-mono text-gray-200">
                            !{d.lastSenderId.toString(16).padStart(8, '0')}
                            {senderName ? ` (${senderName})` : ''}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

      {/* Settings */}
      <div className="bg-secondary-dark rounded-lg p-4">
        <h3 className="text-muted mb-3 text-sm font-medium">Display Settings</h3>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="congestionHalos"
              checked={congestionHalosEnabled}
              onChange={(e) => {
                setCongestionHalosEnabled(e.target.checked);
              }}
              className="accent-brand-green"
            />
            <label htmlFor="congestionHalos" className="cursor-pointer text-sm text-gray-300">
              Show channel utilization halos on map
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="anomalyHalos"
              checked={anomalyHalosEnabled}
              onChange={(e) => {
                setAnomalyHalosEnabled(e.target.checked);
              }}
              className="accent-brand-green"
            />
            <label htmlFor="anomalyHalos" className="cursor-pointer text-sm text-gray-300">
              Show routing anomaly halos on map
            </label>
          </div>
          {showMqttControls && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ignoreMqtt"
                checked={ignoreMqttEnabled}
                onChange={(e) => {
                  setIgnoreMqttEnabled(e.target.checked);
                }}
                className="accent-brand-green"
              />
              <label htmlFor="ignoreMqtt" className="cursor-pointer text-sm text-gray-300">
                Ignore MQTT
              </label>
              <span className="text-muted text-xs">
                Gray out MQTT-only nodes and exclude them from diagnostics
              </span>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <div className="text-sm text-gray-300">Environment Profile</div>
            <div className="flex w-fit overflow-hidden rounded-lg border border-gray-600/50">
              {(
                [
                  { mode: 'standard', label: 'Standard' },
                  { mode: 'city', label: 'City' },
                  { mode: 'canyon', label: 'Canyon' },
                ] as const
              ).map(({ mode, label }, i) => (
                <button
                  key={mode}
                  onClick={() => {
                    setEnvMode(mode);
                  }}
                  className={`px-4 py-1.5 text-sm transition-colors ${i > 0 ? 'border-l border-gray-600/50' : ''} ${
                    envMode === mode
                      ? 'bg-brand-green/20 text-brand-green border-brand-green/50'
                      : 'bg-secondary-dark text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-muted text-xs">
              {envMode === 'standard' && 'Default 3 km threshold'}
              {envMode === 'city' &&
                'Dense urban RF interference — 1.6× threshold, allow 1 extra hop'}
              {envMode === 'canyon' && 'Mountainous terrain — 2.6× threshold, allow 2 extra hops'}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-gray-700/50 pt-2">
            <div className="text-sm text-gray-300">Stale routing diagnostics</div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="diagnosticRowsMaxAgeHours" className="text-sm text-gray-400">
                Drop routing rows older than
              </label>
              <input
                id="diagnosticRowsMaxAgeHours"
                type="number"
                min={1}
                max={168}
                value={diagnosticRowsMaxAgeHours}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v)) setDiagnosticRowsMaxAgeHours(v);
                }}
                aria-label={`Drop routing rows older than ${diagnosticRowsMaxAgeHours} hours (1–168)`}
                className="bg-deep-black focus:border-brand-green w-16 rounded border border-gray-600 px-2 py-1 text-right text-sm text-gray-200 focus:outline-none"
              />
              <span className="text-sm text-gray-400">hours (1–168)</span>
            </div>
            <span className="text-muted text-xs">
              Applied on load, persist, and merge. RF findings still expire after 1 hour.
            </span>
          </div>
        </div>
      </div>

      {/* Per-Node MQTT Filters */}
      {showMqttControls && mqttIgnoredNodes.size > 0 && (
        <div className="bg-secondary-dark rounded-lg p-3">
          <h3 className="text-muted mb-2 text-xs font-medium">Per-Node MQTT Filters</h3>
          <div className="flex flex-wrap gap-1.5">
            {[...mqttIgnoredNodes].map((nodeId) => {
              const n = nodes.get(nodeId);
              const label = n?.short_name || n?.long_name || `!${nodeId.toString(16)}`;
              return (
                <span
                  key={nodeId}
                  className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-300"
                >
                  {label}
                  <button
                    onClick={() => {
                      setNodeMqttIgnored(nodeId, false);
                    }}
                    aria-label="✕"
                    className="ml-0.5 leading-none hover:text-yellow-100"
                    title="Remove per-node MQTT filter"
                  >
                    ✕
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Mesh-wide routing stress (independent of packet path mix samples) */}
      {showRoutingAnomalyBanner && (
        <div className="flex items-start gap-2.5 rounded-lg border border-orange-500/40 bg-orange-500/10 px-4 py-3 text-sm text-orange-200">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
          <span>{MESH_ROUTING_ANOMALY_LINE}</span>
        </div>
      )}

      {/* Duplicate-traffic attribution heard at this client (same logic as home node detail) */}
      {meshCongestionBlock && (
        <MeshCongestionAttributionBlock
          lines={meshCongestionBlock.lines}
          originators={meshCongestionBlock.originators}
          nodes={nodes}
          scopeSubtitle="Observed at this client — path mix is from packets heard at this connected node."
          className=""
        />
      )}

      {/* IP Geolocation Accuracy Warning */}
      {ourPosition?.source === 'ip' && (
        <div className="flex items-start gap-2.5 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
          <span>
            Using city-level IP geolocation — distance-based thresholds are doubled to reduce false
            positives. For accurate routing analysis, connect a device with GPS or set a static
            position.
          </span>
        </div>
      )}

      {/* Anomaly Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-muted text-sm font-medium">Diagnostics ({diagnosticRows.length})</h3>
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Search anomalies..."
            aria-label="Search anomalies..."
            className="bg-secondary-dark/80 focus:border-brand-green/50 w-48 rounded-lg border border-gray-600/50 px-3 py-1.5 text-sm text-gray-200 focus:outline-none"
          />
        </div>

        {anomalyList.length === 0 ? (
          <div className="bg-secondary-dark text-muted rounded-lg p-8 text-center text-sm">
            {diagnosticRows.length === 0
              ? 'No diagnostics detected. The mesh looks healthy!'
              : 'No anomalies match your search.'}
          </div>
        ) : (
          <div className="space-y-6">
            {selfRows.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold tracking-wide text-gray-400 uppercase">
                  Connected node (you) ({selfRows.length})
                </h4>
                <div className="border-brand-green/20 overflow-auto rounded-lg border border-gray-700">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-deep-black text-muted sticky top-0 text-left">
                        <th className="px-4 py-2.5">Node</th>
                        <th className="px-4 py-2.5">Offense</th>
                        <th className="px-4 py-2.5 text-right">Hops</th>
                        <th className="px-4 py-2.5 text-right">Detected</th>
                        <th className="px-4 py-2.5">Suggested Fix</th>
                        <th className="px-4 py-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/50">
                      {renderTableBody(selfRows)}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {meshRows.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold tracking-wide text-gray-400 uppercase">
                  Mesh diagnostics ({meshRows.length})
                </h4>
                <div className="overflow-auto rounded-lg border border-gray-700">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-deep-black text-muted sticky top-0 text-left">
                        <th className="px-4 py-2.5">Node</th>
                        <th className="px-4 py-2.5">Offense</th>
                        <th className="px-4 py-2.5 text-right">Hops</th>
                        <th className="px-4 py-2.5 text-right">Detected</th>
                        <th className="px-4 py-2.5">Suggested Fix</th>
                        <th className="px-4 py-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/50">
                      {renderTableBody(meshRows)}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
