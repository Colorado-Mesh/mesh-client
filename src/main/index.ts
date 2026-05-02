import { spawn } from 'child_process';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  MenuItem,
  type NativeImage,
  nativeImage,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  safeStorage,
  screen,
  type Session,
  shell,
  Tray,
} from 'electron';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { pathToFileURL } from 'url';
import zlib from 'zlib';

import type { MQTTSettings } from '../renderer/lib/types';
import { sanitizeUnicodeReactionScalar } from '../shared/reactionEmoji';
import type { TAKServerStatus, TAKSettings } from '../shared/tak-types';
import {
  addContactToGroup,
  closeDatabase,
  createContactGroup,
  deleteAllMeshcorePathHistory,
  deleteContactGroup,
  deleteMeshcoreContactsByAge,
  deleteMeshcoreContactsNeverAdvertised,
  deleteMeshcorePathHistoryForNode,
  deleteNodesBySource,
  deleteNodesWithoutLongname,
  exportDatabase,
  getAllMeshcorePathHistory,
  getContactGroupMembers,
  getContactGroups,
  getDatabase,
  getMeshcoreHopHistory,
  getMeshcorePathHistory,
  getMeshcoreTraceHistory,
  initDatabase,
  mergeDatabase,
  migrateRfStubNodes,
  pruneMeshcoreContactsByCount,
  pruneMeshcorePathHistory,
  prunePositionHistory,
  recordMeshcorePathOutcome,
  removeContactFromGroup,
  saveMeshcoreHopHistory,
  saveMeshcoreTraceHistory,
  searchMeshcoreMessages,
  searchMessages,
  updateContactGroup,
  upsertMeshcorePathHistory,
  upsertNodePath,
} from './database';
import { getGpsFix } from './gps';
import {
  clearLogFile,
  exportLogTo,
  formatRuntimeLogTag,
  forwardRendererConsoleMessage,
  getLogPath,
  getRecentLines,
  initLogFile,
  logDeviceConnection,
  patchMainConsole,
  sanitizeLogMessage,
  setMainWindow,
} from './log-service';
import { MeshcoreMqttAdapter } from './meshcore-mqtt-adapter';
import {
  decodePathPayload,
  decodeTracePayload,
  isPathPacket,
  isTracePacket,
} from './meshcore-path-decoder';
import { MQTTManager } from './mqtt-manager';
import { handleNobleBleToRadioWrite } from './noble-ble-ipc';
import { NobleBleManager, type NobleSessionId } from './noble-ble-manager';
import type { TakServerManager } from './tak-server-manager';
import { getCheckNow, initUpdater } from './updater';

// Route main-process console through log file + Log panel (must run before other code logs)
patchMainConsole();

// Linux: SIGSEGV in Electron GPU process on some Wayland / driver stacks (electron#41980).
// Must run before app.whenReady(). CLI flags --disable-gpu also work; env avoids wrapper scripts.
if (process.platform === 'linux' && process.env.MESH_CLIENT_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
}

// ─── Single instance lock ───────────────────────────────────────────
// Must run before app.whenReady() to take effect. Second instance will
// focus the existing window and exit.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.meshclient.app');
}

// ─── Window state persistence ───────────────────────────────────────
interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
}

const WINDOW_STATE_PATH = path.join(app.getPath('userData'), 'window-state.json');
const DEFAULT_WINDOW_STATE: WindowState = { x: 0, y: 0, width: 1200, height: 800 };

function loadWindowState(): WindowState {
  try {
    if (fs.existsSync(WINDOW_STATE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, 'utf-8')) as unknown;
      if (
        raw &&
        typeof raw === 'object' &&
        typeof (raw as Record<string, unknown>).x === 'number' &&
        typeof (raw as Record<string, unknown>).y === 'number' &&
        typeof (raw as Record<string, unknown>).width === 'number' &&
        typeof (raw as Record<string, unknown>).height === 'number'
      ) {
        return raw as WindowState;
      }
    }
  } catch {
    // catch-no-log-ok: non-critical; fall through to defaults
  }
  return DEFAULT_WINDOW_STATE;
}

function saveWindowState(state: WindowState): void {
  try {
    fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify(state), 'utf-8');
  } catch {
    // catch-no-log-ok: non-critical persistence failure
  }
}

function isWindowStateOnScreen(state: WindowState): boolean {
  const displays = screen.getAllDisplays();
  return displays.some((d) => {
    const { x, y, width, height } = d.workArea;
    return (
      state.x < x + width &&
      state.x + state.width > x &&
      state.y < y + height &&
      state.y + state.height > y
    );
  });
}

const mqttManager = new MQTTManager();
const meshcoreMqttAdapter = new MeshcoreMqttAdapter();
const nobleBleManager = new NobleBleManager();

/** TAK status before the lazy-loaded `TakServerManager` module is imported. */
const IDLE_TAK_STATUS: TAKServerStatus = { running: false, port: 8089, clientCount: 0 };

/** MAC address format: XX:XX:XX:XX:XX:XX */
const MAC_ADDRESS_REGEX = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;

let takServerManager: TakServerManager | null = null;
let takServerManagerLoadPromise: Promise<TakServerManager> | null = null;

function attachTakForwarders(manager: TakServerManager): void {
  manager.on('status', (status) => {
    if (mainWindow) mainWindow.webContents.send('tak:status', status);
    else console.debug('[main] tak:status dropped (mainWindow not ready)');
  });
  manager.on('client-connected', (client) => {
    if (mainWindow) mainWindow.webContents.send('tak:clientConnected', client);
    else console.debug('[main] tak:clientConnected dropped (mainWindow not ready)');
  });
  manager.on('client-disconnected', (clientId) => {
    if (mainWindow) mainWindow.webContents.send('tak:clientDisconnected', clientId);
    else console.debug('[main] tak:clientDisconnected dropped (mainWindow not ready)');
  });
}

async function ensureTakServerManager(): Promise<TakServerManager> {
  if (takServerManager) return takServerManager;
  takServerManagerLoadPromise ??= import('./tak-server-manager').then((mod) => {
    const manager = new mod.TakServerManager();
    attachTakForwarders(manager);
    takServerManager = manager;
    return manager;
  });
  return takServerManagerLoadPromise;
}

/** Max bytes per MeshCore TCP IPC write (DoS guard). */
const MESHCORE_TCP_WRITE_MAX_BYTES = 256 * 1024;
/** Min node ID for MeshCore chat stub nodes (derived from meshcoreUtils). */
const MESHCORE_CHAT_STUB_ID_MIN = 0xa0000000 >>> 0;
/** Max node ID for MeshCore chat stub nodes (derived from meshcoreUtils). */
const MESHCORE_CHAT_STUB_ID_MAX = 0xafffffff >>> 0;
/** Max bytes per BLE write IPC (DoS guard). */
const NOBLE_BLE_TO_RADIO_MAX_BYTES = 512;

function isAnyMqttConnected(): boolean {
  return mqttManager.getStatus() === 'connected' || meshcoreMqttAdapter.getStatus() === 'connected';
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/** Retain tray context menu so macOS menu bridge does not see a freed model (avoids console warning / crashes). */
let trayContextMenu: Menu | null = null;
/** Retain application menu on macOS so the menu bridge has a stable model. */
let appMenu: Menu | null = null;
let isConnected = false;
let isQuitting = false;
/** Second pass of `before-quit` after async Noble BLE teardown (see `before-quit` handler). */
let nobleQuitRetry = false;
/** powerSaveBlocker ID while a device is connected; null when not active. */
let powerSaveBlockerId: number | null = null;

// ─── Windows taskbar overlay badge icon ────────────────────────────
/** Build a minimal 16×16 RGBA PNG buffer for use as the Windows taskbar overlay icon. */
function buildBadgePng(): Buffer {
  const W = 16,
    H = 16;
  // CRC32 (used by PNG chunk format)
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c;
  }
  function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type: string, data: Buffer): Buffer {
    const typeBytes = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.allocUnsafe(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
    return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
  }
  // IHDR: 16×16, 8-bit RGBA
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // Raw scanlines: filter byte (0) + RGBA per pixel — red with circular alpha mask
  const rows: Buffer[] = [];
  const cx = (W - 1) / 2,
    cy = (H - 1) / 2,
    r2 = (W / 2) * (W / 2);
  for (let y = 0; y < H; y++) {
    const row = Buffer.allocUnsafe(1 + W * 4);
    row[0] = 0; // filter: None
    for (let x = 0; x < W; x++) {
      const off = 1 + x * 4;
      const inside = (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2;
      row[off] = 220; // R
      row[off + 1] = 53; // G
      row[off + 2] = 69; // B
      row[off + 3] = inside ? 255 : 0; // A
    }
    rows.push(row);
  }
  const idat = zlib.deflateSync(Buffer.concat(rows));
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Pending Serial callback
let pendingSerialCallback: ((portId: string) => void) | null = null;
// Last serial port discovery set: only allow selection IPC to resolve with ids from this set
// (empty string always allowed = cancel). Prevents arbitrary id injection from a compromised renderer.
let lastSerialPortIds = new Set<string>();

// Pending Web Bluetooth callback (Linux only — select-bluetooth-device on webContents)
let pendingBluetoothCallback: ((deviceId: string) => void) | null = null;
let lastBluetoothDeviceIds = new Set<string>();

// Bluetooth pairing state (Linux only — setBluetoothPairingHandler)
// Electron's Response type requires confirmed: boolean, pin is optional
interface BluetoothPairingResponse {
  confirmed: boolean;
  pin?: string;
}
let pendingPairingCallback: ((response: BluetoothPairingResponse) => void) | null = null;
let pendingPairingRetryCount = 0;
/** Which BLE stack is connecting; MeshCore must not auto-use Meshtastic default PIN on first pairing. */
let blePairingSessionKind: 'meshtastic' | 'meshcore' = 'meshtastic';

// Noble BLE pairing state (Win32 — no Chromium pairing handler available)

let hasInstalledOsmReferrerHook = false;
const OSM_HTTP_REFERRER = 'https://meshtastic-client.app/';

// ─── Global error handlers (prevent silent crashes in packaged app) ──
process.on('uncaughtException', (error) => {
  console.error(
    '[main] Uncaught exception:',
    sanitizeLogMessage(error?.stack ?? error?.message ?? String(error)),
  );
  try {
    dialog.showErrorBox(
      'Mesh-Client — Unexpected Error',
      `${error.message}\n\n${error.stack ?? ''}`,
    );
  } catch {
    // catch-no-log-ok dialog unavailable during early startup; error already logged above
  }
});

// Throttle user-visible dialog so a tight loop of rejections does not spam the user
let lastUnhandledRejectionDialogAt = 0;
const UNHANDLED_REJECTION_DIALOG_COOLDOWN_MS = 60_000;

process.on('unhandledRejection', (reason) => {
  console.error(
    '[main] Unhandled rejection:',
    sanitizeLogMessage(reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)),
  );
  const now = Date.now();
  if (now - lastUnhandledRejectionDialogAt < UNHANDLED_REJECTION_DIALOG_COOLDOWN_MS) return;
  lastUnhandledRejectionDialogAt = now;
  const message =
    reason instanceof Error ? `${reason.message}\n\n${reason.stack ?? ''}` : String(reason);
  try {
    dialog.showErrorBox(
      'Mesh-Client — Unhandled Promise Rejection',
      `A promise rejected without a handler. Check the main process terminal for full details.\n\n${message.slice(0, 1500)}${message.length > 1500 ? '…' : ''}`,
    );
  } catch {
    // catch-no-log-ok dialog unavailable during early startup; rejection already logged above
  }
});

// ─── Bluetooth pairing handler (Linux only) ──────────────────────────
// Note: Bluetooth pairing for Web Bluetooth is handled via session.setBluetoothPairingHandler()
// which is set up after mainWindow creation. See the setup below near select-bluetooth-device.

// ─── IPC validation helpers (main process boundary) ───────────────────
const MAX_PAYLOAD_LENGTH = 1024 * 1024; // 1MB cap for message payload
const MAX_STATUS_STRING = 1024;
// Align with reasonable Meshtastic/DB bounds to prevent unbounded string allocation
const MAX_NODE_STRING = 512;
const MAX_HW_MODEL = 128;
const MAX_GROUP_NAME = 100;

function safeNonNegativeInt(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid non-negative integer');
  return n >>> 0;
}

/** MeshCore chat channel index (includes -1 for DMs). */
function safeMeshcoreChannelIndex(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < -1 || n > 1_000_000) {
    throw new Error('Invalid MeshCore channel index');
  }
  return Math.trunc(n);
}

