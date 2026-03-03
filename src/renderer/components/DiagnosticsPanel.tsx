import { useEffect, useRef, useState } from "react";
import type { MeshNode } from "../lib/types";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { computeHealthScore } from "../lib/diagnostics/RoutingDiagnosticEngine";
import { getRecommendedAction } from "../lib/diagnostics/RemediationEngine";

const CATEGORY_STYLES: Record<string, string> = {
  Configuration: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
  Physical:      "bg-orange-500/20 text-orange-400 border border-orange-500/30",
  Hardware:      "bg-purple-500/20 text-purple-400 border border-purple-500/30",
  Software:      "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30",
};

const TRACE_TIMEOUT_MS = 30_000;

interface Props {
  nodes: Map<number, MeshNode>;
  myNodeNum: number;
  onTraceRoute: (nodeNum: number) => Promise<void>;
  isConnected: boolean;
  traceRouteResults: Map<number, { route: number[]; from: number; timestamp: number }>;
  getFullNodeLabel: (nodeNum: number) => string;
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

function formatTime(ts: number): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function DiagnosticsPanel({
  nodes,
  myNodeNum,
  onTraceRoute,
  isConnected,
  traceRouteResults,
  getFullNodeLabel,
}: Props) {
  const anomalies = useDiagnosticsStore((s) => s.anomalies);
  const packetStats = useDiagnosticsStore((s) => s.packetStats);
  const homeNode = nodes.get(myNodeNum) ?? null;
  const congestionHalosEnabled = useDiagnosticsStore((s) => s.congestionHalosEnabled);
  const setCongestionHalosEnabled = useDiagnosticsStore((s) => s.setCongestionHalosEnabled);
  const anomalyHalosEnabled = useDiagnosticsStore((s) => s.anomalyHalosEnabled);
  const setAnomalyHalosEnabled = useDiagnosticsStore((s) => s.setAnomalyHalosEnabled);
  const ignoreMqttEnabled = useDiagnosticsStore((s) => s.ignoreMqttEnabled);
  const setIgnoreMqttEnabled = useDiagnosticsStore((s) => s.setIgnoreMqttEnabled);
  const runReanalysis = useDiagnosticsStore((s) => s.runReanalysis);

  const [search, setSearch] = useState("");
  const [tracePending, setTracePending] = useState<number | null>(null);
  const [traceFailed, setTraceFailed] = useState<Set<number>>(new Set());
  const traceStartTimes = useRef<Map<number, number>>(new Map());
  const traceTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Re-run full analysis whenever nodes change
  useEffect(() => {
    runReanalysis(nodes, myNodeNum);
  }, [nodes, myNodeNum, runReanalysis]);

  // Re-run analysis when ignoreMqtt toggle changes
  useEffect(() => {
    runReanalysis(nodes, myNodeNum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ignoreMqttEnabled]);

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
    return () => {
      for (const timer of traceTimers.current.values()) clearTimeout(timer);
    };
  }, []);

  const totalNodes = nodes.size > 0 ? nodes.size - 1 : 0; // exclude self
  const healthScore = computeHealthScore(totalNodes, anomalies);

  const scoreColor =
    healthScore > 80
      ? "text-brand-green"
      : healthScore > 60
      ? "text-yellow-400"
      : "text-red-400";

  const scoreBg =
    healthScore > 80
      ? "bg-brand-green/10 border-brand-green/30"
      : healthScore > 60
      ? "bg-yellow-500/10 border-yellow-500/30"
      : "bg-red-500/10 border-red-500/30";

