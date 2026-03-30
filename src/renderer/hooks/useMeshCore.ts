import {
  CayenneLpp,
  Connection,
  SerialConnection,
  WebSerialConnection,
} from '@liamcottle/meshcore.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { sanitizeLogMessage } from '@/main/sanitize-log-message';

import { withTimeout } from '../../shared/withTimeout';
import {
  classifyMeshcoreBleTimeoutStage,
  isMeshcoreRetryableBleErrorMessage,
  MESHCORE_SETUP_ABORT_MESSAGE,
} from '../lib/bleConnectErrors';
import { classifyPayload, extractMeshtasticSenderId } from '../lib/foreignLoraDetection';
import type { OurPosition } from '../lib/gpsSource';
import { resolveOurPosition } from '../lib/gpsSource';
import { isLetsMeshSettings } from '../lib/letsMeshJwt';
import {
  buildMeshcoreChannelIncomingMessage,
  buildMeshcoreDmIncomingMessage,
  findMeshcoreDmReplyParent,
  normalizeMeshcoreIncomingText,
} from '../lib/meshcoreChannelText';
import {
  buildGetAutoaddConfigFrame,
  buildSetAutoaddConfigFrame,
  mergeAutoaddConfigByte,
  type MeshcoreAutoaddWireState,
  meshcoreCoerceRadioRxFrame,
  parseAutoaddConfigResponse,
} from '../lib/meshcoreContactAutoAdd';
import { readMeshcoreMqttSettingsFromStorage } from '../lib/meshcoreMqttSettingsStorage';
import { meshcoreRepeaterTryLogin } from '../lib/meshcoreRepeaterSession';
import {
  buildMeshcoreSetOtherParamsFrame,
  enrichMeshCoreSelfInfo,
  type MeshCoreSelfInfoEnriched,
  type MeshCoreSelfInfoWire,
  packMeshcoreTelemetryModesByte,
} from '../lib/meshcoreTelemetryPrivacy';
import {
  CONTACT_TYPE_LABELS,
  isMeshcoreTransportStatusChatLine,
  mergeMeshcoreChatStubNodes,
  MESHCORE_RPC_SNR_RAW_TO_DB,
  meshcoreAppendRepeaterAuthHint,
  meshcoreChatStubNodeIdFromDisplayName,
  meshcoreConnectionImpliesUsbPower,
  meshcoreContactToMeshNode,
  meshcoreIsChatStubNodeId,
  meshcoreIsSyntheticPlaceholderPubKeyHex,
  meshcoreMilliVoltsToApproximateBatteryPercent,
  meshcoreMinimalNodeFromAdvertEvent,
  meshcoreSyntheticPlaceholderPubKeyHex,
  minimalMeshcoreChatNode,
  pubkeyToNodeId,
} from '../lib/meshcoreUtils';
import { MeshcoreWebBluetoothConnection } from '../lib/meshcoreWebBluetoothConnection';
import { lastHeardToUnixSeconds, mergeMeshcoreLastHeardFromAdvert } from '../lib/nodeStatus';
import { parseStoredJson } from '../lib/parseStoredJson';
import {
  type CliHistoryEntry,
  createRepeaterCommandService,
  type RepeaterCommandService,
} from '../lib/repeaterCommandService';
import {
  getPortSignature,
  LAST_SERIAL_PORT_KEY,
  persistSerialPortIdentity,
  selectGrantedSerialPort,
} from '../lib/serialPortSignature';
import { getStoredMeshProtocol } from '../lib/storedMeshProtocol';
import { TransportWebBluetoothIpc } from '../lib/transportWebBluetoothIpc';
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

/** MeshCore expected ACK CRCs are uint32; meshcore.js / BLE may surface them as signed. Normalize for Map keys, React state, and SQLite packet_id. */
function meshcoreDmAckKeyU32(crc: number): number {
  return crc >>> 0;
}

/**
 * Firmware `estTimeout` is sometimes only a few seconds; multi-hop / repeater paths often exceed
 * that before event 130. Wait at least this long before marking outbound DM as failed.
 */
const MESHCORE_DM_ACK_TIMEOUT_MIN_MS = 45_000;

/** Register pending DM ACK under every JS number the stack might use for the same CRC (signed vs unsigned). */
function meshcorePendingDmAckMapKeys(ackCrc: number): number[] {
  return Array.from(new Set([ackCrc, meshcoreDmAckKeyU32(ackCrc)]));
}

/** Try device-reported codes in both representations when looking up a pending send. */
function meshcoreDeviceAckLookupKeys(codeFromDevice: number): number[] {
  return Array.from(new Set([codeFromDevice, meshcoreDmAckKeyU32(codeFromDevice)]));
}

interface PendingDmAckEntry {
  timeoutId: ReturnType<typeof setTimeout>;
  /** Every `pendingAcksRef` key that references this entry. */
  mapKeys: number[];
  /** Same as `ChatMessage.packetId` / DB `packet_id` for this send (uint32). */
  canonicalPacketIdU32: number;
}

function meshcoreContactRawFromDevice(c: MeshCoreContactRaw): MeshCoreContactRaw {
  const f = (c as { flags?: number }).flags;
  const flags = typeof f === 'number' && Number.isFinite(f) ? f & 0xff : 0;
  return { ...c, flags };
}

function contactToDbRow(contact: MeshCoreContactRaw, nickname?: string | null) {
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
    contact_flags: contact.flags & 0xff,
    hops_away: contact.outPathLen != null && contact.outPathLen >= 0 ? contact.outPathLen : null,
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

/** meshcore.js BLE (NUS) uses raw companion frames like Web Bluetooth — not USB serial framing. */
interface NobleIpcMeshcoreConnectionInstance {
  emit(event: string | number, ...args: unknown[]): void;
  onConnected(): Promise<void>;
  onDisconnected(): void;
  onFrameReceived(frame: Uint8Array): void;
}

/** Runtime Connection + onFrameReceived (NUS path); meshcore.d.ts covers the shared base. */
const MeshcoreConnectionBase =
  Connection as unknown as new () => NobleIpcMeshcoreConnectionInstance;

// Umbrella timeout for the IPC call to main process to connect BLE.
// Must exceed the sum of all per-operation GATT timeouts on the slowest platform:
// non-macOS: connectAsync(30s) + discovery(30s) + subscribe×2(20s each) = 100s.
const NOBLE_IPC_CONNECT_TIMEOUT_MS = 120_000;

/** Vite renderer may omit `process.platform`; WinRT handshakes need a longer budget. */
function rendererLikelyWin32(): boolean {
  try {
    if (typeof process !== 'undefined' && process.platform === 'win32') return true;
  } catch {
    // catch-no-log-ok process access can throw in some renderer bundles; fall back to UA heuristics
  }
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent ?? '';
    if (/Windows/i.test(ua)) return true;
    const plat = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
      ?.platform;
    if (plat && /Windows/i.test(plat)) return true;
    // Legacy fallback when userAgent / userAgentData are inconclusive (Chromium still exposes platform on Win).
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- navigator.platform is the last-resort Win hint
    if (navigator.platform && /Win/i.test(navigator.platform)) return true;
  }
  return false;
}

function rendererLikelyLinux(): boolean {
  try {
    if (typeof process !== 'undefined' && process.platform === 'linux') return true;
  } catch {
    // catch-no-log-ok process access can throw in some renderer bundles; fall back to UA heuristics
  }
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent ?? '';
    if (/Linux/i.test(ua)) return true;
    const plat = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
      ?.platform;
    if (plat && /Linux/i.test(plat)) return true;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- navigator.platform is last-resort platform hint
    if (navigator.platform && /Linux/i.test(navigator.platform)) return true;
  }
  return false;
}

/** WinRT + companion handshake can be slower than CoreBluetooth. */
const NOBLE_IPC_HANDSHAKE_TIMEOUT_MS = rendererLikelyWin32()
  ? 45_000
  : rendererLikelyLinux()
    ? 60_000
    : 20_000;
const NOBLE_IPC_CONNECT_MAX_ATTEMPTS = 2;
const WEB_BLUETOOTH_CONNECT_MAX_ATTEMPTS = 2;
const WEB_BLUETOOTH_CONNECT_RETRY_DELAY_MS = 1_500;
// Contact list streaming is O(N contacts) — use a generous timeout across all platforms.
const MESHCORE_INIT_TIMEOUT_MS = 60_000;
/** Companion Ok/Err for `sendFloodAdvert` — meshcore.js has no internal timeout. */
const MESHCORE_SEND_FLOOD_ADVERT_TIMEOUT_MS = 25_000;

function serializeErrorLike(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof (value as Record<string, unknown>).message === 'string')
    return (value as Record<string, unknown>).message as string;
  try {
    return JSON.stringify(value);
  } catch {
    // catch-no-log-ok stringify fallback for arbitrary error payloads
    return '[unserializable]';
  }
}

/** One string for Electron's renderer console forwarder (avoids "[object Object]" in disk logs). */
function formatStructuredLogDetail(detail: Record<string, unknown>): string {
  try {
    return sanitizeLogMessage(JSON.stringify(detail));
  } catch {
    // catch-no-log-ok stringify fallback for circular / non-serializable log payloads
    return sanitizeLogMessage('{}');
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
    this.cleanupFns.forEach((fn) => {
      fn();
    });
    this.cleanupFns = [];
  }
}

/** BLE connection implemented over session-scoped Noble IPC. */
class IpcNobleConnection {
  private static meshcoreConnectChain = Promise.resolve();

  private readonly peripheralId: string;
  private readonly sessionId: NobleBleSessionId;
  private inner: NobleIpcMeshcoreConnectionInstance | null = null;
  private cleanupFns: (() => void)[] = [];

  constructor(peripheralId: string, sessionId: NobleBleSessionId = 'meshcore') {
    this.peripheralId = peripheralId;
    this.sessionId = sessionId;
  }

