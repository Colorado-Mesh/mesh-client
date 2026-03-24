import { CayenneLpp, SerialConnection, WebSerialConnection } from '@liamcottle/meshcore.js';
import { useCallback, useEffect, useRef, useState } from 'react';

import { sanitizeLogMessage } from '@/main/sanitize-log-message';

import { withTimeout } from '../../shared/withTimeout';
import { classifyPayload, extractMeshtasticSenderId } from '../lib/foreignLoraDetection';
import type { OurPosition } from '../lib/gpsSource';
import { resolveOurPosition } from '../lib/gpsSource';
import { isLetsMeshSettings } from '../lib/letsMeshJwt';
import { readMeshcoreMqttSettingsFromStorage } from '../lib/meshcoreMqttSettingsStorage';
import {
  CONTACT_TYPE_LABELS,
  isMeshcoreTransportStatusChatLine,
  mergeMeshcoreChatStubNodes,
  meshcoreChatStubNodeIdFromDisplayName,
  meshcoreContactToMeshNode,
  meshcoreIsChatStubNodeId,
  meshcoreIsSyntheticPlaceholderPubKeyHex,
  meshcoreSyntheticPlaceholderPubKeyHex,
  minimalMeshcoreChatNode,
  pubkeyToNodeId,
} from '../lib/meshcoreUtils';
import { persistSerialPortIdentity, selectGrantedSerialPort } from '../lib/serialPortSignature';
import type {
  ChatMessage,
  DeviceState,
  EnvironmentTelemetryPoint,
  MeshNode,
  MQTTStatus,
  NobleBleSessionId,
  TelemetryPoint,
} from '../lib/types';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { usePositionHistoryStore } from '../stores/positionHistoryStore';
import { useRepeaterSignalStore } from '../stores/repeaterSignalStore';

function contactToDbRow(
  contact: MeshCoreContactRaw,
  nickname?: string | null,
): Parameters<typeof window.electronAPI.db.saveMeshcoreContact>[0] {
  return {
    node_id: pubkeyToNodeId(contact.publicKey),
    public_key: Array.from(contact.publicKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    adv_name: contact.advName ?? null,
    contact_type: contact.type,
    last_advert: contact.lastAdvert ?? null,
    adv_lat: contact.advLat !== 0 ? contact.advLat / MESHCORE_COORD_SCALE : null,
    adv_lon: contact.advLon !== 0 ? contact.advLon / MESHCORE_COORD_SCALE : null,
    nickname: nickname ?? null,
  };
}

function meshcoreReceivedViaFromDb(raw: unknown): NonNullable<ChatMessage['receivedVia']> {
  if (raw === 'mqtt' || raw === 'both') return raw;
  return 'rf';
}

function messageToDbRow(
  msg: ChatMessage,
): Parameters<typeof window.electronAPI.db.saveMeshcoreMessage>[0] {
  const received_via =
    msg.receivedVia === 'rf' || msg.receivedVia === 'mqtt' || msg.receivedVia === 'both'
      ? msg.receivedVia
      : null;
  return {
    sender_id: msg.sender_id !== 0 ? msg.sender_id : null,
    sender_name: msg.sender_name ?? null,
    payload: msg.payload,
    channel_idx: msg.channel,
    timestamp: msg.timestamp,
    status: msg.status ?? 'acked',
    packet_id: msg.packetId ?? null,
    emoji: msg.emoji ?? null,
    reply_id: msg.replyId ?? null,
    to_node: msg.to ?? null,
    received_via,
  };
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface SerialConnectionInstance extends InstanceType<typeof SerialConnection> {}

const NOBLE_IPC_CONNECT_TIMEOUT_MS = 25_000;
const NOBLE_IPC_HANDSHAKE_TIMEOUT_MS = 20_000;
const NOBLE_IPC_CONNECT_MAX_ATTEMPTS = 2;

type MeshcoreBleTimeoutStage = 'ipc-open' | 'protocol-handshake' | 'unknown';

function classifyMeshcoreBleTimeoutStage(message: string): MeshcoreBleTimeoutStage {
  if (/MeshCore BLE IPC open timed out/i.test(message)) return 'ipc-open';
  if (/MeshCore BLE protocol handshake timed out/i.test(message)) return 'protocol-handshake';
  return 'unknown';
}

function serializeErrorLike(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    // catch-no-log-ok stringify fallback for arbitrary error payloads
    return String(value);
  }
}

/** TCP connection implemented over IPC bridge (main-process net.Socket). */
class IpcTcpConnection {
  private host: string;
  private port: number;
  private inner: SerialConnectionInstance | null = null;
  private cleanupFns: (() => void)[] = [];

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }

  async connect() {
    try {
      // Create a subclass that wires write → IPC
      class TcpOverIpc extends (SerialConnection as unknown as new () => SerialConnectionInstance) {
        async write(bytes: Uint8Array) {
          try {
            await window.electronAPI.meshcore.tcp.write(Array.from(bytes));
          } catch (e) {
            console.error('[IpcTcpConnection] write error', e);
            throw e;
          }
        }
        async close() {
          await window.electronAPI.meshcore.tcp.disconnect();
        }
      }

      const instance = new TcpOverIpc() as unknown as SerialConnectionInstance;
      this.inner = instance;

      const offData = window.electronAPI.meshcore.tcp.onData((bytes) => {
        void instance.onDataReceived(bytes);
      });
      const offDisc = window.electronAPI.meshcore.tcp.onDisconnected(() => {
        instance.onDisconnected();
      });
      this.cleanupFns = [offData, offDisc];

      await window.electronAPI.meshcore.tcp.connect(this.host, this.port);
      await instance.onConnected();
    } catch (e) {
      console.error('[IpcTcpConnection] connect/onConnected error', e);
      throw e;
    }
  }

  get connection() {
    return this.inner;
  }

  cleanup() {
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
  }
}

/** BLE connection implemented over session-scoped Noble IPC. */
class IpcNobleConnection {
  private readonly peripheralId: string;
  private readonly sessionId: NobleBleSessionId;
  private inner: SerialConnectionInstance | null = null;
  private cleanupFns: (() => void)[] = [];

  constructor(peripheralId: string, sessionId: NobleBleSessionId = 'meshcore') {
    this.peripheralId = peripheralId;
    this.sessionId = sessionId;
  }

  async connect() {
    const sessionId = this.sessionId;
    class NobleOverIpc extends (SerialConnection as unknown as new () => SerialConnectionInstance) {
      constructor(private readonly session: NobleBleSessionId) {
        super();
      }

      async write(bytes: Uint8Array) {
        console.debug(`[IpcNobleConnection:${this.session}] write ${bytes.length} bytes`);
        await window.electronAPI.nobleBleToRadio(this.session, bytes);
      }

      async close() {
        await window.electronAPI.disconnectNobleBle(this.session);
      }
    }

    const instance = new NobleOverIpc(sessionId) as unknown as SerialConnectionInstance;
    this.inner = instance;
    const offData = window.electronAPI.onNobleBleFromRadio(({ sessionId: sid, bytes }) => {
      if (sid !== sessionId) return;
      console.debug(`[IpcNobleConnection:${sessionId}] fromRadio ${bytes.length} bytes`);
      void instance.onDataReceived(bytes);
    });
    const offDisc = window.electronAPI.onNobleBleDisconnected((sid) => {
      if (sid !== sessionId) return;
      console.warn(`[IpcNobleConnection:${sessionId}] peripheral disconnected`);
      instance.onDisconnected();
    });
    this.cleanupFns = [offData, offDisc];
    try {
      await withTimeout(
        window.electronAPI.connectNobleBle(sessionId, this.peripheralId),
        NOBLE_IPC_CONNECT_TIMEOUT_MS,
        'MeshCore BLE IPC open',
      );
      await withTimeout(
        instance.onConnected(),
        NOBLE_IPC_HANDSHAKE_TIMEOUT_MS,
        'MeshCore BLE protocol handshake',
      );
    } catch (err) {
      try {
        await window.electronAPI.disconnectNobleBle(sessionId);
      } catch (disconnectErr) {
        console.debug(
          '[IpcNobleConnection] best-effort disconnect after connect failure',
          disconnectErr,
        );
      }
      this.cleanup();
      this.inner = null;
      throw err;
    }
  }

  get connection() {
    return this.inner;
  }

  cleanup() {
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
  }
}

export interface MeshCoreSelfInfo {
  name: string;
  publicKey: Uint8Array;
  type: number;
  txPower: number;
  radioFreq: number;
  radioBw?: number;
  radioSf?: number;
  radioCr?: number;
  batteryMilliVolts?: number;
}

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

// The connection object returned by meshcore.js is typed loosely — use unknown and cast
interface MeshCoreConnection {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
  once(event: string | number, cb: (...args: unknown[]) => void): void;
  emit(event: string | number, ...args: unknown[]): void;
  close(): Promise<void>;
  getSelfInfo(timeout?: number): Promise<MeshCoreSelfInfo>;
  getContacts(): Promise<MeshCoreContactRaw[]>;
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
  tracePath(pubKeys: Uint8Array[]): Promise<{
    pathLen: number;
    pathHashes: number[];
    pathSnrs: number[];
    lastSnr: number;
    tag: number;
  }>;
  getStatus(pubKey: Uint8Array): Promise<{
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
  setOtherParams(manualAddContacts: boolean): Promise<void>;
  setAutoAddContacts(): Promise<void>;
  setManualAddContacts(): Promise<void>;
}

interface MeshCoreContactRaw {
  publicKey: Uint8Array;
  type: number;
  advName: string;
  lastAdvert: number;
  advLat: number;
  advLon: number;
}

interface MeshCoreChannelRaw {
  channelIdx: number;
  name: string;
  secret: Uint8Array;
}

interface MeshcoreContactDbRow {
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
}

interface DeviceLogEntry {
  ts: number;
  level: string;
  source: string;
  message: string;
}

const MANUAL_CONTACTS_KEY = 'mesh-client:meshcoreManualContacts';
const MESHCORE_COORD_SCALE = 1e6;

const INITIAL_STATE: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  connectionType: null,
};

const MAX_DEVICE_LOGS = 500;
const MAX_TELEMETRY_POINTS = 50;

const MAX_ENV_TELEMETRY_POINTS = 50;

interface MeshcoreNormalizedText {
  senderName?: string;
  payload: string;
}

function normalizeMeshcoreIncomingText(rawText: string): MeshcoreNormalizedText {
  const text = (rawText ?? '').trim();
  if (!text) return { payload: '' };
  const colonIdx = text.indexOf(':');
  if (colonIdx <= 0) return { payload: text };
  const senderCandidate = text.slice(0, colonIdx).trim();
  let payload = text.slice(colonIdx + 1).trim();
  if (!senderCandidate || !payload) return { payload: text };
  const tapbackTargetMatch = payload.match(/^@\[[^\]]+\]\s*(.+)$/u);
  if (tapbackTargetMatch && tapbackTargetMatch[1]) {
    payload = tapbackTargetMatch[1].trim();
  }
  return { senderName: senderCandidate, payload };
}