  const anomalyList = Array.from(anomalies.values()).filter((a) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const node = nodes.get(a.nodeId);
    return (
      node?.long_name?.toLowerCase().includes(q) ||
      node?.short_name?.toLowerCase().includes(q) ||
      a.nodeId.toString(16).includes(q) ||
      a.type.includes(q)
    );
  });

  const errorCount = Array.from(anomalies.values()).filter(
    (a) => a.severity === "error"
  ).length;
  const warningCount = Array.from(anomalies.values()).filter(
    (a) => a.severity === "warning"
  ).length;

  const handleTraceRoute = async (nodeId: number) => {
    // Clear any prior failure for this node
    setTraceFailed((prev) => { const s = new Set(prev); s.delete(nodeId); return s; });
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
    } catch {
      clearTimeout(timer);
      traceTimers.current.delete(nodeId);
      setTracePending(null);
      setTraceFailed((prev) => new Set([...prev, nodeId]));
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-200">Network Diagnostics</h2>

      {/* Health Score */}
      <div className={`border rounded-xl p-5 ${scoreBg}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted mb-1">Network Health Score</div>
            <div className={`text-5xl font-bold ${scoreColor}`}>
              {healthScore}
              <span className="text-2xl ml-1 font-normal">/100</span>
            </div>
            <div className="flex gap-4 mt-2 text-xs text-muted">
              <span>{totalNodes} nodes monitored</span>
              {errorCount > 0 && (
                <span className="text-red-400">
                  {errorCount} error{errorCount !== 1 ? "s" : ""}
                </span>
              )}
              {warningCount > 0 && (
                <span className="text-orange-400">
                  {warningCount} warning{warningCount !== 1 ? "s" : ""}
                </span>
              )}
              {anomalies.size === 0 && totalNodes > 0 && (
                <span className="text-brand-green">No issues detected</span>
              )}
            </div>
          </div>
          {anomalies.size > 0 && (
            <AlertTriangleIcon
              className={`w-12 h-12 ${
                errorCount > 0 ? "text-red-400" : "text-orange-400"
              } opacity-60`}
            />
          )}
        </div>
      </div>

      {/* Settings */}
      <div className="bg-secondary-dark rounded-lg p-4">
        <h3 className="text-sm font-medium text-muted mb-3">Display Settings</h3>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="congestionHalos"
              checked={congestionHalosEnabled}
              onChange={(e) => setCongestionHalosEnabled(e.target.checked)}
              className="accent-brand-green"
            />
            <label htmlFor="congestionHalos" className="text-sm text-gray-300 cursor-pointer">
              Show channel utilization halos on map
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="anomalyHalos"
              checked={anomalyHalosEnabled}
              onChange={(e) => setAnomalyHalosEnabled(e.target.checked)}
              className="accent-brand-green"
            />
            <label htmlFor="anomalyHalos" className="text-sm text-gray-300 cursor-pointer">
              Show routing anomaly halos on map
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="ignoreMqtt"
              checked={ignoreMqttEnabled}
              onChange={(e) => setIgnoreMqttEnabled(e.target.checked)}
              className="accent-brand-green"
            />
            <label htmlFor="ignoreMqtt" className="text-sm text-gray-300 cursor-pointer">
              Ignore MQTT
            </label>
            <span className="text-xs text-muted">Gray out MQTT-only nodes and exclude them from diagnostics</span>
          </div>
        </div>
      </div>

      {/* Anomaly Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-muted">
            Routing Anomalies ({anomalies.size})
          </h3>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nodes..."
            className="w-48 px-3 py-1.5 bg-secondary-dark/80 rounded-lg text-gray-200 text-sm border border-gray-600/50 focus:border-brand-green/50 focus:outline-none"
          />
        </div>

        {anomalyList.length === 0 ? (
          <div className="bg-secondary-dark rounded-lg p-8 text-center text-muted text-sm">
            {anomalies.size === 0
              ? "No routing anomalies detected. The mesh looks healthy!"
              : "No anomalies match your search."}
          </div>
        ) : (
          <div className="overflow-auto rounded-lg border border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-deep-black text-muted text-left sticky top-0">
                  <th className="px-4 py-2.5">Node</th>
                  <th className="px-4 py-2.5">Offense</th>
                  <th className="px-4 py-2.5 text-right">SNR</th>
                  <th className="px-4 py-2.5 text-right">Hops</th>
                  <th className="px-4 py-2.5 text-right">Detected</th>
                  <th className="px-4 py-2.5">Suggested Fix</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {anomalyList.map((anomaly) => {
                  const node = nodes.get(anomaly.nodeId);
                  const isError = anomaly.severity === "error";
                  const colorClass = isError ? "text-red-400" : "text-orange-400";
                  const hexId = `!${anomaly.nodeId.toString(16)}`;
                  const displayName = node?.long_name || node?.short_name || hexId;

                  const isPending = tracePending === anomaly.nodeId;
                  const isFailed = traceFailed.has(anomaly.nodeId);
                  const traceResult = traceRouteResults.get(anomaly.nodeId);
                  const startTime = traceStartTimes.current.get(anomaly.nodeId);
                  const hasResult = traceResult && startTime !== undefined && traceResult.timestamp >= startTime;
                  const traceHops = hasResult
                    ? [
                        getFullNodeLabel(myNodeNum) || "Me",
                        ...traceResult!.route.map((id) => getFullNodeLabel(id)),
                        getFullNodeLabel(traceResult!.from),
                      ]
                    : null;

                  return (
                    <tr
                      key={anomaly.nodeId}
                      className="hover:bg-secondary-dark/50 transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <AlertTriangleIcon
                            className={`w-4 h-4 shrink-0 ${colorClass}`}
                          />
                          <div>
                            <div className="text-gray-200 font-medium">
                              {displayName}
                            </div>
                            <div className="text-xs text-muted font-mono">
                              {hexId}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className={`text-xs font-medium uppercase tracking-wide ${colorClass} mb-0.5`}>
                          {anomaly.type.replace(/_/g, " ")}
                        </div>
                        <div className="text-xs text-gray-400 max-w-xs">
                          {anomaly.description}
                        </div>
                        {anomaly.type === "hop_goblin" &&
                          node?.heard_via_mqtt === true &&
                          !node?.heard_via_mqtt_only && (
                          <div className="text-xs text-yellow-400/70 mt-1">
                            Warning: Hybrid Node. MQTT latency may be skewing hop data. Suggest: Filter MQTT.
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-300 font-mono">
                        {anomaly.snr != null ? `${anomaly.snr.toFixed(1)} dB` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-300">
                        {anomaly.hopsAway != null ? anomaly.hopsAway : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted">
                        {isPending ? (
                          <span className="text-blue-400 animate-pulse">Tracing...</span>
                        ) : (
                          formatTime(anomaly.detectedAt)
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {(() => {
                          const remedy = getRecommendedAction(node!, homeNode, packetStats.get(anomaly.nodeId));
                          if (!remedy) return <span className="text-xs text-muted">—</span>;
                          return (
                            <span
                              title={remedy.description}
                              className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${CATEGORY_STYLES[remedy.category]}`}
                            >
                              {remedy.title}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isPending ? (
                          <span className="flex items-center justify-end gap-1.5 text-xs text-blue-400">
                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                            </svg>
                            Tracing...
                          </span>
                        ) : traceHops ? (
                          <div className="text-right">
                            <div className="text-[10px] text-muted mb-0.5">Route</div>
                            <div className="text-xs text-gray-300 font-mono flex flex-wrap justify-end gap-0.5">
                              {traceHops.map((hop, i) => (
                                <span key={i} className="flex items-center gap-0.5">
                                  {i > 0 && <span className="text-gray-600">›</span>}
                                  <span className={i === 0 || i === traceHops.length - 1 ? "text-brand-green" : ""}>{hop}</span>
                                </span>
                              ))}
                            </div>
                            <button
                              onClick={() => handleTraceRoute(anomaly.nodeId)}
                              disabled={!isConnected}
                              className="mt-1 px-2 py-0.5 text-[10px] bg-secondary-dark hover:bg-gray-600 disabled:opacity-40 text-gray-400 rounded"
                            >
                              Re-trace
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleTraceRoute(anomaly.nodeId)}
                            disabled={!isConnected || tracePending !== null}
                            title={isFailed ? "Trace route timed out — click to retry" : undefined}
                            className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                              isFailed
                                ? "bg-red-900/40 hover:bg-red-900/60 text-red-300 border border-red-800/50"
                                : "bg-secondary-dark hover:bg-gray-600 text-gray-300"
                            }`}
                          >
                            {isFailed ? "Retry Trace" : "Trace Route"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
