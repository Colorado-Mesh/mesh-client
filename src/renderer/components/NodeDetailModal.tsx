import { useEffect, useRef, useState } from 'react';

import type {
  MeshCoreNeighborResult,
  MeshCoreNodeTelemetry,
  MeshCoreRepeaterStatus,
} from '../hooks/useMeshCore';
import { useMeshcoreRepeaterRemoteAuth } from '../hooks/useMeshcoreRepeaterRemoteAuth';
import { formatCoordPair } from '../lib/coordUtils';
import type { MeshNode, MeshProtocol, NeighborInfoRecord } from '../lib/types';
import { useCoordFormatStore } from '../stores/coordFormatStore';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import NodeInfoBody, { formatSecondsAgo } from './NodeInfoBody';
import SnrIndicator from './SnrIndicator';

interface NodeDetailModalProps {
  /** Optional: enables originator list for Mesh Congestion (RF duplicate-prone by node). */
  nodes?: Map<number, MeshNode>;
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
  neighborInfo?: Map<number, NeighborInfoRecord>;
  useFahrenheit?: boolean;
  protocol?: MeshProtocol;
  meshcoreTraceResult?: { pathLen: number; pathSnrs: number[]; lastSnr: number };
  meshcoreRepeaterStatus?: MeshCoreRepeaterStatus;
  onRequestRepeaterStatus?: (nodeId: number) => Promise<void>;
  meshcoreNodeTelemetry?: MeshCoreNodeTelemetry;
  onRequestTelemetry?: (nodeId: number) => Promise<void>;
  meshcoreNeighbors?: MeshCoreNeighborResult;
  onRequestNeighbors?: (nodeId: number) => Promise<void>;
  meshcoreNeighborError?: string;
  /** PaxCounter data from Meshtastic (seen count per node) */
  paxCounterData?: Map<number, { from: number; count: number; timestamp: number }>;
  /** DetectionSensor events from Meshtastic (raw bytes per node) */
  detectionSensorEvents?: Map<number, { from: number; data: Uint8Array; timestamp: number }[]>;
  /** MapReport data from Meshtastic (location/position reports per node) */
  mapReports?: Map<number, { from: number; data: unknown; timestamp: number }>;
  /** Export contact advert bytes (MeshCore only) */
  onExportContact?: (nodeId: number) => Promise<Uint8Array | null>;
  /** Share contact via mesh (MeshCore only) */
  onShareContact?: (nodeId: number) => Promise<boolean>;
}

