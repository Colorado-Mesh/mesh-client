import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

import type {
  CliHistoryEntry,
  MeshCoreNeighborResult,
  MeshCoreNodeTelemetry,
  MeshCoreRepeaterStatus,
} from '../hooks/useMeshCore';
import {
  MeshcoreRepeaterRemoteAuthBanner,
  useMeshcoreRepeaterRemoteAuth,
} from '../hooks/useMeshcoreRepeaterRemoteAuth';
import { formatCoordPair } from '../lib/coordUtils';
import {
  meshcoreClearRepeaterRemoteSessionAuth,
  meshcoreIsRepeaterRemoteAuthTouched,
  meshcoreTracePathLenToHops,
} from '../lib/meshcoreUtils';
import { getNodeStatus, normalizeLastHeardMs } from '../lib/nodeStatus';
import { useRadioProvider } from '../lib/radio/providerFactory';
import type { MeshNode } from '../lib/types';
import { useCoordFormatStore } from '../stores/coordFormatStore';
import { usePathHistoryStore } from '../stores/pathHistoryStore';
import { useRepeaterSignalStore } from '../stores/repeaterSignalStore';
import { HelpTooltip } from './HelpTooltip';
import { formatSecondsAgo } from './NodeInfoBody';
import SnrIndicator from './SnrIndicator';
import { useToast } from './Toast';

interface Props {
  nodes: Map<number, MeshNode>;
  meshcoreNodeStatus: Map<number, MeshCoreRepeaterStatus>;
  meshcoreStatusErrors?: Map<number, string>;
  meshcoreTraceResults: Map<
    number,
    { pathLen: number; pathHashes: number[]; pathSnrs: number[]; lastSnr: number; tag: number }
  >;
  meshcorePingErrors?: Map<number, string>;
  onRequestRepeaterStatus: (nodeId: number) => Promise<void>;
  onPing: (nodeId: number) => Promise<void>;
  onDeleteRepeater: (nodeId: number) => Promise<void>;
  isConnected: boolean;
  onRequestNeighbors?: (nodeId: number) => Promise<void>;
  meshcoreNeighbors?: Map<number, MeshCoreNeighborResult>;
  meshcoreNeighborErrors?: Map<number, string>;
  onRequestTelemetry?: (nodeId: number) => Promise<void>;
  meshcoreTelemetry?: Map<number, MeshCoreNodeTelemetry>;
  meshcoreTelemetryErrors?: Map<number, string>;
  onSelectRepeater?: (node: MeshNode) => void;
  onSendCliCommand?: (nodeId: number, command: string, useSavedPath: boolean) => Promise<string>;
  meshcoreCliHistories?: Map<number, CliHistoryEntry[]>;
  meshcoreCliErrors?: Map<number, string>;
  onClearCliHistory?: (nodeId: number) => void;
  /** MeshCore: when set (non-null), prefetches SQLite path history for visible repeaters. */
  meshcoreCanPingTrace?: (nodeId: number) => boolean;
}