/** Validate IPC sender origin to prevent untrusted renderers from invoking privileged handlers. */
function validateIpcSender(event: Electron.IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;
  try {
    const url = new URL(frame.url);
    const isDev = !app.isPackaged;
    if (isDev) {
      return (
        url.protocol === 'file:' ||
        url.protocol === 'mesh-client:' ||
        (url.protocol === 'http:' &&
          (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) ||
        url.protocol === 'https:'
      );
    }
    return url.protocol === 'file:' || url.protocol === 'mesh-client:';
  } catch {
    // catch-no-log-ok invalid URL in frame is expected; treat as untrusted
    return false;
  }
}

function validateSaveMessage(message: unknown): asserts message is Record<string, unknown> & {
  sender_id: number;
  sender_name: string;
  payload: string;
  channel: number;
  timestamp: number;
  packetId?: number;
  status?: string;
  error?: string;
  emoji?: number;
  replyId?: number;
  to?: number;
  mqttStatus?: string;
  receivedVia?: string;
} {
  if (!message || typeof message !== 'object')
    throw new Error('db:saveMessage: message must be an object');
  const m = message as Record<string, unknown>;
  if (typeof m.payload !== 'string') throw new Error('db:saveMessage: payload must be a string');
  if (m.payload.length > MAX_PAYLOAD_LENGTH) throw new Error('db:saveMessage: payload too long');
  const rawSenderId = Number(m.sender_id);
  if (!Number.isFinite(rawSenderId))
    throw new Error('db:saveMessage: sender_id must be a finite number');
  m.sender_id = rawSenderId >>> 0;
  if (m.to != null) {
    const rawTo = Number(m.to);
    if (!Number.isFinite(rawTo)) throw new Error('db:saveMessage: to must be a finite number');
    m.to = rawTo >>> 0;
  }
  if (typeof m.sender_name !== 'string')
    throw new Error('db:saveMessage: sender_name must be a string');
  if (m.sender_name.length > MAX_NODE_STRING)
    throw new Error('db:saveMessage: sender_name too long');
  if (m.status != null && typeof m.status === 'string' && m.status.length > MAX_STATUS_STRING)
    throw new Error('db:saveMessage: status too long');
  if (m.error != null && typeof m.error === 'string' && m.error.length > MAX_STATUS_STRING)
    throw new Error('db:saveMessage: error too long');
  if (
    m.mqttStatus != null &&
    typeof m.mqttStatus === 'string' &&
    m.mqttStatus.length > MAX_STATUS_STRING
  )
    throw new Error('db:saveMessage: mqttStatus too long');
  safeNonNegativeInt(m.channel);
  if (typeof m.timestamp !== 'number' && typeof m.timestamp !== 'undefined')
    throw new Error('db:saveMessage: timestamp must be a number');
  if (m.timestamp != null && !Number.isFinite(m.timestamp))
    throw new Error('db:saveMessage: invalid timestamp');
}

function validateSaveNode(
  node: unknown,
): asserts node is Record<string, unknown> & { node_id: number } {
  if (!node || typeof node !== 'object') throw new Error('db:saveNode: node must be an object');
  const n = node as Record<string, unknown>;
  const rawNodeId = Number(n.node_id);
  if (!Number.isFinite(rawNodeId)) throw new Error('db:saveNode: node_id must be a finite number');
  n.node_id = rawNodeId >>> 0;
  const checkStr = (key: string, max: number) => {
    const v = n[key];
    if (v != null && typeof v === 'string' && v.length > max)
      throw new Error(`db:saveNode: ${key} exceeds maximum length`);
  };
  checkStr('long_name', MAX_NODE_STRING);
  checkStr('short_name', 64);
  checkStr('hw_model', MAX_HW_MODEL);
  checkStr('source', 64);
}

function validateSaveMeshcoreMessage(msg: unknown): asserts msg is Record<string, unknown> & {
  payload: string;
  timestamp: number;
} {
  if (!msg || typeof msg !== 'object')
    throw new Error('db:saveMeshcoreMessage: message must be an object');
  const m = msg as Record<string, unknown>;
  if (typeof m.payload !== 'string')
    throw new Error('db:saveMeshcoreMessage: payload must be a string');
  if (m.payload.length > MAX_PAYLOAD_LENGTH)
    throw new Error('db:saveMeshcoreMessage: payload too long');
  if (typeof m.timestamp !== 'number' || !Number.isFinite(m.timestamp))
    throw new Error('db:saveMeshcoreMessage: timestamp must be a finite number');
  if (
    m.sender_name != null &&
    typeof m.sender_name === 'string' &&
    m.sender_name.length > MAX_NODE_STRING
  )
    throw new Error('db:saveMeshcoreMessage: sender_name too long');
  if (m.status != null && typeof m.status === 'string' && m.status.length > MAX_STATUS_STRING)
    throw new Error('db:saveMeshcoreMessage: status too long');
  const validReceivedVia = ['rf', 'mqtt', 'both'];
  if (m.received_via != null) {
    if (typeof m.received_via !== 'string' || m.received_via.length > 8)
      throw new Error('db:saveMeshcoreMessage: received_via invalid');
    if (!validReceivedVia.includes(m.received_via))
      throw new Error('db:saveMeshcoreMessage: received_via must be rf, mqtt, or both');
  }
  if (m.rx_packet_fingerprint != null) {
    if (
      typeof m.rx_packet_fingerprint !== 'string' ||
      !/^[0-9A-Fa-f]{8}$/.test(m.rx_packet_fingerprint)
    )
      throw new Error('db:saveMeshcoreMessage: rx_packet_fingerprint must be 8 hex chars');
  }
}

function validateSaveMeshcoreContact(contact: unknown): asserts contact is Record<
  string,
  unknown
> & {
  node_id: number;
  public_key: string;
} {
  if (!contact || typeof contact !== 'object')
    throw new Error('db:saveMeshcoreContact: contact must be an object');
  const c = contact as Record<string, unknown>;
  const nodeId = Number(c.node_id);
  if (!Number.isFinite(nodeId) || nodeId < 0)
    throw new Error('db:saveMeshcoreContact: node_id must be a finite non-negative number');
  if (typeof c.public_key !== 'string')
    throw new Error('db:saveMeshcoreContact: public_key must be a string');
  if (c.public_key.length > 128) throw new Error('db:saveMeshcoreContact: public_key too long');
  if (c.adv_name != null && typeof c.adv_name === 'string' && c.adv_name.length > MAX_NODE_STRING)
    throw new Error('db:saveMeshcoreContact: adv_name too long');
  if (c.nickname != null && typeof c.nickname === 'string' && c.nickname.length > MAX_NODE_STRING)
    throw new Error('db:saveMeshcoreContact: nickname too long');
  if (c.contact_flags != null) {
    const f = Number(c.contact_flags);
    if (!Number.isInteger(f) || f < 0 || f > 255)
      throw new Error('db:saveMeshcoreContact: contact_flags must be 0–255');
  }
  if (c.hops_away != null) {
    const h = Number(c.hops_away);
    if (!Number.isInteger(h) || h < 0)
      throw new Error('db:saveMeshcoreContact: hops_away must be a non-negative integer');
  }
  if (c.on_radio != null) {
    const o = Number(c.on_radio);
    if (o !== 0 && o !== 1) throw new Error('db:saveMeshcoreContact: on_radio must be 0 or 1');
  }
  if (
    c.last_synced_from_radio != null &&
    (typeof c.last_synced_from_radio !== 'string' || c.last_synced_from_radio.length > 128)
  ) {
    throw new Error('db:saveMeshcoreContact: last_synced_from_radio must be a string <= 128');
  }
}

function validateTakSettings(settings: unknown): asserts settings is TAKSettings {
  if (!settings || typeof settings !== 'object')
    throw new Error('tak:start: settings must be an object');
  const s = settings as Record<string, unknown>;
  if (typeof s.enabled !== 'boolean') throw new Error('tak:start: enabled must be boolean');
  const port = Number(s.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('tak:start: port must be an integer 1024–65535');
  if (typeof s.serverName !== 'string' || s.serverName.length === 0 || s.serverName.length > 256)
    throw new Error('tak:start: serverName must be a non-empty string ≤ 256 chars');
  if (typeof s.requireClientCert !== 'boolean')
    throw new Error('tak:start: requireClientCert must be boolean');
  if (typeof s.autoStart !== 'boolean') throw new Error('tak:start: autoStart must be boolean');
}

function validateMqttSettings(settings: unknown): void {
  if (!settings || typeof settings !== 'object')
    throw new Error('mqtt:connect: settings must be an object');
  const s = settings as Record<string, unknown>;
  if (typeof s.server !== 'string' || !s.server.trim())
    throw new Error('mqtt:connect: server must be a non-empty string');
  const port = Number(s.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('mqtt:connect: port must be 1–65535');
  if (s.topicPrefix != null && typeof s.topicPrefix !== 'string')
    throw new Error('mqtt:connect: topicPrefix must be a string');
  if (s.username != null && typeof s.username !== 'string')
    throw new Error('mqtt:connect: username must be a string');
  if (s.password != null && typeof s.password !== 'string')
    throw new Error('mqtt:connect: password must be a string');
  if (s.tlsInsecure != null && typeof s.tlsInsecure !== 'boolean')
    throw new Error('mqtt:connect: tlsInsecure must be a boolean');
  if (s.useWebSocket != null && typeof s.useWebSocket !== 'boolean')
    throw new Error('mqtt:connect: useWebSocket must be a boolean');
  if (s.meshcorePacketLoggerEnabled != null && typeof s.meshcorePacketLoggerEnabled !== 'boolean') {
    throw new Error('mqtt:connect: meshcorePacketLoggerEnabled must be a boolean');
  }
  if (s.mqttTransportProtocol != null) {
    if (s.mqttTransportProtocol !== 'meshtastic' && s.mqttTransportProtocol !== 'meshcore') {
      throw new Error('mqtt:connect: mqttTransportProtocol must be meshtastic or meshcore');
    }
  }
}

const MAX_MESHCORE_MQTT_TEXT = 16000;

function validateMqttPublishMeshcoreArgs(args: unknown): void {
  if (!args || typeof args !== 'object')
    throw new Error('mqtt:publishMeshcore: args must be an object');
  const a = args as Record<string, unknown>;
  if (typeof a.text !== 'string') throw new Error('mqtt:publishMeshcore: text must be a string');
  if (a.text.length > MAX_MESHCORE_MQTT_TEXT)
    throw new Error('mqtt:publishMeshcore: text too long');
  const ch = Number(a.channelIdx);
  if (!Number.isFinite(ch) || ch < 0 || ch > 255)
    throw new Error('mqtt:publishMeshcore: channelIdx must be 0–255');
  if (a.senderName != null && (typeof a.senderName !== 'string' || a.senderName.length > 200)) {
    throw new Error('mqtt:publishMeshcore: senderName invalid');
  }
  if (a.senderNodeId != null) {
    const id = Number(a.senderNodeId);
    if (!Number.isFinite(id) || id < 0)
      throw new Error('mqtt:publishMeshcore: senderNodeId invalid');
  }
  if (a.timestamp != null && !Number.isFinite(Number(a.timestamp))) {
    throw new Error('mqtt:publishMeshcore: timestamp invalid');
  }
}

const MAX_MESHCORE_PACKET_LOG_ORIGIN = 200;
const MAX_MESHCORE_PACKET_LOG_RAW_HEX = 2048;

function validateMqttPublishMeshcorePacketLogArgs(args: unknown): void {
  if (!args || typeof args !== 'object')
    throw new Error('mqtt:publishMeshcorePacketLog: args must be an object');
  const a = args as Record<string, unknown>;
  if (typeof a.origin !== 'string' || a.origin.length === 0)
    throw new Error('mqtt:publishMeshcorePacketLog: origin must be a non-empty string');
  if (a.origin.length > MAX_MESHCORE_PACKET_LOG_ORIGIN)
    throw new Error('mqtt:publishMeshcorePacketLog: origin too long');
  const snr = Number(a.snr);
  const rssi = Number(a.rssi);
  if (!Number.isFinite(snr)) throw new Error('mqtt:publishMeshcorePacketLog: snr must be finite');
  if (!Number.isFinite(rssi)) throw new Error('mqtt:publishMeshcorePacketLog: rssi must be finite');
  if (a.rawHex != null) {
    if (typeof a.rawHex !== 'string')
      throw new Error('mqtt:publishMeshcorePacketLog: rawHex invalid');
    if (a.rawHex.length > MAX_MESHCORE_PACKET_LOG_RAW_HEX)
      throw new Error('mqtt:publishMeshcorePacketLog: rawHex too long');
    if (!/^[0-9a-fA-F]*$/.test(a.rawHex))
      throw new Error('mqtt:publishMeshcorePacketLog: rawHex must be hex');
  }
}

function validateMqttPublishArgs(args: unknown): void {
  if (!args || typeof args !== 'object') throw new Error('mqtt:publish: args must be an object');
  const a = args as Record<string, unknown>;
  if (typeof a.text !== 'string') throw new Error('mqtt:publish: text must be a string');
  if (a.text.length > MAX_PAYLOAD_LENGTH) throw new Error('mqtt:publish: text too long');
  const from = Number(a.from);
  if (!Number.isFinite(from) || from < 0)
    throw new Error('mqtt:publish: from must be a non-negative integer');
  const channel = Number(a.channel);
  if (!Number.isFinite(channel) || channel < 0)
    throw new Error('mqtt:publish: channel must be a non-negative integer');
  if (a.destination != null) {
    const dest = Number(a.destination);
    if (!Number.isFinite(dest) || dest < 0)
      throw new Error('mqtt:publish: destination must be a non-negative integer');
  }
  if (a.channelName != null && typeof a.channelName !== 'string')
    throw new Error('mqtt:publish: channelName must be a string');
  if (a.emoji != null) {
    const emoji = Number(a.emoji);
    if (!Number.isFinite(emoji) || emoji < 0)
      throw new Error('mqtt:publish: emoji must be a non-negative integer');
  }
  if (a.replyId != null) {
    const replyId = Number(a.replyId);
    if (!Number.isFinite(replyId) || replyId < 0)
      throw new Error('mqtt:publish: replyId must be a non-negative integer');
  }
}

// Enable Web Serial (experimental)
app.commandLine.appendSwitch('enable-blink-features', 'Serial');

// Enable Web Bluetooth on Linux (experimental - required for BLE on Linux)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-experimental-web-platform-features');
}

// ─── Icon Path Helper ──────────────────────────────────────────────
/**
 * Resolves the correct icon file based on the platform and package status.
 */
function getAppIconPath() {
  if (process.platform === 'win32') {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'colorado-mesh.ico')
      : path.join(__dirname, '../../resources/icons/win/colorado-mesh.ico');
  }
  if (process.platform === 'darwin') {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'icon.icns')
      : path.join(__dirname, '../../resources/icons/mac/icon.icns');
  }
  // Linux
  return app.isPackaged
    ? path.join(process.resourcesPath, '256x256.png')
    : path.join(__dirname, '../../resources/icons/linux/256x256.png');
}

function buildTrayIcon(hasUnread: boolean): Electron.NativeImage {
  let base: Electron.NativeImage;
  if (process.platform === 'darwin') {
    const trayIconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'macos-menubar-icon-Template.png')
      : path.join(
          __dirname,
          '../../resources/icons/mac/macos-menubar-icon-Template/macos-menubar-icon-Template.png',
        );
    base = nativeImage.createFromPath(trayIconPath);
    base.setTemplateImage(true);
  } else {
    const trayIconPath = app.isPackaged
      ? path.join(process.resourcesPath, '256x256.png')
      : path.join(__dirname, '../../resources/icons/linux/256x256.png');
    try {
      base = nativeImage.createFromPath(trayIconPath).resize({ width: 22, height: 22 });
    } catch (e) {
      console.error(
        '[main] tray icon load failed:',
        trayIconPath,
        e instanceof Error ? e.message : e,
      ); // log-injection-ok: e is a local Error from nativeImage, not user input
      base = nativeImage.createEmpty();
    }
  }

  if (!hasUnread) return base;

  // Overlay the red dot for unread messages
  // Use getSize() after resize so the dot scales correctly with retina/2x template images.
  // toBitmap() on macOS template images may return a buffer that is not exactly
  // width*height*4 bytes, so we allocate the expected size and copy what we have.
  const { width: actualW, height: actualH } = base.getSize();
  const expectedSize = actualW * actualH * 4;
  const rawBitmap = base.toBitmap();
  const bitmap = Buffer.alloc(expectedSize, 0);
  rawBitmap.copy(bitmap, 0, 0, Math.min(rawBitmap.length, expectedSize));

  const dotR = Math.max(2, Math.round(actualW / 8));
  const dotCx = actualW - dotR - 1;
  const dotCy = dotR + 1;

  for (let py = 0; py < actualH; py++) {
    for (let px = 0; px < actualW; px++) {
      const dx = px - dotCx;
      const dy = py - dotCy;
      if (dx * dx + dy * dy <= dotR * dotR) {
        const idx = (py * actualW + px) * 4;
        bitmap[idx] = 239; // R
        bitmap[idx + 1] = 68; // G
        bitmap[idx + 2] = 68; // B
        bitmap[idx + 3] = 255; // A
      }
    }
  }

  return nativeImage.createFromBitmap(bitmap, { width: actualW, height: actualH });
}

function setupTray(window: BrowserWindow) {
  tray = new Tray(buildTrayIcon(false));
  tray.setToolTip('Mesh-Client');
  tray.on('click', () => {
    window.show();
    window.focus();
  });
  trayContextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Mesh-Client',
      click: () => {
        window.show();
        window.focus();
      },
    },
    { type: 'separator' },
    {
      label: `About ${app.name}`,
      click: () => void showAboutDialog(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        mqttManager.disconnect();
        meshcoreMqttAdapter.disconnect();
        isConnected = false;
        mainWindow?.destroy();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(trayContextMenu);
}

async function showAboutDialog(): Promise<void> {
  const w = BrowserWindow.getFocusedWindow() ?? mainWindow;
  const detail = [
    `Version ${app.getVersion()}`,
    '',
    'Cross-platform Electron desktop client for Meshtastic and MeshCore on macOS, Linux, and Windows — BLE, USB serial, Wi‑Fi/TCP, MQTT, local SQLite history, routing diagnostics, and keyboard-first workflows.',
    '',
    'License: MIT',
    'Author: Colorado Mesh',
    '',
    'Website:  https://coloradomesh.org/',
    'GitHub:   https://github.com/Colorado-Mesh/mesh-client',
    'Discord:  https://discord.com/invite/McChKR5NpS',
  ].join('\n');

  const opts = {
    type: 'info' as const,
    title: app.name,
    message: app.name,
    detail,
    buttons: ['Close', 'Website', 'GitHub', 'Discord'],
    defaultId: 0,
    cancelId: 0,
  };

  const { response } = await (w ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts));

  const urls: (string | null)[] = [
    null,
    'https://coloradomesh.org/',
    'https://github.com/Colorado-Mesh/mesh-client',
    'https://discord.com/invite/McChKR5NpS',
  ];
  const url = urls[response];
  if (url) openExternalHttpOrHttpsIfExternal('', url);
}

/**
 * Application menu: macOS uses the app-name menu (About, updates, Hide, Quit) plus editMenu
 * for Cmd+C/V/X/Z/A via AppKit. Windows/Linux get File (Quit), Edit, and Help (About, updates)
 * so About is reachable from the menu bar and standard edit shortcuts work.
 */
function setupAppMenu() {
  if (process.platform === 'darwin') {
    appMenu = Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          {
            label: `About ${app.name}`,
            click: () => void showAboutDialog(),
          },
          { type: 'separator' as const },
          {
            label: 'Check for Updates\u2026',
            click: () => getCheckNow()?.(),
          },
          { type: 'separator' as const },
          {
            label: 'Hide',
            accelerator: 'Command+H',
            click: () => {
              app.hide();
            },
          },
          { type: 'separator' as const },
          {
            label: 'Quit',
            accelerator: 'Command+Q',
            click: () => {
              isQuitting = true;
              mqttManager.disconnect();
              meshcoreMqttAdapter.disconnect();
              app.quit();
            },
          },
        ],
      },
      { role: 'editMenu' as const },
    ]);
  } else {
    appMenu = Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          {
            label: 'Quit',
            accelerator: 'Ctrl+Q',
            click: () => {
              isQuitting = true;
              mqttManager.disconnect();
              meshcoreMqttAdapter.disconnect();
              app.quit();
            },
          },
        ],
      },
      { role: 'editMenu' as const },
      {
        label: 'Help',
        submenu: [
          {
            label: `About ${app.name}`,
            click: () => void showAboutDialog(),
          },
          { type: 'separator' as const },
          {
            label: 'Check for Updates\u2026',
            click: () => getCheckNow()?.(),
          },
        ],
      },
    ]);
  }
  Menu.setApplicationMenu(appMenu);
}

/**
 * Win/Linux: Hunspell only runs after languages are set (see Electron spellchecker tutorial).
 * macOS: native checker; still ensure the session flag is on. Re-run after load in case
 * dictionary lists populate asynchronously.
 */
function configureRendererSpellcheck(sess: Session): void {
  try {
    sess.setSpellCheckerEnabled(true);
    if (process.platform === 'darwin') {
      return;
    }
    const available = sess.availableSpellCheckerLanguages;
    if (!Array.isArray(available) || available.length === 0) {
      console.warn('[main] spellcheck: no dictionaries listed yet (retry after load)');
      return;
    }
    const loc = app.getLocale();
    const picked: string[] = [];
    if (available.includes(loc)) {
      picked.push(loc);
    }
    const region = loc.split(/[-_]/)[0];
    if (region) {
      for (const code of available) {
        if ((code === region || code.startsWith(`${region}-`)) && !picked.includes(code)) {
          picked.push(code);
        }
      }
    }
    if (picked.length === 0 && available.includes('en-US')) {
      picked.push('en-US');
    }
    if (picked.length === 0) {
      picked.push(available[0]);
    }
    sess.setSpellCheckerLanguages(picked.slice(0, 3));
  } catch (e) {
    console.warn(
      '[main] configureRendererSpellcheck',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );
  }
}

function parseHttpOrHttpsUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed;
  } catch {
    // catch-no-log-ok — invalid URL strings should be ignored safely
  }
  return null;
}

function openExternalHttpOrHttpsIfExternal(currentUrl: string, targetUrl: string): boolean {
  const target = parseHttpOrHttpsUrl(targetUrl);
  if (!target) return false;

  // Keep same-origin navigations inside Electron; only external websites are routed to the system browser.
  const current = parseHttpOrHttpsUrl(currentUrl);
  if (current?.origin === target.origin) return false;

  void shell.openExternal(target.toString());
  return true;
}

