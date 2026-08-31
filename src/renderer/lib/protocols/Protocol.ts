import type { ProtocolCapabilities } from '../radio/BaseRadioProvider';
import type { TransportParams } from '../types';

// --- Inbound decoded events ---

export interface TextMessageEvent {
  id: string;
  from: number;
  to: number;
  payload: string;
  channelIndex: number;
  timestamp: number;
  rxSnr?: number;
  rxRssi?: number;
  hopCount?: number;
  tapback?: boolean;
  replyTo?: string;
  /** meshcore.js TxtTypes (e.g. SignedPlain room posts). */
  txtType?: number;
  /** MeshCore room server infrastructure node id for BBS posts. */
  roomServerId?: number;
}

export interface NodeInfoEvent {
  nodeId: number;
  longName?: string;
  shortName?: string;
  macAddr?: string;
  hwModel?: string;
  isLicensed?: boolean;
  role?: number;
  lastHeardAt?: number;
  publicKey?: Uint8Array;
  /** True when decoded from UserPacket (live identity), not NodeDB NodeInfo. */
  fromUserPacket?: boolean;
  snr?: number;
  rssi?: number;
  hopsAway?: number;
  viaMqtt?: boolean;
  /** `NodeInfo.is_key_manually_verified`: the operator confirmed this node's PKC key. */
  keyManuallyVerified?: boolean;
  /**
   * `NodeInfo.has_xeddsa_signed`: the radio has seen an XEdDSA-signed packet from this
   * node, so its public key is cryptographically attested rather than merely observed.
   */
  hasXeddsaSigned?: boolean;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  batteryLevel?: number;
  voltage?: number;
  channelUtilization?: number;
  airUtilTx?: number;
}

/** MeshCore path-updated push (event 129). */
export interface MeshcorePathUpdatedEvent {
  nodeId: number;
  publicKey: Uint8Array;
}

/** MeshCore hop-ACK push (event 130): 0x80 = ACK, 0x81 = NACK. */
export interface MeshcoreDmAckEvent {
  ackCode: number;
  roundTrip?: number;
}

/** MeshCore message-waiting push (event 131) — signal only; the drain is an RPC. */
export type MeshcoreWaitingMessagesEvent = Record<string, never>;

/** MeshCore CLI data response (direct message with `txtType === 1`). */
export interface MeshcoreCliResponseEvent {
  text: string;
  senderNodeId: number;
  pubKeyPrefixHex: string;
}

/** MeshCore radio RF RX push (event 136). */
export interface MeshcoreRfRxEvent {
  lastSnr: number;
  lastRssi: number;
  raw: Uint8Array | null;
}

// --- Contact / self-info events (populated by protocol implementations) ---

export interface DeviceSelfInfoEvent {
  name: string;
  publicKey: Uint8Array;
  type: number;
  txPower: number;
  maxTxPower?: number;
  radioFreq: number;
  radioBw?: number;
  radioSf?: number;
  radioCr?: number;
  batteryMilliVolts?: number;
  manualAddContacts: boolean;
  telemetryModeBase?: number;
  telemetryModeLoc?: number;
  telemetryModeEnv?: number;
}

export interface ContactRecord {
  publicKey: Uint8Array;
  type: number;
  name: string;
  lastAdvert: number;
  advLat: number;
  advLon: number;
  flags: number;
  outPathLen?: number;
  outPath?: Uint8Array;
}

export interface AutoaddConfigEvent {
  autoaddConfig: number;
  autoaddMaxHops: number;
}

// --- Per-node query result types ---

export interface StatusResult {
  battMilliVolts: number;
  noiseFloor: number;
  lastRssi: number;
  lastSnr: number;
  nPacketsRecv: number;
  nPacketsSent: number;
  totalAirTimeSecs: number;
  totalUpTimeSecs: number;
  nSentFlood: number;
  nSentDirect: number;
  nRecvFlood: number;
  nRecvDirect: number;
  errEvents: number;
  nDirectDups: number;
  nFloodDups: number;
  currTxQueueLen: number;
}

export interface TelemetryEntry {
  channel: number;
  type: number;
  value: number | { latitude: number; longitude: number; altitude: number };
}

export interface TelemetryResult {
  fetchedAt: number;
  entries: TelemetryEntry[];
  temperature?: number;
  relativeHumidity?: number;
  barometricPressure?: number;
  voltage?: number;
  gps?: { latitude: number; longitude: number; altitude: number };
}

export interface NeighborEntry {
  publicKeyPrefix: Uint8Array;
  prefixHex: string;
  resolvedNodeId: number;
  heardSecondsAgo: number;
  snr: number;
}

