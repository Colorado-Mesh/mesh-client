import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import AppPanel from './components/AppPanel';
import ChatPanel from './components/ChatPanel';
import ConnectionPanel from './components/ConnectionPanel';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import ErrorBoundary from './components/ErrorBoundary';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal';
import LogPanel from './components/LogPanel';
import MapPanel from './components/MapPanel';
import NodeDetailModal from './components/NodeDetailModal';
import NodeListPanel from './components/NodeListPanel';
import RadioPanel from './components/RadioPanel';
import { LinkIcon } from './components/SignalBars';
import Tabs from './components/Tabs';
import TelemetryPanel from './components/TelemetryPanel';
import { ToastProvider } from './components/Toast';
import UpdateBanner from './components/UpdateBanner';
import { useDevice } from './hooks/useDevice';
import { parseStoredJson } from './lib/parseStoredJson';
import { applyThemeColors, loadThemeColors } from './lib/themeColors';
import type { MQTTSettings } from './lib/types';
import { useDiagnosticsStore } from './stores/diagnosticsStore';

const STATUS_COLOR: Record<string, string> = {
  disconnected: 'bg-red-500',
  connecting: 'bg-yellow-500 animate-pulse',
  connected: 'bg-blue-500',
  configured: 'bg-green-500',
  stale: 'bg-yellow-500 animate-pulse',
  reconnecting: 'bg-orange-500 animate-pulse',
};

const TAB_NAMES = [
  'Connection',
  'Chat',
  'Nodes',
  'Map',
  'Telemetry',
  'Radio',
  'App',
  'Diagnostics',
];

export interface LocationFilter {
  enabled: boolean;
  maxDistance: number;
  unit: 'miles' | 'km';
  hideMqttOnly: boolean;
}

export interface UpdateState {
  phase: 'idle' | 'available' | 'downloading' | 'ready' | 'error';
  version?: string;
  releaseUrl?: string;
  isPackaged?: boolean;
  isMac?: boolean;
  percent?: number;
  dismissed: boolean;
}

const CHAT_UNREAD_STORAGE_KEY = 'mesh-client:chatUnread';
const LOG_PANEL_VISIBLE_KEY = 'mesh-client:logPanelVisible';

function readLogPanelVisible(): boolean {
  try {
    return localStorage.getItem(LOG_PANEL_VISIBLE_KEY) === 'true';
  } catch (e) {
    console.debug('[App] readLogPanelVisible', e);
    return false;
  }
}

function readPersistedChatUnread(): number {
  try {
    const raw = localStorage.getItem(CHAT_UNREAD_STORAGE_KEY);
    if (raw == null) return 0;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, 99999);
  } catch (e) {
    console.debug('[App] readPersistedChatUnread', e);
    return 0;
  }
}

function persistChatUnread(count: number): void {
  try {
    const n = Math.max(0, Math.min(Math.floor(count) || 0, 99999));
    localStorage.setItem(CHAT_UNREAD_STORAGE_KEY, String(n));
  } catch (e) {
    console.debug('[App] persistChatUnread quota/private mode', e);
  }
}

const STATUS_LABELS: Record<string, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting',
  connected: 'Connected',
  configured: 'Configured',
  stale: 'Connection stale',
  reconnecting: 'Reconnecting',
};