function meshcoreMessageDedupeKey(msg: ChatMessage): string {
  const body = msg.meshcoreDedupeKey ?? msg.payload;
  return [
    msg.sender_id,
    msg.to ?? '',
    msg.channel,
    msg.timestamp,
    body,
    msg.emoji ?? '',
    msg.replyId ?? '',
  ].join('|');
}

/** Match DB vs live without `meshcoreDedupeKey` (DB rows only have normalized payload). */
function meshcoreLoosePersistenceMatchKey(msg: ChatMessage): string {
  return [
    msg.sender_id,
    msg.channel,
    msg.timestamp,
    msg.payload,
    msg.to ?? '',
    msg.emoji ?? '',
    msg.replyId ?? '',
  ].join('|');
}

/** RF/MQTT can deliver lines before `getMeshcoreMessages` resolves; replacing state would drop them. */
function mergeMeshcoreDbHydrationWithLive(
  prev: ChatMessage[],
  fromDb: ChatMessage[],
): ChatMessage[] {
  const dbLoose = new Set(fromDb.map(meshcoreLoosePersistenceMatchKey));
  const inFlight = prev.filter((m) => {
    if (m.id != null) {
      if (fromDb.some((d) => d.id === m.id)) return false;
      return true;
    }
    return !dbLoose.has(meshcoreLoosePersistenceMatchKey(m));
  });
  const merged = [...fromDb, ...inFlight];
  merged.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return (a.id ?? 0) - (b.id ?? 0);
  });
  return merged;
}

/** Row shape from `db:getMeshcoreMessages` — shared by initConn, mount load, refreshMessagesFromDb. */
interface MeshcoreMessageDbRow {
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
}

/** Map persisted MeshCore message rows to chat messages (normalize payload / stub sender id). */
function mapMeshcoreDbRowsToChatMessages(rows: MeshcoreMessageDbRow[]): ChatMessage[] {
  const mapped: ChatMessage[] = [];
  for (const r of rows) {
    if (isMeshcoreTransportStatusChatLine(r.payload)) continue;
    const normalized = normalizeMeshcoreIncomingText(r.payload);
    const displayName =
      r.sender_name && r.sender_name !== 'Unknown'
        ? r.sender_name
        : (normalized.senderName ?? 'Unknown');
    let senderId = r.sender_id ?? 0;
    if (senderId === 0) {
      senderId = meshcoreChatStubNodeIdFromDisplayName(displayName);
    }
    mapped.push({
      id: r.id,
      sender_id: senderId,
      sender_name: displayName,
      payload: normalized.payload,
      channel: r.channel_idx,
      timestamp: r.timestamp,
      status: (r.status as ChatMessage['status']) ?? 'acked',
      packetId: r.packet_id ?? undefined,
      emoji: r.emoji ?? undefined,
      replyId: r.reply_id ?? undefined,
      to: r.to_node ?? undefined,
      receivedVia: meshcoreReceivedViaFromDb(r.received_via),
      isHistory: true,
    });
  }
  return mapped;
}

/** Ensure minimal chat nodes exist for message senders (RF/MQTT stubs before device connect). */
function mergeStubNodesFromMeshcoreMessages(
  prev: Map<number, MeshNode>,
  mapped: ChatMessage[],
): Map<number, MeshNode> {
  const next = new Map(prev);
  for (const msg of mapped) {
    if (msg.sender_id === 0) continue;
    if (next.has(msg.sender_id)) continue;
    next.set(
      msg.sender_id,
      minimalMeshcoreChatNode(
        msg.sender_id,
        msg.sender_name,
        Math.floor(msg.timestamp / 1000),
        msg.receivedVia === 'mqtt' ? 'mqtt' : 'rf',
      ),
    );
  }
  return next;
}

