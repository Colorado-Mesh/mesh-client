import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  MenuItem,
  nativeImage,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  safeStorage,
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
import {
  closeDatabase,
  deleteNodesBySource,
  deleteNodesWithoutLongname,
  exportDatabase,
  getDatabase,
  initDatabase,
  mergeDatabase,
  migrateRfStubNodes,
  runDeferredPositionHistoryPrune,
  searchMeshcoreMessages,
  searchMessages,
} from './database';
import { getGpsFix } from './gps';
import {
  clearLogFile,
  exportLogTo,
  forwardRendererConsoleMessage,
  getLogPath,
  getRecentLines,
  initLogFile,
  patchMainConsole,
  sanitizeLogMessage,
  setMainWindow,
} from './log-service';
import { MeshcoreMqttAdapter } from './meshcore-mqtt-adapter';
import { MQTTManager } from './mqtt-manager';
import { NobleBleManager, type NobleSessionId } from './noble-ble-manager';
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

const mqttManager = new MQTTManager();
const meshcoreMqttAdapter = new MeshcoreMqttAdapter();
const nobleBleManager = new NobleBleManager();

/** Max bytes per MeshCore TCP IPC write (DoS guard). */
const MESHCORE_TCP_WRITE_MAX_BYTES = 256 * 1024;
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
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
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

app.on('browser-window-created', () => {});

process.on('exit', () => {});

// ─── IPC validation helpers (main process boundary) ───────────────────
const MAX_PAYLOAD_LENGTH = 1024 * 1024; // 1MB cap for message payload
const MAX_STATUS_STRING = 1024;
// Align with reasonable Meshtastic/DB bounds to prevent unbounded string allocation
const MAX_NODE_STRING = 512;
const MAX_HW_MODEL = 128;

function safeNonNegativeInt(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid non-negative integer');
  return n >>> 0;
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
  safeNonNegativeInt(m.sender_id);
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
  const nodeId = Number(n.node_id);
  if (!Number.isFinite(nodeId) || nodeId < 0)
    throw new Error('db:saveNode: node_id must be a finite non-negative number');
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
    'Cross-platform Meshtastic desktop client',
    'BLE, Serial, HTTP, and MQTT support',
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
  if (url) void shell.openExternal(url);
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
            click: () => app.hide(),
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Mesh Client',
    // Use the helper to select .ico, .icns, or .png automatically
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Inline misspelling marks and context-menu suggestions (all platforms). macOS app menu
      // stays minimal (no role-based Edit menu) to reduce WeakPtr menu-bridge noise.
      spellcheck: true,
      experimentalFeatures: true,
    },
  });
  mainWindow = win;

  configureRendererSpellcheck(win.webContents.session);
  win.webContents.once('did-finish-load', () => {
    configureRendererSpellcheck(win.webContents.session);
    setImmediate(() => {
      runDeferredPositionHistoryPrune();
    });
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
    const spellOn = params.spellcheckEnabled !== false;

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
    if (details.deviceType === 'serial') {
      return true;
    }
    return false;
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
      sanitizeLogMessage(String(errorDesc)),
      sanitizeLogMessage(validatedURL),
    );
    // ERR_ABORTED (-3) often means navigation was cancelled; avoid noisy dialog
    if (errorCode === -3) return;
    try {
      const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
      const hint = isDev
        ? 'Ensure the dev server is running (npm run dev) and the URL is reachable.'
        : 'The app bundle may be missing or damaged. Try reinstalling or run from source with npm run build && npm start.';
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
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);

    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, '../../dist/renderer/index.html');
    const indexUrl = pathToFileURL(indexPath).toString();
    // Startup diagnostics for troubleshooting packaged app issues
    console.debug('[Startup] app.isPackaged:', app.isPackaged);
    console.debug('[Startup] __dirname:', sanitizeLogMessage(__dirname));
    console.debug('[Startup] Renderer path:', sanitizeLogMessage(indexPath));
    console.debug('[Startup] process.resourcesPath:', sanitizeLogMessage(process.resourcesPath));
    console.debug('[Startup] userData:', sanitizeLogMessage(app.getPath('userData')));
    // Use loadURL with an explicit HTTP referrer so OpenStreetMap tile requests
    // from the packaged app include a valid Referer header and comply with the
    // OSM tile usage policy for web-style traffic.
    mainWindow.loadURL(indexUrl, {
      httpReferrer: OSM_HTTP_REFERRER,
    });
  }

  mainWindow.webContents.on('did-finish-load', () => {});
  mainWindow.webContents.on('did-fail-load', () => {});

  mainWindow.on('closed', () => {
    setMainWindow(null);
    mainWindow = null;
  });
  mainWindow.webContents.on('destroyed', () => {});

  // Handle window close event
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
    const img = hasUnread
      ? (_cachedTrayIconUnread ??= buildTrayIcon(true))
      : (_cachedTrayIconRead ??= buildTrayIcon(false));
    tray?.setImage(img);
  }
  tray?.setToolTip(hasUnread ? `Mesh-Client (${n} unread)` : 'Mesh-Client');
  if (process.platform === 'darwin') {
    app.dock?.setBadge(hasUnread ? String(n) : '');
  } else if (process.platform === 'linux') {
    app.setBadgeCount(hasUnread ? n : 0);
  } else if (process.platform === 'win32' && mainWindow) {
    if (hasUnread) {
      if (!_cachedBadgeIcon) _cachedBadgeIcon = nativeImage.createFromBuffer(buildBadgePng());
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
    return;
  }
  await nobleBleManager.connect(sessionId, peripheralId);
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
  if (isQuitting) {
    console.debug(`[main] noble-ble-to-radio: ignoring session=${sessionId} (app is quitting)`);
    return;
  }
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as Uint8Array);
  if (buf.length > NOBLE_BLE_TO_RADIO_MAX_BYTES) {
    return Promise.reject(
      new Error(
        `noble-ble-to-radio: payload exceeds ${NOBLE_BLE_TO_RADIO_MAX_BYTES} bytes (${buf.length})`,
      ),
    );
  }
  await nobleBleManager.writeToRadio(sessionId, buf);
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
  if (mainWindow) mainWindow.webContents.send('mqtt:node-update', n);
  else console.debug('[main] mqtt:node-update dropped (mainWindow not ready)');
});
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

