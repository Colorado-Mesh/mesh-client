export type ConnectionType = "ble" | "serial" | "http";

export type AnomalyType = 'hop_goblin' | 'bad_route' | 'route_flapping' | 'impossible_hop';

export interface NodeAnomaly {
  nodeId: number;
  type: AnomalyType;
  severity: 'warning' | 'error';
  description: string;
  detectedAt: number;
  snr?: number;
  hopsAway?: number;
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
  latitude: number;
  longitude: number;
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
  heard_via_mqtt?: boolean;      // session-only: true if any MQTT update was received this session
  source?: "rf" | "mqtt";       // persistent: written to DB
  lastPositionWarning?: string; // set when bad GPS data received; cleared on valid update
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
}

export type MQTTStatus = "disconnected" | "connecting" | "connected" | "error";

export interface ChatMessage {
  id?: number;
  sender_id: number;
  sender_name: string;
  payload: string;
  channel: number;
  timestamp: number;
  // Delivery status tracking
  packetId?: number;
  status?: "sending" | "acked" | "failed";
  error?: string;
  // Emoji reactions / tapback
  emoji?: number;
  replyId?: number;
  // Direct message destination (undefined = broadcast)
  to?: number;
}

export interface TelemetryPoint {
  timestamp: number;
  batteryLevel?: number;
  voltage?: number;
  snr?: number;
  rssi?: number;
}

export interface DeviceState {
  status: "disconnected" | "connecting" | "connected" | "configured" | "stale" | "reconnecting";
  myNodeNum: number;
  connectionType: ConnectionType | null;
  reconnectAttempt?: number;
  lastDataReceived?: number;
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
        getMessages: (
          channel?: number,
          limit?: number
        ) => Promise<ChatMessage[]>;
        saveNode: (node: MeshNode) => Promise<unknown>;
        getNodes: () => Promise<MeshNode[]>;
        clearMessages: () => Promise<unknown>;
        clearNodes: () => Promise<unknown>;
        deleteNode: (nodeId: number) => Promise<unknown>;
        updateMessageStatus: (
          packetId: number,
          status: string,
          error?: string
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
      };
      mqtt: {
        connect: (settings: MQTTSettings) => Promise<void>;
        disconnect: () => Promise<void>;
        onStatus: (cb: (status: MQTTStatus) => void) => () => void;
        onError: (cb: (message: string) => void) => () => void;
        onNodeUpdate: (cb: (node: Partial<MeshNode> & { node_id: number }) => void) => () => void;
        onMessage: (cb: (msg: Omit<ChatMessage, "id">) => void) => () => void;
        onClientId: (cb: (id: string) => void) => () => void;
        publish: (args: { text: string; from: number; channel: number; destination?: number; channelName?: string }) => Promise<number>;
      };
      onBluetoothDevicesDiscovered: (
        cb: (devices: BluetoothDevice[]) => void
      ) => () => void;
      selectBluetoothDevice: (deviceId: string) => void;
      cancelBluetoothSelection: () => void;
      onSerialPortsDiscovered: (
        cb: (ports: SerialPortInfo[]) => void
      ) => () => void;
      selectSerialPort: (portId: string) => void;
      cancelSerialSelection: () => void;
      clearSessionData: () => Promise<void>;
      notifyDeviceConnected: () => void;
      notifyDeviceDisconnected: () => void;
      setTrayUnread: (count: number) => void;
      quitApp: () => Promise<void>;
    };
  }
}