  async connect() {
    const runConnect = async () => {
      const sessionId = this.sessionId;
      class NobleOverIpc extends (MeshcoreConnectionBase as unknown as new () => NobleIpcMeshcoreConnectionInstance) {
        constructor(private readonly session: NobleBleSessionId) {
          super();
        }

        /**
         * Raw companion frames over Nordic UART (same as meshcore.js WebBleConnection), not SerialConnection's
         * USB framing (0x3c/0x3e + length) used for WebSerial/TCP.
         */
        async sendToRadioFrame(data: Uint8Array) {
          this.emit('tx', data);
          await this.write(data);
        }

        async write(bytes: Uint8Array) {
          await window.electronAPI.nobleBleToRadio(this.session, bytes);
        }

        async close() {
          await window.electronAPI.disconnectNobleBle(this.session);
        }
      }

      const instance = new NobleOverIpc(sessionId) as unknown as NobleIpcMeshcoreConnectionInstance;
      this.inner = instance;
      /** Reject pending companion handshake when noble disconnects or aborts (e.g. Win32 pairing / watchdog). */
      let rejectHandshakeOnDisconnect: ((err: Error) => void) | undefined;
      const disconnectAbortsHandshake = new Promise<never>((_, reject) => {
        rejectHandshakeOnDisconnect = reject;
      });
      // Guard against unhandled rejection if the outer withTimeout rejects before disconnect fires.
      disconnectAbortsHandshake.catch(() => {});
      const offData = window.electronAPI.onNobleBleFromRadio(({ sessionId: sid, bytes }) => {
        if (sid !== sessionId) return;
        const frame = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
        instance.onFrameReceived(frame);
      });
      const offDisc = window.electronAPI.onNobleBleDisconnected((sid) => {
        if (sid !== sessionId) return;
        console.warn(`[IpcNobleConnection:${sessionId}] peripheral disconnected`);
        instance.onDisconnected();
        const r = rejectHandshakeOnDisconnect;
        rejectHandshakeOnDisconnect = undefined;
        r?.(
          new Error(
            'BLE peripheral disconnected during handshake (pairing step finished or link lost — retry connect)',
          ),
        );
      });
      const offAbort = window.electronAPI.onNobleBleConnectAborted(
        ({ sessionId: sid, message }) => {
          if (sid !== sessionId) return;
          console.warn(`[IpcNobleConnection:${sessionId}] connect aborted by main: ${message}`);
          const r = rejectHandshakeOnDisconnect;
          rejectHandshakeOnDisconnect = undefined;
          r?.(new Error(message));
        },
      );
      this.cleanupFns = [offData, offDisc, offAbort];
      try {
        await withTimeout(
          window.electronAPI.connectNobleBle(sessionId, this.peripheralId).then((result) => {
            if (!result.ok) throw new Error(result.error || 'BLE connect failed');
          }),
          NOBLE_IPC_CONNECT_TIMEOUT_MS,
          'MeshCore BLE IPC open',
        );
        const disconnectAlreadyFired = rejectHandshakeOnDisconnect === undefined;
        if (disconnectAlreadyFired) {
          console.warn(
            `[IpcNobleConnection:${sessionId}] disconnect raced ahead of handshake — will fail immediately`,
          );
        } else {
          console.info(
            `[IpcNobleConnection:${sessionId}] waiting on onConnected() timeout=${NOBLE_IPC_HANDSHAKE_TIMEOUT_MS}ms`,
          );
        }
        const handshakeStart = Date.now();
        await withTimeout(
          Promise.race([
            instance.onConnected().then(() => {
              rejectHandshakeOnDisconnect = undefined;
              console.info(
                `[IpcNobleConnection:${sessionId}] onConnected() resolved after ${Date.now() - handshakeStart}ms`,
              );
            }),
            disconnectAbortsHandshake,
          ]),
          NOBLE_IPC_HANDSHAKE_TIMEOUT_MS,
          'MeshCore BLE protocol handshake',
        );
        console.info(
          `[IpcNobleConnection:${sessionId}] handshake complete after ${Date.now() - handshakeStart}ms`,
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
    };

    if (this.sessionId !== 'meshcore') {
      await runConnect();
      return;
    }

    const prev = IpcNobleConnection.meshcoreConnectChain;
    let releaseChain!: () => void;
    IpcNobleConnection.meshcoreConnectChain = new Promise<void>((resolve) => {
      releaseChain = resolve;
    });
    await prev;
    try {
      await runConnect();
    } finally {
      releaseChain();
    }
  }

  get connection() {
    return this.inner;
  }

  cleanup() {
    this.cleanupFns.forEach((fn) => {
      fn();
    });
    this.cleanupFns = [];
  }
}

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

export type { CliHistoryEntry } from '../lib/repeaterCommandService';

// The connection object returned by meshcore.js is typed loosely — use unknown and cast
interface MeshCoreConnection {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
  once(event: string | number, cb: (...args: unknown[]) => void): void;
  emit(event: string | number, ...args: unknown[]): void;
  close(): Promise<void>;
  getSelfInfo(timeout?: number): Promise<MeshCoreSelfInfoWire>;
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
  tracePath(
    pubKeys: Uint8Array[],
    extraTimeoutMillis?: number,
  ): Promise<{
    pathLen: number;
    pathHashes: number[];
    pathSnrs: number[];
    lastSnr: number;
    tag: number;
  }>;
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
  sendToRadioFrame(data: Uint8Array): Promise<void>;
  deviceQuery(appTargetVer: number): Promise<{
    firmwareVer: number;
    firmware_build_date: string;
    manufacturerModel: string;
  }>;
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
  contact_flags: number | null;
  hops_away: number | null;
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
const MESHCORE_STATUS_TIMEOUT_MS = 10000;
const MESHCORE_TELEMETRY_TIMEOUT_MS = 10000;
const MESHCORE_NEIGHBORS_TIMEOUT_MS = 10000;
const MESHCORE_TRACE_TIMEOUT_MS = 15000;
const MAX_TELEMETRY_POINTS = 50;

const MAX_ENV_TELEMETRY_POINTS = 50;

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

/**
 * Legacy DB rows may store the full RF line `DisplayName: body` with no usable sender_name.
 * Only then run wire-style normalize; otherwise persisted payload is already display text
 * (re-applying normalize breaks any body containing `:` e.g. `Re: …`, `12:30 …`).
 */
function shouldLegacyNormalizeMeshcoreDbPayload(
  senderName: string | null | undefined,
  payload: string,
): boolean {
  if (senderName && senderName !== 'Unknown') return false;
  const t = payload.trim();
  const ci = t.indexOf(':');
  if (ci <= 0 || ci >= t.length - 1) return false;
  const left = t.slice(0, ci).trim();
  const right = t.slice(ci + 1).trim();
  if (left.length < 6 || right.length < 1) return false;
  if (left.includes('\n')) return false;
  return true;
}

function coerceOptionalDbInt(v: number | string | null | undefined): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 32-byte pubkey from `meshcore_contacts.public_key` hex, or null if synthetic / invalid length. */
function meshcoreFullPubKeyBytesFromContactDbHex(raw: string): Uint8Array | null {
  const hex = raw.replace(/\s/g, '');
  if (meshcoreIsSyntheticPlaceholderPubKeyHex(hex)) return null;
  if (hex.length !== 64) return null;
  const pairs = hex.match(/.{2}/g);
  if (pairs?.length !== 32) return null;
  return new Uint8Array(pairs.map((b) => parseInt(b, 16)));
}

/** Map persisted MeshCore message rows to chat messages (stub sender id; trust stored payload). */
function mapMeshcoreDbRowsToChatMessages(rows: MeshcoreMessageDbRow[]): ChatMessage[] {
  const mapped: ChatMessage[] = [];
  for (const r of rows) {
    if (isMeshcoreTransportStatusChatLine(r.payload)) continue;
    let displayPayload = r.payload;
    let displayName = r.sender_name && r.sender_name !== 'Unknown' ? r.sender_name : 'Unknown';
    if (shouldLegacyNormalizeMeshcoreDbPayload(r.sender_name, r.payload)) {
      const normalized = normalizeMeshcoreIncomingText(r.payload);
      displayPayload = normalized.payload;
      displayName = normalized.senderName ?? displayName;
    }
    let senderId = r.sender_id ?? 0;
    if (senderId === 0) {
      senderId = meshcoreChatStubNodeIdFromDisplayName(displayName);
    }
    mapped.push({
      id: r.id,
      sender_id: senderId,
      sender_name: displayName,
      payload: displayPayload,
      channel: r.channel_idx,
      timestamp: r.timestamp,
      status: (r.status as ChatMessage['status']) ?? 'acked',
      packetId: r.packet_id ?? undefined,
      emoji: coerceOptionalDbInt(r.emoji),
      replyId: coerceOptionalDbInt(r.reply_id),
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
  const [meshcoreContactsForTelemetry, setMeshcoreContactsForTelemetry] = useState<
    MeshCoreContactRaw[]
  >([]);
  const [meshcoreAutoadd, setMeshcoreAutoadd] = useState<MeshcoreAutoaddWireState | null>(null);
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
  const [meshcoreTelemetryErrors, setMeshcoreTelemetryErrors] = useState<Map<number, string>>(
    new Map(),
  );
  const [meshcoreStatusErrors, setMeshcoreStatusErrors] = useState<Map<number, string>>(new Map());
  const [meshcorePingErrors, setMeshcorePingErrors] = useState<Map<number, string>>(new Map());
  const [meshcoreNeighbors, setMeshcoreNeighbors] = useState<Map<number, MeshCoreNeighborResult>>(
    new Map(),
  );
  const [meshcoreNeighborErrors, setMeshcoreNeighborErrors] = useState<Map<number, string>>(
    new Map(),
  );
  const [meshcoreCliHistories, setMeshcoreCliHistories] = useState<Map<number, CliHistoryEntry[]>>(
    new Map(),
  );
  const [meshcoreCliErrors, setMeshcoreCliErrors] = useState<Map<number, string>>(new Map());
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
  const webBluetoothTransportRef = useRef<TransportWebBluetoothIpc | null>(null);
  const bleConnectInProgressRef = useRef(false);
  /** Incremented on `disconnect()` so in-flight `initConn` can abort instead of timing out. */
  const meshcoreSetupGenerationRef = useRef(0);
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
  // Pending ACK tracking: CRC key (raw and/or u32) → shared entry for one in-flight DM
  const pendingAcksRef = useRef<Map<number, PendingDmAckEntry>>(new Map());
  /** MQTT-derived contacts persisted with a placeholder pubkey until 0x8A supplies a real key. */
  const mqttPlaceholderSavedRef = useRef<Set<number>>(new Set());
  const selfInfoRef = useRef<MeshCoreSelfInfo | null>(null);
  /** Throttle LetsMesh packet-logger publishes (event 136 can be very frequent). */
  const lastPacketLogAtRef = useRef(0);
  /** Rate-limit debug logs when optional packet-logger IPC publish fails. */
  const lastPacketLogPublishFailureLogAtRef = useRef(0);
  const meshcoreHookMountedRef = useRef(true);
  const repeaterCommandServiceRef = useRef<RepeaterCommandService | null>(null);

  const addCliHistoryEntry = useCallback((nodeId: number, entry: CliHistoryEntry) => {
    setMeshcoreCliHistories((prev) => {
      const next = new Map(prev);
      const existing = next.get(nodeId) ?? [];
      const updated = [...existing, entry];
      if (updated.length > 100) {
        next.set(nodeId, updated.slice(-100));
      } else {
        next.set(nodeId, updated);
      }
      return next;
    });
  }, []);

  const clearCliHistory = useCallback((nodeId: number) => {
    setMeshcoreCliHistories((prev) => {
      const next = new Map(prev);
      next.delete(nodeId);
      return next;
    });
  }, []);

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
      const st = s;
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
            short_name: '',
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
      .catch((e: unknown) => {
        console.warn('[useMeshCore] load contacts/messages from DB on mount', e);
      });
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

  // Mirror self radio battery into the home MeshNode (node list + node detail); refreshContacts rebuilds from selfInfo
  useEffect(() => {
    const myId = state.myNodeNum;
    const mV = selfInfo?.batteryMilliVolts;
    if (myId <= 0 || mV == null || !Number.isFinite(mV)) return;
    const voltage = mV / 1000;
    const battery = meshcoreMilliVoltsToApproximateBatteryPercent(mV);
    setNodes((prev) => {
      const existing = prev.get(myId);
      if (!existing) return prev;
      if (existing.voltage === voltage && existing.battery === battery) return prev;
      const next = new Map(prev);
      next.set(myId, { ...existing, voltage, battery });
      return next;
    });
  }, [state.myNodeNum, selfInfo?.batteryMilliVolts]);

  // Connection panel: meshcore.js exposes only millivolts—no charging bit (unlike Meshtastic batteryLevel > 100).
  // We set batteryCharging from transport: USB serial usually means VBUS. BLE/TCP cannot detect wall charging.
  useEffect(() => {
    const mV = selfInfo?.batteryMilliVolts;
    if (mV == null || !Number.isFinite(mV)) {
      setState((prev) => {
        if (prev.batteryPercent === undefined && prev.batteryCharging === undefined) return prev;
        return { ...prev, batteryPercent: undefined, batteryCharging: undefined };
      });
      return;
    }
    const pct = meshcoreMilliVoltsToApproximateBatteryPercent(mV);
    const charging = meshcoreConnectionImpliesUsbPower(state.connectionType);
    setState((prev) => {
      if (prev.batteryPercent === pct && prev.batteryCharging === charging) return prev;
      return { ...prev, batteryPercent: pct, batteryCharging: charging };
    });
  }, [selfInfo?.batteryMilliVolts, state.connectionType]);

  const addMessage = useCallback((msg: ChatMessage) => {
    const incomingKey = meshcoreMessageDedupeKey(msg);
    let inserted = false;
    // flushSync: `inserted` must reflect the updater result before persisting. React 19 can defer
    // the functional update; without flush, saveMeshcoreMessage never runs while UI still updates.
    flushSync(() => {
      setMessages((prev) => {
        const isDup = prev.some((m) => meshcoreMessageDedupeKey(m) === incomingKey);
        if (isDup) {
          return prev;
        }
        inserted = true;
        return [...prev, msg];
      });
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
        m.senderNodeId != null && Number.isFinite(m.senderNodeId) ? m.senderNodeId >>> 0 : 0;
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
              short_name: '',
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
      const normProbe = normalizeMeshcoreIncomingText(m.text);
      const rawForBuild = normProbe.senderName ? m.text : `${displayName}: ${m.text}`;
      addMessage(
        buildMeshcoreChannelIncomingMessage(messagesRef.current, {
          rawText: rawForBuild,
          senderId: resolvedId,
          displayName,
          channel: m.channelIdx,
          timestamp: ts,
          receivedVia: 'mqtt',
        }),
      );
    });
    return off;
  }, [addMessage]);

  const updateNode = useCallback((node: MeshNode) => {
    setNodes((prev) => {
      const next = new Map(prev);
      const existing = prev.get(node.node_id);
      next.set(node.node_id, existing ? { ...existing, ...node } : node);
      return next;
    });
  }, []);

  const buildNodesFromContacts = useCallback(
    async (
      contacts: MeshCoreContactRaw[],
      opts?: {
        self?: MeshCoreSelfInfo | null;
        myNodeId?: number;
        /** Prior UI node map so `last_heard` from live events is preserved when device sends `lastAdvert: 0`. */
        previousNodes?: Map<number, MeshNode>;
      },
    ): Promise<Map<number, MeshNode>> => {
      const prevSnap = opts?.previousNodes ?? new Map<number, MeshNode>();
      const nextNodes = new Map<number, MeshNode>();
      pubKeyMapRef.current.clear();
      pubKeyPrefixMapRef.current.clear();
      for (const contact of contacts) {
        const base = meshcoreContactToMeshNode(contact);
        const last_heard = mergeMeshcoreLastHeardFromAdvert(
          contact.lastAdvert,
          prevSnap.get(base.node_id)?.last_heard,
        );
        const node: MeshNode = { ...base, last_heard };
        nextNodes.set(node.node_id, node);
        pubKeyMapRef.current.set(node.node_id, contact.publicKey);
        const prefix = Array.from(contact.publicKey.slice(0, 6))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        pubKeyPrefixMapRef.current.set(prefix, node.node_id);
        void window.electronAPI.db
          .saveMeshcoreContact(contactToDbRow(contact))
          .catch((e: unknown) => {
            console.warn('[useMeshCore] saveMeshcoreContact error', e);
          });
      }

      try {
        const dbContacts =
          (await window.electronAPI.db.getMeshcoreContacts()) as MeshcoreContactDbRow[];
        for (const row of dbContacts) {
          if (pubKeyMapRef.current.has(row.node_id)) continue;
          const bytes = meshcoreFullPubKeyBytesFromContactDbHex(row.public_key);
          if (!bytes) continue;
          pubKeyMapRef.current.set(row.node_id, bytes);
          const prefix = Array.from(bytes.slice(0, 6))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          pubKeyPrefixMapRef.current.set(prefix, row.node_id);
        }
        for (const row of dbContacts) {
          if (!nextNodes.has(row.node_id)) {
            const last_heard = mergeMeshcoreLastHeardFromAdvert(
              row.last_advert,
              prevSnap.get(row.node_id)?.last_heard,
            );
            nextNodes.set(row.node_id, {
              node_id: row.node_id,
              long_name:
                row.nickname ?? row.adv_name ?? `Node-${row.node_id.toString(16).toUpperCase()}`,
              short_name: '',
              hw_model: CONTACT_TYPE_LABELS[row.contact_type] ?? 'Unknown',
              battery: 0,
              snr: row.last_snr ?? 0,
              rssi: row.last_rssi ?? 0,
              last_heard,
              latitude: row.adv_lat ?? null,
              longitude: row.adv_lon ?? null,
              favorited: row.favorited === 1,
              hops_away: row.hops_away ?? undefined,
            });
          }
        }
        for (const row of dbContacts) {
          const existing = nextNodes.get(row.node_id);
          if (existing) {
            nextNodes.set(row.node_id, { ...existing, favorited: row.favorited === 1 });
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
        if (nick) nextNodes.set(nodeId, { ...node, long_name: nick, short_name: '' });
      }

      const myNodeId = opts?.myNodeId ?? 0;
      const self = opts?.self;
      if (myNodeId > 0 && self) {
        const selfNode = nextNodes.get(myNodeId);
        const hexFallback = `Node-${myNodeId.toString(16).toUpperCase()}`;
        const selfNameTrimmed = typeof self.name === 'string' ? self.name.trim() : '';
        const displayLongName = selfNameTrimmed || selfNode?.long_name || hexFallback;
        const displayShortName = '';
        const selfMv = self.batteryMilliVolts;
        const fromSelfBattery =
          selfMv != null && Number.isFinite(selfMv)
            ? {
                voltage: selfMv / 1000,
                battery: meshcoreMilliVoltsToApproximateBatteryPercent(selfMv),
              }
            : null;
        if (selfNode) {
          nextNodes.set(myNodeId, {
            ...selfNode,
            long_name: displayLongName,
            short_name: displayShortName,
            hops_away: 0,
            ...(fromSelfBattery ?? {}),
          });
        } else {
          nextNodes.set(myNodeId, {
            node_id: myNodeId,
            long_name: displayLongName,
            short_name: displayShortName,
            hw_model: CONTACT_TYPE_LABELS[self.type] ?? 'Unknown',
            battery: fromSelfBattery?.battery ?? 0,
            snr: 0,
            rssi: 0,
            last_heard: Math.floor(Date.now() / 1000),
            latitude: null,
            longitude: null,
            hops_away: 0,
            ...(fromSelfBattery?.voltage != null ? { voltage: fromSelfBattery.voltage } : {}),
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

      // Push: periodic advert — event 0x80 = 128 (meshcore.js emits publicKey only; lat/lastAdvert may be absent)
      conn.on(128, (data: unknown) => {
        const d = data as {
          publicKey: Uint8Array;
          advLat?: number;
          advLon?: number;
          lastAdvert?: number;
          type?: number;
          advName?: string;
        };
        if (d.publicKey?.length !== 32) {
          console.debug('[useMeshCore] event 128: bad publicKey length', d.publicKey?.length);
          return;
        }
        const nodeId = pubkeyToNodeId(d.publicKey);
        if (nodeId === 0) return;
        const nowSec = Math.floor(Date.now() / 1000);
        console.debug('[useMeshCore] event 128: advert from', nodeId.toString(16).toUpperCase());
        const persistOut = {
          kind: 'none' as 'none' | 'insert' | 'update',
          persistLastAdvert: nowSec,
          persistLat: null as number | null,
          persistLon: null as number | null,
          insertContactType: 0,
          insertAdvName: null as string | null,
          /** Set on existing-contact updates when RF advert includes a new `advName` (optional 5th IPC arg). */
          persistAdvName: undefined as string | undefined,
        };
        setNodes((prev) => {
          const existing = prev.get(nodeId);
          const nick = nicknameMapRef.current.get(nodeId);
          const hasLat =
            typeof d.advLat === 'number' && Number.isFinite(d.advLat) && d.advLat !== 0;
          const hasLon =
            typeof d.advLon === 'number' && Number.isFinite(d.advLon) && d.advLon !== 0;
          const lastHeard =
            typeof d.lastAdvert === 'number' && Number.isFinite(d.lastAdvert) && d.lastAdvert > 0
              ? d.lastAdvert
              : nowSec;
          persistOut.persistLastAdvert = lastHeard;
          if (!existing) {
            const built = meshcoreMinimalNodeFromAdvertEvent(d.publicKey, {
              nowSec,
              advLat: d.advLat,
              advLon: d.advLon,
              lastAdvert: d.lastAdvert,
              contactType: d.type,
              advName: d.advName,
            });
            if (!built) return prev;
            persistOut.kind = 'insert';
            persistOut.persistLat = built.persistAdvLatDeg;
            persistOut.persistLon = built.persistAdvLonDeg;
            persistOut.insertContactType = built.contactType;
            persistOut.insertAdvName =
              typeof d.advName === 'string' && d.advName.trim() ? d.advName.trim() : null;
            pubKeyMapRef.current.set(nodeId, d.publicKey);
            const prefix = Array.from(d.publicKey.slice(0, 6))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
            pubKeyPrefixMapRef.current.set(prefix, nodeId);
            const nodeWithNick = nick
              ? { ...built.node, long_name: nick, short_name: '' }
              : built.node;
            const next = new Map(prev);
            next.set(nodeId, nodeWithNick);
            return next;
          }
          persistOut.kind = 'update';
          const next = new Map(prev);
          persistOut.persistLat = hasLat
            ? d.advLat! / MESHCORE_COORD_SCALE
            : (existing.latitude ?? null);
          persistOut.persistLon = hasLon
            ? d.advLon! / MESHCORE_COORD_SCALE
            : (existing.longitude ?? null);
          const advNameTrim =
            typeof d.advName === 'string' && d.advName.trim() ? d.advName.trim() : '';
          const applyAdvertName = !nick && Boolean(advNameTrim);
          if (applyAdvertName) {
            persistOut.persistAdvName = advNameTrim;
          }
          next.set(nodeId, {
            ...existing,
            last_heard: lastHeard,
            latitude: hasLat ? d.advLat! / MESHCORE_COORD_SCALE : existing.latitude,
            longitude: hasLon ? d.advLon! / MESHCORE_COORD_SCALE : existing.longitude,
            ...(nick
              ? { long_name: nick, short_name: '' }
              : applyAdvertName
                ? { long_name: advNameTrim, short_name: '' }
                : {}),
          });
          return next;
        });
        if (
          typeof d.advLat === 'number' &&
          Number.isFinite(d.advLat) &&
          d.advLat !== 0 &&
          typeof d.advLon === 'number' &&
          Number.isFinite(d.advLon) &&
          d.advLon !== 0
        ) {
          usePositionHistoryStore
            .getState()
            .recordPosition(
              nodeId,
              d.advLat / MESHCORE_COORD_SCALE,
              d.advLon / MESHCORE_COORD_SCALE,
            );
        }
        if (persistOut.kind === 'insert') {
          void window.electronAPI.db
            .saveMeshcoreContact({
              node_id: nodeId,
              public_key: Array.from(d.publicKey)
                .map((b) => b.toString(16).padStart(2, '0'))
                .join(''),
              adv_name: persistOut.insertAdvName,
              contact_type: persistOut.insertContactType,
              last_advert: persistOut.persistLastAdvert,
              adv_lat: persistOut.persistLat,
              adv_lon: persistOut.persistLon,
              nickname: null,
            })
            .catch((e: unknown) => {
              console.warn('[useMeshCore] saveMeshcoreContact (event 128 new) error', e);
            });
        } else if (persistOut.kind === 'update') {
          void window.electronAPI.db
            .updateMeshcoreContactAdvert(
              nodeId,
              persistOut.persistLastAdvert,
              persistOut.persistLat,
              persistOut.persistLon,
              persistOut.persistAdvName,
            )
            .catch((e: unknown) => {
              console.warn('[useMeshCore] updateMeshcoreContactAdvert error', e);
            });
        }
      });

      // Push: path updated — event 0x81 = 129; update last_heard for that contact
      conn.on(129, (data: unknown) => {
        const d = data as { publicKey: Uint8Array };
        if (d.publicKey?.length !== 32) {
          console.debug('[useMeshCore] event 129: bad publicKey length', d.publicKey?.length);
          return;
        }
        const nodeId = pubkeyToNodeId(d.publicKey);
        if (nodeId === 0) return;
        const nowSec = Math.floor(Date.now() / 1000);
        console.debug('[useMeshCore] event 129: path update', nodeId.toString(16).toUpperCase());
        const persist129 = {
          kind: 'none' as 'none' | 'insert' | 'update',
          persistLastAdvert: nowSec,
        };
        setNodes((prev) => {
          const existing = prev.get(nodeId);
          const nick = nicknameMapRef.current.get(nodeId);
          if (!existing) {
            const built = meshcoreMinimalNodeFromAdvertEvent(d.publicKey, { nowSec });
            if (!built) return prev;
            persist129.kind = 'insert';
            persist129.persistLastAdvert = built.lastHeardSec;
            pubKeyMapRef.current.set(nodeId, d.publicKey);
            const prefix = Array.from(d.publicKey.slice(0, 6))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
            pubKeyPrefixMapRef.current.set(prefix, nodeId);
            const nodeWithNick = nick
              ? { ...built.node, long_name: nick, short_name: '' }
              : built.node;
            const next = new Map(prev);
            next.set(nodeId, nodeWithNick);
            return next;
          }
          // update path: only refresh last_heard in memory; DB last_advert is written next time event 128 fires
          persist129.kind = 'update';
          const next = new Map(prev);
          next.set(nodeId, { ...existing, last_heard: nowSec });
          return next;
        });
        if (persist129.kind === 'insert') {
          void window.electronAPI.db
            .saveMeshcoreContact({
              node_id: nodeId,
              public_key: Array.from(d.publicKey)
                .map((b) => b.toString(16).padStart(2, '0'))
                .join(''),
              adv_name: null,
              contact_type: 0,
              last_advert: persist129.persistLastAdvert,
              adv_lat: null,
              adv_lon: null,
              nickname: null,
            })
            .catch((e: unknown) => {
              console.warn('[useMeshCore] saveMeshcoreContact (event 129 new) error', e);
            });
        }
      });

      // Push: send confirmed — event 0x82 = 130; resolve pending DM delivery
      conn.on(130, (data: unknown) => {
        const d = data as { ackCode: number; roundTrip?: number };
        if (typeof d.ackCode !== 'number' || !Number.isFinite(d.ackCode)) {
          console.warn('[useMeshCore] event 130: non-numeric ackCode', d.ackCode);
          return;
        }
        let pending: PendingDmAckEntry | undefined;
        for (const lk of meshcoreDeviceAckLookupKeys(d.ackCode)) {
          pending = pendingAcksRef.current.get(lk);
          if (pending) break;
        }
        if (!pending) {
          const lateKey = meshcoreDmAckKeyU32(d.ackCode);
          const selfId = myNodeNumRef.current;
          const hadLateOutbound = messagesRef.current.some(
            (m) =>
              m.packetId != null &&
              meshcoreDmAckKeyU32(m.packetId) === lateKey &&
              m.sender_id === selfId &&
              m.to != null &&
              (m.status === 'sending' || m.status === 'failed'),
          );
          if (hadLateOutbound) {
            console.debug(
              '[useMeshCore] event 130: late ACK matched, ackCode',
              d.ackCode.toString(16),
            );
            setMessages((prev) =>
              prev.map((m) =>
                m.packetId != null &&
                meshcoreDmAckKeyU32(m.packetId) === lateKey &&
                m.sender_id === selfId &&
                m.to != null &&
                (m.status === 'sending' || m.status === 'failed')
                  ? { ...m, status: 'acked' as const }
                  : m,
              ),
            );
            void window.electronAPI.db
              .updateMeshcoreMessageStatus(lateKey, 'acked')
              .catch((e: unknown) => {
                console.warn('[useMeshCore] updateMeshcoreMessageStatus (late 130) error', e);
              });
            return;
          }
          console.debug(
            '[useMeshCore] event 130: orphaned ACK (no pending, no late match), ackCode',
            d.ackCode.toString(16),
          );
          return;
        }
        clearTimeout(pending.timeoutId);
        for (const k of pending.mapKeys) {
          pendingAcksRef.current.delete(k);
        }
        const canon = pending.canonicalPacketIdU32;
        setMessages((prev) =>
          prev.map((m) =>
            m.packetId != null && meshcoreDmAckKeyU32(m.packetId) === canon
              ? { ...m, status: 'acked' as const }
              : m,
          ),
        );
        void window.electronAPI.db
          .updateMeshcoreMessageStatus(canon, 'acked')
          .catch((e: unknown) => {
            console.warn('[useMeshCore] updateMeshcoreMessageStatus error', e);
          });
      });

      // Push: new contact discovered — event 0x8A = 138
      conn.on(138, (data: unknown) => {
        const d = meshcoreContactRawFromDevice(data as MeshCoreContactRaw);
        const node = meshcoreContactToMeshNode(d);
        pubKeyMapRef.current.set(node.node_id, d.publicKey);
        const prefix = Array.from(d.publicKey.slice(0, 6))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        pubKeyPrefixMapRef.current.set(prefix, node.node_id);
        const nick = nicknameMapRef.current.get(node.node_id);
        const nodeWithNick = nick ? { ...node, long_name: nick, short_name: '' } : node;
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
      const processWaitingMessages = async () => {
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
            if (senderId === 0) {
              console.warn(
                '[useMeshCore] event 131: unknown pubKeyPrefix in queued DM, sender will be 0',
                prefix,
              );
            }
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
                ...buildMeshcoreDmIncomingMessage(messagesRef.current, {
                  rawText: d.text,
                  senderId,
                  displayName: sender?.long_name ?? `Node-${senderId.toString(16).toUpperCase()}`,
                  timestamp: d.senderTimestamp * 1000,
                  receivedVia: 'rf',
                  peerNodeId: senderId,
                  myNodeId: myNodeNumRef.current || 0,
                  to: myNodeNumRef.current || undefined,
                }),
                isHistory: true,
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
              ...buildMeshcoreChannelIncomingMessage(messagesRef.current, {
                rawText: d.text,
                senderId: stubId,
                displayName,
                channel: d.channelIdx,
                timestamp: d.senderTimestamp * 1000,
                receivedVia: 'rf',
              }),
              isHistory: true,
            });
          }
        }
        console.debug('[useMeshCore] event 131: message waiting, fetched', arr.length, 'messages');
      };
      conn.on(131, () => {
        void (async () => {
          try {
            await processWaitingMessages();
          } catch (e) {
            console.warn('[useMeshCore] getWaitingMessages error, retrying in 2 s', e);
            // Single retry — device may be busy during BLE reconnect
            setTimeout(() => {
              if (!meshcoreHookMountedRef.current) return;
              void processWaitingMessages().catch((e2: unknown) => {
                console.warn('[useMeshCore] getWaitingMessages retry failed', e2);
              });
            }, 2_000);
          }
        })();
      });

      // Incoming DM — event 7
      conn.on(7, (data: unknown) => {
        const d = data as {
          pubKeyPrefix: Uint8Array;
          text: string;
          senderTimestamp: number;
          txtType?: number;
        };
        const prefix = Array.from(d.pubKeyPrefix)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const senderId = pubKeyPrefixMapRef.current.get(prefix) ?? 0;
        if (senderId === 0) {
          console.warn('[useMeshCore] event 7: unknown pubKeyPrefix, sender will be 0', prefix);
        }
        const sender = nodesRef.current.get(senderId);

        // CLI data response (txtType === 1)
        if (d.txtType === 1) {
          const service = repeaterCommandServiceRef.current;
          if (service) {
            const handled = service.handleResponse(d.text);
            if (handled) {
              console.debug(
                '[useMeshCore] event 7: CLI response from',
                senderId.toString(16).toUpperCase(),
                'token matched',
              );
              return;
            }
          } else {
            console.warn(
              '[useMeshCore] event 7: CLI response received but no command service active (sender:',
              senderId.toString(16).toUpperCase(),
              ')',
            );
          }
          // CLI response without matching pending command - log and add to history
          console.debug(
            '[useMeshCore] event 7: CLI response from',
            senderId.toString(16).toUpperCase(),
            'no pending command',
          );
          if (senderId !== 0) {
            const { body } = service ? service.parseResponseToken(d.text) : { body: d.text };
            addCliHistoryEntry(senderId, {
              type: 'received',
              text: body,
              timestamp: Date.now(),
            });
          }
          return;
        }

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
        addMessage(
          buildMeshcoreDmIncomingMessage(messagesRef.current, {
            rawText: d.text,
            senderId,
            displayName: sender?.long_name ?? `Node-${senderId.toString(16).toUpperCase()}`,
            timestamp: d.senderTimestamp * 1000,
            receivedVia: 'rf',
            peerNodeId: senderId,
            myNodeId: myNodeNumRef.current || 0,
            to: myNodeNumRef.current || undefined,
          }),
        );
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
        addMessage(
          buildMeshcoreChannelIncomingMessage(messagesRef.current, {
            rawText: d.text,
            senderId: stubId,
            displayName,
            channel: d.channelIdx,
            timestamp: d.senderTimestamp * 1000,
            receivedVia: 'rf',
          }),
        );
      });

      // Push: RF packet received — event 0x88 = 136; feed into device logs + signal telemetry.
      // Foreign LoRa fingerprinting requires d.raw (Uint8Array) from meshcore.js/device.
      conn.on(136, (data: unknown) => {
        const d = data as { lastSnr?: number; lastRssi?: number; raw?: unknown };
        const snr = d.lastSnr ?? 0;
        const rssi = d.lastRssi ?? 0;
        const now = Date.now();

        // Extract sender ID and update known node's last_heard + signal metrics
        let senderInfo = '';
        if (d.raw instanceof Uint8Array && d.raw.length >= 8) {
          const packetClass = classifyPayload(d.raw);
          if (packetClass === 'meshtastic') {
            const senderId = extractMeshtasticSenderId(d.raw);
            if (senderId !== null) {
              senderInfo = ` from=0x${senderId.toString(16)}`;
              // If we know this node (and it's not ourselves), update last_heard + SNR/RSSI
              if (senderId !== myNodeNumRef.current && nodesRef.current.has(senderId)) {
                const nowSec = Math.floor(now / 1000);
                setNodes((prev) => {
                  const existing = prev.get(senderId);
                  if (!existing) return prev;
                  const next = new Map(prev);
                  next.set(senderId, {
                    ...existing,
                    last_heard: nowSec,
                    snr: snr,
                    rssi: rssi,
                  });
                  return next;
                });
              }
            }
          } else if (packetClass === 'meshcore') {
            senderInfo = ' [meshcore]';
          }
        }

        const entry: DeviceLogEntry = {
          ts: now,
          level: 'debug',
          source: 'meshcore',
          message: `RX${senderInfo} SNR=${snr.toFixed(2)}dB RSSI=${rssi}dBm`,
        };
        setDeviceLogs((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_DEVICE_LOGS ? next.slice(next.length - MAX_DEVICE_LOGS) : next;
        });
        const sigPoint: TelemetryPoint = { timestamp: now, snr, rssi };
        setSignalTelemetry((prev) => [...prev, sigPoint].slice(-MAX_TELEMETRY_POINTS));

        // Foreign LoRa fingerprinting: only flag non-MeshCore packets as foreign (requires known self node ID)
        if (
          getStoredMeshProtocol() === 'meshcore' &&
          myNodeNumRef.current !== 0 &&
          d.raw instanceof Uint8Array &&
          d.raw.length > 0
        ) {
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
              .catch((e: unknown) => {
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
        // Release the underlying transport (serial port lock, BLE IPC session) so the
        // next connect attempt can open it cleanly. Without this, an unexpected
        // device-side disconnect leaves the raw SerialPort open at the browser level
        // and the next serialPort.open() throws "The port is already open."
        // Defer via setTimeout to avoid re-entrancy while the 'disconnected' event is firing.
        const staleConn = connRef.current;
        connRef.current = null;
        if (staleConn)
          setTimeout(() => {
            void staleConn.close().catch(() => {});
          }, 0);
      });

      conn.on('rx', (data: unknown) => {
        const frame = meshcoreCoerceRadioRxFrame(data);
        const parsed = frame && parseAutoaddConfigResponse(frame);
        if (parsed) setMeshcoreAutoadd(parsed);
      });
    },
    [addMessage, updateNode, setDeviceLogs, addCliHistoryEntry],
  );

  /** Reject promptly when `disconnect()` bumps `meshcoreSetupGenerationRef` (avoids hanging on getChannels, etc.). */
  const awaitUnlessMeshcoreSetupCancelled = useCallback(
    async <T>(setupGen: number, promise: Promise<T>): Promise<T> => {
      if (meshcoreSetupGenerationRef.current !== setupGen) {
        throw new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError');
      }
      return new Promise<T>((resolve, reject) => {
        const id = setInterval(() => {
          if (meshcoreSetupGenerationRef.current !== setupGen) {
            clearInterval(id);
            reject(new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError'));
          }
        }, 50);
        promise.then(
          (v) => {
            clearInterval(id);
            if (meshcoreSetupGenerationRef.current !== setupGen) {
              reject(new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError'));
            } else {
              resolve(v);
            }
          },
          (e: unknown) => {
            clearInterval(id);
            reject(
              e instanceof Error ? e : new Error(serializeErrorLike(e) || 'Connection failed'),
            );
          },
        );
      });
    },
    [],
  );

  const refreshMeshcoreAutoaddFromDevice = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) return;
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => {
        conn.off('rx', onRx);
        reject(new Error('Timed out waiting for auto-add config'));
      }, 5000);
      const onRx = (data: unknown) => {
        const frame = meshcoreCoerceRadioRxFrame(data);
        const parsed = frame && parseAutoaddConfigResponse(frame);
        if (!parsed) return;
        window.clearTimeout(t);
        conn.off('rx', onRx);
        setMeshcoreAutoadd(parsed);
        resolve();
      };
      conn.on('rx', onRx);
      void conn.sendToRadioFrame(buildGetAutoaddConfigFrame()).catch((e: unknown) => {
        window.clearTimeout(t);
        conn.off('rx', onRx);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }, []);

  /** Shared post-connection handshake: wire events, fetch self info, contacts, channels. */
  const initConn = useCallback(
    async (conn: MeshCoreConnection, setupGen: number) => {
      connRef.current = conn;
      setupEventListeners(conn);

      // Load persisted messages from DB before device's MsgWaiting fires (merge with mount-hydrated state)
      try {
        const dbMsgs = (await awaitUnlessMeshcoreSetupCancelled(
          setupGen,
          window.electronAPI.db.getMeshcoreMessages(undefined, 500),
        )) as MeshcoreMessageDbRow[];
        if (dbMsgs.length > 0) {
          const mapped = mapMeshcoreDbRowsToChatMessages(dbMsgs);
          setNodes((prev) => mergeStubNodesFromMeshcoreMessages(prev, mapped));
          setMessages((prev) => mergeMeshcoreDbHydrationWithLive(prev, mapped));
          console.debug('[useMeshCore] initConn: loaded', mapped.length, 'messages from DB');
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        console.warn('[useMeshCore] loadMessagesFromDb error', e);
      }

      // Fetch self info, contacts, channels (sequential — device handles one request at a time)
      const rawInfo = await awaitUnlessMeshcoreSetupCancelled(setupGen, conn.getSelfInfo(5000));
      const info = enrichMeshCoreSelfInfo(rawInfo);
      console.debug(
        `[useMeshCore] selfInfo: radioFreq=${info.radioFreq} radioBw=${info.radioBw} radioSf=${info.radioSf} radioCr=${info.radioCr} txPower=${info.txPower}`,
      );
      setSelfInfo(info);
      setState((prev) => ({ ...prev, status: 'connected' }));

      const myNodeId = pubkeyToNodeId(info.publicKey);
      setState((prev) => ({ ...prev, myNodeNum: myNodeId, status: 'configured' }));
      if (getStoredMeshProtocol() === 'meshcore') {
        useDiagnosticsStore.getState().migrateForeignLoraFromZero(myNodeId);
      }

      try {
        const deviceInfo = await conn.deviceQuery(0);
        if (deviceInfo?.firmware_build_date) {
          setState((prev) => ({ ...prev, firmwareVersion: deviceInfo.firmware_build_date }));
        }
      } catch (e) {
        console.debug('[useMeshCore] deviceQuery failed (firmware version unavailable):', e);
      }

      const contactsRaw = await awaitUnlessMeshcoreSetupCancelled(
        setupGen,
        withTimeout(conn.getContacts(), MESHCORE_INIT_TIMEOUT_MS, 'getContacts'),
      );
      const contacts = contactsRaw.map(meshcoreContactRawFromDevice);
      setMeshcoreContactsForTelemetry(contacts);
      const newNodes = await awaitUnlessMeshcoreSetupCancelled(
        setupGen,
        buildNodesFromContacts(contacts, {
          self: info,
          myNodeId,
          previousNodes: nodesRef.current,
        }),
      );
      setNodes((prev) => mergeMeshcoreChatStubNodes(prev, newNodes));
      console.debug('[useMeshCore] initConn: contacts loaded, device=', contacts.length);

      const rawChannels = await awaitUnlessMeshcoreSetupCancelled(
        setupGen,
        withTimeout(conn.getChannels(), MESHCORE_INIT_TIMEOUT_MS, 'getChannels'),
      );
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
          await awaitUnlessMeshcoreSetupCancelled(setupGen, conn.setManualAddContacts());
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        console.warn('[useMeshCore] setManualAddContacts (init) error', e);
      }

      await awaitUnlessMeshcoreSetupCancelled(
        setupGen,
        conn.syncDeviceTime().catch((e: unknown) => {
          console.warn('[useMeshCore] syncDeviceTime error', e);
        }),
      );
      await awaitUnlessMeshcoreSetupCancelled(
        setupGen,
        conn
          .getBatteryVoltage()
          .then(({ batteryMilliVolts }) => {
            setSelfInfo((prev) => (prev ? { ...prev, batteryMilliVolts } : prev));
          })
          .catch((e: unknown) => {
            console.warn('[useMeshCore] getBatteryVoltage error', e);
          }),
      );

      await awaitUnlessMeshcoreSetupCancelled(
        setupGen,
        refreshMeshcoreAutoaddFromDevice().catch((e: unknown) => {
          console.warn('[useMeshCore] refreshMeshcoreAutoaddFromDevice (init) error', e);
        }),
      );
    },
    [
      awaitUnlessMeshcoreSetupCancelled,
      buildNodesFromContacts,
      refreshMeshcoreAutoaddFromDevice,
      setupEventListeners,
    ],
  );

  const connect = useCallback(
    async (type: 'ble' | 'serial' | 'tcp', tcpHost?: string, blePeripheralId?: string) => {
      if (type === 'ble' && bleConnectInProgressRef.current) {
        throw new Error(
          'Bluetooth connection already in progress. Wait for it to finish or cancel, then try again.',
        );
      }

      // Close any existing connection before starting a new one.
      // Without this, a spurious connect() call (e.g. BLE auto-connect racing with an
      // already-established serial session) leaves the old serial port open, causing
      // the next serialPort.open() to throw "The port is already open."
      const staleConn = connRef.current;
      connRef.current = null;
      if (staleConn) {
        void staleConn.close().catch(() => {});
      }

      setState({
        status: 'connecting',
        myNodeNum: 0,
        connectionType: type === 'tcp' ? 'http' : type,
      });

      if (type === 'ble') bleConnectInProgressRef.current = true;
      let conn: MeshCoreConnection | null = null;
      let serialRawPort: SerialPort | null = null;
      /** Linux MeshCore uses renderer Web Bluetooth (not Noble IPC) — timeout copy must match. */
      let meshcoreBleLinuxWebBluetooth = false;

      try {
        const setupGen = meshcoreSetupGenerationRef.current;
        if (type === 'ble') {
          const isLinux = navigator.userAgent.toLowerCase().includes('linux');
          if (isLinux) {
            meshcoreBleLinuxWebBluetooth = true;
            console.debug('[useMeshCore] connect: BLE via Web Bluetooth (Linux)');
            window.electronAPI.resetBlePairingRetryCount('meshcore');
            let reuseWebBluetoothDeviceId: string | null = null;
            for (let attempt = 1; attempt <= WEB_BLUETOOTH_CONNECT_MAX_ATTEMPTS; attempt++) {
              const attemptStartedAt = Date.now();
              const transport = new TransportWebBluetoothIpc('meshcore');
              console.debug(
                `[useMeshCore] connect: BLE via Web Bluetooth (Linux) opening... (attempt ${attempt}/${WEB_BLUETOOTH_CONNECT_MAX_ATTEMPTS})`,
              );
              try {
                const meshcoreConn = new MeshcoreWebBluetoothConnection(transport);
                await meshcoreConn.connect(reuseWebBluetoothDeviceId ?? undefined);
                webBluetoothTransportRef.current = transport;
                conn = meshcoreConn as unknown as MeshCoreConnection;
                if (attempt > 1) {
                  console.info(
                    `[useMeshCore] connect: BLE via Web Bluetooth recovered on retry ${formatStructuredLogDetail(
                      {
                        attempt,
                        maxAttempts: WEB_BLUETOOTH_CONNECT_MAX_ATTEMPTS,
                        elapsedMs: Date.now() - attemptStartedAt,
                      },
                    )}`,
                  );
                }
                console.info('[useMeshCore] connect: BLE via Web Bluetooth connected');
                break;
              } catch (bleErr) {
                const activeDeviceInfo = transport.getDeviceInfo();
                if (activeDeviceInfo?.deviceId) {
                  reuseWebBluetoothDeviceId = activeDeviceInfo.deviceId;
                } else {
                  const grantedDeviceId = transport.getLastGrantedDeviceId();
                  if (grantedDeviceId) {
                    reuseWebBluetoothDeviceId = grantedDeviceId;
                  }
                }
                // Clean up transport on failure before retry
                try {
                  await transport.disconnect();
                } catch (cleanupErr) {
                  console.debug(
                    '[useMeshCore] connect: Web Bluetooth cleanup error on failure',
                    cleanupErr,
                  );
                }

                const rawBleMessage = serializeErrorLike(bleErr) || 'BLE connect failed';
                const isTimeout = rawBleMessage.includes('timed out');
                const isPairingError =
                  bleErr instanceof Error &&
                  (bleErr as Error & { isPairingRelated?: boolean }).isPairingRelated;
                console.warn(
                  `[useMeshCore] connect: BLE via Web Bluetooth attempt failed ${formatStructuredLogDetail(
                    {
                      attempt,
                      maxAttempts: WEB_BLUETOOTH_CONNECT_MAX_ATTEMPTS,
                      isTimeout,
                      isPairingError,
                      elapsedMs: Date.now() - attemptStartedAt,
                      message: rawBleMessage,
                    },
                  )}`,
                );
                webBluetoothTransportRef.current = null;

                // Don't retry on pairing errors (user needs to fix pairing, not retry)
                if (isPairingError || !isTimeout || attempt >= WEB_BLUETOOTH_CONNECT_MAX_ATTEMPTS) {
                  throw bleErr;
                }

                // `requestDevice()` requires a user gesture; retries must reuse a granted device id.
                if (!reuseWebBluetoothDeviceId) {
                  throw new Error(
                    'Bluetooth connection timed out before a device could be reused. Tap Connect again to retry.',
                  );
                }

                console.debug(
                  `[useMeshCore] connect: retrying BLE via Web Bluetooth after retryable failure ${formatStructuredLogDetail(
                    {
                      attempt,
                      maxAttempts: WEB_BLUETOOTH_CONNECT_MAX_ATTEMPTS,
                      retryDelayMs: WEB_BLUETOOTH_CONNECT_RETRY_DELAY_MS,
                    },
                  )}`,
                );
                await new Promise<void>((r) => setTimeout(r, WEB_BLUETOOTH_CONNECT_RETRY_DELAY_MS));
              }
            }
          } else {
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
                  console.info(
                    `[useMeshCore] connect: BLE via Noble IPC recovered on retry ${formatStructuredLogDetail(
                      {
                        attempt,
                        maxAttempts: NOBLE_IPC_CONNECT_MAX_ATTEMPTS,
                        elapsedMs: Date.now() - attemptStartedAt,
                      },
                    )}`,
                  );
                }
                break;
              } catch (bleErr) {
                lastBleError = bleErr;
                const rawBleMessage = serializeErrorLike(bleErr) || 'BLE connect failed';
                const stage = classifyMeshcoreBleTimeoutStage(rawBleMessage);
                const isTimeout = stage !== 'unknown';
                const isRetryable = isMeshcoreRetryableBleErrorMessage(rawBleMessage);
                console.warn(
                  `[useMeshCore] connect: BLE Noble IPC attempt failed ${formatStructuredLogDetail({
                    attempt,
                    maxAttempts: NOBLE_IPC_CONNECT_MAX_ATTEMPTS,
                    isTimeout,
                    isRetryable,
                    stage,
                    elapsedMs: Date.now() - attemptStartedAt,
                    message: rawBleMessage,
                  })}`,
                );
                ipcNobleRef.current?.cleanup();
                ipcNobleRef.current = null;
                if (!isRetryable || attempt >= NOBLE_IPC_CONNECT_MAX_ATTEMPTS) {
                  throw bleErr;
                }
                console.debug(
                  `[useMeshCore] connect: retrying BLE Noble IPC after retryable failure ${formatStructuredLogDetail(
                    {
                      nextAttempt: attempt + 1,
                      maxAttempts: NOBLE_IPC_CONNECT_MAX_ATTEMPTS,
                      isTimeout,
                      stage,
                    },
                  )}`,
                );
                // Brief pause before retry: gives BlueZ/WinRT time to release adapter state
                // after a failed or timed-out connect attempt.
                await new Promise<void>((r) => setTimeout(r, 1500));
              }
            }
            if (!connected) {
              if (lastBleError instanceof Error) throw lastBleError;
              throw new Error('BLE connect failed');
            }
          }
        } else if (type === 'serial') {
          console.debug('[useMeshCore] connect: serial requesting port...');
          if (!navigator.serial?.requestPort) throw new Error('Web Serial API not available');
          const port = await navigator.serial.requestPort();
          serialRawPort = port;
          persistSerialPortIdentity(serialRawPort);
          await (serialRawPort as any).open({ baudRate: 115200 });
          conn = new (WebSerialConnection as unknown as new (port: unknown) => MeshCoreConnection)(
            serialRawPort,
          );
          {
            const sid = localStorage.getItem(LAST_SERIAL_PORT_KEY);
            const sig = getPortSignature(serialRawPort);
            const parts = ['transport=serial', 'stack=meshcore'];
            if (sid) parts.push(`portId=${sid}`);
            if (sig.usbVendorId != null) parts.push(`usbVendorId=${sig.usbVendorId}`);
            if (sig.usbProductId != null) parts.push(`usbProductId=${sig.usbProductId}`);
            void window.electronAPI.log.logDeviceConnection(parts.join(' '));
          }
        } else {
          // tcp
          const host = tcpHost ?? 'localhost';
          console.debug('[useMeshCore] connect: TCP to', host);
          const tcpConn = new IpcTcpConnection(host, 5000);
          ipcTcpRef.current = tcpConn;
          await tcpConn.connect();
          conn = tcpConn.connection as unknown as MeshCoreConnection;
        }

        if (!conn) throw new Error('Connection initialization failed');
        if (meshcoreSetupGenerationRef.current !== setupGen) {
          void conn.close().catch(() => {});
          throw new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError');
        }
        await initConn(conn, setupGen);
        if (type === 'serial') {
          const portId = localStorage.getItem(LAST_SERIAL_PORT_KEY);
          const nodeName = selfInfoRef.current?.name?.trim() || null;
          if (portId && nodeName) {
            try {
              const key = 'mesh-client:serialPortNodeNames';
              const cache =
                parseStoredJson<Record<string, string>>(
                  localStorage.getItem(key),
                  'useMeshCore serialPortNodeNames cache',
                ) ?? {};
              cache[portId] = nodeName;
              localStorage.setItem(key, JSON.stringify(cache));
            } catch {
              // catch-no-log-ok localStorage write for serial port node name cache — non-critical
            }
          }
        }
        console.debug('[useMeshCore] connect: handshake complete, type=', type);
      } catch (err) {
        const isSetupAbort =
          err instanceof DOMException &&
          err.name === 'AbortError' &&
          err.message === MESHCORE_SETUP_ABORT_MESSAGE;
        if (isSetupAbort) {
          console.debug('[useMeshCore] connect: aborted (disconnect during setup)');
          setState({ status: 'disconnected', myNodeNum: 0, connectionType: null });
          ipcTcpRef.current?.cleanup();
          ipcTcpRef.current = null;
          ipcNobleRef.current?.cleanup();
          ipcNobleRef.current = null;
          if (type === 'serial') {
            connRef.current = null;
            if (conn) {
              try {
                await conn.close();
              } catch {
                // catch-no-log-ok port may already be in a bad state
              }
            }
            if (serialRawPort) {
              try {
                await serialRawPort.close();
              } catch {
                // catch-no-log-ok port may already be in a bad state
              }
            }
          }
          throw err;
        }
        const rawMessage = serializeErrorLike(err) || 'Connection failed';
        const safeMessage = rawMessage.trim() || 'Connection failed';
        const isAlreadyInProgress = /already in progress|Connection already in progress/i.test(
          safeMessage,
        );
        const isMissingServices = /could not find all requested services/i.test(safeMessage);
        const isPeripheralInUse = /already in use by the/i.test(safeMessage);
        const bleTimeoutStage =
          type === 'ble' ? classifyMeshcoreBleTimeoutStage(safeMessage) : 'unknown';
        const isBleConnectTimeout = bleTimeoutStage !== 'unknown';
        // When err is missing (e.g. library rejected with no reason), use a BLE-specific hint if we were connecting via BLE
        const fallbackMessage =
          type === 'ble' && err == null
            ? 'BLE connection failed (no error details from device). Try again or use Serial/USB.'
            : 'Connection failed';
        const displayMessage = safeMessage !== 'Connection failed' ? safeMessage : fallbackMessage;
        const timeoutMessage = meshcoreBleLinuxWebBluetooth
          ? bleTimeoutStage === 'protocol-handshake'
            ? 'MeshCore handshake timed out (Web Bluetooth). The radio may need a PIN paired with Linux first: use Remove & Re-pair Device and enter the PIN shown on the device, or pair with bluetoothctl, then tap Connect again.'
            : 'Bluetooth connection timed out while opening MeshCore over Web Bluetooth. Retry, keep the device awake, power-cycle BLE on the radio, or use Serial/TCP.'
          : bleTimeoutStage === 'protocol-handshake'
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
            meshcoreBleLinuxWebBluetooth
              ? `[useMeshCore] connect: BLE Web Bluetooth timed out ${formatStructuredLogDetail({
                  stage: bleTimeoutStage,
                })}`
              : `[useMeshCore] connect: BLE Noble IPC timed out; advise retry, BLE power-cycle, or Serial/TCP fallback ${formatStructuredLogDetail(
                  { stage: bleTimeoutStage },
                )}`,
          );
        }
        const errForLog = serializeErrorLike(err) || '(no error object)';
        console.error(
          `[useMeshCore] connect error ${formatStructuredLogDetail({
            userMessage: normalizedErr.message,
            raw: errForLog,
            bleTimeoutStage: isBleConnectTimeout ? bleTimeoutStage : null,
          })}`,
        );
        setState({ status: 'disconnected', myNodeNum: 0, connectionType: null });
        ipcTcpRef.current?.cleanup();
        ipcTcpRef.current = null;
        ipcNobleRef.current?.cleanup();
        ipcNobleRef.current = null;
        // Release serial port lock so the next attempt can open it
        if (type === 'serial') {
          connRef.current = null;
          if (conn) {
            try {
              await conn.close();
            } catch {
              // catch-no-log-ok port may already be in a bad state
            }
          }
          if (serialRawPort) {
            try {
              await serialRawPort.close();
            } catch {
              // catch-no-log-ok port may already be in a bad state
            }
          }
        }
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
        let serialPort: SerialPort | null = null;
        let serialConn: MeshCoreConnection | null = null;
        try {
          const setupGen = meshcoreSetupGenerationRef.current;
          if (!navigator.serial?.getPorts) throw new Error('Web Serial API not available');
          const ports = await navigator.serial.getPorts();
          serialPort = selectGrantedSerialPort(ports, lastSerialPortId);
          persistSerialPortIdentity(serialPort);
          await serialPort.open({ baudRate: 115200 });
          serialConn = new (WebSerialConnection as unknown as new (
            port: unknown,
          ) => MeshCoreConnection)(serialPort);
          await initConn(serialConn, setupGen);
          {
            const sid = localStorage.getItem(LAST_SERIAL_PORT_KEY);
            const sig = getPortSignature(serialPort);
            const parts = ['transport=serial', 'stack=meshcore'];
            if (sid) parts.push(`portId=${sid}`);
            if (sig.usbVendorId != null) parts.push(`usbVendorId=${sig.usbVendorId}`);
            if (sig.usbProductId != null) parts.push(`usbProductId=${sig.usbProductId}`);
            void window.electronAPI.log.logDeviceConnection(parts.join(' '));
          }
          console.debug('[useMeshCore] connectAutomatic serial: connected');
        } catch (err) {
          const isSetupAbort =
            err instanceof DOMException &&
            err.name === 'AbortError' &&
            err.message === MESHCORE_SETUP_ABORT_MESSAGE;
          if (isSetupAbort) {
            console.debug(
              '[useMeshCore] connectAutomatic serial: aborted (disconnect during setup)',
            );
          } else {
            console.error(
              '[useMeshCore] connectAutomatic serial error',
              serializeErrorLike(err) || err,
            );
          }
          setState({ status: 'disconnected', myNodeNum: 0, connectionType: null });
          connRef.current = null;
          // Always try both: conn.close() may throw if the read pump already errored
          if (serialConn) {
            try {
              await serialConn.close();
            } catch {
              // catch-no-log-ok port may already be in a bad state
            }
          }
          if (serialPort) {
            try {
              await serialPort.close();
            } catch {
              // catch-no-log-ok port may already be in a bad state
            }
          }
          throw err;
        }
      } else if (type === 'http') {
        let addr = httpAddress;
        if (!addr?.trim()) {
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
    // Transport teardown only: GATT disconnect / noble IPC / TCP close. Never OS-unpair or
    // BluetoothDevice.forget() here — pairing must survive disconnect so users can reconnect.
    meshcoreSetupGenerationRef.current += 1;
    // Cancel all pending ACK timers (each entry may be registered under multiple keys)
    const ackEntries = new Set(pendingAcksRef.current.values());
    for (const e of ackEntries) {
      clearTimeout(e.timeoutId);
    }
    pendingAcksRef.current.clear();
    // Clear pending CLI commands
    repeaterCommandServiceRef.current?.clear();

    try {
      await connRef.current?.close();
    } catch (e) {
      console.warn('[useMeshCore] disconnect: close error', e);
    }
    ipcTcpRef.current?.cleanup();
    ipcTcpRef.current = null;
    ipcNobleRef.current?.cleanup();
    ipcNobleRef.current = null;
    if (webBluetoothTransportRef.current) {
      await webBluetoothTransportRef.current.disconnect();
      webBluetoothTransportRef.current = null;
    }
    connRef.current = null;
    pubKeyMapRef.current.clear();
    pubKeyPrefixMapRef.current.clear();
    nicknameMapRef.current.clear();
    setNodes(new Map());
    setMessages([]);
    setChannels([]);
    setSelfInfo(null);
    setMeshcoreContactsForTelemetry([]);
    setMeshcoreAutoadd(null);
    setDeviceLogs([]);
    setTelemetry([]);
    setSignalTelemetry([]);
    setMeshcoreTraceResults(new Map());
    setMeshcoreNodeStatus(new Map());
    setMeshcoreNodeTelemetry(new Map());
    setMeshcoreTelemetryErrors(new Map());
    setMeshcoreNeighbors(new Map());
    setMeshcoreCliHistories(new Map());
    setMeshcoreCliErrors(new Map());
    setEnvironmentTelemetry([]);
    setState(INITIAL_STATE);
    console.debug('[useMeshCore] disconnect: complete');
  }, []);

  const sendMessage = useCallback(
    async (text: string, channelIdx: number, destNodeId?: number, replyId?: number) => {
      if (!connRef.current) {
        console.warn('[useMeshCore] sendMessage: no active connection, dropping send');
        return;
      }
      if (destNodeId !== undefined) {
        const pubKey = pubKeyMapRef.current.get(destNodeId);
        if (!pubKey) {
          throw new Error(
            'Cannot send DM: no encryption key for this contact. Wait for a full contact exchange, refresh contacts, or remove name-only stubs.',
          );
        }
        const sentAt = Date.now();
        let textToSend = text;
        let replyField: number | undefined;
        if (replyId != null && text.trim()) {
          const parent = findMeshcoreDmReplyParent(messagesRef.current, {
            peerNodeId: destNodeId,
            myNodeId: myNodeNumRef.current,
            replyKey: replyId,
          });
          if (parent) {
            textToSend = `@[${parent.sender_name}] ${text}`;
            replyField = replyId;
          }
        }
        // Optimistically add own message with 'sending' status (DM uses channel -1, not UI sendChannel)
        const tempMsg: ChatMessage = {
          sender_id: myNodeNumRef.current,
          sender_name: selfInfo?.name ?? 'Me',
          payload: text,
          channel: -1,
          timestamp: sentAt,
          status: 'sending',
          to: destNodeId,
          replyId: replyField,
        };
        setMessages((prev) => [...prev, tempMsg]);

        try {
          const result = await connRef.current.sendTextMessage(pubKey, textToSend);
          const ackCrc = result?.expectedAckCrc;
          const estTimeout = Math.max(result?.estTimeout ?? 30_000, MESHCORE_DM_ACK_TIMEOUT_MIN_MS);

          if (ackCrc !== undefined) {
            const ackKey = meshcoreDmAckKeyU32(ackCrc);
            const pendingMapKeys = meshcorePendingDmAckMapKeys(ackCrc);
            // Update the temp message with the real packetId
            setMessages((prev) =>
              prev.map((m) =>
                m === tempMsg || (m.timestamp === sentAt && m.status === 'sending')
                  ? { ...m, sender_id: myNodeNumRef.current, packetId: ackKey }
                  : m,
              ),
            );
            // Persist the outgoing DM with packet_id for status tracking
            void window.electronAPI.db
              .saveMeshcoreMessage({
                sender_id: myNodeNumRef.current || null,
                sender_name: selfInfo?.name ?? 'Me',
                payload: text,
                channel_idx: -1,
                timestamp: sentAt,
                status: 'sending',
                packet_id: ackKey,
                reply_id: replyField ?? null,
                to_node: destNodeId,
              })
              .catch((e: unknown) => {
                console.warn('[useMeshCore] saveMeshcoreMessage (outgoing) error', e);
              });

            // Schedule failure timeout
            const timeoutId = setTimeout(() => {
              for (const k of pendingMapKeys) {
                pendingAcksRef.current.delete(k);
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.packetId != null &&
                  meshcoreDmAckKeyU32(m.packetId) === ackKey &&
                  m.status === 'sending'
                    ? { ...m, status: 'failed' as const }
                    : m,
                ),
              );
              void window.electronAPI.db
                .updateMeshcoreMessageStatus(ackKey, 'failed')
                .catch((e: unknown) => {
                  console.warn('[useMeshCore] updateMeshcoreMessageStatus (timeout) error', e);
                });
            }, estTimeout);
            const pendingEntry: PendingDmAckEntry = {
              timeoutId,
              mapKeys: pendingMapKeys,
              canonicalPacketIdU32: ackKey,
            };
            for (const k of pendingMapKeys) {
              pendingAcksRef.current.set(k, pendingEntry);
            }
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
                channel_idx: -1,
                timestamp: sentAt,
                status: 'acked',
                reply_id: replyField ?? null,
                to_node: destNodeId,
              })
              .catch((e: unknown) => {
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
        let textToSend = text;
        let replyField: number | undefined;
        if (replyId != null && text.trim()) {
          const parent = messagesRef.current.find(
            (m) =>
              !m.to &&
              m.channel === channelIdx &&
              (m.packetId === replyId || m.timestamp === replyId) &&
              !(m.emoji != null && m.replyId != null),
          );
          if (parent) {
            textToSend = `@[${parent.sender_name}] ${text}`;
            replyField = replyId;
          }
        }
        try {
          const channelConn = connRef.current;
          if (channelConn) {
            await channelConn.sendChannelTextMessage(channelIdx, textToSend);
            addMessage({
              sender_id: myNodeNumRef.current,
              sender_name: selfInfo?.name ?? 'Me',
              payload: text,
              channel: channelIdx,
              timestamp: sentAt,
              status: 'acked',
              replyId: replyField,
            });
          } else if (mqttStatusRef.current === 'connected') {
            const mq = readMeshcoreMqttSettingsFromStorage();
            if (isLetsMeshSettings(mq.server)) {
              // LetsMesh MQTT is for authenticated packet/analyzer feeds (see docs), not MQTT-only
              // channel chat without a radio.
              return;
            }
            await window.electronAPI.mqtt.publishMeshcore({
              text: textToSend,
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
              replyId: replyField,
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
      const contactsRaw = await connRef.current.getContacts();
      const contacts = contactsRaw.map(meshcoreContactRawFromDevice);
      setMeshcoreContactsForTelemetry(contacts);
      const newNodes = await buildNodesFromContacts(contacts, {
        self: selfInfo,
        myNodeId: myNodeNumRef.current,
        previousNodes: nodesRef.current,
      });
      setNodes((prev) => mergeMeshcoreChatStubNodes(prev, newNodes));
      console.debug('[useMeshCore] refreshContacts: loaded', contacts.length);
    } catch (e) {
      console.error('[useMeshCore] refreshContacts error', e);
    }
  }, [buildNodesFromContacts, selfInfo]);

  const sendAdvert = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) {
      throw new Error('Not connected to radio');
    }
    console.debug('[useMeshCore] sendAdvert');
    try {
      await withTimeout(
        conn.sendFloodAdvert(),
        MESHCORE_SEND_FLOOD_ADVERT_TIMEOUT_MS,
        'MeshCore send flood advert',
      );
    } catch (e: unknown) {
      if (e == null || (e instanceof Error && e.message === '')) {
        console.warn('[useMeshCore] sendAdvert: empty rejection from radio');
        throw new Error('MeshCore advert rejected by radio');
      }
      throw e;
    }
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
    void window.electronAPI.db.deleteMeshcoreContact(nodeId).catch((e: unknown) => {
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
    await window.electronAPI.db.clearMeshcoreRepeaters().catch((e: unknown) => {
      console.warn('[useMeshCore] clearMeshcoreRepeaters error', e);
    });
  }, []);

  const clearAllMeshcoreContacts = useCallback(async () => {
    const conn = connRef.current;
    const myId = myNodeNumRef.current;
    if (conn && myId !== 0) {
      try {
        const raw = await conn.getContacts();
        for (const c of raw) {
          const id = pubkeyToNodeId(c.publicKey);
          if (id === myId) continue;
          await conn.removeContact(c.publicKey).catch((e: unknown) => {
            console.warn('[useMeshCore] clearAllMeshcoreContacts removeContact error', e);
          });
        }
      } catch (e: unknown) {
        console.warn('[useMeshCore] clearAllMeshcoreContacts getContacts error', e);
      }
    }
    try {
      await window.electronAPI.db.clearMeshcoreContacts();
    } catch (e: unknown) {
      console.warn('[useMeshCore] clearMeshcoreContacts DB error', e);
      throw e instanceof Error ? e : new Error(String(e));
    }
    setMeshcoreContactsForTelemetry([]);
    setNodes((prev) => {
      const self = prev.get(myId);
      if (myId === 0) return new Map();
      const next = new Map<number, MeshNode>();
      if (self) next.set(myId, self);
      return next;
    });
    const pk = pubKeyMapRef.current.get(myId);
    pubKeyMapRef.current.clear();
    pubKeyPrefixMapRef.current.clear();
    if (pk && myId !== 0) {
      pubKeyMapRef.current.set(myId, pk);
      const prefix = Array.from(pk.slice(0, 6))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      pubKeyPrefixMapRef.current.set(prefix, myId);
    }
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
            : e instanceof Error
              ? e
              : new Error(typeof e === 'string' ? e : 'Unknown error');
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
            : e instanceof Error
              ? e
              : new Error(typeof e === 'string' ? e : 'Unknown error');
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
                short_name: '',
                hw_model: CONTACT_TYPE_LABELS[selfInfo?.type ?? 0] ?? 'Unknown',
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
            : e instanceof Error
              ? e
              : new Error(typeof e === 'string' ? e : 'Unknown error');
        throw err;
      }
    },
    [selfInfo?.name, selfInfo?.type],
  );

  /** Successful Status/Ping prove reachability; sync `last_heard` when firmware `lastAdvert` is stale. */
  const bumpMeshcoreNodeLastHeardFromRpc = useCallback((nodeId: number) => {
    const existing = nodesRef.current.get(nodeId);
    if (!existing) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const lat = existing.latitude ?? null;
    const lon = existing.longitude ?? null;
    setNodes((prev) => {
      const cur = prev.get(nodeId);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(nodeId, { ...cur, last_heard: nowSec });
      return next;
    });
    void window.electronAPI.db
      .updateMeshcoreContactAdvert(nodeId, nowSec, lat, lon)
      .catch((e: unknown) => {
        console.warn('[useMeshCore] updateMeshcoreContactAdvert (RPC bump) error', e);
      });
  }, []);

  const traceRoute = useCallback(
    async (nodeId: number) => {
      const pubKey = pubKeyMapRef.current.get(nodeId);
      if (!pubKey) {
        setMeshcorePingErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, 'Node not found (no encryption key)');
          return next;
        });
        return;
      }
      if (!connRef.current) {
        setMeshcorePingErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, 'Not connected to device');
          return next;
        });
        return;
      }
      console.debug('[useMeshCore] traceRoute nodeId=', nodeId.toString(16).toUpperCase());
      setMeshcorePingErrors((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
      try {
        const result = await connRef.current.tracePath([pubKey], MESHCORE_TRACE_TIMEOUT_MS);
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
        bumpMeshcoreNodeLastHeardFromRpc(nodeId);
        console.debug(
          '[useMeshCore] traceRoute result: hops=',
          hops.length,
          'lastSnr=',
          result.lastSnr * 0.25,
        );
      } catch (e: unknown) {
        const rawErr = e instanceof Error ? e.message : String(e);
        const errMsg = rawErr && rawErr !== 'undefined' ? rawErr : 'request failed';
        let friendlyErr = errMsg.toLowerCase().includes('timeout')
          ? `Request timed out (~${Math.round(MESHCORE_TRACE_TIMEOUT_MS / 1000)}s)`
          : `Failed: ${errMsg}`;
        friendlyErr = meshcoreAppendRepeaterAuthHint(friendlyErr);
        setMeshcorePingErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, friendlyErr);
          return next;
        });
        console.warn('[useMeshCore] traceRoute error', e);
      }
    },
    [bumpMeshcoreNodeLastHeardFromRpc],
  );

  const requestRepeaterStatus = useCallback(
    async (nodeId: number) => {
      const pubKey = pubKeyMapRef.current.get(nodeId);
      if (!pubKey) {
        setMeshcoreStatusErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, 'Node not found (no encryption key)');
          return next;
        });
        return;
      }
      if (!connRef.current) {
        setMeshcoreStatusErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, 'Not connected to device');
          return next;
        });
        return;
      }
      console.debug(
        '[useMeshCore] requestRepeaterStatus nodeId=',
        nodeId.toString(16).toUpperCase(),
      );
      setMeshcoreStatusErrors((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
      try {
        await meshcoreRepeaterTryLogin(connRef.current, pubKey);
        const raw = await connRef.current.getStatus(pubKey, MESHCORE_STATUS_TIMEOUT_MS);
        const lastSnrDb = raw.last_snr * MESHCORE_RPC_SNR_RAW_TO_DB;
        const status: MeshCoreRepeaterStatus = {
          battMilliVolts: raw.batt_milli_volts,
          noiseFloor: raw.noise_floor,
          lastRssi: raw.last_rssi,
          lastSnr: lastSnrDb,
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
        setNodes((prev) => {
          const cur = prev.get(nodeId);
          if (!cur) return prev;
          const next = new Map(prev);
          next.set(nodeId, { ...cur, snr: lastSnrDb, rssi: raw.last_rssi });
          return next;
        });
        useRepeaterSignalStore.getState().recordSignal(nodeId, status.lastSnr);
        bumpMeshcoreNodeLastHeardFromRpc(nodeId);
        if (Number.isFinite(lastSnrDb) && Number.isFinite(raw.last_rssi)) {
          void window.electronAPI.db
            .updateMeshcoreContactLastRf(nodeId, lastSnrDb, raw.last_rssi)
            .catch((e: unknown) => {
              console.warn('[useMeshCore] updateMeshcoreContactLastRf error', e);
            });
        }
      } catch (e: unknown) {
        const rawErr = e instanceof Error ? e.message : String(e);
        const errMsg = rawErr && rawErr !== 'undefined' ? rawErr : 'request failed';
        let friendlyErr = errMsg.toLowerCase().includes('timeout')
          ? `Request timed out (~${Math.round(MESHCORE_STATUS_TIMEOUT_MS / 1000)}s)`
          : errMsg.toLowerCase().includes('auth') || errMsg.toLowerCase().includes('login')
            ? 'Authentication failed'
            : `Failed: ${errMsg}`;
        friendlyErr = meshcoreAppendRepeaterAuthHint(friendlyErr);
        setMeshcoreStatusErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, friendlyErr);
          return next;
        });
        console.warn('[useMeshCore] requestRepeaterStatus error', e);
      }
    },
    [bumpMeshcoreNodeLastHeardFromRpc],
  );

