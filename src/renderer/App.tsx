import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useDevice } from "./hooks/useDevice";
import { ToastProvider } from "./components/Toast";
import type { MQTTSettings } from "./lib/types";
import Tabs from "./components/Tabs";
import ErrorBoundary from "./components/ErrorBoundary";
import NodeDetailModal from "./components/NodeDetailModal";
import ConnectionPanel from "./components/ConnectionPanel";
import ChatPanel from "./components/ChatPanel";
import NodeListPanel from "./components/NodeListPanel";
import RadioPanel from "./components/RadioPanel";
import MapPanel from "./components/MapPanel";
import TelemetryPanel from "./components/TelemetryPanel";
import AppPanel from "./components/AppPanel";
import DiagnosticsPanel from "./components/DiagnosticsPanel";
import { LinkIcon } from "./components/SignalBars";

const STATUS_COLOR: Record<string, string> = {
  disconnected: "bg-red-500",
  connecting: "bg-yellow-500 animate-pulse",
  connected: "bg-blue-500",
  configured: "bg-green-500",
  stale: "bg-yellow-500 animate-pulse",
  reconnecting: "bg-orange-500 animate-pulse",
};

const TAB_NAMES = [
  "Connection",
  "Chat",
  "Nodes",
  "Map",
  "Telemetry",
  "Radio",
  "App",
  "Diagnostics",
];

export interface LocationFilter {
  enabled: boolean;
  maxDistance: number;
  unit: "miles" | "km";
  hideMqttOnly: boolean;
}

