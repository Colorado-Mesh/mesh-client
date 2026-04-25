import {
  CayenneLpp,
  Connection,
  SerialConnection,
  WebSerialConnection,
} from '@liamcottle/meshcore.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { sanitizeLogMessage } from '@/main/sanitize-log-message';

import { parseMeshCoreRfPacket } from '../../shared/meshcoreRfPacketParse';
import { withTimeout } from '../../shared/withTimeout';
import {
  classifyMeshcoreBleTimeoutStage,
  isMeshcoreRetryableBleErrorMessage,
  MESHCORE_SETUP_ABORT_MESSAGE,
} from '../lib/bleConnectErrors';
import {
  classifyPayload,
  extractMeshtasticSenderId,
  meshtasticSenderIdForRawLogFallback,
} from '../lib/foreignLoraDetection';
import type { OurPosition } from '../lib/gpsSource';
import { resolveOurPosition } from '../lib/gpsSource';
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
import { queueLenFromMeshCoreCoreStatsRaw } from '../lib/meshcoreCoreStatsQueue';
import {
  buildMeshcoreGetNeighboursRequest,
  parseMeshcoreGetNeighboursResponse,
} from '../lib/meshcoreGetNeighboursBinary';
import {
  MESHCORE_CHAT_CORRELATE_WINDOW_MS,
  meshcoreCorrelateOrSynthesizeChatEntry,
} from '../lib/meshcoreRawPacketCorrelate';
import {
  meshcoreRawPacketLogFromBytesFallback,
  meshcoreRawPacketResolveFromParsed,
} from '../lib/meshcoreRawPacketSender';
import { shouldCoalesceSelfFloodAdvert } from '../lib/meshcoreRawSelfFloodAdvertCoalesce';
import { meshcoreRepeaterTryLogin } from '../lib/meshcoreRepeaterSession';
import {
  buildMeshcoreSetOtherParamsFrame,
  enrichMeshCoreSelfInfo,
  type MeshCoreSelfInfoEnriched,
  type MeshCoreSelfInfoWire,
  packMeshcoreTelemetryModesByte,
} from '../lib/meshcoreTelemetryPrivacy';
import {
  type MeshcoreTracePathMuxConnection,
  runMeshcoreTracePathMultiplexed,
} from '../lib/meshcoreTracePathMultiplex';
import {
  CONTACT_TYPE_LABELS,
  isMeshcoreTransportStatusChatLine,
  mergeHwModelOnContactUpdate,
  mergeMeshcoreChatStubNodes,
  MESHCORE_CONTACTS_WARNING_THRESHOLD,
  MESHCORE_MAX_CONTACTS,
  MESHCORE_RPC_SNR_RAW_TO_DB,
  meshcoreAppendRepeaterAuthHint,
  meshcoreChatStubNodeIdFromDisplayName,
  meshcoreConnectionImpliesUsbPower,
  meshcoreContactToMeshNode,
  meshcoreContactTypeFromHwModel,
  meshcoreInferHopsFromOutPath,
  meshcoreIsChatStubNodeId,
  meshcoreIsSyntheticPlaceholderPubKeyHex,
  meshcoreManufacturerModelFromDeviceQuery,
  meshcoreMergeContactHopsAwayFromPrevious,
  meshcoreMilliVoltsToApproximateBatteryPercent,
  meshcoreMinimalNodeFromAdvertEvent,
  meshcoreSliceContactOutPathForTrace,
  meshcoreSyntheticPlaceholderPubKeyHex,
  meshcoreTracePathLenToHops,
  minimalMeshcoreChatNode,
  pubkeyToNodeId,
} from '../lib/meshcoreUtils';
import { MeshcoreWebBluetoothConnection } from '../lib/meshcoreWebBluetoothConnection';
import { lastHeardToUnixSeconds, mergeMeshcoreLastHeardFromAdvert } from '../lib/nodeStatus';
import { parseStoredJson } from '../lib/parseStoredJson';
import { MAX_RAW_PACKET_LOG_ENTRIES } from '../lib/rawPacketLogConstants';
import {
  type CliHistoryEntry,
  createRepeaterCommandService,
  type RepeaterCommandService,
} from '../lib/repeaterCommandService';
import { createRepeaterRemoteRpcQueue } from '../lib/repeaterRemoteRpcQueue';
import {
  getPortSignature,
  LAST_SERIAL_PORT_KEY,
  persistSerialPortIdentity,
  selectGrantedSerialPort,
} from '../lib/serialPortSignature';
import { getStoredMeshProtocol } from '../lib/storedMeshProtocol';
import {
  MESHCORE_RAW_SELF_FLOOD_ADVERT_COALESCE_MS,
  MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
} from '../lib/timeConstants';
import { TransportWebBluetoothIpc } from '../lib/transportWebBluetoothIpc';
import type {
  ChatMessage,
  DeviceState,
  EnvironmentTelemetryPoint,
  MeshCoreLocalStats,
  MeshNode,
  MQTTStatus,
  NobleBleSessionId,
  TelemetryPoint,
} from '../lib/types';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { computePathHash, usePathHistoryStore } from '../stores/pathHistoryStore';
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
  /** Destination node for path outcome attribution. */
  destNodeId?: number;
  /** Path hash of the route used for this send (empty string = flood). */
  pathHash?: string;
}

function meshcoreContactRawFromDevice(c: MeshCoreContactRaw): MeshCoreContactRaw {
  const f = (c as { flags?: number }).flags;
  const flags = typeof f === 'number' && Number.isFinite(f) ? f & 0xff : 0;
  return { ...c, flags };
}

function contactToDbRow(
  contact: MeshCoreContactRaw,
  nickname?: string | null,
  onRadio = 0,
  lastSyncedFromRadio?: string | null,
  mergedHopsAway?: number,
) {
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
    hops_away: mergedHopsAway ?? meshcoreInferHopsFromOutPath(contact) ?? null,
    on_radio: onRadio ?? 0,
    last_synced_from_radio: lastSyncedFromRadio ?? null,
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
    rx_packet_fingerprint: msg.rxPacketFingerprintHex ?? null,
    reply_preview_text: msg.replyPreviewText ?? null,
    reply_preview_sender: msg.replyPreviewSender ?? null,
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
/** Max time to wait for PathUpdated (129) after a flood advert when priming trace route. */
const MESHCORE_TRACE_PRIME_WAIT_MS = 12_000;

/** Shown when multi-hop trace cannot run until the radio reports a route; UI auto-clears after {@link MESHCORE_PING_NO_ROUTE_ERROR_DISPLAY_MS}. */
export const MESHCORE_PING_NO_ROUTE_ERROR_MSG =
  'No route from radio yet — multi-hop trace needs a synced path. Wait for contact updates or reconnect.';
export const MESHCORE_PING_NO_ROUTE_ERROR_DISPLAY_MS = 20_000;

/** Clears {@link MESHCORE_PING_NO_ROUTE_ERROR_MSG} for `nodeId` if unchanged (traceRoute expiry). */
export function meshcorePingNoRouteErrorExpiryUpdate(
  prev: Map<number, string>,
  nodeId: number,
): Map<number, string> {
  const next = new Map(prev);
  if (next.get(nodeId) === MESHCORE_PING_NO_ROUTE_ERROR_MSG) {
    next.delete(nodeId);
  }
  return next;
}

export function serializeErrorLike(value: unknown): string {
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

      const instance = new TcpOverIpc();
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
      class NobleOverIpc extends MeshcoreConnectionBase {
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
        const frame = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
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
        } catch {
          // catch-no-log-ok best-effort disconnect after connect failure
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
  // Contact path management
  resetPath(pubKey: Uint8Array): Promise<void>;
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
  exportPrivateKey(): Promise<Uint8Array>;
  importPrivateKey(privateKey: Uint8Array): Promise<void>;
  // Waiting messages
  syncNextMessage(): Promise<unknown>;
}

/** Wait for companion push 0x81 (129 PathUpdated) for a specific node's pubkey. */
function waitForMeshcorePath129ForNode(
  conn: Pick<MeshCoreConnection, 'on' | 'off'>,
  nodeId: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      conn.off(129, on129);
      resolve(ok);
    };
    const on129 = (data: unknown) => {
      const d = data as { publicKey?: Uint8Array };
      if (d.publicKey?.length !== 32) return;
      if (pubkeyToNodeId(d.publicKey) !== nodeId) return;
      finish(true);
    };
    const t = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    conn.on(129, on129);
  });
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
  on_radio: number;
  last_synced_from_radio: string | null;
}

interface DeviceLogEntry {
  ts: number;
  level: string;
  source: string;
  message: string;
}

interface MeshCoreCoreStatsData {
  batteryMilliVolts: number;
  uptimeSecs: number;
  queueLen: number;
}

interface MeshCoreRadioStatsData {
  noiseFloor: number;
  lastRssi: number;
  lastSnr: number;
  txAirSecs: number;
  rxAirSecs: number;
}

interface MeshCorePacketStatsData {
  recv: number;
  sent: number;
  nSentFlood: number;
  nSentDirect: number;
  nRecvFlood: number;
  nRecvDirect: number;
  nRecvErrors?: number | null;
}

interface MeshCoreStatsResponse<TData> {
  type: number;
  raw: Uint8Array;
  data: TData;
}

const MANUAL_CONTACTS_KEY = 'mesh-client:meshcoreManualContacts';
const MESHCORE_COORD_SCALE = 1e6;

const INITIAL_STATE: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  connectionType: null,
};

const MAX_DEVICE_LOGS = 500;

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

/** Repeater RPCs (tracePath, getStatus, getTelemetry, sendBinaryRequest neighbours). */
const MESHCORE_REPEATER_RPC_TIMEOUT_MS = 120_000;
const MESHCORE_STATUS_TIMEOUT_MS = MESHCORE_REPEATER_RPC_TIMEOUT_MS;
const MESHCORE_TELEMETRY_TIMEOUT_MS = MESHCORE_REPEATER_RPC_TIMEOUT_MS;
const MESHCORE_NEIGHBORS_TIMEOUT_MS = MESHCORE_REPEATER_RPC_TIMEOUT_MS;
const MESHCORE_TRACE_TIMEOUT_MS = MESHCORE_REPEATER_RPC_TIMEOUT_MS;
const MAX_TELEMETRY_POINTS = 50;

const MAX_ENV_TELEMETRY_POINTS = 50;

/** @see @liamcottle/meshcore.js Constants.ResponseCodes.DeviceInfo */
const MESHCORE_RESPONSE_DEVICE_INFO = 13;

/** Companion protocol version byte sent with CMD DeviceQuery; must match meshcore.js onConnected. */
const MESHCORE_DEVICE_QUERY_APP_VER = 1;

/**
 * Normalizes an error from a MeshCore RPC call into a proper Error object.
 * Handles edge cases like undefined errors, errors without messages, and non-Error objects.
 */
function normalizeMeshCoreError(e: unknown, fallbackMessage: string): Error {
  if (e === undefined || (e instanceof Error && !e.message)) {
    return new Error(fallbackMessage);
  }
  if (e instanceof Error) {
    return e;
  }
  return new Error(typeof e === 'string' ? e : 'Unknown error');
}