function createWindow() {
  const savedState = loadWindowState();
  const bounds = isWindowStateOnScreen(savedState) ? savedState : DEFAULT_WINDOW_STATE;
  const center = bounds === DEFAULT_WINDOW_STATE;

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: center ? undefined : bounds.x,
    y: center ? undefined : bounds.y,
    minWidth: 900,
    minHeight: 600,
    title: 'Mesh Client',
    // Use the helper to select .ico, .icns, or .png automatically
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      webviewTag: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Inline misspelling marks and context-menu suggestions (all platforms). macOS app menu
      // stays minimal (no role-based Edit menu) to reduce WeakPtr menu-bridge noise.
      spellcheck: true,
      // Security note: experimentalFeatures enables the Web Bluetooth and Web Serial APIs
      // required for direct device communication. These APIs are permission-gated via
      // setPermissionCheckHandler/setPermissionRequestHandler (serial + geolocation only).
      experimentalFeatures: true,
    },
  });
  mainWindow = win;

  let windowStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSaveWindowState = () => {
    if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
    windowStateSaveTimer = setTimeout(() => {
      if (!win.isMinimized() && !win.isMaximized()) {
        saveWindowState(win.getBounds());
      }
    }, 300);
  };
  win.on('move', scheduleSaveWindowState);
  win.on('resize', scheduleSaveWindowState);

  // External link handling: route http/https websites to the system browser.
  // Failure point: malicious URL schemes attempting protocol-handler abuse.
  // Guardrail: only pass validated http:/https: URLs to `shell.openExternal()`.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (typeof url !== 'string') return { action: 'deny' };
    const currentUrl = win.webContents.getURL();
    const openedExternal = openExternalHttpOrHttpsIfExternal(currentUrl, url);
    return openedExternal ? { action: 'deny' } : { action: 'allow' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const currentUrl = win.webContents.getURL();
    const openedExternal = openExternalHttpOrHttpsIfExternal(currentUrl, url);
    if (openedExternal) event.preventDefault();
  });

  configureRendererSpellcheck(win.webContents.session);
  win.webContents.once('did-finish-load', () => {
    configureRendererSpellcheck(win.webContents.session);
  });

  // Electron does not show any context menu by default — we must call menu.popup().
  // Spell suggestions only exist on this event (see spellchecker tutorial); always show
  // cut/copy/paste for text fields so right-click works even with no misspelling.
  win.webContents.on('context-menu', (event, params) => {
    const isTextField =
      params.isEditable ||
      params.formControlType === 'text-area' ||
      params.formControlType === 'input-text' ||
      params.formControlType === 'input-search';
    if (!isTextField) return;

    event.preventDefault();
    const ef = params.editFlags;
    const suggestions = params.dictionarySuggestions ?? [];
    const spellOn = params.spellcheckEnabled;

    const menu = new Menu();
    if (spellOn && suggestions.length > 0) {
      for (const suggestion of suggestions) {
        menu.append(
          new MenuItem({
            label: suggestion,
            click: () => {
              win.webContents.replaceMisspelling(suggestion);
            },
          }),
        );
      }
      menu.append(new MenuItem({ type: 'separator' }));
    }
    if (spellOn && params.misspelledWord) {
      menu.append(
        new MenuItem({
          label: 'Add to dictionary',
          click: () => {
            void win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
          },
        }),
      );
      menu.append(new MenuItem({ type: 'separator' }));
    }
    menu.append(new MenuItem({ role: 'cut', enabled: ef.canCut }));
    menu.append(new MenuItem({ role: 'copy', enabled: ef.canCopy }));
    menu.append(new MenuItem({ role: 'paste', enabled: ef.canPaste }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ role: 'selectAll', enabled: ef.canSelectAll }));

    menu.popup({
      window: win,
      x: params.x,
      y: params.y,
      ...(params.frame ? { frame: params.frame } : {}),
    });
  });

  // ─── Web Serial: Port Selection ────────────────────────────────────
  // Electron requires this handler for navigator.serial.requestPort()
  // to work. Without it, the Web Serial API throws.
  mainWindow.webContents.session.on(
    'select-serial-port',
    (event, portList, _webContents, callback) => {
      event.preventDefault();

      // Warn if a previous callback is being replaced (renderer re-triggered before resolving)
      if (pendingSerialCallback) {
        console.warn('[IPC] select-serial-port: replacing stale pendingSerialCallback');
      }

      // Store callback so we can resolve it when the user picks a port
      pendingSerialCallback = callback;

      console.debug(`[IPC] select-serial-port: discovered ${portList.length} port(s)`);

      // Auto-cancel after 60s to prevent indefinite block if renderer unmounts mid-flow
      setTimeout(() => {
        if (pendingSerialCallback === callback) {
          console.warn('[IPC] Serial port selection callback stale after 60s — auto-cancelling');
          pendingSerialCallback('');
          pendingSerialCallback = null;
          lastSerialPortIds.clear();
        }
      }, 60_000);

      lastSerialPortIds = new Set(portList.map((p) => p.portId));
      // Send port list to renderer for selection
      mainWindow?.webContents.send(
        'serial-ports-discovered',
        portList.map((p) => ({
          portId: p.portId,
          displayName: p.displayName || p.portName || `Port ${p.portId}`,
          portName: p.portName || '',
          vendorId: p.vendorId,
          productId: p.productId,
        })),
      );
    },
  );

  // ─── Web Bluetooth: Device Selection (Linux) ───────────────────────
  // On Linux, Electron does not show a native Bluetooth chooser. Instead it fires
  // select-bluetooth-device on the webContents. Without a handler the request is
  // immediately cancelled ("User cancelled the requestDevice() chooser.").
  // We intercept, forward the device list to the renderer, and resolve the callback
  // when the user picks a device (or cancels) via IPC.
  mainWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();

    const isNewRequest = !pendingBluetoothCallback;
    pendingBluetoothCallback = callback;

    if (isNewRequest) {
      // MeshCore Linux may need bluetoothctl pairing + PIN before resolving requestDevice();
      // 60s was too short and left pendingBluetoothCallback null so selectBluetoothDevice was ignored.
      const selectionStaleMs = 300_000;
      setTimeout(() => {
        if (pendingBluetoothCallback === callback) {
          console.warn(
            `[IPC] Bluetooth device selection stale after ${selectionStaleMs / 1000}s — auto-cancelling`,
          );
          pendingBluetoothCallback('');
          pendingBluetoothCallback = null;
          lastBluetoothDeviceIds.clear();
        }
      }, selectionStaleMs);
    }

    console.debug(`[IPC] select-bluetooth-device: ${deviceList.length} device(s) found`);
    lastBluetoothDeviceIds = new Set(deviceList.map((d) => d.deviceId));

    if (!mainWindow || mainWindow.isDestroyed()) {
      console.warn('[IPC] select-bluetooth-device: mainWindow unavailable — cancelling selection');
      pendingBluetoothCallback?.('');
      pendingBluetoothCallback = null;
      lastBluetoothDeviceIds.clear();
      return;
    }
    mainWindow.webContents.send(
      'bluetooth-devices-discovered',
      deviceList.map((d) => ({ deviceId: d.deviceId, deviceName: d.deviceName })),
    );
  });

  // ─── Web Bluetooth: Pairing Handler (Linux) ───────────────────────────
  // Required for devices that require PIN/confirmation during pairing.
  // This is called by Chromium when a device requires pairing during GATT connect.
  mainWindow.webContents.session.setBluetoothPairingHandler((details, callback) => {
    console.debug('[main] bluetooth-pairing-request:', details.pairingKind, details.deviceId);

    if (details.pairingKind === 'providePin') {
      // Meshtastic devices use fixed PIN 123456. MeshCore uses a random PIN shown on the device.
      // Only auto-submit 123456 for Meshtastic; MeshCore must prompt on first PIN request.
      if (blePairingSessionKind === 'meshtastic' && pendingPairingRetryCount === 0) {
        console.debug(
          '[main] bluetooth-pairing: auto-providing default PIN (Meshtastic attempt 1)',
        );
        pendingPairingRetryCount++;
        callback({ pin: '123456', confirmed: true });
        return;
      }

      console.debug(
        '[main] bluetooth-pairing: prompting user for PIN',
        blePairingSessionKind === 'meshcore'
          ? '(MeshCore or Meshtastic retry)'
          : '(Meshtastic retry)',
      );

      if (!mainWindow || mainWindow.isDestroyed()) {
        console.warn('[main] bluetooth-pairing: mainWindow unavailable — aborting pairing');
        callback({ confirmed: false });
        return;
      }

      const pairingTimeoutId = setTimeout(() => {
        if (pendingPairingCallback) {
          console.warn('[main] bluetooth-pairing: PIN prompt timed out after 120s — aborting');
          pendingPairingCallback({ pin: '', confirmed: false });
          pendingPairingCallback = null;
          pendingPairingRetryCount = 0;
        }
      }, 120_000);

      pendingPairingCallback = (response: BluetoothPairingResponse) => {
        clearTimeout(pairingTimeoutId);
        callback(response);
        pendingPairingCallback = null;
      };
      mainWindow.webContents.send('bluetooth-pin-required', {
        deviceId: details.deviceId,
      });
    } else if (details.pairingKind === 'confirmPin') {
      // Device shows a PIN, user must confirm it matches
      console.debug('[main] bluetooth-pairing: confirming PIN match');
      callback({ confirmed: true });
    } else if (details.pairingKind === 'confirm') {
      // Just confirm without PIN
      console.debug('[main] bluetooth-pairing: confirming pairing');
      callback({ confirmed: true });
    } else {
      // Unknown pairing kind - log and confirm
      console.debug('[main] bluetooth-pairing: unknown kind, confirming', details.pairingKind);
      callback({ confirmed: true });
    }
  });

  // Allow serial and geolocation only; media and web-app-installation are not used
  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission) => {
    const granted = permission === 'serial' || permission === 'geolocation';
    if (granted) {
      console.debug(`[permissions] checkHandler: ${sanitizeLogMessage(permission)} → granted`);
    }
    return granted;
  });

  // Grant geolocation permission requests (for browser GPS fallback)
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      const grant = permission === 'geolocation';
      if (grant) {
        console.debug(`[permissions] requestHandler: ${sanitizeLogMessage(permission)} → granted`);
      }
      callback(grant);
    },
  );

  // ─── Device permission (serial / HID / USB only) ───────────────────
  // setDevicePermissionHandler covers navigator.serial / hid / usb — not Bluetooth.
  // Bluetooth uses select-bluetooth-device above. Without a handler, Chromium can
  // show a blank overlay for device permission prompts.
  mainWindow.webContents.session.setDevicePermissionHandler((details) => {
    return details.deviceType === 'serial';
  });

  if (!hasInstalledOsmReferrerHook) {
    hasInstalledOsmReferrerHook = true;
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
      { urls: ['https://*.tile.openstreetmap.org/*'] },
      (details, callback) => {
        const nextHeaders = details.requestHeaders;
        nextHeaders.Referer = OSM_HTTP_REFERRER;
        callback({ requestHeaders: nextHeaders });
      },
    );
  }

  // ─── Renderer crash / load failure detection ──────────────────────
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(
      '[main] Renderer process gone:',
      sanitizeLogMessage(details.reason),
      details.exitCode,
    );
    try {
      dialog.showErrorBox(
        'Mesh-Client — Renderer Stopped',
        `The renderer process ended unexpectedly (${details.reason}, exit ${details.exitCode ?? 'n/a'}).\n\nRestart the application. If this keeps happening, export the log from the app (if still usable) or check the log file in your userData folder.`,
      );
    } catch {
      // catch-no-log-ok dialog unavailable; renderer-process-gone already logged
    }
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDesc, validatedURL) => {
    console.error(
      '[main] Failed to load:',
      errorCode,
      sanitizeLogMessage(errorDesc),
      sanitizeLogMessage(validatedURL),
    );
    // ERR_ABORTED (-3) often means navigation was cancelled; avoid noisy dialog
    if (errorCode === -3) return;
    try {
      const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
      const hint = isDev
        ? 'Ensure the dev server is running (pnpm run dev) and the URL is reachable.'
        : 'The app bundle may be missing or damaged. Try reinstalling or run from source with pnpm run build && pnpm start.';
      dialog.showErrorBox(
        'Mesh-Client — Failed to Load',
        `Could not load the application UI (code ${errorCode}: ${errorDesc}).\n\n${hint}\n\nURL: ${validatedURL}`,
      );
    } catch {
      // catch-no-log-ok dialog unavailable; did-fail-load already logged above
    }
  });

  setMainWindow(mainWindow);
  mainWindow.webContents.on('console-message', (details) => {
    forwardRendererConsoleMessage(details);
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    // Same startup diagnostics as packaged build so Log panel captures them in dev too
    console.debug('[Startup] dev server URL:', sanitizeLogMessage(process.env.VITE_DEV_SERVER_URL));
    console.debug('[Startup] app.isPackaged:', app.isPackaged);
    console.debug('[Startup] userData:', sanitizeLogMessage(app.getPath('userData')));
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);

    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, '../../dist/renderer/index.html');
    const indexUrl = pathToFileURL(indexPath).toString();
    // Use loadURL with an explicit HTTP referrer so OpenStreetMap tile requests
    // from the packaged app include a valid Referer header and comply with the
    // OSM tile usage policy for web-style traffic.
    void mainWindow.loadURL(indexUrl, {
      httpReferrer: OSM_HTTP_REFERRER,
    });
  }

  mainWindow.on('closed', () => {
    setMainWindow(null);
    mainWindow = null;
  });
  win.on('close', () => {
    if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
    if (!win.isMinimized() && !win.isMaximized()) {
      saveWindowState(win.getBounds());
    }
  });

  // Handle window close event (prevent-close when device connected)
  win.on('close', (event) => {
    if (!isQuitting && (isConnected || isAnyMqttConnected())) {
      event.preventDefault();
      if (process.platform === 'darwin') {
        console.debug('[main] window close event: hiding (macOS, device connected)');
        win.hide();
      } else {
        console.debug('[main] window close event: minimizing (device connected)');
        win.minimize();
      }
    }
  });

  setupTray(mainWindow);

  initUpdater(mainWindow);
}

// ─── Tray unread badge ──────────────────────────────────────────────
let _cachedBadgeIcon: ReturnType<typeof nativeImage.createFromBuffer> | null = null;
let _cachedTrayIconUnread: Electron.NativeImage | null = null;
let _cachedTrayIconRead: Electron.NativeImage | null = null;
let _lastTrayUnreadVariant: boolean | null = null;
ipcMain.on('set-tray-unread', (_event, count: unknown) => {
  const n = Math.max(0, Math.min(Math.floor(Number(count)) || 0, 99999));
  const hasUnread = n > 0;
  if (_lastTrayUnreadVariant !== hasUnread) {
    _lastTrayUnreadVariant = hasUnread;
    let img: NativeImage;
    if (hasUnread) {
      _cachedTrayIconUnread ??= buildTrayIcon(true);
      img = _cachedTrayIconUnread;
    } else {
      _cachedTrayIconRead ??= buildTrayIcon(false);
      img = _cachedTrayIconRead;
    }
    tray?.setImage(img);
  }
  tray?.setToolTip(hasUnread ? `Mesh-Client (${n} unread)` : 'Mesh-Client');
  if (process.platform === 'darwin') {
    app.dock?.setBadge(hasUnread ? String(n) : '');
  } else if (process.platform === 'linux') {
    app.setBadgeCount(hasUnread ? n : 0);
  } else if (process.platform === 'win32' && mainWindow) {
    if (hasUnread) {
      _cachedBadgeIcon ??= nativeImage.createFromBuffer(buildBadgePng());
      mainWindow.setOverlayIcon(_cachedBadgeIcon, `${n} unread messages`);
    } else {
      mainWindow.setOverlayIcon(null, '');
    }
  }
});

// ─── IPC: Serial port selected by user ──────────────────────────────
ipcMain.on('serial-port-selected', (_event, portId: unknown) => {
  if (!pendingSerialCallback) return;
  const id = typeof portId === 'string' ? portId : '';
  if (id !== '' && !lastSerialPortIds.has(id)) {
    console.warn('[IPC] serial-port-selected: ignoring unknown portId');
    return;
  }
  console.debug('[IPC] serial-port-selected:', sanitizeLogMessage(id || '(cancelled)'));
  pendingSerialCallback(id);
  pendingSerialCallback = null;
  lastSerialPortIds.clear();
});

// ─── IPC: Cancel Serial selection ───────────────────────────────────
ipcMain.on('serial-port-cancelled', () => {
  if (pendingSerialCallback) {
    pendingSerialCallback(''); // Empty string cancels the request
    pendingSerialCallback = null;
  }
  lastSerialPortIds.clear();
});

// ─── IPC: Bluetooth device selected by user (Linux Web Bluetooth) ────
ipcMain.on('bluetooth-device-selected', (_event, deviceId: unknown) => {
  if (!pendingBluetoothCallback) {
    console.warn(
      '[IPC] bluetooth-device-selected: no pending selection (ignored — may have timed out or already resolved)',
    );
    return;
  }
  const id = typeof deviceId === 'string' ? deviceId : '';
  if (id !== '' && !lastBluetoothDeviceIds.has(id)) {
    console.warn('[IPC] bluetooth-device-selected: ignoring unknown deviceId');
    return;
  }
  console.debug('[IPC] bluetooth-device-selected:', sanitizeLogMessage(id || '(cancelled)'));
  pendingBluetoothCallback(id);
  pendingBluetoothCallback = null;
  lastBluetoothDeviceIds.clear();
});

// ─── IPC: Cancel Bluetooth selection ────────────────────────────────
ipcMain.on('bluetooth-device-cancelled', () => {
  if (pendingBluetoothCallback) {
    pendingBluetoothCallback(''); // Empty string cancels the request
    pendingBluetoothCallback = null;
  }
  lastBluetoothDeviceIds.clear();
});

// ─── IPC: Unpair Bluetooth device (Linux only — bluetoothctl remove) ──
// Not used on routine disconnect; only ConnectionPanel manual re-pair flow.
ipcMain.handle('bluetooth-unpair', async (_event, macAddress: unknown) => {
  if (typeof macAddress !== 'string') {
    throw new Error('bluetooth-unpair: macAddress must be a string');
  }
  // Validate MAC format (XX:XX:XX:XX:XX:XX)
  if (!MAC_ADDRESS_REGEX.test(macAddress)) {
    throw new Error('bluetooth-unpair: invalid MAC address format');
  }

  console.debug('[IPC] bluetooth-unpair:', macAddress);

  return new Promise<void>((resolve, reject) => {
    const proc = spawn('bluetoothctl', ['remove', macAddress]);
    let stderr = '';
    let stdout = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        console.error('[IPC] bluetooth-unpair failed:', stderr);
        reject(new Error(stderr || 'Failed to unpair device'));
        return;
      }
      console.debug('[IPC] bluetooth-unpair success:', stdout.trim());
      resolve();
    });
    proc.on('error', (err) => {
      console.error(
        '[IPC] bluetooth-unpair error:',
        sanitizeLogMessage(err?.message ?? String(err)),
      );
      reject(err);
    });
  });
});

// ─── IPC: Start BLE scan (Linux) ─────────────────────────────────────
ipcMain.handle('bluetooth-start-scan', async () => {
  console.debug('[IPC] bluetooth-start-scan');
  return new Promise<void>((resolve, reject) => {
    const proc = spawn('bluetoothctl', ['scan', 'on']);
    proc.on('close', (code) => {
      if (code === 0) {
        console.debug('[IPC] bluetooth-start-scan success');
        resolve();
      } else {
        console.warn('[IPC] bluetooth-start-scan failed with code', code);
        reject(new Error(`scan on failed with code ${code}`));
      }
    });
    proc.on('error', (err) => {
      console.warn(
        '[IPC] bluetooth-start-scan error:',
        sanitizeLogMessage(err?.message ?? String(err)),
      );
      reject(err);
    });
  });
});

// ─── IPC: Stop BLE scan (Linux) ──────────────────────────────────────
ipcMain.handle('bluetooth-stop-scan', async () => {
  console.debug('[IPC] bluetooth-stop-scan');
  return new Promise<void>((resolve) => {
    const proc = spawn('bluetoothctl', ['scan', 'off']);
    proc.on('close', () => {
      console.debug('[IPC] bluetooth-stop-scan done');
      resolve();
    });
    proc.on('error', (err) => {
      console.warn(
        '[IPC] bluetooth-stop-scan error:',
        sanitizeLogMessage(err?.message ?? String(err)),
      );
      resolve(); // Don't reject - stop scan failure is not critical
    });
  });
});

