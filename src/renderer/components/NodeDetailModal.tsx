import { useEffect, useState } from "react";
import type { MeshNode, HopHistoryPoint } from "../lib/types";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { RoleDisplay } from "../lib/roleInfo";
import { getRecommendedAction } from "../lib/diagnostics/RemediationEngine";

const CATEGORY_STYLES: Record<string, string> = {
  Configuration: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
  Physical:      "bg-orange-500/20 text-orange-400 border border-orange-500/30",
  Hardware:      "bg-purple-500/20 text-purple-400 border border-purple-500/30",
  Software:      "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30",
};

const EMPTY_HOP_HISTORY: HopHistoryPoint[] = [];

interface NodeDetailModalProps {
  node: MeshNode | null;
  onClose: () => void;
  onRequestPosition: (nodeNum: number) => Promise<void>;
  onTraceRoute: (nodeNum: number) => Promise<void>;
  traceRouteHops?: string[];
  onDeleteNode: (nodeNum: number) => Promise<void>;
  onMessageNode?: (nodeNum: number) => void;
  onToggleFavorite: (nodeId: number, favorited: boolean) => void;
  isConnected: boolean;
  homeNode?: MeshNode | null;
}

function formatTime(ts: number): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

function InfoRow({
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
      <span className={`text-sm font-medium ${className || "text-gray-200"}`}>
        {value}
      </span>
    </div>
  );
}

