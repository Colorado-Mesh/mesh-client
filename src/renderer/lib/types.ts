import {
  isMeshProtocol,
  type MeshProtocol,
  REGISTERED_MESH_PROTOCOLS,
} from '@/shared/meshProtocol';
import type { MeshtasticLoraConfig } from '@/shared/meshtasticUrlEncoder';
import type { TAKClientInfo, TAKServerStatus, TAKSettings } from '@/shared/tak-types';

export type { MeshProtocol };
export { isMeshProtocol, REGISTERED_MESH_PROTOCOLS };

export type { TAKClientInfo, TAKServerStatus, TAKSettings };

export type ConnectionType = 'ble' | 'serial' | 'http';

/** All transports the ConnectionDriver can manage. Superset of `ConnectionType`. */
export type TransportType = 'ble' | 'serial' | 'http' | 'tcp' | 'mqtt';

export type TransportStatus =
  'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'stale';

/** Transport-specific connect parameters. Open union — additional protocols add their own variants. */
export type TransportParams =
  | { type: 'ble'; peripheralId?: string }
  | { type: 'serial'; portSignature?: string }
  | { type: 'http'; host: string }
  | { type: 'tcp'; host: string }
  | { type: 'mqtt'; broker: string; topic?: string; pubkey?: string };

export interface TransportRef {
  /** Opaque id assigned by ConnectionDriver for this transport instance. */
  transportId: string;
  type: TransportType;
  status: TransportStatus;
  params: TransportParams;
  /** Last raw event timestamp; watchdog reads this. */
  lastDataReceivedAt?: number;
}

export type IdentityId = string;

export type AnomalyType =
  'hop_goblin' | 'bad_route' | 'route_flapping' | 'impossible_hop' | 'noisy_node' | 'weak_link';

/** How confident the detector is: proven uses distance/stats; heuristic is SNR/hops pattern only. */
export type AnomalyConfidence = 'proven' | 'heuristic';

/** Optional i18n template for UI; English `description` / `cause` kept for search and persistence fallback. */
export interface DiagnosticTextI18n {
  key: string;
  params?: Record<string, string | number>;
}

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
  descriptionI18n?: DiagnosticTextI18n;
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
  descriptionI18n?: DiagnosticTextI18n;
}

/** RF finding as a table row (multiple per node from RFDiagnosticEngine). */
export interface RfDiagnosticRow {
  kind: 'rf';
  id: string;
  /** Node that owns this diagnostic (usually the connected home radio). */
  nodeId: number;
  condition: string;
  cause: string;
  severity: 'warning' | 'info';
  detectedAt: number;
  isLastHop?: boolean;
  causeI18n?: DiagnosticTextI18n;
  /** Foreign transmitter when this row is cross-protocol / Foreign LoRa (not `nodeId`). */
  foreignSenderId?: number;
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
    descriptionI18n: a.descriptionI18n,
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
    descriptionI18n: r.descriptionI18n,
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
  /** Reticulum LXMF destination hash (canonical address for send). */
  reticulum_destination_hash?: string;
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
  /** Meshtastic PKC public key from NodeInfo/User when available */
  public_key_hex?: string;
}

export type RemoteAdminStatus = 'idle' | 'loading' | 'ready' | 'error';

export type RemoteConfigChannelsTailStatus = 'idle' | 'loading' | 'ready' | 'partial';

export interface ConfigTargetContext {
  mode: 'local' | 'remote';
  nodeNum: number | null;
  isReady: boolean;
  isLoading: boolean;
  error?: string;
  onRefresh?: () => Promise<void>;
}

export interface MeshtasticRemoteConfigSnapshot {
  metadata?: unknown;
  /** Set when LoRa getConfig failed but the rest of the snapshot was fetched. */
  loraConfigFetchFailed?: boolean;
  /** i18n key under remoteAdmin.errors.* when LoRa fetch failed partially. */
  loraConfigFetchError?: string;
  /** Set when one or more channel getChannel requests failed during snapshot fetch. */
  channelConfigFetchFailed?: boolean;
  /** Channel indices that failed during snapshot fetch (0 = primary). */
  failedChannelIndices?: number[];
  /** True when primary channel (index 0) could not be loaded. */
  primaryChannelConfigFetchFailed?: boolean;
  loraConfig?: MeshtasticLoraConfig | null;
  deviceOwner?: { longName: string; shortName: string; isLicensed: boolean } | null;
  securityConfig?: {
    publicKey: Uint8Array;
    privateKey?: Uint8Array;
    adminKey: Uint8Array[];
    isManaged: boolean;
    serialEnabled: boolean;
    debugLogApiEnabled: boolean;
    adminChannelEnabled: boolean;
  } | null;
  channelConfigs?: {
    index: number;
    name: string;
    role: number;
    psk: Uint8Array;
    uplinkEnabled: boolean;
    downlinkEnabled: boolean;
    positionPrecision: number;
  }[];
  moduleConfigs?: Record<string, unknown>;
  /** Full Meshtastic Config protobuf slices from remote admin fetch (device, lora, display, …). */
  configSlices?: Record<string, unknown>;
  deviceFixedPosition?: boolean | null;
  telemetryDeviceUpdateInterval?: number | null;
  deviceGpsMode?: number | null;
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
  titleKey?: string;
  descriptionKey?: string;
  titleParams?: Record<string, string | number>;
  descriptionParams?: Record<string, string | number>;
}