export function useMeshCore() {
  const [state, setState] = useState<DeviceState>(INITIAL_STATE);
  const [nodes, setNodes] = useState<Map<number, MeshNode>>(new Map());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [channels, setChannels] = useState<{ index: number; name: string; secret: Uint8Array }[]>(
    [],
  );
  const [selfInfo, setSelfInfo] = useState<MeshCoreSelfInfo | null>(null);
  const [ourPosition, setOurPosition] = useState<OurPosition | null>(null);
  const [deviceLogs, setDeviceLogs] = useState<DeviceLogEntry[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const [signalTelemetry, setSignalTelemetry] = useState<TelemetryPoint[]>([]);
  const [meshcoreTraceResults, setMeshcoreTraceResults] = useState<
    Map<number, { hops: { snr: number }[]; lastSnr: number }>
  >(new Map());
  const [meshcoreNodeStatus, setMeshcoreNodeStatus] = useState<Map<number, MeshCoreRepeaterStatus>>(
    new Map(),
  );
  const [meshcoreNodeTelemetry, setMeshcoreNodeTelemetry] = useState<
    Map<number, MeshCoreNodeTelemetry>
  >(new Map());
  const [meshcoreNeighbors, setMeshcoreNeighbors] = useState<Map<number, MeshCoreNeighborResult>>(
    new Map(),
  );
  const [manualAddContacts, setManualAddContacts] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MANUAL_CONTACTS_KEY) === 'true';
    } catch {
      // catch-no-log-ok localStorage read error — return safe default
      return false;
    }
  });
  const [environmentTelemetry, setEnvironmentTelemetry] = useState<EnvironmentTelemetryPoint[]>([]);
  const [mqttStatus, setMqttStatus] = useState<MQTTStatus>('disconnected');
  const mqttStatusRef = useRef<MQTTStatus>('disconnected');

  const connRef = useRef<MeshCoreConnection | null>(null);
  const ipcTcpRef = useRef<IpcTcpConnection | null>(null);
  const ipcNobleRef = useRef<IpcNobleConnection | null>(null);
  const bleConnectInProgressRef = useRef(false);
  // Map pubKeyPrefix (6-byte hex) → nodeId for DM routing
  const pubKeyPrefixMapRef = useRef<Map<string, number>>(new Map());
  // Full pubKey → nodeId for sending
  const pubKeyMapRef = useRef<Map<number, Uint8Array>>(new Map());
  // nodeId → nickname (from JSON import or DB)
  const nicknameMapRef = useRef<Map<number, string>>(new Map());
  // Stable ref to current nodes so event listeners don't form stale closures
  const nodesRef = useRef<Map<number, MeshNode>>(new Map());
  const messagesRef = useRef<ChatMessage[]>([]);
  // Stable ref to own node ID so event listeners don't form stale closures
  const myNodeNumRef = useRef<number>(0);
  // Pending ACK tracking: packetId → { nodeId, timeoutId }
  const pendingAcksRef = useRef<Map<number, { timeoutId: ReturnType<typeof setTimeout> }>>(
    new Map(),
  );
  /** MQTT-derived contacts persisted with a placeholder pubkey until 0x8A supplies a real key. */
  const mqttPlaceholderSavedRef = useRef<Set<number>>(new Set());
  const selfInfoRef = useRef<MeshCoreSelfInfo | null>(null);
  /** Throttle LetsMesh packet-logger publishes (event 136 can be very frequent). */
  const lastPacketLogAtRef = useRef(0);
  /** Rate-limit debug logs when optional packet-logger IPC publish fails. */
  const lastPacketLogPublishFailureLogAtRef = useRef(0);
  const meshcoreHookMountedRef = useRef(true);

  useEffect(() => {
    meshcoreHookMountedRef.current = true;
    return () => {
      meshcoreHookMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    selfInfoRef.current = selfInfo;
  }, [selfInfo]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    myNodeNumRef.current = state.myNodeNum;
  }, [state.myNodeNum]);

  useEffect(() => {
    mqttStatusRef.current = mqttStatus;
  }, [mqttStatus]);

  useEffect(() => {
    const offStatus = window.electronAPI.mqtt.onStatus(({ status: s, protocol }) => {
      if (protocol !== 'meshcore') return;
      const st = s as MQTTStatus;
      mqttStatusRef.current = st;
      setMqttStatus(st);
    });
    return offStatus;
  }, []);

  // Load persisted MeshCore contacts + messages from DB on mount (no device required — matches Meshtastic).
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.electronAPI.db.getMeshcoreContacts(),
      window.electronAPI.db.getMeshcoreMessages(undefined, 500),
    ])
      .then(([rows, dbMsgs]) => {
        if (cancelled) return;
        const dbContacts = rows as {
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
        }[];
        const initial = new Map<number, MeshNode>();
        for (const row of dbContacts) {
          const node: MeshNode = {
            node_id: row.node_id,
            long_name:
              row.nickname ?? row.adv_name ?? `Node-${row.node_id.toString(16).toUpperCase()}`,
            short_name: row.nickname ? row.nickname.slice(0, 4) : '',
            hw_model: CONTACT_TYPE_LABELS[row.contact_type] ?? 'Unknown',
            battery: 0,
            snr: row.last_snr ?? 0,
            rssi: row.last_rssi ?? 0,
            last_heard: row.last_advert ?? 0,
            latitude: row.adv_lat ?? null,
            longitude: row.adv_lon ?? null,
            favorited: row.favorited === 1,
          };
          initial.set(row.node_id, node);
          if (row.nickname) nicknameMapRef.current.set(row.node_id, row.nickname);
          const hex = row.public_key.replace(/\s/g, '');
          if (!meshcoreIsSyntheticPlaceholderPubKeyHex(hex) && hex.length >= 12) {
            const pairs = hex.match(/.{2}/g);
            if (!pairs) continue;
            const bytes = new Uint8Array(pairs.map((b) => parseInt(b, 16)));
            pubKeyMapRef.current.set(row.node_id, bytes);
            const prefix = hex.slice(0, 12);
            pubKeyPrefixMapRef.current.set(prefix, row.node_id);
          }
        }
        const mapped = mapMeshcoreDbRowsToChatMessages(dbMsgs as MeshcoreMessageDbRow[]);
        setNodes(mergeStubNodesFromMeshcoreMessages(initial, mapped));
        if (mapped.length > 0) {
          setMessages((prev) => mergeMeshcoreDbHydrationWithLive(prev, mapped));
          console.debug('[useMeshCore] mount: loaded', mapped.length, 'messages from DB');
        }
      })
      .catch((e) => console.warn('[useMeshCore] load contacts/messages from DB on mount', e));
    return () => {
      cancelled = true;
    };
  }, []);

  // Record a battery telemetry point whenever selfInfo battery data arrives/changes
  useEffect(() => {
    if (selfInfo?.batteryMilliVolts == null) return;
    const voltage = selfInfo.batteryMilliVolts / 1000;
    const point: TelemetryPoint = { timestamp: Date.now(), voltage };
    setTelemetry((prev) => [...prev, point].slice(-MAX_TELEMETRY_POINTS));
  }, [selfInfo?.batteryMilliVolts]);

  const addMessage = useCallback((msg: ChatMessage) => {
    const incomingKey = meshcoreMessageDedupeKey(msg);
    let inserted = false;
    setMessages((prev) => {
      const isDup = prev.some((m) => meshcoreMessageDedupeKey(m) === incomingKey);
      if (isDup) {
        return prev;
      }
      inserted = true;
      return [...prev, msg];
    });
    if (inserted) {
      void window.electronAPI.db.saveMeshcoreMessage(messageToDbRow(msg)).catch((e: unknown) => {
        console.warn('[useMeshCore] saveMeshcoreMessage error', e);
      });
    }
  }, []);

  useEffect(() => {
    const off = window.electronAPI.mqtt.onMeshcoreChat((raw: unknown) => {
      const m = raw as {
        text?: string;
        channelIdx?: number;
        senderName?: string;
        senderNodeId?: number;
        timestamp?: number;
      };
      if (typeof m.text !== 'string' || m.channelIdx == null) return;
      if (isMeshcoreTransportStatusChatLine(m.text)) {
        return;
      }
      let resolvedId =
        m.senderNodeId != null && Number.isFinite(Number(m.senderNodeId))
          ? Number(m.senderNodeId) >>> 0
          : 0;
      const ts = m.timestamp ?? Date.now();
      const tsSec = Math.floor(ts / 1000);
      const displayName =
        m.senderName ?? (resolvedId ? `Node-${resolvedId.toString(16).toUpperCase()}` : 'Unknown');
      if (resolvedId === 0) {
        resolvedId = meshcoreChatStubNodeIdFromDisplayName(displayName);
      }
      setNodes((prev) => {
        const next = new Map(prev);
        const existing = next.get(resolvedId);
        const merged: MeshNode = existing
          ? {
              ...existing,
              long_name: m.senderName ?? existing.long_name,
              short_name: (m.senderName ?? existing.long_name).slice(0, 4),
              last_heard: Math.max(existing.last_heard ?? 0, tsSec),
              heard_via_mqtt: true,
            }
          : minimalMeshcoreChatNode(resolvedId, displayName, tsSec, 'mqtt');
        next.set(resolvedId, merged);
        return next;
      });
      if (
        !meshcoreIsChatStubNodeId(resolvedId) &&
        !pubKeyMapRef.current.has(resolvedId) &&
        !mqttPlaceholderSavedRef.current.has(resolvedId)
      ) {
        mqttPlaceholderSavedRef.current.add(resolvedId);
        void window.electronAPI.db
          .saveMeshcoreContact({
            node_id: resolvedId,
            public_key: meshcoreSyntheticPlaceholderPubKeyHex(resolvedId),
            adv_name: m.senderName ?? displayName,
            contact_type: 1,
            last_advert: tsSec,
            nickname: null,
          })
          .catch((e: unknown) => {
            console.warn('[useMeshCore] saveMeshcoreContact (mqtt chat) error', e);
          });
      }
      addMessage({
        sender_id: resolvedId,
        sender_name: displayName,
        payload: m.text,
        channel: m.channelIdx,
        timestamp: ts,
        status: 'acked',
        receivedVia: 'mqtt',
        meshcoreDedupeKey: m.text,
      });
    });
    return off;
  }, [addMessage]);

  const updateNode = useCallback((node: MeshNode) => {
    setNodes((prev) => {
      const next = new Map(prev);
      next.set(node.node_id, node);
      return next;
    });
  }, []);

  const buildNodesFromContacts = useCallback(
    async (
      contacts: MeshCoreContactRaw[],
      opts?: { self?: MeshCoreSelfInfo | null; myNodeId?: number },
    ): Promise<Map<number, MeshNode>> => {
      const nextNodes = new Map<number, MeshNode>();
      pubKeyMapRef.current.clear();
      pubKeyPrefixMapRef.current.clear();
      for (const contact of contacts) {
        const node = meshcoreContactToMeshNode(contact);
        nextNodes.set(node.node_id, node);
        pubKeyMapRef.current.set(node.node_id, contact.publicKey);
        const prefix = Array.from(contact.publicKey.slice(0, 6))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        pubKeyPrefixMapRef.current.set(prefix, node.node_id);
        void window.electronAPI.db.saveMeshcoreContact(contactToDbRow(contact)).catch((e) => {
          console.warn('[useMeshCore] saveMeshcoreContact error', e);
        });
      }

      try {
        const dbContacts =
          (await window.electronAPI.db.getMeshcoreContacts()) as MeshcoreContactDbRow[];
        for (const row of dbContacts) {
          if (!nextNodes.has(row.node_id)) {
            nextNodes.set(row.node_id, {
              node_id: row.node_id,
              long_name:
                row.nickname ?? row.adv_name ?? `Node-${row.node_id.toString(16).toUpperCase()}`,
              short_name: row.nickname ? row.nickname.slice(0, 4) : '',
              hw_model: CONTACT_TYPE_LABELS[row.contact_type] ?? 'Unknown',
              battery: 0,
              snr: row.last_snr ?? 0,
              rssi: row.last_rssi ?? 0,
              last_heard: row.last_advert ?? 0,
              latitude: row.adv_lat ?? null,
              longitude: row.adv_lon ?? null,
              favorited: row.favorited === 1,
            });
          }
        }
        for (const row of dbContacts) {
          if (row.nickname) nicknameMapRef.current.set(row.node_id, row.nickname);
        }
      } catch (e) {
        console.warn('[useMeshCore] loadContactsFromDb error', e);
      }

      for (const [nodeId, node] of nextNodes) {
        const nick = nicknameMapRef.current.get(nodeId);
        if (nick) nextNodes.set(nodeId, { ...node, long_name: nick, short_name: nick.slice(0, 4) });
      }

      const myNodeId = opts?.myNodeId ?? 0;
      const self = opts?.self;
      if (myNodeId > 0 && self) {
        const selfNode = nextNodes.get(myNodeId);
        const hexFallback = `Node-${myNodeId.toString(16).toUpperCase()}`;
        const selfNameTrimmed = typeof self.name === 'string' ? self.name.trim() : '';
        const displayLongName = selfNameTrimmed || selfNode?.long_name || hexFallback;
        const displayShortName = selfNameTrimmed
          ? selfNameTrimmed.slice(0, 4)
          : selfNode?.short_name || '????';
        if (selfNode) {
          nextNodes.set(myNodeId, {
            ...selfNode,
            long_name: displayLongName,
            short_name: displayShortName,
          });
        } else {
          nextNodes.set(myNodeId, {
            node_id: myNodeId,
            long_name: displayLongName,
            short_name: displayShortName,
            hw_model: 'Unknown',
            battery: 0,
            snr: 0,
            rssi: 0,
            last_heard: Math.floor(Date.now() / 1000),
            latitude: null,
            longitude: null,
          });
        }
      }

      return nextNodes;
    },
    [],
  );

  const setupEventListeners = useCallback(
    (conn: MeshCoreConnection) => {
      const logTransportLineAsDevice = (line: string) => {
        const now = Date.now();
        const entry: DeviceLogEntry = {
          ts: now,
          level: 'info',
          source: 'meshcore',
          message: line.length > 220 ? `${line.slice(0, 220)}…` : line,
        };
        setDeviceLogs((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_DEVICE_LOGS ? next.slice(next.length - MAX_DEVICE_LOGS) : next;
        });
      };

      // Push: periodic advert — event 0x80 = 128
      conn.on(128, (data: unknown) => {
        const d = data as {
          publicKey: Uint8Array;
          advLat: number;
          advLon: number;
          lastAdvert: number;
        };
        const nodeId = pubkeyToNodeId(d.publicKey);
        console.debug('[useMeshCore] event 128: advert from', nodeId.toString(16).toUpperCase());
        setNodes((prev) => {
          const existing = prev.get(nodeId);
          if (!existing) return prev;
          const nick = nicknameMapRef.current.get(nodeId);
          const next = new Map(prev);
          next.set(nodeId, {
            ...existing,
            last_heard: d.lastAdvert,
            latitude: d.advLat !== 0 ? d.advLat / MESHCORE_COORD_SCALE : existing.latitude,
            longitude: d.advLon !== 0 ? d.advLon / MESHCORE_COORD_SCALE : existing.longitude,
            ...(nick ? { long_name: nick, short_name: nick.slice(0, 4) } : {}),
          });
          return next;
        });
        if (d.advLat !== 0 && d.advLon !== 0) {
          usePositionHistoryStore
            .getState()
            .recordPosition(
              nodeId,
              d.advLat / MESHCORE_COORD_SCALE,
              d.advLon / MESHCORE_COORD_SCALE,
            );
        }
        // Persist updated advert position to DB
        void window.electronAPI.db
          .updateMeshcoreContactAdvert(
            nodeId,
            d.lastAdvert ?? null,
            d.advLat !== 0 ? d.advLat / MESHCORE_COORD_SCALE : null,
            d.advLon !== 0 ? d.advLon / MESHCORE_COORD_SCALE : null,
          )
          .catch((e: unknown) => {
            console.warn('[useMeshCore] updateMeshcoreContactAdvert error', e);
          });
      });

      // Push: path updated — event 0x81 = 129; update last_heard for that contact
      conn.on(129, (data: unknown) => {
        const d = data as { publicKey: Uint8Array };
        const nodeId = pubkeyToNodeId(d.publicKey);
        console.debug('[useMeshCore] event 129: path update', nodeId.toString(16).toUpperCase());
        setNodes((prev) => {
          const existing = prev.get(nodeId);
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(nodeId, { ...existing, last_heard: Math.floor(Date.now() / 1000) });
          return next;
        });
      });

      // Push: send confirmed — event 0x82 = 130; resolve pending DM delivery
      conn.on(130, (data: unknown) => {
        const d = data as { ackCode: number; roundTrip?: number };
        const pending = pendingAcksRef.current.get(d.ackCode);
        if (!pending) return;
        clearTimeout(pending.timeoutId);
        pendingAcksRef.current.delete(d.ackCode);
        setMessages((prev) =>
          prev.map((m) => (m.packetId === d.ackCode ? { ...m, status: 'acked' as const } : m)),
        );
        void window.electronAPI.db
          .updateMeshcoreMessageStatus(d.ackCode, 'acked')
          .catch((e: unknown) => {
            console.warn('[useMeshCore] updateMeshcoreMessageStatus error', e);
          });
      });

      // Push: new contact discovered — event 0x8A = 138
      conn.on(138, (data: unknown) => {
        const d = data as MeshCoreContactRaw;
        const node = meshcoreContactToMeshNode(d);
        pubKeyMapRef.current.set(node.node_id, d.publicKey);
        const prefix = Array.from(d.publicKey.slice(0, 6))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        pubKeyPrefixMapRef.current.set(prefix, node.node_id);
        const nick = nicknameMapRef.current.get(node.node_id);
        const nodeWithNick = nick
          ? { ...node, long_name: nick, short_name: nick.slice(0, 4) }
          : node;
        console.debug(
          '[useMeshCore] event 138: new contact',
          node.node_id.toString(16).toUpperCase(),
        );
        updateNode(nodeWithNick);
        void window.electronAPI.db
          .saveMeshcoreContact(contactToDbRow(d, nick ?? null))
          .catch((e: unknown) => {
            console.warn('[useMeshCore] saveMeshcoreContact (event 138) error', e);
          });
      });

      // Push: message waiting — event 0x83 = 131; fetch all queued messages
      conn.on(131, () => {
        void (async () => {
          try {
            const msgs = await conn.getWaitingMessages();
            if (!meshcoreHookMountedRef.current) return;
            const arr = msgs as {
              contactMessage?: { pubKeyPrefix: Uint8Array; senderTimestamp: number; text: string };
              channelMessage?: { channelIdx: number; senderTimestamp: number; text: string };
            }[];
            for (const m of arr) {
              if (m.contactMessage) {
                const d = m.contactMessage;
                const prefix = Array.from(d.pubKeyPrefix)
                  .map((b) => b.toString(16).padStart(2, '0'))
                  .join('');
                const senderId = pubKeyPrefixMapRef.current.get(prefix) ?? 0;
                const sender = nodesRef.current.get(senderId);
                if (senderId !== 0) {
                  setNodes((prev) => {
                    const node = prev.get(senderId);
                    if (!node) return prev;
                    const next = new Map(prev);
                    next.set(senderId, { ...node, last_heard: d.senderTimestamp });
                    return next;
                  });
                }
                if (isMeshcoreTransportStatusChatLine(d.text)) {
                  logTransportLineAsDevice(d.text);
                } else {
                  addMessage({
                    sender_id: senderId,
                    sender_name: sender?.long_name ?? `Node-${senderId.toString(16).toUpperCase()}`,
                    payload: d.text,
                    channel: -1,
                    timestamp: d.senderTimestamp * 1000,
                    status: 'acked',
                    receivedVia: 'rf',
                    isHistory: true,
                    meshcoreDedupeKey: d.text,
                  });
                }
              }
              if (m.channelMessage) {
                const d = m.channelMessage;
                if (isMeshcoreTransportStatusChatLine(d.text)) {
                  logTransportLineAsDevice(d.text);
                  continue;
                }
                const normalized = normalizeMeshcoreIncomingText(d.text);
                const displayName = normalized.senderName ?? 'Unknown';
                const stubId = meshcoreChatStubNodeIdFromDisplayName(displayName);
                setNodes((prev) => {
                  const next = new Map(prev);
                  const existing = next.get(stubId);
                  next.set(
                    stubId,
                    existing
                      ? {
                          ...existing,
                          last_heard: Math.max(existing.last_heard ?? 0, d.senderTimestamp),
                        }
                      : minimalMeshcoreChatNode(stubId, displayName, d.senderTimestamp, 'rf'),
                  );
                  return next;
                });
                addMessage({
                  sender_id: stubId,
                  sender_name: displayName,
                  payload: normalized.payload,
                  channel: d.channelIdx,
                  timestamp: d.senderTimestamp * 1000,
                  status: 'acked',
                  receivedVia: 'rf',
                  isHistory: true,
                  meshcoreDedupeKey: d.text,
                });
              }
            }
            console.debug(
              '[useMeshCore] event 131: message waiting, fetched',
              arr.length,
              'messages',
            );
          } catch (e) {
            console.warn('[useMeshCore] getWaitingMessages error', e);
          }
        })();
      });

      // Incoming DM — event 7
      conn.on(7, (data: unknown) => {
        const d = data as { pubKeyPrefix: Uint8Array; text: string; senderTimestamp: number };
        const prefix = Array.from(d.pubKeyPrefix)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const senderId = pubKeyPrefixMapRef.current.get(prefix) ?? 0;
        const sender = nodesRef.current.get(senderId);
        if (senderId !== 0) {
          setNodes((prev) => {
            const node = prev.get(senderId);
            if (!node) return prev;
            const next = new Map(prev);
            next.set(senderId, { ...node, last_heard: d.senderTimestamp });
            return next;
          });
        }
        console.debug('[useMeshCore] event 7: DM from', senderId.toString(16).toUpperCase());
        if (isMeshcoreTransportStatusChatLine(d.text)) {
          logTransportLineAsDevice(d.text);
          return;
        }
        addMessage({
          sender_id: senderId,
          sender_name: sender?.long_name ?? `Node-${senderId.toString(16).toUpperCase()}`,
          payload: d.text,
          channel: -1, // DM channel sentinel
          timestamp: d.senderTimestamp * 1000,
          status: 'acked',
          receivedVia: 'rf',
          meshcoreDedupeKey: d.text,
        });
      });

      // Incoming channel message — event 8
      conn.on(8, (data: unknown) => {
        const d = data as { channelIdx: number; text: string; senderTimestamp: number };
        if (isMeshcoreTransportStatusChatLine(d.text)) {
          logTransportLineAsDevice(d.text);
          return;
        }
        const normalized = normalizeMeshcoreIncomingText(d.text);
        console.debug('[useMeshCore] event 8: channel msg idx=', d.channelIdx);
        const displayName = normalized.senderName ?? 'Unknown';
        const stubId = meshcoreChatStubNodeIdFromDisplayName(displayName);
        setNodes((prev) => {
          const next = new Map(prev);
          const existing = next.get(stubId);
          next.set(
            stubId,
            existing
              ? {
                  ...existing,
                  last_heard: Math.max(existing.last_heard ?? 0, d.senderTimestamp),
                }
              : minimalMeshcoreChatNode(stubId, displayName, d.senderTimestamp, 'rf'),
          );
          return next;
        });
        addMessage({
          sender_id: stubId,
          sender_name: displayName,
          payload: normalized.payload,
          channel: d.channelIdx,
          timestamp: d.senderTimestamp * 1000,
          status: 'acked',
          receivedVia: 'rf',
          meshcoreDedupeKey: d.text,
        });
      });

      // Push: RF packet received — event 0x88 = 136; feed into device logs + signal telemetry.
      // Foreign LoRa fingerprinting requires d.raw (Uint8Array) from meshcore.js/device.
      conn.on(136, (data: unknown) => {
        const d = data as { lastSnr?: number; lastRssi?: number; raw?: unknown };
        const snr = d.lastSnr ?? 0;
        const rssi = d.lastRssi ?? 0;
        const now = Date.now();
        const entry: DeviceLogEntry = {
          ts: now,
          level: 'info',
          source: 'meshcore',
          message: `RX SNR=${snr.toFixed(2)}dB RSSI=${rssi}dBm`,
        };
        setDeviceLogs((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_DEVICE_LOGS ? next.slice(next.length - MAX_DEVICE_LOGS) : next;
        });
        const sigPoint: TelemetryPoint = { timestamp: now, snr, rssi };
        setSignalTelemetry((prev) => [...prev, sigPoint].slice(-MAX_TELEMETRY_POINTS));

        // Foreign LoRa fingerprinting: only flag non-MeshCore packets as foreign (requires known self node ID)
        if (myNodeNumRef.current !== 0 && d.raw instanceof Uint8Array && d.raw.length > 0) {
          const packetClass = classifyPayload(d.raw);
          if (packetClass !== 'meshcore') {
            const senderId = packetClass === 'meshtastic' ? extractMeshtasticSenderId(d.raw) : null;
            useDiagnosticsStore
              .getState()
              .recordForeignLora(
                myNodeNumRef.current,
                packetClass,
                rssi || undefined,
                snr || undefined,
                senderId ?? undefined,
                () => nodesRef.current,
              );
          }
        }

        const mq = readMeshcoreMqttSettingsFromStorage();
        if (
          mqttStatusRef.current === 'connected' &&
          isLetsMeshSettings(mq.server) &&
          mq.meshcorePacketLoggerEnabled
        ) {
          const now = Date.now();
          if (now - lastPacketLogAtRef.current >= 100) {
            lastPacketLogAtRef.current = now;
            const origin = selfInfoRef.current?.name ?? 'mesh-client';
            let rawHex: string | undefined;
            if (d.raw instanceof Uint8Array && d.raw.length > 0) {
              rawHex = Array.from(d.raw, (b) => b.toString(16).padStart(2, '0')).join('');
            }
            void window.electronAPI.mqtt
              .publishMeshcorePacketLog({
                origin,
                snr,
                rssi,
                rawHex,
              })
              .catch((e) => {
                const t = Date.now();
                if (t - lastPacketLogPublishFailureLogAtRef.current >= 30_000) {
                  lastPacketLogPublishFailureLogAtRef.current = t;
                  console.debug(
                    '[useMeshCore] publishMeshcorePacketLog failed',
                    sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
                  );
                }
              });
          }
        }
      });

      conn.on('disconnected', () => {
        setState((prev) => ({ ...prev, status: 'disconnected' }));
      });
    },
    [addMessage, updateNode, setDeviceLogs],
  );

  /** Shared post-connection handshake: wire events, fetch self info, contacts, channels. */
  const initConn = useCallback(
    async (conn: MeshCoreConnection) => {
      connRef.current = conn;
      setupEventListeners(conn);

      // Load persisted messages from DB before device's MsgWaiting fires (merge with mount-hydrated state)
      try {
        const dbMsgs = (await window.electronAPI.db.getMeshcoreMessages(
          undefined,
          500,
        )) as MeshcoreMessageDbRow[];
        if (dbMsgs.length > 0) {
          const mapped = mapMeshcoreDbRowsToChatMessages(dbMsgs);
          setNodes((prev) => mergeStubNodesFromMeshcoreMessages(prev, mapped));
          setMessages((prev) => mergeMeshcoreDbHydrationWithLive(prev, mapped));
          console.debug('[useMeshCore] initConn: loaded', mapped.length, 'messages from DB');
        }
      } catch (e) {
        console.warn('[useMeshCore] loadMessagesFromDb error', e);
      }

      // Fetch self info, contacts, channels (sequential — device handles one request at a time)
      const info = await conn.getSelfInfo(5000);
      console.debug(
        `[useMeshCore] selfInfo: radioFreq=${info.radioFreq} radioBw=${info.radioBw} radioSf=${info.radioSf} radioCr=${info.radioCr} txPower=${info.txPower}`,
      );
      setSelfInfo(info);
      setState((prev) => ({ ...prev, status: 'connected' }));

      const myNodeId = pubkeyToNodeId(info.publicKey);
      setState((prev) => ({ ...prev, myNodeNum: myNodeId, status: 'configured' }));
      useDiagnosticsStore.getState().migrateForeignLoraFromZero(myNodeId);

      const contacts = await withTimeout(conn.getContacts(), 10_000, 'getContacts');
      const newNodes = await buildNodesFromContacts(contacts, { self: info, myNodeId });
      setNodes((prev) => mergeMeshcoreChatStubNodes(prev, newNodes));
      console.debug('[useMeshCore] initConn: contacts loaded, device=', contacts.length);

      const rawChannels = await withTimeout(conn.getChannels(), 10_000, 'getChannels');
      setChannels(
        rawChannels.map((c) => ({ index: c.channelIdx, name: c.name, secret: c.secret })),
      );
      console.debug('[useMeshCore] initConn: channels=', rawChannels.length);

      // Post-init side-effects — run sequentially to avoid shared Ok/Err listener races
      // with user-initiated commands (e.g. config import right after connect).
      // Apply saved manual contacts preference
      try {
        const savedManual = localStorage.getItem(MANUAL_CONTACTS_KEY) === 'true';
        if (savedManual) {
          await conn.setManualAddContacts();
        }
      } catch (e) {
        console.warn('[useMeshCore] setManualAddContacts (init) error', e);
      }

      await conn.syncDeviceTime().catch((e) => {
        console.warn('[useMeshCore] syncDeviceTime error', e);
      });
      await conn
        .getBatteryVoltage()
        .then(({ batteryMilliVolts }) => {
          setSelfInfo((prev) => (prev ? { ...prev, batteryMilliVolts } : prev));
        })
        .catch((e) => {
          console.warn('[useMeshCore] getBatteryVoltage error', e);
        });
    },
    [buildNodesFromContacts, setupEventListeners],
  );

  const connect = useCallback(
    async (type: 'ble' | 'serial' | 'tcp', tcpHost?: string, blePeripheralId?: string) => {
      if (type === 'ble' && bleConnectInProgressRef.current) {
        throw new Error(
          'Bluetooth connection already in progress. Wait for it to finish or cancel, then try again.',
        );
      }

      setState({
        status: 'connecting',
        myNodeNum: 0,
        connectionType: type === 'tcp' ? 'http' : type,
      });

      if (type === 'ble') bleConnectInProgressRef.current = true;

      try {
        let conn: MeshCoreConnection | null = null;

        if (type === 'ble') {
          if (!blePeripheralId) {
            throw new Error('BLE peripheral ID required');
          }
          let connected = false;
          let lastBleError: unknown = null;
          for (let attempt = 1; attempt <= NOBLE_IPC_CONNECT_MAX_ATTEMPTS; attempt++) {
            const attemptStartedAt = Date.now();
            console.debug(
              `[useMeshCore] connect: BLE via Noble IPC opening... (attempt ${attempt}/${NOBLE_IPC_CONNECT_MAX_ATTEMPTS})`,
            );
            const nobleConn = new IpcNobleConnection(blePeripheralId, 'meshcore');
            ipcNobleRef.current = nobleConn;
            try {
              await nobleConn.connect();
              conn = nobleConn.connection as unknown as MeshCoreConnection;
              connected = true;
              if (attempt > 1) {
                console.info('[useMeshCore] connect: BLE via Noble IPC recovered on retry', {
                  attempt,
                  maxAttempts: NOBLE_IPC_CONNECT_MAX_ATTEMPTS,
                  elapsedMs: Date.now() - attemptStartedAt,
                });
              }
              break;
            } catch (bleErr) {
              lastBleError = bleErr;
              const rawBleMessage = serializeErrorLike(bleErr) || 'BLE connect failed';
              const isTimeout =
                /MeshCore BLE IPC open timed out|MeshCore BLE protocol handshake timed out/i.test(
                  rawBleMessage,
                );
              const stage = isTimeout ? classifyMeshcoreBleTimeoutStage(rawBleMessage) : null;
              console.warn('[useMeshCore] connect: BLE Noble IPC attempt failed', {
                attempt,
                maxAttempts: NOBLE_IPC_CONNECT_MAX_ATTEMPTS,
                isTimeout,
                stage,
                elapsedMs: Date.now() - attemptStartedAt,
                message: rawBleMessage,
              });
              ipcNobleRef.current?.cleanup();
              ipcNobleRef.current = null;
              if (!isTimeout || attempt >= NOBLE_IPC_CONNECT_MAX_ATTEMPTS) {
                throw bleErr;
              }
              console.debug('[useMeshCore] connect: retrying BLE Noble IPC after timeout', {
                nextAttempt: attempt + 1,
                maxAttempts: NOBLE_IPC_CONNECT_MAX_ATTEMPTS,
                stage,
              });
            }
          }
          if (!connected) throw lastBleError ?? new Error('BLE connect failed');
        } else if (type === 'serial') {
          console.debug('[useMeshCore] connect: serial requesting port...');
          if (!navigator.serial?.requestPort) throw new Error('Web Serial API not available');
          const port = await navigator.serial.requestPort();
          persistSerialPortIdentity(port as SerialPort);
          await (port as any).open({ baudRate: 115200 });
          conn = new (WebSerialConnection as unknown as new (port: unknown) => MeshCoreConnection)(
            port,
          );
        } else {
          // tcp
          const host = tcpHost ?? 'localhost';
          console.debug('[useMeshCore] connect: TCP to', host);
          const tcpConn = new IpcTcpConnection(host, 4403);
          ipcTcpRef.current = tcpConn;
          await tcpConn.connect();
          conn = tcpConn.connection as unknown as MeshCoreConnection;
        }

        if (!conn) throw new Error('Connection initialization failed');
        await initConn(conn);
        console.debug('[useMeshCore] connect: handshake complete, type=', type);
      } catch (err) {
        const rawMessage = serializeErrorLike(err) || 'Connection failed';
        const safeMessage = (rawMessage && String(rawMessage).trim()) || 'Connection failed';
        const isAlreadyInProgress = /already in progress|Connection already in progress/i.test(
          safeMessage,
        );
        const isMissingServices = /could not find all requested services/i.test(safeMessage);
        const isPeripheralInUse = /already in use by the/i.test(safeMessage);
        const isBleConnectTimeout =
          type === 'ble' &&
          /MeshCore BLE IPC open timed out|MeshCore BLE protocol handshake timed out/i.test(
            safeMessage,
          );
        const bleTimeoutStage = isBleConnectTimeout
          ? classifyMeshcoreBleTimeoutStage(safeMessage)
          : null;
        // When err is missing (e.g. library rejected with no reason), use a BLE-specific hint if we were connecting via BLE
        const fallbackMessage =
          type === 'ble' && err == null
            ? 'BLE connection failed (no error details from device). Try again or use Serial/USB.'
            : 'Connection failed';
        const displayMessage = safeMessage !== 'Connection failed' ? safeMessage : fallbackMessage;
        const timeoutMessage =
          bleTimeoutStage === 'protocol-handshake'
            ? 'Bluetooth connected but MeshCore protocol handshake did not complete before disconnect/timeout. Retry, keep the device awake and nearby, power-cycle BLE, or use Serial/TCP.'
            : 'Bluetooth connection timed out while opening MeshCore over Noble IPC. Retry, power-cycle BLE on the device, or use Serial/TCP.';
        const normalizedErr = new Error(
          isAlreadyInProgress
            ? 'Bluetooth connection already in progress. Wait for it to finish or try Serial/USB instead.'
            : isMissingServices
              ? 'Device does not support the MeshCore BLE protocol. Make sure the device is running MeshCore firmware.'
              : isPeripheralInUse
                ? 'This device is already connected via Meshtastic BLE. Disconnect it first before connecting as MeshCore.'
                : isBleConnectTimeout
                  ? timeoutMessage
                  : displayMessage,
        );
        if (isBleConnectTimeout) {
          console.warn(
            '[useMeshCore] connect: BLE Noble IPC timed out; advise retry, BLE power-cycle, or Serial/TCP fallback',
            { stage: bleTimeoutStage },
          );
        }
        const errForLog = serializeErrorLike(err) || '(no error object)';
        console.error('[useMeshCore] connect error', normalizedErr.message, errForLog, {
          bleTimeoutStage,
        });
        setState({ status: 'disconnected', myNodeNum: 0, connectionType: null });
        ipcTcpRef.current?.cleanup();
        ipcTcpRef.current = null;
        ipcNobleRef.current?.cleanup();
        ipcNobleRef.current = null;
        throw normalizedErr;
      } finally {
        if (type === 'ble') bleConnectInProgressRef.current = false;
      }
    },
    [initConn],
  );

  /**
   * Gesture-free reconnect — called on startup when a last connection is remembered.
   * Serial: uses navigator.serial.getPorts() to find the previously granted port by ID.
   * HTTP: delegates to connect() directly.
   * BLE: requires a user gesture, not supported here.
   */
  const connectAutomatic = useCallback(
    async (
      type: 'ble' | 'serial' | 'http',
      httpAddress?: string,
      lastSerialPortId?: string | null,
    ) => {
      if (type === 'serial') {
        setState({ status: 'connecting', myNodeNum: 0, connectionType: 'serial' });
        try {
          if (!navigator.serial?.getPorts) throw new Error('Web Serial API not available');
          const ports = await navigator.serial.getPorts();
          const port = selectGrantedSerialPort(ports, lastSerialPortId);
          persistSerialPortIdentity(port);
          await (port as SerialPort).open({ baudRate: 115200 });
          const conn = new (WebSerialConnection as unknown as new (
            port: unknown,
          ) => MeshCoreConnection)(port);
          await initConn(conn);
          console.debug('[useMeshCore] connectAutomatic serial: connected');
        } catch (err) {
          console.error('[useMeshCore] connectAutomatic serial error', err);
          setState({ status: 'disconnected', myNodeNum: 0, connectionType: null });
          throw err;
        }
      } else if (type === 'http') {
        let addr = httpAddress;
        if (addr == null || !String(addr).trim()) {
          try {
            const raw = localStorage.getItem('mesh-client:lastConnection:meshcore');
            const parsed = raw
              ? (JSON.parse(raw) as { type?: string; httpAddress?: string })
              : null;
            if (
              parsed?.type === 'http' &&
              typeof parsed.httpAddress === 'string' &&
              parsed.httpAddress.trim()
            ) {
              addr = parsed.httpAddress;
            }
          } catch {
            // catch-no-log-ok corrupt lastConnection JSON
          }
        }
        await connect('tcp', addr);
      }
      // BLE: requires user gesture — not supported for auto-connect
    },
    [initConn, connect],
  );

  const disconnect = useCallback(async () => {
    console.debug('[useMeshCore] disconnect');
    // Cancel all pending ACK timers
    for (const { timeoutId } of pendingAcksRef.current.values()) {
      clearTimeout(timeoutId);
    }
    pendingAcksRef.current.clear();

    try {
      await connRef.current?.close();
    } catch (e) {
      console.warn('[useMeshCore] disconnect: close error', e);
    }
    ipcTcpRef.current?.cleanup();
    ipcTcpRef.current = null;
    ipcNobleRef.current?.cleanup();
    ipcNobleRef.current = null;
    connRef.current = null;
    pubKeyMapRef.current.clear();
    pubKeyPrefixMapRef.current.clear();
    nicknameMapRef.current.clear();
    setNodes(new Map());
    setMessages([]);
    setChannels([]);
    setSelfInfo(null);
    setDeviceLogs([]);
    setTelemetry([]);
    setSignalTelemetry([]);
    setMeshcoreTraceResults(new Map());
    setMeshcoreNodeStatus(new Map());
    setMeshcoreNodeTelemetry(new Map());
    setMeshcoreNeighbors(new Map());
    setEnvironmentTelemetry([]);
    setState(INITIAL_STATE);
    console.debug('[useMeshCore] disconnect: complete');
  }, []);

  const sendMessage = useCallback(
    async (text: string, channelIdx: number, destNodeId?: number) => {
      if (!connRef.current) return;
      if (destNodeId !== undefined) {
        const pubKey = pubKeyMapRef.current.get(destNodeId);
        if (!pubKey) {
          console.warn('[useMeshCore] sendMessage: no pubKey for', destNodeId);
          return;
        }
        const sentAt = Date.now();
        // Optimistically add own message with 'sending' status
        const tempMsg: ChatMessage = {
          sender_id: myNodeNumRef.current,
          sender_name: selfInfo?.name ?? 'Me',
          payload: text,
          channel: channelIdx,
          timestamp: sentAt,
          status: 'sending',
          to: destNodeId,
        };
        setMessages((prev) => [...prev, tempMsg]);

        try {
          const result = await connRef.current.sendTextMessage(pubKey, text);
          const ackCrc = result?.expectedAckCrc;
          const estTimeout = result?.estTimeout ?? 30_000;

          if (ackCrc !== undefined) {
            // Update the temp message with the real packetId
            setMessages((prev) =>
              prev.map((m) =>
                m === tempMsg || (m.timestamp === sentAt && m.status === 'sending')
                  ? { ...m, sender_id: myNodeNumRef.current, packetId: ackCrc }
                  : m,
              ),
            );
            // Persist the outgoing DM with packet_id for status tracking
            void window.electronAPI.db
              .saveMeshcoreMessage({
                sender_id: myNodeNumRef.current || null,
                sender_name: selfInfo?.name ?? 'Me',
                payload: text,
                channel_idx: channelIdx,
                timestamp: sentAt,
                status: 'sending',
                packet_id: ackCrc,
                to_node: destNodeId,
              })
              .catch((e) => {
                console.warn('[useMeshCore] saveMeshcoreMessage (outgoing) error', e);
              });

            // Schedule failure timeout
            const timeoutId = setTimeout(() => {
              pendingAcksRef.current.delete(ackCrc);
              setMessages((prev) =>
                prev.map((m) =>
                  m.packetId === ackCrc && m.status === 'sending'
                    ? { ...m, status: 'failed' as const }
                    : m,
                ),
              );
              void window.electronAPI.db
                .updateMeshcoreMessageStatus(ackCrc, 'failed')
                .catch((e) => {
                  console.warn('[useMeshCore] updateMeshcoreMessageStatus (timeout) error', e);
                });
            }, estTimeout);
            pendingAcksRef.current.set(ackCrc, { timeoutId });
          } else {
            // No ackCrc — mark as acked immediately
            setMessages((prev) =>
              prev.map((m) =>
                m === tempMsg || (m.timestamp === sentAt && m.status === 'sending')
                  ? { ...m, sender_id: myNodeNumRef.current, status: 'acked' as const }
                  : m,
              ),
            );
            void window.electronAPI.db
              .saveMeshcoreMessage({
                sender_id: myNodeNumRef.current || null,
                sender_name: selfInfo?.name ?? 'Me',
                payload: text,
                channel_idx: channelIdx,
                timestamp: sentAt,
                status: 'acked',
                to_node: destNodeId,
              })
              .catch((e) => {
                console.warn('[useMeshCore] saveMeshcoreMessage (outgoing-no-ack) error', e);
              });
          }
        } catch (e) {
          console.warn('[useMeshCore] sendTextMessage error', e);
          setMessages((prev) =>
            prev.map((m) =>
              m === tempMsg || (m.timestamp === sentAt && m.status === 'sending')
                ? { ...m, status: 'failed' as const }
                : m,
            ),
          );
        }
      } else {
        const sentAt = Date.now();
        try {
          const channelConn = connRef.current;
          if (channelConn) {
            await channelConn.sendChannelTextMessage(channelIdx, text);
            addMessage({
              sender_id: myNodeNumRef.current,
              sender_name: selfInfo?.name ?? 'Me',
              payload: text,
              channel: channelIdx,
              timestamp: sentAt,
              status: 'acked',
            });
          } else if (mqttStatusRef.current === 'connected') {
            const mq = readMeshcoreMqttSettingsFromStorage();
            if (isLetsMeshSettings(mq.server)) {
              // LetsMesh MQTT is for authenticated packet/analyzer feeds (see docs), not MQTT-only
              // channel chat without a radio.
              return;
            }
            await window.electronAPI.mqtt.publishMeshcore({
              text,
              channelIdx,
              senderNodeId: myNodeNumRef.current || undefined,
              senderName: selfInfo?.name,
              timestamp: sentAt,
            });
            addMessage({
              sender_id: myNodeNumRef.current,
              sender_name: selfInfo?.name ?? 'Me',
              payload: text,
              channel: channelIdx,
              timestamp: sentAt,
              status: 'acked',
              receivedVia: 'mqtt',
            });
          }
        } catch (e) {
          console.warn('[useMeshCore] sendChannelTextMessage / publishMeshcore error', e);
        }
      }
    },
    [addMessage, selfInfo],
  );

  const refreshContacts = useCallback(async () => {
    if (!connRef.current) return;
    try {
      const contacts = await connRef.current.getContacts();
      const newNodes = await buildNodesFromContacts(contacts, {
        self: selfInfo,
        myNodeId: myNodeNumRef.current,
      });
      setNodes((prev) => mergeMeshcoreChatStubNodes(prev, newNodes));
      console.debug('[useMeshCore] refreshContacts: loaded', contacts.length);
    } catch (e) {
      console.error('[useMeshCore] refreshContacts error', e);
    }
  }, [buildNodesFromContacts, selfInfo]);

  const sendAdvert = useCallback(async () => {
    if (!connRef.current) return;
    console.debug('[useMeshCore] sendAdvert');
    await connRef.current.sendFloodAdvert();
  }, []);

  const syncClock = useCallback(async () => {
    if (!connRef.current) return;
    console.debug('[useMeshCore] syncClock');
    await connRef.current.syncDeviceTime();
  }, []);

  const reboot = useCallback(async () => {
    if (!connRef.current) return;
    try {
      await connRef.current.reboot();
    } catch (e) {
      console.warn('[useMeshCore] reboot error', e);
    }
    await disconnect();
  }, [disconnect]);

  const deleteNode = useCallback(async (nodeId: number) => {
    const pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey || !connRef.current) return;
    console.debug('[useMeshCore] deleteNode:', nodeId.toString(16).toUpperCase());
    try {
      await connRef.current.removeContact(pubKey);
    } catch (e) {
      console.warn('[useMeshCore] removeContact error', e);
    }
    pubKeyMapRef.current.delete(nodeId);
    // Remove the 6-byte prefix mapping too
    for (const [prefix, id] of pubKeyPrefixMapRef.current) {
      if (id === nodeId) {
        pubKeyPrefixMapRef.current.delete(prefix);
        break;
      }
    }
    setNodes((prev) => {
      const next = new Map(prev);
      next.delete(nodeId);
      return next;
    });
    void window.electronAPI.db.deleteMeshcoreContact(nodeId).catch((e) => {
      console.warn('[useMeshCore] deleteMeshcoreContact error', e);
    });
  }, []);

  const clearAllRepeaters = useCallback(async () => {
    setNodes((prev) => {
      const next = new Map(prev);
      for (const [id, node] of prev) {
        if (node.hw_model === 'Repeater') next.delete(id);
      }
      return next;
    });
    await window.electronAPI.db.clearMeshcoreRepeaters().catch((e) => {
      console.warn('[useMeshCore] clearMeshcoreRepeaters error', e);
    });
  }, []);

  const setOwner = useCallback(
    async (owner: { longName: string; shortName: string; isLicensed: boolean }) => {
      console.debug(
        '[useMeshCore] setOwner called, connRef.current:',
        !!connRef.current,
        'name:',
        owner.longName,
      );
      if (!connRef.current) {
        console.warn('[useMeshCore] setOwner: connRef.current is null, aborting');
        return;
      }
      try {
        await connRef.current.setAdvertName(owner.longName);
        console.debug('[useMeshCore] setAdvertName succeeded');
      } catch (e) {
        console.error('[useMeshCore] setAdvertName threw:', e);
        throw e;
      }
      setSelfInfo((prev) => (prev ? { ...prev, name: owner.longName } : prev));
    },
    [],
  );

  const setRadioParams = useCallback(
    async (p: { freq: number; bw: number; sf: number; cr: number; txPower: number }) => {
      console.debug(
        `[useMeshCore] setRadioParams called, connRef=${!!connRef.current} freq=${p.freq} bw=${p.bw} sf=${p.sf} cr=${p.cr} txPower=${p.txPower}`,
      );
      if (!connRef.current) {
        console.warn('[useMeshCore] setRadioParams: connRef.current is null, aborting');
        return;
      }
      try {
        // MeshCore protocol: freq as UInt32 in kHz (910525 = 910.525 MHz), bw in Hz.
        const freqKhz = Math.round(p.freq / 1000);
        await connRef.current.setRadioParams(freqKhz, p.bw, p.sf, p.cr);
        console.debug('[useMeshCore] setRadioParams succeeded');
      } catch (e) {
        console.error('[useMeshCore] setRadioParams threw:', e);
        const err =
          e === undefined || (e instanceof Error && !e.message)
            ? new Error(
                'Failed to apply radio settings. The device may not support changing radio parameters over this connection.',
              )
            : e;
        throw err;
      }
      try {
        await connRef.current.setTxPower(p.txPower);
        console.debug('[useMeshCore] setTxPower succeeded');
      } catch (e) {
        console.error('[useMeshCore] setTxPower threw:', e);
        const err =
          e === undefined || (e instanceof Error && !e.message)
            ? new Error(
                'Failed to set TX power. The device may not support changing it over this connection.',
              )
            : e;
        throw err;
      }
      setSelfInfo((prev) =>
        prev
          ? {
              ...prev,
              radioFreq: p.freq,
              radioBw: p.bw,
              radioSf: p.sf,
              radioCr: p.cr,
              txPower: p.txPower,
            }
          : prev,
      );
    },
    [],
  );

  const sendPositionToDeviceMeshCore = useCallback(
    async (lat: number, lon: number) => {
      if (!connRef.current) return;
      const latInt = Math.round(lat * MESHCORE_COORD_SCALE);
      const lonInt = Math.round(lon * MESHCORE_COORD_SCALE);
      try {
        await connRef.current.setAdvertLatLong(latInt, lonInt);
        const selfNodeId = myNodeNumRef.current;
        const nowSec = Math.floor(Date.now() / 1000);
        setOurPosition({ lat, lon, source: 'static' });
        if (selfNodeId > 0) {
          setNodes((prev) => {
            const next = new Map(prev);
            const existing = next.get(selfNodeId);
            if (existing) {
              next.set(selfNodeId, {
                ...existing,
                latitude: lat,
                longitude: lon,
                last_heard: nowSec,
              });
            } else {
              const trimmedName = selfInfo?.name?.trim() ?? '';
              next.set(selfNodeId, {
                node_id: selfNodeId,
                long_name: trimmedName || `Node-${selfNodeId.toString(16).toUpperCase()}`,
                short_name: (trimmedName || '????').slice(0, 4),
                hw_model: 'Unknown',
                battery: 0,
                snr: 0,
                rssi: 0,
                last_heard: nowSec,
                latitude: lat,
                longitude: lon,
              });
            }
            return next;
          });
        }
      } catch (e) {
        console.error('[useMeshCore] setAdvertLatLong failed', { lat, lon, latInt, lonInt }, e);
        const err =
          e === undefined || (e instanceof Error && !e.message)
            ? new Error(
                'Device rejected position update — check that the device supports setting coordinates',
              )
            : e;
        throw err;
      }
    },
    [selfInfo?.name],
  );

  const traceRoute = useCallback(async (nodeId: number) => {
    const pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey || !connRef.current) return;
    console.debug('[useMeshCore] traceRoute nodeId=', nodeId.toString(16).toUpperCase());
    try {
      const result = await connRef.current.tracePath([pubKey]);
      // pathSnrs are signed bytes in 0.25dB units
      const hops = (result.pathSnrs ?? []).map((raw) => {
        const signed = raw > 127 ? raw - 256 : raw;
        return { snr: signed * 0.25 };
      });
      setMeshcoreTraceResults((prev) => {
        const next = new Map(prev);
        next.set(nodeId, { hops, lastSnr: result.lastSnr * 0.25 });
        return next;
      });
      useRepeaterSignalStore.getState().recordSignal(nodeId, result.lastSnr * 0.25);
      console.debug(
        '[useMeshCore] traceRoute result: hops=',
        hops.length,
        'lastSnr=',
        result.lastSnr * 0.25,
      );
    } catch (e) {
      console.warn('[useMeshCore] traceRoute error', e);
    }
  }, []);

  const requestRepeaterStatus = useCallback(async (nodeId: number) => {
    const pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey || !connRef.current) return;
    console.debug('[useMeshCore] requestRepeaterStatus nodeId=', nodeId.toString(16).toUpperCase());
    try {
      const raw = await connRef.current.getStatus(pubKey);
      const status: MeshCoreRepeaterStatus = {
        battMilliVolts: raw.batt_milli_volts,
        noiseFloor: raw.noise_floor,
        lastRssi: raw.last_rssi,
        lastSnr: raw.last_snr,
        nPacketsRecv: raw.n_packets_recv,
        nPacketsSent: raw.n_packets_sent,
        totalAirTimeSecs: raw.total_air_time_secs,
        totalUpTimeSecs: raw.total_up_time_secs,
        nSentFlood: raw.n_sent_flood,
        nSentDirect: raw.n_sent_direct,
        nRecvFlood: raw.n_recv_flood,
        nRecvDirect: raw.n_recv_direct,
        errEvents: raw.err_events,
        nDirectDups: raw.n_direct_dups,
        nFloodDups: raw.n_flood_dups,
        currTxQueueLen: raw.curr_tx_queue_len,
      };
      setMeshcoreNodeStatus((prev) => {
        const next = new Map(prev);
        next.set(nodeId, status);
        return next;
      });
      useRepeaterSignalStore.getState().recordSignal(nodeId, status.lastSnr);
    } catch (e) {
      console.warn('[useMeshCore] requestRepeaterStatus error', e);
    }
  }, []);

  const requestTelemetry = useCallback(async (nodeId: number) => {
    const pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey || !connRef.current) return;
    console.debug('[useMeshCore] requestTelemetry nodeId=', nodeId.toString(16).toUpperCase());
    try {
      const raw = await connRef.current.getTelemetry(pubKey);
      const entries = CayenneLpp.parse(raw.lppSensorData) as CayenneLppEntry[];
      const result: MeshCoreNodeTelemetry = { fetchedAt: Date.now(), entries };
      for (const entry of entries) {
        if (entry.type === CayenneLpp.LPP_TEMPERATURE && typeof entry.value === 'number') {
          result.temperature = entry.value;
        } else if (
          entry.type === CayenneLpp.LPP_RELATIVE_HUMIDITY &&
          typeof entry.value === 'number'
        ) {
          result.relativeHumidity = entry.value;
        } else if (
          entry.type === CayenneLpp.LPP_BAROMETRIC_PRESSURE &&
          typeof entry.value === 'number'
        ) {
          result.barometricPressure = entry.value;
        } else if (entry.type === CayenneLpp.LPP_VOLTAGE && typeof entry.value === 'number') {
          result.voltage = entry.value;
        } else if (
          entry.type === CayenneLpp.LPP_GPS &&
          typeof entry.value === 'object' &&
          entry.value !== null
        ) {
          result.gps = entry.value as { latitude: number; longitude: number; altitude: number };
        }
      }
      setMeshcoreNodeTelemetry((prev) => {
        const next = new Map(prev);
        next.set(nodeId, result);
        return next;
      });
      const hasEnv =
        result.temperature != null ||
        result.relativeHumidity != null ||
        result.barometricPressure != null;
      if (hasEnv) {
        const pt: EnvironmentTelemetryPoint = {
          timestamp: result.fetchedAt,
          nodeNum: nodeId,
          temperature: result.temperature,
          relativeHumidity: result.relativeHumidity,
          barometricPressure: result.barometricPressure,
        };
        setEnvironmentTelemetry((prev) => [...prev, pt].slice(-MAX_ENV_TELEMETRY_POINTS));
      }
      console.debug('[useMeshCore] requestTelemetry result:', result);
    } catch (e) {
      console.warn('[useMeshCore] requestTelemetry error', e);
    }
  }, []);

  const requestNeighbors = useCallback(async (nodeId: number) => {
    const pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey || !connRef.current) return;
    console.debug('[useMeshCore] requestNeighbors nodeId=', nodeId.toString(16).toUpperCase());
    try {
      const raw = await connRef.current.getNeighbours(pubKey, 10, 0, 0, 6);
      const neighbours: MeshCoreNeighborEntry[] = raw.neighbours.map((nb) => {
        const prefixHex = Array.from(nb.publicKeyPrefix)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const resolvedNodeId = pubKeyPrefixMapRef.current.get(prefixHex) ?? 0;
        return {
          publicKeyPrefix: nb.publicKeyPrefix,
          prefixHex,
          resolvedNodeId,
          heardSecondsAgo: nb.heardSecondsAgo,
          snr: nb.snr,
        };
      });
      const result: MeshCoreNeighborResult = {
        totalNeighboursCount: raw.totalNeighboursCount,
        neighbours,
        fetchedAt: Date.now(),
      };
      setMeshcoreNeighbors((prev) => {
        const next = new Map(prev);
        next.set(nodeId, result);
        return next;
      });
      console.debug(
        '[useMeshCore] requestNeighbors result: total=',
        raw.totalNeighboursCount,
        'fetched=',
        neighbours.length,
      );
    } catch (e) {
      console.warn('[useMeshCore] requestNeighbors error', e);
    }
  }, []);

  const toggleManualAddContacts = useCallback(async (manual: boolean) => {
    if (!connRef.current) return;
    try {
      if (manual) {
        await connRef.current.setManualAddContacts();
      } else {
        await connRef.current.setAutoAddContacts();
      }
      setManualAddContacts(manual);
      try {
        localStorage.setItem(MANUAL_CONTACTS_KEY, String(manual));
      } catch {
        // catch-no-log-ok localStorage quota or private mode — non-critical setting
      }
    } catch (e) {
      console.warn('[useMeshCore] toggleManualAddContacts error', e);
    }
  }, []);

  const setMeshcoreChannel = useCallback(async (idx: number, name: string, secret: Uint8Array) => {
    if (!connRef.current) return;
    try {
      await connRef.current.setChannel(idx, name, secret);
      setChannels((prev) => {
        const next = prev.filter((c) => c.index !== idx);
        return [...next, { index: idx, name, secret }].sort((a, b) => a.index - b.index);
      });
    } catch (e) {
      console.warn('[useMeshCore] setMeshcoreChannel error', e);
    }
  }, []);

  const deleteMeshcoreChannel = useCallback(async (idx: number) => {
    if (!connRef.current) return;
    try {
      await connRef.current.deleteChannel(idx);
      setChannels((prev) => prev.filter((c) => c.index !== idx));
    } catch (e) {
      console.warn('[useMeshCore] deleteMeshcoreChannel error', e);
    }
  }, []);

  const importRepeaters = useCallback(async (): Promise<{
    imported: number;
    skipped: number;
    errors: string[];
  }> => {
    const raw = await window.electronAPI.meshcore.openJsonFile();
    if (raw == null) {
      console.debug('[useMeshCore] importRepeaters: file picker cancelled');
      return { imported: 0, skipped: 0, errors: [] };
    }
    console.debug('[useMeshCore] importRepeaters: file opened, length=', raw.length);

    let parsed: unknown[];
    try {
      const val = JSON.parse(raw) as unknown;
      // Accept root array or root object with any array-valued key (e.g. { repeaters: [...] })
      if (Array.isArray(val)) {
        parsed = val;
      } else if (val && typeof val === 'object') {
        const arrays = Object.values(val as Record<string, unknown>).filter(Array.isArray);
        if (arrays.length === 0) throw new Error('JSON contains no array of entries');
        parsed = arrays[0] as unknown[];
        console.debug(
          '[useMeshCore] importRepeaters: found array under object key, length=',
          parsed.length,
        );
      } else {
        throw new Error('JSON root must be an array or an object containing an array');
      }
    } catch (e) {
      console.warn('[useMeshCore] importRepeaters: parse error', e);
      return { imported: 0, skipped: 0, errors: [e instanceof Error ? e.message : String(e)] };
    }
    console.debug('[useMeshCore] importRepeaters: parsed', parsed.length, 'entries');

    function parsePublicKey(rawKey: string): Uint8Array | null {
      const s = rawKey.trim().replace(/-/g, '+').replace(/_/g, '/');
      if (/^[0-9a-fA-F]{64}$/.test(s)) {
        const bytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
        return bytes;
      }
      try {
        const decoded = atob(s);
        if (decoded.length === 32) return Uint8Array.from(decoded, (c) => c.charCodeAt(0));
      } catch {
        // catch-no-log-ok atob decode attempt failed — falls through to return null
      }
      return null;
    }

    let skipped = 0;
    const errors: string[] = [];
    const validEntries: {
      nodeId: number;
      name: string;
      pubKey: Uint8Array;
      latitude: number | null;
      longitude: number | null;
    }[] = [];

    for (const r of parsed) {
      if (!r || typeof r !== 'object') {
        console.debug('[useMeshCore] importRepeaters: skipping non-object entry', r);
        skipped++;
        continue;
      }
      const rec = r as Record<string, unknown>;
      const name = String(rec.name ?? rec.label ?? rec.title ?? rec.node_name ?? '').trim();
      const rawKey = String(rec.public_key ?? rec.pubkey ?? rec.key ?? rec.publicKey ?? '').trim();
      if (!name || !rawKey) {
        console.debug('[useMeshCore] importRepeaters: skipping entry missing name or key', rec);
        skipped++;
        continue;
      }
      const pubKey = parsePublicKey(rawKey);
      if (!pubKey) {
        console.warn('[useMeshCore] importRepeaters: invalid public key for', name, rawKey);
        errors.push(`Skipped "${name}": invalid public key`);
        skipped++;
        continue;
      }
      const nodeId = pubkeyToNodeId(pubKey);
      const parseCoord = (value: unknown): number | null => {
        if (value == null) return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      };
      const latitude = parseCoord(rec.latitude ?? rec.lat ?? rec.adv_lat ?? rec.advLat);
      const longitude = parseCoord(
        rec.longitude ?? rec.lon ?? rec.lng ?? rec.adv_lon ?? rec.advLon,
      );
      console.debug(
        '[useMeshCore] importRepeaters: valid entry',
        name,
        nodeId.toString(16).toUpperCase(),
      );
      nicknameMapRef.current.set(nodeId, name);
      pubKeyMapRef.current.set(nodeId, pubKey);
      validEntries.push({ nodeId, name, pubKey, latitude, longitude });
    }

    console.debug(
      '[useMeshCore] importRepeaters: imported=',
      validEntries.length,
      'skipped=',
      skipped,
      'errors=',
      errors.length,
    );

    if (validEntries.length > 0) {
      setNodes((prev) => {
        const next = new Map(prev);
        for (const { nodeId, name, pubKey, latitude, longitude } of validEntries) {
          const existing = next.get(nodeId);
          const hasImportGps = latitude != null && longitude != null;
          const existingHasGps = existing?.latitude != null && existing?.longitude != null;
          if (existing) {
            next.set(nodeId, {
              ...existing,
              long_name: name,
              short_name: name.slice(0, 4),
              latitude: hasImportGps && !existingHasGps ? latitude : existing.latitude,
              longitude: hasImportGps && !existingHasGps ? longitude : existing.longitude,
            });
          } else {
            // Create a stub node for pre-loaded repeaters
            const prefix = Array.from(pubKey.slice(0, 6))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
            pubKeyPrefixMapRef.current.set(prefix, nodeId);
            next.set(nodeId, {
              node_id: nodeId,
              long_name: name,
              short_name: name.slice(0, 4),
              hw_model: 'Repeater',
              battery: 0,
              snr: 0,
              rssi: 0,
              last_heard: 0,
              latitude: hasImportGps ? latitude : null,
              longitude: hasImportGps ? longitude : null,
              favorited: false,
            });
          }
        }
        return next;
      });

      for (const { nodeId, name, pubKey, latitude, longitude } of validEntries) {
        const publicKeyHex = Array.from(pubKey)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const hasImportGps = latitude != null && longitude != null;
        void window.electronAPI.db
          .saveMeshcoreContact({
            node_id: nodeId,
            public_key: publicKeyHex,
            adv_name: null,
            contact_type: 2, // Repeater
            last_advert: null,
            adv_lat: hasImportGps ? latitude : null,
            adv_lon: hasImportGps ? longitude : null,
            last_snr: null,
            last_rssi: null,
            nickname: name,
          })
          .catch((e: unknown) =>
            console.warn('[useMeshCore] saveMeshcoreContact (import repeaters) error', e),
          );
      }
    }

    return { imported: validEntries.length, skipped, errors };
  }, []);

  const setNodeFavorited = useCallback(async (nodeId: number, favorited: boolean) => {
    const node = nodesRef.current.get(nodeId);
    if (!node) return;
    const prevFav = node.favorited;
    const pk = pubKeyMapRef.current.get(nodeId);
    const hex =
      pk != null
        ? Array.from(pk)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')
        : null;
    setNodes((prev) => {
      const n = prev.get(nodeId);
      if (!n) return prev;
      const next = new Map(prev);
      next.set(nodeId, { ...n, favorited });
      return next;
    });
    try {
      await window.electronAPI.db.updateMeshcoreContactFavorited(nodeId, favorited, hex);
    } catch (e) {
      console.warn('[useMeshCore] updateMeshcoreContactFavorited error', e);
      setNodes((prev) => {
        const n = prev.get(nodeId);
        if (!n) return prev;
        const next = new Map(prev);
        next.set(nodeId, { ...n, favorited: prevFav });
        return next;
      });
    }
  }, []);

  const sendReaction = useCallback(
    async (emoji: number, replyId: number, channel: number) => {
      if (!connRef.current) return;
      const reactedTo = messagesRef.current.find(
        (m) => m.packetId === replyId || m.timestamp === replyId,
      );
      const targetName = reactedTo?.sender_name || 'Unknown';
      const emojiChar = String.fromCodePoint(emoji);
      const tapbackText = `@[${targetName}] ${emojiChar}`;
      await connRef.current.sendChannelTextMessage(channel, tapbackText);
      addMessage({
        sender_id: myNodeNumRef.current,
        sender_name: selfInfo?.name ?? 'Me',
        payload: emojiChar,
        channel,
        timestamp: Date.now(),
        status: 'acked',
        emoji,
        replyId,
      });
    },
    [addMessage, selfInfo?.name],
  );

  // No-op stubs to satisfy the same interface shape used in App.tsx
  const noopAsync = useCallback(async () => {}, []);
  const noopVoid = useCallback(() => {}, []);
  const refreshOurPositionNoop = useCallback(async () => {
    const myNode = nodesRef.current.get(myNodeNumRef.current);
    let staticLat: number | undefined;
    let staticLon: number | undefined;
    try {
      const s = JSON.parse(localStorage.getItem('mesh-client:gpsSettings') || '{}') as {
        staticLat?: number;
        staticLon?: number;
      };
      if (typeof s.staticLat === 'number' && typeof s.staticLon === 'number') {
        staticLat = s.staticLat;
        staticLon = s.staticLon;
      }
    } catch {
      // catch-no-log-ok localStorage read for GPS settings — ignore parse errors
    }
    const pos = await resolveOurPosition(myNode?.latitude, myNode?.longitude, staticLat, staticLon);
    setOurPosition(pos);
    useDiagnosticsStore.getState().setOurPositionSource(pos?.source ?? null);
    return pos;
  }, []);

  return {
    state,
    nodes,
    messages,
    channels,
    selfInfo,
    connect,
    disconnect,
    sendMessage,
    sendAdvert,
    syncClock,
    refreshContacts,
    reboot,
    deleteNode,
    clearAllRepeaters,
    setOwner,
    traceRoute,
    requestRepeaterStatus,
    requestTelemetry,
    requestNeighbors,
    importRepeaters,
    toggleManualAddContacts,
    setMeshcoreChannel,
    deleteMeshcoreChannel,
    deviceLogs,
    meshcoreTraceResults,
    meshcoreNodeStatus,
    meshcoreNodeTelemetry,
    meshcoreNeighbors,
    manualAddContacts,
    // Stubs for interface compatibility
    mqttStatus,
    selfNodeId: state.myNodeNum,
    getNodes: useCallback(() => nodes, [nodes]),
    getFullNodeLabel: useCallback(
      (id: number) => nodes.get(id)?.long_name ?? id.toString(16).toUpperCase(),
      [nodes],
    ),
    getPickerStyleNodeLabel: useCallback(
      (id: number) => nodes.get(id)?.long_name ?? id.toString(16).toUpperCase(),
      [nodes],
    ),
    traceRouteResults: new Map<number, { route: number[]; from: number }>(),
    queueStatus: null,
    neighborInfo: new Map<number, unknown>(),
    waypoints: [] as unknown[],
    telemetry,
    signalTelemetry,
    environmentTelemetry,
    channelConfigs: [] as unknown[],
    moduleConfigs: {} as Record<string, unknown>,
    deviceOwner: selfInfo ? { longName: selfInfo.name, shortName: '', isLicensed: false } : null,
    ourPosition,
    gpsLoading: false,
    telemetryEnabled: null,
    sendReaction,
    requestPosition: noopAsync,
    setNodeFavorited,
    shutdown: noopAsync,
    factoryReset: noopAsync,
    resetNodeDb: noopAsync,
    commitConfig: noopAsync,
    setConfig: noopAsync,
    setDeviceChannel: noopAsync,
    clearChannel: noopAsync,
    rebootOta: noopAsync,
    enterDfuMode: noopAsync,
    factoryResetConfig: noopAsync,
    sendWaypoint: noopAsync,
    deleteWaypoint: noopAsync,
    setModuleConfig: noopAsync,
    setCannedMessages: noopAsync,
    requestRefresh: noopAsync,
    refreshOurPosition: refreshOurPositionNoop,
    sendPositionToDevice: sendPositionToDeviceMeshCore,
    updateGpsInterval: noopVoid,
    refreshNodesFromDb: useCallback(async () => {
      try {
        const dbContacts = (await window.electronAPI.db.getMeshcoreContacts()) as {
          node_id: number;
          adv_name: string | null;
          contact_type: number;
          last_advert: number | null;
          adv_lat: number | null;
          adv_lon: number | null;
          last_snr: number | null;
          last_rssi: number | null;
          favorited: number;
        }[];
        setNodes((prev) => {
          const next = new Map(prev);
          for (const row of dbContacts) {
            if (!next.has(row.node_id)) {
              next.set(row.node_id, {
                node_id: row.node_id,
                long_name: row.adv_name ?? `Node-${row.node_id.toString(16).toUpperCase()}`,
                short_name: '',
                hw_model: CONTACT_TYPE_LABELS[row.contact_type] ?? 'Unknown',
                battery: 0,
                snr: row.last_snr ?? 0,
                rssi: row.last_rssi ?? 0,
                last_heard: row.last_advert ?? 0,
                latitude: row.adv_lat ?? null,
                longitude: row.adv_lon ?? null,
                favorited: row.favorited === 1,
              });
            }
          }
          return next;
        });
      } catch (e) {
        console.warn('[useMeshCore] refreshNodesFromDb error', e);
      }
    }, []),
    refreshMessagesFromDb: useCallback(async () => {
      try {
        const dbMsgs = (await window.electronAPI.db.getMeshcoreMessages(
          undefined,
          500,
        )) as MeshcoreMessageDbRow[];
        const mapped = mapMeshcoreDbRowsToChatMessages(dbMsgs);
        setNodes((prev) => mergeStubNodesFromMeshcoreMessages(prev, mapped));
        setMessages((prev) => mergeMeshcoreDbHydrationWithLive(prev, mapped));
      } catch (e) {
        console.warn('[useMeshCore] refreshMessagesFromDb error', e);
      }
    }, []),
    connectAutomatic,
    telemetryDeviceUpdateInterval: undefined as number | undefined,
    setRadioParams,
  };
}
