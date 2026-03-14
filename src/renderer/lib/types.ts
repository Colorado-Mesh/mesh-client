export type ConnectionType = 'ble' | 'serial' | 'http';

export type AnomalyType = 'hop_goblin' | 'bad_route' | 'route_flapping' | 'impossible_hop';

/** How confident the detector is: proven uses distance/stats; heuristic is SNR/hops pattern only. */
export type AnomalyConfidence = 'proven' | 'heuristic';

export interface NodeAnomaly {
  nodeId: number;
  type: AnomalyType;
  severity: 'error' | 'warning' | 'info';
  description: string;
  detectedAt: number;
  snr?: number;
  hopsAway?: number;
  /** Set when severity is based on pattern only (e.g. no GPS distance). Drives UI copy without string matching. */
  confidence?: AnomalyConfidence;
}

/** Routing anomaly as a table row (one per node from RoutingDiagnosticEngine). */
export interface RoutingDiagnosticRow {
  kind: 'routing';
  id: string;
  nodeId: number;
  type: AnomalyType;
  severity: 'error' | 'warning' | 'info';
  description: string;
  detectedAt: number;
  snr?: number;
  hopsAway?: number;
  confidence?: AnomalyConfidence;
}

/** RF finding as a table row (multiple per node from RFDiagnosticEngine). */
export interface RfDiagnosticRow {
  kind: 'rf';
  id: string;
  nodeId: number;
  condition: string;
  cause: string;
  severity: 'warning' | 'info';
  detectedAt: number;
  isLastHop?: boolean;
}

export type DiagnosticRow = RoutingDiagnosticRow | RfDiagnosticRow;

export function routingRowId(nodeId: number): string {
  return `routing:${nodeId}`;
}

export function rfRowId(nodeId: number, condition: string): string {
  const slug = condition.replace(/[/\s]+/g, '_').toLowerCase();
  return `rf:${nodeId}:${slug}`;
}

export function nodeAnomalyToRoutingRow(a: NodeAnomaly): RoutingDiagnosticRow {
  return {
    kind: 'routing',
    id: routingRowId(a.nodeId),
    nodeId: a.nodeId,
    type: a.type,
    severity: a.severity,
    description: a.description,
    detectedAt: a.detectedAt,
    snr: a.snr,
    hopsAway: a.hopsAway,
    confidence: a.confidence,
  };
}

export function routingRowToNodeAnomaly(r: RoutingDiagnosticRow): NodeAnomaly {
  return {
    nodeId: r.nodeId,
    type: r.type,
    severity: r.severity,
    description: r.description,
    detectedAt: r.detectedAt,
    snr: r.snr,
    hopsAway: r.hopsAway,
    confidence: r.confidence,
  };
}

export interface HopHistoryPoint {
  t: number; // timestamp ms
  h: number; // hops_away value
}

export interface MeshNode {
  node_id: number;
  long_name: string;
  short_name: string;
  hw_model: string;
  snr: number;
  rssi?: number;
  battery: number;
  last_heard: number;
  latitude: number | null;
  longitude: number | null;
  role?: number;
  hops_away?: number;
  via_mqtt?: boolean | number;
  voltage?: number;
  channel_utilization?: number;
  air_util_tx?: number;
  altitude?: number;
  favorited?: boolean;
  // MQTT source tracking
  heard_via_mqtt_only?: boolean; // session-only: true if never heard via RF this session
  heard_via_mqtt?: boolean; // session-only: true if any MQTT update was received this session
  source?: 'rf' | 'mqtt'; // persistent: written to DB
  lastPositionWarning?: string; // set when bad GPS data received; cleared on valid update
  // LocalStats telemetry (connected node only, from localStats variant)
  num_packets_rx_bad?: number;
  num_rx_dupe?: number;
  num_packets_rx?: number;
  num_packets_tx?: number;
}

export type RemediationCategory = 'Configuration' | 'Physical' | 'Hardware' | 'Software';

export interface DiagnosticRemedy {
  title: string;
  description: string;
  category: RemediationCategory;
  severity: 'info' | 'warning' | 'critical';
}

export interface MQTTSettings {
  server: string;
  port: number;
  username: string;
  password: string;
  topicPrefix: string;
  autoLaunch: boolean;
  maxRetries?: number;
  /** When using TLS (port 8883), set true to skip certificate verification (self-signed brokers). Default false = verify. */
  tlsInsecure?: boolean;
}

export type MQTTStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ChatMessage {
  id?: number;
  sender_id: number;
  sender_name: string;
  payload: string;
  channel: number;
  timestamp: number;
  // Delivery status tracking
  packetId?: number;
  status?: 'sending' | 'acked' | 'failed'; // device (RF) transport
  mqttStatus?: 'sending' | 'acked' | 'failed'; // MQTT transport (hybrid/MQTT-only)
  error?: string;
  // Emoji reactions / tapback
  emoji?: number;
  replyId?: number;
  // Direct message destination (undefined = broadcast)
  to?: number;
  // Which transport(s) delivered this incoming message
  receivedVia?: 'rf' | 'mqtt' | 'both';
}