export interface NeighborResult {
  totalNeighboursCount: number;
  neighbours: NeighborEntry[];
  fetchedAt: number;
}

export interface PingResult {
  pathLen: number;
  pathHashes: number[];
  /** Present on MeshCore TraceData results; defaults to 1-byte when omitted. */
  hashSizeBytes?: 1 | 2 | 3;
  pathSnrs: number[];
  lastSnr: number;
  tag: number;
}

export interface CliEntry {
  type: 'sent' | 'received';
  text: string;
  timestamp: number;
}

export interface MeshcoreChannelEvent {
  index: number;
  name: string;
  key: Uint8Array;
}

export interface PositionEvent {
  nodeId: number;
  latitude: number;
  longitude: number;
  altitude?: number;
  timestamp: number;
  groundSpeed?: number;
  groundTrack?: number;
}

export interface TelemetryEvent {
  nodeId: number;
  timestamp: number;
  /**
   * Meshtastic `Telemetry.variant` case: deviceMetrics / environmentMetrics /
   * airQualityMetrics / localStats.
   */
  variantCase?: string;
  batteryLevel?: number;
  voltage?: number;
  channelUtilization?: number;
  airUtilTx?: number;
  uptimeSeconds?: number;
  temperature?: number;
  relativeHumidity?: number;
  barometricPressure?: number;
  iaq?: number;
  gasResistance?: number;
  lux?: number;
  windSpeed?: number;
  windDirection?: number;
  windGust?: number;
  windLull?: number;
  weight?: number;
  rainfall1h?: number;
  rainfall24h?: number;
  /** AS3935 lightning sensor: strikes over a rolling ~1h window. */
  lightningStrikeCount1h?: number;
  /** AS3935 estimated distance to the last strike, km. */
  lightningDistanceKm?: number;
  /**
   * Per-channel ADC readings, indexed by channel (0-7). Sparse: a channel the
   * sensor did not report stays `undefined`.
   */
  adcVoltages?: (number | undefined)[];
  /** Per-channel one-wire temperatures (°C), indexed by channel (0-7). */
  oneWireTemperatures?: (number | undefined)[];
  /** Air-quality variant (SEN5X / SEN6X / SCD4X): particulates, CO2 and indices. */
  pm10Standard?: number;
  pm25Standard?: number;
  pm40Standard?: number;
  pm100Standard?: number;
  co2?: number;
  pmTemperature?: number;
  pmHumidity?: number;
  pmVocIdx?: number;
  pmNoxIdx?: number;
  numPacketsRxBad?: number;
  numRxDupe?: number;
  numPacketsRx?: number;
  numPacketsTx?: number;
}

export interface TraceRouteEvent {
  from: number;
  to: number;
  route: number[];
  routeBack?: number[];
  timestamp: number;
  /** `meshtastic.Data.dest` on the decoded wrapper (traceroute correlation). */
  dataLayerDest?: number;
  /** `meshtastic.Data.source` on the decoded wrapper. */
  dataLayerSource?: number;
  replyId?: number;
  requestId?: number;
}

export interface WaypointEvent {
  id: number;
  name: string;
  description?: string;
  latitude: number;
  longitude: number;
  /** Raw protobuf integers for MQTT gateway uplink. */
  latitudeI?: number;
  longitudeI?: number;
  icon?: number;
  lockedTo?: number;
  expire?: number;
  from: number;
  to?: number;
  channelIndex?: number;
  timestamp: number;
}

export interface ChannelEvent {
  index: number;
  role: number;
  name: string;
  psk: Uint8Array;
  uplinkEnabled: boolean;
  downlinkEnabled: boolean;
  positionPrecision: number;
}

export interface DeviceGpsStateEvent {
  gpsMode: number;
  fixedPosition: boolean | null;
}

export interface SecurityConfigEvent {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  adminKey: Uint8Array[];
  isManaged: boolean;
  serialEnabled: boolean;
  debugLogApiEnabled: boolean;
  adminChannelEnabled: boolean;
}

export interface ModuleConfigEvent {
  configType: string;
  value: unknown;
}

export interface QueueStatusEvent {
  free: number;
  maxlen: number;
}

export interface DeviceLogEvent {
  message: string;
  time: number;
  source: string;
  level: number;
}

export interface DeviceStatusEvent {
  status: string;
}

export interface DeviceMetadataEvent {
  firmwareVersion?: string;
  /** Native Wi-Fi capability reported by the radio (DeviceMetadata.hasWifi). */
  hasWifi?: boolean;
  /** Native Ethernet capability reported by the radio (DeviceMetadata.hasEthernet). */
  hasEthernet?: boolean;
}

