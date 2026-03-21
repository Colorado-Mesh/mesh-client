import { Fragment, useState } from 'react';

import type {
  MeshCoreNeighborResult,
  MeshCoreNodeTelemetry,
  MeshCoreRepeaterStatus,
} from '../hooks/useMeshCore';
import type { MeshNode } from '../lib/types';
import { useRepeaterSignalStore } from '../stores/repeaterSignalStore';
import { useToast } from './Toast';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

interface Props {
  nodes: Map<number, MeshNode>;
  meshcoreNodeStatus: Map<number, MeshCoreRepeaterStatus>;
  meshcoreTraceResults: Map<number, { hops: { snr: number }[]; lastSnr: number }>;
  onRequestRepeaterStatus: (nodeId: number) => Promise<void>;
  onPing: (nodeId: number) => Promise<void>;
  onImportRepeaters: () => Promise<ImportResult>;
  onDeleteRepeater: (nodeId: number) => Promise<void>;
  isConnected: boolean;
  onSendAdvert?: () => Promise<void>;
  onSyncClock?: () => Promise<void>;
  onReboot?: () => Promise<void>;
  onRequestNeighbors?: (nodeId: number) => Promise<void>;
  meshcoreNeighbors?: Map<number, MeshCoreNeighborResult>;
  onRequestTelemetry?: (nodeId: number) => Promise<void>;
  meshcoreTelemetry?: Map<number, MeshCoreNodeTelemetry>;
  onSelectRepeater?: (node: MeshNode) => void;
}

const STALE_THRESHOLD_MS = 15 * 60 * 1000;

function getRepeaterStatus(lastHeard: number | null | undefined): 'active' | 'stale' | 'unknown' {
  if (!lastHeard) return 'unknown';
  const ageMs = Date.now() - lastHeard * 1000;
  return ageMs < STALE_THRESHOLD_MS ? 'active' : 'stale';
}

function formatRelativeTime(lastHeard: number | null | undefined): string {
  if (!lastHeard) return 'Never';
  const ageMs = Date.now() - lastHeard * 1000;
  const ageSec = Math.floor(ageMs / 1000);
  if (ageSec < 60) return `${ageSec}s ago`;
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) return `${ageMin}m ago`;
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) return `${ageHr}h ago`;
  return `${Math.floor(ageHr / 24)}d ago`;
}

