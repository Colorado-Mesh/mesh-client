import { useEffect, useRef, useState } from "react";
import type { MeshNode } from "../lib/types";
import NodeInfoBody from "./NodeInfoBody";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";

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
  const mqttIgnoredNodes = useDiagnosticsStore((s) => s.mqttIgnoredNodes);
  const setNodeMqttIgnored = useDiagnosticsStore((s) => s.setNodeMqttIgnored);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus trap and focus management
  useEffect(() => {
    if (!node) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    closeButtonRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, [node?.node_id]);

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

  if (!node) return null;

  const hexId = `!${node.node_id.toString(16)}`;
  const displayName = node.short_name || node.long_name || hexId;

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
        role="dialog"
        aria-modal="true"
        aria-labelledby="node-modal-title"
        className="bg-deep-black border border-gray-700 rounded-xl max-w-md w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 id="node-modal-title" className="text-lg font-semibold text-gray-100 truncate">
                {displayName}
              </h3>
              {mqttIgnoredNodes.has(node.node_id) && (
                <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                  MQTT Ignored
                </span>
              )}
            </div>
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
            aria-label={node.favorited ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={node.favorited}
          >
            <span className={`text-xl ${node.favorited ? "text-yellow-400" : "text-gray-500 hover:text-yellow-400"}`} aria-hidden="true">
              {node.favorited ? "★" : "☆"}
            </span>
          </button>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close dialog"
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
          <NodeInfoBody node={node} homeNode={homeNode} traceRouteHops={traceRouteHops} />
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

        {/* MQTT Ignore toggle */}
        <div className="px-5 py-2 border-t border-gray-700/50 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-gray-300">MQTT Ignore</div>
            <div className="text-xs text-muted">Exclude this node's MQTT data from diagnostics</div>
          </div>
          <button
            onClick={() => setNodeMqttIgnored(node.node_id, !mqttIgnoredNodes.has(node.node_id))}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
              mqttIgnoredNodes.has(node.node_id) ? "bg-yellow-500" : "bg-gray-600"
            }`}
            role="switch"
            aria-checked={mqttIgnoredNodes.has(node.node_id)}
            title={mqttIgnoredNodes.has(node.node_id) ? "Stop ignoring MQTT for this node" : "Ignore MQTT for this node"}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                mqttIgnoredNodes.has(node.node_id) ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
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