// ─── IPC: MQTT connect/disconnect ───────────────────────────────────
ipcMain.handle('mqtt:connect', async (_event, settings) => {
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
ipcMain.handle('mqtt:disconnect', async (_event, protocol?: 'meshtastic' | 'meshcore') => {
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
ipcMain.handle('mqtt:getClientId', async (_event, protocol?: 'meshtastic' | 'meshcore') => {
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
ipcMain.handle('mqtt:publish', async (_event, args) => {
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

ipcMain.handle('mqtt:publishMeshcore', async (_event, args) => {
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

ipcMain.handle('mqtt:publishMeshcorePacketLog', async (_event, args) => {
  try {
    console.debug('[IPC] mqtt:publishMeshcorePacketLog');
    validateMqttPublishMeshcorePacketLogArgs(args);
    const a = args as { origin: string; snr: number; rssi: number; rawHex?: string };
    meshcoreMqttAdapter.publishPacketLog({
      origin: a.origin,
      snr: a.snr,
      rssi: a.rssi,
      rawHex: a.rawHex,
    });
  } catch (err) {
    console.error(
      '[IPC] mqtt:publishMeshcorePacketLog failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
});

ipcMain.handle('mqtt:getCachedNodes', async () => {
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
ipcMain.handle('mqtt:publishNodeInfo', async (_event, args) => {
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
ipcMain.handle('mqtt:publishPosition', async (_event, args) => {
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

ipcMain.handle('app:quit', async () => {
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
      INSERT OR IGNORE INTO messages (sender_id, sender_name, payload, channel, timestamp, packet_id, status, error, emoji, reply_id, to_node, mqtt_status, received_via)
      VALUES (@sender_id, @sender_name, @payload, @channel, @timestamp, @packet_id, @status, @error, @emoji, @reply_id, @to_node, @mqtt_status, @received_via)
    `);
    const validReceivedVia = ['rf', 'mqtt', 'both'];
    return stmt.run({
      sender_id: safeNonNegativeInt(message.sender_id),
      sender_name: String(message.sender_name),
      payload: message.payload,
      channel: safeNonNegativeInt(message.channel),
      timestamp: Number(message.timestamp),
      packet_id: message.packetId != null ? safeNonNegativeInt(message.packetId) : null,
      status: message.status ?? null,
      error: message.error ?? null,
      emoji: message.emoji != null ? safeNonNegativeInt(message.emoji) : null,
      reply_id: message.replyId != null ? safeNonNegativeInt(message.replyId) : null,
      to_node: message.to != null ? safeNonNegativeInt(message.to) : null,
      mqtt_status: message.mqttStatus ?? null,
      received_via:
        message.receivedVia != null && validReceivedVia.includes(message.receivedVia)
          ? message.receivedVia
          : null,
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
         mqtt_status AS mqttStatus, received_via AS receivedVia`;
    let rows: any[];
    if (channel !== undefined && channel !== null) {
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

    // Map to_node back to `to` for the renderer
    return rows.map((r: any) => {
      const { to_node, ...rest } = r;
      return { ...rest, to: to_node ?? undefined };
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
      INSERT INTO nodes (node_id, long_name, short_name, hw_model, snr, rssi, battery, last_heard, latitude, longitude, role, hops_away, via_mqtt, voltage, channel_utilization, air_util_tx, altitude, favorited, source, num_packets_rx_bad, num_rx_dupe, num_packets_rx, num_packets_tx)
      VALUES (@node_id, @long_name, @short_name, @hw_model, @snr, @rssi, @battery, @last_heard, @latitude, @longitude, @role, @hops_away, @via_mqtt, @voltage, @channel_utilization, @air_util_tx, @altitude,
        COALESCE((SELECT favorited FROM nodes WHERE node_id = @node_id), 0),
        @source, @num_packets_rx_bad, @num_rx_dupe, @num_packets_rx, @num_packets_tx)
      ON CONFLICT(node_id) DO UPDATE SET
        long_name = excluded.long_name,
        short_name = excluded.short_name,
        hw_model = excluded.hw_model,
        snr = excluded.snr,
        rssi = excluded.rssi,
        battery = excluded.battery,
        last_heard = excluded.last_heard,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        role = excluded.role,
        hops_away = excluded.hops_away,
        via_mqtt = excluded.via_mqtt,
        voltage = excluded.voltage,
        channel_utilization = excluded.channel_utilization,
        air_util_tx = excluded.air_util_tx,
        altitude = excluded.altitude,
        source = CASE WHEN excluded.source = 'rf' THEN 'rf' ELSE COALESCE((SELECT source FROM nodes WHERE node_id = excluded.node_id), 'mqtt') END,
        num_packets_rx_bad = COALESCE(excluded.num_packets_rx_bad, num_packets_rx_bad),
        num_rx_dupe = COALESCE(excluded.num_rx_dupe, num_rx_dupe),
        num_packets_rx = COALESCE(excluded.num_packets_rx, num_packets_rx),
        num_packets_tx = COALESCE(excluded.num_packets_tx, num_packets_tx)
    `);
    return stmt.run({
      role: null,
      hops_away: null,
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
    });
  } catch (err) {
    console.error(
      '[IPC] db:saveNode failed:',
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

ipcMain.handle('db:clearMessages', () => {
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

ipcMain.handle('db:clearNodes', () => {
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

ipcMain.handle('db:deleteNode', (_event, nodeId: number) => {
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

ipcMain.handle('db:deleteNodesByAge', (_event, days: number) => {
  try {
    if (typeof days !== 'number' || days < 1 || !isFinite(days)) return { changes: 0 };
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    const result = getDatabase().prepareOnce('DELETE FROM nodes WHERE last_heard < ?').run(cutoff);
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

ipcMain.handle('db:deleteNodesBatch', (_event, nodeIds: number[]) => {
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

ipcMain.handle('db:clearMessagesByChannel', (_event, channel: number) => {
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

ipcMain.handle('db:deleteNodesBySource', (_event, source: string) => {
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

ipcMain.handle('db:deleteNodesWithoutLongname', () => {
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
      await exportDatabase(result.filePath);
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
      const summary = mergeDatabase(result.filePaths[0]);
      return summary;
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
ipcMain.handle('session:clearData', async () => {
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

ipcMain.handle('log:clear', () => {
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

ipcMain.handle('log:export', async () => {
  try {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export log',
      defaultPath: `meshtastic-client-log-${new Date().toISOString().slice(0, 10)}.log`,
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
    if (channelIdx !== undefined && channelIdx !== null) {
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
    return db
      .prepareOnce(
        'INSERT OR IGNORE INTO meshcore_messages ' +
          '(sender_id, sender_name, payload, channel_idx, timestamp, status, packet_id, emoji, reply_id, to_node, received_via) ' +
          'VALUES (@sender_id, @sender_name, @payload, @channel_idx, @timestamp, @status, @packet_id, @emoji, @reply_id, @to_node, @received_via)',
      )
      .run({
        sender_id: m.sender_id != null ? Number(m.sender_id) : null,
        sender_name: m.sender_name != null ? String(m.sender_name) : null,
        payload: m.payload as string,
        channel_idx: m.channel_idx != null ? Math.trunc(Number(m.channel_idx)) : 0,
        timestamp: Number(m.timestamp),
        status: m.status != null ? String(m.status) : 'acked',
        packet_id: m.packet_id != null ? Number(m.packet_id) : null,
        emoji: m.emoji != null ? safeNonNegativeInt(m.emoji) : null,
        reply_id: replyId,
        to_node: m.to_node != null ? Number(m.to_node) : null,
        received_via,
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
        'INSERT OR REPLACE INTO meshcore_contacts ' +
          '(node_id, public_key, adv_name, contact_type, last_advert, adv_lat, adv_lon, last_snr, last_rssi, favorited, nickname) ' +
          'VALUES (@node_id, @public_key, @adv_name, @contact_type, @last_advert, @adv_lat, @adv_lon, @last_snr, @last_rssi, ' +
          'COALESCE((SELECT favorited FROM meshcore_contacts WHERE node_id = @node_id), 0), ' +
          'COALESCE(@nickname, (SELECT nickname FROM meshcore_contacts WHERE node_id = @node_id)))',
      )
      .run({
        node_id: Number(c.node_id),
        public_key: c.public_key as string,
        adv_name: c.adv_name != null ? String(c.adv_name) : null,
        contact_type: c.contact_type != null ? Number(c.contact_type) : 0,
        last_advert: c.last_advert != null ? Number(c.last_advert) : null,
        adv_lat: c.adv_lat != null ? Number(c.adv_lat) : null,
        adv_lon: c.adv_lon != null ? Number(c.adv_lon) : null,
        last_snr: c.last_snr != null ? Number(c.last_snr) : null,
        last_rssi: c.last_rssi != null ? Number(c.last_rssi) : null,
        nickname: c.nickname != null ? String(c.nickname) : null,
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
    title: 'Import Repeaters JSON',
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
    const pid = Number(packetId);
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

ipcMain.handle('db:clearMeshcoreMessages', () => {
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

ipcMain.handle('db:clearMeshcoreContacts', () => {
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
ipcMain.handle('db:clearMeshcoreRepeaters', () => {
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

ipcMain.handle(
  'db:updateMeshcoreContactAdvert',
  (_e, nodeId: number, lastAdvert: number | null, advLat: number | null, advLon: number | null) => {
    try {
      const safeNodeId = safeNonNegativeInt(nodeId);
      getDatabase()
        .prepareOnce(
          'UPDATE meshcore_contacts SET last_advert = ?, adv_lat = ?, adv_lon = ? WHERE node_id = ?',
        )
        .run(lastAdvert, advLat, advLon, safeNodeId);
    } catch (err) {
      console.error(
        '[IPC] db:updateMeshcoreContactAdvert error:',
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

// ─── MeshCore TCP bridge ───────────────────────────────────────────
let meshcoreTcpSocket: net.Socket | null = null;

const MAX_TCP_HOST_LENGTH = 253;

ipcMain.handle('meshcore:tcp-connect', (_event, host: string, port: number) => {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      reject(new Error('Invalid port'));
      return;
    }
    if (typeof host !== 'string' || host.length === 0 || host.length > MAX_TCP_HOST_LENGTH) {
      reject(new Error('Invalid host'));
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

app.whenReady().then(() => {
  try {
    initLogFile();

    initDatabase();
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
      ? `A native module failed to load. This usually means the app needs to be rebuilt for this version of Electron.\n\nFix: run "npm install" in the project directory, then restart.\n\nDetails: ${error.message}`
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

app.on('quit', () => {});

app.on('window-all-closed', () => {
  const hasConnection = isConnected || isAnyMqttConnected();
  // On macOS: quit when user chose Quit, or when there's no connection (window closed with nothing to keep running for)
  if (process.platform !== 'darwin' || isQuitting || !hasConnection) {
    app.quit();
  }
});
