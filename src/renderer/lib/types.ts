import type { TAKClientInfo, TAKServerStatus, TAKSettings } from '@/shared/tak-types';

export type { TAKClientInfo, TAKServerStatus, TAKSettings };

export type ConnectionType = 'ble' | 'serial' | 'http';

export type MeshProtocol = 'meshtastic' | 'meshcore';

export type AnomalyType =
  | 'hop_goblin'
  | 'bad_route'
  | 'route_flapping'
  | 'impossible_hop'
  | 'noisy_node';

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

export interface PositionPoint {
  t: number; // Unix ms timestamp
  lat: number;
  lon: number;
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
  on_radio?: boolean;
  // MeshCore routing info
  hops?: number;
  path?: number[];
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
  // MeshCore local stats (connected node only, from getStats*())
  meshcore_local_stats?: MeshCoreLocalStats;
  // Environmental sensor data (session-only, last received reading)
  env_temperature?: number;
  env_humidity?: number;
  env_pressure?: number;
  env_iaq?: number;
  env_lux?: number;
  env_wind_speed?: number;
  env_wind_direction?: number;
  // Neighbor info from MQTT (session-only)
  neighbors?: MeshNeighbor[];
  // PaxCounter from MQTT (combined wifi + ble count)
  pax_count?: number;
  // Detection sensor text alert from MQTT
  detection_text?: string;
}

export interface MeshCoreLocalStats {
  // Type 0 (Core)
  batteryMilliVolts: number;
  uptimeSecs: number;
  queueLen: number;
  // Type 1 (Radio)
  noiseFloor: number;
  lastRssi: number;
  lastSnr: number;
  txAirSecs: number;
  rxAirSecs: number;
  // Type 2 (Packets)
  recv: number;
  sent: number;
  nSentFlood: number;
  nSentDirect: number;
  nRecvFlood: number;
  nRecvDirect: number;
  nRecvErrors?: number;
  // Computed
  channelUtilization?: number;
  airUtilTx?: number;
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
  /** Explicitly enable TLS for WebSocket connections. When true, uses wss:// scheme. */
  tlsEnabled?: boolean;
  /**
   * Additional base64-encoded AES-128 PSKs to try when decrypting packets from custom channels.
   * The default PSK (AQ==, padded to 16 bytes) is always tried first.
   */
  channelPsks?: string[];
  /** Broker codec: Meshtastic protobuf vs MeshCore JSON adapter (main process). */
  mqttTransportProtocol?: 'meshtastic' | 'meshcore';
  /** Use ws:// or wss:// transport instead of mqtt:// / mqtts:// (required for port 443 on LetsMesh). */
  useWebSocket?: boolean;
  /** MQTT keepalive interval in seconds. Defaults to 60 for TCP/TLS, 30 for WebSocket. */
  keepalive?: number;
  /**
   * When true (MeshCore MQTT + LetsMesh public broker), forward RX packet summaries to
   * `{topicPrefix}/meshcore/packets` for the Analyzer (meshcoretomqtt-shaped JSON). Default false.
   */
  meshcorePacketLoggerEnabled?: boolean;
  /** Epoch milliseconds when the JWT token expires. Used for proactive refresh. */
  tokenExpiresAt?: number;
  /** WebSocket path (e.g. '/mqtt' or '/ws'). Default '/mqtt'. */
  wsPath?: string;
}

export type MQTTStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Node record from the main-process MQTT active node cache (getCachedNodes). */
export interface CachedNode {
  node_id: number;
  long_name: string;
  short_name: string;
  hw_model: string;
  last_heard: number;
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
}

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
  // true for backlog messages (e.g. MeshCore MsgWaiting catch-up); excluded from unread counter
  isHistory?: boolean;
  /** Full raw line from device/MQTT for dedupe only (not persisted); avoids collapsing same-second identical payloads. */
  meshcoreDedupeKey?: string;
  /** CRC-32 RF packet fingerprint (8 hex), when persisted from capture metadata */
  rxPacketFingerprintHex?: string;
  /** Truncated text of the replied-to message (max 50 chars; persisted for reload) */
  replyPreviewText?: string;
  /** Sender name of the replied-to message */
  replyPreviewSender?: string;
}

export interface TelemetryPoint {
  timestamp: number;
  batteryLevel?: number;
  voltage?: number;
  snr?: number;
  rssi?: number;
}