// ─── IPC: Pair Bluetooth device (Linux) ───────────────────────────────
ipcMain.handle('bluetooth-pair', async (_event, macAddress: unknown, pin: unknown) => {
  if (typeof macAddress !== 'string') {
    throw new Error('bluetooth-pair: macAddress must be a string');
  }
  if (!MAC_ADDRESS_REGEX.test(macAddress)) {
    throw new Error('bluetooth-pair: invalid MAC address format');
  }
  let normalizedPin: string | undefined;
  if (typeof pin === 'number' && Number.isInteger(pin) && pin >= 0 && pin <= 999999) {
    normalizedPin = String(pin).padStart(6, '0');
  } else if (typeof pin === 'string' && pin.trim().length > 0) {
    const trimmed = pin.trim();
    if (/^\d{6}$/.test(trimmed)) normalizedPin = trimmed;
    else throw new Error('bluetooth-pair: pin must be exactly 6 digits');
  } else if (typeof pin !== 'undefined' && pin !== null) {
    throw new Error('bluetooth-pair: pin must be a 6-digit number');
  }
  console.debug('[IPC] bluetooth-pair:', macAddress);
  return new Promise<void>((resolve, reject) => {
    const pairTimeoutMs = 45000;
    let settled = false;
    const trustDeviceBestEffort = (): Promise<void> =>
      new Promise((resolveTrust) => {
        const trustProc = spawn('bluetoothctl', ['trust', macAddress]);
        trustProc.stdout.on('data', () => {
          // drain
        });
        trustProc.stderr.on('data', () => {
          // drain
        });
        trustProc.on('close', () => {
          resolveTrust();
        });
        trustProc.on('error', () => {
          resolveTrust();
        });
      });

    const proc = spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    let pinSubmitted = false;
    let confirmSubmitted = false;
    let pairRequested = false;
    let agentReady = false;
    let targetDiscovered = false;
    const finishReject = (err: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(pairTimeout);
      reject(err);
    };
    const finishResolve = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(pairTimeout);
      resolve();
    };
    const pairTimeout = setTimeout(() => {
      try {
        proc.stdin.write('scan off\n');
      } catch {
        // catch-no-log-ok -- best-effort cleanup during timeout
      }
      try {
        proc.stdin.write('quit\n');
      } catch {
        // catch-no-log-ok -- best-effort cleanup during timeout
      }
      try {
        proc.kill('SIGTERM');
      } catch {
        // catch-no-log-ok -- best-effort cleanup during timeout
      }
      finishReject(new Error('Bluetooth pairing timed out; please retry'));
    }, pairTimeoutMs);
    const requestPair = (): void => {
      if (pairRequested) return;
      if (!agentReady || !targetDiscovered) return;
      pairRequested = true;
      proc.stdin.write(`pair ${macAddress}\n`);
    };
    const processPairingChunk = (chunk: string): void => {
      const chunkLower = chunk.toLowerCase();
      if (
        normalizedPin &&
        !pinSubmitted &&
        (chunkLower.includes('pin code') ||
          chunkLower.includes('request pin') ||
          chunkLower.includes('enter passkey') ||
          chunkLower.includes('passkey (number in 0-999999)') ||
          chunkLower.includes('enter pass key'))
      ) {
        pinSubmitted = true;
        proc.stdin.write(`${normalizedPin}\n`);
      }
      if (
        !confirmSubmitted &&
        (chunkLower.includes('confirm passkey') ||
          chunkLower.includes('[agent] confirm') ||
          chunkLower.includes('authorize service'))
      ) {
        confirmSubmitted = true;
        proc.stdin.write('yes\n');
      }
      if (chunkLower.includes('pairing successful') || chunkLower.includes('failed to pair')) {
        proc.stdin.write('scan off\n');
        proc.stdin.write('quit\n');
      }
    };
    proc.stdin.write('agent KeyboardOnly\n');
    proc.stdin.write('default-agent\n');
    proc.stdin.write('scan on\n');
    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      const chunkLower = chunk.toLowerCase();
      if (
        !agentReady &&
        (chunkLower.includes('default agent request successful') ||
          chunkLower.includes('agent is already registered'))
      ) {
        agentReady = true;
        requestPair();
      }
      if (!pairRequested) {
        const discoveredTarget =
          chunk.includes(macAddress) &&
          (chunk.includes('Device') || chunk.includes('[NEW]') || chunk.includes('[CHG]'));
        if (discoveredTarget) {
          targetDiscovered = true;
          requestPair();
        }
      }
      if (chunk.includes('not available')) {
        if (!pairRequested) {
          requestPair();
          return;
        }
        finishReject(new Error('Pairing failed: device not available. Re-scan and retry.'));
        return;
      }
      processPairingChunk(chunk);
    });
    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      processPairingChunk(chunk);
    });
    proc.on('close', (code) => {
      if (settled) return;
      const pairingFailedByOutput =
        stdout.includes('Failed to pair') ||
        stdout.includes('AuthenticationCanceled') ||
        stderr.includes('Failed to pair') ||
        stderr.includes('AuthenticationCanceled');
      const pairingSucceededByOutput = stdout.includes('Pairing successful');
      if (!pairingFailedByOutput && (pairingSucceededByOutput || code === 0)) {
        void trustDeviceBestEffort().then(() => {
          if (settled) return;
          console.debug('[IPC] bluetooth-pair success');
          finishResolve();
        });
      } else {
        console.warn('[IPC] bluetooth-pair failed:', stderr.trim() || `code ${code}`);
        finishReject(
          new Error(
            stderr.trim() ||
              (pairingFailedByOutput ? 'pair failed (bluetoothctl reported failure)' : '') ||
              `pair failed with code ${code}`,
          ),
        );
      }
    });
    proc.on('error', (err) => {
      if (settled) return;
      console.warn('[IPC] bluetooth-pair error:', sanitizeLogMessage(err?.message ?? String(err)));
      finishReject(err instanceof Error ? err : new Error(String(err)));
    });
  });
});

// ─── IPC: Connect Bluetooth device (Linux) ────────────────────────────
ipcMain.handle('bluetooth-connect', async (_event, macAddress: unknown) => {
  if (typeof macAddress !== 'string') {
    throw new Error('bluetooth-connect: macAddress must be a string');
  }
  if (!MAC_ADDRESS_REGEX.test(macAddress)) {
    throw new Error('bluetooth-connect: invalid MAC address format');
  }
  console.debug('[IPC] bluetooth-connect:', macAddress);
  return new Promise<void>((resolve, reject) => {
    const proc = spawn('bluetoothctl', ['connect', macAddress]);
    let stderr = '';
    proc.stdout.on('data', () => {
      // drain
    });
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) {
        console.debug('[IPC] bluetooth-connect success');
        resolve();
      } else {
        console.warn('[IPC] bluetooth-connect failed:', stderr.trim() || `code ${code}`);
        reject(new Error(stderr.trim() || `connect failed with code ${code}`));
      }
    });
    proc.on('error', (err) => {
      console.warn(
        '[IPC] bluetooth-connect error:',
        sanitizeLogMessage(err?.message ?? String(err)),
      );
      reject(err);
    });
  });
});

// ─── IPC: Untrust Bluetooth device (Linux) ────────────────────────────
// This is best-effort - failures are ignored
ipcMain.handle('bluetooth-untrust', async (_event, macAddress: unknown) => {
  if (typeof macAddress !== 'string') {
    throw new Error('bluetooth-untrust: macAddress must be a string');
  }
  if (!MAC_ADDRESS_REGEX.test(macAddress)) {
    throw new Error('bluetooth-untrust: invalid MAC address format');
  }
  console.debug('[IPC] bluetooth-untrust:', macAddress);
  return new Promise<void>((resolve) => {
    const proc = spawn('bluetoothctl', ['untrust', macAddress]);
    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    proc.on('close', (code) => {
      // Ignore failure - untrust is best-effort, but log for debugging
      if (code !== 0) {
        console.debug(
          '[IPC] bluetooth-untrust exited with code',
          code,
          'stderr:',
          stderr.trim() || '(none)',
        );
      } else {
        console.debug('[IPC] bluetooth-untrust done');
      }
      resolve();
    });
    proc.on('error', (err) => {
      // Ignore error - untrust is best-effort, but log for debugging
      console.debug(
        '[IPC] bluetooth-untrust error:',
        sanitizeLogMessage(err?.message ?? String(err)),
      );
      resolve();
    });
  });
});

ipcMain.handle('bluetooth-get-info', async (_event, macAddress: unknown) => {
  if (typeof macAddress !== 'string') {
    throw new Error('bluetooth-get-info: macAddress must be a string');
  }
  if (!MAC_ADDRESS_REGEX.test(macAddress)) {
    throw new Error('bluetooth-get-info: invalid MAC address format');
  }
  return new Promise<string>((resolve) => {
    const proc = spawn('bluetoothctl', ['info', macAddress]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    proc.on('close', (code) => {
      const output = (stdout.trim() || stderr.trim() || `code ${code}`).slice(-2000);
      resolve(output);
    });
    proc.on('error', (err) => {
      const msg = err?.message ?? String(err);
      resolve(msg);
    });
  });
});

// ─── IPC: Provide Bluetooth PIN (Linux) ───────────────────────────────
ipcMain.on('bluetooth-provide-pin', (_event, pin: unknown) => {
  if (!pendingPairingCallback) {
    console.warn('[IPC] bluetooth-provide-pin: no pending pairing callback');
    return;
  }
  const pinStr = typeof pin === 'string' ? pin : '';
  console.debug('[IPC] bluetooth-provide-pin:', pinStr.length > 0 ? '****' : '(empty)');
  pendingPairingCallback({ pin: pinStr, confirmed: pinStr.length > 0 });
  pendingPairingCallback = null;
  // Reset retry count so next pairing starts fresh
  pendingPairingRetryCount = 0;
});

// ─── IPC: Cancel Bluetooth pairing (Linux) ────────────────────────────
ipcMain.on('bluetooth-cancel-pairing', () => {
  if (pendingPairingCallback) {
    console.debug('[IPC] bluetooth-cancel-pairing: cancelling');
    pendingPairingCallback({ pin: '', confirmed: false }); // confirmed: false cancels
    pendingPairingCallback = null;
  }
  // Reset retry count so next pairing starts fresh
  pendingPairingRetryCount = 0;
});

// ─── IPC: Reset BLE pairing retry count (Linux) ───────────────────────────
// Called when starting a new BLE connection so the first pairing attempt uses the default PIN
ipcMain.on('ble-reset-pairing-retry-count', (_event, sessionKind?: unknown) => {
  pendingPairingRetryCount = 0;
  blePairingSessionKind = sessionKind === 'meshcore' ? 'meshcore' : 'meshtastic';
});

// ─── IPC: Connection status tracking (module-scope, not per-window) ─
ipcMain.on('device-connected', () => {
  console.debug('[main] device-connected: isConnected = true');
  isConnected = true;
  if (powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    console.debug('[main] powerSaveBlocker started, id =', powerSaveBlockerId);
  }
});
ipcMain.on('device-disconnected', () => {
  console.debug('[main] device-disconnected: isConnected = false');
  isConnected = false;
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    console.debug('[main] powerSaveBlocker stopped, id =', powerSaveBlockerId);
  }
  powerSaveBlockerId = null;
});

// ─── Noble BLE: Forward manager events to renderer ──────────────────
nobleBleManager.on('adapterState', (state: string) => {
  mainWindow?.webContents.send('noble-ble-adapter-state', state);
});
nobleBleManager.on('deviceDiscovered', (device: { deviceId: string; deviceName: string }) => {
  mainWindow?.webContents.send('noble-ble-device-discovered', device);
});
nobleBleManager.on('connected', ({ sessionId }: { sessionId: NobleSessionId }) => {
  mainWindow?.webContents.send('noble-ble-connected', { sessionId });
});
nobleBleManager.on('disconnected', ({ sessionId }: { sessionId: NobleSessionId }) => {
  mainWindow?.webContents.send('noble-ble-disconnected', { sessionId });
});
nobleBleManager.on(
  'connect-aborted',
  ({ sessionId, message }: { sessionId: NobleSessionId; message: string }) => {
    mainWindow?.webContents.send('noble-ble-connect-aborted', { sessionId, message });
  },
);
nobleBleManager.on(
  'fromRadio',
  ({ sessionId, bytes }: { sessionId: NobleSessionId; bytes: Uint8Array }) => {
    mainWindow?.webContents.send('noble-ble-from-radio', { sessionId, bytes });
  },
);