export interface TelemetryPoint {
  timestamp: number;
  batteryLevel?: number;
  voltage?: number;
  snr?: number;
  rssi?: number;
}

export interface DeviceState {
  status: 'disconnected' | 'connecting' | 'connected' | 'configured' | 'stale' | 'reconnecting';
  myNodeNum: number;
  connectionType: ConnectionType | null;
  reconnectAttempt?: number;
  lastDataReceived?: number;
  firmwareVersion?: string;
}

export interface BluetoothDevice {
  deviceId: string;
  deviceName: string;
}

export interface SerialPortInfo {
  portId: string;
  displayName: string;
  portName: string;
  vendorId?: string;
  productId?: string;
}

// Extend the Window interface for the electron preload bridge
declare global {
  interface Window {
    electronAPI: {
      db: {
        saveMessage: (msg: ChatMessage) => Promise<unknown>;
        getMessages: (channel?: number, limit?: number) => Promise<ChatMessage[]>;
        saveNode: (node: MeshNode) => Promise<unknown>;
        getNodes: () => Promise<MeshNode[]>;
        clearMessages: () => Promise<unknown>;
        clearNodes: () => Promise<unknown>;
        deleteNode: (nodeId: number) => Promise<unknown>;
        updateMessageStatus: (
          packetId: number,
          status: string,
          error?: string,
          mqttStatus?: string,
        ) => Promise<unknown>;
        exportDb: () => Promise<string | null>;
        importDb: () => Promise<{ nodesAdded: number; messagesAdded: number } | null>;
        deleteNodesByAge: (days: number) => Promise<unknown>;
        pruneNodesByCount: (maxCount: number) => Promise<unknown>;
        deleteNodesBatch: (nodeIds: number[]) => Promise<number>;
        clearMessagesByChannel: (channel: number) => Promise<unknown>;
        getMessageChannels: () => Promise<{ channel: number }[]>;
        setNodeFavorited: (nodeId: number, favorited: boolean) => Promise<unknown>;
        deleteNodesBySource: (source: string) => Promise<number>;
        clearNodePositions: () => Promise<unknown>;
        updateMessageReceivedVia: (packetId: number) => Promise<unknown>;
      };
      mqtt: {
        connect: (settings: MQTTSettings) => Promise<void>;
        disconnect: () => Promise<void>;
        onStatus: (cb: (status: MQTTStatus) => void) => () => void;
        onError: (cb: (message: string) => void) => () => void;
        onNodeUpdate: (cb: (node: Partial<MeshNode> & { node_id: number }) => void) => () => void;
        onMessage: (cb: (msg: Omit<ChatMessage, 'id'>) => void) => () => void;
        onClientId: (cb: (id: string) => void) => () => void;
        getClientId: () => Promise<string>;
        publish: (args: {
          text: string;
          from: number;
          channel: number;
          destination?: number;
          channelName?: string;
          emoji?: number;
          replyId?: number;
        }) => Promise<number>;
      };
      onBluetoothDevicesDiscovered: (cb: (devices: BluetoothDevice[]) => void) => () => void;
      selectBluetoothDevice: (deviceId: string) => void;
      cancelBluetoothSelection: () => void;
      onSerialPortsDiscovered: (cb: (ports: SerialPortInfo[]) => void) => () => void;
      selectSerialPort: (portId: string) => void;
      cancelSerialSelection: () => void;
      clearSessionData: () => Promise<void>;
      notifyDeviceConnected: () => void;
      notifyDeviceDisconnected: () => void;
      setTrayUnread: (count: number) => void;
      quitApp: () => Promise<void>;
      log: {
        getPath: () => Promise<string>;
        getRecentLines: () => Promise<
          { ts: number; level: string; source: string; message: string }[]
        >;
        clear: () => Promise<void>;
        export: () => Promise<string | null>;
        onLine: (
          cb: (entry: { ts: number; level: string; source: string; message: string }) => void,
        ) => () => void;
      };
      update: {
        check: () => Promise<void>;
        download: () => Promise<void>;
        install: () => Promise<void>;
        openReleases: (url?: string) => Promise<void>;
        onAvailable: (
          cb: (info: {
            version: string;
            releaseUrl: string;
            isPackaged: boolean;
            isMac: boolean;
          }) => void,
        ) => () => void;
        onNotAvailable: (cb: () => void) => () => void;
        onProgress: (cb: (info: { percent: number }) => void) => () => void;
        onDownloaded: (cb: () => void) => () => void;
        onError: (cb: (info: { message: string }) => void) => () => void;
      };
    };
  }
}