export interface EnvironmentTelemetryPoint {
  timestamp: number;
  nodeNum: number;
  temperature?: number; // °C
  relativeHumidity?: number; // %
  barometricPressure?: number; // hPa
  gasResistance?: number; // MOhm
  iaq?: number; // 0–500 (BME680)
  lux?: number;
  windSpeed?: number; // m/s
  windDirection?: number; // degrees 0–360
  windGust?: number;
  windLull?: number;
  weight?: number; // kg
  rainfall1h?: number;
  rainfall24h?: number;
}

export interface DeviceState {
  status: 'disconnected' | 'connecting' | 'connected' | 'configured' | 'stale' | 'reconnecting';
  myNodeNum: number;
  connectionType: ConnectionType | null;
  reconnectAttempt?: number;
  lastDataReceived?: number;
  firmwareVersion?: string;
  /** MeshCore: manufacturer/model string from local `deviceQuery` (connected radio only). */
  manufacturerModel?: string;
  /** 0–100 from device metrics; omit until first reading */
  batteryPercent?: number;
  batteryCharging?: boolean;
}

export interface NobleBleDevice {
  deviceId: string;
  deviceName: string;
}
export type NobleBleSessionId = 'meshtastic' | 'meshcore';
export type NobleBleConnectResult = { ok: true } | { ok: false; error: string };