export interface MQTTSettings {
  server: string;
  port: number;
  username: string;
  password: string;
  topicPrefix: string;
  autoLaunch: boolean;
  maxRetries?: number;
  /** When using TLS, set true to skip certificate verification (self-signed brokers). Default false = verify. */
  tlsInsecure?: boolean;
  /**
   * Enable TLS (mqtts/wss). When undefined, port 8883 implies TLS on native TCP; port 443 implies wss.
   * Set false to use plaintext on 8883 during broker testing; set true for TLS on port 1883.
   */
  tlsEnabled?: boolean;
  /**
   * Manual channel PSKs: one base64 key per line (AES-128 = 16 bytes, AES-256 = 32 bytes),
   * `ChannelName=base64`, or `ChannelName@index=base64`. Default LongFast key is always tried.
   * Radio channel keys sync when connected.
   */
  channelPsks?: string[];
  /** Broker codec: Meshtastic protobuf vs MeshCore JSON adapter (main process). */
  mqttTransportProtocol?: MeshProtocol;
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
  /**
   * Stable MQTT broker clientId (set by main process before connect).
   * Not user-editable in the UI.
   */
  clientId?: string;
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
  /** Reticulum LXMF destination hash when `sender_id` is a synthetic node id mapping. */
  reticulum_sender_hash?: string;
  /** Stable LXMF message hash for ratspeak.chat.v2 threaded replies. */
  reticulum_message_hash?: string;
  /** Reticulum reply target message hash (hex). */
  reticulum_reply_to_hash?: string;
  /** Local path when a Reticulum attachment was saved to disk. */
  reticulumAttachmentPath?: string;
  sender_name: string;
  payload: string;
  channel: number;
  timestamp: number;
  // Delivery status tracking
  packetId?: number;
  status?: 'sending' | 'acked' | 'failed' | 'queued' | 'blocked'; // device (RF) transport; queued/blocked for outbox
  mqttStatus?: 'sending' | 'acked' | 'failed'; // MQTT transport (hybrid/MQTT-only)
  error?: string;
  // Emoji reactions / tapback
  emoji?: number;
  replyId?: number;
  // Direct message destination (undefined = broadcast)
  to?: number;
  // Which transport(s) delivered this incoming message
  receivedVia?: 'rf' | 'mqtt' | 'both' | 'tcp' | 'network';
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
  /** RF-derived hops away for this receive when known (Meshtastic hopStart−hopLimit; MeshCore path hops). */
  rxHops?: number;
  /** Message was replayed from a Store & Forward server (Meshtastic only). */
  viaStoreForward?: boolean;
  /** MeshCore room server BBS post (not a DM). */
  roomServerId?: number;
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
  /** True when the last drop was unexpected (not manual disconnect). */
  connectionLoss?: boolean;
  /** Serial auto-reconnect exhausted; user must re-select the USB serial port. */
  serialNeedsReselect?: boolean;
  myNodeNum: number;
  connectionType: ConnectionType | null;
  reconnectAttempt?: number;
  lastDataReceived?: number;
  firmwareVersion?: string;
  /** Meshtastic: native Wi-Fi reported in DeviceMetadata. */
  deviceHasWifi?: boolean;
  /** Meshtastic: native Ethernet reported in DeviceMetadata. */
  deviceHasEthernet?: boolean;
  /** MeshCore: manufacturer/model string from local `deviceQuery` (connected radio only). */
  manufacturerModel?: string;
  /** MeshCore: companion path hash mode from deviceQuery or last apply (0/1/2). */
  pathHashMode?: 0 | 1 | 2 | null;
  /** 0–100 from device metrics; omit until first reading */
  batteryPercent?: number;
  batteryCharging?: boolean;
}

export interface NobleBleDevice {
  deviceId: string;
  deviceName: string;
}
export type NobleBleSessionId = MeshProtocol;
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