function formatUptime(secs: number | undefined): string {
  if (!secs) return '—';
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function SignalSparkline({ points }: { points: { ts: number; snr: number }[] }) {
  if (points.length < 2) return <span className="text-gray-600 text-xs">—</span>;
  const W = 80,
    H = 24;
  const snrs = points.map((p) => p.snr);
  const minS = Math.min(...snrs),
    maxS = Math.max(...snrs);
  const range = maxS - minS || 1;
  const minT = points[0].ts,
    maxT = points[points.length - 1].ts;
  const timeRange = maxT - minT || 1;
  const toX = (t: number) => ((t - minT) / timeRange) * W;
  const toY = (s: number) => H - ((s - minS) / range) * H;
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.ts).toFixed(1)},${toY(p.snr).toFixed(1)}`)
    .join(' ');
  const latest = points[points.length - 1];
  const tooltip = `${latest.snr.toFixed(1)} dB · ${formatRelativeTime(latest.ts / 1000)}`;
  return (
    <svg width={W} height={H} className="text-brand-green">
      <title>{tooltip}</title>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function RepeatersPanel({
  nodes,
  meshcoreNodeStatus,
  meshcoreTraceResults,
  onRequestRepeaterStatus,
  onPing,
  onImportRepeaters,
  onDeleteRepeater,
  isConnected,
  onSendAdvert,
  onSyncClock,
  onReboot,
  onRequestNeighbors,
  meshcoreNeighbors,
  onRequestTelemetry,
  meshcoreTelemetry,
  onSelectRepeater,
}: Props) {
  const { addToast } = useToast();
  const signalHistory = useRepeaterSignalStore((s) => s.history);
  const [statusLoadingSet, setStatusLoadingSet] = useState<Set<number>>(new Set());
  const [pingLoadingSet, setPingLoadingSet] = useState<Set<number>>(new Set());
  const [pingErrorSet, setPingErrorSet] = useState<Set<number>>(new Set());
  const [deleteLoadingSet, setDeleteLoadingSet] = useState<Set<number>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [advertLoading, setAdvertLoading] = useState(false);
  const [syncClockLoading, setSyncClockLoading] = useState(false);
  const [rebootConfirm, setRebootConfirm] = useState(false);
  const [rebootLoading, setRebootLoading] = useState(false);
  const [neighborsLoadingSet, setNeighborsLoadingSet] = useState<Set<number>>(new Set());
  const [telemetryLoadingSet, setTelemetryLoadingSet] = useState<Set<number>>(new Set());
  const [expandedNeighbors, setExpandedNeighbors] = useState<Set<number>>(new Set());
  const [expandedTelemetry, setExpandedTelemetry] = useState<Set<number>>(new Set());
  const [expandedPath, setExpandedPath] = useState<Set<number>>(new Set());

  const repeaters = Array.from(nodes.values())
    .filter((n) => n.hw_model === 'Repeater')
    .sort((a, b) => (b.last_heard ?? 0) - (a.last_heard ?? 0));

  const handleImport = async () => {
    setImportLoading(true);
    try {
      const result = await onImportRepeaters();
      if (result.imported === 0 && result.skipped === 0 && result.errors.length === 0) return;
      const msg =
        result.errors.length > 0
          ? `Imported ${result.imported}, skipped ${result.skipped}. Errors: ${result.errors.slice(0, 3).join('; ')}`
          : `Imported ${result.imported} repeater${result.imported !== 1 ? 's' : ''}${result.skipped > 0 ? `, skipped ${result.skipped}` : ''}.`;
      addToast(msg, result.errors.length > 0 ? 'error' : 'success');
    } catch (e) {
      addToast(`Import failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setImportLoading(false);
    }
  };

  const handleStatus = async (nodeId: number) => {
    setStatusLoadingSet((prev) => new Set([...prev, nodeId]));
    try {
      await onRequestRepeaterStatus(nodeId);
    } catch (e) {
      console.warn('[RepeatersPanel] requestRepeaterStatus error', e);
    } finally {
      setStatusLoadingSet((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    }
  };

  const handlePing = async (nodeId: number) => {
    setPingLoadingSet((prev) => new Set([...prev, nodeId]));
    setPingErrorSet((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
    try {
      await onPing(nodeId);
    } catch (e) {
      console.warn('[RepeatersPanel] ping error', e);
      setPingErrorSet((prev) => new Set([...prev, nodeId]));
      setTimeout(() => {
        setPingErrorSet((prev) => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
      }, 3000);
    } finally {
      setPingLoadingSet((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    }
  };

  const handleDelete = async (nodeId: number) => {
    if (deleteConfirmId !== nodeId) {
      setDeleteConfirmId(nodeId);
      return;
    }
    setDeleteConfirmId(null);
    setDeleteLoadingSet((prev) => new Set([...prev, nodeId]));
    try {
      await onDeleteRepeater(nodeId);
    } catch (e) {
      addToast(`Remove failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setDeleteLoadingSet((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    }
  };

  const handleSendAdvert = async () => {
    if (!onSendAdvert) return;
    setAdvertLoading(true);
    try {
      await onSendAdvert();
      addToast('Flood advert sent', 'success');
    } catch (e) {
      addToast(`Advert failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setAdvertLoading(false);
    }
  };

  const handleSyncClock = async () => {
    if (!onSyncClock) return;
    setSyncClockLoading(true);
    try {
      await onSyncClock();
      addToast('Clock synced', 'success');
    } catch (e) {
      addToast(`Sync failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setSyncClockLoading(false);
    }
  };

  const handleReboot = async () => {
    if (!rebootConfirm) {
      setRebootConfirm(true);
      return;
    }
    setRebootConfirm(false);
    setRebootLoading(true);
    try {
      await onReboot?.();
    } catch (e) {
      addToast(`Reboot failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setRebootLoading(false);
    }
  };

  const handleNeighbors = async (nodeId: number) => {
    if (expandedNeighbors.has(nodeId)) {
      setExpandedNeighbors((prev) => {
        const n = new Set(prev);
        n.delete(nodeId);
        return n;
      });
      return;
    }
    setNeighborsLoadingSet((prev) => new Set([...prev, nodeId]));
    try {
      await onRequestNeighbors?.(nodeId);
      setExpandedNeighbors((prev) => new Set([...prev, nodeId]));
    } catch (e) {
      console.warn('[RepeatersPanel] requestNeighbors error', e);
    } finally {
      setNeighborsLoadingSet((prev) => {
        const n = new Set(prev);
        n.delete(nodeId);
        return n;
      });
    }
  };

  const handleTelemetry = async (nodeId: number) => {
    if (expandedTelemetry.has(nodeId)) {
      setExpandedTelemetry((prev) => {
        const n = new Set(prev);
        n.delete(nodeId);
        return n;
      });
      return;
    }
    setTelemetryLoadingSet((prev) => new Set([...prev, nodeId]));
    try {
      await onRequestTelemetry?.(nodeId);
      setExpandedTelemetry((prev) => new Set([...prev, nodeId]));
    } catch (e) {
      console.warn('[RepeatersPanel] requestTelemetry error', e);
    } finally {
      setTelemetryLoadingSet((prev) => {
        const n = new Set(prev);
        n.delete(nodeId);
        return n;
      });
    }
  };

  const togglePath = (nodeId: number) => {
    setExpandedPath((prev) => {
      const n = new Set(prev);
      if (n.has(nodeId)) n.delete(nodeId);
      else n.add(nodeId);
      return n;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-bright-green">Repeaters</h2>
        <button
          onClick={handleImport}
          disabled={importLoading}
          className="flex items-center gap-2 px-3 py-1.5 rounded bg-brand-green/20 text-brand-green border border-brand-green/30 hover:bg-brand-green/30 transition-colors text-sm font-medium disabled:opacity-50"
        >
          {importLoading ? (
            <span className="w-3 h-3 border border-brand-green border-t-transparent rounded-full animate-spin inline-block" />
          ) : null}
          Import Repeaters
        </button>
      </div>

      {/* Device Action Bar */}
      {(onSendAdvert || onSyncClock || onReboot) && (
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 rounded-lg border border-gray-700">
          <span className="text-xs text-gray-400 mr-1">Device:</span>
          {onSendAdvert && (
            <button
              onClick={() => void handleSendAdvert()}
              disabled={!isConnected || advertLoading}
              className="px-3 py-1 rounded text-xs font-medium bg-brand-green/20 text-brand-green border border-brand-green/30 hover:bg-brand-green/30 transition-colors disabled:opacity-40"
            >
              {advertLoading ? (
                <span className="w-3 h-3 border border-brand-green border-t-transparent rounded-full animate-spin inline-block" />
              ) : (
                'Flood Advert'
              )}
            </button>
          )}
          {onSyncClock && (
            <button
              onClick={() => void handleSyncClock()}
              disabled={!isConnected || syncClockLoading}
              className="px-3 py-1 rounded text-xs font-medium bg-blue-900/50 text-blue-300 border border-blue-700 hover:bg-blue-800/60 transition-colors disabled:opacity-40"
            >
              {syncClockLoading ? (
                <span className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin inline-block" />
              ) : (
                'Sync Clock'
              )}
            </button>
          )}
          {onReboot && (
            <button
              onClick={() => void handleReboot()}
              disabled={!isConnected || rebootLoading}
              onBlur={() => setRebootConfirm(false)}
              className="px-3 py-1 rounded text-xs font-medium bg-red-900/60 text-red-300 border border-red-700 hover:bg-red-800/60 transition-colors disabled:opacity-40"
            >
              {rebootLoading ? (
                <span className="w-3 h-3 border border-red-400 border-t-transparent rounded-full animate-spin inline-block" />
              ) : rebootConfirm ? (
                'Confirm Reboot?'
              ) : (
                'Reboot Device'
              )}
            </button>
          )}
        </div>
      )}

      {repeaters.length === 0 ? (
        <div className="text-gray-400 text-sm mt-8 text-center">
          <p>No repeaters discovered yet.</p>
          <p className="mt-1 text-gray-500">
            Repeaters appear when contacts with type &ldquo;Repeater&rdquo; advertise. Use Import to
            pre-load nicknames.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-700">
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Last Heard</th>
                <th className="py-2 pr-4 font-medium">SNR</th>
                <th className="py-2 pr-4 font-medium">RSSI</th>
                <th className="py-2 pr-4 font-medium">Hops</th>
                <th className="py-2 pr-4 font-medium">Uptime</th>
                <th className="py-2 pr-4 font-medium">Air%</th>
                <th className="py-2 pr-4 font-medium">Path History</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {repeaters.map((node) => {
                const status = meshcoreNodeStatus.get(node.node_id);
                const traceResult = meshcoreTraceResults.get(node.node_id);
                const repeaterStatus = getRepeaterStatus(node.last_heard);
                const history = signalHistory.get(node.node_id) ?? [];
                const airPct =
                  status?.totalAirTimeSecs && status?.totalUpTimeSecs
                    ? ((status.totalAirTimeSecs / status.totalUpTimeSecs) * 100).toFixed(1)
                    : null;
                const isStatusLoading = statusLoadingSet.has(node.node_id);
                const isPingLoading = pingLoadingSet.has(node.node_id);
                const hasPingError = pingErrorSet.has(node.node_id);
                const isDeleteLoading = deleteLoadingSet.has(node.node_id);
                const isDeleteConfirm = deleteConfirmId === node.node_id;
                const isNeighborsLoading = neighborsLoadingSet.has(node.node_id);
                const isTelemetryLoading = telemetryLoadingSet.has(node.node_id);
                const isNeighborsExpanded = expandedNeighbors.has(node.node_id);
                const isTelemetryExpanded = expandedTelemetry.has(node.node_id);
                const isPathExpanded = expandedPath.has(node.node_id);
                const neighborData = meshcoreNeighbors?.get(node.node_id);
                const telemetryData = meshcoreTelemetry?.get(node.node_id);
                const hasTraceResult = traceResult && traceResult.hops.length > 0;

                return (
                  <Fragment key={node.node_id}>
                    <tr className="text-gray-300 hover:bg-gray-800/30">
                      <td className="py-2 pr-4">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              repeaterStatus === 'active'
                                ? 'bg-green-500'
                                : repeaterStatus === 'stale'
                                  ? 'bg-amber-500'
                                  : 'bg-gray-500'
                            }`}
                          />
                          <span
                            className={
                              repeaterStatus === 'active'
                                ? 'text-green-400 text-xs'
                                : repeaterStatus === 'stale'
                                  ? 'text-amber-400 text-xs'
                                  : 'text-gray-500 text-xs'
                            }
                          >
                            {repeaterStatus === 'active'
                              ? 'Active'
                              : repeaterStatus === 'stale'
                                ? 'Stale'
                                : '—'}
                          </span>
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-medium text-white">
                        <button
                          type="button"
                          onClick={() => onSelectRepeater?.(node)}
                          aria-label={node.long_name}
                          className="text-left text-white hover:text-brand-green transition-colors underline decoration-transparent hover:decoration-brand-green/70 disabled:no-underline"
                        >
                          {node.long_name}
                        </button>
                      </td>
                      <td className="py-2 pr-4 text-gray-400 text-xs">
                        {formatRelativeTime(node.last_heard)}
                      </td>
                      <td className="py-2 pr-4">{node.snr != null ? node.snr.toFixed(1) : '—'}</td>
                      <td className="py-2 pr-4">{node.rssi != null ? node.rssi : '—'}</td>
                      <td className="py-2 pr-4">
                        {traceResult ? (
                          hasTraceResult ? (
                            <button
                              onClick={() => togglePath(node.node_id)}
                              className="text-blue-400 hover:text-blue-300 underline decoration-dotted"
                              title="Click to view path SNR detail"
                            >
                              {traceResult.hops.length}
                            </button>
                          ) : (
                            traceResult.hops.length
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 pr-4">{formatUptime(status?.totalUpTimeSecs)}</td>
                      <td className="py-2 pr-4">{airPct != null ? `${airPct}%` : '—'}</td>
                      <td className="py-2 pr-4">
                        <SignalSparkline points={history} />
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          <button
                            onClick={() => void handlePing(node.node_id)}
                            disabled={!isConnected || isPingLoading}
                            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-40 ${
                              hasPingError
                                ? 'bg-red-900/60 text-red-300 border border-red-700'
                                : 'bg-blue-900/60 text-blue-300 border border-blue-700 hover:bg-blue-800/60'
                            }`}
                          >
                            {isPingLoading ? (
                              <span className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin inline-block" />
                            ) : hasPingError ? (
                              'Error'
                            ) : (
                              'Ping'
                            )}
                          </button>
                          <button
                            onClick={() => void handleStatus(node.node_id)}
                            disabled={!isConnected || isStatusLoading}
                            className="px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-300 border border-gray-600 hover:bg-gray-700 transition-colors disabled:opacity-40"
                          >
                            {isStatusLoading ? (
                              <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin inline-block" />
                            ) : (
                              'Status'
                            )}
                          </button>
                          {onRequestNeighbors && (
                            <button
                              onClick={() => void handleNeighbors(node.node_id)}
                              disabled={!isConnected || isNeighborsLoading}
                              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-40 ${
                                isNeighborsExpanded
                                  ? 'bg-purple-900/60 text-purple-300 border border-purple-700'
                                  : 'bg-gray-800 text-gray-300 border border-gray-600 hover:bg-gray-700'
                              }`}
                            >
                              {isNeighborsLoading ? (
                                <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin inline-block" />
                              ) : (
                                'Neighbors'
                              )}
                            </button>
                          )}
                          {onRequestTelemetry && (
                            <button
                              onClick={() => void handleTelemetry(node.node_id)}
                              disabled={!isConnected || isTelemetryLoading}
                              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-40 ${
                                isTelemetryExpanded
                                  ? 'bg-amber-900/60 text-amber-300 border border-amber-700'
                                  : 'bg-gray-800 text-gray-300 border border-gray-600 hover:bg-gray-700'
                              }`}
                            >
                              {isTelemetryLoading ? (
                                <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin inline-block" />
                              ) : (
                                'Telemetry'
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => void handleDelete(node.node_id)}
                            disabled={isDeleteLoading}
                            onBlur={() => {
                              if (isDeleteConfirm) setDeleteConfirmId(null);
                            }}
                            className="px-2 py-0.5 rounded text-xs font-medium bg-red-900/60 text-red-300 border border-red-700 hover:bg-red-800/60 transition-colors disabled:opacity-40"
                          >
                            {isDeleteLoading ? (
                              <span className="w-3 h-3 border border-red-400 border-t-transparent rounded-full animate-spin inline-block" />
                            ) : isDeleteConfirm ? (
                              'Confirm?'
                            ) : (
                              'Remove'
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Path SNR detail row */}
                    {isPathExpanded && traceResult && (
                      <tr className="bg-gray-900/60">
                        <td colSpan={10} className="px-4 py-2">
                          <div className="flex items-center gap-1 text-xs flex-wrap">
                            <span className="text-gray-400 mr-1">Path:</span>
                            <span className="text-brand-green">● Me</span>
                            {traceResult.hops.map((hop, i) => (
                              <span key={i} className="flex items-center gap-1">
                                <span className="text-gray-600">→</span>
                                <span className="px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 font-mono">
                                  {hop.snr > 0 ? '+' : ''}
                                  {hop.snr.toFixed(2)} dB
                                </span>
                                <span className="text-gray-500">● Hop {i + 1}</span>
                              </span>
                            ))}
                            <span className="text-gray-600">→</span>
                            <span className="px-1.5 py-0.5 rounded bg-brand-green/20 text-brand-green font-mono">
                              {traceResult.lastSnr > 0 ? '+' : ''}
                              {traceResult.lastSnr.toFixed(2)} dB
                            </span>
                            <span className="text-white">▣ {node.long_name}</span>
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Neighbors detail row */}
                    {isNeighborsExpanded && neighborData && (
                      <tr className="bg-gray-900/60">
                        <td colSpan={10} className="px-4 py-2">
                          <p className="text-xs text-gray-400 mb-1">
                            Neighbors ({neighborData.totalNeighboursCount} total):
                          </p>
                          {neighborData.neighbours.length === 0 ? (
                            <p className="text-xs text-gray-600">No neighbors reported</p>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {neighborData.neighbours.map((nb, i) => {
                                const name = nb.resolvedNodeId
                                  ? (nodes.get(nb.resolvedNodeId)?.long_name ?? nb.prefixHex)
                                  : nb.prefixHex;
                                return (
                                  <div key={i} className="flex items-center gap-3 text-xs">
                                    <span className="font-mono text-gray-500">{nb.prefixHex}</span>
                                    <span className="text-gray-300">[{name}]</span>
                                    <span className="text-brand-green">
                                      SNR: {nb.snr > 0 ? '+' : ''}
                                      {nb.snr.toFixed(1)} dB
                                    </span>
                                    <span className="text-gray-500">
                                      Heard:{' '}
                                      {nb.heardSecondsAgo < 60
                                        ? `${nb.heardSecondsAgo}s ago`
                                        : nb.heardSecondsAgo < 3600
                                          ? `${Math.floor(nb.heardSecondsAgo / 60)}m ago`
                                          : `${Math.floor(nb.heardSecondsAgo / 3600)}h ago`}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}

                    {/* Telemetry detail row */}
                    {isTelemetryExpanded && telemetryData && (
                      <tr className="bg-gray-900/60">
                        <td colSpan={10} className="px-4 py-2">
                          <div className="flex items-center gap-4 text-xs flex-wrap">
                            {telemetryData.voltage != null && (
                              <span className="text-amber-300">
                                Battery: {telemetryData.voltage.toFixed(2)}V
                              </span>
                            )}
                            {telemetryData.temperature != null && (
                              <span className="text-blue-300">
                                Temp: {telemetryData.temperature.toFixed(1)}°C
                              </span>
                            )}
                            {telemetryData.relativeHumidity != null && (
                              <span className="text-cyan-300">
                                Humidity: {telemetryData.relativeHumidity.toFixed(0)}%
                              </span>
                            )}
                            {telemetryData.barometricPressure != null && (
                              <span className="text-gray-300">
                                Pressure: {telemetryData.barometricPressure.toFixed(1)} hPa
                              </span>
                            )}
                            {telemetryData.gps && (
                              <span className="text-green-300">
                                GPS: {telemetryData.gps.latitude.toFixed(4)}°,{' '}
                                {telemetryData.gps.longitude.toFixed(4)}°
                                {telemetryData.gps.altitude
                                  ? ` alt ${telemetryData.gps.altitude}m`
                                  : ''}
                              </span>
                            )}
                            {!telemetryData.voltage &&
                              !telemetryData.temperature &&
                              !telemetryData.relativeHumidity &&
                              !telemetryData.gps && (
                                <span className="text-gray-500">No telemetry data available</span>
                              )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