function MqttGlobeIcon({ connected }: { connected: boolean }) {
  return (
    <svg
      className={`w-4 h-4 ${connected ? "text-brand-green" : "text-gray-400"}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20M2 12h20" />
      <path d="M2 7h20M2 17h20" />
    </svg>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [locationFilter, setLocationFilter] = useState<LocationFilter>(() => {
    try {
      const raw = localStorage.getItem("mesh-client:adminSettings");
      const s = raw ? JSON.parse(raw) : {};
      return {
        enabled: s.distanceFilterEnabled ?? false,
        maxDistance: s.distanceFilterMax ?? 500,
        unit: s.distanceUnit ?? "miles",
        hideMqttOnly: s.filterMqttOnly ?? false,
      };
    } catch {
      return { enabled: false, maxDistance: 500, unit: "miles", hideMqttOnly: false };
    }
  });
  const [pendingDmTarget, setPendingDmTarget] = useState<number | null>(null);
  const [chatUnread, setChatUnread] = useState(0);
  const prevMsgCountRef = useRef(0);
  const isInitialLoadRef = useRef(true);
  const device = useDevice();

  const isConfigured = device.state.status === "configured";
  const isOperational = isConfigured || device.state.status === "stale";
  const isConnectedOrOperational = isOperational || device.state.status === "connected";
  const selectedNode = selectedNodeId
    ? device.nodes.get(selectedNodeId) ?? null
    : null;

  const traceRouteHops = useMemo(() => {
    if (!selectedNode) return undefined;
    const result = device.traceRouteResults.get(selectedNode.node_id);
    if (!result) return undefined;
    return [
      device.getFullNodeLabel(device.state.myNodeNum) || "Me",
      ...result.route.map((id) => device.getFullNodeLabel(id)),
      device.getFullNodeLabel(result.from),
    ];
  }, [selectedNode, device.traceRouteResults, device.state.myNodeNum, device.getFullNodeLabel]);

  // ─── Startup node pruning based on persisted admin settings ─────
  useEffect(() => {
    try {
      const raw = localStorage.getItem("mesh-client:adminSettings");
      const s = raw ? JSON.parse(raw) : {};
      if (s.autoPruneEnabled) window.electronAPI.db.deleteNodesByAge(s.autoPruneDays ?? 30);
      if (s.nodeCapEnabled !== false) window.electronAPI.db.pruneNodesByCount(s.nodeCapCount ?? 10000);
    } catch {}
  }, []);

  // ─── MQTT auto-launch on startup ─────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem("mesh-client:mqttSettings");
      if (raw) {
        const settings = JSON.parse(raw) as MQTTSettings;
        if (settings.autoLaunch) window.electronAPI.mqtt.connect(settings);
      }
    } catch {}
  }, []);

  // ─── Keyboard shortcuts: Cmd/Ctrl+1-7 for tabs ───────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "8") {
        e.preventDefault();
        setActiveTab(parseInt(e.key) - 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ─── Track messages arriving while Chat tab is inactive ──────────
  useEffect(() => {
    const count = device.messages.length;
    if (isInitialLoadRef.current) {
      prevMsgCountRef.current = count;
      if (count > 0) isInitialLoadRef.current = false;
      return;
    }
    if (count > prevMsgCountRef.current && activeTab !== 1) {
      const newMsgs = device.messages.slice(prevMsgCountRef.current);
      const realNew = newMsgs.filter(
        (m) => m.sender_id !== device.state.myNodeNum && !m.emoji
      );
      if (realNew.length > 0) setChatUnread((prev) => prev + realNew.length);
    }
    prevMsgCountRef.current = count;
  }, [device.messages.length]);

  // ─── Clear unread when Chat tab becomes active ────────────────────
  useEffect(() => {
    if (activeTab === 1) {
      setChatUnread(0);
      window.electronAPI.setTrayUnread(0);
    }
  }, [activeTab]);

  // ─── Sync non-zero unread count to tray ──────────────────────────
  useEffect(() => {
    if (chatUnread > 0) window.electronAPI.setTrayUnread(chatUnread);
  }, [chatUnread]);

  // Manual reconnect from banner
  const handleReconnect = useCallback(() => {
    const lastType = device.state.connectionType ?? "ble";
    device.disconnect().then(() => {
      // Small delay before reconnecting
      setTimeout(() => {
        device.connect(lastType).catch(() => {});
      }, 500);
    });
  }, [device]);

  const handleMessageNode = useCallback((nodeNum: number) => {
    setPendingDmTarget(nodeNum);
    setActiveTab(1); // Switch to Chat tab
  }, []);

  const handleLocationFilterChange = useCallback((f: LocationFilter) => setLocationFilter(f), []);

  const statusColor = STATUS_COLOR[device.state.status] ?? "bg-gray-500";

  return (
    <ToastProvider>
      <div className="flex flex-col h-screen">
        {/* Header */}
        <header
          className={`flex items-center justify-between px-4 py-2 bg-deep-black border-b ${
            isConfigured ? "border-brand-green/20" : "border-gray-700"
          }`}
        >
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-bright-green tracking-wide">
              Denver Mesh
            </h1>
            <span className="text-xs text-muted">Meshtastic Client</span>
          </div>
          <div className="flex items-center gap-2">
            {/* MQTT status globe */}
            <div className="flex items-center gap-1.5 mr-3 pr-3 border-r border-gray-700">
              <MqttGlobeIcon connected={device.mqttStatus === "connected"} />
              <span className={`text-xs ${device.mqttStatus === "connected" ? "text-brand-green" : "text-gray-500"}`}>
                MQTT
              </span>
            </div>
            {isConnectedOrOperational && (
              <LinkIcon className="w-4 h-4" />
            )}
            <div className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
            <span className="text-sm text-muted capitalize">
              {device.state.status}
              {device.state.connectionType
                ? ` (${device.state.connectionType.toUpperCase()})`
                : ""}
            </span>
            {device.state.myNodeNum > 0 && (
              <span className="text-xs text-muted ml-2 whitespace-nowrap">
                Node: {device.getFullNodeLabel(device.state.myNodeNum)}
              </span>
            )}
          </div>
        </header>

        {/* Connection Status Banner */}
        <ConnectionBanner
          status={device.state.status}
          reconnectAttempt={device.state.reconnectAttempt}
          onReconnect={handleReconnect}
        />

        {/* Tabs */}
        <Tabs tabs={TAB_NAMES} active={activeTab} onChange={setActiveTab} />

        {/* Content */}
        <main className="flex-1 overflow-auto p-4">
          <ErrorBoundary>
            {activeTab === 0 && (
              <ConnectionPanel
                state={device.state}
                onConnect={device.connect}
                onDisconnect={device.disconnect}
                mqttStatus={device.mqttStatus}
                myNodeLabel={
                  device.state.myNodeNum > 0
                    ? device.getFullNodeLabel(device.state.myNodeNum)
                    : undefined
                }
              />
            )}
            <div className={activeTab === 1 ? "contents" : "hidden"}>
              <ChatPanel
                messages={device.messages}
                channels={device.channels}
                myNodeNum={device.state.myNodeNum}
                onSend={device.sendMessage}
                onReact={device.sendReaction}
                onNodeClick={setSelectedNodeId}
                isConnected={isOperational || device.mqttStatus === "connected"}
                isMqttOnly={!isOperational && device.mqttStatus === "connected"}
                nodes={device.nodes}
                initialDmTarget={pendingDmTarget}
                onDmTargetConsumed={() => setPendingDmTarget(null)}
              />
            </div>
            {activeTab === 2 && (
              <NodeListPanel
                nodes={device.nodes}
                myNodeNum={device.state.myNodeNum}
                onRefresh={device.requestRefresh}
                onNodeClick={(node) => setSelectedNodeId(node.node_id)}
                isConnected={isOperational}
                locationFilter={locationFilter}
                onToggleFavorite={device.setNodeFavorited}
              />
            )}
            {activeTab === 3 && (
              <MapPanel
                nodes={device.nodes}
                myNodeNum={device.state.myNodeNum}
                onRefresh={device.requestRefresh}
                isConnected={isOperational}
                locationFilter={locationFilter}
              />
            )}
            {activeTab === 4 && (
              <TelemetryPanel
                telemetry={device.telemetry}
                signalTelemetry={device.signalTelemetry}
                onRefresh={device.requestRefresh}
                isConnected={isOperational}
              />
            )}
            {activeTab === 5 && (
              <RadioPanel
                onSetConfig={device.setConfig}
                onCommit={device.commitConfig}
                onSetChannel={device.setDeviceChannel}
                onClearChannel={device.clearChannel}
                channelConfigs={device.channelConfigs}
                isConnected={isOperational}
                onReboot={device.reboot}
                onShutdown={device.shutdown}
                onFactoryReset={device.factoryReset}
                onResetNodeDb={device.resetNodeDb}
              />
            )}
            {activeTab === 6 && (
              <AppPanel
                nodes={device.nodes}
                messageCount={device.messages.length}
                channels={device.channels}
                myNodeNum={device.state.myNodeNum}
                onLocationFilterChange={handleLocationFilterChange}
              />
            )}
            {activeTab === 7 && (
              <DiagnosticsPanel
                nodes={device.nodes}
                myNodeNum={device.state.myNodeNum}
                onTraceRoute={device.traceRoute}
                isConnected={isOperational}
                traceRouteResults={device.traceRouteResults}
                getFullNodeLabel={device.getFullNodeLabel}
              />
            )}
          </ErrorBoundary>
        </main>

        {/* Footer */}
        <footer className="px-4 py-1.5 bg-deep-black border-t border-gray-700 text-[11px] text-muted flex justify-between">
          <span>
            A Project by{" "}
            <a
              href="https://denvermesh.org/"
              title="Denver Mesh"
              className="text-bright-green underline hover:opacity-80"
              target="_blank"
              rel="noopener noreferrer"
            >
              Denver Mesh
            </a>
            . Join us on{" "}
            <a
              href="https://discord.com/invite/McChKR5NpS"
              title="Denver Mesh Discord"
              className="text-bright-green underline hover:opacity-80"
              target="_blank"
              rel="noopener noreferrer"
            >
              Discord
            </a>
            . Code on{" "}
            <a
              href="https://github.com/Denver-Mesh/meshtastic-client"
              title="Denver Mesh on GitHub"
              className="text-bright-green underline hover:opacity-80"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            .
          </span>
          <span>
            {device.nodes.size} nodes | {device.messages.length} messages
          </span>
        </footer>

        {/* Node Detail Modal — rendered outside main for proper z-indexing */}
        <NodeDetailModal
          node={selectedNode}
          onClose={() => setSelectedNodeId(null)}
          onRequestPosition={device.requestPosition}
          onTraceRoute={device.traceRoute}
          traceRouteHops={traceRouteHops}
          onDeleteNode={async (nodeNum) => {
            await device.deleteNode(nodeNum);
            setSelectedNodeId(null);
          }}
          onMessageNode={
            selectedNode?.node_id !== device.state.myNodeNum
              ? handleMessageNode
              : undefined
          }
          onToggleFavorite={device.setNodeFavorited}
          isConnected={isOperational}
          homeNode={device.nodes.get(device.state.myNodeNum) ?? null}
        />
      </div>
    </ToastProvider>
  );
}

// ─── Connection Status Banner ─────────────────────────────────────
function ConnectionBanner({
  status,
  reconnectAttempt,
  onReconnect,
}: {
  status: string;
  reconnectAttempt?: number;
  onReconnect: () => void;
}) {
  if (status === "stale") {
    return (
      <div className="bg-yellow-900/80 border-b border-yellow-700 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-yellow-400">⚠</span>
          <span className="text-yellow-200 text-sm">
            Connection may be lost — no data received recently
          </span>
        </div>
        <button
          onClick={onReconnect}
          className="text-yellow-300 text-sm font-medium hover:text-yellow-100 underline"
        >
          Reconnect
        </button>
      </div>
    );
  }

  if (status === "reconnecting") {
    return (
      <div className="bg-orange-900/80 border-b border-orange-700 px-4 py-2 flex items-center gap-2">
        <span className="text-orange-400 animate-spin inline-block">⟳</span>
        <span className="text-orange-200 text-sm animate-pulse">
          Reconnecting... attempt {reconnectAttempt ?? 1}/5
        </span>
      </div>
    );
  }

  return null;
}