/** meshcore.js `tracePath` may reject with `undefined`; avoid `String(object)` pitfalls. */
function meshcoreTraceRouteRejectReason(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (e === undefined || e === null) return 'radio rejected trace (no detail)';
  if (typeof e === 'string') return e;
  if (typeof e === 'number' || typeof e === 'boolean' || typeof e === 'bigint') return String(e);
  try {
    return JSON.stringify(e);
  } catch {
    // catch-no-log-ok JSON.stringify throws on circular/non-serializable values
    return 'unknown error';
  }
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
    if (m.id != null) return !fromDb.some((d) => d.id === m.id);
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
  rx_packet_fingerprint?: string | null;
  reply_preview_text?: string | null;
  reply_preview_sender?: string | null;
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
      rxPacketFingerprintHex:
        typeof r.rx_packet_fingerprint === 'string' &&
        /^[0-9A-Fa-f]{8}$/.test(r.rx_packet_fingerprint)
          ? r.rx_packet_fingerprint.toUpperCase()
          : undefined,
      replyPreviewText: typeof r.reply_preview_text === 'string' ? r.reply_preview_text : undefined,
      replyPreviewSender:
        typeof r.reply_preview_sender === 'string' ? r.reply_preview_sender : undefined,
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

interface MeshcoreTraceResultEntry {
  pathLen: number;
  pathHashes: number[];
  pathSnrs: number[];
  lastSnr: number;
  tag: number;
}

export function useMeshCore() {
  const [state, setState] = useState<DeviceState>(INITIAL_STATE);
  const [queueStatus, setQueueStatus] = useState<{
    free: number;
    maxlen: number;
    res: number;
  } | null>(null);
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
  const [rawPackets, setRawPackets] = useState<RxPacketEntry[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const [signalTelemetry, setSignalTelemetry] = useState<TelemetryPoint[]>([]);
  const [meshcoreTraceResults, setMeshcoreTraceResults] = useState<
    Map<number, MeshcoreTraceResultEntry>
  >(new Map());
  const meshcoreTraceResultsRef = useRef<Map<number, MeshcoreTraceResultEntry>>(new Map());
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
  // nodeId → outPath bytes (sliced to outPathLen) for tracePath calls
  const outPathMapRef = useRef<Map<number, Uint8Array>>(new Map());
  // nodeId → nickname (from JSON import or DB)
  const nicknameMapRef = useRef<Map<number, string>>(new Map());
  // Stable ref to current nodes so event listeners don't form stale closures
  const nodesRef = useRef<Map<number, MeshNode>>(new Map());
  const messagesRef = useRef<ChatMessage[]>([]);
  const rawPacketsRef = useRef<RxPacketEntry[]>([]);
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
  const repeaterRemoteRpcRef = useRef(createRepeaterRemoteRpcQueue());
  /** Debounced contacts refresh after path updates (event 129). */
  const meshcoreContactsRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** NodeIds that fired event 129 since last debounced contacts refresh (for path history recording). */
  const meshcorePathUpdatePendingRef = useRef<Set<number>>(new Set());
  /** Session-scoped: nodeIds that received PathUpdated (129) this connection (Ping/trace gating). */
  const meshcoreSessionPathUpdatedNodeIdsRef = useRef<Set<number>>(new Set());
  /** Bumps when {@link meshcoreSessionPathUpdatedNodeIdsRef} gains a node so UI re-evaluates Ping enablement. */
  const [meshcorePingRouteReadyEpoch, setMeshcorePingRouteReadyEpoch] = useState(0);
  /** Periodic poll for waiting messages when event 131 may have been missed. */
  const meshcoreWaitingMessagesPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Stable ref to the current connection's processWaitingMessages fn (set by setupEventListeners). */
  const processWaitingMessagesRef = useRef<(() => Promise<void>) | null>(null);
  /** Previous txAirSecs value for calculating channel utilization delta. */
  const prevTxAirSecsRef = useRef<number | null>(null);
  /** Previous timestamp for calculating channel utilization delta. */
  const prevStatsTimestampRef = useRef<number | null>(null);
  /** Periodic poll for local radio stats (see MESHCORE_STATS_POLL_MS in stats effect). */
  const meshcoreStatsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Auto-expire {@link MESHCORE_PING_NO_ROUTE_ERROR_MSG} after {@link MESHCORE_PING_NO_ROUTE_ERROR_DISPLAY_MS}. */
  const meshcorePingNoRouteExpiryTimersRef = useRef<Map<number, number>>(new Map());

  const clearMeshcorePingNoRouteExpiryTimer = useCallback((nodeId: number) => {
    const t = meshcorePingNoRouteExpiryTimersRef.current.get(nodeId);
    if (t != null) {
      clearTimeout(t);
      meshcorePingNoRouteExpiryTimersRef.current.delete(nodeId);
    }
  }, []);

  /** Fetch and update local radio stats (core, radio, packet). Called by requestRefresh and on connect. */
  const fetchAndUpdateLocalStats = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) return;
    let coreStats: Awaited<ReturnType<MeshCoreConnection['getStatsCore']>>;
    try {
      coreStats = await conn.getStatsCore();
    } catch {
      // catch-no-log-ok getStatsCore optional on some transports
      return;
    }

    const core = coreStats.data;
    // STATS CORE queue_len = PacketManager outbound total (MeshCore stats_binary_frames.md).
    // Do not merge conn.getStatus(self): companion CMD_SEND_STATUS_REQ resolves the pubkey via
    // lookupContactByPubKey; self is often not a contact row, so the request fails with NOT_FOUND.
    const queueLenCapped = Math.min(
      queueLenFromMeshCoreCoreStatsRaw(coreStats.raw, core.queueLen),
      256,
    );
    setQueueStatus({ free: 256 - queueLenCapped, maxlen: 256, res: 0 });
    const now = Date.now();
    setSelfInfo((prev) => (prev ? { ...prev, batteryMilliVolts: core.batteryMilliVolts } : prev));

    if (core.batteryMilliVolts > 0) {
      const batteryLevel = meshcoreMilliVoltsToApproximateBatteryPercent(core.batteryMilliVolts);
      const voltage = core.batteryMilliVolts / 1000;
      setTelemetry((prev) =>
        [...prev, { timestamp: now, voltage, batteryLevel }].slice(-MAX_TELEMETRY_POINTS),
      );
    }

    let radioStats: Awaited<ReturnType<MeshCoreConnection['getStatsRadio']>>;
    let packetStats: Awaited<ReturnType<MeshCoreConnection['getStatsPackets']>>;
    try {
      [radioStats, packetStats] = await Promise.all([conn.getStatsRadio(), conn.getStatsPackets()]);
    } catch {
      // catch-no-log-ok getStatsRadio/getStatsPackets optional
      return;
    }

    const radio = radioStats.data;
    const packet = packetStats.data;

    let channelUtilization: number | undefined;
    let airUtilTx: number | undefined;

    if (prevTxAirSecsRef.current !== null && prevStatsTimestampRef.current !== null) {
      const deltaTxAirSecs = radio.txAirSecs - prevTxAirSecsRef.current;
      const deltaTimeSecs = (now - prevStatsTimestampRef.current) / 1000;
      if (deltaTimeSecs > 0 && deltaTxAirSecs >= 0) {
        airUtilTx = (deltaTxAirSecs / deltaTimeSecs) * 100;
        channelUtilization = airUtilTx;
      }
    }

    prevTxAirSecsRef.current = radio.txAirSecs;
    prevStatsTimestampRef.current = now;

    const localStats: MeshCoreLocalStats = {
      batteryMilliVolts: core.batteryMilliVolts,
      uptimeSecs: core.uptimeSecs,
      queueLen: queueLenCapped,
      noiseFloor: radio.noiseFloor,
      lastRssi: radio.lastRssi,
      lastSnr: radio.lastSnr,
      txAirSecs: radio.txAirSecs,
      rxAirSecs: radio.rxAirSecs,
      recv: packet.recv,
      sent: packet.sent,
      nSentFlood: packet.nSentFlood,
      nSentDirect: packet.nSentDirect,
      nRecvFlood: packet.nRecvFlood,
      nRecvDirect: packet.nRecvDirect,
      nRecvErrors: packet.nRecvErrors ?? undefined,
      channelUtilization,
      airUtilTx,
    };

    const myNodeId = myNodeNumRef.current || state.myNodeNum;
    if (myNodeId > 0) {
      setNodes((prev) => {
        const updated = new Map(prev);
        const node = prev.get(myNodeId);
        const fallbackName =
          selfInfoRef.current?.name?.trim() || `Node-${myNodeId.toString(16).toUpperCase()}`;
        updated.set(myNodeId, {
          ...(node ?? {
            node_id: myNodeId,
            long_name: fallbackName,
            short_name: '',
            hw_model: 'Unknown',
            battery: meshcoreMilliVoltsToApproximateBatteryPercent(core.batteryMilliVolts) ?? 0,
            snr: radio.lastSnr,
            rssi: radio.lastRssi,
            last_heard: Math.floor(now / 1000),
            latitude: null,
            longitude: null,
            hops_away: 0,
          }),
          voltage: core.batteryMilliVolts / 1000,
          channel_utilization: channelUtilization ?? node?.channel_utilization,
          air_util_tx: airUtilTx ?? node?.air_util_tx,
          meshcore_local_stats: localStats,
        });
        return updated;
      });
    }
  }, [state.myNodeNum]);

  const buildNodesFromContactsRef = useRef<
    | ((
        contacts: MeshCoreContactRaw[],
        opts?: {
          self?: MeshCoreSelfInfo | null;
          myNodeId?: number;
          previousNodes?: Map<number, MeshNode>;
        },
      ) => Promise<Map<number, MeshNode>>)
    | null
  >(null);

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
    const pingNoRouteTimers = meshcorePingNoRouteExpiryTimersRef.current;
    return () => {
      meshcoreHookMountedRef.current = false;
      if (meshcoreWaitingMessagesPollRef.current) {
        clearInterval(meshcoreWaitingMessagesPollRef.current);
        meshcoreWaitingMessagesPollRef.current = null;
      }
      if (meshcoreStatsPollRef.current) {
        clearInterval(meshcoreStatsPollRef.current);
        meshcoreStatsPollRef.current = null;
      }
      pingNoRouteTimers.forEach((timerId) => {
        clearTimeout(timerId);
      });
      pingNoRouteTimers.clear();
    };
  }, []);

  useEffect(() => {
    selfInfoRef.current = selfInfo;
  }, [selfInfo]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    meshcoreTraceResultsRef.current = meshcoreTraceResults;
  }, [meshcoreTraceResults]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    rawPacketsRef.current = rawPackets;
  }, [rawPackets]);

  useEffect(() => {
    myNodeNumRef.current = state.myNodeNum;
  }, [state.myNodeNum]);

  // Start stats polling when connected
  useEffect(() => {
    if (state.status === 'configured') {
      const MESHCORE_STATS_POLL_MS = 30 * 1_000;
      if (meshcoreStatsPollRef.current) clearInterval(meshcoreStatsPollRef.current);
      meshcoreStatsPollRef.current = setInterval(() => {
        if (!meshcoreHookMountedRef.current) return;
        void fetchAndUpdateLocalStats().catch((e: unknown) => {
          console.warn('[useMeshCore] periodic stats poll failed', e);
        });
      }, MESHCORE_STATS_POLL_MS);

      // Initial stats fetch on connect
      void fetchAndUpdateLocalStats().catch((e: unknown) => {
        console.warn('[useMeshCore] initial stats fetch failed', e);
      });
    }
    return () => {
      if (meshcoreStatsPollRef.current) {
        clearInterval(meshcoreStatsPollRef.current);
        meshcoreStatsPollRef.current = null;
      }
    };
  }, [state.status, state.myNodeNum, fetchAndUpdateLocalStats]);

  useEffect(() => {
    mqttStatusRef.current = mqttStatus;
  }, [mqttStatus]);

  useEffect(() => {
    return window.electronAPI.mqtt.onStatus(({ status: s, protocol }) => {
      if (protocol !== 'meshcore') return;
      const st = s;
      mqttStatusRef.current = st;
      setMqttStatus(st);
    });
  }, []);

  // Load persisted MeshCore contacts + messages from DB on mount (no device required — matches Meshtastic).
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.electronAPI.db.getMeshcoreContacts(),
      window.electronAPI.db.getMeshcoreMessages(undefined, 500),
      window.electronAPI.db.getNodes(),
    ])
      .then(([rows, dbMsgs, savedNodes]) => {
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
          hops_away: number | null;
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
            hops_away: row.hops_away ?? undefined,
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
        // Merge hops_away from nodes table as fallback for any nodes missing it
        for (const n of savedNodes as { node_id: number; hops_away: number | null }[]) {
          if (n.hops_away != null) {
            const existing = initial.get(n.node_id);
            if (existing && existing.hops_away === undefined) {
              initial.set(n.node_id, { ...existing, hops_away: n.hops_away });
            }
          }
        }
        const mapped = mapMeshcoreDbRowsToChatMessages(dbMsgs as MeshcoreMessageDbRow[]);
        setNodes(mergeStubNodesFromMeshcoreMessages(initial, mapped));
        if (mapped.length > 0) {
          setMessages((prev) => mergeMeshcoreDbHydrationWithLive(prev, mapped));
        }
      })
      .catch((e: unknown) => {
        console.warn('[useMeshCore] load contacts/messages from DB on mount', e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mirror self radio battery into the home MeshNode (node list + node detail); refreshContacts rebuilds from selfInfo
  useEffect(() => {
    const myId = state.myNodeNum;
    const mV = selfInfo?.batteryMilliVolts;
    if (myId <= 0 || mV == null || !Number.isFinite(mV)) return;
    const voltage = mV / 1000;
    const battery = meshcoreMilliVoltsToApproximateBatteryPercent(mV) ?? 0;
    queueMicrotask(() => {
      setNodes((prev) => {
        const existing = prev.get(myId);
        if (!existing) return prev;
        if (existing.voltage === voltage && existing.battery === battery) return prev;
        const next = new Map(prev);
        next.set(myId, { ...existing, voltage, battery });
        return next;
      });
    });
  }, [state.myNodeNum, selfInfo?.batteryMilliVolts]);

  // Connection panel: meshcore.js exposes only millivolts—no charging bit (unlike Meshtastic batteryLevel > 100).
  // We set batteryCharging from transport: USB serial usually means VBUS. BLE/TCP cannot detect wall charging.
  useEffect(() => {
    const mV = selfInfo?.batteryMilliVolts;
    if (mV == null || !Number.isFinite(mV)) {
      queueMicrotask(() => {
        setState((prev) => {
          if (prev.batteryPercent === undefined && prev.batteryCharging === undefined) return prev;
          return { ...prev, batteryPercent: undefined, batteryCharging: undefined };
        });
      });
      return;
    }
    const pct = meshcoreMilliVoltsToApproximateBatteryPercent(mV);
    const charging = meshcoreConnectionImpliesUsbPower(state.connectionType);
    queueMicrotask(() => {
      setState((prev) => {
        if (prev.batteryPercent === pct && prev.batteryCharging === charging) return prev;
        return { ...prev, batteryPercent: pct, batteryCharging: charging };
      });
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
    return window.electronAPI.mqtt.onMeshcoreChat((raw: unknown) => {
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
            on_radio: 0,
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
  }, [addMessage]);

  const buildNodesFromContacts = useCallback(
    async (
      contacts: MeshCoreContactRaw[],
      opts?: {
        self?: MeshCoreSelfInfo | null;
        myNodeId?: number;
        /** Prior UI node map so `last_heard` from live events is preserved when device sends `lastAdvert: 0`. */
        previousNodes?: Map<number, MeshNode>;
        /** If true, save contacts with on_radio=1. */
        contactsFromRadio?: boolean;
      },
    ): Promise<Map<number, MeshNode>> => {
      const prevSnap = opts?.previousNodes ?? new Map<number, MeshNode>();
      const nextNodes = new Map<number, MeshNode>();
      pubKeyMapRef.current.clear();
      pubKeyPrefixMapRef.current.clear();
      outPathMapRef.current.clear();
      for (const contact of contacts) {
        const base = meshcoreContactToMeshNode(contact);
        const last_heard = mergeMeshcoreLastHeardFromAdvert(
          contact.lastAdvert,
          prevSnap.get(base.node_id)?.last_heard,
        );
        const prevNode = prevSnap.get(base.node_id);
        const slicedPath = meshcoreSliceContactOutPathForTrace(contact.outPath, contact.outPathLen);
        const hopsAway = meshcoreMergeContactHopsAwayFromPrevious(
          base.hops_away,
          prevNode?.hops_away,
          slicedPath.length,
        );
        const node: MeshNode = { ...base, last_heard, hops_away: hopsAway };
        const mergedHwModel = mergeHwModelOnContactUpdate(prevNode?.hw_model, node.hw_model);
        if (mergedHwModel !== node.hw_model) {
          node.hw_model = mergedHwModel;
        }
        nextNodes.set(node.node_id, node);
        pubKeyMapRef.current.set(node.node_id, contact.publicKey);
        outPathMapRef.current.set(node.node_id, slicedPath);
        const contactPathBytes = slicedPath.length > 0 ? Array.from(slicedPath) : [];
        if (contactPathBytes.length > 0) {
          const pathHash = computePathHash(contactPathBytes);
          const existing = usePathHistoryStore.getState().records.get(node.node_id) ?? [];
          if (!existing.some((r) => r.pathHash === pathHash)) {
            const hops = node.hops_away ?? Math.max(0, contactPathBytes.length - 1);
            usePathHistoryStore
              .getState()
              .recordPathUpdated(node.node_id, contactPathBytes, hops, false);
          }
        }
        const prefix = Array.from(contact.publicKey.slice(0, 6))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        pubKeyPrefixMapRef.current.set(prefix, node.node_id);
        // Save with on_radio=1 when contacts came from radio
        const now = new Date().toISOString();
        const onRadio = opts?.contactsFromRadio ? 1 : 0;
        const prevHopsAway = prevNode?.hops_away;
        const hopsToSave = hopsAway ?? prevHopsAway ?? undefined;
        const dbRow = contactToDbRow(contact, undefined, onRadio, now, hopsToSave);
        void window.electronAPI.db.saveMeshcoreContact(dbRow).catch((e: unknown) => {
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
            const newHwModel = CONTACT_TYPE_LABELS[row.contact_type] ?? 'Unknown';
            const prevNode = prevSnap.get(row.node_id);
            const prevHwModel = prevNode?.hw_model;
            const mergedHwModel =
              prevHwModel && prevHwModel !== 'None' && prevHwModel !== 'Unknown'
                ? prevHwModel
                : newHwModel;
            nextNodes.set(row.node_id, {
              node_id: row.node_id,
              long_name:
                row.nickname ?? row.adv_name ?? `Node-${row.node_id.toString(16).toUpperCase()}`,
              short_name: '',
              hw_model: mergedHwModel,
              battery: 0,
              snr: row.last_snr ?? 0,
              rssi: row.last_rssi ?? 0,
              last_heard,
              latitude: row.adv_lat ?? null,
              longitude: row.adv_lon ?? null,
              favorited: row.favorited === 1,
              hops_away: row.hops_away ?? prevSnap.get(row.node_id)?.hops_away,
            });
          }
        }
        for (const row of dbContacts) {
          const existing = nextNodes.get(row.node_id);
          if (!existing) continue;
          if (existing.hops_away === undefined && row.hops_away != null) {
            nextNodes.set(row.node_id, { ...existing, hops_away: row.hops_away });
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

      for (const [nodeId, tr] of meshcoreTraceResultsRef.current) {
        if (myNodeId > 0 && nodeId === myNodeId) continue;
        const existing = nextNodes.get(nodeId);
        if (existing) {
          nextNodes.set(nodeId, {
            ...existing,
            hops_away: meshcoreTracePathLenToHops(tr.pathLen),
          });
        }
      }

      return nextNodes;
    },
    [],
  );

  useEffect(() => {
    buildNodesFromContactsRef.current = buildNodesFromContacts;
  }, [buildNodesFromContacts]);

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
          return;
        }
        const nodeId = pubkeyToNodeId(d.publicKey);
        if (nodeId === 0) return;
        const nowSec = Math.floor(Date.now() / 1000);
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
          const advertType = typeof d.type === 'number' && Number.isFinite(d.type) ? d.type : -1;
          const newHwModel =
            advertType >= 0 ? (CONTACT_TYPE_LABELS[advertType] ?? 'Unknown') : existing.hw_model;
          const mergedHwModel = mergeHwModelOnContactUpdate(existing.hw_model, newHwModel);
          next.set(nodeId, {
            ...existing,
            last_heard: lastHeard,
            hw_model: mergedHwModel,
            latitude: hasLat ? d.advLat! / MESHCORE_COORD_SCALE : existing.latitude,
            longitude: hasLon ? d.advLon! / MESHCORE_COORD_SCALE : existing.longitude,
            ...(nick
              ? { long_name: nick, short_name: '' }
              : applyAdvertName
                ? { long_name: advNameTrim, short_name: '' }
                : {}),
          });
          if (mergedHwModel !== existing.hw_model) {
            const mergedType = meshcoreContactTypeFromHwModel(mergedHwModel);
            if (mergedType !== undefined) {
              void window.electronAPI.db
                .updateMeshcoreContactType(nodeId, mergedType)
                .catch((e: unknown) => {
                  console.warn('[useMeshCore] updateMeshcoreContactType error', e);
                });
            }
          }
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
              on_radio: 1,
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
          return;
        }
        const nodeId = pubkeyToNodeId(d.publicKey);
        if (nodeId === 0) return;
        if (!meshcoreSessionPathUpdatedNodeIdsRef.current.has(nodeId)) {
          meshcoreSessionPathUpdatedNodeIdsRef.current.add(nodeId);
          setMeshcorePingRouteReadyEpoch((e) => e + 1);
        }
        const nowSec = Math.floor(Date.now() / 1000);
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
          next.set(nodeId, {
            ...existing,
            last_heard: Math.max(existing.last_heard ?? 0, nowSec),
          });
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
              on_radio: 1,
            })
            .catch((e: unknown) => {
              console.warn('[useMeshCore] saveMeshcoreContact (event 129 new) error', e);
            });
        }
        // Accumulate nodeIds for path history recording after the debounced refresh
        meshcorePathUpdatePendingRef.current.add(nodeId);
        // Refresh route bytes quickly so trace/ping can use outPath before the debounced full rebuild.
        void (async () => {
          if (!connRef.current) return;
          try {
            const contactsRaw = await connRef.current.getContacts();
            const contacts = contactsRaw.map(meshcoreContactRawFromDevice);
            for (const contact of contacts) {
              const cNodeId = pubkeyToNodeId(contact.publicKey);
              if (cNodeId !== nodeId) continue;
              const sliced = meshcoreSliceContactOutPathForTrace(
                contact.outPath,
                contact.outPathLen,
              );
              if (sliced.length > 0) {
                outPathMapRef.current.set(cNodeId, sliced);
                const pathBytes = Array.from(sliced);
                const hops =
                  meshcoreInferHopsFromOutPath(contact) ?? Math.max(0, pathBytes.length - 1);
                usePathHistoryStore.getState().recordPathUpdated(cNodeId, pathBytes, hops, false);
                meshcorePathUpdatePendingRef.current.delete(cNodeId);
              }
              break;
            }
          } catch (e: unknown) {
            console.warn('[useMeshCore] immediate path refresh after 129 error', e);
          }
        })();
        // Path updates may change hop counts; debounced contacts refresh to fetch updated outPathLen
        if (meshcoreContactsRefreshTimerRef.current) {
          clearTimeout(meshcoreContactsRefreshTimerRef.current);
        }
        meshcoreContactsRefreshTimerRef.current = setTimeout(() => {
          void (async () => {
            if (!connRef.current) return;
            const buildFn = buildNodesFromContactsRef.current;
            if (!buildFn) return;
            try {
              const contactsRaw = await connRef.current.getContacts();
              const contacts = contactsRaw.map(meshcoreContactRawFromDevice);
              setMeshcoreContactsForTelemetry(contacts);
              const newNodes = await buildFn(contacts, {
                self: selfInfoRef.current,
                myNodeId: myNodeNumRef.current,
                previousNodes: nodesRef.current,
              });
              setNodes((prev) => mergeMeshcoreChatStubNodes(prev, newNodes));
              // Record path history for any nodeIds that triggered event 129
              const pendingIds = meshcorePathUpdatePendingRef.current;
              meshcorePathUpdatePendingRef.current = new Set();
              for (const contact of contacts) {
                const cNodeId = pubkeyToNodeId(contact.publicKey);
                if (!pendingIds.has(cNodeId)) continue;
                const sliced = meshcoreSliceContactOutPathForTrace(
                  contact.outPath,
                  contact.outPathLen,
                );
                const pathBytes = sliced.length > 0 ? Array.from(sliced) : [];
                if (pathBytes.length > 0) {
                  const hops = newNodes.get(cNodeId)?.hops_away ?? 0;
                  usePathHistoryStore.getState().recordPathUpdated(cNodeId, pathBytes, hops, false);
                }
              }
            } catch (e) {
              console.warn('[useMeshCore] debounced contacts refresh error', e);
            }
          })();
        }, 2000);
      });

      // Push: send confirmed — event 0x82 = 130; resolve pending DM delivery
      // ackCode: 0x80 = RESP_CODE_ACK (success), 0x81 = RESP_CODE_NACK (failure)
      conn.on(130, (data: unknown) => {
        const d = data as { ackCode: number; roundTrip?: number };
        if (typeof d.ackCode !== 'number' || !Number.isFinite(d.ackCode)) {
          console.warn('[useMeshCore] event 130: non-numeric ackCode', d.ackCode);
          return;
        }
        const isNack = d.ackCode === 0x81 || d.ackCode === 129; // 0x81 or signed representation
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
            const newStatus = isNack ? 'failed' : 'acked';
            setMessages((prev) =>
              prev.map((m) =>
                m.packetId != null &&
                meshcoreDmAckKeyU32(m.packetId) === lateKey &&
                m.sender_id === selfId &&
                m.to != null &&
                (m.status === 'sending' || m.status === 'failed')
                  ? { ...m, status: newStatus }
                  : m,
              ),
            );
            void window.electronAPI.db
              .updateMeshcoreMessageStatus(lateKey, newStatus)
              .catch((e: unknown) => {
                console.warn('[useMeshCore] updateMeshcoreMessageStatus (late 130) error', e);
              });
            return;
          }
          return;
        }
        clearTimeout(pending.timeoutId);
        for (const k of pending.mapKeys) {
          pendingAcksRef.current.delete(k);
        }
        if (pending.destNodeId != null && pending.pathHash != null) {
          usePathHistoryStore
            .getState()
            .recordOutcome(
              pending.destNodeId,
              pending.pathHash,
              !isNack,
              !isNack && typeof d.roundTrip === 'number' ? d.roundTrip : undefined,
            );
        }
        const canon = pending.canonicalPacketIdU32;
        const newStatus = isNack ? 'failed' : 'acked';
        setMessages((prev) =>
          prev.map((m) =>
            m.packetId != null && meshcoreDmAckKeyU32(m.packetId) === canon
              ? { ...m, status: newStatus }
              : m,
          ),
        );
        void window.electronAPI.db
          .updateMeshcoreMessageStatus(canon, newStatus)
          .catch((e: unknown) => {
            console.warn('[useMeshCore] updateMeshcoreMessageStatus error', e);
          });
      });

      // Push: new contact discovered — event 0x8A = 138
      conn.on(138, (data: unknown) => {
        const d = meshcoreContactRawFromDevice(data as MeshCoreContactRaw);
        const node = meshcoreContactToMeshNode(d);
        pubKeyMapRef.current.set(node.node_id, d.publicKey);
        outPathMapRef.current.set(
          node.node_id,
          meshcoreSliceContactOutPathForTrace(d.outPath, d.outPathLen),
        );
        const prefix = Array.from(d.publicKey.slice(0, 6))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        pubKeyPrefixMapRef.current.set(prefix, node.node_id);
        const nick = nicknameMapRef.current.get(node.node_id);
        const nodeWithNick = nick ? { ...node, long_name: nick, short_name: '' } : node;
        setNodes((prev) => {
          const next = new Map(prev);
          const existing = prev.get(nodeWithNick.node_id);
          next.set(nodeWithNick.node_id, {
            ...(existing ?? {}),
            ...nodeWithNick,
            hw_model: mergeHwModelOnContactUpdate(existing?.hw_model, nodeWithNick.hw_model),
            hops_away: nodeWithNick.hops_away ?? existing?.hops_away,
          });
          return next;
        });
        void window.electronAPI.db
          .saveMeshcoreContact(contactToDbRow(d, nick ?? null, 1))
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
                next.set(senderId, {
                  ...node,
                  last_heard: Math.max(node.last_heard ?? 0, d.senderTimestamp),
                });
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
      };
      processWaitingMessagesRef.current = processWaitingMessages;
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
        const now = Date.now();
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
              return;
            }
          } else {
            console.warn(
              '[useMeshCore] event 7: CLI response received but no command service active (sender:',
              senderId.toString(16).toUpperCase(),
              ')',
            );
          }
          // CLI response without matching pending command - add to history
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
            next.set(senderId, {
              ...node,
              last_heard: Math.max(node.last_heard ?? 0, d.senderTimestamp),
            });
            return next;
          });
        }
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
        const resolvedSenderId = senderId !== 0 ? senderId : null;
        setRawPackets((prev) =>
          meshcoreCorrelateOrSynthesizeChatEntry(prev, 'TXT_MSG', resolvedSenderId, {
            ts: now,
            snr: 0,
            rssi: 0,
            raw: new Uint8Array(0),
            routeTypeString: null,
            payloadTypeString: 'TXT_MSG',
            hopCount: 0,
            fromNodeId: resolvedSenderId,
            messageFingerprintHex: null,
            transportScopeCode: null,
            transportReturnCode: null,
            advertName: null,
            advertLat: null,
            advertLon: null,
            advertTimestampSec: null,
            parseOk: false,
          }),
        );
      });

      // Incoming channel message — event 8
      conn.on(8, (data: unknown) => {
        const now = Date.now();
        const d = data as { channelIdx: number; text: string; senderTimestamp: number };
        if (isMeshcoreTransportStatusChatLine(d.text)) {
          logTransportLineAsDevice(d.text);
          return;
        }
        const normalized = normalizeMeshcoreIncomingText(d.text);
        const displayName = normalized.senderName ?? 'Unknown';
        const stubId = meshcoreChatStubNodeIdFromDisplayName(displayName);
        // Look up hopCount from the most recent unattributed GRP_TXT raw packet
        // (event 136 always fires before event 8 for the same RF message).
        const rfMatch = rawPacketsRef.current
          .slice()
          .reverse()
          .find(
            (e) =>
              e.payloadTypeString === 'GRP_TXT' &&
              e.fromNodeId === null &&
              now - e.ts <= MESHCORE_CHAT_CORRELATE_WINDOW_MS,
          );
        const hopsAway = rfMatch?.hopCount;
        setNodes((prev) => {
          const next = new Map(prev);
          const existing = next.get(stubId);
          const updated = existing
            ? {
                ...existing,
                last_heard: Math.max(existing.last_heard ?? 0, d.senderTimestamp),
                ...(hopsAway != null ? { hops_away: hopsAway } : {}),
              }
            : {
                ...minimalMeshcoreChatNode(stubId, displayName, d.senderTimestamp, 'rf'),
                ...(hopsAway != null ? { hops_away: hopsAway } : {}),
              };
          next.set(stubId, updated);
          if (hopsAway != null) {
            void window.electronAPI.db.saveNode(updated);
            void window.electronAPI.db.saveMeshcoreContact({
              node_id: stubId,
              public_key: meshcoreSyntheticPlaceholderPubKeyHex(stubId),
              adv_name: displayName,
              contact_type: 1,
              last_advert: d.senderTimestamp,
              nickname: null,
              hops_away: hopsAway,
              on_radio: 1,
            });
          }
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
        if (mqttStatusRef.current === 'connected') {
          void window.electronAPI.mqtt
            .publishMeshcorePacketLog({
              origin: selfInfoRef.current?.name ?? 'mesh-client',
              snr: rfMatch?.snr ?? 0,
              rssi: rfMatch?.rssi ?? 0,
            })
            .catch((e: unknown) => {
              console.warn('[useMeshCore] publishMeshcorePacketLog (heard RF) error', e);
            });
        }
        setRawPackets((prev) =>
          meshcoreCorrelateOrSynthesizeChatEntry(prev, 'GRP_TXT', stubId, {
            ts: now,
            snr: 0,
            rssi: 0,
            raw: new Uint8Array(0),
            routeTypeString: null,
            payloadTypeString: 'GRP_TXT',
            hopCount: 0,
            fromNodeId: stubId,
            messageFingerprintHex: null,
            transportScopeCode: null,
            transportReturnCode: null,
            advertName: null,
            advertLat: null,
            advertLon: null,
            advertTimestampSec: null,
            parseOk: false,
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
        const rawU8 = d.raw instanceof Uint8Array && d.raw.length > 0 ? d.raw : null;
        const loraPacketClass = rawU8 ? classifyPayload(rawU8) : null;

        // Extract sender ID and update known node's last_heard + signal metrics
        let senderInfo = '';
        if (rawU8 && rawU8.length >= 8 && loraPacketClass != null) {
          if (loraPacketClass === 'meshtastic') {
            const senderId = extractMeshtasticSenderId(rawU8);
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
                    last_heard: Math.max(existing.last_heard ?? 0, nowSec),
                    snr: snr,
                    rssi: rssi,
                  });
                  return next;
                });
              }
            }
          } else if (loraPacketClass === 'meshcore') {
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

        // Packet-log metadata hoisted for the MQTT publish below (set inside the rawU8 block).
        let mqttRawHex: string | undefined;
        let mqttLen: number | undefined;
        let mqttPacketType: number | undefined;
        let mqttRoute: string | undefined;
        let mqttPayloadLen: number | undefined;
        let mqttHash: string | undefined;

        // Raw packet log: always run MeshCore in-house parse on this path (LOG_RX is MeshCore RF only).
        // Do not gate on classifyPayload — Meshtastic-shaped heuristics can mis-label MeshCore frames.
        if (rawU8) {
          let routeTypeString: string | null = null;
          let payloadTypeString: string | null = null;
          let hopCount = 0;
          let fromNodeId: number | null = null;
          let messageFingerprintHex: string | null = null;
          let transportScopeCode: number | null = null;
          let transportReturnCode: number | null = null;
          let advertName: string | null = null;
          let advertLat: number | null = null;
          let advertLon: number | null = null;
          let advertTimestampSec: number | null = null;
          let parseOk = false;

          const parsed = parseMeshCoreRfPacket(rawU8);
          if (parsed.ok) {
            parseOk = true;
            routeTypeString = parsed.routeTypeString;
            payloadTypeString = parsed.payloadTypeString;
            hopCount = parsed.hopCount;
            messageFingerprintHex = parsed.messageFingerprintHex;
            if (parsed.transportCodes) {
              transportScopeCode = parsed.transportCodes[0];
              transportReturnCode = parsed.transportCodes[1];
            }
            if (parsed.advert) {
              advertName = parsed.advert.name.length > 0 ? parsed.advert.name : null;
              advertLat = parsed.advert.latitudeDeg;
              advertLon = parsed.advert.longitudeDeg;
              advertTimestampSec = parsed.advert.timestampSec;
            }
            const id = meshcoreRawPacketResolveFromParsed(parsed, pubKeyPrefixMapRef.current);
            if (id != null) {
              fromNodeId = id;
              if (parsed.transportCodes) {
                void window.electronAPI.db
                  .updateMeshcoreContactRfTransport(
                    id,
                    parsed.transportCodes[0],
                    parsed.transportCodes[1],
                  )
                  .catch((e: unknown) => {
                    console.warn('[useMeshCore] updateMeshcoreContactRfTransport error', e);
                  });
              }
            }
          } else {
            const fb = meshcoreRawPacketLogFromBytesFallback(rawU8, pubKeyPrefixMapRef.current);
            if (fb) {
              routeTypeString = fb.routeTypeString;
              payloadTypeString = fb.payloadTypeString;
              hopCount = fb.hopCount;
              if (fb.fromNodeId != null) fromNodeId = fb.fromNodeId;
            }
          }

          // Update hops_away on known MeshCore nodes from RF packet hop count.
          // Only use fromNodeId resolved by MeshCore parsing (before the Meshtastic fallback).
          if (fromNodeId !== null && fromNodeId !== myNodeNumRef.current) {
            const nowSec = Math.floor(now / 1000);
            setNodes((prev) => {
              const existing = prev.get(fromNodeId!);
              if (!existing) return prev;
              const updated: MeshNode = {
                ...existing,
                hops_away: hopCount,
                snr: snr,
                rssi: rssi,
                last_heard: Math.max(existing.last_heard ?? 0, nowSec),
              };

              // Optimization: skip identical updates
              if (
                existing.hops_away === hopCount &&
                existing.snr === snr &&
                existing.rssi === rssi &&
                existing.last_heard === updated.last_heard
              ) {
                return prev;
              }

              const next = new Map(prev);
              next.set(fromNodeId!, updated);

              void window.electronAPI.db.saveNode(updated);
              void window.electronAPI.db
                .updateMeshcoreContactLastRf(fromNodeId!, snr, rssi, hopCount, nowSec)
                .catch((e: unknown) => {
                  console.warn('[useMeshCore] updateMeshcoreContactLastRf error', e);
                });
              void useDiagnosticsStore
                .getState()
                .saveMeshcoreHopHistory(fromNodeId!, now, hopCount, snr, rssi)
                .catch((e: unknown) => {
                  console.warn('[useMeshCore] saveMeshcoreHopHistory error', e);
                });

              return next;
            });
          }

          if (fromNodeId == null) {
            const mtId = meshtasticSenderIdForRawLogFallback(parseOk, rawU8);
            if (mtId != null) fromNodeId = mtId;
          }
          const rxEntry: RxPacketEntry = {
            ts: now,
            snr,
            rssi,
            raw: rawU8,
            routeTypeString,
            payloadTypeString,
            hopCount,
            fromNodeId,
            messageFingerprintHex,
            transportScopeCode,
            transportReturnCode,
            advertName,
            advertLat,
            advertLon,
            advertTimestampSec,
            parseOk,
          };
          setRawPackets((prev) => {
            const myId = myNodeNumRef.current;
            const last = prev[prev.length - 1];
            if (
              myId !== 0 &&
              shouldCoalesceSelfFloodAdvert(
                last,
                rxEntry,
                myId,
                MESHCORE_RAW_SELF_FLOOD_ADVERT_COALESCE_MS,
              )
            ) {
              const next = [...prev.slice(0, -1), rxEntry];
              return next.length > MAX_RAW_PACKET_LOG_ENTRIES
                ? next.slice(next.length - MAX_RAW_PACKET_LOG_ENTRIES)
                : next;
            }
            const next = [...prev, rxEntry];
            return next.length > MAX_RAW_PACKET_LOG_ENTRIES
              ? next.slice(next.length - MAX_RAW_PACKET_LOG_ENTRIES)
              : next;
          });

          // Populate hoisted MQTT packet-log fields from the parsed result.
          mqttRawHex = Array.from(rawU8, (b) => b.toString(16).padStart(2, '0')).join('');
          mqttLen = rawU8.length;
          mqttPayloadLen = rawU8.length;
          if (parsed.ok) {
            mqttPacketType = parsed.payloadTypeNibble;
          }
          mqttRoute = routeTypeString ?? undefined;
          mqttHash = messageFingerprintHex ?? undefined;
        }

        // Foreign LoRa fingerprinting: only flag non-MeshCore packets as foreign (requires known self node ID)
        if (
          getStoredMeshProtocol() === 'meshcore' &&
          myNodeNumRef.current !== 0 &&
          rawU8 &&
          loraPacketClass != null
        ) {
          if (loraPacketClass !== 'meshcore') {
            const senderId =
              loraPacketClass === 'meshtastic' ? extractMeshtasticSenderId(rawU8) : null;
            useDiagnosticsStore
              .getState()
              .recordForeignLora(
                myNodeNumRef.current,
                loraPacketClass,
                rssi || undefined,
                snr || undefined,
                senderId ?? undefined,
                () => nodesRef.current,
              );
          }
        }

        if (mqttStatusRef.current === 'connected') {
          const nowMs = Date.now();
          if (nowMs - lastPacketLogAtRef.current >= 100) {
            lastPacketLogAtRef.current = nowMs;
            void window.electronAPI.mqtt
              .publishMeshcorePacketLog({
                origin: selfInfoRef.current?.name ?? 'mesh-client',
                snr,
                rssi,
                rawHex: mqttRawHex,
                len: mqttLen,
                packetType: mqttPacketType,
                route: mqttRoute,
                payloadLen: mqttPayloadLen,
                hash: mqttHash,
              })
              .catch(() => {
                const t = Date.now();
                if (t - lastPacketLogPublishFailureLogAtRef.current >= 30_000) {
                  lastPacketLogPublishFailureLogAtRef.current = t;
                }
              });
          }
        }
      });

      conn.on('disconnected', () => {
        meshcoreSessionPathUpdatedNodeIdsRef.current = new Set();
        setMeshcorePingRouteReadyEpoch((e) => e + 1);
        setState((prev) => ({ ...prev, status: 'disconnected' }));
        setQueueStatus(null);
        // Clear pending contacts refresh timer
        if (meshcoreContactsRefreshTimerRef.current) {
          clearTimeout(meshcoreContactsRefreshTimerRef.current);
          meshcoreContactsRefreshTimerRef.current = null;
        }
        // Clear waiting messages poll
        if (meshcoreWaitingMessagesPollRef.current) {
          clearInterval(meshcoreWaitingMessagesPollRef.current);
          meshcoreWaitingMessagesPollRef.current = null;
        }
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
    [addMessage, setDeviceLogs, addCliHistoryEntry],
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

      // meshcore.js runs deviceQuery(SupportedCompanionProtocolVersion) from onConnected() on the next
      // macrotask; register before any await so we capture that DeviceInfo (manufacturer string, build date).
      conn.once(MESHCORE_RESPONSE_DEVICE_INFO, (response: unknown) => {
        setState((prev) => {
          const next = { ...prev };
          const r = response as { firmware_build_date?: string };
          if (typeof r?.firmware_build_date === 'string' && r.firmware_build_date.trim()) {
            next.firmwareVersion = r.firmware_build_date.trim();
          }
          const mm = meshcoreManufacturerModelFromDeviceQuery(response);
          if (mm) next.manufacturerModel = mm;
          return next;
        });
      });

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
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        console.warn('[useMeshCore] loadMessagesFromDb error', e);
      }

      // Fetch self info, contacts, channels (sequential — device handles one request at a time)
      const rawInfo = await awaitUnlessMeshcoreSetupCancelled(setupGen, conn.getSelfInfo(5000));
      const info = enrichMeshCoreSelfInfo(rawInfo);
      setSelfInfo(info);
      setState((prev) => ({ ...prev, status: 'connected' }));

      const myNodeId = pubkeyToNodeId(info.publicKey);
      setState((prev) => ({ ...prev, myNodeNum: myNodeId, status: 'configured' }));
      if (getStoredMeshProtocol() === 'meshcore') {
        useDiagnosticsStore.getState().migrateForeignLoraFromZero(myNodeId);
      }

      try {
        // Must match meshcore.js onConnected (SupportedCompanionProtocolVersion); ver 0 can yield Err/empty DeviceInfo.
        const deviceInfo = await conn.deviceQuery(MESHCORE_DEVICE_QUERY_APP_VER);
        setState((prev) => {
          const next = { ...prev };
          if (deviceInfo?.firmware_build_date) {
            next.firmwareVersion = deviceInfo.firmware_build_date;
          }
          const mm = meshcoreManufacturerModelFromDeviceQuery(deviceInfo);
          if (mm) {
            next.manufacturerModel = mm;
          }
          return next;
        });
      } catch {
        // catch-no-log-ok deviceQuery optional for firmware string
      }

      const rawChannels = await awaitUnlessMeshcoreSetupCancelled(
        setupGen,
        withTimeout(conn.getChannels(), MESHCORE_INIT_TIMEOUT_MS, 'getChannels'),
      );
      setChannels(
        rawChannels.map((c) => ({ index: c.channelIdx, name: c.name, secret: c.secret })),
      );

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
          contactsFromRadio: true,
        }),
      );
      setNodes((prev) => mergeMeshcoreChatStubNodes(prev, newNodes));

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

      // Proactively fetch any messages that queued while disconnected.
      // Mirrors what event 131 does, but covers reconnects where the event was missed.
      try {
        await processWaitingMessagesRef.current?.();
      } catch (e) {
        console.warn('[useMeshCore] initConn: proactive getWaitingMessages failed', e);
      }

      // Periodic safety-net poll in case the device never re-sends event 131.
      const MESHCORE_WAITING_MESSAGES_POLL_MS = 5 * 60 * 1_000;
      if (meshcoreWaitingMessagesPollRef.current)
        clearInterval(meshcoreWaitingMessagesPollRef.current);
      meshcoreWaitingMessagesPollRef.current = setInterval(() => {
        if (!meshcoreHookMountedRef.current) return;
        void processWaitingMessagesRef.current?.().catch((e: unknown) => {
          console.warn('[useMeshCore] periodic getWaitingMessages failed', e);
        });
      }, MESHCORE_WAITING_MESSAGES_POLL_MS);
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
            window.electronAPI.resetBlePairingRetryCount('meshcore');
            let reuseWebBluetoothDeviceId: string | null = null;
            for (let attempt = 1; attempt <= WEB_BLUETOOTH_CONNECT_MAX_ATTEMPTS; attempt++) {
              const attemptStartedAt = Date.now();
              const transport = new TransportWebBluetoothIpc('meshcore');
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
                } catch {
                  // catch-no-log-ok Web Bluetooth cleanup on failed attempt
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
      } catch (err) {
        const isSetupAbort =
          err instanceof DOMException &&
          err.name === 'AbortError' &&
          err.message === MESHCORE_SETUP_ABORT_MESSAGE;
        if (isSetupAbort) {
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
        } catch (err) {
          const isSetupAbort =
            err instanceof DOMException &&
            err.name === 'AbortError' &&
            err.message === MESHCORE_SETUP_ABORT_MESSAGE;
          if (isSetupAbort) {
            // disconnect during setup
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
    meshcoreSessionPathUpdatedNodeIdsRef.current = new Set();
    setMeshcorePingRouteReadyEpoch((e) => e + 1);
    pubKeyMapRef.current.clear();
    pubKeyPrefixMapRef.current.clear();
    outPathMapRef.current.clear();
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
    if (meshcoreStatsPollRef.current) {
      clearInterval(meshcoreStatsPollRef.current);
      meshcoreStatsPollRef.current = null;
    }
    prevTxAirSecsRef.current = null;
    prevStatsTimestampRef.current = null;
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

        // Calculate dynamic timeout based on hop count for multi-hop paths
        const destNode = nodesRef.current.get(destNodeId);
        const hopsAway = destNode?.hops_away ?? 0;
        const hopBasedTimeoutMs = 3000 + hopsAway * 2500; // 3s base + 2.5s per hop

        try {
          const result = await connRef.current.sendTextMessage(pubKey, textToSend);
          void fetchAndUpdateLocalStats();
          const ackCrc = result?.expectedAckCrc;
          // Use max of: firmware estimate, hop-based calculation, minimum floor
          const estTimeout = Math.max(
            result?.estTimeout ?? 30_000,
            hopBasedTimeoutMs,
            MESHCORE_DM_ACK_TIMEOUT_MIN_MS,
          );

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

            // Capture outbound path for delivery outcome attribution
            const outPathRaw = outPathMapRef.current.get(destNodeId);
            const sendPathBytes = outPathRaw && outPathRaw.length > 0 ? Array.from(outPathRaw) : [];
            const sendPathHash = sendPathBytes.length > 0 ? computePathHash(sendPathBytes) : '';
            if (sendPathBytes.length > 0) {
              usePathHistoryStore
                .getState()
                .recordPathUpdated(destNodeId, sendPathBytes, hopsAway, false);
            }

            // Schedule failure timeout
            const timeoutId = setTimeout(() => {
              for (const k of pendingMapKeys) {
                pendingAcksRef.current.delete(k);
              }
              if (sendPathHash) {
                usePathHistoryStore.getState().recordOutcome(destNodeId, sendPathHash, false);
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
              destNodeId,
              pathHash: sendPathHash,
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
            void fetchAndUpdateLocalStats();
            addMessage({
              sender_id: myNodeNumRef.current,
              sender_name: selfInfo?.name ?? 'Me',
              payload: text,
              channel: channelIdx,
              timestamp: sentAt,
              status: 'acked',
              replyId: replyField,
            });
            if (mqttStatusRef.current === 'connected') {
              void window.electronAPI.mqtt
                .publishMeshcorePacketLog({
                  origin: selfInfo?.name ?? 'mesh-client',
                  snr: 0,
                  rssi: 0,
                  direction: 'tx',
                })
                .catch((e: unknown) => {
                  console.warn('[useMeshCore] publishMeshcorePacketLog (sent via RF) error', e);
                });
            }
          } else if (mqttStatusRef.current === 'connected') {
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
    [addMessage, selfInfo, fetchAndUpdateLocalStats],
  );

  const refreshContacts = useCallback(async () => {
    if (!connRef.current) return;
    try {
      // Mark all existing contacts as not on radio before refreshing
      await window.electronAPI.db.markAllMeshcoreContactsOffRadio();

      const contactsRaw = await connRef.current.getContacts();
      const contacts = contactsRaw.map(meshcoreContactRawFromDevice);
      setMeshcoreContactsForTelemetry(contacts);
      const newNodes = await buildNodesFromContacts(contacts, {
        self: selfInfo,
        myNodeId: myNodeNumRef.current,
        previousNodes: nodesRef.current,
        contactsFromRadio: true, // Signal to save with on_radio=1
      });
      setNodes((prev) => mergeMeshcoreChatStubNodes(prev, newNodes));

      // Warn if approaching contact limit
      if (contacts.length > MESHCORE_CONTACTS_WARNING_THRESHOLD) {
        console.warn(
          `[useMeshCore] refreshContacts: radio contacts near limit (${contacts.length}/${MESHCORE_MAX_CONTACTS})`,
        );
      }
    } catch (e) {
      console.error('[useMeshCore] refreshContacts error', e);
    }
  }, [buildNodesFromContacts, selfInfo]);

  const sendAdvert = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) {
      throw new Error('Not connected to radio');
    }
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
    let pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey) {
      const dbContacts =
        (await window.electronAPI.db.getMeshcoreContacts()) as MeshcoreContactDbRow[];
      const dbRow = dbContacts.find((c) => c.node_id === nodeId);
      if (dbRow) {
        const hex = dbRow.public_key.replace(/\s/g, '');
        const pairs = hex.match(/.{2}/g);
        if (pairs) {
          pubKey = new Uint8Array(pairs.map((b) => parseInt(b, 16)));
        }
      }
    }
    if (pubKey && connRef.current) {
      try {
        await connRef.current.removeContact(pubKey);
      } catch (e) {
        console.warn('[useMeshCore] removeContact error', e);
      }
    } else if (meshcoreIsChatStubNodeId(nodeId)) {
      // stub node: skip radio removal
    } else {
      // no pubKey: skip radio removal
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
    await window.electronAPI.db.deleteMeshcoreContact(nodeId).catch((e: unknown) => {
      console.warn('[useMeshCore] deleteMeshcoreContact error', e);
    });
  }, []);

  const clearRawPackets = useCallback(() => {
    setRawPackets([]);
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
    outPathMapRef.current.clear();
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
      if (!connRef.current) {
        console.warn('[useMeshCore] setOwner: connRef.current is null, aborting');
        return;
      }
      try {
        await connRef.current.setAdvertName(owner.longName);
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
      if (!connRef.current) {
        console.warn('[useMeshCore] setRadioParams: connRef.current is null, aborting');
        return;
      }
      try {
        // MeshCore protocol: freq as UInt32 in kHz (910525 = 910.525 MHz), bw in Hz.
        const freqKhz = Math.round(p.freq / 1000);
        await connRef.current.setRadioParams(freqKhz, p.bw, p.sf, p.cr);
      } catch (e) {
        console.error('[useMeshCore] setRadioParams threw:', e);
        throw normalizeMeshCoreError(
          e,
          'Failed to apply radio settings. The device may not support changing radio parameters over this connection.',
        );
      }
      try {
        await connRef.current.setTxPower(p.txPower);
      } catch (e) {
        console.error('[useMeshCore] setTxPower threw:', e);
        throw normalizeMeshCoreError(
          e,
          'Failed to set TX power. The device may not support changing it over this connection.',
        );
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
        try {
          const existing =
            parseStoredJson<Record<string, unknown>>(
              localStorage.getItem('mesh-client:gpsSettings'),
              'useMeshCore sendPositionToDeviceMeshCore persist static',
            ) ?? {};
          const refreshInterval =
            typeof existing.refreshInterval === 'number' ? existing.refreshInterval : 0;
          localStorage.setItem(
            'mesh-client:gpsSettings',
            JSON.stringify({ ...existing, staticLat: lat, staticLon: lon, refreshInterval }),
          );
        } catch {
          // catch-no-log-ok localStorage quota or private mode
        }
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
        throw normalizeMeshCoreError(
          e,
          'Device rejected position update — check that the device supports setting coordinates',
        );
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

  /**
   * MeshCore: always allow Ping/trace in the UI. Pre-gating on PathUpdated/path history caused false
   * “path not synced” when the radio had not yet reported 129; traceRoute resolves routes and sets
   * meshcorePingErrors when the path is still unavailable.
   */
  const meshcoreCanPingTrace = useCallback(() => true, []);

  const traceRoute = useCallback(
    async (nodeId: number) => {
      const pubKey = pubKeyMapRef.current.get(nodeId);
      if (!pubKey) {
        clearMeshcorePingNoRouteExpiryTimer(nodeId);
        setMeshcorePingErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, 'Node not found (no encryption key)');
          return next;
        });
        return;
      }
      if (!connRef.current) {
        clearMeshcorePingNoRouteExpiryTimer(nodeId);
        setMeshcorePingErrors((prev) => {
          const next = new Map(prev);
          next.set(nodeId, 'Not connected to device');
          return next;
        });
        return;
      }
      clearMeshcorePingNoRouteExpiryTimer(nodeId);
      setMeshcorePingErrors((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });

      try {
        const conn = connRef.current;
        if (!conn) {
          throw new Error('Not connected to device');
        }
        const hopsAway = nodesRef.current.get(nodeId)?.hops_away;
        let storedPath = outPathMapRef.current.get(nodeId);
        /** `outPathLen` from the matching radio contact when we consult `getContacts` (may diverge from UI `hops_away`). */
        let radioContactPathLen: number | null = null;
        /** Multi-hop trace needs the radio’s route bytes; the single-byte pubkey fallback only works for direct peers. */
        if ((!storedPath || storedPath.length <= 1) && (hopsAway == null || hopsAway >= 1)) {
          try {
            const contactsRaw = await conn.getContacts();
            const contacts = contactsRaw.map(meshcoreContactRawFromDevice);
            for (const contact of contacts) {
              if (pubkeyToNodeId(contact.publicKey) !== nodeId) continue;
              if (typeof contact.outPathLen === 'number' && Number.isFinite(contact.outPathLen)) {
                radioContactPathLen = contact.outPathLen;
              }
              const slice = meshcoreSliceContactOutPathForTrace(
                contact.outPath,
                contact.outPathLen,
              );
              if (slice.length > 0) {
                outPathMapRef.current.set(nodeId, slice);
                storedPath = slice;
              }
              break;
            }
          } catch (e: unknown) {
            console.warn('[useMeshCore] traceRoute getContacts refresh failed', e);
          }
        }
        if ((!storedPath || storedPath.length <= 1) && (hopsAway == null || hopsAway >= 1)) {
          try {
            const sel = await usePathHistoryStore.getState().ensureBestPathLoaded(nodeId);
            if (sel?.pathBytes?.length !== undefined && sel.pathBytes.length > 1) {
              const fromHist = new Uint8Array(sel.pathBytes);
              outPathMapRef.current.set(nodeId, fromHist);
              storedPath = fromHist;
            }
          } catch {
            // catch-no-log-ok path history optional
          }
        }
        const needsRoutePrime =
          (!storedPath || storedPath.length <= 1) && (hopsAway == null || hopsAway >= 1);
        if (needsRoutePrime) {
          try {
            await withTimeout(
              conn.sendFloodAdvert(),
              MESHCORE_SEND_FLOOD_ADVERT_TIMEOUT_MS,
              'meshcoreTracePrimeFloodAdvert',
            );
          } catch (e: unknown) {
            console.warn('[useMeshCore] traceRoute prime: sendFloodAdvert failed', e);
          }
          await waitForMeshcorePath129ForNode(conn, nodeId, MESHCORE_TRACE_PRIME_WAIT_MS);
          try {
            const contactsRawPrime = await conn.getContacts();
            const contactsPrime = contactsRawPrime.map(meshcoreContactRawFromDevice);
            for (const contact of contactsPrime) {
              if (pubkeyToNodeId(contact.publicKey) !== nodeId) continue;
              if (typeof contact.outPathLen === 'number' && Number.isFinite(contact.outPathLen)) {
                radioContactPathLen = contact.outPathLen;
              }
              const slicePrime = meshcoreSliceContactOutPathForTrace(
                contact.outPath,
                contact.outPathLen,
              );
              if (slicePrime.length > 0) {
                outPathMapRef.current.set(nodeId, slicePrime);
                storedPath = slicePrime;
              }
              break;
            }
          } catch (e: unknown) {
            console.warn('[useMeshCore] traceRoute post-prime getContacts failed', e);
          }
          if (!storedPath || storedPath.length <= 1) {
            try {
              const selPrime = await usePathHistoryStore.getState().ensureBestPathLoaded(nodeId);
              if (selPrime?.pathBytes?.length !== undefined && selPrime.pathBytes.length > 1) {
                const fromHistPrime = new Uint8Array(selPrime.pathBytes);
                outPathMapRef.current.set(nodeId, fromHistPrime);
                storedPath = fromHistPrime;
              }
            } catch {
              // catch-no-log-ok path history optional
            }
          }
        }
        const pathTooShort = !storedPath || storedPath.length <= 1;
        const uiSaysMultiHop = (hopsAway ?? 0) >= 1;
        const radioSaysMultiHop = radioContactPathLen != null && radioContactPathLen >= 1;
        if (pathTooShort && (uiSaysMultiHop || radioSaysMultiHop)) {
          clearMeshcorePingNoRouteExpiryTimer(nodeId);
          setMeshcorePingErrors((prev) => {
            const next = new Map(prev);
            next.set(nodeId, MESHCORE_PING_NO_ROUTE_ERROR_MSG);
            return next;
          });
          const tid = window.setTimeout(() => {
            if (!meshcoreHookMountedRef.current) return;
            setMeshcorePingErrors((prev) => meshcorePingNoRouteErrorExpiryUpdate(prev, nodeId));
            meshcorePingNoRouteExpiryTimersRef.current.delete(nodeId);
          }, MESHCORE_PING_NO_ROUTE_ERROR_DISPLAY_MS);
          meshcorePingNoRouteExpiryTimersRef.current.set(nodeId, tid);
          return;
        }
        let outPath =
          storedPath && storedPath.length > 0 ? storedPath : new Uint8Array([pubKey[0]]);
        if (outPath.length === 1 && outPath[0] === 0 && pubKey[0] !== 0) {
          outPath = new Uint8Array([pubKey[0]]);
        }
        const result = await withTimeout(
          runMeshcoreTracePathMultiplexed(
            conn as unknown as MeshcoreTracePathMuxConnection,
            outPath,
            MESHCORE_TRACE_TIMEOUT_MS,
            repeaterRemoteRpcRef.current,
          ),
          MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
          'meshcoreTracePing',
        );
        const traceHops = meshcoreTracePathLenToHops(result.pathLen);
        const convertedSnrs = (result.pathSnrs ?? []).map((s) => s * MESHCORE_RPC_SNR_RAW_TO_DB);
        const convertedLastSnr = result.lastSnr;
        setMeshcoreTraceResults((prev) => {
          const next = new Map(prev);
          next.set(nodeId, {
            pathLen: result.pathLen,
            pathHashes: result.pathHashes ?? [],
            pathSnrs: convertedSnrs,
            lastSnr: convertedLastSnr,
            tag: result.tag,
          });
          meshcoreTraceResultsRef.current = next;
          return next;
        });
        void useDiagnosticsStore
          .getState()
          .saveMeshcoreTraceHistory(
            nodeId,
            result.pathLen,
            convertedSnrs,
            convertedLastSnr,
            result.tag,
          );
        const existingForRf = nodesRef.current.get(nodeId);
        setNodes((prev) => {
          const existing = prev.get(nodeId);
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(nodeId, { ...existing, hops_away: traceHops });
          return next;
        });
        const lastSnrRf =
          typeof convertedLastSnr === 'number' && Number.isFinite(convertedLastSnr)
            ? convertedLastSnr
            : (existingForRf?.snr ?? 0);
        const lastRssiRf =
          typeof existingForRf?.rssi === 'number' && Number.isFinite(existingForRf.rssi)
            ? existingForRf.rssi
            : 0;
        const nowSecTrace = Math.floor(Date.now() / 1000);
        const hopsToSave = typeof traceHops === 'number' ? traceHops : null;
        void window.electronAPI.db
          .updateMeshcoreContactLastRf(nodeId, lastSnrRf, lastRssiRf, hopsToSave, nowSecTrace)
          .catch((e: unknown) => {
            console.warn('[useMeshCore] updateMeshcoreContactLastRf (traceRoute) error', e);
          });
        useRepeaterSignalStore.getState().recordSignal(nodeId, result.lastSnr);
        bumpMeshcoreNodeLastHeardFromRpc(nodeId);
        clearMeshcorePingNoRouteExpiryTimer(nodeId);
        setMeshcorePingErrors((prev) => {
          const next = new Map(prev);
          next.delete(nodeId);
          return next;
        });
      } catch (e: unknown) {
        const rawErr = meshcoreTraceRouteRejectReason(e);
        const errMsg = rawErr && rawErr !== 'undefined' ? rawErr : 'request failed';
        const isTimeout =
          errMsg.toLowerCase().includes('timeout') || errMsg.toLowerCase().includes('timed out');
        let friendlyErr = isTimeout
          ? `Request timed out (up to ~${Math.round(MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS / 1000)}s)`
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
    [bumpMeshcoreNodeLastHeardFromRpc, clearMeshcorePingNoRouteExpiryTimer],
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
      setMeshcoreStatusErrors((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
      try {
        await repeaterRemoteRpcRef.current(async () => {
          const conn = connRef.current;
          if (!conn) {
            throw new Error('Not connected to device');
          }
          await meshcoreRepeaterTryLogin(conn, pubKey);
          const raw = await conn.getStatus(pubKey, MESHCORE_STATUS_TIMEOUT_MS);
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
        });
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
    try {
      await repeaterRemoteRpcRef.current(async () => {
        const conn = connRef.current;
        if (!conn) {
          throw new Error('Not connected to device');
        }
        await meshcoreRepeaterTryLogin(conn, pubKey);
        const raw = await conn.getTelemetry(pubKey, MESHCORE_TELEMETRY_TIMEOUT_MS);
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
            result.gps = entry.value;
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
      });
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
    setMeshcoreNeighborErrors((prev) => {
      const next = new Map(prev);
      next.delete(nodeId);
      return next;
    });
    try {
      await repeaterRemoteRpcRef.current(async () => {
        const conn = connRef.current;
        if (!conn) {
          throw new Error('Not connected to device');
        }
        await meshcoreRepeaterTryLogin(conn, pubKey);
        const neighbourPrefixLen = 6;
        const reqBytes = buildMeshcoreGetNeighboursRequest({
          count: 10,
          offset: 0,
          orderBy: 0,
          pubKeyPrefixLength: neighbourPrefixLen,
        });
        const responseData = await conn.sendBinaryRequest(
          pubKey,
          reqBytes,
          MESHCORE_NEIGHBORS_TIMEOUT_MS,
        );
        const raw = parseMeshcoreGetNeighboursResponse(responseData, neighbourPrefixLen);
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
            snr: nb.snr * MESHCORE_RPC_SNR_RAW_TO_DB,
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
      });
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
            const snrs = trace?.pathSnrs;
            if (!trace || !Array.isArray(snrs) || snrs.length === 0) return [];
            return snrs.map(() => pubKey);
          })()
        : [];

      try {
        return await repeaterRemoteRpcRef.current(async () => {
          const conn = connRef.current;
          if (!conn) {
            throw new Error('Not connected to device');
          }
          const { token, promise } = service.registerPendingCommand(command, path);
          const commandWithToken = service.formatCommandWithToken(command, token);

          addCliHistoryEntry(nodeId, {
            type: 'sent',
            text: command,
            timestamp: Date.now(),
          });

          await meshcoreRepeaterTryLogin(conn, pubKey);
          const txtType = 1; // TxtTypes.CliData
          await conn.sendTextMessage(pubKey, commandWithToken, txtType);

          const response = await promise;
          addCliHistoryEntry(nodeId, {
            type: 'received',
            text: response,
            timestamp: Date.now(),
          });
          bumpMeshcoreNodeLastHeardFromRpc(nodeId);
          return response;
        });
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
    if (!connRef.current) {
      console.warn('[useMeshCore] setMeshcoreChannel: no connection');
      return;
    }

    // Validate parameters
    if (!Number.isInteger(idx) || idx < 0 || idx > 39) {
      console.warn('[useMeshCore] setMeshcoreChannel: invalid channel index', idx);
      throw new Error(`Invalid channel index: ${idx}. Must be 0-39.`);
    }

    if (typeof name !== 'string' || name.length === 0) {
      console.warn('[useMeshCore] setMeshcoreChannel: invalid name', name);
      throw new Error('Channel name must be a non-empty string');
    }

    if (!(secret instanceof Uint8Array) || secret.length === 0) {
      console.warn('[useMeshCore] setMeshcoreChannel: invalid secret', secret);
      throw new Error('Channel secret must be a non-empty Uint8Array');
    }

    try {
      await withTimeout(connRef.current.setChannel(idx, name, secret), 10_000, 'setChannel');
      setChannels((prev) => {
        const next = prev.filter((c) => c.index !== idx);
        return [...next, { index: idx, name, secret }].sort((a, b) => a.index - b.index);
      });
    } catch (e) {
      const error = normalizeMeshCoreError(e, 'Failed to save channel to device');
      console.warn('[useMeshCore] setMeshcoreChannel error', {
        error: e,
        errorMessage: error.message,
        errorType: typeof e,
        idx,
        name,
        secretLength: secret?.length,
      });
      throw error;
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
      return { imported: 0, skipped: 0, errors: [] };
    }

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
      } else {
        throw new Error('JSON root must be an array or an object containing an array');
      }
    } catch (e) {
      console.warn('[useMeshCore] importContacts: parse error', e);
      return { imported: 0, skipped: 0, errors: [e instanceof Error ? e.message : String(e)] };
    }

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
      nicknameMapRef.current.set(nodeId, name);
      pubKeyMapRef.current.set(nodeId, pubKey);
      validEntries.push({ nodeId, name, pubKey, latitude, longitude });
    }

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
            on_radio: 0,
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
        : meshcoreSyntheticPlaceholderPubKeyHex(nodeId);
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

  // ─── MeshCore Device Time ────────────────────────────────────────
  const getDeviceTime = useCallback(async (): Promise<number | null> => {
    const conn = connRef.current;
    if (!conn) return null;
    try {
      const result = await conn.getDeviceTime();
      return result?.time ?? null;
    } catch (e: unknown) {
      console.warn('[useMeshCore] getDeviceTime error', e);
      return null;
    }
  }, []);

  const syncDeviceTime = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) return;
    try {
      await conn.setDeviceTime(Math.floor(Date.now() / 1000));
    } catch (e: unknown) {
      console.warn('[useMeshCore] syncDeviceTime error', e);
      throw e;
    }
  }, []);

  // ─── MeshCore Device Query ─────────────────────────────────────
  const getDeviceInfo = useCallback(
    async (appTargetVer?: number): Promise<Record<string, unknown> | null> => {
      const conn = connRef.current;
      if (!conn) return null;
      try {
        const result = await conn.deviceQuery(appTargetVer ?? MESHCORE_DEVICE_QUERY_APP_VER);
        const mm = meshcoreManufacturerModelFromDeviceQuery(result);
        if (mm) {
          setState((prev) => ({ ...prev, manufacturerModel: mm }));
        }
        return result;
      } catch (e: unknown) {
        console.warn('[useMeshCore] getDeviceInfo error', e);
        return null;
      }
    },
    [],
  );

  // ─── MeshCore Contact Import/Export ───────────────────────────
  const importContact = useCallback(
    async (advertBytes: Uint8Array): Promise<boolean> => {
      const conn = connRef.current;
      if (!conn) return false;
      try {
        await conn.importContact(advertBytes);
        await refreshContacts();
        return true;
      } catch (e: unknown) {
        console.warn('[useMeshCore] importContact error', e);
        return false;
      }
    },
    [refreshContacts],
  );

  const exportContact = useCallback(async (nodeId: number): Promise<Uint8Array | null> => {
    const conn = connRef.current;
    if (!conn) return null;
    const pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey) {
      console.warn('[useMeshCore] exportContact: no public key for node', nodeId);
      return null;
    }
    try {
      const result = await conn.exportContact(pubKey);
      return result;
    } catch (e: unknown) {
      console.warn('[useMeshCore] exportContact error', e);
      return null;
    }
  }, []);

  const shareContact = useCallback(async (nodeId: number): Promise<boolean> => {
    const conn = connRef.current;
    if (!conn) return false;
    const pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey) {
      console.warn('[useMeshCore] shareContact: no public key for node', nodeId);
      return false;
    }
    try {
      await conn.shareContact(pubKey);
      return true;
    } catch (e: unknown) {
      console.warn('[useMeshCore] shareContact error', e);
      return false;
    }
  }, []);

  // ─── MeshCore Contact Path Management ──────────────────────────
  // Note: setContactPath requires full contact object from meshcore.js.
  // Use resetContactPath to clear path, or implement setContactPath with contact data.
  const setContactPath = useCallback(async (nodeId: number, path: number[]): Promise<boolean> => {
    void path;
    const conn = connRef.current;
    if (!conn) return false;
    const pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey) {
      console.warn('[useMeshCore] setContactPath: no public key for node', nodeId);
      return false;
    }
    // Reset the path first, then if we had full contact data we would call setContactPath
    // For now, we reset and log a warning that the full path cannot be set without contact data
    try {
      await conn.resetPath(pubKey);
      return true;
    } catch (e: unknown) {
      console.warn('[useMeshCore] setContactPath error', e);
      return false;
    }
  }, []);

  const resetContactPath = useCallback(async (nodeId: number): Promise<boolean> => {
    const conn = connRef.current;
    if (!conn) return false;
    const pubKey = pubKeyMapRef.current.get(nodeId);
    if (!pubKey) {
      console.warn('[useMeshCore] resetContactPath: no public key for node', nodeId);
      return false;
    }
    try {
      await conn.resetPath(pubKey);
      return true;
    } catch (e: unknown) {
      console.warn('[useMeshCore] resetContactPath error', e);
      return false;
    }
  }, []);

  // ─── MeshCore Statistics ───────────────────────────────────────
  const getRadioStats =
    useCallback(async (): Promise<MeshCoreStatsResponse<MeshCoreRadioStatsData> | null> => {
      const conn = connRef.current;
      if (!conn) return null;
      try {
        const result = await conn.getStatsRadio();
        return result;
      } catch (e: unknown) {
        console.warn('[useMeshCore] getRadioStats error', e);
        return null;
      }
    }, []);

  const getPacketStats =
    useCallback(async (): Promise<MeshCoreStatsResponse<MeshCorePacketStatsData> | null> => {
      const conn = connRef.current;
      if (!conn) return null;
      try {
        const result = await conn.getStatsPackets();
        return result;
      } catch (e: unknown) {
        console.warn('[useMeshCore] getPacketStats error', e);
        return null;
      }
    }, []);

  // ─── MeshCore Channel Data ──────────────────────────────────────
  const sendChannelData = useCallback(
    async (
      channelIdx: number,
      pathLen: number,
      path: Uint8Array,
      dataType: number,
      payload: Uint8Array,
    ): Promise<boolean> => {
      const conn = connRef.current;
      if (!conn) return false;
      try {
        await conn.sendChannelData(channelIdx, pathLen, path, dataType, payload);
        return true;
      } catch (e: unknown) {
        console.warn('[useMeshCore] sendChannelData error', e);
        return false;
      }
    },
    [],
  );

  // ─── MeshCore Cryptographic Operations ───────────────────────────
  const signData = useCallback(async (data: Uint8Array): Promise<Uint8Array | null> => {
    const conn = connRef.current;
    if (!conn) return null;
    try {
      const signature = await conn.sign(data);
      return signature;
    } catch (e: unknown) {
      console.warn('[useMeshCore] signData error', e);
      return null;
    }
  }, []);

  const exportPrivateKey = useCallback(async (): Promise<Uint8Array | null> => {
    const conn = connRef.current;
    if (!conn) return null;
    try {
      const key = await conn.exportPrivateKey();
      return key;
    } catch (e: unknown) {
      console.warn('[useMeshCore] exportPrivateKey error', e);
      return null;
    }
  }, []);

  const importPrivateKey = useCallback(async (privateKey: Uint8Array): Promise<boolean> => {
    const conn = connRef.current;
    if (!conn) return false;
    try {
      await conn.importPrivateKey(privateKey);
      return true;
    } catch (e: unknown) {
      console.warn('[useMeshCore] importPrivateKey error', e);
      return false;
    }
  }, []);

  // ─── MeshCore Waiting Messages ───────────────────────────────────
  const getWaitingMessages = useCallback(async (): Promise<unknown[] | null> => {
    const conn = connRef.current;
    if (!conn) return null;
    try {
      const messages = await conn.getWaitingMessages();
      return messages;
    } catch (e: unknown) {
      console.warn('[useMeshCore] getWaitingMessages error', e);
      return null;
    }
  }, []);

  const syncNextMessage = useCallback(async (): Promise<unknown> => {
    const conn = connRef.current;
    if (!conn) return null;
    try {
      const msg = await conn.syncNextMessage();
      return msg;
    } catch (e: unknown) {
      console.warn('[useMeshCore] syncNextMessage error', e);
      return null;
    }
  }, []);

  // No-op stubs to satisfy the same interface shape used in App.tsx
  const noopAsync = useCallback(async () => {}, []);
  const noopVoid = useCallback(() => {}, []);

  const requestRefresh = useCallback(async () => {
    await fetchAndUpdateLocalStats();
  }, [fetchAndUpdateLocalStats]);

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
    // Match useDevice: when a static override exists, do not let device coords win over it.
    const devLat = staticLat != null ? undefined : myNode?.latitude;
    const devLon = staticLon != null ? undefined : myNode?.longitude;
    const pos = await resolveOurPosition(devLat, devLon, staticLat, staticLon);
    setOurPosition(pos);
    if (getStoredMeshProtocol() === 'meshcore') {
      useDiagnosticsStore.getState().setOurPositionSource(pos?.source ?? null);
    }
    return pos;
  }, []);

  // Same as useDevice: resolve map/static GPS on startup so MapPanel receives ourPosition.
  useEffect(() => {
    void refreshOurPositionNoop();
  }, [refreshOurPositionNoop]);

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
      meshcoreLocalStats: nodesRef.current.get(myNodeNumRef.current)?.meshcore_local_stats ?? null,
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
      meshcoreCanPingTrace,
      meshcorePingRouteReadyEpoch,
      requestRepeaterStatus,
      requestTelemetry,
      requestNeighbors,
      importContacts,
      toggleManualAddContacts,
      setMeshcoreChannel,
      deleteMeshcoreChannel,
      deviceLogs,
      rawPackets,
      clearRawPackets,
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
      traceRouteResults: new Map(
        Array.from(meshcoreTraceResults.entries()).map(([id, res]) => [
          id,
          { route: res.pathHashes, from: id, timestamp: Date.now() },
        ]),
      ),
      queueStatus,
      neighborInfo: new Map<number, unknown>(),
      waypoints: [] as unknown[],
      telemetry,
      signalTelemetry,
      environmentTelemetry,
      channelConfigs: [] as unknown[],
      moduleConfigs: {},
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
      // MeshCore new methods
      getDeviceTime,
      syncDeviceTime,
      getDeviceInfo,
      importContact,
      exportContact,
      shareContact,
      setContactPath,
      resetContactPath,
      getRadioStats,
      getPacketStats,
      sendChannelData,
      signData,
      exportPrivateKey,
      importPrivateKey,
      getWaitingMessages,
      syncNextMessage,
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
      meshcoreCanPingTrace,
      meshcorePingRouteReadyEpoch,
      requestRepeaterStatus,
      requestTelemetry,
      requestNeighbors,
      importContacts,
      toggleManualAddContacts,
      setMeshcoreChannel,
      deleteMeshcoreChannel,
      deviceLogs,
      rawPackets,
      clearRawPackets,
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
      queueStatus,
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
      // MeshCore new methods
      getDeviceTime,
      syncDeviceTime,
      getDeviceInfo,
      importContact,
      exportContact,
      shareContact,
      setContactPath,
      resetContactPath,
      getRadioStats,
      getPacketStats,
      sendChannelData,
      signData,
      exportPrivateKey,
      importPrivateKey,
      getWaitingMessages,
      syncNextMessage,
    ],
  );
}