// ─── Noble BLE: IPC command handlers ────────────────────────────────
ipcMain.handle('noble-ble-start-scan', async (_event, sessionId: unknown) => {
  if (sessionId !== 'meshtastic' && sessionId !== 'meshcore') {
    throw new Error('noble-ble-start-scan: sessionId must be meshtastic or meshcore');
  }
  if (process.platform === 'linux') {
    throw new Error(
      'BLE scanning is not supported on Linux via Noble — use Web Bluetooth in the renderer',
    );
  }
  if (isQuitting) {
    console.debug('[main] noble-ble-start-scan: ignoring (app is quitting)');
    return;
  }
  await nobleBleManager.startScanning(sessionId);
});
ipcMain.handle('noble-ble-stop-scan', async (_event, sessionId: unknown) => {
  if (sessionId !== 'meshtastic' && sessionId !== 'meshcore') {
    throw new Error('noble-ble-stop-scan: sessionId must be meshtastic or meshcore');
  }
  await nobleBleManager.stopScanning(sessionId);
});
ipcMain.handle('noble-ble-connect', async (_event, sessionId: unknown, peripheralId: unknown) => {
  if (sessionId !== 'meshtastic' && sessionId !== 'meshcore') {
    throw new Error('noble-ble-connect: sessionId must be meshtastic or meshcore');
  }
  if (typeof peripheralId !== 'string')
    throw new Error('noble-ble-connect: peripheralId must be a string');
  if (isQuitting) {
    console.debug(`[main] noble-ble-connect: ignoring session=${sessionId} (app is quitting)`);
    return { ok: false as const, error: 'App is quitting' };
  }
  try {
    await nobleBleManager.connect(sessionId, peripheralId);
    return { ok: true as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.debug(
      `[main] noble-ble-connect failed: session=${sessionId} peripheral=${peripheralId} message=${sanitizeLogMessage(message)}`,
    );
    return { ok: false as const, error: sanitizeLogMessage(message) };
  }
});
ipcMain.handle('noble-ble-disconnect', async (_event, sessionId: unknown) => {
  if (sessionId !== 'meshtastic' && sessionId !== 'meshcore') {
    throw new Error('noble-ble-disconnect: sessionId must be meshtastic or meshcore');
  }
  await nobleBleManager.disconnect(sessionId);
});
ipcMain.handle('noble-ble-to-radio', async (_event, sessionId: unknown, bytes: unknown) => {
  if (sessionId !== 'meshtastic' && sessionId !== 'meshcore') {
    throw new Error('noble-ble-to-radio: sessionId must be meshtastic or meshcore');
  }
  const result = await handleNobleBleToRadioWrite({
    sessionId,
    bytes,
    isQuitting,
    maxBytes: NOBLE_BLE_TO_RADIO_MAX_BYTES,
    manager: nobleBleManager,
  });
  if (result === 'ignored-quitting') {
    console.debug(`[main] noble-ble-to-radio: ignoring session=${sessionId} (app is quitting)`);
    return;
  }
  if (result === 'ignored-disconnected') {
    console.debug(`[main] noble-ble-to-radio: session=${sessionId} not connected, ignoring`);
    return;
  }
  if (result === 'ignored-expected-disconnect') {
    console.debug(
      '[main] noble-ble-to-radio: disconnected during write, ignoring session=',
      sanitizeLogMessage(sessionId),
    );
  }
});

// ─── MQTT: Forward manager events to renderer ───────────────────────
mqttManager.on('status', (s) => {
  if (mainWindow) mainWindow.webContents.send('mqtt:status', { status: s, protocol: 'meshtastic' });
  else
    console.debug(
      '[main] mqtt:status dropped (mainWindow not ready)',
      sanitizeLogMessage(String(s)),
    );
});
mqttManager.on('error', (msg) => {
  if (mainWindow) mainWindow.webContents.send('mqtt:error', { error: msg, protocol: 'meshtastic' });
  else
    console.debug(
      '[main] mqtt:error dropped (mainWindow not ready)',
      sanitizeLogMessage(String(msg)),
    );
});
mqttManager.on('clientId', (id) => {
  if (mainWindow)
    mainWindow.webContents.send('mqtt:clientId', { clientId: id, protocol: 'meshtastic' });
  else
    console.debug(
      '[main] mqtt:clientId dropped (mainWindow not ready)',
      sanitizeLogMessage(String(id)),
    );
});
mqttManager.on('nodeUpdate', (n) => {
  if (mainWindow)
    mainWindow.webContents.send('mqtt:node-update', { ...n, protocol: 'meshtastic' as const });
  else console.debug('[main] mqtt:node-update dropped (mainWindow not ready)');
  takServerManager?.onNodeUpdate(n);
});
mqttManager.on(
  'traceRouteReply',
  (p: { meshFrom: number; route: number[]; routeBack: number[] }) => {
    if (mainWindow)
      mainWindow.webContents.send('mqtt:trace-route-reply', {
        ...p,
        protocol: 'meshtastic' as const,
      });
    else console.debug('[main] mqtt:trace-route-reply dropped (mainWindow not ready)');
  },
);
mqttManager.on('message', (m) => {
  if (mainWindow) mainWindow.webContents.send('mqtt:message', m);
  else console.debug('[main] mqtt:message dropped (mainWindow not ready)');
});

meshcoreMqttAdapter.on('status', (s) => {
  if (mainWindow) mainWindow.webContents.send('mqtt:status', { status: s, protocol: 'meshcore' });
  else
    console.debug(
      '[main] mqtt:status (meshcore) dropped (mainWindow not ready)',
      sanitizeLogMessage(String(s)),
    );
});
meshcoreMqttAdapter.on('error', (msg) => {
  if (mainWindow) mainWindow.webContents.send('mqtt:error', { error: msg, protocol: 'meshcore' });
  else
    console.debug(
      '[main] mqtt:error (meshcore) dropped (mainWindow not ready)',
      sanitizeLogMessage(String(msg)),
    );
});
meshcoreMqttAdapter.on('clientId', (id) => {
  if (mainWindow)
    mainWindow.webContents.send('mqtt:clientId', { clientId: id, protocol: 'meshcore' });
  else
    console.debug(
      '[main] mqtt:clientId (meshcore) dropped (mainWindow not ready)',
      sanitizeLogMessage(String(id)),
    );
});
meshcoreMqttAdapter.on('subscribeWarning', (msg) => {
  if (mainWindow)
    mainWindow.webContents.send('mqtt:warning', { warning: msg, protocol: 'meshcore' });
  else
    console.debug(
      '[main] mqtt:warning (meshcore) dropped (mainWindow not ready)',
      sanitizeLogMessage(String(msg)),
    );
});
meshcoreMqttAdapter.on('chatMessage', (m) => {
  if (mainWindow) mainWindow.webContents.send('mqtt:meshcore-chat', m);
  else console.debug('[main] mqtt:meshcore-chat dropped (mainWindow not ready)');
});

meshcoreMqttAdapter.on(MeshcoreMqttAdapter.EVENT_PROACTIVE_TOKEN_REFRESH, (serverHost: string) => {
  if (mainWindow) {
    mainWindow.webContents.send('mqtt:requestTokenRefresh', serverHost);
  } else {
    console.warn('[main] proactive token refresh: mainWindow not ready');
  }
});

meshcoreMqttAdapter.on(MeshcoreMqttAdapter.EVENT_TOKEN_REFRESH_NEEDED, (serverHost: string) => {
  if (mainWindow) {
    mainWindow.webContents.send('mqtt:requestTokenRefresh', serverHost);
  } else {
    console.warn('[main] token refresh needed: mainWindow not ready');
  }
});

// ─── IPC: MQTT connect/disconnect ───────────────────────────────────
ipcMain.handle('mqtt:connect', (_event, settings) => {
  try {
    console.debug('[IPC] mqtt:connect');
    validateMqttSettings(settings);
    const s = settings as { mqttTransportProtocol?: string };
    const mode = s.mqttTransportProtocol === 'meshcore' ? 'meshcore' : 'meshtastic';
    // Dual-mode: only disconnect the target manager before reconnecting it.
    // The other manager stays connected independently.
    if (mode === 'meshcore') {
      meshcoreMqttAdapter.disconnect();
      meshcoreMqttAdapter.connect(settings as MQTTSettings);
    } else {
      mqttManager.disconnect();
      mqttManager.connect(settings);
    }
  } catch (err) {
    console.error(
      '[IPC] mqtt:connect failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});
ipcMain.handle('mqtt:disconnect', (_event, protocol?: 'meshtastic' | 'meshcore') => {
  try {
    console.debug('[IPC] mqtt:disconnect', protocol ?? 'both');
    if (!protocol || protocol === 'meshtastic') mqttManager.disconnect();
    if (!protocol || protocol === 'meshcore') meshcoreMqttAdapter.disconnect();
  } catch (err) {
    console.error(
      '[IPC] mqtt:disconnect failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});
ipcMain.handle('mqtt:getClientId', (_event, protocol?: 'meshtastic' | 'meshcore') => {
  try {
    console.debug('[IPC] mqtt:getClientId', protocol);
    if (protocol === 'meshcore') return meshcoreMqttAdapter.getClientId();
    if (protocol === 'meshtastic') return mqttManager.getClientId();
    // Fallback: return whichever is connected
    if (meshcoreMqttAdapter.getStatus() === 'connected') return meshcoreMqttAdapter.getClientId();
    return mqttManager.getClientId();
  } catch (err) {
    console.error(
      '[IPC] mqtt:getClientId failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});
ipcMain.handle('mqtt:refreshMeshcoreToken', (_event, serverHost: string) => {
  try {
    console.debug('[IPC] mqtt:refreshMeshcoreToken', serverHost);
    return meshcoreMqttAdapter.getTokenInfo(serverHost);
  } catch (err) {
    console.error(
      '[IPC] mqtt:refreshMeshcoreToken failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});
ipcMain.handle(
  'mqtt:updateMeshcoreToken',
  (_event, { token, expiresAt }: { token: string; expiresAt: number }) => {
    try {
      console.debug('[IPC] mqtt:updateMeshcoreToken', expiresAt);
      meshcoreMqttAdapter.updateToken(token, expiresAt);
    } catch (err) {
      console.error(
        '[IPC] mqtt:updateMeshcoreToken failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  },
);
ipcMain.handle('mqtt:publish', (_event, args) => {
  try {
    console.debug('[IPC] mqtt:publish');
    validateMqttPublishArgs(args);
    const a = args as {
      text: string;
      from: number;
      channel: number;
      destination?: number;
      channelName?: string;
      emoji?: number;
      replyId?: number;
    };
    return mqttManager.publish({
      text: a.text,
      from: a.from,
      channel: a.channel,
      destination: a.destination,
      channelName: a.channelName,
      emoji: a.emoji,
      replyId: a.replyId,
    });
  } catch (err) {
    console.error(
      '[IPC] mqtt:publish failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('mqtt:publishMeshcore', (_event, args) => {
  try {
    console.debug('[IPC] mqtt:publishMeshcore');
    validateMqttPublishMeshcoreArgs(args);
    const a = args as {
      text: string;
      channelIdx: number;
      senderName?: string;
      senderNodeId?: number;
      timestamp?: number;
    };
    meshcoreMqttAdapter.publishChat({
      v: 1,
      text: a.text,
      channelIdx: a.channelIdx,
      senderName: a.senderName,
      senderNodeId: a.senderNodeId,
      timestamp: a.timestamp,
    });
  } catch (err) {
    console.error(
      '[IPC] mqtt:publishMeshcore failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('mqtt:publishMeshcorePacketLog', (_event, args) => {
  try {
    console.debug('[IPC] mqtt:publishMeshcorePacketLog');
    validateMqttPublishMeshcorePacketLogArgs(args);
    const a = args as {
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
    };
    meshcoreMqttAdapter.publishPacketLog({
      origin: a.origin,
      snr: a.snr,
      rssi: a.rssi,
      rawHex: a.rawHex,
      len: a.len,
      packetType: a.packetType,
      route: a.route,
      payloadLen: a.payloadLen,
      hash: a.hash,
      direction: a.direction,
    });
  } catch (err) {
    console.error(
      '[IPC] mqtt:publishMeshcorePacketLog failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('mqtt:getCachedNodes', () => {
  try {
    return mqttManager.getCachedNodes();
  } catch (err) {
    console.error(
      '[IPC] mqtt:getCachedNodes failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});
ipcMain.handle('mqtt:publishNodeInfo', (_event, args) => {
  try {
    const a = args as {
      from: number;
      longName: string;
      shortName: string;
      channelName?: string;
      hwModel?: number;
    };
    if (
      typeof a.from !== 'number' ||
      typeof a.longName !== 'string' ||
      typeof a.shortName !== 'string'
    ) {
      throw new Error(
        'mqtt:publishNodeInfo requires from (number), longName (string), shortName (string)',
      );
    }
    return mqttManager.publishNodeInfo(
      a.from,
      a.longName,
      a.shortName,
      a.channelName ?? 'LongFast',
      a.hwModel,
    );
  } catch (err) {
    // Presence broadcast is fire-and-forget; silently ignore if MQTT just disconnected
    if (err instanceof Error && err.message === 'MQTT not connected') {
      return null;
    }
    console.error(
      '[IPC] mqtt:publishNodeInfo failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});
ipcMain.handle('mqtt:publishPosition', (_event, args) => {
  try {
    const a = args as {
      from: number;
      channel: number;
      channelName: string;
      latitudeI: number;
      longitudeI: number;
      altitude?: number;
    };
    if (
      typeof a.from !== 'number' ||
      typeof a.channel !== 'number' ||
      typeof a.channelName !== 'string' ||
      typeof a.latitudeI !== 'number' ||
      typeof a.longitudeI !== 'number'
    ) {
      throw new Error(
        'mqtt:publishPosition requires from, channel, channelName, latitudeI, longitudeI',
      );
    }
    return mqttManager.publishPosition(
      a.from,
      a.channel,
      a.channelName,
      a.latitudeI,
      a.longitudeI,
      a.altitude,
    );
  } catch (err) {
    console.error(
      '[IPC] mqtt:publishPosition failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

// ─── IPC: GPS fix via main process ──────────────────────────────────
ipcMain.handle('gps:getFix', async () => {
  try {
    return await getGpsFix();
  } catch (err) {
    console.error(
      '[gps] getGpsFix threw:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    return {
      status: 'error',
      message: 'Location unavailable (network or service error).',
      code: 'UNKNOWN',
    };
  }
});

// ─── IPC: Force quit (disconnect all, then quit) ────────────────────
// ─── IPC: Native OS notification ───────────────────────────────────
ipcMain.handle('notify:message', (_event, title: unknown, body: unknown) => {
  if (typeof title !== 'string' || title.length > 128) return;
  if (typeof body !== 'string' || body.length > 512) return;
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

// ─── IPC: Safe storage (OS-keychain-backed encryption) ─────────────
ipcMain.handle('storage:isAvailable', () => safeStorage.isEncryptionAvailable());

ipcMain.handle('storage:encrypt', (_event, plaintext: unknown) => {
  if (typeof plaintext !== 'string' || plaintext.length > 4096)
    throw new Error('storage:encrypt: invalid input');
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.encryptString(plaintext).toString('base64');
});

ipcMain.handle('storage:decrypt', (_event, ciphertext: unknown) => {
  if (typeof ciphertext !== 'string' || ciphertext.length > 8192)
    throw new Error('storage:decrypt: invalid input');
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'));
  } catch {
    // catch-no-log-ok: corrupted or wrong-key ciphertext; caller receives null
    return null;
  }
});

// ─── IPC: Login item (launch at startup) ───────────────────────────
ipcMain.handle('app:getLoginItem', () => {
  const settings = app.getLoginItemSettings();
  return { openAtLogin: settings.openAtLogin };
});

ipcMain.handle('app:setLoginItem', (_event, openAtLogin: unknown) => {
  if (typeof openAtLogin !== 'boolean')
    throw new Error('app:setLoginItem: openAtLogin must be a boolean');
  app.setLoginItemSettings({ openAtLogin });
});

// ─── IPC: Persistent app settings (SQLite-backed key/value) ────────
// Allow-list keys to prevent arbitrary writes from a compromised renderer.
const APP_SETTINGS_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'meshtasticMessageRetentionEnabled',
  'meshtasticMessageRetentionCount',
  'meshcoreMessageRetentionEnabled',
  'meshcoreMessageRetentionCount',
]);
const APP_SETTINGS_MAX_VALUE_LENGTH = 256;

ipcMain.handle('appSettings:get', () => {
  try {
    const rows = getDatabase().prepareOnce('SELECT key, value FROM app_settings').all() as {
      key: string;
      value: string;
    }[];
    const out: Record<string, string> = {};
    for (const row of rows) {
      if (typeof row.key === 'string' && typeof row.value === 'string') {
        out[row.key] = row.value;
      }
    }
    return out;
  } catch (err) {
    console.error(
      '[IPC] appSettings:get failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('appSettings:set', (event, key: unknown, value: unknown) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  if (typeof key !== 'string' || !APP_SETTINGS_ALLOWED_KEYS.has(key)) {
    throw new Error('appSettings:set: key not allowed');
  }
  if (typeof value !== 'string' || value.length > APP_SETTINGS_MAX_VALUE_LENGTH) {
    throw new Error('appSettings:set: value must be a string under 256 chars');
  }
  try {
    const result = getDatabase()
      .prepareOnce('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)')
      .run(key, value);
    console.debug(`[IPC] appSettings:set: ${sanitizeLogMessage(key)} (${result.changes} rows)`);
    return { changes: Number(result.changes) };
  } catch (err) {
    console.error(
      '[IPC] appSettings:set failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('app:showEmojiPanel', (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  if (process.platform === 'darwin' || process.platform === 'win32') {
    app.showEmojiPanel();
  }
});

ipcMain.handle('app:quit', async (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  isQuitting = true;
  isConnected = false;
  try {
    mqttManager.disconnect();

    meshcoreMqttAdapter.disconnect();

    await nobleBleManager.stopAllScanning();
    try {
      await nobleBleManager.disconnectAll();
    } catch (err) {
      console.error(
        '[IPC] app:quit BLE disconnectAll failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
    }

    closeDatabase();

    if (meshcoreTcpSocket) {
      try {
        meshcoreTcpSocket.destroy();
      } catch (err) {
        console.debug(
          '[IPC] app:quit TCP socket destroy (ignored):',
          err instanceof Error ? err.message : err,
        ); // log-injection-ok internal Node.js socket error during cleanup
      }
      meshcoreTcpSocket = null;
    }
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
    }
    powerSaveBlockerId = null;

    nobleBleManager.releaseNobleProcessHandles();
    tray?.destroy();
    tray = null;
    app.exit(0);
  } catch (err) {
    console.error(
      '[IPC] app:quit disconnect failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    app.quit();
  } finally {
    // no-op: handled above
  }
});

// ─── IPC: Database operations ──────────────────────────────────────
ipcMain.handle('db:saveMessage', (_event, message) => {
  try {
    validateSaveMessage(message);
    const db = getDatabase();
    const stmt = db.prepareOnce(`
      INSERT OR IGNORE INTO messages (sender_id, sender_name, payload, channel, timestamp, packet_id, status, error, emoji, reply_id, to_node, mqtt_status, received_via, reply_preview_text, reply_preview_sender)
      VALUES (@sender_id, @sender_name, @payload, @channel, @timestamp, @packet_id, @status, @error, @emoji, @reply_id, @to_node, @mqtt_status, @received_via, @reply_preview_text, @reply_preview_sender)
    `);
    const validReceivedVia = ['rf', 'mqtt', 'both'];
    return stmt.run({
      sender_id: safeNonNegativeInt(message.sender_id),
      sender_name: message.sender_name,
      payload: message.payload,
      channel: safeNonNegativeInt(message.channel),
      timestamp: message.timestamp,
      packet_id: message.packetId != null ? safeNonNegativeInt(message.packetId) : null,
      status: message.status ?? null,
      error: message.error ?? null,
      emoji: message.emoji != null ? (sanitizeUnicodeReactionScalar(message.emoji) ?? null) : null,
      reply_id: message.replyId != null ? safeNonNegativeInt(message.replyId) : null,
      to_node: message.to != null ? safeNonNegativeInt(message.to) : null,
      mqtt_status: message.mqttStatus ?? null,
      received_via:
        message.receivedVia != null && validReceivedVia.includes(message.receivedVia)
          ? message.receivedVia
          : null,
      reply_preview_text: message.replyPreviewText ?? null,
      reply_preview_sender: message.replyPreviewSender ?? null,
    });
  } catch (err) {
    console.error(
      '[IPC] db:saveMessage failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:getMessages', (_event, channel?: number, limit = 200) => {
  try {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 1000), 10000);
    const db = getDatabase();
    const columns = `id, sender_id, sender_name, payload, channel, timestamp,
         packet_id AS packetId, status, error, emoji, reply_id AS replyId, to_node,
         mqtt_status AS mqttStatus, received_via AS receivedVia,
         reply_preview_text AS replyPreviewText, reply_preview_sender AS replyPreviewSender`;
    let rows: any[];
    if (channel != null) {
      const ch = safeNonNegativeInt(channel);
      rows = db
        .prepareOnce(
          `SELECT ${columns} FROM messages WHERE channel = ? ORDER BY timestamp DESC LIMIT ?`,
        )
        .all(ch, safeLimit);
    } else {
      rows = db
        .prepareOnce(`SELECT ${columns} FROM messages ORDER BY timestamp DESC LIMIT ?`)
        .all(safeLimit);
    }

    // Map to_node back to `to` for the renderer; drop invalid reaction scalars from legacy rows
    return rows.map((r: any) => {
      const { to_node, emoji: emojiRaw, ...rest } = r;
      const emoji =
        emojiRaw != null ? (sanitizeUnicodeReactionScalar(emojiRaw) ?? undefined) : undefined;
      return { ...rest, emoji, to: to_node ?? undefined };
    });
  } catch (err) {
    console.error(
      '[IPC] db:getMessages failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:saveNode', (_event, node) => {
  try {
    validateSaveNode(node);
    const db = getDatabase();
    const stmt = db.prepareOnce(`
      INSERT INTO nodes (node_id, long_name, short_name, hw_model, snr, rssi, battery, last_heard, latitude, longitude, role, hops_away, via_mqtt, voltage, channel_utilization, air_util_tx, altitude, favorited, source, num_packets_rx_bad, num_rx_dupe, num_packets_rx, num_packets_tx, hops, path)
      VALUES (@node_id, @long_name, @short_name, @hw_model, @snr, @rssi, @battery, @last_heard, @latitude, @longitude, @role, @hops_away, @via_mqtt, @voltage, @channel_utilization, @air_util_tx, @altitude,
        COALESCE((SELECT favorited FROM nodes WHERE node_id = @node_id), 0),
        @source, @num_packets_rx_bad, @num_rx_dupe, @num_packets_rx, @num_packets_tx, @hops, @path)
      ON CONFLICT(node_id) DO UPDATE SET
        long_name = COALESCE(NULLIF(excluded.long_name, ''), nodes.long_name),
        short_name = COALESCE(NULLIF(excluded.short_name, ''), nodes.short_name),
        hw_model = COALESCE(NULLIF(excluded.hw_model, ''), nodes.hw_model),
        snr = COALESCE(excluded.snr, nodes.snr),
        rssi = COALESCE(excluded.rssi, nodes.rssi),
        battery = COALESCE(excluded.battery, nodes.battery),
        last_heard = CASE WHEN excluded.last_heard IS NOT NULL AND excluded.last_heard > 0 THEN excluded.last_heard ELSE nodes.last_heard END,
        latitude = CASE WHEN excluded.latitude IS NOT NULL AND excluded.latitude != 0 THEN excluded.latitude ELSE nodes.latitude END,
        longitude = CASE WHEN excluded.longitude IS NOT NULL AND excluded.longitude != 0 THEN excluded.longitude ELSE nodes.longitude END,
        role = COALESCE(excluded.role, nodes.role),
        hops_away = CASE
          WHEN excluded.hops_away IS NOT NULL AND (nodes.hops_away IS NULL OR excluded.hops_away < nodes.hops_away) THEN excluded.hops_away
          ELSE nodes.hops_away
        END,
        via_mqtt = COALESCE(excluded.via_mqtt, nodes.via_mqtt),
        voltage = COALESCE(excluded.voltage, nodes.voltage),
        channel_utilization = COALESCE(excluded.channel_utilization, nodes.channel_utilization),
        air_util_tx = COALESCE(excluded.air_util_tx, nodes.air_util_tx),
        altitude = COALESCE(excluded.altitude, nodes.altitude),
        source = CASE
          WHEN nodes.source = 'mqtt' AND excluded.source = 'rf' AND COALESCE(excluded.via_mqtt, 0) = 1 THEN 'mqtt'
          ELSE COALESCE(excluded.source, nodes.source, 'rf')
        END,
        num_packets_rx_bad = COALESCE(excluded.num_packets_rx_bad, num_packets_rx_bad),
        num_rx_dupe = COALESCE(excluded.num_rx_dupe, num_rx_dupe),
        num_packets_rx = COALESCE(excluded.num_packets_rx, num_packets_rx),
        num_packets_tx = COALESCE(excluded.num_packets_tx, num_packets_tx),
        hops = CASE
          WHEN excluded.hops IS NOT NULL AND (nodes.hops IS NULL OR excluded.hops < nodes.hops) THEN excluded.hops
          ELSE nodes.hops
        END,
        path = COALESCE(excluded.path, nodes.path)
    `);
    return stmt.run({
      role: null,
      hops_away: node.hops_away ?? null,
      rssi: null,
      voltage: null,
      channel_utilization: null,
      air_util_tx: null,
      altitude: null,
      source: 'rf',
      num_packets_rx_bad: null,
      num_rx_dupe: null,
      num_packets_rx: null,
      num_packets_tx: null,
      ...node,
      via_mqtt: node.via_mqtt != null ? (node.via_mqtt ? 1 : 0) : null,
      hops: node.hops ?? node.hops_away ?? null,
      path: node.path != null ? JSON.stringify(node.path) : null,
    });
  } catch (err) {
    console.error(
      '[IPC] db:saveNode failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:saveNodePath', (_event, nodeId: number, lastHeard: number, buffer: Buffer) => {
  try {
    if (!isPathPacket(buffer)) {
      throw new Error('Not a PATH packet');
    }
    const { hops, path } = decodePathPayload(buffer);
    upsertNodePath(nodeId, lastHeard, hops, path);
    return { success: true, hops, path };
  } catch (err) {
    console.error(
      '[IPC] db:saveNodePath failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:saveNodeTrace', (_event, nodeId: number, lastHeard: number, buffer: Buffer) => {
  try {
    if (!isTracePacket(buffer)) {
      throw new Error('Not a TRACE packet');
    }
    const { hops, path } = decodeTracePayload(buffer);
    console.debug('[IPC] db:saveNodeTrace: nodeId=', nodeId.toString(16), 'hops=', hops);
    return { success: true, hops, path };
  } catch (err) {
    console.error(
      '[IPC] db:saveNodeTrace failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:setNodeFavorited', (_event, nodeId: number, favorited: boolean) => {
  try {
    const id = safeNonNegativeInt(nodeId);
    if (typeof favorited !== 'boolean')
      throw new Error('db:setNodeFavorited: favorited must be a boolean');
    const db = getDatabase();
    return db
      .prepareOnce('UPDATE nodes SET favorited = ? WHERE node_id = ?')
      .run(favorited ? 1 : 0, id);
  } catch (err) {
    console.error(
      '[IPC] db:setNodeFavorited failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:getNodes', () => {
  try {
    const db = getDatabase();
    return db.prepareOnce('SELECT * FROM nodes ORDER BY last_heard DESC').all();
  } catch (err) {
    console.error(
      '[IPC] db:getNodes failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:clearMessages', (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    const db = getDatabase();
    const result = db.prepareOnce('DELETE FROM messages').run();
    console.debug(`[IPC] db:clearMessages: deleted ${result.changes} messages`);
    return result;
  } catch (err) {
    console.error(
      '[IPC] db:clearMessages failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:clearNodes', (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    const db = getDatabase();
    const result = db.prepareOnce('DELETE FROM nodes').run();
    console.debug(`[IPC] db:clearNodes: deleted ${result.changes} nodes`);
    return result;
  } catch (err) {
    console.error(
      '[IPC] db:clearNodes failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:clearNodePositions', () => {
  try {
    const db = getDatabase();
    const result = db
      .prepareOnce('UPDATE nodes SET latitude = NULL, longitude = NULL, altitude = NULL')
      .run();
    console.debug(`[IPC] db:clearNodePositions: cleared positions for ${result.changes} nodes`);
    return result;
  } catch (err) {
    console.error(
      '[IPC] db:clearNodePositions failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:deleteNode', (event, nodeId: number) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    const id = safeNonNegativeInt(nodeId);
    const db = getDatabase();
    const result = db.prepareOnce('DELETE FROM nodes WHERE node_id = ?').run(id);
    console.debug(
      `[IPC] db:deleteNode: deleted node 0x${id.toString(16).toUpperCase()} (${result.changes} rows)`,
    );
    return result;
  } catch (err) {
    console.error(
      '[IPC] db:deleteNode failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:deleteNodesNeverHeard', (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    const result = getDatabase()
      .prepareOnce(
        "DELETE FROM nodes WHERE (last_heard IS NULL OR last_heard = 0) AND (favorited IS NULL OR favorited = 0) AND source != 'meshcore'",
      )
      .run();
    console.debug(`[IPC] db:deleteNodesNeverHeard: pruned ${result.changes} never-heard nodes`);
    return result;
  } catch (err) {
    console.error(
      '[IPC] db:deleteNodesNeverHeard failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:deleteNodesByAge', (event, days: number) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    if (typeof days !== 'number' || days < 1 || !isFinite(days)) return { changes: 0 };
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    const result = getDatabase()
      .prepareOnce(
        "DELETE FROM nodes WHERE (last_heard < ? OR last_heard IS NULL OR last_heard = 0) AND (favorited IS NULL OR favorited = 0) AND source != 'meshcore'",
      )
      .run(cutoff);
    console.debug(`[IPC] db:deleteNodesByAge: pruned ${result.changes} nodes older than ${days}d`);
    return result;
  } catch (err) {
    console.error(
      '[IPC] db:deleteNodesByAge failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:pruneNodesByCount', (_event, maxCount: number) => {
  try {
    if (typeof maxCount !== 'number' || maxCount < 1 || !isFinite(maxCount)) return { changes: 0 };
    const result = getDatabase()
      .prepareOnce(
        'DELETE FROM nodes WHERE node_id NOT IN (SELECT node_id FROM nodes ORDER BY last_heard DESC LIMIT ?)',
      )
      .run(maxCount);
    console.debug(
      `[IPC] db:pruneNodesByCount: pruned ${result.changes} nodes, keeping top ${maxCount}`,
    );
    return result;
  } catch (err) {
    console.error(
      '[IPC] db:pruneNodesByCount failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:pruneMessagesByCount', (_event, maxCount: number) => {
  try {
    if (typeof maxCount !== 'number' || maxCount < 100 || !isFinite(maxCount))
      return { changes: 0 };
    const cap = Math.floor(maxCount);
    const result = getDatabase()
      .prepareOnce(
        'DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY timestamp DESC, id DESC LIMIT ?)',
      )
      .run(cap);
    console.debug(
      `[IPC] db:pruneMessagesByCount: pruned ${result.changes} messages, keeping newest ${cap}`,
    );
    return result;
  } catch (err) {
    console.error(
      '[IPC] db:pruneMessagesByCount failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:pruneMeshcoreMessagesByCount', (_event, maxCount: number) => {
  try {
    if (typeof maxCount !== 'number' || maxCount < 100 || !isFinite(maxCount))
      return { changes: 0 };
    const cap = Math.floor(maxCount);
    const result = getDatabase()
      .prepareOnce(
        'DELETE FROM meshcore_messages WHERE id NOT IN (SELECT id FROM meshcore_messages ORDER BY timestamp DESC, id DESC LIMIT ?)',
      )
      .run(cap);
    console.debug(
      `[IPC] db:pruneMeshcoreMessagesByCount: pruned ${result.changes} messages, keeping newest ${cap}`,
    );
    return result;
  } catch (err) {
    console.error(
      '[IPC] db:pruneMeshcoreMessagesByCount failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:deleteNodesBatch', (event, nodeIds: number[]) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) return 0;
    const safe = nodeIds
      .filter((id) => typeof id === 'number' && Number.isInteger(id) && id > 0)
      .slice(0, 10_000);
    if (safe.length === 0) return 0;
    const placeholders = safe.map(() => '?').join(', ');
    const result = getDatabase()
      .prepareOnce(`DELETE FROM nodes WHERE node_id IN (${placeholders})`)
      .run(...safe);
    console.debug(`[IPC] db:deleteNodesBatch: deleted ${result.changes} nodes`);
    return result.changes;
  } catch (err) {
    console.error(
      '[IPC] db:deleteNodesBatch failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:clearMessagesByChannel', (event, channel: number) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    const ch = safeNonNegativeInt(channel);
    const result = getDatabase().prepareOnce('DELETE FROM messages WHERE channel = ?').run(ch);
    console.debug(
      `[IPC] db:clearMessagesByChannel: deleted ${result.changes} messages from channel ${ch}`,
    );
    return result;
  } catch (err) {
    console.error(
      '[IPC] db:clearMessagesByChannel failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:getMessageChannels', () => {
  try {
    return getDatabase()
      .prepareOnce('SELECT DISTINCT channel FROM messages ORDER BY channel')
      .all();
  } catch (err) {
    console.error(
      '[IPC] db:getMessageChannels failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:deleteNodesBySource', (event, source: string) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    if (typeof source !== 'string')
      throw new Error('db:deleteNodesBySource: source must be a string');
    if (source.length > 64) throw new Error('db:deleteNodesBySource: source string too long');
    const changes = deleteNodesBySource(source);
    console.debug(
      `[IPC] db:deleteNodesBySource(${sanitizeLogMessage(source)}): pruned ${changes} nodes`,
    );
    return changes;
  } catch (err) {
    console.error(
      '[IPC] db:deleteNodesBySource failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:migrateRfStubNodes', () => {
  try {
    const changes = migrateRfStubNodes();
    console.debug(`[IPC] db:migrateRfStubNodes: renamed ${changes} RF stub nodes`);
    return changes;
  } catch (err) {
    console.error(
      '[IPC] db:migrateRfStubNodes failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:deleteNodesWithoutLongname', (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    const changes = deleteNodesWithoutLongname();
    console.debug(`[IPC] db:deleteNodesWithoutLongname: pruned ${changes} unnamed nodes`);
    return changes;
  } catch (err) {
    console.error(
      '[IPC] db:deleteNodesWithoutLongname failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:prunePositionHistory', (_event, days: number) => {
  try {
    const safeDays = typeof days === 'number' && days > 0 ? Math.floor(days) : 30;
    const changes = prunePositionHistory(safeDays);
    if (changes > 0) {
      console.debug(
        `[IPC] db:prunePositionHistory: pruned ${changes} rows older than ${safeDays}d`,
      );
    }
    return changes;
  } catch (err) {
    console.error(
      '[IPC] db:prunePositionHistory failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:deleteMeshcoreContactsNeverAdvertised', () => {
  try {
    const changes = deleteMeshcoreContactsNeverAdvertised();
    if (changes > 0) {
      console.debug(`[IPC] db:deleteMeshcoreContactsNeverAdvertised: removed ${changes} contacts`);
    }
    return changes;
  } catch (err) {
    console.error(
      '[IPC] db:deleteMeshcoreContactsNeverAdvertised failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:deleteMeshcoreContactsByAge', (_event, days: number) => {
  try {
    const safeDays = typeof days === 'number' && days > 0 ? Math.floor(days) : 30;
    const changes = deleteMeshcoreContactsByAge(safeDays);
    if (changes > 0) {
      console.debug(
        `[IPC] db:deleteMeshcoreContactsByAge: removed ${changes} contacts older than ${safeDays}d`,
      );
    }
    return changes;
  } catch (err) {
    console.error(
      '[IPC] db:deleteMeshcoreContactsByAge failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:pruneMeshcoreContactsByCount', (_event, maxCount: number) => {
  try {
    const safeMax = typeof maxCount === 'number' && maxCount > 0 ? Math.floor(maxCount) : 5000;
    const changes = pruneMeshcoreContactsByCount(safeMax);
    if (changes > 0) {
      console.debug(`[IPC] db:pruneMeshcoreContactsByCount: removed ${changes} excess contacts`);
    }
    return changes;
  } catch (err) {
    console.error(
      '[IPC] db:pruneMeshcoreContactsByCount failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

function capStatusString(label: string, value: string | undefined | null): string | null {
  if (value == null) return null;
  if (value.length > MAX_STATUS_STRING)
    throw new Error(`${label} exceeds maximum length (${MAX_STATUS_STRING})`);
  return value;
}

// ─── IPC: Update message delivery status ────────────────────────────
ipcMain.handle(
  'db:updateMessageStatus',
  (_event, packetId: number, status: string, error?: string, mqttStatus?: string) => {
    try {
      const pid = safeNonNegativeInt(packetId);
      if (typeof status !== 'string')
        throw new Error('db:updateMessageStatus: status must be a string');
      const statusSafe = capStatusString('db:updateMessageStatus: status', status)!;
      const errorSafe = capStatusString('db:updateMessageStatus: error', error);
      const db = getDatabase();
      if (mqttStatus !== undefined) {
        if (typeof mqttStatus !== 'string')
          throw new Error('db:updateMessageStatus: mqttStatus must be a string');
        const mqttSafe = capStatusString('db:updateMessageStatus: mqttStatus', mqttStatus)!;
        return db
          .prepareOnce(
            'UPDATE messages SET status = ?, error = ?, mqtt_status = ? WHERE packet_id = ?',
          )
          .run(statusSafe, errorSafe, mqttSafe, pid);
      }
      return db
        .prepareOnce('UPDATE messages SET status = ?, error = ? WHERE packet_id = ?')
        .run(statusSafe, errorSafe, pid);
    } catch (err) {
      console.error(
        '[IPC] db:updateMessageStatus failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  },
);

// ─── IPC: Upgrade received_via to 'both' when packet arrives on second transport ─
ipcMain.handle('db:updateMessageReceivedVia', (_event, packetId: number) => {
  try {
    const pid = safeNonNegativeInt(packetId);
    const db = getDatabase();
    return db
      .prepareOnce(
        "UPDATE messages SET received_via = 'both' WHERE packet_id = ? AND received_via != 'both'",
      )
      .run(pid);
  } catch (err) {
    console.error(
      '[IPC] db:updateMessageReceivedVia failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

/** Replace optimistic temp `packet_id` with the real mesh id from `sendText()` (tapbacks key on `reply_id`). */
ipcMain.handle('db:updateMessagePacketId', (_event, oldPacketId: number, newPacketId: number) => {
  try {
    const oldPid = safeNonNegativeInt(oldPacketId);
    const newPid = safeNonNegativeInt(newPacketId);
    const db = getDatabase();
    return db
      .prepareOnce('UPDATE messages SET packet_id = ? WHERE packet_id = ?')
      .run(newPid, oldPid);
  } catch (err) {
    console.error(
      '[IPC] db:updateMessagePacketId failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

// ─── IPC: Export database ───────────────────────────────────────────
ipcMain.handle('db:export', async () => {
  try {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Database',
      defaultPath: `mesh-client-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    if (!result.canceled && result.filePath) {
      exportDatabase(result.filePath);
      return result.filePath;
    }
    return null;
  } catch (err) {
    console.error(
      '[IPC] db:export failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

// ─── IPC: Import / merge database ───────────────────────────────────
ipcMain.handle('db:import', async () => {
  try {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Database',
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
      properties: ['openFile'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return mergeDatabase(result.filePaths[0]);
    }
    return null;
  } catch (err) {
    console.error(
      '[IPC] db:import failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

// ─── IPC: Clear Chromium session data (BLE cache, cookies, etc.) ──
ipcMain.handle('session:clearData', async (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    await win.webContents.session.clearStorageData({
      storages: ['cookies', 'localstorage', 'cachestorage', 'shadercache', 'serviceworkers'],
    });
    await win.webContents.session.clearCache();
  } catch (err) {
    console.error(
      '[IPC] session:clearData failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

// ─── IPC: Log panel ─────────────────────────────────────────────────
ipcMain.handle('log:getPath', () => {
  try {
    return getLogPath();
  } catch (err) {
    console.error(
      '[IPC] log:getPath failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('log:getRecentLines', () => {
  try {
    return getRecentLines();
  } catch (err) {
    console.error(
      '[IPC] log:getRecentLines failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('log:clear', (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    clearLogFile();
  } catch (err) {
    console.error(
      '[IPC] log:clear failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('log:device-connection', (_event, detail: unknown) => {
  if (typeof detail !== 'string' || detail.length > 8192) return;
  logDeviceConnection(detail);
});

ipcMain.handle('log:export', async (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export log',
      defaultPath: `mesh-client-log-${new Date().toISOString().slice(0, 10)}.log`,
      filters: [{ name: 'Log file', extensions: ['log', 'txt'] }],
    });
    if (!result.canceled && result.filePath) {
      const src = getLogPath();
      if (!fs.existsSync(src)) {
        await fs.promises.writeFile(result.filePath, '', 'utf8');
      } else {
        await exportLogTo(result.filePath);
      }
      return result.filePath;
    }
    return null;
  } catch (err) {
    console.error(
      '[IPC] log:export failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

// ─── IPC: MeshCore database operations ──────────────────────────────
ipcMain.handle('db:getMeshcoreMessages', (_event, channelIdx?: number, limit = 200) => {
  try {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 200), 10000);
    const db = getDatabase();
    // Order by row id (insert order at this client), not `timestamp`:
    // outgoing messages use Date.now() while RF inbound uses the radio's clock; if the device
    // time lags, ORDER BY timestamp DESC kept "recent" sends but dropped inbound rows from the
    // LIMIT window. Reversed DESC→ASC yields oldest-first within the N most recently stored rows.
    if (channelIdx != null) {
      const ch = typeof channelIdx === 'number' ? Math.trunc(channelIdx) : 0;
      const rows = db
        .prepareOnce(
          'SELECT * FROM meshcore_messages WHERE channel_idx = ? ORDER BY id DESC LIMIT ?',
        )
        .all(ch, safeLimit) as Record<string, unknown>[];
      rows.reverse();
      return rows;
    }
    const rows = db
      .prepareOnce('SELECT * FROM meshcore_messages ORDER BY id DESC LIMIT ?')
      .all(safeLimit) as Record<string, unknown>[];
    rows.reverse();
    return rows;
  } catch (err) {
    console.error(
      '[IPC] db:getMeshcoreMessages failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:searchMessages', (_event, query: string, limit?: number) => {
  try {
    if (typeof query !== 'string' || query.length > 500) return [];
    return searchMessages(query, Math.min(limit ?? 50, 200));
  } catch (err) {
    console.error(
      '[IPC] db:searchMessages failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    return [];
  }
});

ipcMain.handle('db:searchMeshcoreMessages', (_event, query: string, limit?: number) => {
  try {
    if (typeof query !== 'string' || query.length > 500) return [];
    return searchMeshcoreMessages(query, Math.min(limit ?? 50, 200));
  } catch (err) {
    console.error(
      '[IPC] db:searchMeshcoreMessages failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    return [];
  }
});

ipcMain.handle('db:getMeshcoreContacts', () => {
  try {
    return getDatabase().prepareOnce('SELECT * FROM meshcore_contacts').all();
  } catch (err) {
    console.error(
      '[IPC] db:getMeshcoreContacts failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:saveMeshcoreMessage', (_event, message) => {
  try {
    validateSaveMeshcoreMessage(message);
    const m = message as Record<string, unknown>;
    const replyId = m.reply_id != null ? Number(m.reply_id) : null;
    if (replyId != null && (!Number.isFinite(replyId) || replyId < 0)) {
      throw new Error('db:saveMeshcoreMessage: reply_id must be a non-negative finite number');
    }
    const db = getDatabase();
    const validReceivedVia = ['rf', 'mqtt', 'both'] as const;
    const receivedViaRaw = m.received_via;
    const received_via =
      typeof receivedViaRaw === 'string' &&
      (validReceivedVia as readonly string[]).includes(receivedViaRaw)
        ? receivedViaRaw
        : null;
    const rxFp =
      typeof m.rx_packet_fingerprint === 'string' ? m.rx_packet_fingerprint.toUpperCase() : null;
    const replyPreviewText =
      typeof m.reply_preview_text === 'string' ? m.reply_preview_text.slice(0, 50) : null;
    const replyPreviewSender =
      typeof m.reply_preview_sender === 'string' ? m.reply_preview_sender.slice(0, 64) : null;
    return db
      .prepareOnce(
        'INSERT OR IGNORE INTO meshcore_messages ' +
          '(sender_id, sender_name, payload, channel_idx, timestamp, status, packet_id, emoji, reply_id, to_node, received_via, rx_packet_fingerprint, reply_preview_text, reply_preview_sender) ' +
          'VALUES (@sender_id, @sender_name, @payload, @channel_idx, @timestamp, @status, @packet_id, @emoji, @reply_id, @to_node, @received_via, @rx_packet_fingerprint, @reply_preview_text, @reply_preview_sender)',
      )
      .run({
        sender_id: m.sender_id != null ? Number(m.sender_id) : null,
        sender_name: typeof m.sender_name === 'string' ? m.sender_name : null,
        payload: m.payload as string,
        channel_idx: m.channel_idx != null ? Math.trunc(Number(m.channel_idx)) : 0,
        timestamp: m.timestamp,
        status: typeof m.status === 'string' ? m.status : 'acked',
        packet_id: m.packet_id != null ? Number(m.packet_id) : null,
        emoji: m.emoji != null ? (sanitizeUnicodeReactionScalar(m.emoji) ?? null) : null,
        reply_id: replyId,
        to_node: m.to_node != null ? Number(m.to_node) : null,
        received_via,
        rx_packet_fingerprint: rxFp,
        reply_preview_text: replyPreviewText,
        reply_preview_sender: replyPreviewSender,
      });
  } catch (err) {
    console.error(
      '[IPC] db:saveMeshcoreMessage failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:saveMeshcoreContact', (_event, contact) => {
  try {
    validateSaveMeshcoreContact(contact);
    const c = contact as Record<string, unknown>;
    const db = getDatabase();
    return db
      .prepareOnce(
        'INSERT INTO meshcore_contacts ' +
          '(node_id, public_key, adv_name, contact_type, last_advert, adv_lat, adv_lon, last_snr, last_rssi, favorited, nickname, contact_flags, hops_away, on_radio, last_synced_from_radio) ' +
          'VALUES (@node_id, @public_key, @adv_name, @contact_type, @last_advert, @adv_lat, @adv_lon, @last_snr, @last_rssi, 0, @nickname, @contact_flags, @hops_away, @on_radio, @last_synced_from_radio) ' +
          'ON CONFLICT(node_id) DO UPDATE SET ' +
          "public_key = CASE WHEN excluded.public_key IS NOT NULL AND excluded.public_key != '' AND LENGTH(excluded.public_key) = 64 THEN excluded.public_key ELSE meshcore_contacts.public_key END, " +
          "adv_name = COALESCE(NULLIF(excluded.adv_name, ''), meshcore_contacts.adv_name), " +
          'contact_type = COALESCE(excluded.contact_type, meshcore_contacts.contact_type), ' +
          'last_advert = CASE WHEN excluded.last_advert IS NOT NULL AND excluded.last_advert > 0 THEN excluded.last_advert ELSE meshcore_contacts.last_advert END, ' +
          'adv_lat = CASE WHEN excluded.adv_lat IS NOT NULL AND excluded.adv_lat != 0 THEN excluded.adv_lat ELSE meshcore_contacts.adv_lat END, ' +
          'adv_lon = CASE WHEN excluded.adv_lon IS NOT NULL AND excluded.adv_lon != 0 THEN excluded.adv_lon ELSE meshcore_contacts.adv_lon END, ' +
          'last_snr = COALESCE(excluded.last_snr, meshcore_contacts.last_snr), ' +
          'last_rssi = COALESCE(excluded.last_rssi, meshcore_contacts.last_rssi), ' +
          'favorited = meshcore_contacts.favorited, ' +
          'nickname = COALESCE(excluded.nickname, meshcore_contacts.nickname), ' +
          'contact_flags = COALESCE(excluded.contact_flags, meshcore_contacts.contact_flags), ' +
          'hops_away = CASE WHEN excluded.hops_away IS NOT NULL AND (meshcore_contacts.hops_away IS NULL OR excluded.hops_away < meshcore_contacts.hops_away) THEN excluded.hops_away ELSE meshcore_contacts.hops_away END, ' +
          'on_radio = excluded.on_radio, ' +
          'last_synced_from_radio = excluded.last_synced_from_radio',
      )
      .run({
        node_id: Number(c.node_id),
        public_key: c.public_key as string,
        adv_name: typeof c.adv_name === 'string' ? c.adv_name : null,
        contact_type: c.contact_type != null ? Number(c.contact_type) : 0,
        last_advert: c.last_advert != null ? Number(c.last_advert) : null,
        adv_lat: c.adv_lat != null ? Number(c.adv_lat) : null,
        adv_lon: c.adv_lon != null ? Number(c.adv_lon) : null,
        last_snr: c.last_snr != null ? Number(c.last_snr) : null,
        last_rssi: c.last_rssi != null ? Number(c.last_rssi) : null,
        nickname: typeof c.nickname === 'string' ? c.nickname : null,
        contact_flags: c.contact_flags != null ? Number(c.contact_flags) : 0,
        hops_away: c.hops_away != null ? Number(c.hops_away) : null,
        on_radio: c.on_radio != null ? Number(c.on_radio) : null,
        last_synced_from_radio:
          typeof c.last_synced_from_radio === 'string' ? c.last_synced_from_radio : null,
      });
  } catch (err) {
    console.error(
      '[IPC] db:saveMeshcoreContact failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle(
  'db:updateMeshcoreContactRfTransport',
  (_event, nodeId: number, transportScope: unknown, transportReturn: unknown) => {
    try {
      const id = safeNonNegativeInt(nodeId);
      const ts =
        transportScope != null &&
        typeof transportScope === 'number' &&
        Number.isFinite(transportScope)
          ? Math.trunc(transportScope) & 0xffff
          : null;
      const tr =
        transportReturn != null &&
        typeof transportReturn === 'number' &&
        Number.isFinite(transportReturn)
          ? Math.trunc(transportReturn) & 0xffff
          : null;
      getDatabase()
        .prepareOnce(
          'UPDATE meshcore_contacts SET last_rf_transport_scope = ?, last_rf_transport_return = ? WHERE node_id = ?',
        )
        .run(ts, tr, id);
    } catch (err) {
      console.error(
        '[IPC] db:updateMeshcoreContactRfTransport failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  },
);

ipcMain.handle(
  'db:updateMeshcoreContactNickname',
  (_event, nodeId: number, nickname: string | null) => {
    try {
      const id = safeNonNegativeInt(nodeId);
      if (nickname != null && (typeof nickname !== 'string' || nickname.length > MAX_NODE_STRING))
        throw new Error('db:updateMeshcoreContactNickname: invalid nickname');
      getDatabase()
        .prepareOnce('UPDATE meshcore_contacts SET nickname = ? WHERE node_id = ?')
        .run(nickname ?? null, id);
    } catch (err) {
      console.error(
        '[IPC] db:updateMeshcoreContactNickname failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  },
);

ipcMain.handle(
  'db:updateMeshcoreContactFavorited',
  (_event, nodeId: number, favorited: boolean, publicKeyHex?: string | null) => {
    try {
      const id = safeNonNegativeInt(nodeId);
      if (typeof favorited !== 'boolean') {
        throw new Error('db:updateMeshcoreContactFavorited: favorited must be a boolean');
      }
      if (publicKeyHex != null && typeof publicKeyHex !== 'string') {
        throw new Error('db:updateMeshcoreContactFavorited: publicKeyHex must be a string or null');
      }
      if (publicKeyHex != null && publicKeyHex.length > 128) {
        throw new Error('db:updateMeshcoreContactFavorited: publicKeyHex too long');
      }
      const db = getDatabase();
      const run = db
        .prepareOnce('UPDATE meshcore_contacts SET favorited = ? WHERE node_id = ?')
        .run(favorited ? 1 : 0, id);
      if (run.changes > 0) return run;
      const hex = publicKeyHex?.replace(/\s/g, '') ?? '';
      if (!hex) {
        throw new Error(
          'db:updateMeshcoreContactFavorited: contact not in database; public_key required to create row',
        );
      }
      db.prepareOnce(
        `INSERT INTO meshcore_contacts (node_id, public_key, favorited)
         VALUES (?, ?, ?)
         ON CONFLICT(node_id) DO UPDATE SET favorited = excluded.favorited`,
      ).run(id, hex, favorited ? 1 : 0);
      return { changes: 1 };
    } catch (err) {
      console.error(
        '[IPC] db:updateMeshcoreContactFavorited failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  },
);

ipcMain.handle('meshcore:openJsonFile', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Contacts JSON',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    if (raw.length > 5 * 1024 * 1024) throw new Error('File too large (max 5 MB)');
    return raw;
  } catch (err) {
    console.error(
      '[IPC] meshcore:openJsonFile failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:updateMeshcoreMessageStatus', (_event, packetId: number, status: string) => {
  try {
    const pid = packetId;
    if (!Number.isFinite(pid)) throw new Error('db:updateMeshcoreMessageStatus: invalid packetId');
    if (typeof status !== 'string' || status.length > MAX_STATUS_STRING)
      throw new Error('db:updateMeshcoreMessageStatus: invalid status');
    return getDatabase()
      .prepareOnce('UPDATE meshcore_messages SET status = ? WHERE packet_id = ?')
      .run(status, pid);
  } catch (err) {
    console.error(
      '[IPC] db:updateMeshcoreMessageStatus failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:deleteMeshcoreContact', (_event, nodeId: number) => {
  try {
    const id = safeNonNegativeInt(nodeId);
    return getDatabase().prepareOnce('DELETE FROM meshcore_contacts WHERE node_id = ?').run(id);
  } catch (err) {
    console.error(
      '[IPC] db:deleteMeshcoreContact failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:clearMeshcoreMessages', (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    return getDatabase().prepareOnce('DELETE FROM meshcore_messages').run();
  } catch (err) {
    console.error(
      '[IPC] db:clearMeshcoreMessages failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:getMeshcoreMessageChannels', () => {
  try {
    return getDatabase()
      .prepareOnce(
        'SELECT DISTINCT channel_idx AS channel FROM meshcore_messages ORDER BY channel_idx',
      )
      .all();
  } catch (err) {
    console.error(
      '[IPC] db:getMeshcoreMessageChannels failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:clearMeshcoreMessagesByChannel', (event, channelIdx: number) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    const ch = safeMeshcoreChannelIndex(channelIdx);
    const result = getDatabase()
      .prepareOnce('DELETE FROM meshcore_messages WHERE channel_idx = ?')
      .run(ch);
    console.debug(
      `[IPC] db:clearMeshcoreMessagesByChannel: deleted ${result.changes} messages from channel_idx ${ch}`,
    );
    return result;
  } catch (err) {
    console.error(
      '[IPC] db:clearMeshcoreMessagesByChannel failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:clearMeshcoreContacts', (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    return getDatabase().prepareOnce('DELETE FROM meshcore_contacts').run();
  } catch (err) {
    console.error(
      '[IPC] db:clearMeshcoreContacts failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

// Deletes only Repeater-type contacts (contact_type = 2), leaving Chat and Room contacts intact.
ipcMain.handle('db:clearMeshcoreRepeaters', (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('IPC sender validation failed');
  }
  try {
    return getDatabase().prepareOnce('DELETE FROM meshcore_contacts WHERE contact_type = 2').run();
  } catch (err) {
    console.error(
      '[IPC] db:clearMeshcoreRepeaters failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

// Marks all contacts as not on radio (on_radio = 0).
ipcMain.handle('db:markAllMeshcoreContactsOffRadio', () => {
  try {
    return getDatabase().prepareOnce('UPDATE meshcore_contacts SET on_radio = 0').run();
  } catch (err) {
    console.error(
      '[IPC] db:markAllMeshcoreContactsOffRadio failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

// Returns count of contacts currently marked as on_radio = 1.
ipcMain.handle('db:getMeshcoreContactCount', () => {
  try {
    const result = getDatabase()
      .prepareOnce('SELECT COUNT(*) as cnt FROM meshcore_contacts WHERE on_radio = 1')
      .get() as { cnt: number };
    return result.cnt;
  } catch (err) {
    console.error(
      '[IPC] db:getMeshcoreContactCount failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

// Deletes contacts without pubkey, excluding chat stub nodes. Returns { deleted, excludedStubCount }.
ipcMain.handle('db:deleteMeshcoreContactsWithoutPubkey', () => {
  try {
    const db = getDatabase();
    // Count stubs that would be excluded (for reporting)
    const stubCountResult = db
      .prepareOnce(
        `SELECT COUNT(*) as cnt FROM meshcore_contacts
         WHERE (public_key IS NULL OR public_key = '')
         AND node_id >= ? AND node_id <= ?`,
      )
      .get(MESHCORE_CHAT_STUB_ID_MIN, MESHCORE_CHAT_STUB_ID_MAX) as { cnt: number };
    const excludedStubCount = stubCountResult.cnt;
    // Delete non-stub contacts without pubkey
    const result = db
      .prepareOnce(
        `DELETE FROM meshcore_contacts
         WHERE (public_key IS NULL OR public_key = '')
         AND NOT (node_id >= ? AND node_id <= ?)`,
      )
      .run(MESHCORE_CHAT_STUB_ID_MIN, MESHCORE_CHAT_STUB_ID_MAX);
    return { deleted: result.changes, excludedStubCount };
  } catch (err) {
    console.error(
      '[IPC] db:deleteMeshcoreContactsWithoutPubkey failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

// Offloads all contacts with pubkey from radio (sets on_radio = 0). Returns count offloaded.
ipcMain.handle('db:offloadAllMeshcoreContacts', () => {
  try {
    const result = getDatabase()
      .prepareOnce(
        `UPDATE meshcore_contacts SET on_radio = 0
         WHERE on_radio = 1 AND public_key IS NOT NULL AND public_key != ''`,
      )
      .run();
    return result.changes;
  } catch (err) {
    console.error(
      '[IPC] db:offloadAllMeshcoreContacts failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

// Get a single contact by node_id (returns on_radio status).
ipcMain.handle('db:getMeshcoreContactById', (_event, nodeId: number) => {
  try {
    const id = safeNonNegativeInt(nodeId);
    return getDatabase()
      .prepareOnce('SELECT node_id, public_key, on_radio FROM meshcore_contacts WHERE node_id = ?')
      .get(id);
  } catch (err) {
    console.error(
      '[IPC] db:getMeshcoreContactById failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

// ─── IPC: Contact groups ──────────────────────────────────────────────────────

ipcMain.handle('db:getContactGroups', (_event, selfNodeId: number) => {
  try {
    return getContactGroups(safeNonNegativeInt(selfNodeId));
  } catch (err) {
    console.error(
      '[IPC] db:getContactGroups failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:createContactGroup', (_event, selfNodeId: number, name: string) => {
  try {
    const id = safeNonNegativeInt(selfNodeId);
    if (typeof name !== 'string' || name.trim().length === 0)
      throw new Error('db:createContactGroup: name must be a non-empty string');
    if (name.length > MAX_GROUP_NAME) throw new Error('db:createContactGroup: name too long');
    return createContactGroup(id, name.trim());
  } catch (err) {
    console.error(
      '[IPC] db:createContactGroup failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:updateContactGroup', (_event, groupId: number, name: string) => {
  try {
    const id = safeNonNegativeInt(groupId);
    if (typeof name !== 'string' || name.trim().length === 0)
      throw new Error('db:updateContactGroup: name must be a non-empty string');
    if (name.length > MAX_GROUP_NAME) throw new Error('db:updateContactGroup: name too long');
    updateContactGroup(id, name.trim());
  } catch (err) {
    console.error(
      '[IPC] db:updateContactGroup failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:deleteContactGroup', (_event, groupId: number) => {
  try {
    deleteContactGroup(safeNonNegativeInt(groupId));
  } catch (err) {
    console.error(
      '[IPC] db:deleteContactGroup failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:addContactToGroup', (_event, groupId: number, contactNodeId: number) => {
  try {
    addContactToGroup(safeNonNegativeInt(groupId), safeNonNegativeInt(contactNodeId));
  } catch (err) {
    console.error(
      '[IPC] db:addContactToGroup failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:removeContactFromGroup', (_event, groupId: number, contactNodeId: number) => {
  try {
    removeContactFromGroup(safeNonNegativeInt(groupId), safeNonNegativeInt(contactNodeId));
  } catch (err) {
    console.error(
      '[IPC] db:removeContactFromGroup failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:getContactGroupMembers', (_event, groupId: number) => {
  try {
    return getContactGroupMembers(safeNonNegativeInt(groupId));
  } catch (err) {
    console.error(
      '[IPC] db:getContactGroupMembers failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle(
  'db:updateMeshcoreContactAdvert',
  (
    _e,
    nodeId: number,
    lastAdvert: number | null,
    advLat: number | null,
    advLon: number | null,
    advName?: string | null,
  ) => {
    try {
      const safeNodeId = safeNonNegativeInt(nodeId);
      if (advName != null && (typeof advName !== 'string' || advName.length > MAX_NODE_STRING)) {
        throw new Error('db:updateMeshcoreContactAdvert: invalid adv_name');
      }
      const db = getDatabase();
      if (advName !== undefined) {
        db.prepareOnce(
          'UPDATE meshcore_contacts SET last_advert = ?, adv_lat = ?, adv_lon = ?, adv_name = ? WHERE node_id = ?',
        ).run(lastAdvert, advLat, advLon, advName ?? null, safeNodeId);
      } else {
        db.prepareOnce(
          'UPDATE meshcore_contacts SET last_advert = ?, adv_lat = ?, adv_lon = ? WHERE node_id = ?',
        ).run(lastAdvert, advLat, advLon, safeNodeId);
      }
    } catch (err) {
      console.error(
        '[IPC] db:updateMeshcoreContactAdvert error:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  },
);

ipcMain.handle('db:updateMeshcoreContactType', (_e, nodeId: number, contactType: number) => {
  try {
    const safeNodeId = safeNonNegativeInt(nodeId);
    const safeType = safeNonNegativeInt(contactType);
    getDatabase()
      .prepareOnce('UPDATE meshcore_contacts SET contact_type = ? WHERE node_id = ?')
      .run(safeType, safeNodeId);
  } catch (err) {
    console.error(
      '[IPC] db:updateMeshcoreContactType error:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle(
  'db:updateMeshcoreContactLastRf',
  (
    _e,
    nodeId: number,
    lastSnr: number,
    lastRssi: number,
    hops?: number | null,
    timestamp?: number | null,
  ) => {
    try {
      const safeNodeId = safeNonNegativeInt(nodeId);
      if (typeof lastSnr !== 'number' || !Number.isFinite(lastSnr)) {
        throw new Error('db:updateMeshcoreContactLastRf: lastSnr must be a finite number');
      }
      if (typeof lastRssi !== 'number' || !Number.isFinite(lastRssi)) {
        throw new Error('db:updateMeshcoreContactLastRf: lastRssi must be a finite number');
      }
      getDatabase()
        .prepareOnce(
          'UPDATE meshcore_contacts SET ' +
            'last_snr = ?, ' +
            'last_rssi = ?, ' +
            'hops_away = CASE WHEN ? IS NOT NULL AND (hops_away IS NULL OR ? < hops_away) THEN ? ELSE hops_away END, ' +
            'last_advert = CASE WHEN ? IS NOT NULL AND ? > COALESCE(last_advert, 0) THEN ? ELSE last_advert END ' +
            'WHERE node_id = ?',
        )
        .run(
          lastSnr,
          lastRssi,
          hops ?? null,
          hops ?? null,
          hops ?? null,
          timestamp ?? null,
          timestamp ?? null,
          timestamp ?? null,
          safeNodeId,
        );
    } catch (err) {
      console.error(
        '[IPC] db:updateMeshcoreContactLastRf error:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  },
);

// ─── IPC: Position history ────────────────────────────────────────
ipcMain.handle(
  'db:savePositionHistory',
  (_event, nodeId: number, lat: number, lon: number, recordedAt: number, source: string) => {
    try {
      const id = safeNonNegativeInt(nodeId);
      if (
        typeof lat !== 'number' ||
        !isFinite(lat) ||
        typeof lon !== 'number' ||
        !isFinite(lon) ||
        typeof recordedAt !== 'number' ||
        !isFinite(recordedAt)
      )
        return;
      const src = typeof source === 'string' ? source.slice(0, 16) : 'rf';
      getDatabase()
        .prepareOnce(
          'INSERT INTO position_history (node_id, latitude, longitude, recorded_at, source) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, lat, lon, recordedAt, src);
    } catch (err) {
      console.error(
        '[IPC] db:savePositionHistory failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
    }
  },
);

ipcMain.handle('db:getPositionHistory', (_event, sinceMs: number) => {
  try {
    const since = typeof sinceMs === 'number' && isFinite(sinceMs) ? sinceMs : 0;
    return getDatabase()
      .prepareOnce(
        'SELECT node_id, latitude, longitude, recorded_at, source FROM position_history WHERE recorded_at >= ? ORDER BY node_id, recorded_at',
      )
      .all(since);
  } catch (err) {
    console.error(
      '[IPC] db:getPositionHistory failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    return [];
  }
});

ipcMain.handle('db:clearPositionHistory', () => {
  try {
    return getDatabase().prepareOnce('DELETE FROM position_history').run();
  } catch (err) {
    console.error(
      '[IPC] db:clearPositionHistory failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

// ─── MeshCore Path History ───────────────────────────────────────────────

ipcMain.handle(
  'db:saveMeshcoreHopHistory',
  (
    _event,
    nodeId: number,
    timestamp: number,
    hops: number | null,
    snr: number | null,
    rssi: number | null,
  ) => {
    try {
      saveMeshcoreHopHistory(nodeId, timestamp, hops, snr, rssi);
      return true;
    } catch (err) {
      console.error(
        '[IPC] db:saveMeshcoreHopHistory failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  },
);

ipcMain.handle('db:getMeshcoreHopHistory', (_event, nodeId: number) => {
  try {
    return getMeshcoreHopHistory(nodeId);
  } catch (err) {
    console.error(
      '[IPC] db:getMeshcoreHopHistory failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle(
  'db:saveMeshcoreTraceHistory',
  (
    _event,
    nodeId: number,
    timestamp: number,
    pathLen: number | null,
    pathSnrs: number[],
    lastSnr: number | null,
    tag: number,
  ) => {
    try {
      saveMeshcoreTraceHistory(nodeId, timestamp, pathLen, pathSnrs, lastSnr, tag);
      return true;
    } catch (err) {
      console.error(
        '[IPC] db:saveMeshcoreTraceHistory failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  },
);

ipcMain.handle('db:getMeshcoreTraceHistory', (_event, nodeId: number) => {
  try {
    return getMeshcoreTraceHistory(nodeId);
  } catch (err) {
    console.error(
      '[IPC] db:getMeshcoreTraceHistory failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:pruneMeshcorePathHistory', (_event, nodeId: number) => {
  try {
    pruneMeshcorePathHistory(nodeId);
    return true;
  } catch (err) {
    console.error(
      '[IPC] db:pruneMeshcorePathHistory failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle(
  'db:upsertMeshcorePathHistory',
  (
    _event,
    nodeId: number,
    pathHash: string,
    hopCount: number,
    pathBytes: number[],
    wasFloodDiscovery: boolean,
    routeWeight: number,
  ) => {
    try {
      upsertMeshcorePathHistory(
        nodeId,
        pathHash,
        hopCount,
        pathBytes,
        wasFloodDiscovery,
        routeWeight,
      );
      return true;
    } catch (err) {
      console.error(
        '[IPC] db:upsertMeshcorePathHistory failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  },
);

ipcMain.handle(
  'db:recordMeshcorePathOutcome',
  (_event, nodeId: number, pathHash: string, success: boolean, tripTimeMs?: number) => {
    try {
      recordMeshcorePathOutcome(nodeId, pathHash, success, tripTimeMs);
      return true;
    } catch (err) {
      console.error(
        '[IPC] db:recordMeshcorePathOutcome failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  },
);

ipcMain.handle('db:getAllMeshcorePathHistory', () => {
  try {
    return getAllMeshcorePathHistory();
  } catch (err) {
    console.error(
      '[IPC] db:getAllMeshcorePathHistory failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:getMeshcorePathHistory', (_event, nodeId: number) => {
  try {
    return getMeshcorePathHistory(nodeId);
  } catch (err) {
    console.error(
      '[IPC] db:getMeshcorePathHistory failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:deleteMeshcorePathHistoryForNode', (_event, nodeId: number) => {
  try {
    deleteMeshcorePathHistoryForNode(nodeId);
    return true;
  } catch (err) {
    console.error(
      '[IPC] db:deleteMeshcorePathHistoryForNode failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('db:deleteAllMeshcorePathHistory', () => {
  try {
    deleteAllMeshcorePathHistory();
    return true;
  } catch (err) {
    console.error(
      '[IPC] db:deleteAllMeshcorePathHistory failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

// ─── MeshCore TCP bridge ───────────────────────────────────────────
let meshcoreTcpSocket: net.Socket | null = null;

ipcMain.handle('meshcore:tcp-connect', (_event, host: string, port: number) => {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const p = port;
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      reject(new Error('Invalid port'));
      return;
    }
    try {
      validateHttpHost(host);
    } catch (err) {
      // catch-no-log-ok validation error forwarded to promise reject
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    if (meshcoreTcpSocket) {
      meshcoreTcpSocket.destroy();
      meshcoreTcpSocket = null;
    }
    const socket = new net.Socket();
    meshcoreTcpSocket = socket;
    socket.connect(p, host, () => {
      console.debug('[IPC] meshcore:tcp-connect connected to', sanitizeLogMessage(host), p);
      logDeviceConnection(
        `transport=tcp stack=meshcore host=${sanitizeLogMessage(host)} port=${p}`,
      );
      if (!settled) {
        settled = true;
        resolve();
      }
    });
    socket.on('data', (data) => {
      mainWindow?.webContents.send('meshcore:tcp-data', new Uint8Array(data));
    });
    socket.on('close', (hadError) => {
      console.debug('[IPC] meshcore:tcp socket closed', hadError ? '(hadError)' : '(clean)');
      mainWindow?.webContents.send('meshcore:tcp-disconnected');
      if (meshcoreTcpSocket === socket) meshcoreTcpSocket = null;
    });
    socket.on('error', (err) => {
      console.error('[IPC] meshcore:tcp-connect error:', sanitizeLogMessage(err.message));
      if (!settled) {
        settled = true;
        reject(err);
      }
      if (meshcoreTcpSocket === socket) meshcoreTcpSocket = null;
    });
  });
});

ipcMain.handle('meshcore:tcp-write', (_event, bytes: number[]) => {
  if (!Array.isArray(bytes) || bytes.length > MESHCORE_TCP_WRITE_MAX_BYTES) {
    return Promise.reject(
      new Error(
        `meshcore:tcp-write: invalid or oversized payload (max ${MESHCORE_TCP_WRITE_MAX_BYTES} bytes)`,
      ),
    );
  }
  // Validate each element is a valid byte value so Uint8Array coercion is not silently lossy.
  if (!bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    return Promise.reject(new Error('meshcore:tcp-write: byte values must be integers 0-255'));
  }
  if (!meshcoreTcpSocket) {
    const msg = 'meshcore:tcp-write: no active socket';
    console.warn(`[IPC] ${msg}`);
    return Promise.reject(new Error(msg));
  }
  const sock = meshcoreTcpSocket;
  return new Promise<void>((resolve, reject) => {
    sock.write(new Uint8Array(bytes), (err) => {
      if (err) {
        console.error('[IPC] meshcore:tcp-write error:', sanitizeLogMessage(err.message));
        reject(err);
      } else {
        resolve();
      }
    });
  });
});

ipcMain.handle('meshcore:tcp-disconnect', () => {
  if (meshcoreTcpSocket) {
    console.debug('[IPC] meshcore:tcp-disconnect');
    meshcoreTcpSocket.destroy();
    meshcoreTcpSocket = null;
  }
});

// ─── Meshtastic HTTP bridge ─────────────────────────────────────────
let httpDevice: {
  host: string;
  tls: boolean;
  intervalId: NodeJS.Timeout;
} | null = null;

const HTTP_FETCH_INTERVAL_MS = 3000;
/** Max Meshtastic HTTP toRadio payload (aligned with meshcore:tcp-write cap). */
const HTTP_WRITE_TO_RADIO_MAX_BYTES = 256 * 1024;
const MAX_HOST_LENGTH = 253;

/**
 * Hostname validation: accepts DNS labels (a-z, 0-9, hyphens) and dotted IPv4 quads.
 * Rejects hostnames with leading/trailing hyphens per RFC 1123.
 * An empty string or anything over 253 chars is caught separately by the caller.
 */
const VALID_HOSTNAME_RE =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

function validateHttpHost(host: unknown): asserts host is string {
  if (typeof host !== 'string' || host.length === 0 || host.length > MAX_HOST_LENGTH) {
    throw new Error('Invalid host');
  }
  if (!VALID_HOSTNAME_RE.test(host)) {
    throw new Error('Invalid host format');
  }
}

async function httpPreflight(host: string, tls: boolean): Promise<void> {
  const protocol = tls ? 'https' : 'http';
  const url = `${protocol}://${host}/json/report`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

async function httpWriteToRadio(host: string, tls: boolean, data: Uint8Array): Promise<void> {
  const protocol = tls ? 'https' : 'http';
  await fetch(`${protocol}://${host}/api/v1/toradio`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/x-protobuf',
    },
    body: Buffer.from(data),
  });
}

ipcMain.handle('http:preflight', async (_event, host: unknown, tls: unknown) => {
  validateHttpHost(host);
  if (typeof tls !== 'boolean') {
    throw new Error('Invalid tls');
  }
  await httpPreflight(host, tls);
});

ipcMain.handle('http:connect', async (_event, host: unknown, tls: unknown) => {
  validateHttpHost(host);
  if (typeof tls !== 'boolean') {
    throw new Error('Invalid tls');
  }
  if (httpDevice) {
    clearInterval(httpDevice.intervalId);
    httpDevice = null;
  }
  await httpPreflight(host, tls);
  const intervalId = setInterval(() => {
    void (async () => {
      try {
        const protocol = tls ? 'https' : 'http';
        let readBuffer = new ArrayBuffer(1);
        while (readBuffer.byteLength > 0) {
          const response = await fetch(`${protocol}://${host}/api/v1/fromradio?all=false`, {
            method: 'GET',
            headers: {
              Accept: 'application/x-protobuf',
            },
          });
          readBuffer = await response.arrayBuffer();
          if (readBuffer.byteLength > 0) {
            const data = new Uint8Array(readBuffer);
            mainWindow?.webContents.send('http:data', data);
          }
        }
      } catch (err) {
        console.debug(
          '[IPC] http:connect read error:',
          sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
        );
      }
    })();
  }, HTTP_FETCH_INTERVAL_MS);
  httpDevice = { host, tls, intervalId };
  logDeviceConnection(
    `transport=http stack=meshtastic host=${sanitizeLogMessage(host)} tls=${tls}`,
  );
});

ipcMain.handle('http:write', async (_event, data: number[]) => {
  if (!httpDevice) {
    throw new Error('http:write: no active connection');
  }
  if (!Array.isArray(data) || data.length > HTTP_WRITE_TO_RADIO_MAX_BYTES) {
    throw new Error(
      `http:write: invalid or oversized payload (max ${HTTP_WRITE_TO_RADIO_MAX_BYTES} bytes)`,
    );
  }
  if (!data.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw new Error('http:write: byte values must be integers 0-255');
  }
  await httpWriteToRadio(httpDevice.host, httpDevice.tls, new Uint8Array(data));
});

ipcMain.handle('http:disconnect', () => {
  if (httpDevice) {
    console.debug('[IPC] http:disconnect');
    clearInterval(httpDevice.intervalId);
    httpDevice = null;
  }
});

// ─── IPC: TAK server ───────────────────────────────────────────────
ipcMain.handle('tak:start', async (_event, settings) => {
  try {
    console.debug('[IPC] tak:start');
    validateTakSettings(settings);
    const m = await ensureTakServerManager();
    await m.start(settings);
  } catch (err) {
    console.error(
      '[IPC] tak:start failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('tak:stop', () => {
  console.debug('[IPC] tak:stop');
  takServerManager?.stop();
});

ipcMain.handle('tak:getStatus', () => {
  return takServerManager?.getStatus() ?? IDLE_TAK_STATUS;
});

ipcMain.handle('tak:getConnectedClients', () => {
  return takServerManager?.getConnectedClients() ?? [];
});

ipcMain.handle('tak:generateDataPackage', async () => {
  try {
    console.debug('[IPC] tak:generateDataPackage');
    const m = await ensureTakServerManager();
    await m.generateDataPackage();
  } catch (err) {
    console.error(
      '[IPC] tak:generateDataPackage failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('tak:regenerateCertificates', async () => {
  try {
    console.debug('[IPC] tak:regenerateCertificates');
    const m = await ensureTakServerManager();
    await m.regenerateCertificates();
  } catch (err) {
    console.error(
      '[IPC] tak:regenerateCertificates failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('tak:pushNodeUpdate', async (_event, node: unknown) => {
  if (!node || typeof node !== 'object') throw new Error('tak:pushNodeUpdate: node must be object');
  const n = node as Record<string, unknown>;
  const nodeId = Number(n.node_id);
  if (!Number.isFinite(nodeId) || nodeId <= 0)
    throw new Error('tak:pushNodeUpdate: invalid node_id');
  const m = await ensureTakServerManager();
  if (!m.getStatus().running) {
    console.debug('[IPC] tak:pushNodeUpdate: TAK server not running, skipping');
    return;
  }
  m.onNodeUpdate(n as Parameters<TakServerManager['onNodeUpdate']>[0]);
});

// ─── App lifecycle ─────────────────────────────────────────────────
// ─── Second-instance handler ────────────────────────────────────────
// Registered here (before whenReady) so it's ready before any second
// instance can send its data.
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

void app.whenReady().then(() => {
  try {
    initLogFile();
    console.debug(`[Startup] runtime ${formatRuntimeLogTag()}`);

    initDatabase();

    // Auto-restore TAK server if auto-start is enabled
    const takSettingsPath = path.join(app.getPath('userData'), 'tak-settings.json');
    try {
      if (fs.existsSync(takSettingsPath)) {
        const raw = JSON.parse(fs.readFileSync(takSettingsPath, 'utf-8'));
        // Backfill autoStart for settings files saved before the field was added.
        if (
          raw &&
          typeof raw === 'object' &&
          typeof (raw as Record<string, unknown>).autoStart !== 'boolean'
        ) {
          (raw as Record<string, unknown>).autoStart = false;
        }
        const saved = raw as unknown;
        validateTakSettings(saved);
        if (saved.autoStart) {
          void ensureTakServerManager()
            .then((m) => m.start(saved))
            .catch((e: unknown) => {
              console.error(
                '[TAK] Auto-start failed:',
                sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
              );
            });
        }
      }
    } catch (e: unknown) {
      console.warn(
        '[TAK] Settings restore failed:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
    }

    // Force the dock icon in development on macOS
    if (!app.isPackaged && process.platform === 'darwin') {
      const iconPath = path.join(
        __dirname,
        '../../resources/icons/mac/iconset/icon_256x256@1x.png',
      );
      app.dock?.setIcon(iconPath);
    }
    createWindow();

    setupAppMenu();

    // ─── Power monitor: notify renderer on suspend/resume ──────────
    powerMonitor.on('suspend', () => {
      console.debug('[main] System suspending');
      mainWindow?.webContents.send('power:suspend');
    });
    powerMonitor.on('resume', () => {
      console.debug('[main] System resumed');
      mainWindow?.webContents.send('power:resume');
    });
  } catch (error) {
    console.error(
      '[main] Fatal startup error:',
      sanitizeLogMessage(error instanceof Error ? (error.stack ?? error.message) : String(error)),
    );
    const isNativeModuleError =
      error instanceof Error && (error as NodeJS.ErrnoException).code === 'ERR_DLOPEN_FAILED';
    const message = isNativeModuleError
      ? `A native module failed to load. This usually means the app needs to be rebuilt for this version of Electron.\n\nFix: run "pnpm install" in the project directory, then restart.\n\nDetails: ${error.message}`
      : `The application failed to start:\n\n${error instanceof Error ? error.message : String(error)}\n\nPlease report this issue.`;
    dialog.showErrorBox('Mesh-Client — Startup Error', message);
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        createWindow();
      } catch (error) {
        console.error(
          '[main] Window creation error:',
          sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
        );
      }
    } else {
      mainWindow?.show(); // Restore hidden window on dock click
    }
  });
});

app.on('before-quit', (event) => {
  // Clean up any pending Bluetooth device selection to prevent callback leak
  if (pendingBluetoothCallback) {
    console.debug('[main] before-quit: cleaning up pending Bluetooth callback');
    pendingBluetoothCallback('');
    pendingBluetoothCallback = null;
    lastBluetoothDeviceIds.clear();
  }

  if (nobleQuitRetry) {
    isQuitting = true;
    closeDatabase();
    return;
  }

  if (nobleBleManager.isBleSessionActive()) {
    event.preventDefault();
    void (async () => {
      try {
        await nobleBleManager.stopAllScanning();
        await nobleBleManager.disconnectAll();
      } catch (err) {
        console.error(
          '[main] Noble BLE shutdown failed:',
          sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
        );
      } finally {
        nobleQuitRetry = true;
        app.quit();
      }
    })();
    return;
  }

  isQuitting = true;
  closeDatabase();
});

app.on('will-quit', () => {
  try {
    takServerManager?.stop();
  } catch (err) {
    console.debug(
      '[main] TAK server stop during will-quit (ignored):',
      err instanceof Error ? err.message : err,
    ); // log-injection-ok internal cleanup
  }
  try {
    mqttManager.disconnect();
    meshcoreMqttAdapter.disconnect();
  } catch (err) {
    console.debug(
      '[main] MQTT disconnect during will-quit (ignored):',
      err instanceof Error ? err.message : err,
    ); // log-injection-ok internal library error during cleanup
  }
  if (meshcoreTcpSocket) {
    try {
      meshcoreTcpSocket.destroy();
    } catch (err) {
      console.debug(
        '[main] TCP socket destroy during will-quit (ignored):',
        err instanceof Error ? err.message : err,
      ); // log-injection-ok internal Node.js socket error during cleanup
    }
    meshcoreTcpSocket = null;
  }
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId);
  }
  powerSaveBlockerId = null;
  nobleBleManager.releaseNobleProcessHandles();
  tray?.destroy();
  tray = null;
  // releaseNobleProcessHandles() above calls noble._bindings.stop() which releases the native
  // BLEManager and its CBqueue GCD dispatch queue — without that, the process cannot exit on macOS.
  app.exit(0);
});

app.on('window-all-closed', () => {
  // Clean up any pending Bluetooth device selection to prevent callback leak
  if (pendingBluetoothCallback) {
    console.debug('[main] window-all-closed: cleaning up pending Bluetooth callback');
    pendingBluetoothCallback('');
    pendingBluetoothCallback = null;
    lastBluetoothDeviceIds.clear();
  }
  const hasConnection = isConnected || isAnyMqttConnected();
  // On macOS: quit when user chose Quit, or when there's no connection (window closed with nothing to keep running for)
  if (process.platform !== 'darwin' || isQuitting || !hasConnection) {
    app.quit();
  }
});
