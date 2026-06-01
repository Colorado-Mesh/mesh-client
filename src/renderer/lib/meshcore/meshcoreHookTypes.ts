import type { MeshCoreSelfInfoEnriched, MeshCoreSelfInfoWire } from '../meshcoreTelemetryPrivacy';

/** Self info from the radio (normalized after `enrichMeshCoreSelfInfo`). */
export type MeshCoreSelfInfo = MeshCoreSelfInfoEnriched;

export interface MeshCoreRepeaterStatus {
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

export interface CayenneLppEntry {
  channel: number;
  type: number;
  value: number | { latitude: number; longitude: number; altitude: number };
}

export interface MeshCoreNodeTelemetry {
  fetchedAt: number;
  entries: CayenneLppEntry[];
  temperature?: number;
  relativeHumidity?: number;
  barometricPressure?: number;
  voltage?: number;
  gps?: { latitude: number; longitude: number; altitude: number };
}

export interface MeshCoreNeighborEntry {
  publicKeyPrefix: Uint8Array;
  prefixHex: string;
  resolvedNodeId: number;
  heardSecondsAgo: number;
  snr: number;
}

export interface MeshCoreNeighborResult {
  totalNeighboursCount: number;
  neighbours: MeshCoreNeighborEntry[];
  fetchedAt: number;
}

export type { CliHistoryEntry } from '../repeaterCommandService';

export interface MeshCoreConnection {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
  once(event: string | number, cb: (...args: unknown[]) => void): void;
  emit(event: string | number, ...args: unknown[]): void;
  close(): Promise<void>;
  getSelfInfo(timeout?: number): Promise<MeshCoreSelfInfoWire>;
  getContacts(): Promise<MeshCoreContactRaw[]>;
  addOrUpdateContact(
    publicKey: Uint8Array,
    type: number,
    flags: number,
    outPathLen: number,
    outPath: Uint8Array,
    advName: string,
    lastAdvert: number,
    advLat: number,
    advLon: number,
  ): Promise<void>;
  setContactPath(contact: MeshCoreContactRaw, path: number[]): Promise<void>;
  resetPath(pubKey: Uint8Array): Promise<void>;
  getChannels(): Promise<MeshCoreChannelRaw[]>;
  getChannel(channelIdx: number): Promise<MeshCoreChannelRaw>;
  setChannel(channelIdx: number, name: string, secret: Uint8Array): Promise<void>;
  deleteChannel(channelIdx: number): Promise<void>;
  getWaitingMessages(): Promise<unknown[]>;
  sendFloodAdvert(): Promise<void>;
  sendTextMessage(
    pubKey: Uint8Array,
    text: string,
    type?: number,
  ): Promise<{ expectedAckCrc?: number; estTimeout?: number }>;
  sendChannelTextMessage(channelIdx: number, text: string): Promise<void>;
  removeContact(pubKey: Uint8Array): Promise<void>;
  setAdvertName(name: string): Promise<void>;
  setRadioParams(freq: number, bw: number, sf: number, cr: number): Promise<void>;
  setTxPower(txPower: number): Promise<void>;
  setAdvertLatLong(lat: number, lon: number): Promise<void>;
  reboot(): Promise<void>;
  getBatteryVoltage(): Promise<{ batteryMilliVolts: number }>;
  syncDeviceTime(): Promise<void>;
  getDeviceTime(): Promise<{ time: number }>;
  setDeviceTime(epochSecs: number): Promise<void>;
  deviceQuery(appTargetVer: number): Promise<{
    firmwareVer: number;
    firmware_build_date: string;
    manufacturerModel: string;
  }>;
  tracePath(
    pubKey: Uint8Array,
    extraTimeoutMillis?: number,
  ): Promise<{
    pathLen: number;
    pathHashes: number[];
    pathSnrs: number[];
    lastSnr: number;
    tag: number;
  }>;
  sendCommandSendTracePath(tag: number, auth: number, path: Uint8Array): Promise<void>;
  login(
    contactPublicKey: Uint8Array,
    password: string,
    extraTimeoutMillis?: number,
  ): Promise<unknown>;
  getStatus(
    pubKey: Uint8Array,
    extraTimeoutMillis?: number,
  ): Promise<{
    batt_milli_volts: number;
    curr_tx_queue_len: number;
    noise_floor: number;
    last_rssi: number;
    n_packets_recv: number;
    n_packets_sent: number;
    total_air_time_secs: number;
    total_up_time_secs: number;
    n_sent_flood: number;
    n_sent_direct: number;
    n_recv_flood: number;
    n_recv_direct: number;
    err_events: number;
    last_snr: number;
    n_direct_dups: number;
    n_flood_dups: number;
  }>;
  getTelemetry(
    contactPublicKey: Uint8Array,
    extraTimeoutMillis?: number,
  ): Promise<{ reserved: number; pubKeyPrefix: Uint8Array; lppSensorData: Uint8Array }>;
  /** @liamcottle/meshcore.js does not pass extra timeout to sendBinaryRequest for neighbour list. */
  getNeighbours(
    publicKey: Uint8Array,
    count?: number,
    offset?: number,
    orderBy?: number,
    pubKeyPrefixLength?: number,
  ): Promise<{
    totalNeighboursCount: number;
    neighbours: { publicKeyPrefix: Uint8Array; heardSecondsAgo: number; snr: number }[];
  }>;
  sendBinaryRequest(
    contactPublicKey: Uint8Array,
    requestCodeAndParams: Uint8Array,
    extraTimeoutMillis?: number,
  ): Promise<Uint8Array>;
  setOtherParams(manualAddContacts: boolean): Promise<void>;
  setAutoAddContacts(): Promise<void>;
  setManualAddContacts(): Promise<void>;
  sendToRadioFrame(data: Uint8Array): Promise<void>;
  // Contact import/export
  importContact(advertBytes: Uint8Array): Promise<void>;
  exportContact(pubKey?: Uint8Array | null): Promise<Uint8Array>;
  shareContact(pubKey: Uint8Array): Promise<void>;
  // Statistics
  getStats(statsType: number): Promise<MeshCoreStatsResponse<Record<string, unknown>>>;
  getStatsCore(): Promise<MeshCoreStatsResponse<MeshCoreCoreStatsData>>;
  getStatsRadio(): Promise<MeshCoreStatsResponse<MeshCoreRadioStatsData>>;
  getStatsPackets(): Promise<MeshCoreStatsResponse<MeshCorePacketStatsData>>;
  // Channel data
  sendChannelData(
    channelIdx: number,
    pathLen: number,
    path: Uint8Array,
    dataType: number,
    payload: Uint8Array,
  ): Promise<void>;
  // Cryptographic operations
  sign(data: Uint8Array): Promise<Uint8Array>;
  /** Resolves to `{ privateKey: Uint8Array }` from meshcore.js (64-byte ORLP secret). */
  exportPrivateKey(): Promise<unknown>;
  importPrivateKey(privateKey: Uint8Array): Promise<void>;
  // Waiting messages
  syncNextMessage(): Promise<unknown>;
}

export interface MeshCoreContactRaw {
  publicKey: Uint8Array;
  type: number;
  advName: string;
  lastAdvert: number;
  advLat: number;
  advLon: number;
  flags: number;
  outPathLen?: number;
  outPath?: Uint8Array;
}

export interface MeshCoreChannelRaw {
  channelIdx: number;
  name: string;
  secret: Uint8Array;
}

export interface MeshcoreContactDbRow {
  node_id: number;
  public_key: string;
  adv_name: string | null;
  contact_type: number;
  last_advert: number | null;
  adv_lat: number | null;
  adv_lon: number | null;
  last_snr: number | null;
  last_rssi: number | null;
  favorited: number;
  nickname: string | null;
  contact_flags: number | null;
  hops_away: number | null;
  on_radio: number;
  last_synced_from_radio: string | null;
}

export interface DeviceLogEntry {
  ts: number;
  level: string;
  source: string;
  message: string;
}

export interface MeshCoreCoreStatsData {
  batteryMilliVolts: number;
  uptimeSecs: number;
  queueLen: number;
}

export interface MeshCoreRadioStatsData {
  noiseFloor: number;
  lastRssi: number;
  lastSnr: number;
  txAirSecs: number;
  rxAirSecs: number;
}

export interface MeshCorePacketStatsData {
  recv: number;
  sent: number;
  nSentFlood: number;
  nSentDirect: number;
  nRecvFlood: number;
  nRecvDirect: number;
  nRecvErrors?: number | null;
}

export interface MeshCoreStatsResponse<TData> {
  type: number;
  raw: Uint8Array;
  data: TData;
}

export interface RxPacketEntry {
  ts: number;
  snr: number;
  rssi: number;
  raw: Uint8Array;
  routeTypeString: string | null;
  payloadTypeString: string | null;
  hopCount: number;
  /** Resolved when Meshtastic frame or MeshCore payload prefix matches a known contact */
  fromNodeId: number | null;
  /** CRC-32 fingerprint (8 hex chars), same as optional DB `rx_packet_fingerprint` on messages */
  messageFingerprintHex: string | null;
  transportScopeCode: number | null;
  transportReturnCode: number | null;
  advertName: string | null;
  advertLat: number | null;
  advertLon: number | null;
  advertTimestampSec: number | null;
  parseOk: boolean;
}

export interface MeshcoreMessageDbRow {
  id: number;
  sender_id: number | null;
  sender_name: string | null;
  payload: string;
  channel_idx: number;
  timestamp: number;
  status: string;
  packet_id: number | null;
  emoji: number | null;
  reply_id: number | null;
  to_node: number | null;
  received_via?: string | null;
  rx_packet_fingerprint?: string | null;
  reply_preview_text?: string | null;
  reply_preview_sender?: string | null;
  rx_hops?: number | null;
}

export interface MeshcoreTraceResultEntry {
  pathLen: number;
  pathHashes: number[];
  pathSnrs: number[];
  lastSnr: number;
  tag: number;
}