export interface WebBluetoothDevice {
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

export interface LinuxBleCapabilityStatus {
  platform: 'linux' | 'other';
  hasCapNetRaw: boolean;
  detail: string;
}

export interface MeshWaypoint {
  id: number;
  latitude: number;
  longitude: number;
  name: string;
  description?: string;
  icon?: number;
  lockedTo?: number;
  expire?: number;
  from: number;
  timestamp: number;
}

export interface MeshNeighbor {
  nodeId: number;
  snr: number;
  lastRxTime: number;
}

export interface NeighborInfoRecord {
  nodeId: number;
  neighbors: MeshNeighbor[];
  timestamp: number;
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
        deleteNodesNeverHeard: () => Promise<number>;
        pruneNodesByCount: (maxCount: number) => Promise<unknown>;
        pruneMessagesByCount: (maxCount: number) => Promise<unknown>;
        pruneMeshcoreMessagesByCount: (maxCount: number) => Promise<unknown>;
        deleteNodesBatch: (nodeIds: number[]) => Promise<number>;
        clearMessagesByChannel: (channel: number) => Promise<unknown>;
        getMessageChannels: () => Promise<{ channel: number }[]>;
        setNodeFavorited: (nodeId: number, favorited: boolean) => Promise<unknown>;
        deleteNodesBySource: (source: string) => Promise<number>;
        migrateRfStubNodes: () => Promise<number>;
        deleteNodesWithoutLongname: () => Promise<number>;
        prunePositionHistory: (days: number) => Promise<number>;
        clearNodePositions: () => Promise<unknown>;
        updateMessageReceivedVia: (packetId: number) => Promise<unknown>;
        updateMessagePacketId: (oldPacketId: number, newPacketId: number) => Promise<unknown>;
        saveMeshcoreMessage: (message: {
          sender_id?: number | null;
          sender_name?: string | null;
          payload: string;
          channel_idx?: number;
          timestamp: number;
          status?: string;
          packet_id?: number | null;
          emoji?: number | null;
          reply_id?: number | null;
          to_node?: number | null;
          received_via?: string | null;
          rx_packet_fingerprint?: string | null;
          reply_preview_text?: string | null;
          reply_preview_sender?: string | null;
        }) => Promise<unknown>;
        updateMeshcoreContactRfTransport: (
          nodeId: number,
          transportScope: number | null,
          transportReturn: number | null,
        ) => Promise<unknown>;
        saveMeshcoreContact: (contact: {
          node_id: number;
          public_key: string;
          adv_name?: string | null;
          contact_type?: number;
          last_advert?: number | null;
          adv_lat?: number | null;
          adv_lon?: number | null;
          last_snr?: number | null;
          last_rssi?: number | null;
          nickname?: string | null;
          contact_flags?: number | null;
          hops_away?: number | null;
          on_radio?: number;
          last_synced_from_radio?: string | null;
        }) => Promise<unknown>;
        updateMeshcoreMessageStatus: (packetId: number, status: string) => Promise<unknown>;
        updateMeshcoreContactAdvert: (
          nodeId: number,
          lastAdvert: number | null,
          advLat: number | null,
          advLon: number | null,
          advName?: string | null,
        ) => Promise<unknown>;
        updateMeshcoreContactType: (nodeId: number, contactType: number) => Promise<unknown>;
        updateMeshcoreContactLastRf: (
          nodeId: number,
          lastSnr: number,
          lastRssi: number,
          hops?: number | null,
          timestamp?: number | null,
        ) => Promise<unknown>;
        getMeshcoreMessages: (channelIdx?: number, limit?: number) => Promise<unknown[]>;
        searchMessages: (query: string, limit?: number) => Promise<unknown[]>;
        searchMeshcoreMessages: (query: string, limit?: number) => Promise<unknown[]>;
        getMeshcoreContacts: () => Promise<unknown[]>;
        deleteMeshcoreContact: (nodeId: number) => Promise<unknown>;
        clearMeshcoreMessages: () => Promise<unknown>;
        getMeshcoreMessageChannels: () => Promise<{ channel: number }[]>;
        clearMeshcoreMessagesByChannel: (channelIdx: number) => Promise<unknown>;
        clearMeshcoreContacts: () => Promise<unknown>;
        deleteMeshcoreContactsNeverAdvertised: () => Promise<number>;
        deleteMeshcoreContactsByAge: (days: number) => Promise<number>;
        pruneMeshcoreContactsByCount: (maxCount: number) => Promise<number>;
        clearMeshcoreRepeaters: () => Promise<unknown>;
        markAllMeshcoreContactsOffRadio: () => Promise<unknown>;
        getMeshcoreContactCount: () => Promise<number>;
        deleteMeshcoreContactsWithoutPubkey: () => Promise<{
          deleted: number;
          excludedStubCount: number;
        }>;
        offloadAllMeshcoreContacts: () => Promise<number>;
        getMeshcoreContactById: (nodeId: number) => Promise<{
          node_id: number;
          public_key: string;
          on_radio: number;
        } | null>;
        updateMeshcoreContactNickname: (
          nodeId: number,
          nickname: string | null,
        ) => Promise<unknown>;
        updateMeshcoreContactFavorited: (
          nodeId: number,
          favorited: boolean,
          publicKeyHex?: string | null,
        ) => Promise<unknown>;
        savePositionHistory: (
          nodeId: number,
          lat: number,
          lon: number,
          recordedAt: number,
          source: string,
        ) => Promise<unknown>;
        getPositionHistory: (sinceMs: number) => Promise<
          {
            node_id: number;
            latitude: number;
            longitude: number;
            recorded_at: number;
            source: string;
          }[]
        >;
        clearPositionHistory: () => Promise<unknown>;
        saveMeshcoreHopHistory: (
          nodeId: number,
          timestamp: number,
          hops: number | null,
          snr: number | null,
          rssi: number | null,
        ) => Promise<boolean>;
        getMeshcoreHopHistory: (nodeId: number) => Promise<{
          node_id: number;
          timestamp: number;
          hops: number | null;
          snr: number | null;
          rssi: number | null;
        } | null>;
        saveMeshcoreTraceHistory: (
          nodeId: number,
          timestamp: number,
          pathLen: number | null,
          pathSnrs: number[],
          lastSnr: number | null,
          tag: number,
        ) => Promise<boolean>;
        getMeshcoreTraceHistory: (nodeId: number) => Promise<
          {
            id: number;
            node_id: number;
            timestamp: number;
            path_len: number | null;
            path_snrs: string | null;
            last_snr: number | null;
            tag: number | null;
          }[]
        >;
        pruneMeshcorePathHistory: (nodeId: number) => Promise<boolean>;
        upsertMeshcorePathHistory: (
          nodeId: number,
          pathHash: string,
          hopCount: number,
          pathBytes: number[],
          wasFloodDiscovery: boolean,
          routeWeight: number,
        ) => Promise<boolean>;
        recordMeshcorePathOutcome: (
          nodeId: number,
          pathHash: string,
          success: boolean,
          tripTimeMs?: number,
        ) => Promise<boolean>;
        getMeshcorePathHistory: (nodeId: number) => Promise<
          {
            id: number;
            node_id: number;
            path_hash: string;
            hop_count: number;
            path_bytes: string;
            was_flood_discovery: number;
            success_count: number;
            failure_count: number;
            trip_time_ms: number;
            route_weight: number;
            last_success_ts: number | null;
            created_at: number;
            updated_at: number;
          }[]
        >;
        getAllMeshcorePathHistory: () => Promise<
          {
            id: number;
            node_id: number;
            path_hash: string;
            hop_count: number;
            path_bytes: string;
            was_flood_discovery: number;
            success_count: number;
            failure_count: number;
            trip_time_ms: number;
            route_weight: number;
            last_success_ts: number | null;
            created_at: number;
            updated_at: number;
          }[]
        >;
        deleteMeshcorePathHistoryForNode: (nodeId: number) => Promise<boolean>;
        deleteAllMeshcorePathHistory: () => Promise<boolean>;
        getContactGroups: (
          selfNodeId: number,
        ) => Promise<{ group_id: number; name: string; member_count: number }[]>;
        createContactGroup: (selfNodeId: number, name: string) => Promise<number>;
        updateContactGroup: (groupId: number, name: string) => Promise<void>;
        deleteContactGroup: (groupId: number) => Promise<void>;
        addContactToGroup: (groupId: number, contactNodeId: number) => Promise<void>;
        removeContactFromGroup: (groupId: number, contactNodeId: number) => Promise<void>;
        getContactGroupMembers: (groupId: number) => Promise<number[]>;
      };
      mqtt: {
        connect: (settings: MQTTSettings) => Promise<void>;
        disconnect: (protocol?: 'meshtastic' | 'meshcore') => Promise<void>;
        onStatus: (
          cb: (payload: { status: MQTTStatus; protocol: 'meshtastic' | 'meshcore' }) => void,
        ) => () => void;
        onError: (
          cb: (payload: { error: string; protocol: 'meshtastic' | 'meshcore' }) => void,
        ) => () => void;
        onWarning: (
          cb: (payload: { warning: string; protocol: 'meshtastic' | 'meshcore' }) => void,
        ) => () => void;
        onNodeUpdate: (
          cb: (
            node: Partial<MeshNode> & { node_id: number; protocol?: 'meshtastic' | 'meshcore' },
          ) => void,
        ) => () => void;
        onMessage: (cb: (msg: Omit<ChatMessage, 'id'>) => void) => () => void;
        onTraceRouteReply: (
          cb: (payload: {
            meshFrom: number;
            route: number[];
            routeBack: number[];
            protocol: 'meshtastic';
          }) => void,
        ) => () => void;
        onClientId: (
          cb: (payload: { clientId: string; protocol: 'meshtastic' | 'meshcore' }) => void,
        ) => () => void;
        getClientId: (protocol?: 'meshtastic' | 'meshcore') => Promise<string>;
        getCachedNodes: () => Promise<CachedNode[]>;
        publish: (args: {
          text: string;
          from: number;
          channel: number;
          destination?: number;
          channelName?: string;
          emoji?: number;
          replyId?: number;
        }) => Promise<number>;
        publishNodeInfo: (args: {
          from: number;
          longName: string;
          shortName: string;
          channelName?: string;
          hwModel?: number;
        }) => Promise<number>;
        publishPosition: (args: {
          from: number;
          channel: number;
          channelName: string;
          latitudeI: number;
          longitudeI: number;
          altitude?: number;
        }) => Promise<number>;
        publishMeshcore: (args: {
          text: string;
          channelIdx: number;
          senderName?: string;
          senderNodeId?: number;
          timestamp?: number;
        }) => Promise<void>;
        publishMeshcorePacketLog: (args: {
          origin: string;
          snr: number;
          rssi: number;
          rawHex?: string;
          len?: number;
          packetType?: number;
          route?: string;
          payloadLen?: number;
          hash?: string;
          direction?: 'rx' | 'tx';
        }) => Promise<void>;
        onMeshcoreChat: (cb: (msg: unknown) => void) => () => void;
        refreshMeshcoreToken: (
          serverHost: string,
        ) => Promise<{ token: string; expiresAt: number } | null>;
        updateMeshcoreToken: (token: string, expiresAt: number) => Promise<void>;
        onRequestTokenRefresh: (cb: (serverHost: string) => void) => () => void;
      };
      meshcore: {
        tcp: {
          connect: (host: string, port: number) => Promise<void>;
          write: (bytes: number[]) => Promise<void>;
          disconnect: () => Promise<void>;
          onData: (cb: (bytes: Uint8Array) => void) => () => void;
          onDisconnected: (cb: () => void) => () => void;
        };
        openJsonFile: () => Promise<string | null>;
      };
      http: {
        preflight: (host: string, tls: boolean) => Promise<void>;
        connect: (host: string, tls: boolean) => Promise<void>;
        write: (bytes: number[]) => Promise<void>;
        disconnect: () => Promise<void>;
        onData: (cb: (bytes: Uint8Array) => void) => () => void;
      };
      onNobleBleAdapterState: (cb: (state: string) => void) => () => void;
      onNobleBleDeviceDiscovered: (cb: (device: NobleBleDevice) => void) => () => void;
      onNobleBleConnected: (cb: (sessionId: NobleBleSessionId) => void) => () => void;
      onNobleBleDisconnected: (cb: (sessionId: NobleBleSessionId) => void) => () => void;
      onNobleBleConnectAborted: (
        cb: (payload: { sessionId: NobleBleSessionId; message: string }) => void,
      ) => () => void;
      onNobleBleFromRadio: (
        cb: (payload: { sessionId: NobleBleSessionId; bytes: Uint8Array }) => void,
      ) => () => void;
      startNobleBleScanning: (sessionId: NobleBleSessionId) => Promise<void>;
      stopNobleBleScanning: (sessionId: NobleBleSessionId) => Promise<void>;
      connectNobleBle: (
        sessionId: NobleBleSessionId,
        peripheralId: string,
      ) => Promise<NobleBleConnectResult>;
      disconnectNobleBle: (sessionId: NobleBleSessionId) => Promise<void>;
      nobleBleToRadio: (sessionId: NobleBleSessionId, bytes: Uint8Array) => Promise<void>;
      getLinuxBleCapabilityStatus: () => Promise<LinuxBleCapabilityStatus>;
      onSerialPortsDiscovered: (cb: (ports: SerialPortInfo[]) => void) => () => void;
      selectSerialPort: (portId: string) => void;
      cancelSerialSelection: () => void;
      onBluetoothDevicesDiscovered: (cb: (devices: NobleBleDevice[]) => void) => () => void;
      selectBluetoothDevice: (deviceId: string) => void;
      cancelBluetoothSelection: () => void;
      bluetoothUnpair: (macAddress: string) => Promise<void>;
      bluetoothStartScan: () => Promise<void>;
      bluetoothStopScan: () => Promise<void>;
      bluetoothPair: (macAddress: string, pin?: string) => Promise<void>;
      bluetoothConnect: (macAddress: string) => Promise<void>;
      bluetoothUntrust: (macAddress: string) => Promise<void>;
      bluetoothGetInfo: (macAddress: string) => Promise<string>;
      onBluetoothPinRequired: (cb: (data: { deviceId: string }) => void) => () => void;
      provideBluetoothPin: (pin: string) => void;
      cancelBluetoothPairing: () => void;
      resetBlePairingRetryCount: (sessionKind?: 'meshtastic' | 'meshcore') => void;
      clearSessionData: () => Promise<void>;
      notifyDeviceConnected: () => void;
      notifyDeviceDisconnected: () => void;
      setTrayUnread: (count: number) => void;
      quitApp: () => Promise<void>;
      getPlatform: () => string;
      showEmojiPanel: () => Promise<void>;
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
        logDeviceConnection: (detail: string) => Promise<void>;
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
      safeStorage: {
        encrypt: (plaintext: string) => Promise<string | null>;
        decrypt: (ciphertext: string) => Promise<string | null>;
        isAvailable: () => Promise<boolean>;
      };
      appSettings: {
        getLoginItem: () => Promise<{ openAtLogin: boolean }>;
        setLoginItem: (openAtLogin: boolean) => Promise<void>;
        getAll: () => Promise<Record<string, string>>;
        set: (key: string, value: string) => Promise<{ changes: number }>;
      };
      tak: {
        start: (settings: TAKSettings) => Promise<void>;
        stop: () => Promise<void>;
        getStatus: () => Promise<TAKServerStatus>;
        getConnectedClients: () => Promise<TAKClientInfo[]>;
        generateDataPackage: () => Promise<void>;
        regenerateCertificates: () => Promise<void>;
        pushNodeUpdate: (node: Record<string, unknown>) => Promise<void>;
        onStatus: (cb: (status: TAKServerStatus) => void) => () => void;
        onClientConnected: (cb: (client: TAKClientInfo) => void) => () => void;
        onClientDisconnected: (cb: (clientId: string) => void) => () => void;
      };
    };
  }
}