export default function NodeDetailModal({
  nodes,
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
  neighborInfo,
  useFahrenheit,
  protocol,
  meshcoreTraceResult,
  meshcoreRepeaterStatus,
  onRequestRepeaterStatus,
  meshcoreNodeTelemetry,
  onRequestTelemetry,
  meshcoreNeighbors,
  onRequestNeighbors,
  meshcoreNeighborError,
  paxCounterData,
  detectionSensorEvents,
  mapReports,
  onExportContact,
  onShareContact,
}: NodeDetailModalProps) {
  const { ensureConfigured, RemoteAuthModal } = useMeshcoreRepeaterRemoteAuth();
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [repeaterStatusPending, setRepeaterStatusPending] = useState(false);
  const [showRepeaterStats, setShowRepeaterStats] = useState(false);
  const [positionRequestedAt, setPositionRequestedAt] = useState<number | null>(null);
  const [traceRoutePending, setTraceRoutePending] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [telemetryPending, setTelemetryPending] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [neighborsPending, setNeighborsPending] = useState(false);
  const [showMeshcoreNeighbors, setShowMeshcoreNeighbors] = useState(false);
  const [exportContactPending, setExportContactPending] = useState(false);
  const [shareContactPending, setShareContactPending] = useState(false);
  const mqttIgnoredNodes = useDiagnosticsStore((s) => s.mqttIgnoredNodes);
  const setNodeMqttIgnored = useDiagnosticsStore((s) => s.setNodeMqttIgnored);
  const getForeignLoraDetectionsList = useDiagnosticsStore((s) => s.getForeignLoraDetectionsList);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const positionRequestedAtRef = useRef(positionRequestedAt);
  positionRequestedAtRef.current = positionRequestedAt;

  // Focus trap and focus management
  useEffect(() => {
    if (!nodeRef.current) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    closeButtonRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, [node?.node_id]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Reset all state when node changes
  useEffect(() => {
    setActionStatus(null);
    setPositionRequestedAt(null);
    setTraceRoutePending(false);
    setShowDeleteConfirm(false);
    setRepeaterStatusPending(false);
    setShowRepeaterStats(false);
    setTelemetryPending(false);
    setShowTelemetry(false);
    setNeighborsPending(false);
    setShowMeshcoreNeighbors(false);
    setExportContactPending(false);
    setShareContactPending(false);
  }, [node?.node_id]);

  // Detect position update after a request was sent
  useEffect(() => {
    if (positionRequestedAtRef.current !== null) {
      setPositionRequestedAt(null);
      setActionStatus('Position updated');
    }
  }, [node?.latitude, node?.longitude]);

  // 30-second timeout for position request
  useEffect(() => {
    if (!positionRequestedAt) return;
    const timer = setTimeout(() => {
      setPositionRequestedAt(null);
      setActionStatus('Position request timed out');
    }, 30_000);
    return () => {
      clearTimeout(timer);
    };
  }, [positionRequestedAt]);

  // Clear trace route pending when result arrives
  useEffect(() => {
    if (traceRouteHops) setTraceRoutePending(false);
  }, [traceRouteHops]);

  // Auto-show repeater stats when they arrive
  useEffect(() => {
    if (meshcoreRepeaterStatus) {
      setRepeaterStatusPending(false);
      setShowRepeaterStats(true);
    }
  }, [meshcoreRepeaterStatus]);

  // Auto-show telemetry when it arrives
  useEffect(() => {
    if (meshcoreNodeTelemetry) {
      setTelemetryPending(false);
      setShowTelemetry(true);
    }
  }, [meshcoreNodeTelemetry]);

  // Auto-show neighbors when they arrive
  useEffect(() => {
    if (meshcoreNeighbors) {
      setNeighborsPending(false);
      setShowMeshcoreNeighbors(true);
    }
  }, [meshcoreNeighbors]);

  // 60-second timeout for trace route
  useEffect(() => {
    if (!traceRoutePending) return;
    const timer = setTimeout(() => {
      setTraceRoutePending(false);
      setActionStatus('Trace route timed out');
    }, 60_000);
    return () => {
      clearTimeout(timer);
    };
  }, [traceRoutePending]);

  if (!node) return null;

  const hexId = `!${node.node_id.toString(16)}`;
  const displayName = node.short_name || node.long_name || hexId;
  const isOurNode = node.node_id === homeNode?.node_id;

  const handleRequestPosition = async () => {
    setPositionRequestedAt(Date.now());
    setActionStatus('Requesting position...');
    try {
      await onRequestPosition(node.node_id);
    } catch (e) {
      console.warn('[NodeDetailModal] request position failed', e);
      setPositionRequestedAt(null);
      setActionStatus('Position request failed');
    }
  };

  const handleTraceRoute = async () => {
    setTraceRoutePending(true);
    setActionStatus('Trace route requested...');
    try {
      await onTraceRoute(node.node_id);
    } catch (e) {
      console.warn('[NodeDetailModal] trace route failed', e);
      setTraceRoutePending(false);
      setActionStatus('Trace route failed');
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="Close dialog"
          className="absolute inset-0 cursor-pointer border-0 bg-black/50 p-0 backdrop-blur-sm"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="node-modal-title"
          className="bg-deep-black relative z-10 flex max-h-[90vh] min-h-0 w-full max-w-md flex-col overflow-hidden rounded-xl border border-gray-700 shadow-2xl"
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-gray-700 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 id="node-modal-title" className="truncate text-lg font-semibold text-gray-100">
                  {displayName}
                </h3>
                {mqttIgnoredNodes.has(node.node_id) && (
                  <span className="shrink-0 rounded border border-yellow-500/30 bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-300">
                    MQTT Ignored
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-muted font-mono text-xs">{hexId}</span>
                {node.hops_away != null && (
                  <span
                    className={`text-xs ${node.hops_away === 0 ? 'text-bright-green' : 'text-gray-400'}`}
                    title="Hops away (path length)"
                  >
                    {node.hops_away} hop{node.hops_away !== 1 ? 's' : ''}
                  </span>
                )}
                {node.hw_model && node.hw_model !== '0' && (
                  <span className="text-muted text-xs">{node.hw_model}</span>
                )}
              </div>
            </div>
            <button
              onClick={() => {
                onToggleFavorite(node.node_id, !node.favorited);
              }}
              className="hover:bg-secondary-dark mr-1 shrink-0 rounded-lg p-1.5 transition-colors"
              aria-label={node.favorited ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={node.favorited}
            >
              <span
                className={`text-xl ${node.favorited ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400'}`}
                aria-hidden="true"
              >
                {node.favorited ? '★' : '☆'}
              </span>
            </button>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              aria-label="Close dialog"
              className="hover:bg-secondary-dark text-muted shrink-0 rounded-lg p-1.5 transition-colors hover:text-gray-200"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body — scrollable so long RF/diagnostics content fits on screen */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3">
            <NodeInfoBody
              node={node}
              homeNode={homeNode}
              traceRouteHops={isOurNode ? undefined : traceRouteHops}
              nodes={nodes}
              useFahrenheit={useFahrenheit}
              protocol={protocol}
            />

            {protocol === 'meshcore' &&
              !isOurNode &&
              node.hw_model === 'Repeater' &&
              meshcoreNeighborError &&
              !showMeshcoreNeighbors && (
                <div className="mt-3 rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                  {meshcoreNeighborError}
                </div>
              )}

            {/* MeshCore: trace path result */}
            {protocol === 'meshcore' && !isOurNode && meshcoreTraceResult && (
              <div className="mt-3 space-y-1">
                <h4 className="text-muted text-xs font-medium tracking-wide uppercase">
                  Path Trace
                </h4>
                <div className="bg-secondary-dark space-y-1 rounded p-2">
                  {meshcoreTraceResult.pathSnrs.map((hop, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="text-muted">Hop {i + 1}</span>
                      <span
                        className={`font-mono ${hop >= 5 ? 'text-green-400' : hop >= 0 ? 'text-yellow-400' : 'text-red-400'}`}
                      >
                        {hop.toFixed(2)} dB
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 border-t border-gray-700 pt-1 text-xs">
                    <span className="text-muted">Last hop (dest)</span>
                    <span
                      className={`font-mono ${meshcoreTraceResult.lastSnr >= 5 ? 'text-green-400' : meshcoreTraceResult.lastSnr >= 0 ? 'text-yellow-400' : 'text-red-400'}`}
                    >
                      {meshcoreTraceResult.lastSnr.toFixed(2)} dB
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* MeshCore: telemetry */}
            {protocol === 'meshcore' && !isOurNode && meshcoreNodeTelemetry && showTelemetry && (
              <div className="mt-3 space-y-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-muted text-xs font-medium tracking-wide uppercase">
                    Sensor telemetry (LPP)
                  </h4>
                  <div className="flex items-center gap-2">
                    <span className="text-muted text-xs">
                      {new Date(meshcoreNodeTelemetry.fetchedAt).toLocaleTimeString()}
                    </span>
                    <button
                      onClick={() => {
                        setShowTelemetry(false);
                      }}
                      className="text-muted text-xs hover:text-gray-300"
                    >
                      Hide
                    </button>
                  </div>
                </div>
                <div className="bg-secondary-dark grid grid-cols-2 gap-x-4 gap-y-1 rounded p-2 text-xs">
                  {meshcoreNodeTelemetry.temperature !== undefined && (
                    <>
                      <div className="text-muted">Temperature</div>
                      <div className="font-mono text-gray-200">
                        {meshcoreNodeTelemetry.temperature.toFixed(1)} °C
                      </div>
                    </>
                  )}
                  {meshcoreNodeTelemetry.relativeHumidity !== undefined && (
                    <>
                      <div className="text-muted">Humidity</div>
                      <div className="font-mono text-gray-200">
                        {meshcoreNodeTelemetry.relativeHumidity.toFixed(1)} %
                      </div>
                    </>
                  )}
                  {meshcoreNodeTelemetry.barometricPressure !== undefined && (
                    <>
                      <div className="text-muted">Pressure</div>
                      <div className="font-mono text-gray-200">
                        {meshcoreNodeTelemetry.barometricPressure.toFixed(1)} hPa
                      </div>
                    </>
                  )}
                  {meshcoreNodeTelemetry.voltage !== undefined && (
                    <>
                      <div className="text-muted">Voltage</div>
                      <div className="font-mono text-gray-200">
                        {meshcoreNodeTelemetry.voltage.toFixed(2)} V
                      </div>
                    </>
                  )}
                  {meshcoreNodeTelemetry.gps && (
                    <>
                      <div className="text-muted">GPS</div>
                      <div className="font-mono text-gray-200">
                        {formatCoordPair(
                          meshcoreNodeTelemetry.gps.latitude,
                          meshcoreNodeTelemetry.gps.longitude,
                          coordinateFormat,
                        )}
                      </div>
                    </>
                  )}
                  {meshcoreNodeTelemetry.entries.length === 0 && (
                    <>
                      <div className="text-muted col-span-2 italic">No LPP sensor data</div>
                      {node.latitude != null && node.longitude != null ? (
                        <div className="text-muted col-span-2 text-xs">
                          Map position is from advert/contact data, not this request.
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* MeshCore: neighbors (from Repeater) */}
            {protocol === 'meshcore' &&
              !isOurNode &&
              meshcoreNeighbors &&
              showMeshcoreNeighbors && (
                <div className="mt-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-muted text-xs font-medium tracking-wide uppercase">
                      Neighbors ({meshcoreNeighbors.totalNeighboursCount})
                    </h4>
                    <button
                      onClick={() => {
                        setShowMeshcoreNeighbors(false);
                      }}
                      className="text-muted text-xs hover:text-gray-300"
                    >
                      Hide
                    </button>
                  </div>
                  <div className="space-y-1">
                    {meshcoreNeighbors.neighbours.map((nb, i) => {
                      const label =
                        nb.resolvedNodeId !== 0
                          ? (nodes?.get(nb.resolvedNodeId)?.long_name ??
                            `!${nb.resolvedNodeId.toString(16)}`)
                          : nb.prefixHex;
                      return (
                        <div
                          key={i}
                          className="bg-secondary-dark flex items-center justify-between rounded px-2 py-1 text-xs"
                        >
                          <div>
                            <span className="text-gray-300">{label}</span>
                            <span className="text-muted ml-2">
                              {formatSecondsAgo(nb.heardSecondsAgo)}
                            </span>
                          </div>
                          <SnrIndicator snr={nb.snr} />
                        </div>
                      );
                    })}
                    {meshcoreNeighbors.neighbours.length === 0 && (
                      <div className="text-muted px-2 text-xs italic">No neighbors reported</div>
                    )}
                  </div>
                </div>
              )}

            {/* Foreign LoRa activity — shown for connected device only; all senders in last 90 min */}
            {isOurNode &&
              (() => {
                const list = getForeignLoraDetectionsList(node.node_id);
                if (list.length === 0) return null;
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
                  <div className="mt-3 space-y-2">
                    <h4 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-orange-400 uppercase">
                      <span aria-hidden="true">⚠</span>
                      Foreign LoRa Activity (last 90 min)
                    </h4>
                    {list.map((detection, i) => {
                      const minutesAgo = Math.floor((Date.now() - detection.detectedAt) / 60_000);
                      const senderName =
                        detection.longName ??
                        (detection.lastSenderId
                          ? nodes?.get(detection.lastSenderId)?.long_name ||
                            nodes?.get(detection.lastSenderId)?.short_name
                          : undefined);
                      return (
                        <div
                          key={`${detection.packetClass}-${detection.lastSenderId ?? 'na'}-${detection.detectedAt}-${i}`}
                          className="bg-secondary-dark grid grid-cols-2 gap-x-4 gap-y-1 rounded p-2 text-xs"
                        >
                          <div className="text-muted">Class</div>
                          <div className="text-gray-200">
                            {classLabels[detection.packetClass] ?? detection.packetClass}
                          </div>
                          <div className="text-muted">Proximity</div>
                          <div className="text-gray-200">
                            {proximityLabels[detection.proximity] ?? detection.proximity}
                          </div>
                          <div className="text-muted">Last Seen</div>
                          <div className="text-gray-200">
                            {minutesAgo < 1 ? 'Just now' : `${minutesAgo}m ago`}
                          </div>
                          <div className="text-muted">Count</div>
                          <div className="text-gray-200">{detection.count}×</div>
                          {(detection.rssi !== undefined || detection.snr !== undefined) && (
                            <>
                              <div className="text-muted">Signal</div>
                              <div className="font-mono text-gray-200">
                                {detection.rssi !== undefined ? `RSSI ${detection.rssi} dBm` : ''}
                                {detection.rssi !== undefined && detection.snr !== undefined
                                  ? ', '
                                  : ''}
                                {detection.snr !== undefined
                                  ? `SNR ${detection.snr.toFixed(1)} dB`
                                  : ''}
                              </div>
                            </>
                          )}
                          {detection.lastSenderId != null && (
                            <>
                              <div className="text-muted">Sender</div>
                              <div className="font-mono text-gray-200">
                                !{detection.lastSenderId.toString(16).padStart(8, '0')}
                                {senderName ? ` (${senderName})` : ''}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

            {/* MeshCore: repeater status */}
            {protocol === 'meshcore' &&
              !isOurNode &&
              meshcoreRepeaterStatus &&
              showRepeaterStats && (
                <div className="mt-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-muted text-xs font-medium tracking-wide uppercase">
                      Repeater Status
                    </h4>
                    <button
                      onClick={() => {
                        setShowRepeaterStats(false);
                      }}
                      className="text-muted text-xs hover:text-gray-300"
                    >
                      Hide
                    </button>
                  </div>
                  <div className="bg-secondary-dark grid grid-cols-2 gap-x-4 gap-y-1 rounded p-2 text-xs">
                    <div className="text-muted">Battery</div>
                    <div className="font-mono text-gray-200">
                      {(meshcoreRepeaterStatus.battMilliVolts / 1000).toFixed(2)} V
                    </div>
                    <div className="text-muted">Noise Floor</div>
                    <div className="font-mono text-gray-200">
                      {meshcoreRepeaterStatus.noiseFloor} dBm
                    </div>
                    <div className="text-muted">Last RSSI</div>
                    <div className="font-mono text-gray-200">
                      {meshcoreRepeaterStatus.lastRssi} dBm
                    </div>
                    <div className="text-muted">Last SNR</div>
                    <div className="font-mono text-gray-200">
                      {meshcoreRepeaterStatus.lastSnr.toFixed(2)} dB
                    </div>
                    <div className="text-muted">Pkts Recv / Sent</div>
                    <div className="font-mono text-gray-200">
                      {meshcoreRepeaterStatus.nPacketsRecv} / {meshcoreRepeaterStatus.nPacketsSent}
                    </div>
                    <div className="text-muted">Air Time</div>
                    <div className="font-mono text-gray-200">
                      {meshcoreRepeaterStatus.totalAirTimeSecs}s
                    </div>
                    <div className="text-muted">Uptime</div>
                    <div className="font-mono text-gray-200">
                      {Math.floor(meshcoreRepeaterStatus.totalUpTimeSecs / 60)}m
                    </div>
                    <div className="text-muted">TX Queue</div>
                    <div className="font-mono text-gray-200">
                      {meshcoreRepeaterStatus.currTxQueueLen}
                    </div>
                    <div className="text-muted">Flood / Direct sent</div>
                    <div className="font-mono text-gray-200">
                      {meshcoreRepeaterStatus.nSentFlood} / {meshcoreRepeaterStatus.nSentDirect}
                    </div>
                    <div className="text-muted">Flood / Direct recv</div>
                    <div className="font-mono text-gray-200">
                      {meshcoreRepeaterStatus.nRecvFlood} / {meshcoreRepeaterStatus.nRecvDirect}
                    </div>
                    <div className="text-muted">Errors</div>
                    <div className="font-mono text-gray-200">
                      {meshcoreRepeaterStatus.errEvents}
                    </div>
                    <div className="text-muted">Dups (direct / flood)</div>
                    <div className="font-mono text-gray-200">
                      {meshcoreRepeaterStatus.nDirectDups} / {meshcoreRepeaterStatus.nFloodDups}
                    </div>
                  </div>
                </div>
              )}
          </div>

          {/* Neighbors section */}
          {neighborInfo &&
            (() => {
              const record = neighborInfo.get(node.node_id);
              if (!record || record.neighbors.length === 0) return null;
              return (
                <div className="space-y-2 px-5 pb-2">
                  <h4 className="text-muted text-xs font-medium tracking-wide uppercase">
                    Neighbors ({record.neighbors.length})
                  </h4>
                  <div className="space-y-1">
                    {record.neighbors.map((nb) => {
                      const nbNode = nodes?.get(nb.nodeId);
                      const label = nbNode?.short_name || `!${nb.nodeId.toString(16)}`;
                      return (
                        <div
                          key={nb.nodeId}
                          className="bg-secondary-dark flex items-center justify-between rounded px-2 py-1 text-xs"
                        >
                          <span className="text-gray-300">{label}</span>
                          <span className="text-xs text-gray-500">
                            {formatSecondsAgo(
                              Math.max(0, Math.floor(Date.now() / 1000 - nb.lastRxTime)),
                            )}
                          </span>
                          <SnrIndicator snr={nb.snr} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

          {/* PaxCounter section (Meshtastic only) */}
          {protocol === 'meshtastic' &&
            paxCounterData &&
            (() => {
              const paxData = paxCounterData.get(node.node_id);
              if (!paxData) return null;
              return (
                <div className="space-y-2 px-5 pb-2">
                  <h4 className="text-muted text-xs font-medium tracking-wide uppercase">
                    Pax Counter
                  </h4>
                  <div className="bg-secondary-dark grid grid-cols-2 gap-x-4 gap-y-1 rounded p-2 text-xs">
                    <div className="text-muted">Detected Count</div>
                    <div className="font-mono text-gray-200">{paxData.count}</div>
                    <div className="text-muted">Last Seen</div>
                    <div className="font-mono text-gray-200">
                      {formatSecondsAgo(
                        Math.max(0, Math.floor((Date.now() - paxData.timestamp) / 1000)),
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

          {/* Detection Sensor section (Meshtastic only) */}
          {protocol === 'meshtastic' &&
            detectionSensorEvents &&
            (() => {
              const sensorEvents = detectionSensorEvents.get(node.node_id);
              if (!sensorEvents || sensorEvents.length === 0) return null;
              const latestEvent = sensorEvents[sensorEvents.length - 1];
              return (
                <div className="space-y-2 px-5 pb-2">
                  <h4 className="text-muted text-xs font-medium tracking-wide uppercase">
                    Detection Sensor ({sensorEvents.length})
                  </h4>
                  <div className="bg-secondary-dark grid grid-cols-2 gap-x-4 gap-y-1 rounded p-2 text-xs">
                    <div className="text-muted">Last Detection</div>
                    <div className="font-mono text-gray-200">
                      {formatSecondsAgo(
                        Math.max(0, Math.floor((Date.now() - latestEvent.timestamp) / 1000)),
                      )}
                    </div>
                    <div className="text-muted">Data Size</div>
                    <div className="font-mono text-gray-200">{latestEvent.data.length} bytes</div>
                    <div className="text-muted col-span-2">Raw Data (hex)</div>
                    <div className="col-span-2 font-mono text-[10px] break-all text-gray-200">
                      {Array.from(latestEvent.data)
                        .map((b) => b.toString(16).padStart(2, '0'))
                        .join(' ')}
                    </div>
                  </div>
                </div>
              );
            })()}

          {/* Map Report section (Meshtastic only) */}
          {protocol === 'meshtastic' && mapReports && (
            <div className="space-y-2 px-5 pb-2">
              <h4 className="text-muted text-xs font-medium tracking-wide uppercase">Map Report</h4>
              {(() => {
                const mapReport = mapReports.get(node.node_id);
                if (!mapReport) {
                  return <p className="text-xs text-gray-500">No map report received</p>;
                }
                return (
                  <div className="bg-secondary-dark grid grid-cols-2 gap-x-4 gap-y-1 rounded p-2 text-xs">
                    <div className="text-muted">Last Report</div>
                    <div className="font-mono text-gray-200">
                      {formatSecondsAgo(
                        Math.max(0, Math.floor((Date.now() - mapReport.timestamp) / 1000)),
                      )}
                    </div>
                    <div className="text-muted">Data</div>
                    <div className="font-mono text-gray-200">
                      {mapReport.data ? JSON.stringify(mapReport.data).slice(0, 50) : 'N/A'}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Footer actions — omitted for directly connected node (no position/trace/message to self) */}
          {!isOurNode && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-700 px-5 py-3">
              {protocol !== 'meshcore' && (
                <button
                  onClick={handleRequestPosition}
                  disabled={!isConnected || positionRequestedAt !== null}
                  className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  📍 Request Position
                </button>
              )}
              <button
                onClick={handleTraceRoute}
                disabled={!isConnected || traceRoutePending}
                className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                🛤 {traceRoutePending ? 'Tracing...' : 'Trace Route'}
              </button>
              {protocol === 'meshcore' && onRequestRepeaterStatus && (
                <button
                  onClick={async () => {
                    if (!(await ensureConfigured())) return;
                    setRepeaterStatusPending(true);
                    setActionStatus('Requesting status...');
                    try {
                      await onRequestRepeaterStatus(node.node_id);
                      setActionStatus(null);
                    } catch (e) {
                      console.warn('[NodeDetailModal] requestRepeaterStatus failed', e);
                      setActionStatus(e instanceof Error ? e.message : 'Status request failed');
                    } finally {
                      setRepeaterStatusPending(false);
                    }
                  }}
                  disabled={!isConnected || repeaterStatusPending}
                  className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  📊 {repeaterStatusPending ? 'Requesting...' : 'Request Status'}
                </button>
              )}
              {protocol === 'meshcore' && onRequestTelemetry && (
                <button
                  type="button"
                  title="Cayenne LPP sensor payload (not advert GPS on the map)"
                  aria-label="Sensor telemetry LPP"
                  onClick={async () => {
                    if (!(await ensureConfigured())) return;
                    setTelemetryPending(true);
                    setActionStatus('Requesting sensor telemetry (LPP)...');
                    try {
                      await onRequestTelemetry(node.node_id);
                      setActionStatus(null);
                    } catch (e) {
                      console.warn('[NodeDetailModal] requestTelemetry failed', e);
                      setActionStatus(
                        e instanceof Error ? e.message : `Telemetry failed: ${String(e)}`,
                      );
                    } finally {
                      setTelemetryPending(false);
                    }
                  }}
                  disabled={!isConnected || telemetryPending}
                  className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  🌡 {telemetryPending ? 'Requesting...' : 'Sensor telemetry'}
                </button>
              )}
              {protocol === 'meshcore' && onRequestNeighbors && node.hw_model === 'Repeater' && (
                <button
                  onClick={async () => {
                    if (!(await ensureConfigured())) return;
                    setNeighborsPending(true);
                    setActionStatus('Requesting neighbors...');
                    try {
                      await onRequestNeighbors(node.node_id);
                      setActionStatus(null);
                    } catch (e) {
                      console.warn('[NodeDetailModal] requestNeighbors failed', e);
                      setActionStatus(
                        e instanceof Error ? e.message : `Neighbors failed: ${String(e)}`,
                      );
                    } finally {
                      setNeighborsPending(false);
                    }
                  }}
                  disabled={!isConnected || neighborsPending}
                  className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  🔗 {neighborsPending ? 'Requesting...' : 'Get Neighbors'}
                </button>
              )}
              {onMessageNode && (
                <button
                  onClick={() => {
                    onMessageNode(node.node_id);
                    onClose();
                  }}
                  disabled={!isConnected}
                  className="min-w-[8rem] flex-1 rounded-lg bg-purple-700/50 px-3 py-2 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-600/50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  💬 Message
                </button>
              )}
              {protocol === 'meshcore' && onExportContact && (
                <button
                  onClick={async () => {
                    if (!(await ensureConfigured())) return;
                    setExportContactPending(true);
                    setActionStatus('Exporting contact...');
                    try {
                      const advert = await onExportContact(node.node_id);
                      if (advert) {
                        const blob = new Blob([advert.buffer as ArrayBuffer], {
                          type: 'application/octet-stream',
                        });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `contact-${node.node_id.toString(16)}.bin`;
                        link.click();
                        URL.revokeObjectURL(url);
                        setActionStatus(null);
                      } else {
                        setActionStatus('No public key available');
                      }
                    } catch (e) {
                      console.warn('[NodeDetailModal] exportContact failed', e);
                      setActionStatus(e instanceof Error ? e.message : 'Export failed');
                    } finally {
                      setExportContactPending(false);
                    }
                  }}
                  disabled={!isConnected || exportContactPending}
                  className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  📤 {exportContactPending ? 'Exporting...' : 'Export Contact'}
                </button>
              )}
              {protocol === 'meshcore' && onShareContact && (
                <button
                  onClick={async () => {
                    if (!(await ensureConfigured())) return;
                    setShareContactPending(true);
                    setActionStatus('Sharing contact...');
                    try {
                      const success = await onShareContact(node.node_id);
                      setActionStatus(success ? null : 'Share failed');
                    } catch (e) {
                      console.warn('[NodeDetailModal] shareContact failed', e);
                      setActionStatus(e instanceof Error ? e.message : 'Share failed');
                    } finally {
                      setShareContactPending(false);
                    }
                  }}
                  disabled={!isConnected || shareContactPending}
                  className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  📨 {shareContactPending ? 'Sharing...' : 'Share Contact'}
                </button>
              )}
            </div>
          )}

          {/* MQTT Ignore toggle */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-700/50 px-5 py-2">
            <div>
              <div className="text-xs font-medium text-gray-300">MQTT Ignore</div>
              <div className="text-muted text-xs">
                Exclude this node's MQTT data from diagnostics
              </div>
            </div>
            <button
              onClick={() => {
                setNodeMqttIgnored(node.node_id, !mqttIgnoredNodes.has(node.node_id));
              }}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                mqttIgnoredNodes.has(node.node_id) ? 'bg-yellow-500' : 'bg-gray-600'
              }`}
              role="switch"
              aria-checked={mqttIgnoredNodes.has(node.node_id)}
              title={
                mqttIgnoredNodes.has(node.node_id)
                  ? 'Stop ignoring MQTT for this node'
                  : 'Ignore MQTT for this node'
              }
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  mqttIgnoredNodes.has(node.node_id) ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Action status */}
          {actionStatus && (
            <div className="shrink-0 px-5 pb-3">
              <div className="text-muted text-center text-xs">{actionStatus}</div>
            </div>
          )}

          {/* Delete node */}
          <div className="shrink-0 px-5 pb-4">
            {!showDeleteConfirm ? (
              <button
                onClick={() => {
                  setShowDeleteConfirm(true);
                }}
                className="mt-2 w-full rounded-lg border border-red-900/50 bg-red-900/30 px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-900/50 hover:text-red-300"
              >
                Delete Node
              </button>
            ) : (
              <div className="mt-2 rounded-lg border border-red-900/50 bg-red-900/20 p-3">
                <p className="mb-2 text-xs text-red-300">
                  Remove this node from local database? It will reappear when it broadcasts again.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(false);
                    }}
                    className="bg-secondary-dark flex-1 rounded px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => onDeleteNode(node.node_id).then(onClose)}
                    className="flex-1 rounded bg-red-800 px-3 py-1.5 text-xs text-white transition-colors hover:bg-red-700"
                  >
                    Confirm Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {RemoteAuthModal}
    </>
  );
}