export interface NeighborInfoEvent {
  nodeId: number;
  neighbors: { nodeId: number; snr: number; lastRxTime: number }[];
  timestamp: number;
}

export interface TelemetryIntervalEvent {
  interval: number;
}

export interface MeshtasticConfigSliceEvent {
  configCase: string;
  value: unknown;
}

/** Typed Meshtastic module-port payloads (audio, pax, serial, …) for hook Maps. */
export interface MeshtasticModulePortEvent {
  portLabel: string;
  from: number;
  data: unknown;
  channel?: number;
  timestamp: number;
}

/** Store & Forward module packet (heartbeat / history / text replay). */
export interface MeshtasticStoreForwardEvent {
  from: number;
  channel: number;
  raw: unknown;
  timestamp: number;
}

export type DomainEvent =
  | { type: 'text_message'; payload: TextMessageEvent }
  | { type: 'node_info'; payload: NodeInfoEvent }
  | { type: 'position'; payload: PositionEvent }
  | { type: 'telemetry'; payload: TelemetryEvent }
  | { type: 'trace_route'; payload: TraceRouteEvent }
  | { type: 'waypoint'; payload: WaypointEvent }
  | { type: 'channel'; payload: ChannelEvent }
  | { type: 'device_gps_state'; payload: DeviceGpsStateEvent }
  | { type: 'security_config'; payload: SecurityConfigEvent }
  | { type: 'module_config'; payload: ModuleConfigEvent }
  | { type: 'telemetry_interval'; payload: TelemetryIntervalEvent }
  | { type: 'meshtastic_config_slice'; payload: MeshtasticConfigSliceEvent }
  | { type: 'meshtastic_module_port'; payload: MeshtasticModulePortEvent }
  | { type: 'meshtastic_store_forward'; payload: MeshtasticStoreForwardEvent }
  | { type: 'queue_status'; payload: QueueStatusEvent }
  | { type: 'device_log'; payload: DeviceLogEvent }
  | { type: 'raw_packet'; payload: RawPacketEntry }
  | { type: 'device_status'; payload: DeviceStatusEvent }
  | { type: 'device_metadata'; payload: DeviceMetadataEvent }
  | { type: 'neighbor_info'; payload: NeighborInfoEvent }
  | { type: 'device_self_info'; payload: DeviceSelfInfoEvent }
  | { type: 'device_contacts'; payload: { contacts: ContactRecord[] } }
  | { type: 'device_autoadd'; payload: AutoaddConfigEvent }
  | { type: 'meshcore_channel'; payload: MeshcoreChannelEvent }
  | { type: 'meshcore_path_updated'; payload: MeshcorePathUpdatedEvent }
  | { type: 'meshcore_dm_ack'; payload: MeshcoreDmAckEvent }
  | { type: 'meshcore_waiting_messages'; payload: MeshcoreWaitingMessagesEvent }
  | { type: 'meshcore_cli_response'; payload: MeshcoreCliResponseEvent }
  | { type: 'meshcore_rf_rx'; payload: MeshcoreRfRxEvent };

export type DomainEventType = DomainEvent['type'];

/**
 * Typed registry of `DomainEvent.type` → payload, so PacketRouter consumers can
 * subscribe to one event kind without re-deriving the discriminated union at
 * every call site (see `attachTypedPacketListener`).
 */
export type DomainEventPayloadMap = {
  [E in DomainEvent as E['type']]: E['payload'];
};

// --- Raw packet log ---

export interface RawPacketEntry {
  ts: number;
  snr: number;
  rssi: number;
  raw: Uint8Array;
  fromNodeId: number | null;
  portLabel: string;
  viaMqtt: boolean;
  isLocal?: boolean;
  hopsAway?: number;
  packetId?: number;
  hopLimit?: number;
  hopStart?: number;
  portnum?: number;
}

// --- Outbound send options ---

export interface SendMessageOptions {
  text: string;
  destination?: number;
  /** Required by MeshCore for DM (the SDK addresses by 32-byte pubkey, not nodeId). */
  destinationPubKey?: Uint8Array;
  channelIndex?: number;
  emoji?: boolean;
  replyTo?: string;
}

export interface SendPositionOptions {
  latitude: number;
  longitude: number;
  altitude?: number;
}

export interface SendWaypointOptions {
  id: number;
  name: string;
  description?: string;
  latitude: number;
  longitude: number;
  lockedTo?: number;
  expire?: number;
}

// --- Management options ---

export interface SetOwnerOptions {
  longName: string;
  shortName: string;
  isLicensed: boolean;
}

