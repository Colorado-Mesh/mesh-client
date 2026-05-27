/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs, react-hooks/purity */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  isValidMeshtasticAdminKeyBase64,
  normalizeMeshtasticAdminKeyInput,
} from '@/renderer/lib/meshtasticRemoteAdminKeyStorage';
import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';

import { useMeshcoreRepeaterRemoteAuth } from '../hooks/useMeshcoreRepeaterRemoteAuth';
import { formatCoordPair } from '../lib/coordUtils';
import { meshtasticHwModelDisplay } from '../lib/hardwareModels';
import type {
  MeshCoreNeighborResult,
  MeshCoreNodeTelemetry,
  MeshCoreRepeaterStatus,
} from '../lib/meshcore/meshcoreHookTypes';
import {
  MESHCORE_CHAT_STUB_ID_MAX,
  MESHCORE_CHAT_STUB_ID_MIN,
  MESHCORE_CONTACTS_CRITICAL_THRESHOLD,
  MESHCORE_MAX_CONTACTS,
  meshcoreTracePathLenToHops,
} from '../lib/meshcoreUtils';
import { getNodeStatus } from '../lib/nodeStatus';
import { useRadioProvider } from '../lib/radio/providerFactory';
import { MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS } from '../lib/timeConstants';
import type { MeshCoreLocalStats, MeshNode, MeshProtocol, NeighborInfoRecord } from '../lib/types';
import { useCoordFormatStore } from '../stores/coordFormatStore';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { useWatchedNodesStore } from '../stores/watchedNodesStore';
import { HelpTooltip } from './HelpTooltip';
import NodeInfoBody, { formatSecondsAgo } from './NodeInfoBody';
import SnrIndicator from './SnrIndicator';

const TRACE_ROUTE_UI_TIMEOUT_MS = 120_000;
const POSITION_HISTORY_MAX_ROWS = 100;

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
  meshcorePingError?: string;
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
  /** Local stats for MeshCore connected node (Type 1 & 2) */
  meshcoreLocalStats?: MeshCoreLocalStats | null;
  /** MeshCore: local radio manufacturer/model from `deviceQuery` (our node only in body). */
  meshcoreManufacturerModel?: string;
  /** GPS position history (tracking path) for mobile nodes */
  positionHistory?: Map<number, { t: number; lat: number; lon: number }[]>;
  onShowOnMap?: (nodeId: number, lat: number, lon: number) => void;
  /** Meshtastic PKC: base64 admin public key saved for this node (one per node). */
  remoteAdminKey?: string;
  /** Persist admin key for remote admin (base64, 32-byte public key). */
  onSaveRemoteAdminKey?: (nodeNum: number, adminKeyBase64: string | null) => Promise<void>;
  /** Open Radio tab with this node as remote configure target. */
  onConfigureRemotely?: (nodeNum: number) => void;
  /** Saved admin key for this node (enables configure remotely). */
  hasRemoteAdminKey?: boolean;
}