export default function NodeDetailModal({
  node,
  onClose,
  onRequestPosition,
  onTraceRoute,
  traceRouteHops,
  onDeleteNode,
  onMessageNode,
  onToggleFavorite,
  isConnected,
  homeNode = null,
}: NodeDetailModalProps) {
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [positionRequestedAt, setPositionRequestedAt] = useState<number | null>(null);
  const [traceRoutePending, setTraceRoutePending] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Reset all state when node changes
  useEffect(() => {
    setActionStatus(null);
    setPositionRequestedAt(null);
    setTraceRoutePending(false);
    setShowDeleteConfirm(false);
  }, [node?.node_id]);

  // Detect position update after a request was sent
  useEffect(() => {
    if (positionRequestedAt !== null) {
      setPositionRequestedAt(null);
      setActionStatus("Position updated");
    }
  }, [node?.latitude, node?.longitude]);

  // 30-second timeout for position request
  useEffect(() => {
    if (!positionRequestedAt) return;
    const timer = setTimeout(() => {
      setPositionRequestedAt(null);
      setActionStatus("Position request timed out");
    }, 30_000);
    return () => clearTimeout(timer);
  }, [positionRequestedAt]);

  // Clear trace route pending when result arrives
  useEffect(() => {
    if (traceRouteHops) setTraceRoutePending(false);
  }, [traceRouteHops]);

  // 60-second timeout for trace route
  useEffect(() => {
    if (!traceRoutePending) return;
    const timer = setTimeout(() => {
      setTraceRoutePending(false);
      setActionStatus("Trace route timed out");
    }, 60_000);
    return () => clearTimeout(timer);
  }, [traceRoutePending]);

  const anomaly = useDiagnosticsStore((s) => s.anomalies.get(node?.node_id ?? 0));
  const nodePacketStats = useDiagnosticsStore((s) => s.packetStats.get(node?.node_id ?? 0));
  const hopHistory = useDiagnosticsStore(
    (s) => s.hopHistory.get(node?.node_id ?? 0) ?? EMPTY_HOP_HISTORY
  );

  if (!node) return null;

  const hexId = `!${node.node_id.toString(16)}`;
  const displayName = node.short_name || node.long_name || hexId;

  const batteryColor =
    node.battery > 50
      ? "text-bright-green"
      : node.battery > 20
      ? "text-yellow-400"
      : node.battery > 0
      ? "text-red-400"
      : "text-muted";

  const snrColor =
    node.snr > 5
      ? "text-bright-green"
      : node.snr > 0
      ? "text-yellow-400"
      : node.snr !== 0
      ? "text-red-400"
      : "text-muted";

  const handleRequestPosition = async () => {
    setPositionRequestedAt(Date.now());
    setActionStatus("Requesting position...");
    try {
      await onRequestPosition(node.node_id);
    } catch {
      setPositionRequestedAt(null);
      setActionStatus("Position request failed");
    }
  };

  const handleTraceRoute = async () => {
    setTraceRoutePending(true);
    setActionStatus("Trace route requested...");
    try {
      await onTraceRoute(node.node_id);
    } catch {
      setTraceRoutePending(false);
      setActionStatus("Trace route failed");
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-deep-black border border-gray-700 rounded-xl max-w-md w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-100 truncate">
              {displayName}
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-muted font-mono">{hexId}</span>
              {node.hw_model && node.hw_model !== "0" && (
                <span className="text-xs text-muted">
                  {node.hw_model}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => onToggleFavorite(node.node_id, !node.favorited)}
            className="p-1.5 rounded-lg hover:bg-secondary-dark transition-colors shrink-0 mr-1"
            title={node.favorited ? "Remove from favorites" : "Add to favorites"}
          >
            <span className={`text-xl ${node.favorited ? "text-yellow-400" : "text-gray-500 hover:text-yellow-400"}`}>
              {node.favorited ? "★" : "☆"}
            </span>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary-dark text-muted hover:text-gray-200 transition-colors shrink-0"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-3">
          {/* Names */}
          {node.long_name && (
            <InfoRow label="Long Name" value={node.long_name} />
          )}
          {node.short_name && (
            <InfoRow label="Short Name" value={node.short_name} />
          )}

          {/* Role */}
          <div className="flex justify-between items-center py-2 border-b border-gray-700/50">
            <span className="text-sm text-muted">Role</span>
            <RoleDisplay role={node.role} />
          </div>

          {/* Signal */}
          <InfoRow
            label="SNR"
            value={node.snr !== 0 ? `${node.snr.toFixed(1)} dB` : "—"}
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
                        ? "bg-brand-green"
                        : node.battery > 20
                        ? "bg-yellow-500"
                        : "bg-red-500"
                    }`}
                    style={{ width: `${Math.min(node.battery, 100)}%` }}
                  />
                </div>
              )}
              <span className={`text-sm font-medium ${batteryColor}`}>
                {node.battery > 0 ? `${node.battery}%` : "—"}
              </span>
            </div>
          </div>

          {/* Timing */}
          <InfoRow label="Last Heard" value={formatTime(node.last_heard)} />

          {/* Location */}
          {(node.latitude !== 0 || node.longitude !== 0) && (
            <InfoRow
              label="Position"
              value={`${node.latitude.toFixed(5)}, ${node.longitude.toFixed(5)}`}
              className="text-gray-300 font-mono text-xs"
            />
          )}

          {/* GPS warning */}
          {node.lastPositionWarning && (
            <div className="flex items-start gap-1.5 px-2 py-1.5 mt-1 rounded bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs">
              <span>⚠</span>
              <span>GPS Warning: {node.lastPositionWarning}</span>
            </div>
          )}

          {/* Routing Health */}
          {(() => {
            const now = Date.now();
            const oneHourAgo = now - 60 * 60 * 1000;
            const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
            const recentHour = hopHistory.filter((p) => p.t >= oneHourAgo);
            const recentHistory = hopHistory.filter((p) => p.t >= twentyFourHoursAgo);
            const hasSparkline = recentHistory.length >= 2;

            // Stability: count hop-count changes in the last hour
            let hopChanges = 0;
            for (let i = 1; i < recentHour.length; i++) {
              if (recentHour[i].h !== recentHour[i - 1].h) hopChanges++;
            }
            const stability =
              recentHour.length < 2 ? "Unknown"
              : hopChanges === 0 ? "Stable"
              : hopChanges <= 2 ? "Moderate"
              : "Unstable";
            const stabilityColor =
              stability === "Stable" ? "text-brand-green"
              : stability === "Moderate" ? "text-yellow-400"
              : stability === "Unknown" ? "text-muted"
              : "text-red-400";

            // Human-readable offense summary
            const offenseSummary = anomaly
              ? anomaly.type === "hop_goblin"
                ? "Node is over-hopping for its distance or signal strength"
                : anomaly.type === "bad_route"
                ? "Possible routing loop — high packet duplication detected"
                : anomaly.type === "route_flapping"
                ? "Route is unstable — hop count changing frequently"
                : "Reported as 0 hops but GPS data suggests otherwise"
              : null;

            return (
              <div className="mt-3 p-3 bg-primary-dark rounded-lg">
                <div className="text-xs text-gray-400 mb-1.5">Routing Health</div>

                {/* Remedy badge */}
                {(() => {
                  const remedy = getRecommendedAction(node, homeNode, nodePacketStats);
                  if (!remedy) return null;
                  return (
                    <div className={`flex items-start gap-2 p-2 mb-2 rounded-lg text-xs border ${CATEGORY_STYLES[remedy.category]}`}>
                      <span className="font-semibold shrink-0">{remedy.category}</span>
                      <span>{remedy.title}</span>
                    </div>
                  );
                })()}

                {/* Offense */}
                {anomaly ? (
                  <div className={`flex items-start gap-1.5 text-xs ${
                    anomaly.severity === "error" ? "text-red-400" : "text-orange-400"
                  }`}>
                    <svg
                      className="w-3.5 h-3.5 shrink-0 mt-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
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
                        ({hopChanges} change{hopChanges !== 1 ? "s" : ""})
                      </span>
                    )}
                  </span>
                </div>

                {hasSparkline && (() => {
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
                    .join(" ");
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
              </div>
            );
          })()}

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
                          ? "text-green-400 font-medium"
                          : "text-gray-200"
                      }
                    >
                      {hop}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 border-t border-gray-700 flex items-center gap-2">
          <button
            onClick={handleRequestPosition}
            disabled={!isConnected || positionRequestedAt !== null}
            className="flex-1 px-3 py-2 text-sm font-medium bg-secondary-dark hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-gray-200 rounded-lg transition-colors"
          >
            📍 Request Position
          </button>
          <button
            onClick={handleTraceRoute}
            disabled={!isConnected || traceRoutePending}
            className="flex-1 px-3 py-2 text-sm font-medium bg-secondary-dark hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-gray-200 rounded-lg transition-colors"
          >
            🛤 Trace Route
          </button>
          {onMessageNode && (
            <button
              onClick={() => { onMessageNode(node.node_id); onClose(); }}
              disabled={!isConnected}
              className="flex-1 px-3 py-2 text-sm font-medium bg-purple-700/50 hover:bg-purple-600/50 disabled:opacity-40 disabled:cursor-not-allowed text-purple-300 rounded-lg transition-colors"
            >
              💬 Message
            </button>
          )}
        </div>

        {/* Action status */}
        {actionStatus && (
          <div className="px-5 pb-3">
            <div className="text-xs text-muted text-center">
              {actionStatus}
            </div>
          </div>
        )}

        {/* Delete node */}
        <div className="px-5 pb-4">
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full mt-2 px-3 py-2 text-sm font-medium bg-red-900/30 hover:bg-red-900/50 text-red-400 hover:text-red-300 rounded-lg transition-colors border border-red-900/50"
            >
              Delete Node
            </button>
          ) : (
            <div className="mt-2 p-3 bg-red-900/20 border border-red-900/50 rounded-lg">
              <p className="text-xs text-red-300 mb-2">
                Remove this node from local database? It will reappear when it broadcasts again.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 px-3 py-1.5 text-xs bg-secondary-dark hover:bg-gray-600 text-gray-300 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => onDeleteNode(node.node_id).then(onClose)}
                  className="flex-1 px-3 py-1.5 text-xs bg-red-800 hover:bg-red-700 text-white rounded transition-colors"
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