function MqttGlobeIcon({ connected }: { connected: boolean }) {
  return (
    <svg
      className={`w-4 h-4 ${connected ? 'text-brand-green' : 'text-gray-400'}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
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
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [locationFilter, setLocationFilter] = useState<LocationFilter>(() => {
    const s =
      parseStoredJson<Record<string, unknown>>(
        localStorage.getItem('mesh-client:adminSettings'),
        'App locationFilter initial state',
      ) ?? {};
    return {
      enabled: Boolean(s.distanceFilterEnabled),
      maxDistance: Number(s.distanceFilterMax) || 500,
      unit: s.distanceUnit === 'km' ? 'km' : 'miles',
      hideMqttOnly: Boolean(s.filterMqttOnly),
    };
  });
  const [pendingDmTarget, setPendingDmTarget] = useState<number | null>(null);
  const [chatUnread, setChatUnread] = useState(readPersistedChatUnread);
  const [logPanelVisible, setLogPanelVisible] = useState(readLogPanelVisible);
  const prevMsgCountRef = useRef(0);
  const isInitialLoadRef = useRef(true);
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: 'idle', dismissed: false });
  const [telemetryNoticeDismissed, setTelemetryNoticeDismissed] = useState(false);

  // ─── Theme colors (localStorage overrides for @theme tokens) ─────
  useLayoutEffect(() => {
    applyThemeColors(loadThemeColors());
  }, []);

  const device = useDevice();
  const runReanalysis = useDiagnosticsStore((s) => s.runReanalysis);
  const ignoreMqttEnabled = useDiagnosticsStore((s) => s.ignoreMqttEnabled);
  const envMode = useDiagnosticsStore((s) => s.envMode);

  useEffect(() => {
    runReanalysis(device.getNodes, device.selfNodeId);
  }, [device.nodes, device.selfNodeId, device.getNodes, runReanalysis, ignoreMqttEnabled, envMode]);

  useEffect(() => {
    if (device.state.status === 'disconnected') {
      setTelemetryNoticeDismissed(false);
    }
  }, [device.state.status]);

  const isConfigured = device.state.status === 'configured';
  const isOperational = isConfigured || device.state.status === 'stale';
  const isConnectedOrOperational = isOperational || device.state.status === 'connected';
  const selectedNode = selectedNodeId ? (device.nodes.get(selectedNodeId) ?? null) : null;

  const traceRouteHops = useMemo(() => {
    if (!selectedNode) return undefined;
    const result = device.traceRouteResults.get(selectedNode.node_id);
    if (!result) return undefined;
    return [
      device.getFullNodeLabel(device.state.myNodeNum) || 'Me',
      ...result.route.map((id) => device.getFullNodeLabel(id)),
      device.getFullNodeLabel(result.from),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- device object ref excluded intentionally; specific stable properties listed instead
  }, [selectedNode, device.traceRouteResults, device.state.myNodeNum, device.getFullNodeLabel]);

  // ─── Startup node pruning based on persisted admin settings ─────
  useEffect(() => {
    try {
      const s =
        parseStoredJson<Record<string, unknown>>(
          localStorage.getItem('mesh-client:adminSettings'),
          'App startup node pruning',
        ) ?? {};
      if (s.autoPruneEnabled) {
        const days =
          typeof s.autoPruneDays === 'number' && s.autoPruneDays > 0 ? s.autoPruneDays : 30;
        void window.electronAPI.db
          .deleteNodesByAge(days)
          .catch((e) => console.warn('[App] startup deleteNodesByAge failed', e));
      }
      if (s.nodeCapEnabled !== false) {
        const cap =
          typeof s.nodeCapCount === 'number' && s.nodeCapCount > 0 ? s.nodeCapCount : 10000;
        void window.electronAPI.db
          .pruneNodesByCount(cap)
          .catch((e) => console.warn('[App] startup pruneNodesByCount failed', e));
      }
    } catch (e) {
      console.debug('[App] startup node pruning', e);
    }
  }, []);

  // ─── MQTT auto-launch on startup ─────────────────────────────────
  useEffect(() => {
    try {
      const settings = parseStoredJson<MQTTSettings>(
        localStorage.getItem('mesh-client:mqttSettings'),
        'App MQTT auto-launch',
      );
      if (settings?.autoLaunch) {
        void window.electronAPI.mqtt
          .connect(settings)
          .catch((e) => console.warn('[App] MQTT auto-launch connect failed', e));
      }
    } catch (e) {
      console.debug('[App] MQTT auto-launch startup', e);
    }
  }, []);

  // ─── Auto-update event subscriptions ─────────────────────────────
  useEffect(() => {
    const offAvailable = window.electronAPI.update.onAvailable((info) => {
      setUpdateState({
        phase: 'available',
        version: info.version,
        releaseUrl: info.releaseUrl,
        isPackaged: info.isPackaged,
        isMac: info.isMac,
        dismissed: false,
      });
    });
    const offNotAvailable = window.electronAPI.update.onNotAvailable(() => {
      setUpdateState((s) => (s.phase === 'idle' ? s : { ...s, phase: 'idle' }));
    });
    const offProgress = window.electronAPI.update.onProgress((info) => {
      setUpdateState((s) => ({ ...s, phase: 'downloading', percent: info.percent }));
    });
    const offDownloaded = window.electronAPI.update.onDownloaded(() => {
      setUpdateState((s) => ({ ...s, phase: 'ready' }));
    });
    const offError = window.electronAPI.update.onError(() => {
      setUpdateState((s) => ({ ...s, phase: 'error' }));
    });
    return () => {
      offAvailable();
      offNotAvailable();
      offProgress();
      offDownloaded();
      offError();
    };
  }, []);

  // ─── Keyboard shortcuts: Cmd/Ctrl+1-8 for tabs, ? for help ───────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '8') {
        e.preventDefault();
        setActiveTab(parseInt(e.key) - 1);
      } else if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          setShowShortcuts(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
      const realNew = newMsgs.filter((m) => m.sender_id !== device.state.myNodeNum && !m.emoji);
      if (realNew.length > 0) setChatUnread((prev) => prev + realNew.length);
    }
    prevMsgCountRef.current = count;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally triggered only on message count change; activeTab/myNodeNum read as current values at run time
  }, [device.messages.length]);

  // ─── Clear unread when Chat tab becomes active ────────────────────
  useEffect(() => {
    if (activeTab === 1) setChatUnread(0);
  }, [activeTab]);

  // ─── Persist unread + sync to tray ───────────────────────────────
  useEffect(() => {
    persistChatUnread(chatUnread);
    window.electronAPI.setTrayUnread(chatUnread);
  }, [chatUnread]);

  // Manual reconnect from banner
  const handleReconnect = useCallback(() => {
    const lastType = device.state.connectionType ?? 'ble';
    device.disconnect().then(() => {
      // Small delay before reconnecting
      setTimeout(() => {
        device.connect(lastType).catch((err) => {
          console.warn('[App] handleReconnect connect failed', err);
        });
      }, 500);
    });
  }, [device]);

  const handleMessageNode = useCallback((nodeNum: number) => {
    setPendingDmTarget(nodeNum);
    setActiveTab(1); // Switch to Chat tab
  }, []);

  const handleLocationFilterChange = useCallback((f: LocationFilter) => setLocationFilter(f), []);

  const statusColor = STATUS_COLOR[device.state.status] ?? 'bg-gray-500';

  return (
    <ToastProvider>
      {/* Global assertive live region for critical announcements */}
      <div aria-live="assertive" aria-atomic="true" className="sr-only" id="app-announcer" />
      <div className="flex flex-col h-screen">
        {/* Header */}
        <header
          className={`relative flex items-center justify-between px-4 py-2 bg-deep-black border-b ${
            isConfigured ? 'border-brand-green/20' : 'border-gray-700'
          }`}
        >
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-bright-green tracking-wide">Colorado Mesh</h1>
            <span className="text-xs text-muted">Meshtastic Client</span>
          </div>
          {/* Keyboard shortcuts — absolutely centered in header */}
          <button
            onClick={() => setShowShortcuts(true)}
            aria-label="Keyboard shortcuts"
            aria-haspopup="dialog"
            className="absolute left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-slate-600 bg-slate-800/60 shadow-sm text-gray-400 hover:text-gray-200 hover:border-slate-500 hover:bg-slate-700/60 transition-colors text-sm font-medium"
            title="Keyboard shortcuts (?)"
          >
            Shortcuts{' '}
            <kbd className="px-1.5 py-0.5 border border-slate-500 rounded bg-slate-700 text-slate-300 text-xs font-mono">
              ?
            </kbd>
          </button>
          <div className="flex items-center gap-2">
            {/* MQTT status globe */}
            <div
              className="flex items-center gap-1.5 mr-3 pr-3 border-r border-gray-700"
              aria-label={
                device.mqttStatus === 'connected' ? 'MQTT: connected' : 'MQTT: disconnected'
              }
            >
              <MqttGlobeIcon connected={device.mqttStatus === 'connected'} />
              <span
                className={`text-xs ${device.mqttStatus === 'connected' ? 'text-brand-green' : 'text-gray-500'}`}
              >
                MQTT
              </span>
            </div>
            {isConnectedOrOperational && <LinkIcon className="w-4 h-4" aria-hidden="true" />}
            <div
              className={`w-2.5 h-2.5 rounded-full ${statusColor}`}
              aria-label={STATUS_LABELS[device.state.status] ?? device.state.status}
            />
            <div role="status" aria-live="polite" aria-atomic="true">
              <span className="text-sm text-muted capitalize">
                {device.state.status}
                {device.state.connectionType
                  ? ` (${device.state.connectionType.toUpperCase()})`
                  : ''}
              </span>
            </div>
            {device.state.myNodeNum > 0 && (
              <span className="text-xs text-muted ml-2 whitespace-nowrap">
                Node: {device.getPickerStyleNodeLabel(device.state.myNodeNum)}
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

        {/* Telemetry disabled notice */}
        {isOperational && device.telemetryEnabled === false && !telemetryNoticeDismissed && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-between gap-3 px-4 py-2 bg-gray-900 border-b border-gray-700 text-sm"
          >
            <span className="text-gray-300">
              Telemetry is disabled on this device. Enabling device metrics helps the mesh and this
              app (diagnostics, battery, signal). Enable it in the Radio tab.
            </span>
            <button
              type="button"
              onClick={() => setTelemetryNoticeDismissed(true)}
              aria-label="Dismiss telemetry notice"
              className="shrink-0 text-gray-500 hover:text-gray-300 transition-colors text-base leading-none"
            >
              ×
            </button>
          </div>
        )}

        {/* Update Notification Banner */}
        <UpdateBanner
          updateState={updateState}
          onDownload={() => window.electronAPI.update.download()}
          onInstall={() => window.electronAPI.update.install()}
          onViewRelease={() => window.electronAPI.update.openReleases(updateState.releaseUrl)}
          onDismiss={() => setUpdateState((s) => ({ ...s, dismissed: true }))}
        />

        <div className={`flex flex-1 min-h-0 ${logPanelVisible ? 'flex-row' : 'flex-col'}`}>
          <div className="flex flex-col flex-1 min-w-0 min-h-0">
            {/* Tabs */}
            <Tabs
              tabs={TAB_NAMES}
              active={activeTab}
              onChange={setActiveTab}
              chatUnread={chatUnread}
            />

            {/* Content */}
            <main className="flex-1 overflow-auto p-4 min-h-0">
              <ErrorBoundary>
                {activeTab === 0 && (
                  <ConnectionPanel
                    state={device.state}
                    onConnect={device.connect}
                    onAutoConnect={device.connectAutomatic}
                    onDisconnect={device.disconnect}
                    mqttStatus={device.mqttStatus}
                    myNodeLabel={
                      device.state.myNodeNum > 0
                        ? device.getPickerStyleNodeLabel(device.state.myNodeNum)
                        : undefined
                    }
                  />
                )}
                <div className={activeTab === 1 ? 'contents' : 'hidden'}>
                  <ChatPanel
                    messages={device.messages}
                    channels={device.channels}
                    myNodeNum={device.selfNodeId}
                    onSend={device.sendMessage}
                    onReact={device.sendReaction}
                    onNodeClick={setSelectedNodeId}
                    isConnected={isOperational || device.mqttStatus === 'connected'}
                    isMqttOnly={!isOperational && device.mqttStatus === 'connected'}
                    connectionType={device.state.connectionType}
                    nodes={device.nodes}
                    initialDmTarget={pendingDmTarget}
                    onDmTargetConsumed={() => setPendingDmTarget(null)}
                    isActive={activeTab === 1}
                  />
                </div>
                {activeTab === 2 && (
                  <NodeListPanel
                    nodes={device.nodes}
                    myNodeNum={device.selfNodeId}
                    onNodeClick={(node) => setSelectedNodeId(node.node_id)}
                    mqttConnected={device.mqttStatus === 'connected'}
                    locationFilter={locationFilter}
                    onToggleFavorite={device.setNodeFavorited}
                  />
                )}
                {activeTab === 3 && (
                  <MapPanel
                    nodes={device.nodes}
                    myNodeNum={device.selfNodeId}
                    locationFilter={locationFilter}
                    ourPosition={device.ourPosition}
                    onLocateMe={() =>
                      device
                        .refreshOurPosition()
                        .then((p) => (p ? { lat: p.lat, lon: p.lon } : null))
                    }
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
                    telemetryDeviceUpdateInterval={device.telemetryDeviceUpdateInterval}
                    onReboot={device.reboot}
                    onShutdown={device.shutdown}
                    onFactoryReset={device.factoryReset}
                    onResetNodeDb={device.resetNodeDb}
                    ourPosition={device.ourPosition}
                    onSendPositionToDevice={device.sendPositionToDevice}
                  />
                )}
                {activeTab === 6 && (
                  <AppPanel
                    logPanelVisible={logPanelVisible}
                    onLogPanelVisibleChange={(visible) => {
                      setLogPanelVisible(visible);
                      try {
                        localStorage.setItem(LOG_PANEL_VISIBLE_KEY, visible ? 'true' : 'false');
                      } catch (e) {
                        console.debug('[App] persist logPanelVisible', e);
                      }
                    }}
                    nodes={device.nodes}
                    messageCount={device.messages.length}
                    channels={device.channels}
                    myNodeNum={device.state.myNodeNum}
                    onLocationFilterChange={handleLocationFilterChange}
                    ourPosition={device.ourPosition}
                    onRefreshGps={device.refreshOurPosition}
                    gpsLoading={device.gpsLoading}
                    onGpsIntervalChange={device.updateGpsInterval}
                    onNodesPruned={device.refreshNodesFromDb}
                    onMessagesPruned={device.refreshMessagesFromDb}
                  />
                )}
                {activeTab === 7 && (
                  <DiagnosticsPanel
                    nodes={device.nodes}
                    myNodeNum={device.selfNodeId}
                    onTraceRoute={device.traceRoute}
                    isConnected={isOperational}
                    traceRouteResults={device.traceRouteResults}
                    getFullNodeLabel={device.getFullNodeLabel}
                    ourPosition={device.ourPosition}
                    onNodeClick={(node) => setSelectedNodeId(node.node_id)}
                  />
                )}
              </ErrorBoundary>
            </main>

            {/* Footer */}
            <footer className="px-4 py-1.5 bg-deep-black border-t border-gray-700 text-[11px] text-muted flex justify-between shrink-0">
              <span>
                A Project by{' '}
                <a
                  href="https://coloradomesh.org/"
                  title="Colorado Mesh"
                  className="text-bright-green underline hover:opacity-80"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Colorado Mesh
                </a>
                . Join us on{' '}
                <a
                  href="https://discord.com/invite/McChKR5NpS"
                  title="Colorado Mesh Discord"
                  className="text-bright-green underline hover:opacity-80"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Discord
                </a>
                . Code on{' '}
                <a
                  href="https://github.com/Colorado-Mesh/meshtastic-client"
                  title="Colorado Mesh on GitHub"
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
          </div>
          {logPanelVisible && <LogPanel />}
        </div>

        {/* Keyboard Shortcuts Modal */}
        {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}

        {/* Node Detail Modal — rendered outside main for proper z-indexing */}
        <NodeDetailModal
          nodes={device.nodes}
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
            selectedNode?.node_id !== device.state.myNodeNum ? handleMessageNode : undefined
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
  if (status === 'stale') {
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

  if (status === 'reconnecting') {
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