function WatchToggleButton({ nodeId }: { nodeId: number }) {
  const { t } = useTranslation();
  const isWatched = useWatchedNodesStore((s) => s.watchedNodeIds.has(nodeId));
  const toggleWatch = useWatchedNodesStore((s) => s.toggleWatch);
  return (
    <button
      aria-label={isWatched ? t('nodeDetailModal.unwatchNode') : t('nodeDetailModal.watchNode')}
      aria-pressed={isWatched}
      className={`hover:bg-secondary-dark shrink-0 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${isWatched ? 'text-blue-400' : 'text-gray-500 hover:text-blue-400'}`}
      onClick={() => {
        toggleWatch(nodeId);
      }}
    >
      {isWatched ? t('nodeDetailModal.unwatchNode') : t('nodeDetailModal.watchNode')}
    </button>
  );
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
  meshcorePingError,
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
  meshcoreLocalStats,
  meshcoreManufacturerModel,
  positionHistory,
  onShowOnMap,
  remoteAdminKey,
  onSaveRemoteAdminKey,
  onConfigureRemotely,
  hasRemoteAdminKey,
}: NodeDetailModalProps) {
  const { t } = useTranslation();
  const { ensureConfigured, RemoteAuthModal } = useMeshcoreRepeaterRemoteAuth();
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [adminKeyStatus, setAdminKeyStatus] = useState<string | null>(null);
  const [adminKeyDraft, setAdminKeyDraft] = useState('');
  const [adminKeyError, setAdminKeyError] = useState<string | null>(null);
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
  const [radioContactCount, setRadioContactCount] = useState<number | null>(null);
  const [contactOnRadio, setContactOnRadio] = useState<boolean | null>(null);
  const [addRemoveLoading, setAddRemoveLoading] = useState(false);
  const [nodeNote, setNodeNote] = useState('');
  const noteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingNoteRef = useRef<string | null>(null);
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

  useEffect(() => {
    setAdminKeyDraft(remoteAdminKey ?? '');
    setAdminKeyError(null);
  }, [node?.node_id, remoteAdminKey]);

  useEffect(() => {
    if (!node) return;
    const nodeId = node.node_id;
    let cancelled = false;
    void window.electronAPI.db.getNodeNote(nodeId).then((note: string | null) => {
      if (!cancelled) setNodeNote(note ?? '');
    });
    return () => {
      cancelled = true;
      if (noteSaveTimerRef.current) {
        clearTimeout(noteSaveTimerRef.current);
        noteSaveTimerRef.current = null;
        if (pendingNoteRef.current !== null) {
          void window.electronAPI.db.setNodeNote(nodeId, pendingNoteRef.current);
          pendingNoteRef.current = null;
        }
      }
    };
  }, [node?.node_id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setAdminKeyStatus(null);
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

  // Detect position update after a request was sent (gate on state, not ref — avoids flash on open)
  useEffect(() => {
    if (positionRequestedAt === null) return;
    setPositionRequestedAt(null);
    setActionStatus(t('nodeDetailModal.positionUpdated'));
  }, [node?.latitude, node?.longitude, positionRequestedAt, t]);

  // 30-second timeout for position request
  useEffect(() => {
    if (!positionRequestedAt) return;
    const timer = setTimeout(() => {
      setPositionRequestedAt(null);
      setActionStatus(t('nodeDetailModal.positionRequestTimedOut'));
    }, 30_000);
    return () => {
      clearTimeout(timer);
    };
  }, [positionRequestedAt, t]);

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

  // Fetch on_radio status and contact count for MeshCore
  const [contactPubkey, setContactPubkey] = useState<string | null>(null);
  useEffect(() => {
    if (protocol !== 'meshcore' || !node) {
      setContactOnRadio(null);
      setRadioContactCount(null);
      setContactPubkey(null);
      return;
    }
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const contact = await window.electronAPI.db.getMeshcoreContactById(node.node_id);
        if (!cancelled) {
          if (contact && 'on_radio' in contact) {
            // on_radio: 1 = on radio, 0 = only in DB, null = treat as on radio (legacy data)
            setContactOnRadio(contact.on_radio !== 0);
            setContactPubkey(contact.public_key ?? null);
          } else {
            setContactOnRadio(true);
            setContactPubkey(null);
          }
        }
      } catch {
        // catch-no-log-ok handle gracefully - show as unknown
        if (!cancelled) {
          setContactOnRadio(null);
          setContactPubkey(null);
        }
      }
      try {
        const count = await window.electronAPI.db.getMeshcoreContactCount();
        if (!cancelled) {
          setRadioContactCount(count);
        }
      } catch {
        // catch-no-log-ok handle gracefully - show as unknown
        if (!cancelled) setRadioContactCount(null);
      }
    };
    void fetchStatus();
    return () => {
      cancelled = true;
    };
  }, [protocol, node]);

  // Align with MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS (queue + tracePath in useMeshCore)
  useEffect(() => {
    if (!traceRoutePending) return;
    const timer = setTimeout(
      () => {
        setTraceRoutePending(false);
        setActionStatus(t('nodeDetailModal.traceRouteTimedOut'));
      },
      Math.max(MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS, TRACE_ROUTE_UI_TIMEOUT_MS),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [traceRoutePending, t]);

  const { nodeStaleThresholdMs, nodeOfflineThresholdMs } = useRadioProvider(
    protocol ?? 'meshtastic',
  );

  if (!node) return null;

  const hexId = formatMeshtasticNodeId(node.node_id);
  // Check if this appears to be a node with incomplete data (empty names and no role)
  const isIncomplete = !node.short_name && !node.long_name && node.role === undefined;
  const displayName = node.short_name || node.long_name || hexId;
  const isOurNode = node.node_id === homeNode?.node_id;
  const nodeStatus = getNodeStatus(node.last_heard, nodeStaleThresholdMs, nodeOfflineThresholdMs);
  const nodeStatusUi =
    nodeStatus === 'online'
      ? {
          label: t('nodeDetailModal.statusOnline'),
          dotClass: 'bg-brand-green',
          textClass: 'text-brand-green',
        }
      : nodeStatus === 'stale'
        ? {
            label: t('nodeDetailModal.statusStale'),
            dotClass: 'bg-violet-400',
            textClass: 'text-violet-300',
          }
        : {
            label: t('nodeDetailModal.statusOffline'),
            dotClass: 'bg-slate-400',
            textClass: 'text-slate-300',
          };

  const headerHardwareSubtitle =
    protocol === 'meshtastic'
      ? meshtasticHwModelDisplay(node.hw_model)
      : protocol === 'meshcore' && isOurNode && meshcoreManufacturerModel
        ? meshcoreManufacturerModel
        : node.hw_model?.trim() || null;

  const headerHopsDisplay =
    protocol === 'meshcore' && meshcoreTraceResult != null
      ? meshcoreTracePathLenToHops(meshcoreTraceResult.pathLen)
      : node.hops_away;

  const handleRequestPosition = async () => {
    setPositionRequestedAt(Date.now());
    setActionStatus(t('nodeDetailModal.requestingPosition'));
    try {
      await onRequestPosition(node.node_id);
    } catch (e) {
      console.warn('[NodeDetailModal] request position failed ' + errLikeToLogString(e));
      setPositionRequestedAt(null);
      setActionStatus(t('nodeDetailModal.positionRequestFailed'));
    }
  };

  const handleTraceRoute = async () => {
    setTraceRoutePending(true);
    setActionStatus(t('nodeDetailModal.traceRouteRequested'));
    try {
      await onTraceRoute(node.node_id);
    } finally {
      setTraceRoutePending(false);
    }
  };

  const traceHardDisabled = !isConnected;
  const traceBlockReason = !isConnected ? t('nodeDetailModal.connectRadioFirst') : null;

  return (
    <>
      <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
        <button
          type="button"
          aria-label={t('aria.closeDialog')}
          className="absolute inset-0 cursor-pointer border-0 bg-black/50 p-0"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="node-modal-title"
          className="bg-deep-black relative z-10 flex max-h-[90vh] min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-xl border border-gray-700 shadow-2xl"
        >
          {/* Header */}
          <div className="flex shrink-0 items-start justify-between border-b border-gray-700 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 id="node-modal-title" className="truncate text-lg font-semibold text-gray-100">
                  {displayName}
                </h3>
                {mqttIgnoredNodes.has(node.node_id) && (
                  <span className="shrink-0 rounded border border-yellow-500/30 bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-300">
                    {t('nodeDetailModal.mqttIgnoredBadge')}
                  </span>
                )}
                {isIncomplete && (
                  <span
                    className="shrink-0 rounded border border-blue-500/30 bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-300"
                    title={t('nodeDetailModal.nodeIncomplete')}
                  >
                    {t('nodeDetailModal.loadingBadge')}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-muted font-mono text-xs">{hexId}</span>
                {headerHopsDisplay != null && (
                  <span
                    className={`text-xs ${headerHopsDisplay === 0 ? 'text-bright-green' : 'text-gray-400'}`}
                    title={
                      protocol === 'meshcore' && meshcoreTraceResult != null
                        ? t('nodeDetailModal.hopsFromTraceTitle')
                        : t('nodeDetailModal.hopsFromRoutingTitle')
                    }
                  >
                    {t('nodeDetailModal.hopLabel', { count: headerHopsDisplay })}
                  </span>
                )}
                {headerHardwareSubtitle != null && (
                  <span className="text-muted text-xs">{headerHardwareSubtitle}</span>
                )}
                {/* MeshCore contact status badges */}
                {protocol === 'meshcore' && contactPubkey && (
                  <span
                    className="shrink-0 rounded border border-green-500/30 bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-300"
                    title={t('nodeDetailModal.hasPublicKey')}
                  >
                    🔑 DM
                  </span>
                )}
                {protocol === 'meshcore' &&
                  node.node_id >= MESHCORE_CHAT_STUB_ID_MIN &&
                  node.node_id <= MESHCORE_CHAT_STUB_ID_MAX && (
                    <span
                      className="shrink-0 rounded border border-blue-500/30 bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-300"
                      title={t('nodeDetailModal.chatOnlyNode')}
                    >
                      {t('nodeDetailModal.chatBadge')}
                    </span>
                  )}
                {protocol === 'meshcore' && contactOnRadio === false && contactPubkey && (
                  <span
                    className="shrink-0 rounded border border-orange-500/30 bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-medium text-orange-300"
                    title={t('nodeDetailModal.dbOnlyContact')}
                  >
                    {t('nodeDetailModal.onlyInDbBadge')}
                  </span>
                )}
                {protocol === 'meshcore' && contactOnRadio === true && contactPubkey && (
                  <span
                    className="shrink-0 rounded border border-green-500/30 bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-300"
                    title={t('nodeDetailModal.syncedContact')}
                  >
                    {t('nodeDetailModal.syncedBadge')}
                  </span>
                )}
                {protocol === 'meshcore' && contactOnRadio === true && !contactPubkey && (
                  <span
                    className="shrink-0 rounded border border-blue-500/30 bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-300"
                    title={t('nodeDetailModal.radioOnlyContact')}
                  >
                    {t('nodeDetailModal.onRadioBadge')}
                  </span>
                )}
                {protocol === 'meshcore' &&
                  radioContactCount !== null &&
                  typeof MESHCORE_CONTACTS_CRITICAL_THRESHOLD === 'number' &&
                  radioContactCount >= MESHCORE_CONTACTS_CRITICAL_THRESHOLD && (
                    <span
                      className="shrink-0 rounded border border-red-500/30 bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-300"
                      title={t('nodeDetailModal.radioCapacityTitle', {
                        current: radioContactCount,
                        max: MESHCORE_MAX_CONTACTS ?? 'unknown',
                      })}
                    >
                      ⚠️ {radioContactCount}/{MESHCORE_MAX_CONTACTS ?? 'unknown'}
                    </span>
                  )}
              </div>
            </div>
            <div className="ml-3 flex shrink-0 flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                <WatchToggleButton nodeId={node.node_id} />
                <button
                  onClick={() => {
                    onToggleFavorite(node.node_id, !node.favorited);
                  }}
                  className="hover:bg-secondary-dark shrink-0 rounded-lg p-1.5 transition-colors"
                  aria-label={
                    node.favorited
                      ? t('nodeDetailModal.removeFromFavorites')
                      : t('nodeDetailModal.addToFavorites')
                  }
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
                  aria-label={t('aria.closeDialog')}
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
              <span
                className={`flex items-center gap-1 text-[11px] font-medium ${nodeStatusUi.textClass}`}
                title={t('nodeDetailModal.currentNodeStatus')}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${nodeStatusUi.dotClass}`} />
                {nodeStatusUi.label}
              </span>
            </div>
          </div>

          {/* Body + footer actions — single scroll region so remote admin and controls stay reachable */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="px-5 py-3">
              <NodeInfoBody
                node={node}
                homeNode={homeNode}
                traceRouteHops={isOurNode ? undefined : traceRouteHops}
                nodes={nodes}
                useFahrenheit={useFahrenheit}
                protocol={protocol}
                meshcoreManufacturerModel={meshcoreManufacturerModel}
                positionHistory={positionHistory}
                onShowOnMap={onShowOnMap}
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

              {/* MeshCore: trace error */}
              {protocol === 'meshcore' && !isOurNode && meshcorePingError && (
                <div className="mt-3 rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                  {meshcorePingError}
                </div>
              )}

              {/* MeshCore: trace path result */}
              {protocol === 'meshcore' && !isOurNode && meshcoreTraceResult && (
                <div className="mt-3 space-y-1">
                  <h4 className="text-muted text-xs font-medium tracking-wide uppercase">
                    {t('nodeDetailModal.pathTraceHeading')}
                  </h4>
                  <div className="text-xs text-gray-400">
                    {t('nodeDetailModal.hopsLabel')}{' '}
                    <span className="font-mono text-gray-200">
                      {meshcoreTracePathLenToHops(meshcoreTraceResult.pathLen)}
                    </span>
                  </div>
                  <div className="bg-secondary-dark space-y-1 rounded p-2">
                    {(Array.isArray(meshcoreTraceResult.pathSnrs)
                      ? meshcoreTraceResult.pathSnrs
                      : []
                    ).map((hop, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-muted w-10">
                          {t('nodeDetailModal.hopNLabel', { n: i + 1 })}
                        </span>
                        <SnrIndicator snr={hop} />
                      </div>
                    ))}
                    <div className="flex items-center gap-2 border-t border-gray-700 pt-1 text-xs">
                      <span className="text-muted w-10">{t('nodeDetailModal.destLabel')}</span>
                      <SnrIndicator snr={meshcoreTraceResult.lastSnr} />
                    </div>
                  </div>
                </div>
              )}

              {/* MeshCore: telemetry */}
              {protocol === 'meshcore' && !isOurNode && meshcoreNodeTelemetry && showTelemetry && (
                <div className="mt-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-muted text-xs font-medium tracking-wide uppercase">
                      {t('nodeDetailModal.sensorTelemetryHeading')}
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
                        {t('common.hide')}
                      </button>
                    </div>
                  </div>
                  <div className="bg-secondary-dark grid grid-cols-2 gap-x-4 gap-y-1 rounded p-2 text-xs">
                    {meshcoreNodeTelemetry.temperature !== undefined && (
                      <>
                        <div className="text-muted">{t('nodeDetailModal.temperatureLabel')}</div>
                        <div className="font-mono text-gray-200">
                          {meshcoreNodeTelemetry.temperature.toFixed(1)} °C
                        </div>
                      </>
                    )}
                    {meshcoreNodeTelemetry.relativeHumidity !== undefined && (
                      <>
                        <div className="text-muted">{t('nodeDetailModal.humidityLabel')}</div>
                        <div className="font-mono text-gray-200">
                          {meshcoreNodeTelemetry.relativeHumidity.toFixed(1)} %
                        </div>
                      </>
                    )}
                    {meshcoreNodeTelemetry.barometricPressure !== undefined && (
                      <>
                        <div className="text-muted">{t('nodeDetailModal.pressureLabel')}</div>
                        <div className="font-mono text-gray-200">
                          {meshcoreNodeTelemetry.barometricPressure.toFixed(1)} hPa
                        </div>
                      </>
                    )}
                    {meshcoreNodeTelemetry.voltage !== undefined && (
                      <>
                        <div className="text-muted">{t('nodeDetailModal.voltageLabel')}</div>
                        <div className="font-mono text-gray-200">
                          {meshcoreNodeTelemetry.voltage.toFixed(2)} V
                        </div>
                      </>
                    )}
                    {meshcoreNodeTelemetry.gps && (
                      <>
                        <div className="text-muted">{t('nodeDetailModal.gpsLabel')}</div>
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
                        <div className="text-muted col-span-2 italic">
                          {t('nodeDetailModal.noLppSensorData')}
                        </div>
                        {node.latitude != null && node.longitude != null ? (
                          <div className="text-muted col-span-2 text-xs">
                            {t('nodeDetailModal.mapPositionFromAdvertNotRequest')}
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
                        {t('nodeDetailModal.neighborsHeading', {
                          count: meshcoreNeighbors.totalNeighboursCount,
                        })}
                      </h4>
                      <button
                        onClick={() => {
                          setShowMeshcoreNeighbors(false);
                        }}
                        className="text-muted text-xs hover:text-gray-300"
                      >
                        {t('common.hide')}
                      </button>
                    </div>
                    <div className="space-y-1">
                      {meshcoreNeighbors.neighbours.map((nb, i) => {
                        const label =
                          nb.resolvedNodeId !== 0
                            ? (nodes?.get(nb.resolvedNodeId)?.long_name ??
                              formatMeshtasticNodeId(nb.resolvedNodeId))
                            : nb.prefixHex;
                        return (
                          <div
                            key={i}
                            className="bg-secondary-dark flex items-center justify-between rounded px-2 py-1 text-xs"
                          >
                            <div>
                              <span className="text-gray-300">{label}</span>
                              <span className="text-muted ml-2">
                                {formatSecondsAgo(nb.heardSecondsAgo, t)}
                              </span>
                            </div>
                            <SnrIndicator snr={nb.snr} />
                          </div>
                        );
                      })}
                      {meshcoreNeighbors.neighbours.length === 0 && (
                        <div className="text-muted px-2 text-xs italic">
                          {t('nodeDetailModal.noNeighborsReported')}
                        </div>
                      )}
                    </div>
                  </div>
                )}

              {/* Foreign LoRa activity — shown for connected device only; all senders in last 90 min */}
              {isOurNode &&
                (() => {
                  const list = getForeignLoraDetectionsList(node.node_id);
                  if (list.length === 0) return null;
                  return (
                    <div className="mt-3 space-y-2">
                      <h4 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-orange-400 uppercase">
                        <span aria-hidden="true">⚠</span>
                        {t('diagnosticsPanel.foreignLoraHeading')}
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
                            <div className="text-muted">
                              {t('diagnosticsPanel.foreignClassColumn')}
                            </div>
                            <div className="text-gray-200">
                              {detection.packetClass === 'meshcore'
                                ? t('diagnosticsPanel.foreignClassMeshcore')
                                : detection.packetClass === 'meshtastic'
                                  ? t('diagnosticsPanel.foreignClassMeshtastic')
                                  : detection.packetClass === 'unknown-lora'
                                    ? t('diagnosticsPanel.foreignClassUnknownLora')
                                    : detection.packetClass}
                            </div>
                            <div className="text-muted">
                              {t('diagnosticsPanel.foreignProximityColumn')}
                            </div>
                            <div className="text-gray-200">
                              {detection.proximity === 'very-close'
                                ? t('diagnosticsPanel.proximityVeryClose')
                                : detection.proximity === 'nearby'
                                  ? t('diagnosticsPanel.proximityNearby')
                                  : detection.proximity === 'distant'
                                    ? t('diagnosticsPanel.proximityDistant')
                                    : detection.proximity === 'unknown'
                                      ? t('diagnosticsPanel.proximityUnknown')
                                      : detection.proximity}
                            </div>
                            <div className="text-muted">
                              {t('diagnosticsPanel.foreignLastSeenColumn')}
                            </div>
                            <div className="text-gray-200">
                              {minutesAgo < 1
                                ? t('common.justNow')
                                : t('common.minutesAgo', { count: minutesAgo })}
                            </div>
                            <div className="text-muted">
                              {t('diagnosticsPanel.foreignCountColumn')}
                            </div>
                            <div className="text-gray-200">{detection.count}×</div>
                            {(detection.rssi !== undefined || detection.snr !== undefined) && (
                              <>
                                <div className="text-muted">{t('nodeDetailModal.signalLabel')}</div>
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
                                <div className="text-muted">{t('nodeDetailModal.senderLabel')}</div>
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
                        {t('nodeDetailModal.repeaterStatusHeading')}
                      </h4>
                      <button
                        onClick={() => {
                          setShowRepeaterStats(false);
                        }}
                        className="text-muted text-xs hover:text-gray-300"
                      >
                        {t('common.hide')}
                      </button>
                    </div>
                    <div className="bg-secondary-dark grid grid-cols-2 gap-x-4 gap-y-1 rounded p-2 text-xs">
                      <div className="text-muted">{t('nodeDetailModal.batteryLabel')}</div>
                      <div className="font-mono text-gray-200">
                        {(meshcoreRepeaterStatus.battMilliVolts / 1000).toFixed(2)} V
                      </div>
                      <div className="text-muted">{t('nodeDetailModal.noiseFloorLabel')}</div>
                      <div className="font-mono text-gray-200">
                        {meshcoreRepeaterStatus.noiseFloor} dBm
                      </div>
                      <div className="text-muted">{t('nodeDetailModal.lastRssiLabel')}</div>
                      <div className="font-mono text-gray-200">
                        {meshcoreRepeaterStatus.lastRssi} dBm
                      </div>
                      <div className="text-muted">{t('nodeDetailModal.lastSnrLabel')}</div>
                      <div className="font-mono text-gray-200">
                        {meshcoreRepeaterStatus.lastSnr.toFixed(2)} dB
                      </div>
                      <div className="text-muted">{t('nodeDetailModal.pktsRecvSentLabel')}</div>
                      <div className="font-mono text-gray-200">
                        {meshcoreRepeaterStatus.nPacketsRecv} /{' '}
                        {meshcoreRepeaterStatus.nPacketsSent}
                      </div>
                      <div className="text-muted">{t('nodeDetailModal.airTimeLabel')}</div>
                      <div className="font-mono text-gray-200">
                        {meshcoreRepeaterStatus.totalAirTimeSecs}s
                      </div>
                      <div className="text-muted">{t('nodeDetailModal.uptimeLabel')}</div>
                      <div className="font-mono text-gray-200">
                        {Math.floor(meshcoreRepeaterStatus.totalUpTimeSecs / 60)}m
                      </div>
                      <div className="text-muted">{t('nodeDetailModal.txQueueLabel')}</div>
                      <div className="font-mono text-gray-200">
                        {meshcoreRepeaterStatus.currTxQueueLen}
                      </div>
                      <div className="text-muted">{t('nodeDetailModal.floodDirectSentLabel')}</div>
                      <div className="font-mono text-gray-200">
                        {meshcoreRepeaterStatus.nSentFlood} / {meshcoreRepeaterStatus.nSentDirect}
                      </div>
                      <div className="text-muted">{t('nodeDetailModal.floodDirectRecvLabel')}</div>
                      <div className="font-mono text-gray-200">
                        {meshcoreRepeaterStatus.nRecvFlood} / {meshcoreRepeaterStatus.nRecvDirect}
                      </div>
                      <div className="text-muted">{t('nodeDetailModal.errorsLabel')}</div>
                      <div className="font-mono text-gray-200">
                        {meshcoreRepeaterStatus.errEvents}
                      </div>
                      <div className="text-muted">{t('nodeDetailModal.dupsDirectFloodLabel')}</div>
                      <div className="font-mono text-gray-200">
                        {meshcoreRepeaterStatus.nDirectDups} / {meshcoreRepeaterStatus.nFloodDups}
                      </div>
                    </div>
                  </div>
                )}

              {/* Neighbors section */}
              {neighborInfo &&
                (() => {
                  const record = neighborInfo.get(node.node_id);
                  if (!record || record.neighbors.length === 0) return null;
                  return (
                    <div className="space-y-2 pb-2">
                      <h4 className="text-muted text-xs font-medium tracking-wide uppercase">
                        {t('nodeDetailModal.neighborsHeading', { count: record.neighbors.length })}
                      </h4>
                      <div className="space-y-1">
                        {record.neighbors.map((nb) => {
                          const nbNode = nodes?.get(nb.nodeId);
                          const label = nbNode?.short_name || formatMeshtasticNodeId(nb.nodeId);
                          return (
                            <div
                              key={nb.nodeId}
                              className="bg-secondary-dark flex items-center justify-between rounded px-2 py-1 text-xs"
                            >
                              <span className="text-gray-300">{label}</span>
                              <span className="text-xs text-gray-500">
                                {formatSecondsAgo(
                                  Math.max(0, Math.floor(Date.now() / 1000 - nb.lastRxTime)),
                                  t,
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

              {/* MeshCore Local Stats section (for connected node only) */}
              {protocol === 'meshcore' && meshcoreLocalStats && (
                <div className="space-y-2 pb-2">
                  <h4 className="text-muted text-xs font-medium tracking-wide uppercase">
                    {t('nodeDetailModal.radioStatsLocalHeading')}
                  </h4>
                  <div className="bg-secondary-dark grid grid-cols-2 gap-x-4 gap-y-1 rounded p-2 text-xs">
                    <div className="text-muted">{t('nodeDetailModal.noiseFloorLabel')}</div>
                    <div className="font-mono text-gray-200">
                      {meshcoreLocalStats.noiseFloor} dBm
                    </div>
                    <div className="text-muted">{t('nodeDetailModal.lastRssiLabel')}</div>
                    <div className="font-mono text-gray-200">{meshcoreLocalStats.lastRssi} dBm</div>
                    <div className="text-muted">{t('nodeDetailModal.lastSnrLabel')}</div>
                    <div className="font-mono text-gray-200">
                      {meshcoreLocalStats.lastSnr.toFixed(2)} dB
                    </div>
                    <div className="text-muted">{t('nodeDetailModal.txAirTimeLabel')}</div>
                    <div className="font-mono text-gray-200">{meshcoreLocalStats.txAirSecs}s</div>
                    <div className="text-muted">{t('nodeDetailModal.rxAirTimeLabel')}</div>
                    <div className="font-mono text-gray-200">{meshcoreLocalStats.rxAirSecs}s</div>
                    <div className="text-muted">{t('nodeDetailModal.uptimeLabel')}</div>
                    <div className="font-mono text-gray-200">
                      {Math.floor(meshcoreLocalStats.uptimeSecs / 3600)}h{' '}
                      {Math.floor((meshcoreLocalStats.uptimeSecs % 3600) / 60)}m
                    </div>
                  </div>

                  <h4 className="text-muted text-xs font-medium tracking-wide uppercase">
                    {t('nodeDetailModal.packetsLocalHeading')}
                  </h4>
                  <div className="bg-secondary-dark grid grid-cols-2 gap-x-4 gap-y-1 rounded p-2 text-xs">
                    <div className="text-muted">{t('nodeDetailModal.sentFloodDirectLabel')}</div>
                    <div className="font-mono text-gray-200">
                      {meshcoreLocalStats.nSentFlood} / {meshcoreLocalStats.nSentDirect}
                    </div>
                    <div className="text-muted">{t('nodeDetailModal.recvFloodDirectLabel')}</div>
                    <div className="font-mono text-gray-200">
                      {meshcoreLocalStats.nRecvFlood} / {meshcoreLocalStats.nRecvDirect}
                    </div>
                    <div className="text-muted">{t('nodeDetailModal.totalSentLabel')}</div>
                    <div className="font-mono text-gray-200">{meshcoreLocalStats.sent}</div>
                    <div className="text-muted">{t('nodeDetailModal.totalRecvLabel')}</div>
                    <div className="font-mono text-gray-200">{meshcoreLocalStats.recv}</div>
                    {meshcoreLocalStats.nRecvErrors !== undefined &&
                      meshcoreLocalStats.nRecvErrors !== null && (
                        <>
                          <div className="text-muted">{t('nodeDetailModal.rxErrorsLabel')}</div>
                          <div className="font-mono text-gray-200">
                            {meshcoreLocalStats.nRecvErrors}
                          </div>
                        </>
                      )}
                  </div>
                </div>
              )}

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
                            t,
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
                            t,
                          )}
                        </div>
                        <div className="text-muted">Data Size</div>
                        <div className="font-mono text-gray-200">
                          {latestEvent.data.length} bytes
                        </div>
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
                <div className="space-y-2 pb-2">
                  <h4 className="text-muted text-sm font-medium">
                    {t('nodeDetailModal.mapReportHeading')}
                  </h4>
                  {(() => {
                    const mapReport = mapReports.get(node.node_id);
                    if (!mapReport) {
                      return (
                        <p className="text-xs text-gray-500">
                          {t('nodeDetailModal.noMapReportReceived')}
                        </p>
                      );
                    }
                    return (
                      <div className="bg-secondary-dark grid grid-cols-2 gap-x-4 gap-y-1 rounded py-2 text-xs">
                        <div className="text-muted">{t('nodeDetailModal.mapReportLastReport')}</div>
                        <div className="font-mono text-gray-200">
                          {formatSecondsAgo(
                            Math.max(0, Math.floor((Date.now() - mapReport.timestamp) / 1000)),
                            t,
                          )}
                        </div>
                        <div className="text-muted">{t('nodeDetailModal.mapReportDataLabel')}</div>
                        <div className="font-mono text-gray-200">
                          {mapReport.data
                            ? JSON.stringify(mapReport.data).slice(0, 50)
                            : t('nodeDetailModal.mapReportDataNa')}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Position History (GPS tracking path) */}
              {positionHistory && (
                <div className="space-y-2 pb-2">
                  <h4 className="text-muted text-sm font-medium">
                    {t('nodeDetailModal.positionHistoryHeading')}
                  </h4>
                  {(() => {
                    const points = positionHistory.get(node.node_id);
                    if (!points || points.length === 0) {
                      return (
                        <p className="text-xs text-gray-500">
                          {t('nodeDetailModal.noPositionHistoryRecorded')}
                        </p>
                      );
                    }
                    const sorted = [...points].sort((a, b) => a.t - b.t);
                    const first = sorted[0];
                    const last = sorted[sorted.length - 1];
                    const durationHours = ((last.t - first.t) / (1000 * 60 * 60)).toFixed(1);
                    const recentPoints = [...sorted].reverse().slice(0, POSITION_HISTORY_MAX_ROWS);
                    return (
                      <>
                        <div className="bg-secondary-dark grid grid-cols-2 gap-x-4 gap-y-1 rounded py-2 text-xs">
                          <div className="text-muted">
                            {t('nodeDetailModal.positionHistoryRecordedPoints')}
                          </div>
                          <div className="font-mono text-gray-200">{points.length}</div>
                          <div className="text-muted">
                            {t('nodeDetailModal.positionHistoryTimeSpan')}
                          </div>
                          <div className="font-mono text-gray-200">
                            {t('nodeDetailModal.positionHistoryDurationHours', {
                              hours: durationHours,
                            })}
                          </div>
                          <div className="text-muted">
                            {t('nodeDetailModal.positionHistoryFirstPosition')}
                          </div>
                          <div className="font-mono text-gray-200">
                            {new Date(first.t).toLocaleString()}
                          </div>
                          <div className="text-muted">
                            {t('nodeDetailModal.positionHistoryLastPosition')}
                          </div>
                          <div className="font-mono text-gray-200">
                            {new Date(last.t).toLocaleString()}
                          </div>
                        </div>
                        {sorted.length > 1 && (
                          <div className="text-[10px] text-gray-500">
                            {t('nodeDetailModal.positionHistoryMostRecent', {
                              lat: last.lat.toFixed(5),
                              lon: last.lon.toFixed(5),
                            })}
                          </div>
                        )}
                        {sorted.length > POSITION_HISTORY_MAX_ROWS && (
                          <div className="text-[10px] text-gray-500">
                            {t('nodeDetailModal.positionHistoryTruncated', {
                              shown: POSITION_HISTORY_MAX_ROWS,
                              total: sorted.length,
                            })}
                          </div>
                        )}
                        <div className="bg-secondary-dark space-y-1 rounded py-2">
                          {recentPoints.map((point, idx) => (
                            <div
                              key={`${point.t}-${point.lat}-${point.lon}-${idx}`}
                              className="grid grid-cols-[auto_1fr] gap-x-2 text-[10px]"
                            >
                              <span className="text-gray-500">
                                {new Date(point.t).toLocaleString()}
                              </span>
                              <span className="font-mono whitespace-nowrap text-gray-200">
                                {formatCoordPair(point.lat, point.lon, coordinateFormat)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {protocol === 'meshtastic' && onSaveRemoteAdminKey && !isOurNode && (
                <div className="mt-4 space-y-2 rounded-lg border border-blue-700/40 bg-blue-900/20 px-3 py-2 text-sm text-blue-100">
                  <p className="text-xs font-medium tracking-wide text-blue-300 uppercase">
                    {t('nodeDetailModal.remoteAdminKeyTitle')}
                  </p>
                  <p className="text-muted text-xs">{t('nodeDetailModal.remoteAdminKeyHint')}</p>
                  {node.public_key_hex?.length !== 64 && (
                    <p className="text-xs text-amber-300">
                      {t('nodeDetailModal.remoteAdminNoPkiKey')}
                    </p>
                  )}
                  <label htmlFor="node-detail-admin-key" className="text-muted text-xs">
                    {t('nodeDetailModal.remoteAdminKeyLabel')}
                  </label>
                  <input
                    id="node-detail-admin-key"
                    type="text"
                    value={adminKeyDraft}
                    onChange={(e) => {
                      setAdminKeyDraft(e.target.value);
                      setAdminKeyError(null);
                      setAdminKeyStatus(null);
                    }}
                    placeholder={t('nodeDetailModal.remoteAdminKeyPlaceholder')}
                    aria-label={t('nodeDetailModal.remoteAdminKeyLabel')}
                    className="bg-secondary-dark w-full rounded-lg border border-gray-600 px-3 py-2 font-mono text-xs text-gray-200"
                  />
                  {adminKeyError && <p className="text-xs text-red-400">{adminKeyError}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!isConnected}
                      aria-label={t('nodeDetailModal.saveRemoteAdminKey')}
                      className="bg-secondary-dark rounded-lg px-3 py-1.5 text-xs font-medium text-blue-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => {
                        void (async () => {
                          const trimmed = adminKeyDraft.trim();
                          if (!isValidMeshtasticAdminKeyBase64(trimmed)) {
                            setAdminKeyError(t('nodeDetailModal.remoteAdminKeyInvalid'));
                            return;
                          }
                          try {
                            const normalized = normalizeMeshtasticAdminKeyInput(trimmed);
                            if (!normalized) {
                              setAdminKeyError(t('nodeDetailModal.remoteAdminKeyInvalid'));
                              return;
                            }
                            await onSaveRemoteAdminKey(node.node_id, normalized);
                            setAdminKeyDraft(normalized);
                            setAdminKeyStatus(t('nodeDetailModal.remoteAdminKeySaved'));
                            setAdminKeyError(null);
                          } catch (e: unknown) {
                            const msg = e instanceof Error ? e.message : String(e);
                            console.warn('[NodeDetailModal] save remote admin key failed ' + msg);
                            setAdminKeyError(
                              msg.startsWith('remoteAdmin.errors.')
                                ? t(msg)
                                : t('nodeDetailModal.remoteAdminKeyInvalid'),
                            );
                          }
                        })();
                      }}
                    >
                      {t('nodeDetailModal.saveRemoteAdminKey')}
                    </button>
                    {remoteAdminKey && (
                      <button
                        type="button"
                        aria-label={t('nodeDetailModal.clearRemoteAdminKey')}
                        className="bg-secondary-dark rounded-lg px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-600"
                        onClick={() => {
                          void (async () => {
                            try {
                              await onSaveRemoteAdminKey(node.node_id, null);
                              setAdminKeyDraft('');
                              setAdminKeyStatus(t('nodeDetailModal.remoteAdminKeyCleared'));
                              setAdminKeyError(null);
                            } catch (e: unknown) {
                              const msg = e instanceof Error ? e.message : String(e);
                              console.warn(
                                '[NodeDetailModal] clear remote admin key failed ' + msg,
                              );
                              setAdminKeyError(
                                msg.startsWith('remoteAdmin.errors.')
                                  ? t(msg)
                                  : t('nodeDetailModal.remoteAdminKeyInvalid'),
                              );
                            }
                          })();
                        }}
                      >
                        {t('nodeDetailModal.clearRemoteAdminKey')}
                      </button>
                    )}
                  </div>
                  {adminKeyStatus && (
                    <p className="text-xs text-green-400" role="status">
                      {adminKeyStatus}
                    </p>
                  )}
                  {onConfigureRemotely && isConnected && hasRemoteAdminKey && (
                    <div className="pt-1">
                      <button
                        type="button"
                        aria-label={t('nodeDetailModal.configureRemotely')}
                        className="bg-brand-green/20 text-brand-green hover:bg-brand-green/30 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                        onClick={() => {
                          onConfigureRemotely(node.node_id);
                        }}
                      >
                        {t('nodeDetailModal.configureRemotely')}
                      </button>
                      <p className="text-muted mt-1 text-xs">
                        {t('nodeDetailModal.configureRemotelyHint')}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer actions — omitted for directly connected node (no position/trace/message to self) */}
            {!isOurNode && (
              <div className="flex flex-wrap items-center gap-2 border-t border-gray-700 px-5 py-3">
                {protocol !== 'meshcore' && (
                  <button
                    onClick={handleRequestPosition}
                    disabled={!isConnected || positionRequestedAt !== null}
                    className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t('nodeDetailModal.requestPosition')}
                  </button>
                )}
                {traceHardDisabled && traceBlockReason ? (
                  <HelpTooltip text={traceBlockReason}>
                    <span className="inline-flex min-w-[8rem] flex-1">
                      <button
                        type="button"
                        onClick={handleTraceRoute}
                        disabled
                        className="bg-secondary-dark min-w-[8rem] flex-1 cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium text-gray-200 opacity-40"
                      >
                        {traceRoutePending
                          ? t('nodeDetailModal.tracingEllipsis')
                          : t('nodeDetailModal.traceRoute')}
                      </button>
                    </span>
                  </HelpTooltip>
                ) : (
                  <button
                    type="button"
                    onClick={handleTraceRoute}
                    disabled={false}
                    className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600"
                  >
                    {traceRoutePending
                      ? t('nodeDetailModal.tracingEllipsis')
                      : t('nodeDetailModal.traceRoute')}
                  </button>
                )}
                {protocol === 'meshcore' && onRequestRepeaterStatus && (
                  <button
                    onClick={async () => {
                      if (!(await ensureConfigured())) return;
                      setRepeaterStatusPending(true);
                      setActionStatus(t('nodeDetailModal.requestingStatus'));
                      try {
                        await onRequestRepeaterStatus(node.node_id);
                        setActionStatus(null);
                      } catch (e) {
                        console.warn(
                          '[NodeDetailModal] requestRepeaterStatus failed ' + errLikeToLogString(e),
                        );
                        setActionStatus(
                          e instanceof Error ? e.message : t('nodeDetailModal.statusRequestFailed'),
                        );
                      } finally {
                        setRepeaterStatusPending(false);
                      }
                    }}
                    disabled={!isConnected || repeaterStatusPending}
                    className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {repeaterStatusPending
                      ? t('nodeDetailModal.requestingEllipsis')
                      : t('nodeDetailModal.requestStatus')}
                  </button>
                )}
                {protocol === 'meshcore' && onRequestTelemetry && (
                  <button
                    type="button"
                    title={t('nodeDetailModal.cayenneLppTitle')}
                    aria-label={t('nodeDetailModal.sensorTelemetryLpp')}
                    onClick={async () => {
                      if (!(await ensureConfigured())) return;
                      setTelemetryPending(true);
                      setActionStatus(t('nodeDetailModal.requestingSensorTelemetry'));
                      try {
                        await onRequestTelemetry(node.node_id);
                        setActionStatus(null);
                      } catch (e) {
                        console.warn(
                          '[NodeDetailModal] requestTelemetry failed ' + errLikeToLogString(e),
                        );
                        setActionStatus(
                          e instanceof Error
                            ? e.message
                            : t('nodeDetailModal.telemetryFailed', { message: String(e) }),
                        );
                      } finally {
                        setTelemetryPending(false);
                      }
                    }}
                    disabled={!isConnected || telemetryPending}
                    className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {telemetryPending
                      ? t('nodeDetailModal.requestingEllipsis')
                      : t('nodeDetailModal.sensorTelemetryButton')}
                  </button>
                )}
                {protocol === 'meshcore' && onRequestNeighbors && node.hw_model === 'Repeater' && (
                  <button
                    onClick={async () => {
                      if (!(await ensureConfigured())) return;
                      setNeighborsPending(true);
                      setActionStatus(t('nodeDetailModal.requestingNeighbors'));
                      try {
                        await onRequestNeighbors(node.node_id);
                        setActionStatus(null);
                      } catch (e) {
                        console.warn(
                          '[NodeDetailModal] requestNeighbors failed ' + errLikeToLogString(e),
                        );
                        setActionStatus(
                          e instanceof Error
                            ? e.message
                            : t('nodeDetailModal.neighborsFailed', { message: String(e) }),
                        );
                      } finally {
                        setNeighborsPending(false);
                      }
                    }}
                    disabled={!isConnected || neighborsPending}
                    className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {neighborsPending
                      ? t('nodeDetailModal.requestingEllipsis')
                      : t('nodeDetailModal.getNeighbors')}
                  </button>
                )}
                {onMessageNode && (
                  <button
                    onClick={() => {
                      onMessageNode(node.node_id);
                      onClose();
                    }}
                    disabled={!isConnected || (protocol === 'meshcore' && !contactPubkey)}
                    title={
                      protocol === 'meshcore' && !contactPubkey
                        ? t('nodeDetailModal.messageNoKeyTitle')
                        : undefined
                    }
                    className="min-w-[8rem] flex-1 rounded-lg bg-purple-700/50 px-3 py-2 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-600/50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t('nodeDetailModal.messageButton')}
                  </button>
                )}
                {protocol === 'meshcore' && onExportContact && (
                  <button
                    onClick={async () => {
                      if (!(await ensureConfigured())) return;
                      setExportContactPending(true);
                      setActionStatus(t('nodeDetailModal.exportingContact'));
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
                          setActionStatus(t('nodeDetailModal.noPublicKeyAvailable'));
                        }
                      } catch (e) {
                        console.warn(
                          '[NodeDetailModal] exportContact failed ' + errLikeToLogString(e),
                        );
                        setActionStatus(
                          e instanceof Error ? e.message : t('nodeDetailModal.exportFailed'),
                        );
                      } finally {
                        setExportContactPending(false);
                      }
                    }}
                    disabled={!isConnected || exportContactPending}
                    className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {exportContactPending
                      ? t('nodeDetailModal.exportingEllipsis')
                      : t('nodeDetailModal.exportContact')}
                  </button>
                )}
                {protocol === 'meshcore' && onShareContact && (
                  <button
                    onClick={async () => {
                      if (!(await ensureConfigured())) return;
                      setShareContactPending(true);
                      setActionStatus(t('nodeDetailModal.sharingContact'));
                      try {
                        const success = await onShareContact(node.node_id);
                        setActionStatus(success ? null : t('nodeDetailModal.shareFailed'));
                      } catch (e) {
                        console.warn(
                          '[NodeDetailModal] shareContact failed ' + errLikeToLogString(e),
                        );
                        setActionStatus(
                          e instanceof Error ? e.message : t('nodeDetailModal.shareFailed'),
                        );
                      } finally {
                        setShareContactPending(false);
                      }
                    }}
                    disabled={!isConnected || shareContactPending}
                    className="bg-secondary-dark min-w-[8rem] flex-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {shareContactPending
                      ? t('nodeDetailModal.sharingEllipsis')
                      : t('nodeDetailModal.shareContact')}
                  </button>
                )}
                {protocol === 'meshcore' && contactPubkey && contactOnRadio === false && (
                  <button
                    onClick={async () => {
                      setAddRemoveLoading(true);
                      setActionStatus(t('nodeDetailModal.addingToRadio'));
                      try {
                        await window.electronAPI.db.saveMeshcoreContact({
                          node_id: node.node_id,
                          public_key: contactPubkey,
                          on_radio: 1,
                          last_synced_from_radio: new Date().toISOString(),
                        });
                        setContactOnRadio(true);
                        // Refresh count
                        const count = await window.electronAPI.db.getMeshcoreContactCount();
                        setRadioContactCount(count);
                        setActionStatus(null);
                      } catch (e) {
                        console.warn(
                          '[NodeDetailModal] addToRadio failed ' + errLikeToLogString(e),
                        );
                        setActionStatus(
                          e instanceof Error ? e.message : t('nodeDetailModal.addToRadioFailed'),
                        );
                      } finally {
                        setAddRemoveLoading(false);
                      }
                    }}
                    disabled={!isConnected || addRemoveLoading}
                    className="min-w-[8rem] flex-1 rounded-lg bg-green-900/50 px-3 py-2 text-sm font-medium text-green-300 transition-colors hover:bg-green-800/50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {addRemoveLoading
                      ? t('nodeDetailModal.addingEllipsis')
                      : t('nodeDetailModal.addToRadio')}
                  </button>
                )}
                {protocol === 'meshcore' && contactPubkey && contactOnRadio === true && (
                  <button
                    onClick={async () => {
                      setAddRemoveLoading(true);
                      setActionStatus(t('nodeDetailModal.removingFromRadio'));
                      try {
                        await window.electronAPI.db.saveMeshcoreContact({
                          node_id: node.node_id,
                          public_key: contactPubkey,
                          on_radio: 0,
                        });
                        setContactOnRadio(false);
                        // Refresh count
                        const count = await window.electronAPI.db.getMeshcoreContactCount();
                        setRadioContactCount(count);
                        setActionStatus(null);
                      } catch (e) {
                        console.warn(
                          '[NodeDetailModal] removeFromRadio failed ' + errLikeToLogString(e),
                        );
                        setActionStatus(
                          e instanceof Error
                            ? e.message
                            : t('nodeDetailModal.removeFromRadioFailed'),
                        );
                      } finally {
                        setAddRemoveLoading(false);
                      }
                    }}
                    disabled={!isConnected || addRemoveLoading}
                    className="min-w-[8rem] flex-1 rounded-lg bg-orange-900/50 px-3 py-2 text-sm font-medium text-orange-300 transition-colors hover:bg-orange-800/50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {addRemoveLoading
                      ? t('nodeDetailModal.removingEllipsis')
                      : t('nodeDetailModal.removeFromRadio')}
                  </button>
                )}
              </div>
            )}

            {/* MQTT Ignore toggle */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-700/50 px-5 py-2">
              <div>
                <div className="text-xs font-medium text-gray-300">
                  {t('nodeDetailModal.mqttIgnoreHeading')}
                </div>
                <div className="text-muted text-xs">
                  {t('nodeDetailModal.mqttIgnoreDescription')}
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
                    ? t('nodeDetailModal.stopIgnoringMqttTitle')
                    : t('nodeDetailModal.ignoreMqttTitle')
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
                <div
                  className={`text-center text-xs ${
                    actionStatus.includes('Cannot delete active MQTT identity')
                      ? 'text-red-300'
                      : 'text-muted'
                  }`}
                >
                  {actionStatus}
                </div>
              </div>
            )}

            {/* Node notes */}
            <div className="shrink-0 px-5 pb-2">
              <label className="mb-1 block text-xs font-medium text-gray-400">
                {t('nodeDetailModal.notesLabel')}
              </label>
              <textarea
                aria-label={t('nodeDetailModal.notesLabel')}
                className="w-full resize-y rounded border border-gray-700 bg-gray-800/60 px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                maxLength={4000}
                placeholder={t('nodeDetailModal.notesPlaceholder')}
                rows={3}
                value={nodeNote}
                onChange={(e) => {
                  const val = e.target.value;
                  setNodeNote(val);
                  pendingNoteRef.current = val;
                  if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
                  noteSaveTimerRef.current = setTimeout(() => {
                    pendingNoteRef.current = null;
                    void window.electronAPI.db.setNodeNote(node.node_id, val);
                  }, 600);
                }}
              />
            </div>

            {/* Delete node */}
            <div className="shrink-0 px-5 pb-4">
              {!showDeleteConfirm ? (
                <button
                  onClick={() => {
                    setShowDeleteConfirm(true);
                  }}
                  className="mt-2 w-full rounded-lg border border-red-900/50 bg-red-900/30 px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-900/50 hover:text-red-300"
                >
                  {t('nodeDetailModal.deleteNode')}
                </button>
              ) : (
                <div className="mt-2 rounded-lg border border-red-900/50 bg-red-900/20 p-3">
                  <p className="mb-2 text-xs text-red-300">
                    {t('nodeDetailModal.deleteNodeConfirm')}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowDeleteConfirm(false);
                      }}
                      className="bg-secondary-dark flex-1 rounded px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-600"
                    >
                      {t('nodeDetailModal.cancel')}
                    </button>
                    <button
                      onClick={() => {
                        onDeleteNode(node.node_id)
                          .then(onClose)
                          .catch((e: unknown) => {
                            setActionStatus(
                              e instanceof Error
                                ? e.message
                                : t('nodeDetailModal.deleteFailedMqtt'),
                            );
                            setShowDeleteConfirm(false);
                          });
                      }}
                      className="flex-1 rounded bg-red-800 px-3 py-1.5 text-xs text-white transition-colors hover:bg-red-700"
                    >
                      {t('nodeDetailModal.confirmDelete')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {RemoteAuthModal}
    </>
  );
}