  const requestTelemetry = useCallback(async (nodeId: number) => {
    setMeshcoreTelemetryErrors((prev) => {
      const next = new Map(prev);
      next.delete(nodeId);
      return next;
    });
    const pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey) {
      setMeshcoreTelemetryErrors((prev) => {
        const next = new Map(prev);
        next.set(nodeId, 'Node not found (no encryption key)');
        return next;
      });
      return;
    }
    if (!connRef.current) {
      setMeshcoreTelemetryErrors((prev) => {
        const next = new Map(prev);
        next.set(nodeId, 'Not connected to device');
        return next;
      });
      return;
    }
    console.debug('[useMeshCore] requestTelemetry nodeId=', nodeId.toString(16).toUpperCase());
    try {
      await meshcoreRepeaterTryLogin(connRef.current, pubKey);
      const raw = await connRef.current.getTelemetry(pubKey, MESHCORE_TELEMETRY_TIMEOUT_MS);
      let entries: CayenneLppEntry[] = [];
      try {
        entries = CayenneLpp.parse(raw.lppSensorData) as CayenneLppEntry[];
      } catch (parseErr) {
        console.warn('[useMeshCore] requestTelemetry CayenneLpp.parse error', parseErr);
      }
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
      setMeshcoreTelemetryErrors((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
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
    } catch (e: unknown) {
      const rawErr = e instanceof Error ? e.message : String(e);
      const errMsg = rawErr && rawErr !== 'undefined' ? rawErr : 'request failed';
      let friendlyErr = errMsg.toLowerCase().includes('timeout')
        ? `Request timed out (~${Math.round(MESHCORE_TELEMETRY_TIMEOUT_MS / 1000)}s)`
        : errMsg.toLowerCase().includes('auth') || errMsg.toLowerCase().includes('login')
          ? 'Authentication failed'
          : `Failed: ${errMsg}`;
      friendlyErr = meshcoreAppendRepeaterAuthHint(friendlyErr);
      setMeshcoreTelemetryErrors((prev) => {
        const next = new Map(prev);
        next.set(nodeId, friendlyErr);
        return next;
      });
      console.warn('[useMeshCore] requestTelemetry error', e);
    }
  }, []);

  const requestNeighbors = useCallback(async (nodeId: number) => {
    const pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey) {
      const msg = meshcoreAppendRepeaterAuthHint('Node not found (no encryption key)');
      setMeshcoreNeighborErrors((prev) => {
        const next = new Map(prev);
        next.set(nodeId, msg);
        return next;
      });
      throw new Error(msg);
    }
    if (!connRef.current) {
      const msg = meshcoreAppendRepeaterAuthHint('Not connected to device');
      setMeshcoreNeighborErrors((prev) => {
        const next = new Map(prev);
        next.set(nodeId, msg);
        return next;
      });
      throw new Error(msg);
    }
    console.debug('[useMeshCore] requestNeighbors nodeId=', nodeId.toString(16).toUpperCase());
    setMeshcoreNeighborErrors((prev) => {
      const next = new Map(prev);
      next.delete(nodeId);
      return next;
    });
    try {
      await meshcoreRepeaterTryLogin(connRef.current, pubKey);
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
      setMeshcoreNeighborErrors((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
      console.debug(
        '[useMeshCore] requestNeighbors result: total=',
        raw.totalNeighboursCount,
        'fetched=',
        neighbours.length,
      );
    } catch (e: unknown) {
      const rawErr = e instanceof Error ? e.message : String(e);
      const errMsg = rawErr && rawErr !== 'undefined' ? rawErr : 'request failed';
      let friendlyErr = errMsg.toLowerCase().includes('timeout')
        ? `Request timed out (~${Math.round(MESHCORE_NEIGHBORS_TIMEOUT_MS / 1000)}s)`
        : errMsg.toLowerCase().includes('auth') || errMsg.toLowerCase().includes('login')
          ? 'Authentication failed'
          : `Failed: ${errMsg}`;
      friendlyErr = meshcoreAppendRepeaterAuthHint(friendlyErr);
      setMeshcoreNeighborErrors((prev) => {
        const next = new Map(prev);
        next.set(nodeId, friendlyErr);
        return next;
      });
      console.warn('[useMeshCore] requestNeighbors error', e);
      throw new Error(friendlyErr);
    }
  }, []);

  const sendRepeaterCliCommand = useCallback(
    async (nodeId: number, command: string, useSavedPath = false): Promise<string> => {
      const pubKey = pubKeyMapRef.current.get(nodeId);
      if (!pubKey) {
        setMeshcoreCliErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, 'Node not found (no encryption key)');
          return next;
        });
        throw new Error('Node not found (no encryption key)');
      }
      if (!connRef.current) {
        setMeshcoreCliErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, 'Not connected to device');
          return next;
        });
        throw new Error('Not connected to device');
      }

      setMeshcoreCliErrors((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });

      const service = repeaterCommandServiceRef.current ?? createRepeaterCommandService();
      repeaterCommandServiceRef.current ??= service;

      const path: Uint8Array[] = useSavedPath
        ? (() => {
            const trace = meshcoreTraceResults.get(nodeId);
            if (!trace || trace.hops.length === 0) return [];
            return trace.hops.map(() => pubKey);
          })()
        : [];

      const { token, promise } = service.registerPendingCommand(command, path);
      const commandWithToken = service.formatCommandWithToken(command, token);

      addCliHistoryEntry(nodeId, {
        type: 'sent',
        text: command,
        timestamp: Date.now(),
      });

      console.debug(
        '[useMeshCore] sendRepeaterCliCommand nodeId=',
        nodeId.toString(16).toUpperCase(),
        'token=',
        token,
        'command=',
        command,
      );

      try {
        await meshcoreRepeaterTryLogin(connRef.current, pubKey);
        const txtType = 1; // TxtTypes.CliData
        await connRef.current.sendTextMessage(pubKey, commandWithToken, txtType);

        const response = await promise;
        addCliHistoryEntry(nodeId, {
          type: 'received',
          text: response,
          timestamp: Date.now(),
        });
        bumpMeshcoreNodeLastHeardFromRpc(nodeId);
        return response;
      } catch (e: unknown) {
        const rawErr = e instanceof Error ? e.message : String(e);
        const errMsg = rawErr && rawErr !== 'undefined' ? rawErr : 'request failed';
        let friendlyErr = errMsg.toLowerCase().includes('timeout')
          ? `Request timed out`
          : errMsg.toLowerCase().includes('auth') || errMsg.toLowerCase().includes('login')
            ? 'Authentication failed'
            : `Failed: ${errMsg}`;
        friendlyErr = meshcoreAppendRepeaterAuthHint(friendlyErr);
        setMeshcoreCliErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, friendlyErr);
          return next;
        });
        addCliHistoryEntry(nodeId, {
          type: 'received',
          text: `[Error: ${friendlyErr}]`,
          timestamp: Date.now(),
        });
        console.warn('[useMeshCore] sendRepeaterCliCommand error', e);
        throw new Error(friendlyErr);
      }
    },
    [addCliHistoryEntry, bumpMeshcoreNodeLastHeardFromRpc, meshcoreTraceResults],
  );

  const applyMeshcoreTelemetryPrivacyPolicy = useCallback(
    async (modes: {
      telemetryModeBase: number;
      telemetryModeLoc: number;
      telemetryModeEnv: number;
    }) => {
      const conn = connRef.current;
      const s = selfInfoRef.current;
      if (!conn || !s) return;
      const manualByte = s.manualAddContacts ? 1 : 0;
      const frame = buildMeshcoreSetOtherParamsFrame(
        manualByte,
        packMeshcoreTelemetryModesByte(
          modes.telemetryModeBase,
          modes.telemetryModeLoc,
          modes.telemetryModeEnv,
        ),
        s.advertLocPolicy ?? 0,
        s.multiAcks ?? 0,
      );
      await new Promise<void>((resolve, reject) => {
        const onOk = () => {
          conn.off(0, onOk);
          conn.off(1, onErr);
          resolve();
        };
        const onErr = () => {
          conn.off(0, onOk);
          conn.off(1, onErr);
          reject(new Error('MeshCore rejected telemetry privacy settings'));
        };
        conn.once(0, onOk);
        conn.once(1, onErr);
        void conn.sendToRadioFrame(frame).catch((e: unknown) => {
          conn.off(0, onOk);
          conn.off(1, onErr);
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
      setSelfInfo((prev) =>
        prev
          ? {
              ...prev,
              telemetryModeBase: modes.telemetryModeBase,
              telemetryModeLoc: modes.telemetryModeLoc,
              telemetryModeEnv: modes.telemetryModeEnv,
            }
          : prev,
      );
    },
    [],
  );

  const applyMeshcoreContactAutoAdd = useCallback(
    async (params: {
      autoAddAll: boolean;
      overwriteOldest: boolean;
      chat: boolean;
      repeater: boolean;
      roomServer: boolean;
      sensor: boolean;
      maxHopsWire: number;
    }) => {
      const conn = connRef.current;
      if (!conn) throw new Error('Not connected');
      if (params.autoAddAll) {
        await conn.setAutoAddContacts();
        setManualAddContacts(false);
      } else {
        await conn.setManualAddContacts();
        setManualAddContacts(true);
      }
      try {
        localStorage.setItem(MANUAL_CONTACTS_KEY, String(!params.autoAddAll));
      } catch {
        // catch-no-log-ok localStorage quota or private mode — non-critical setting
      }
      setSelfInfo((prev) => (prev ? { ...prev, manualAddContacts: !params.autoAddAll } : prev));

      const configByte = mergeAutoaddConfigByte({
        overwriteOldest: params.overwriteOldest,
        chat: params.chat,
        repeater: params.repeater,
        roomServer: params.roomServer,
        sensor: params.sensor,
      });
      const hops = Math.max(0, Math.min(params.maxHopsWire, 64));
      const frame = buildSetAutoaddConfigFrame(configByte, hops);
      await new Promise<void>((resolve, reject) => {
        const onOk = () => {
          conn.off(0, onOk);
          conn.off(1, onErr);
          resolve();
        };
        const onErr = () => {
          conn.off(0, onOk);
          conn.off(1, onErr);
          reject(new Error('MeshCore rejected contact auto-add settings'));
        };
        conn.once(0, onOk);
        conn.once(1, onErr);
        void conn.sendToRadioFrame(frame).catch((e: unknown) => {
          conn.off(0, onOk);
          conn.off(1, onErr);
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
      setMeshcoreAutoadd({ autoaddConfig: configByte, autoaddMaxHops: hops });
    },
    [],
  );

  const toggleManualAddContacts = useCallback(async (manual: boolean) => {
    if (!connRef.current) return;
    try {
      if (manual) {
        await connRef.current.setManualAddContacts();
      } else {
        await connRef.current.setAutoAddContacts();
      }
      setManualAddContacts(manual);
      setSelfInfo((prev) => (prev ? { ...prev, manualAddContacts: manual } : prev));
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

  const importContacts = useCallback(async (): Promise<{
    imported: number;
    skipped: number;
    errors: string[];
  }> => {
    const raw = await window.electronAPI.meshcore.openJsonFile();
    if (raw == null) {
      console.debug('[useMeshCore] importContacts: file picker cancelled');
      return { imported: 0, skipped: 0, errors: [] };
    }
    console.debug('[useMeshCore] importContacts: file opened, length=', raw.length);

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
          '[useMeshCore] importContacts: found array under object key, length=',
          parsed.length,
        );
      } else {
        throw new Error('JSON root must be an array or an object containing an array');
      }
    } catch (e) {
      console.warn('[useMeshCore] importContacts: parse error', e);
      return { imported: 0, skipped: 0, errors: [e instanceof Error ? e.message : String(e)] };
    }
    console.debug('[useMeshCore] importContacts: parsed', parsed.length, 'entries');

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
        console.debug('[useMeshCore] importContacts: skipping non-object entry', r);
        skipped++;
        continue;
      }
      const rec = r as Record<string, unknown>;
      const firstString = (...vals: unknown[]) => {
        for (const v of vals) {
          if (typeof v === 'string' && v.trim()) return v.trim();
        }
        return '';
      };
      const name = firstString(rec.name, rec.label, rec.title, rec.node_name);
      const rawKey = firstString(rec.public_key, rec.pubkey, rec.key, rec.publicKey);
      if (!name || !rawKey) {
        console.debug('[useMeshCore] importContacts: skipping entry missing name or key', rec);
        skipped++;
        continue;
      }
      const pubKey = parsePublicKey(rawKey);
      if (!pubKey) {
        console.warn('[useMeshCore] importContacts: invalid public key for', name, rawKey);
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
        '[useMeshCore] importContacts: valid entry',
        name,
        nodeId.toString(16).toUpperCase(),
      );
      nicknameMapRef.current.set(nodeId, name);
      pubKeyMapRef.current.set(nodeId, pubKey);
      validEntries.push({ nodeId, name, pubKey, latitude, longitude });
    }

    console.debug(
      '[useMeshCore] importContacts: imported=',
      validEntries.length,
      'skipped=',
      skipped,
      'errors=',
      errors.length,
    );

    if (validEntries.length > 0) {
      const importSec = Math.floor(Date.now() / 1000);
      let dbRows: { node_id: number; last_advert: number | null }[] = [];
      try {
        dbRows = (await window.electronAPI.db.getMeshcoreContacts()) as {
          node_id: number;
          last_advert: number | null;
        }[];
      } catch (e: unknown) {
        console.warn('[useMeshCore] importContacts: getMeshcoreContacts for last_advert merge', e);
      }
      const dbLastAdvertById = new Map(dbRows.map((r) => [r.node_id, r.last_advert]));
      /** Built inside `setNodes` so we read merged `last_heard` before `nodesRef` catches up. */
      const lastAdvertForDbByNodeId = new Map<number, number>();

      setNodes((prev) => {
        const next = new Map(prev);
        for (const { nodeId, name, pubKey, latitude, longitude } of validEntries) {
          const existing = next.get(nodeId);
          const hasImportGps = latitude != null && longitude != null;
          const existingHasGps = existing?.latitude != null && existing?.longitude != null;
          if (existing) {
            const prevSec = lastHeardToUnixSeconds(existing.last_heard ?? 0);
            next.set(nodeId, {
              ...existing,
              long_name: name,
              short_name: '',
              latitude: hasImportGps && !existingHasGps ? latitude : existing.latitude,
              longitude: hasImportGps && !existingHasGps ? longitude : existing.longitude,
              ...(prevSec <= 0 ? { last_heard: importSec } : {}),
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
              short_name: '',
              hw_model: 'Repeater',
              battery: 0,
              snr: 0,
              rssi: 0,
              last_heard: importSec,
              latitude: hasImportGps ? latitude : null,
              longitude: hasImportGps ? longitude : null,
              favorited: false,
            });
          }
          const rowPrior = dbLastAdvertById.get(nodeId);
          const merged = next.get(nodeId);
          const uiPriorSec = merged != null ? lastHeardToUnixSeconds(merged.last_heard ?? 0) : 0;
          const lastAdvertForDb =
            rowPrior != null && rowPrior > 0 ? rowPrior : uiPriorSec > 0 ? uiPriorSec : importSec;
          lastAdvertForDbByNodeId.set(nodeId, lastAdvertForDb);
        }
        return next;
      });

      for (const { nodeId, name, pubKey, latitude, longitude } of validEntries) {
        const publicKeyHex = Array.from(pubKey)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const hasImportGps = latitude != null && longitude != null;
        const lastAdvertForDb = lastAdvertForDbByNodeId.get(nodeId) ?? importSec;
        void window.electronAPI.db
          .saveMeshcoreContact({
            node_id: nodeId,
            public_key: publicKeyHex,
            adv_name: null,
            contact_type: 2, // Repeater
            last_advert: lastAdvertForDb,
            adv_lat: hasImportGps ? latitude : null,
            adv_lon: hasImportGps ? longitude : null,
            last_snr: null,
            last_rssi: null,
            nickname: name,
          })
          .catch((e: unknown) => {
            console.warn('[useMeshCore] saveMeshcoreContact (import contacts) error', e);
          });
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
      const conn = connRef.current;
      const me = myNodeNumRef.current;
      if (reactedTo?.to != null) {
        const peerNodeId =
          reactedTo.sender_id === me && reactedTo.to != null ? reactedTo.to : reactedTo.sender_id;
        const pubKey = pubKeyMapRef.current.get(peerNodeId);
        if (!pubKey) {
          throw new Error(
            'Cannot send reaction: no encryption key for this contact. Wait for a full contact exchange, refresh contacts, or remove name-only stubs.',
          );
        }
        console.debug(
          '[useMeshCore] sendReaction: DM tapback to',
          peerNodeId.toString(16).toUpperCase(),
        );
        // Tapbacks are fire-and-forget; no ACK tracking or status UI for reactions
        await conn.sendTextMessage(pubKey, tapbackText);
        addMessage({
          sender_id: me,
          sender_name: selfInfo?.name ?? 'Me',
          payload: emojiChar,
          channel: -1,
          timestamp: Date.now(),
          status: 'acked',
          emoji,
          replyId,
          to: peerNodeId,
        });
      } else {
        const outboundChannel =
          reactedTo != null && typeof reactedTo.channel === 'number' && reactedTo.channel >= 0
            ? reactedTo.channel
            : channel === -1
              ? 0
              : channel;
        console.debug('[useMeshCore] sendReaction: channel tapback ch=', outboundChannel);
        // Tapbacks are fire-and-forget; no ACK tracking or status UI for reactions
        await conn.sendChannelTextMessage(outboundChannel, tapbackText);
        addMessage({
          sender_id: me,
          sender_name: selfInfo?.name ?? 'Me',
          payload: emojiChar,
          channel: outboundChannel,
          timestamp: Date.now(),
          status: 'acked',
          emoji,
          replyId,
        });
      }
    },
    [addMessage, selfInfo?.name],
  );

  // No-op stubs to satisfy the same interface shape used in App.tsx
  const noopAsync = useCallback(async () => {}, []);
  const noopVoid = useCallback(() => {}, []);

  const requestRefresh = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      const { batteryMilliVolts } = await conn.getBatteryVoltage();
      setSelfInfo((prev) => (prev ? { ...prev, batteryMilliVolts } : prev));
    } catch (e: unknown) {
      console.warn('[useMeshCore] requestRefresh getBatteryVoltage error', e);
    }
  }, []);

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
    if (getStoredMeshProtocol() === 'meshcore') {
      useDiagnosticsStore.getState().setOurPositionSource(pos?.source ?? null);
    }
    return pos;
  }, []);

  const getNodes = useCallback(() => nodes, [nodes]);
  const getFullNodeLabel = useCallback(
    (id: number) => nodes.get(id)?.long_name ?? id.toString(16).toUpperCase(),
    [nodes],
  );
  const getPickerStyleNodeLabel = useCallback(
    (id: number) => nodes.get(id)?.long_name ?? id.toString(16).toUpperCase(),
    [nodes],
  );
  const refreshNodesFromDb = useCallback(async () => {
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
  }, []);
  const refreshMessagesFromDb = useCallback(async () => {
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
  }, []);

  return useMemo(
    () => ({
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
      clearAllMeshcoreContacts,
      setOwner,
      traceRoute,
      requestRepeaterStatus,
      requestTelemetry,
      requestNeighbors,
      importContacts,
      toggleManualAddContacts,
      setMeshcoreChannel,
      deleteMeshcoreChannel,
      deviceLogs,
      meshcoreTraceResults,
      meshcoreNodeStatus,
      meshcoreStatusErrors,
      meshcoreNodeTelemetry,
      meshcoreTelemetryErrors,
      meshcorePingErrors,
      meshcoreNeighbors,
      meshcoreNeighborErrors,
      meshcoreCliHistories,
      meshcoreCliErrors,
      sendRepeaterCliCommand,
      clearCliHistory,
      manualAddContacts,
      mqttStatus,
      selfNodeId: state.myNodeNum,
      getNodes,
      getFullNodeLabel,
      getPickerStyleNodeLabel,
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
      requestRefresh,
      refreshOurPosition: refreshOurPositionNoop,
      sendPositionToDevice: sendPositionToDeviceMeshCore,
      updateGpsInterval: noopVoid,
      refreshNodesFromDb,
      refreshMessagesFromDb,
      connectAutomatic,
      telemetryDeviceUpdateInterval: undefined as number | undefined,
      setRadioParams,
      meshcoreContactsForTelemetry,
      meshcoreAutoadd,
      applyMeshcoreContactAutoAdd,
      refreshMeshcoreAutoaddFromDevice,
      applyMeshcoreTelemetryPrivacyPolicy,
    }),
    [
      state,
      nodes,
      messages,
      channels,
      selfInfo,
      connect,
      disconnect,
      sendMessage,
      getNodes,
      getFullNodeLabel,
      getPickerStyleNodeLabel,
      refreshNodesFromDb,
      refreshMessagesFromDb,
      sendAdvert,
      syncClock,
      refreshContacts,
      reboot,
      deleteNode,
      clearAllRepeaters,
      clearAllMeshcoreContacts,
      setOwner,
      traceRoute,
      requestRepeaterStatus,
      requestTelemetry,
      requestNeighbors,
      importContacts,
      toggleManualAddContacts,
      setMeshcoreChannel,
      deleteMeshcoreChannel,
      deviceLogs,
      meshcoreTraceResults,
      meshcoreNodeStatus,
      meshcoreStatusErrors,
      meshcoreNodeTelemetry,
      meshcoreTelemetryErrors,
      meshcorePingErrors,
      meshcoreNeighbors,
      meshcoreNeighborErrors,
      meshcoreCliHistories,
      meshcoreCliErrors,
      sendRepeaterCliCommand,
      clearCliHistory,
      manualAddContacts,
      mqttStatus,
      telemetry,
      signalTelemetry,
      environmentTelemetry,
      ourPosition,
      sendReaction,
      setNodeFavorited,
      requestRefresh,
      refreshOurPositionNoop,
      sendPositionToDeviceMeshCore,
      noopVoid,
      noopAsync,
      connectAutomatic,
      setRadioParams,
      meshcoreContactsForTelemetry,
      meshcoreAutoadd,
      applyMeshcoreContactAutoAdd,
      refreshMeshcoreAutoaddFromDevice,
      applyMeshcoreTelemetryPrivacyPolicy,
    ],
  );
}