export interface SetChannelOptions {
  index: number;
  role: number;
  settings: {
    name: string;
    psk: Uint8Array;
    uplinkEnabled: boolean;
    downlinkEnabled: boolean;
    positionPrecision: number;
  };
}

// --- Errors ---

/**
 * Thrown by Protocol methods that have no meaningful implementation for the
 * concrete protocol. UI must gate calls via `ProtocolCapabilities` so this is
 * only ever raised on a programming error.
 */
export class UnsupportedOperation extends Error {
  constructor(public readonly operation: string) {
    super(`Operation not supported by this protocol: ${operation}`);
    this.name = 'UnsupportedOperation';
  }
}

/** Information discovered from an SDK after `createDevice`, used to resolve identity signatures. */
export interface DiscoveryInfo {
  myNodeNum?: number;
  publicKey?: Uint8Array;
}

// --- Send-success result ---

export interface SendResult {
  /** SDK-assigned packet id, when available. PacketRouter dedupes on echo by this id. */
  packetId?: number;
  /** MeshCore DM: firmware `estTimeout` hint (ms) for hop ACK (event 130). */
  estTimeoutMs?: number;
}

// --- Protocol interface ---

/**
 * Protocol classes translate between the app's domain API and a specific SDK.
 * Implementations are shared singletons that hold no per-identity state; the
 * SDK handle is passed in to every method that needs it. ConnectionDriver owns
 * connection lifecycle (watchdog, reconnect, attempt counters) and the handle
 * registry.
 *
 * `handle` is typed as `unknown` so consumers see a uniform shape. Each
 * implementation casts to its concrete SDK type at the top of every method.
 */
export interface Protocol {
  readonly type: string;
  readonly capabilities: ProtocolCapabilities;

  // --- SDK bootstrap (ConnectionDriver calls these) ---
  createDevice(params: TransportParams): Promise<unknown>;
  destroyDevice(handle: unknown): Promise<void>;
  subscribe(handle: unknown, emit: (event: DomainEvent) => void): () => void;
  /**
   * Optional RPC discovery hook. Protocols that need an active call to learn
   * the device pubkey / nodeNum (MeshCore) implement this; protocols that
   * receive it passively via subscribed events (Meshtastic) may omit it.
   */
  discoverSelf?(handle: unknown, timeoutMs?: number): Promise<DiscoveryInfo>;
  /**
   * Compute the stable identity signature for this connection. Before SDK
   * discovery completes, returns a provisional transport-shaped key; once
   * `info` is provided post-discovery, returns the device-intrinsic key.
   */
  identitySignature(params: TransportParams, info?: DiscoveryInfo): string;

  // --- Outbound ---
  sendMessage(handle: unknown, opts: SendMessageOptions): Promise<SendResult>;
  sendPosition(handle: unknown, opts: SendPositionOptions): Promise<void>;
  sendTraceRoute(handle: unknown, nodeId: number): Promise<void>;
  sendWaypoint(handle: unknown, opts: SendWaypointOptions): Promise<void>;
  deleteWaypoint(handle: unknown, id: number): Promise<void>;

  // --- Device lifecycle ---
  reboot(handle: unknown, delay?: number): Promise<void>;
  shutdown(handle: unknown, delay?: number): Promise<void>;
  factoryReset(handle: unknown): Promise<void>;
  resetNodeDb(handle: unknown): Promise<void>;
  rebootOta(handle: unknown, delay?: number): Promise<void>;
  enterDfuMode(handle: unknown): Promise<void>;
  factoryResetConfig(handle: unknown): Promise<void>;
  requestRefresh(handle: unknown): Promise<void>;

  // --- Config ---
  setConfig(handle: unknown, config: unknown): Promise<void>;
  commitConfig(handle: unknown): Promise<void>;
  setChannel(handle: unknown, opts: SetChannelOptions): Promise<void>;
  clearChannel(handle: unknown, index: number): Promise<void>;
  setOwner(handle: unknown, opts: SetOwnerOptions): Promise<void>;
  setModuleConfig(handle: unknown, config: unknown): Promise<void>;
  setCannedMessages(handle: unknown, messages: string[]): Promise<void>;
  setRingtone(handle: unknown, ringtone: string): Promise<void>;

  // --- GPS / position ---
  sendPositionToDevice(handle: unknown, lat: number, lon: number, alt?: number): Promise<void>;
  requestPosition(handle: unknown, nodeId: number): Promise<void>;

  // --- Node management ---
  deleteNode(handle: unknown, nodeId: number): Promise<void>;
}
