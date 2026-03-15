import {
  CayenneLpp,
  SerialConnection,
  WebBleConnection,
  WebSerialConnection,
} from '@liamcottle/meshcore.js';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  CONTACT_TYPE_LABELS,
  meshcoreContactToMeshNode,
  pubkeyToNodeId,
} from '../lib/meshcoreUtils';
import type { ChatMessage, DeviceState, MeshNode, TelemetryPoint } from '../lib/types';
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
    adv_lat: contact.advLat !== 0 ? contact.advLat / 1e7 : null,
    adv_lon: contact.advLon !== 0 ? contact.advLon / 1e7 : null,
    nickname: nickname ?? null,
  };
}

function messageToDbRow(
  msg: ChatMessage,
): Parameters<typeof window.electronAPI.db.saveMeshcoreMessage>[0] {
  return {
    sender_id: msg.sender_id !== 0 ? msg.sender_id : null,
    sender_name: msg.sender_name ?? null,
    payload: msg.payload,
    channel_idx: msg.channel,
    timestamp: msg.timestamp,
    status: msg.status ?? 'acked',
    packet_id: msg.packetId ?? null,
    to_node: msg.to ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface SerialConnectionInstance extends InstanceType<typeof SerialConnection> {}

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
          }
        }
        async close() {
          await window.electronAPI.meshcore.tcp.disconnect();
        }
      }

      const instance = new TcpOverIpc() as unknown as SerialConnectionInstance;
      this.inner = instance;

      const offData = window.electronAPI.meshcore.tcp.onData((bytes) => {
        void instance.onDataReceived(new Uint8Array(bytes));
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

interface DeviceLogEntry {
  ts: number;
  level: string;
  source: string;
  message: string;
}

const LAST_SERIAL_PORT_KEY = 'mesh-client:lastSerialPort';
const MANUAL_CONTACTS_KEY = 'mesh-client:meshcoreManualContacts';

const INITIAL_STATE: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  connectionType: null,
};

const MAX_DEVICE_LOGS = 500;
const MAX_TELEMETRY_POINTS = 50;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export function useMeshCore() {
  const [state, setState] = useState<DeviceState>(INITIAL_STATE);
  const [nodes, setNodes] = useState<Map<number, MeshNode>>(new Map());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [channels, setChannels] = useState<{ index: number; name: string; secret: Uint8Array }[]>(
    [],
  );
  const [selfInfo, setSelfInfo] = useState<MeshCoreSelfInfo | null>(null);
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
      return false;
    }
  });

  const connRef = useRef<MeshCoreConnection | null>(null);
  const ipcTcpRef = useRef<IpcTcpConnection | null>(null);
  // Map pubKeyPrefix (6-byte hex) → nodeId for DM routing
  const pubKeyPrefixMapRef = useRef<Map<string, number>>(new Map());
  // Full pubKey → nodeId for sending
  const pubKeyMapRef = useRef<Map<number, Uint8Array>>(new Map());
  // nodeId → nickname (from JSON import or DB)
  const nicknameMapRef = useRef<Map<number, string>>(new Map());
  // Stable ref to current nodes so event listeners don't form stale closures
  const nodesRef = useRef<Map<number, MeshNode>>(new Map());
  // Pending ACK tracking: packetId → { nodeId, timeoutId }
  const pendingAcksRef = useRef<Map<number, { timeoutId: ReturnType<typeof setTimeout> }>>(
    new Map(),
  );

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // Record a battery telemetry point whenever selfInfo battery data arrives/changes
  useEffect(() => {
    if (selfInfo?.batteryMilliVolts == null) return;
    const voltage = selfInfo.batteryMilliVolts / 1000;
    const point: TelemetryPoint = { timestamp: Date.now(), voltage };
    setTelemetry((prev) => [...prev, point].slice(-MAX_TELEMETRY_POINTS));
  }, [selfInfo?.batteryMilliVolts]);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
    void window.electronAPI.db.saveMeshcoreMessage(messageToDbRow(msg)).catch((e: unknown) => {
      console.warn('[useMeshCore] saveMeshcoreMessage error', e);
    });
  }, []);

  const updateNode = useCallback((node: MeshNode) => {
    setNodes((prev) => {
      const next = new Map(prev);
      next.set(node.node_id, node);
      return next;
    });
  }, []);

  const setupEventListeners = useCallback(
    (conn: MeshCoreConnection) => {
      // Push: periodic advert — event 0x80 = 128
      conn.on(128, (data: unknown) => {
        const d = data as {
          publicKey: Uint8Array;
          advLat: number;
          advLon: number;
          lastAdvert: number;
        };
        const nodeId = pubkeyToNodeId(d.publicKey);
        console.log('[useMeshCore] event 128: advert from', nodeId.toString(16).toUpperCase());
        setNodes((prev) => {
          const existing = prev.get(nodeId);
          if (!existing) return prev;
          const nick = nicknameMapRef.current.get(nodeId);
          const next = new Map(prev);
          next.set(nodeId, {
            ...existing,
            last_heard: d.lastAdvert,
            latitude: d.advLat !== 0 ? d.advLat / 1e7 : existing.latitude,
            longitude: d.advLon !== 0 ? d.advLon / 1e7 : existing.longitude,
            ...(nick ? { long_name: nick, short_name: nick.slice(0, 4) } : {}),
          });
          return next;
        });
        if (d.advLat !== 0 && d.advLon !== 0) {
          usePositionHistoryStore.getState().recordPosition(nodeId, d.advLat / 1e7, d.advLon / 1e7);
        }
        // Persist updated advert position to DB
        void window.electronAPI.db
          .updateMeshcoreContactAdvert(
            nodeId,
            d.lastAdvert ?? null,
            d.advLat !== 0 ? d.advLat / 1e7 : null,
            d.advLon !== 0 ? d.advLon / 1e7 : null,
          )
          .catch((e: unknown) => {
            console.warn('[useMeshCore] updateMeshcoreContactAdvert error', e);
          });
      });

      // Push: path updated — event 0x81 = 129; update last_heard for that contact
      conn.on(129, (data: unknown) => {
        const d = data as { publicKey: Uint8Array };
        const nodeId = pubkeyToNodeId(d.publicKey);
        console.log('[useMeshCore] event 129: path update', nodeId.toString(16).toUpperCase());
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
        console.log(
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
                addMessage({
                  sender_id: senderId,
                  sender_name: sender?.long_name ?? `Node-${senderId.toString(16).toUpperCase()}`,
                  payload: d.text,
                  channel: -1,
                  timestamp: d.senderTimestamp * 1000,
                  status: 'acked',
                  isHistory: true,
                });
              }
              if (m.channelMessage) {
                const d = m.channelMessage;
                addMessage({
                  sender_id: 0,
                  sender_name: 'Unknown',
                  payload: d.text,
                  channel: d.channelIdx,
                  timestamp: d.senderTimestamp * 1000,
                  status: 'acked',
                  isHistory: true,
                });
              }
            }
            console.log(
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
        console.log('[useMeshCore] event 7: DM from', senderId.toString(16).toUpperCase());
        addMessage({
          sender_id: senderId,
          sender_name: sender?.long_name ?? `Node-${senderId.toString(16).toUpperCase()}`,
          payload: d.text,
          channel: -1, // DM channel sentinel
          timestamp: d.senderTimestamp * 1000,
          status: 'acked',
        });
      });

      // Incoming channel message — event 8
      conn.on(8, (data: unknown) => {
        const d = data as { channelIdx: number; text: string; senderTimestamp: number };
        console.log('[useMeshCore] event 8: channel msg idx=', d.channelIdx);
        addMessage({
          sender_id: 0, // unknown sender in channel mode
          sender_name: 'Unknown',
          payload: d.text,
          channel: d.channelIdx,
          timestamp: d.senderTimestamp * 1000,
          status: 'acked',
        });
      });

      // Push: RF packet received — event 0x88 = 136; feed into device logs + signal telemetry
      conn.on(136, (data: unknown) => {
        const d = data as { lastSnr?: number; lastRssi?: number; raw?: unknown };
        const snr = d.lastSnr ?? 0;
        const rssi = d.lastRssi ?? 0;
        const now = Date.now();
        const entry: DeviceLogEntry = {
          ts: now,
          level: 'info',
          source: 'device',
          message: `RX SNR=${snr.toFixed(2)}dB RSSI=${rssi}dBm`,
        };
        setDeviceLogs((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_DEVICE_LOGS ? next.slice(next.length - MAX_DEVICE_LOGS) : next;
        });
        const sigPoint: TelemetryPoint = { timestamp: now, snr, rssi };
        setSignalTelemetry((prev) => [...prev, sigPoint].slice(-MAX_TELEMETRY_POINTS));
      });

      conn.on('disconnected', () => {
        setState((prev) => ({ ...prev, status: 'disconnected' }));
      });
    },
    [addMessage, updateNode],
  );

  /** Shared post-connection handshake: wire events, fetch self info, contacts, channels. */
  const initConn = useCallback(
    async (conn: MeshCoreConnection) => {
      connRef.current = conn;
      setupEventListeners(conn);

      // Load persisted messages from DB before device's MsgWaiting fires
      try {
        const dbMsgs = (await window.electronAPI.db.getMeshcoreMessages(undefined, 500)) as {
          id: number;
          sender_id: number | null;
          sender_name: string | null;
          payload: string;
          channel_idx: number;
          timestamp: number;
          status: string;
          packet_id: number | null;
          to_node: number | null;
        }[];
        if (dbMsgs.length > 0) {
          const mapped: ChatMessage[] = dbMsgs.map((r) => ({
            sender_id: r.sender_id ?? 0,
            sender_name: r.sender_name ?? 'Unknown',
            payload: r.payload,
            channel: r.channel_idx,
            timestamp: r.timestamp,
            status: (r.status as ChatMessage['status']) ?? 'acked',
            packetId: r.packet_id ?? undefined,
            to: r.to_node ?? undefined,
            isHistory: true,
          }));
          setMessages(mapped);
          console.log('[useMeshCore] initConn: loaded', mapped.length, 'messages from DB');
        }
      } catch (e) {
        console.warn('[useMeshCore] loadMessagesFromDb error', e);
      }

      // Fetch self info, contacts, channels (sequential — device handles one request at a time)
      const info = await conn.getSelfInfo(5000);
      console.log(
        `[useMeshCore] selfInfo: radioFreq=${info.radioFreq} radioBw=${info.radioBw} radioSf=${info.radioSf} radioCr=${info.radioCr} txPower=${info.txPower}`,
      );
      setSelfInfo(info);
      setState((prev) => ({ ...prev, status: 'connected' }));

      const myNodeId = pubkeyToNodeId(info.publicKey);
      setState((prev) => ({ ...prev, myNodeNum: myNodeId, status: 'configured' }));

      const contacts = await withTimeout(conn.getContacts(), 10_000, 'getContacts');
      const newNodes = new Map<number, MeshNode>();
      for (const contact of contacts) {
        const node = meshcoreContactToMeshNode(contact);
        newNodes.set(node.node_id, node);
        pubKeyMapRef.current.set(node.node_id, contact.publicKey);
        const prefix = Array.from(contact.publicKey.slice(0, 6))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        pubKeyPrefixMapRef.current.set(prefix, node.node_id);
        void window.electronAPI.db.saveMeshcoreContact(contactToDbRow(contact)).catch((e) => {
          console.warn('[useMeshCore] saveMeshcoreContact (init) error', e);
        });
      }

      // Seed contacts from DB for any nodes not returned by device (cache fallback)
      try {
        const dbContacts = (await window.electronAPI.db.getMeshcoreContacts()) as {
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
        for (const row of dbContacts) {
          if (!newNodes.has(row.node_id)) {
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
            newNodes.set(row.node_id, node);
          }
        }
        // Seed nicknameMapRef from DB + apply to nodes
        for (const row of dbContacts) {
          if (row.nickname) nicknameMapRef.current.set(row.node_id, row.nickname);
        }
        for (const [nodeId, node] of newNodes) {
          const nick = nicknameMapRef.current.get(nodeId);
          if (nick)
            newNodes.set(nodeId, { ...node, long_name: nick, short_name: nick.slice(0, 4) });
        }
      } catch (e) {
        console.warn('[useMeshCore] loadContactsFromDb error', e);
      }

      setNodes(newNodes);
      console.log('[useMeshCore] initConn: contacts loaded, device=', contacts.length);

      const rawChannels = await withTimeout(conn.getChannels(), 10_000, 'getChannels');
      setChannels(
        rawChannels.map((c) => ({ index: c.channelIdx, name: c.name, secret: c.secret })),
      );
      console.log('[useMeshCore] initConn: channels=', rawChannels.length);

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
    [setupEventListeners],
  );

  const connect = useCallback(
    async (type: 'ble' | 'serial' | 'tcp', tcpHost?: string) => {
      setState({
        status: 'connecting',
        myNodeNum: 0,
        connectionType: type === 'tcp' ? 'http' : type,
      });

      try {
        let conn: MeshCoreConnection;

        if (type === 'ble') {
          console.log('[useMeshCore] connect: BLE opening...');
          conn = (await (
            WebBleConnection as unknown as { open(): Promise<unknown> }
          ).open()) as MeshCoreConnection;
          // WebBleConnection.open() returns before init() finishes — init() calls
          // gatt.connect() + startNotifications() async in the constructor without
          // awaiting.  'connected' is emitted at the end of init() via onConnected().
          // We must wait for it before sending any commands or rxCharacteristic is null.
          //
          // Two failure modes we guard against:
          // 1. init() throws before onConnected() (no try/catch in the lib) → unhandledrejection
          // 2. deviceQuery() inside onConnected() hangs because the device never responds
          //    (BLE write can silently fail with "GATT operation already in progress").
          //    onConnected() catches deviceQuery errors and emits 'connected' regardless,
          //    so we unblock it by emitting ResponseCodes.Err (1) after a nudge timeout.
          await new Promise<void>((resolve, reject) => {
            const NUDGE_MS = 10_000; // emit Err to unblock hanging deviceQuery
            const TIMEOUT_MS = 20_000; // hard timeout after nudge attempt

            interface EventSource {
              once(event: string, fn: () => void): void;
              emit(event: string | number, ...args: unknown[]): void;
            }

            const cleanup = () => {
              clearTimeout(nudge);
              clearTimeout(timeout);
              window.removeEventListener('unhandledrejection', onUnhandledRejection);
            };

            // Catch errors thrown inside init() (no try/catch in WebBleConnection.init())
            const onUnhandledRejection = (event: PromiseRejectionEvent) => {
              cleanup();
              reject(event.reason ?? new Error('BLE init failed'));
            };
            window.addEventListener('unhandledrejection', onUnhandledRejection, { once: true });

            // If deviceQuery hangs (device doesn't respond), nudge it by emitting Err.
            // onConnected() wraps deviceQuery in try/catch and ignores errors, so it will
            // proceed to emit 'connected' after we force-reject the deviceQuery promise.
            const nudge = setTimeout(() => {
              console.warn('[useMeshCore] BLE deviceQuery appears stuck — nudging with Err event');
              (conn as unknown as EventSource).emit(1 /* ResponseCodes.Err */);
            }, NUDGE_MS);

            const timeout = setTimeout(() => {
              cleanup();
              reject(new Error('BLE GATT init timed out'));
            }, TIMEOUT_MS);

            (conn as unknown as EventSource).once('connected', () => {
              cleanup();
              resolve();
            });
            (conn as unknown as EventSource).once('disconnected', () => {
              cleanup();
              reject(new Error('BLE disconnected during GATT init'));
            });
          });
        } else if (type === 'serial') {
          console.log('[useMeshCore] connect: serial requesting port...');
          if (!navigator.serial?.requestPort) throw new Error('Web Serial API not available');
          const port = await navigator.serial.requestPort();
          await (port as any).open({ baudRate: 115200 });
          const portId = (port as any).portId as string | undefined;
          if (portId) {
            try {
              localStorage.setItem(LAST_SERIAL_PORT_KEY, portId);
            } catch {
              /* ignore */
            }
          }
          conn = new (WebSerialConnection as unknown as new (port: unknown) => MeshCoreConnection)(
            port,
          );
        } else {
          // tcp
          const host = tcpHost ?? 'localhost';
          console.log('[useMeshCore] connect: TCP to', host);
          const tcpConn = new IpcTcpConnection(host, 4403);
          ipcTcpRef.current = tcpConn;
          await tcpConn.connect();
          conn = tcpConn.connection as unknown as MeshCoreConnection;
        }

        await initConn(conn);
        console.log('[useMeshCore] connect: handshake complete, type=', type);
      } catch (err) {
        console.error('[useMeshCore] connect error', err);
        setState({ status: 'disconnected', myNodeNum: 0, connectionType: null });
        ipcTcpRef.current?.cleanup();
        ipcTcpRef.current = null;
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
          if (ports.length === 0) throw new Error('No previously granted serial ports found');
          let port: SerialPort | undefined;
          if (lastSerialPortId) {
            port = (ports as any[]).find((p: any) => p.portId === lastSerialPortId);
          }
          port = port ?? ports[0];
          const portId = (port as any).portId as string | undefined;
          if (portId) {
            try {
              localStorage.setItem(LAST_SERIAL_PORT_KEY, portId);
            } catch {
              /* ignore */
            }
          }
          await (port as any).open({ baudRate: 115200 });
          const conn = new (WebSerialConnection as unknown as new (
            port: unknown,
          ) => MeshCoreConnection)(port);
          await initConn(conn);
          console.log('[useMeshCore] connectAutomatic serial: connected');
        } catch (err) {
          console.error('[useMeshCore] connectAutomatic serial error', err);
          setState({ status: 'disconnected', myNodeNum: 0, connectionType: null });
          throw err;
        }
      } else if (type === 'http') {
        await connect('tcp', httpAddress);
      }
      // BLE: requires user gesture — not supported for auto-connect
    },
    [initConn, connect],
  );

  const disconnect = useCallback(async () => {
    console.log('[useMeshCore] disconnect');
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
    setState(INITIAL_STATE);
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
          sender_id: 0, // placeholder, replaced after we get the ackCrc
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
                  ? { ...m, sender_id: 0, packetId: ackCrc }
                  : m,
              ),
            );
            // Persist the outgoing DM with packet_id for status tracking
            void window.electronAPI.db
              .saveMeshcoreMessage({
                sender_id: null,
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
                  ? { ...m, sender_id: 0, status: 'acked' as const }
                  : m,
              ),
            );
            void window.electronAPI.db
              .saveMeshcoreMessage({
                sender_id: null,
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
        try {
          await connRef.current.sendChannelTextMessage(channelIdx, text);
          // Channel messages resolve with Ok — add as acked immediately
          addMessage({
            sender_id: 0,
            sender_name: selfInfo?.name ?? 'Me',
            payload: text,
            channel: channelIdx,
            timestamp: Date.now(),
            status: 'acked',
          });
        } catch (e) {
          console.warn('[useMeshCore] sendChannelTextMessage error', e);
        }
      }
    },
    [addMessage, selfInfo],
  );

  const refreshContacts = useCallback(async () => {
    if (!connRef.current) return;
    try {
      const contacts = await connRef.current.getContacts();
      const newNodes = new Map<number, MeshNode>();
      pubKeyMapRef.current.clear();
      pubKeyPrefixMapRef.current.clear();
      for (const contact of contacts) {
        const node = meshcoreContactToMeshNode(contact);
        newNodes.set(node.node_id, node);
        pubKeyMapRef.current.set(node.node_id, contact.publicKey);
        const prefix = Array.from(contact.publicKey.slice(0, 6))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        pubKeyPrefixMapRef.current.set(prefix, node.node_id);
      }
      setNodes(newNodes);
      console.log('[useMeshCore] refreshContacts: loaded', contacts.length);
    } catch (e) {
      console.error('[useMeshCore] refreshContacts error', e);
    }
  }, []);

  const sendAdvert = useCallback(async () => {
    if (!connRef.current) return;
    console.log('[useMeshCore] sendAdvert');
    await connRef.current.sendFloodAdvert();
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
    console.log('[useMeshCore] deleteNode:', nodeId.toString(16).toUpperCase());
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

  const setOwner = useCallback(
    async (owner: { longName: string; shortName: string; isLicensed: boolean }) => {
      console.log(
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
        console.log('[useMeshCore] setAdvertName succeeded');
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
      console.log(
        `[useMeshCore] setRadioParams called, connRef=${!!connRef.current} freq=${p.freq} bw=${p.bw} sf=${p.sf} cr=${p.cr} txPower=${p.txPower}`,
      );
      if (!connRef.current) {
        console.warn('[useMeshCore] setRadioParams: connRef.current is null, aborting');
        return;
      }
      try {
        await connRef.current.setRadioParams(p.freq, p.bw, p.sf, p.cr);
        console.log('[useMeshCore] setRadioParams succeeded');
      } catch (e) {
        console.error('[useMeshCore] setRadioParams threw:', e);
        throw e;
      }
      try {
        await connRef.current.setTxPower(p.txPower);
        console.log('[useMeshCore] setTxPower succeeded');
      } catch (e) {
        console.error('[useMeshCore] setTxPower threw:', e);
        throw e;
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

  const sendPositionToDeviceMeshCore = useCallback(async (lat: number, lon: number) => {
    if (!connRef.current) return;
    const latInt = Math.round(lat * 1e7);
    const lonInt = Math.round(lon * 1e7);
    try {
      await connRef.current.setAdvertLatLong(latInt, lonInt);
    } catch (e) {
      console.error('[useMeshCore] setAdvertLatLong failed', { lat, lon, latInt, lonInt }, e);
      throw new Error(
        'Device rejected position update — check that the device supports setting coordinates',
      );
    }
  }, []);

  const traceRoute = useCallback(async (nodeId: number) => {
    const pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey || !connRef.current) return;
    console.log('[useMeshCore] traceRoute nodeId=', nodeId.toString(16).toUpperCase());
    try {
      const result = await connRef.current.tracePath([pubKey]);
      // pathSnrs are signed bytes in 0.25dB units
      const hops = result.pathSnrs.map((raw) => {
        const signed = raw > 127 ? raw - 256 : raw;
        return { snr: signed * 0.25 };
      });
      setMeshcoreTraceResults((prev) => {
        const next = new Map(prev);
        next.set(nodeId, { hops, lastSnr: result.lastSnr * 0.25 });
        return next;
      });
      useRepeaterSignalStore.getState().recordSignal(nodeId, result.lastSnr * 0.25);
      console.log(
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
    console.log('[useMeshCore] requestRepeaterStatus nodeId=', nodeId.toString(16).toUpperCase());
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
    console.log('[useMeshCore] requestTelemetry nodeId=', nodeId.toString(16).toUpperCase());
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
      console.log('[useMeshCore] requestTelemetry result:', result);
    } catch (e) {
      console.warn('[useMeshCore] requestTelemetry error', e);
    }
  }, []);

  const requestNeighbors = useCallback(async (nodeId: number) => {
    const pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey || !connRef.current) return;
    console.log('[useMeshCore] requestNeighbors nodeId=', nodeId.toString(16).toUpperCase());
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
      console.log(
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
        /* ignore */
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
      console.log('[useMeshCore] importRepeaters: file picker cancelled');
      return { imported: 0, skipped: 0, errors: [] };
    }
    console.log('[useMeshCore] importRepeaters: file opened, length=', raw.length);

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
        console.log(
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
    console.log('[useMeshCore] importRepeaters: parsed', parsed.length, 'entries');

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
        /* fall through */
      }
      return null;
    }

    let skipped = 0;
    const errors: string[] = [];
    const validEntries: { nodeId: number; name: string; pubKey: Uint8Array }[] = [];

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
      console.log(
        '[useMeshCore] importRepeaters: valid entry',
        name,
        nodeId.toString(16).toUpperCase(),
      );
      nicknameMapRef.current.set(nodeId, name);
      pubKeyMapRef.current.set(nodeId, pubKey);
      validEntries.push({ nodeId, name, pubKey });
    }

    console.log(
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
        for (const { nodeId, name, pubKey } of validEntries) {
          const existing = next.get(nodeId);
          if (existing) {
            next.set(nodeId, { ...existing, long_name: name, short_name: name.slice(0, 4) });
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
              latitude: null,
              longitude: null,
              favorited: false,
            });
          }
        }
        return next;
      });

      for (const { nodeId, name } of validEntries) {
        void window.electronAPI.db
          .updateMeshcoreContactNickname(nodeId, name)
          .catch((e: unknown) =>
            console.warn('[useMeshCore] updateMeshcoreContactNickname error', e),
          );
      }
    }

    return { imported: validEntries.length, skipped, errors };
  }, []);

  // No-op stubs to satisfy the same interface shape used in App.tsx
  const noopAsync = useCallback(async () => {}, []);
  const noopVoid = useCallback(() => {}, []);

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
    refreshContacts,
    reboot,
    deleteNode,
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
    mqttStatus: 'disconnected' as const,
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
    environmentTelemetry: [] as unknown[],
    channelConfigs: [] as unknown[],
    moduleConfigs: {} as Record<string, unknown>,
    deviceOwner: selfInfo ? { longName: selfInfo.name, shortName: '', isLicensed: false } : null,
    ourPosition: null,
    gpsLoading: false,
    telemetryEnabled: null,
    sendReaction: noopAsync,
    requestPosition: noopAsync,
    setNodeFavorited: noopAsync,
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
    refreshOurPosition: noopAsync,
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
        const dbMsgs = (await window.electronAPI.db.getMeshcoreMessages(undefined, 500)) as {
          sender_id: number | null;
          sender_name: string | null;
          payload: string;
          channel_idx: number;
          timestamp: number;
          status: string;
          packet_id: number | null;
          to_node: number | null;
        }[];
        setMessages(
          dbMsgs.map((r) => ({
            sender_id: r.sender_id ?? 0,
            sender_name: r.sender_name ?? 'Unknown',
            payload: r.payload,
            channel: r.channel_idx,
            timestamp: r.timestamp,
            status: (r.status as ChatMessage['status']) ?? 'acked',
            packetId: r.packet_id ?? undefined,
            to: r.to_node ?? undefined,
            isHistory: true,
          })),
        );
      } catch (e) {
        console.warn('[useMeshCore] refreshMessagesFromDb error', e);
      }
    }, []),
    connectAutomatic,
    telemetryDeviceUpdateInterval: undefined as number | undefined,
    setRadioParams,
  };
}