function formatRelativeTime(
  lastHeard: number | null | undefined,
  nodeId?: number,
  nodeName?: string,
): string {
  if (!lastHeard) return 'Never';
  const lastMs = normalizeLastHeardMs(lastHeard);
  if (!lastMs) return 'Never';
  const ageMs = Date.now() - lastMs;
  const ageSec = Math.floor(ageMs / 1000);
  if (ageSec < 0) {
    const timeDeltaSec = Math.abs(ageSec);
    if (timeDeltaSec > 60)
      console.warn(
        `[formatRelativeTime] future timestamp detected: node=${nodeName ?? nodeId?.toString(16) ?? 'unknown'}, timeDelta=${timeDeltaSec}s, lastHeard=${lastHeard}, lastMs=${lastMs}`,
      );
  }
  const clampedSec = Math.max(0, ageSec);
  if (clampedSec < 60) return 'Just now';
  const ageMin = Math.floor(clampedSec / 60);
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

/** Prefer on-demand repeater status (remote query); contact list SNR/RSSI are often stale for MeshCore. */
function displayRepeaterSnr(node: MeshNode, status: MeshCoreRepeaterStatus | undefined): string {
  if (status !== undefined && Number.isFinite(status.lastSnr)) {
    return status.lastSnr.toFixed(1);
  }
  if (node.snr != null && node.snr !== 0) return node.snr.toFixed(1);
  return '—';
}

function displayRepeaterRssi(node: MeshNode, status: MeshCoreRepeaterStatus | undefined): string {
  if (status !== undefined && Number.isFinite(status.lastRssi)) {
    return String(status.lastRssi);
  }
  if (node.rssi != null && node.rssi !== 0) return String(node.rssi);
  return '—';
}

function SignalSparkline({ points }: { points: { ts: number; snr: number }[] }) {
  if (points.length < 2) return <span className="text-xs text-gray-600">—</span>;
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
  const tooltip = `${latest.snr.toFixed(1)} dB · ${formatRelativeTime(latest.ts / 1000, undefined, 'signal history')}`;
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
  meshcoreStatusErrors,
  meshcoreTraceResults,
  meshcorePingErrors,
  onRequestRepeaterStatus,
  onPing,
  onDeleteRepeater,
  isConnected,
  onRequestNeighbors,
  meshcoreNeighbors,
  meshcoreNeighborErrors,
  onRequestTelemetry,
  meshcoreTelemetry,
  meshcoreTelemetryErrors,
  onSelectRepeater,
  onSendCliCommand,
  meshcoreCliHistories,
  meshcoreCliErrors,
  onClearCliHistory,
  meshcoreCanPingTrace,
}: Props) {
  const { addToast } = useToast();
  const { ensureConfigured, RemoteAuthModal } = useMeshcoreRepeaterRemoteAuth();
  const [, setRemoteAuthEpoch] = useState(0);
  const bumpRemoteAuthEpoch = useCallback(() => {
    setRemoteAuthEpoch((n) => n + 1);
  }, []);
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  const signalHistory = useRepeaterSignalStore((s) => s.history);
  const [statusLoadingSet, setStatusLoadingSet] = useState<Set<number>>(new Set());
  const [pingLoadingSet, setPingLoadingSet] = useState<Set<number>>(new Set());
  const [deleteLoadingSet, setDeleteLoadingSet] = useState<Set<number>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [neighborsLoadingSet, setNeighborsLoadingSet] = useState<Set<number>>(new Set());
  const [telemetryLoadingSet, setTelemetryLoadingSet] = useState<Set<number>>(new Set());
  const [expandedNeighbors, setExpandedNeighbors] = useState<Set<number>>(new Set());
  const [expandedTelemetry, setExpandedTelemetry] = useState<Set<number>>(new Set());
  const [expandedPath, setExpandedPath] = useState<Set<number>>(new Set());
  const [expandedCli, setExpandedCli] = useState<Set<number>>(new Set());
  const [cliInputValues, setCliInputValues] = useState<Map<number, string>>(new Map());
  const [cliLoadingSet, setCliLoadingSet] = useState<Set<number>>(new Set());
  const [cliUseSavedPath, setCliUseSavedPath] = useState<Map<number, boolean>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');

  const { nodeStaleThresholdMs, nodeOfflineThresholdMs } = useRadioProvider('meshcore');

  const repeaters = Array.from(nodes.values())
    .filter((n) => n.hw_model === 'Repeater')
    .sort(
      (a, b) => normalizeLastHeardMs(b.last_heard ?? 0) - normalizeLastHeardMs(a.last_heard ?? 0),
    );

  useEffect(() => {
    if (nodes.size === 0) return;
    console.debug('[RepeatersPanel] nodes=', nodes.size, 'repeatersCount=', repeaters.length);
  }, [nodes.size, repeaters.length]);

  const repeatersFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return repeaters;
    return repeaters.filter(
      (n) =>
        n.long_name.toLowerCase().includes(q) || n.node_id.toString(16).toLowerCase().includes(q),
    );
  }, [repeaters, searchQuery]);

  useEffect(() => {
    if (!isConnected || meshcoreCanPingTrace == null) return;
    for (const n of repeatersFiltered) {
      void usePathHistoryStore.getState().loadForNode(n.node_id);
    }
  }, [isConnected, repeatersFiltered, meshcoreCanPingTrace]);

  const remoteAuthReady = meshcoreIsRepeaterRemoteAuthTouched();

  const handleStatus = async (nodeId: number) => {
    if (!(await ensureConfigured())) return;
    setStatusLoadingSet((prev) => new Set([...prev, nodeId]));
    try {
      await onRequestRepeaterStatus(nodeId);
    } catch (e) {
      console.warn('[RepeatersPanel] requestRepeaterStatus error', e);
      addToast(`Status failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
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
    try {
      await onPing(nodeId);
    } catch (e) {
      console.warn('[RepeatersPanel] ping error', e);
      addToast(`Ping failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
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
      console.warn('[RepeatersPanel] deleteRepeater failed:', e instanceof Error ? e.message : e);
      addToast(`Remove failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setDeleteLoadingSet((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
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
    if (!(await ensureConfigured())) return;
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
    if (!(await ensureConfigured())) return;
    setTelemetryLoadingSet((prev) => new Set([...prev, nodeId]));
    try {
      await onRequestTelemetry?.(nodeId);
      setExpandedTelemetry((prev) => new Set([...prev, nodeId]));
    } catch (e) {
      console.warn('[RepeatersPanel] requestTelemetry error', e);
      addToast(`Telemetry failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
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

  const toggleCli = (nodeId: number) => {
    setExpandedCli((prev) => {
      const n = new Set(prev);
      if (n.has(nodeId)) n.delete(nodeId);
      else n.add(nodeId);
      return n;
    });
  };

  const handleCliCommand = async (nodeId: number, command: string) => {
    if (!onSendCliCommand || !command.trim()) return;
    const useSavedPath = cliUseSavedPath.get(nodeId) ?? false;
    setCliLoadingSet((prev) => new Set([...prev, nodeId]));
    try {
      await onSendCliCommand(nodeId, command.trim(), useSavedPath);
    } catch (e) {
      console.warn('[RepeatersPanel] CLI command error', e);
    } finally {
      setCliLoadingSet((prev) => {
        const n = new Set(prev);
        n.delete(nodeId);
        return n;
      });
    }
  };

  const handleCliQuickCommand = async (nodeId: number, command: string) => {
    setCliInputValues((prev) => {
      const n = new Map(prev);
      n.set(nodeId, command);
      return n;
    });
    await handleCliCommand(nodeId, command);
  };

  const toggleCliRoutingMode = (nodeId: number) => {
    setCliUseSavedPath((prev) => {
      const n = new Map(prev);
      const current = prev.get(nodeId) ?? false;
      n.set(nodeId, !current);
      return n;
    });
  };

  const handleCliClear = (nodeId: number) => {
    onClearCliHistory?.(nodeId);
  };

  const handleCliKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, nodeId: number) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const value = cliInputValues.get(nodeId) ?? '';
      if (value.trim()) {
        void handleCliCommand(nodeId, value);
        setCliInputValues((prev) => {
          const n = new Map(prev);
          n.delete(nodeId);
          return n;
        });
      }
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col flex-wrap items-stretch justify-between gap-3 min-[480px]:flex-row min-[480px]:items-center">
          <h2 className="text-bright-green text-lg font-semibold">Repeaters</h2>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            placeholder="Search repeaters…"
            aria-label="Search repeaters"
            className="bg-secondary-dark/80 focus:border-brand-green/50 max-w-[20rem] min-w-[8rem] flex-1 rounded-lg border border-gray-600/50 px-3 py-1.5 text-sm text-gray-200 focus:outline-none"
          />
        </div>
        <p className="max-w-2xl text-xs text-gray-500">
          SNR, RSSI, uptime, and airtime come from the Status action (or auto-fetch while this panel
          is open). Hops and path history need Ping. MeshCore does not fill those columns from
          adverts alone.
        </p>

        <MeshcoreRepeaterRemoteAuthBanner onConfigured={bumpRemoteAuthEpoch} />
        {remoteAuthReady ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                meshcoreClearRepeaterRemoteSessionAuth();
                bumpRemoteAuthEpoch();
              }}
              className="text-xs text-amber-400/90 underline decoration-dotted hover:text-amber-300"
            >
              Change session repeater password
            </button>
          </div>
        ) : null}

        {repeaters.length === 0 ? (
          <div className="mt-8 text-center text-sm text-gray-400">
            <p>No repeaters discovered yet.</p>
            <p className="mt-1 text-gray-500">
              Repeaters appear when contacts with type &ldquo;Repeater&rdquo; advertise. Use{' '}
              <strong>Import Contacts</strong> on the <strong>Nodes</strong> tab to pre-load
              nicknames.
            </p>
          </div>
        ) : repeatersFiltered.length === 0 ? (
          <div className="mt-4 text-center text-sm text-gray-400">
            No repeaters match your search.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-left text-gray-400">
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Last Heard</th>
                  <th
                    className="py-2 pr-4 font-medium"
                    title="dB — from Request Status when available, else contact list"
                  >
                    SNR
                  </th>
                  <th
                    className="py-2 pr-4 font-medium"
                    title="dBm — from Request Status when available, else contact list"
                  >
                    RSSI
                  </th>
                  <th
                    className="py-2 pr-4 font-medium"
                    title="Hop count from last Ping trace (repeaters between you and this node)"
                  >
                    Hops
                  </th>
                  <th className="py-2 pr-4 font-medium">Uptime</th>
                  <th className="py-2 pr-4 font-medium">Air%</th>
                  <th className="py-2 pr-4 font-medium">Path History</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {repeatersFiltered.map((node) => {
                  const status = meshcoreNodeStatus.get(node.node_id);
                  const traceResult = meshcoreTraceResults.get(node.node_id);
                  const repeaterStatus = getNodeStatus(
                    node.last_heard,
                    nodeStaleThresholdMs,
                    nodeOfflineThresholdMs,
                  );
                  const history = signalHistory.get(node.node_id) ?? [];
                  const airPct =
                    status?.totalAirTimeSecs && status?.totalUpTimeSecs
                      ? ((status.totalAirTimeSecs / status.totalUpTimeSecs) * 100).toFixed(1)
                      : null;
                  const isStatusLoading = statusLoadingSet.has(node.node_id);
                  const isPingLoading = pingLoadingSet.has(node.node_id);
                  const statusError = meshcoreStatusErrors?.get(node.node_id);
                  const pingError = meshcorePingErrors?.get(node.node_id);
                  const isDeleteLoading = deleteLoadingSet.has(node.node_id);
                  const isDeleteConfirm = deleteConfirmId === node.node_id;
                  const isNeighborsLoading = neighborsLoadingSet.has(node.node_id);
                  const isTelemetryLoading = telemetryLoadingSet.has(node.node_id);
                  const isNeighborsExpanded = expandedNeighbors.has(node.node_id);
                  const isTelemetryExpanded = expandedTelemetry.has(node.node_id);
                  const isPathExpanded = expandedPath.has(node.node_id);
                  const isCliExpanded = expandedCli.has(node.node_id);
                  const isCliLoading = cliLoadingSet.has(node.node_id);
                  const cliHistory = meshcoreCliHistories?.get(node.node_id) ?? [];
                  const cliError = meshcoreCliErrors?.get(node.node_id);
                  const cliUseAutoPath = cliUseSavedPath.get(node.node_id) ?? false;
                  const neighborError = meshcoreNeighborErrors?.get(node.node_id);
                  const actionErrorSummary = [
                    statusError && `Status: ${statusError}`,
                    pingError && `Ping: ${pingError}`,
                    neighborError && !isNeighborsExpanded && `Neighbors: ${neighborError}`,
                    cliError && !isCliExpanded && `CLI: ${cliError}`,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  const neighborData = meshcoreNeighbors?.get(node.node_id);
                  const telemetryData = meshcoreTelemetry?.get(node.node_id);
                  const telemetryError = meshcoreTelemetryErrors?.get(node.node_id);
                  const pingHardDisabled = !isConnected || isPingLoading;
                  const pingBlockReason = !isConnected
                    ? 'Connect to the radio first.'
                    : isPingLoading
                      ? 'Ping in progress…'
                      : null;
                  return (
                    <Fragment key={node.node_id}>
                      <tr className="text-gray-300 hover:bg-gray-800/30">
                        <td className="py-2 pr-4">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                repeaterStatus === 'online'
                                  ? 'bg-green-500'
                                  : repeaterStatus === 'stale'
                                    ? 'bg-amber-500'
                                    : 'bg-gray-500'
                              }`}
                            />
                            <span
                              className={
                                repeaterStatus === 'online'
                                  ? 'text-xs text-green-400'
                                  : repeaterStatus === 'stale'
                                    ? 'text-xs text-amber-400'
                                    : 'text-xs text-gray-500'
                              }
                            >
                              {repeaterStatus === 'online'
                                ? 'Online'
                                : repeaterStatus === 'stale'
                                  ? 'Stale'
                                  : 'Offline'}
                            </span>
                          </span>
                        </td>
                        <td className="py-2 pr-4 font-medium text-white">
                          <button
                            type="button"
                            onClick={() => onSelectRepeater?.(node)}
                            aria-label={node.long_name}
                            className="hover:text-brand-green hover:decoration-brand-green/70 text-left text-white underline decoration-transparent transition-colors disabled:no-underline"
                          >
                            {node.long_name}
                          </button>
                        </td>
                        <td className="py-2 pr-4 text-xs text-gray-400">
                          {formatRelativeTime(node.last_heard, node.node_id, node.long_name)}
                        </td>
                        <td
                          className="py-2 pr-4"
                          title={
                            status !== undefined
                              ? 'SNR from repeater status'
                              : 'Contact SNR — use Status for live reading'
                          }
                        >
                          {displayRepeaterSnr(node, status)}
                        </td>
                        <td
                          className="py-2 pr-4"
                          title={
                            status !== undefined
                              ? 'RSSI from repeater status'
                              : 'Contact RSSI — use Status for live reading'
                          }
                        >
                          {displayRepeaterRssi(node, status)}
                        </td>
                        <td className="py-2 pr-4">
                          {traceResult ? (
                            <button
                              type="button"
                              onClick={() => {
                                togglePath(node.node_id);
                              }}
                              className="text-left text-blue-400 underline decoration-dotted hover:text-blue-300"
                              title="Hops from last Ping trace (repeaters between you and this node)"
                            >
                              {meshcoreTracePathLenToHops(traceResult.pathLen)}
                            </button>
                          ) : node.hops_away != null ? (
                            <span className="text-gray-300">{node.hops_away}</span>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">{formatUptime(status?.totalUpTimeSecs)}</td>
                        <td className="py-2 pr-4">{airPct != null ? `${airPct}%` : '—'}</td>
                        <td className="py-2 pr-4">
                          <SignalSparkline points={history} />
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-1">
                            {pingHardDisabled && pingBlockReason ? (
                              <HelpTooltip text={pingBlockReason}>
                                <span className="inline-flex">
                                  <button
                                    type="button"
                                    onClick={() => void handlePing(node.node_id)}
                                    disabled
                                    aria-label={
                                      pingError ? `Ping error: ${pingError}` : 'Ping trace'
                                    }
                                    className={`rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                                      pingError
                                        ? 'border border-red-700 bg-red-900/60 text-red-300'
                                        : 'border border-blue-700 bg-blue-900/60 text-blue-300 hover:bg-blue-800/60'
                                    }`}
                                  >
                                    {isPingLoading ? (
                                      <span className="inline-block h-3 w-3 animate-spin rounded-full border border-blue-400 border-t-transparent" />
                                    ) : pingError ? (
                                      'Error'
                                    ) : (
                                      'Ping'
                                    )}
                                  </button>
                                </span>
                              </HelpTooltip>
                            ) : pingError ? (
                              <HelpTooltip text={`Last ping failed: ${pingError}`}>
                                <span className="inline-flex">
                                  <button
                                    type="button"
                                    onClick={() => void handlePing(node.node_id)}
                                    aria-label={`Ping error: ${pingError}`}
                                    className="rounded border border-red-700 bg-red-900/60 px-2 py-0.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-800/60"
                                  >
                                    Error
                                  </button>
                                </span>
                              </HelpTooltip>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handlePing(node.node_id)}
                                aria-label="Ping trace"
                                className="rounded border border-blue-700 bg-blue-900/60 px-2 py-0.5 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-800/60"
                              >
                                {isPingLoading ? (
                                  <span className="inline-block h-3 w-3 animate-spin rounded-full border border-blue-400 border-t-transparent" />
                                ) : (
                                  'Ping'
                                )}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleStatus(node.node_id)}
                              disabled={!isConnected || isStatusLoading}
                              title={statusError ?? undefined}
                              aria-label={
                                statusError ? `Status error: ${statusError}` : 'Request status'
                              }
                              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                                statusError
                                  ? 'border border-red-700 bg-red-900/60 text-red-300'
                                  : 'border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700'
                              }`}
                            >
                              {isStatusLoading ? (
                                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-400 border-t-transparent" />
                              ) : statusError ? (
                                'Error'
                              ) : (
                                'Status'
                              )}
                            </button>
                            {onRequestNeighbors && (
                              <button
                                type="button"
                                onClick={() => void handleNeighbors(node.node_id)}
                                disabled={!isConnected || isNeighborsLoading}
                                title={neighborError ?? undefined}
                                aria-label={
                                  neighborError && !isNeighborsExpanded
                                    ? `Neighbors error: ${neighborError}`
                                    : 'Repeater neighbors'
                                }
                                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                                  neighborError && !isNeighborsExpanded
                                    ? 'border border-red-700 bg-red-900/60 text-red-300'
                                    : isNeighborsExpanded
                                      ? 'border border-purple-700 bg-purple-900/60 text-purple-300'
                                      : 'border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700'
                                }`}
                              >
                                {isNeighborsLoading ? (
                                  <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-400 border-t-transparent" />
                                ) : neighborError && !isNeighborsExpanded ? (
                                  'Error'
                                ) : (
                                  'Neighbors'
                                )}
                              </button>
                            )}
                            {onRequestTelemetry && (
                              <button
                                type="button"
                                onClick={() => void handleTelemetry(node.node_id)}
                                disabled={!isConnected || isTelemetryLoading}
                                title="Cayenne LPP sensor payload (not advert GPS on the map)"
                                aria-label="Sensor telemetry LPP"
                                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                                  isTelemetryExpanded
                                    ? 'border border-amber-700 bg-amber-900/60 text-amber-300'
                                    : 'border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700'
                                }`}
                              >
                                {isTelemetryLoading ? (
                                  <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-400 border-t-transparent" />
                                ) : (
                                  'Sensor (LPP)'
                                )}
                              </button>
                            )}
                            {onSendCliCommand && (
                              <button
                                type="button"
                                onClick={() => {
                                  toggleCli(node.node_id);
                                }}
                                disabled={!isConnected}
                                title="Open CLI interface"
                                aria-label="CLI interface"
                                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                                  isCliExpanded
                                    ? 'border border-cyan-700 bg-cyan-900/60 text-cyan-300'
                                    : 'border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700'
                                }`}
                              >
                                CLI
                              </button>
                            )}
                            <button
                              onClick={() => void handleDelete(node.node_id)}
                              disabled={isDeleteLoading}
                              onBlur={() => {
                                if (isDeleteConfirm) setDeleteConfirmId(null);
                              }}
                              className="rounded border border-red-700 bg-red-900/60 px-2 py-0.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-800/60 disabled:opacity-40"
                            >
                              {isDeleteLoading ? (
                                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-red-400 border-t-transparent" />
                              ) : isDeleteConfirm ? (
                                'Confirm?'
                              ) : (
                                'Remove'
                              )}
                            </button>
                          </div>
                          {actionErrorSummary ? (
                            <div className="mt-1 text-xs text-red-400" title={actionErrorSummary}>
                              {actionErrorSummary}
                            </div>
                          ) : null}
                        </td>
                      </tr>

                      {/* Path SNR detail row */}
                      {isPathExpanded && traceResult && (
                        <tr className="bg-gray-900/60">
                          <td colSpan={10} className="px-4 py-2">
                            <div className="flex flex-wrap items-center gap-1 text-xs">
                              <span className="mr-1 text-gray-400">Path:</span>
                              <span className="text-brand-green">● Me</span>
                              {(Array.isArray(traceResult.pathSnrs)
                                ? traceResult.pathSnrs
                                : []
                              ).map((hop, i) => (
                                <span key={i} className="flex items-center gap-1">
                                  <span className="text-gray-600">→</span>
                                  <span className="rounded bg-blue-900/40 px-1.5 py-0.5 font-mono text-blue-300">
                                    {hop > 0 ? '+' : ''}
                                    {hop.toFixed(2)} dB
                                  </span>
                                  <span className="text-gray-500">● Hop {i + 1}</span>
                                </span>
                              ))}
                              <span className="text-gray-600">→</span>
                              <span className="bg-brand-green/20 text-brand-green rounded px-1.5 py-0.5 font-mono">
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
                            <p className="mb-1 text-xs text-gray-400">
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
                                      <span className="font-mono text-gray-500">
                                        {nb.prefixHex}
                                      </span>
                                      <span className="text-gray-300">[{name}]</span>
                                      <SnrIndicator snr={nb.snr} />
                                      <span className="text-gray-500">
                                        Heard: {formatSecondsAgo(nb.heardSecondsAgo)}
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
                      {isTelemetryExpanded && (
                        <tr className="bg-gray-900/60">
                          <td colSpan={10} className="px-4 py-2">
                            {isTelemetryLoading ? (
                              <p className="text-xs text-gray-500">Fetching telemetry…</p>
                            ) : telemetryData ? (
                              <div className="flex flex-wrap items-center gap-4 text-xs">
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
                                    GPS:{' '}
                                    {formatCoordPair(
                                      telemetryData.gps.latitude,
                                      telemetryData.gps.longitude,
                                      coordinateFormat,
                                    )}
                                    {telemetryData.gps.altitude
                                      ? ` alt ${telemetryData.gps.altitude}m`
                                      : ''}
                                  </span>
                                )}
                                {telemetryData.voltage == null &&
                                  telemetryData.temperature == null &&
                                  telemetryData.relativeHumidity == null &&
                                  telemetryData.barometricPressure == null &&
                                  !telemetryData.gps && (
                                    <div className="flex flex-col gap-1 text-gray-500">
                                      <span>No LPP sensor data in this response.</span>
                                      {node.latitude != null && node.longitude != null ? (
                                        <span>
                                          Map position comes from advert/contact data, not this
                                          sensor request.
                                        </span>
                                      ) : null}
                                    </div>
                                  )}
                              </div>
                            ) : (
                              <div className="space-y-1 text-xs">
                                {telemetryError ? (
                                  <p className="text-red-400">{telemetryError}</p>
                                ) : (
                                  <p className="text-gray-500">
                                    No telemetry response yet. Try Sensor (LPP) again.
                                  </p>
                                )}
                                {node.latitude != null && node.longitude != null ? (
                                  <p className="text-gray-500">
                                    Map position comes from advert/contact data, not sensor
                                    telemetry.
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}

                      {/* CLI detail row */}
                      {isCliExpanded && onSendCliCommand && (
                        <tr className="bg-gray-900/60">
                          <td colSpan={10} className="px-4 py-2">
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={cliInputValues.get(node.node_id) ?? ''}
                                  onChange={(e) => {
                                    setCliInputValues((prev) => {
                                      const n = new Map(prev);
                                      n.set(node.node_id, e.target.value);
                                      return n;
                                    });
                                  }}
                                  onKeyDown={(e) => {
                                    handleCliKeyDown(e, node.node_id);
                                  }}
                                  placeholder="Enter command..."
                                  disabled={!isConnected || isCliLoading}
                                  className="min-w-[200px] flex-1 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-200 focus:border-cyan-500 focus:outline-none disabled:opacity-40"
                                  aria-label="CLI command input"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const cmd = cliInputValues.get(node.node_id) ?? '';
                                    if (cmd.trim()) {
                                      void handleCliCommand(node.node_id, cmd);
                                      setCliInputValues((prev) => {
                                        const n = new Map(prev);
                                        n.delete(node.node_id);
                                        return n;
                                      });
                                    }
                                  }}
                                  disabled={
                                    !isConnected ||
                                    isCliLoading ||
                                    !cliInputValues.get(node.node_id)?.trim()
                                  }
                                  className="rounded border border-cyan-700 bg-cyan-900/60 px-3 py-1 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-800/60 disabled:opacity-40"
                                >
                                  {isCliLoading ? (
                                    <span className="inline-block h-3 w-3 animate-spin rounded-full border border-cyan-400 border-t-transparent" />
                                  ) : (
                                    'Send'
                                  )}
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                <span className="mr-1 text-xs text-gray-500">Quick:</span>
                                {[
                                  'name',
                                  'radio',
                                  'neighbors',
                                  'version',
                                  'status',
                                  'config',
                                  'help',
                                ].map((cmd) => (
                                  <button
                                    key={cmd}
                                    type="button"
                                    onClick={() => void handleCliQuickCommand(node.node_id, cmd)}
                                    disabled={!isConnected || isCliLoading}
                                    className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-40"
                                  >
                                    {cmd}
                                  </button>
                                ))}
                              </div>
                              <div className="flex items-center gap-3">
                                <label className="flex items-center gap-1 text-xs text-gray-400">
                                  <input
                                    type="checkbox"
                                    checked={cliUseAutoPath}
                                    onChange={() => {
                                      toggleCliRoutingMode(node.node_id);
                                    }}
                                    className="h-3 w-3"
                                  />
                                  <span>Use saved path</span>
                                </label>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleCliClear(node.node_id);
                                  }}
                                  className="text-xs text-gray-500 underline hover:text-gray-300"
                                >
                                  Clear history
                                </button>
                              </div>
                              <div className="max-h-40 overflow-y-auto rounded border border-gray-700 bg-gray-950/50">
                                {cliHistory.length === 0 ? (
                                  <div className="px-2 py-1 text-xs text-gray-500 italic">
                                    No commands yet
                                  </div>
                                ) : (
                                  cliHistory.map((entry, idx) => (
                                    <div
                                      key={`${entry.timestamp}-${idx}`}
                                      className={`px-2 py-0.5 font-mono text-xs ${
                                        entry.type === 'sent' ? 'text-cyan-300' : 'text-gray-300'
                                      }`}
                                    >
                                      {entry.type === 'sent' ? '>' : '<'} {entry.text}
                                    </div>
                                  ))
                                )}
                              </div>
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
      {RemoteAuthModal}
    </>
  );
}
