import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron';
import fs from 'fs';
import path from 'path';

import {
  closeDatabase,
  deleteNodesBySource,
  exportDatabase,
  getDatabase,
  initDatabase,
  mergeDatabase,
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
  setMainWindow,
} from './log-service';
import { MQTTManager } from './mqtt-manager';
import { initUpdater } from './updater';

// Route main-process console through log file + Log panel (must run before other code logs)
patchMainConsole();

// Linux: SIGSEGV in Electron GPU process on some Wayland / driver stacks (electron#41980).
// Must run before app.whenReady(). CLI flags --disable-gpu also work; env avoids wrapper scripts.
if (process.platform === 'linux' && process.env.MESH_CLIENT_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
}

const mqttManager = new MQTTManager();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/** Retain tray context menu so macOS menu bridge does not see a freed model (avoids console warning / crashes). */
let trayContextMenu: Menu | null = null;
let isConnected = false;
let isQuitting = false;

// Pending Bluetooth callback from Chromium's Web Bluetooth API
let pendingBluetoothCallback: ((deviceId: string) => void) | null = null;
// Pending Serial callback (mirrors the BLE pattern)
let pendingSerialCallback: ((portId: string) => void) | null = null;
// Last discovery sets: only allow selection IPC to resolve callbacks with ids from these sets
// (empty string always allowed = cancel). Prevents arbitrary id injection from a compromised renderer.
let lastBluetoothDeviceIds = new Set<string>();
let lastSerialPortIds = new Set<string>();

// ─── Global error handlers (prevent silent crashes in packaged app) ──
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  try {
    dialog.showErrorBox(
      'Mesh-Client — Unexpected Error',
      `${error.message}\n\n${error.stack ?? ''}`,
    );
  } catch {
    /* dialog may not be available during early startup */
  }
});

// Throttle user-visible dialog so a tight loop of rejections does not spam the user
let lastUnhandledRejectionDialogAt = 0;
const UNHANDLED_REJECTION_DIALOG_COOLDOWN_MS = 60_000;

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
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
    /* dialog may not be available during early startup */
  }
});

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
}

// Enable Web Bluetooth feature flag
app.commandLine.appendSwitch('enable-features', 'WebBluetooth');
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
    base = nativeImage.createFromPath(trayIconPath).resize({ width: 22, height: 22 });
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
      label: 'Quit',
      click: () => {
        isQuitting = true;
        mqttManager.disconnect();
        isConnected = false;
        mainWindow?.destroy();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(trayContextMenu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Meshtastic Client',
    // Use the helper to select .ico, .icns, or .png automatically
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Exposes navigator.bluetooth.getDevices() so reconnectBle() can run without
      // requestDevice() (which requires a user gesture). See electron/electron#31869.
      experimentalFeatures: true,
    },
  });

  // ─── Web Bluetooth: Device Selection ───────────────────────────────
  // When the renderer calls navigator.bluetooth.requestDevice(),
  // Chromium fires this event. We intercept it to build our own picker
  // in the renderer instead of the (missing) native Chromium dialog.
  mainWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();

    // Chromium fires this event repeatedly during discovery with an
    // updated device list and a NEW callback each time. Simply overwrite
    // the reference — Chromium manages the lifecycle of old callbacks.
    pendingBluetoothCallback = callback;

    // Deduplicate devices by ID before sending to renderer
    const seen = new Map<string, { deviceId: string; deviceName: string }>();
    for (const d of devices) {
      seen.set(d.deviceId, {
        deviceId: d.deviceId,
        deviceName: d.deviceName || 'Unknown Device',
      });
    }
    lastBluetoothDeviceIds = new Set(seen.keys());
    mainWindow?.webContents.send('bluetooth-devices-discovered', Array.from(seen.values()));
  });

  // ─── Web Serial: Port Selection ────────────────────────────────────
  // Electron requires this handler for navigator.serial.requestPort()
  // to work. Without it, the Web Serial API throws.
  mainWindow.webContents.session.on(
    'select-serial-port',
    (event, portList, _webContents, callback) => {
      event.preventDefault();

      // Store callback so we can resolve it when the user picks a port
      pendingSerialCallback = callback;

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
      console.log(`[permissions] checkHandler: ${permission} → granted`);
    }
    return granted;
  });

  // Grant geolocation permission requests (for browser GPS fallback)
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      const grant = permission === 'geolocation';
      if (grant) {
        console.log(`[permissions] requestHandler: ${permission} → granted`);
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

  // ─── Bluetooth Pairing ─────────────────────────────────────────────
  mainWindow.webContents.session.setBluetoothPairingHandler((details, callback) => {
    // Auto-confirm pairing (Meshtastic doesn't use PIN)
    callback({ confirmed: true });
  });

  // ─── Renderer crash / load failure detection ──────────────────────
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details.reason, details.exitCode);
    try {
      dialog.showErrorBox(
        'Mesh-Client — Renderer Stopped',
        `The renderer process ended unexpectedly (${details.reason}, exit ${details.exitCode ?? 'n/a'}).\n\nRestart the application. If this keeps happening, export the log from the app (if still usable) or check the log file in your userData folder.`,
      );
    } catch {
      /* dialog unavailable */
    }
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDesc, validatedURL) => {
    console.error('Failed to load:', errorCode, errorDesc, validatedURL);
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
      /* dialog unavailable */
    }
  });

  setMainWindow(mainWindow);
  mainWindow.webContents.on('console-message', (details) => {
    forwardRendererConsoleMessage(details);
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    // Same startup diagnostics as packaged build so Log panel captures them in dev too
    console.log('[Startup] dev server URL:', process.env.VITE_DEV_SERVER_URL);
    console.log('[Startup] app.isPackaged:', app.isPackaged);
    console.log('[Startup] userData:', app.getPath('userData'));
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, '../../dist/renderer/index.html');
    // Startup diagnostics for troubleshooting packaged app issues
    console.log('[Startup] app.isPackaged:', app.isPackaged);
    console.log('[Startup] __dirname:', __dirname);
    console.log('[Startup] Renderer path:', indexPath);
    console.log('[Startup] process.resourcesPath:', process.resourcesPath);
    console.log('[Startup] userData:', app.getPath('userData'));
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    setMainWindow(null);
    mainWindow = null;
  });

  // Handle window close event
  const win = mainWindow;
  win.on('close', (event) => {
    if (!isQuitting && (isConnected || mqttManager.getStatus() === 'connected')) {
      event.preventDefault();
      if (process.platform === 'darwin') {
        win.hide();
      } else {
        win.minimize();
      }
    }
  });

  setupTray(mainWindow);
  initUpdater(mainWindow);
}

// ─── Tray unread badge ──────────────────────────────────────────────
ipcMain.on('set-tray-unread', (_event, count: unknown) => {
  const n = Math.max(0, Math.min(Math.floor(Number(count)) || 0, 99999));
  const hasUnread = n > 0;
  tray?.setImage(buildTrayIcon(hasUnread));
  tray?.setToolTip(hasUnread ? `Mesh-Client (${n} unread)` : 'Mesh-Client');
  if (process.platform === 'darwin') {
    app.dock?.setBadge(hasUnread ? String(n) : '');
  }
});

// ─── IPC: Bluetooth device selected by user ────────────────────────
ipcMain.on('bluetooth-device-selected', (_event, deviceId: unknown) => {
  if (!pendingBluetoothCallback) return;
  const id = typeof deviceId === 'string' ? deviceId : '';
  // Cancel is empty string; otherwise id must have been in the last discovery list
  if (id !== '' && !lastBluetoothDeviceIds.has(id)) {
    console.warn('[IPC] bluetooth-device-selected: ignoring unknown deviceId');
    return;
  }
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
  isConnected = true;
});
ipcMain.on('device-disconnected', () => {
  isConnected = false;
});

// ─── MQTT: Forward manager events to renderer ───────────────────────
mqttManager.on('status', (s) => mainWindow?.webContents.send('mqtt:status', s));
mqttManager.on('error', (msg) => mainWindow?.webContents.send('mqtt:error', msg));
mqttManager.on('clientId', (id) => mainWindow?.webContents.send('mqtt:clientId', id));
mqttManager.on('nodeUpdate', (n) => mainWindow?.webContents.send('mqtt:node-update', n));
mqttManager.on('message', (m) => mainWindow?.webContents.send('mqtt:message', m));

// ─── IPC: MQTT connect/disconnect ───────────────────────────────────
ipcMain.handle('mqtt:connect', async (_event, settings) => {
  try {
    console.debug('[IPC] mqtt:connect');
    validateMqttSettings(settings);
    mqttManager.connect(settings);
  } catch (err) {
    console.error('[IPC] mqtt:connect failed:', err);
    throw err;
  }
});
ipcMain.handle('mqtt:disconnect', async () => {
  try {
    console.debug('[IPC] mqtt:disconnect');
    mqttManager.disconnect();
  } catch (err) {
    console.error('[IPC] mqtt:disconnect failed:', err);
    throw err;
  }
});
ipcMain.handle('mqtt:getClientId', async () => {
  try {
    console.debug('[IPC] mqtt:getClientId');
    return mqttManager.getClientId();
  } catch (err) {
    console.error('[IPC] mqtt:getClientId failed:', err);
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
    };
    return mqttManager.publish(
      a.text,
      a.from,
      a.channel,
      a.destination ?? 0xffffffff,
      a.channelName ?? 'LongFast',
    );
  } catch (err) {
    console.error('[IPC] mqtt:publish failed:', err);
    throw err;
  }
});

// ─── IPC: GPS fix via main process ──────────────────────────────────
ipcMain.handle('gps:getFix', async () => {
  try {
    return await getGpsFix();
  } catch (err) {
    console.error('[gps] getGpsFix threw:', err);
    return {
      status: 'error',
      message: 'Location unavailable (network or service error).',
      code: 'UNKNOWN',
    };
  }
});

// ─── IPC: Force quit (disconnect all, then quit) ────────────────────
ipcMain.handle('app:quit', async () => {
  isQuitting = true;
  isConnected = false;
  try {
    mqttManager.disconnect();
  } catch (err) {
    console.error('[IPC] app:quit disconnect failed:', err);
  } finally {
    app.quit();
  }
});

// ─── IPC: Database operations ──────────────────────────────────────
ipcMain.handle('db:saveMessage', (_event, message) => {
  try {
    validateSaveMessage(message);
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO messages (sender_id, sender_name, payload, channel, timestamp, packet_id, status, error, emoji, reply_id, to_node, mqtt_status)
      VALUES (@sender_id, @sender_name, @payload, @channel, @timestamp, @packet_id, @status, @error, @emoji, @reply_id, @to_node, @mqtt_status)
    `);
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
    });
  } catch (err) {
    console.error('[IPC] db:saveMessage failed:', err);
    throw err;
  }
});

ipcMain.handle('db:getMessages', (_event, channel?: number, limit = 200) => {
  try {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 1000), 10000);
    const db = getDatabase();
    const columns = `id, sender_id, sender_name, payload, channel, timestamp,
         packet_id AS packetId, status, error, emoji, reply_id AS replyId, to_node,
         mqtt_status AS mqttStatus`;
    let rows: any[];
    if (channel !== undefined && channel !== null) {
      const ch = safeNonNegativeInt(channel);
      rows = db
        .prepare(
          `SELECT ${columns} FROM messages WHERE channel = ? ORDER BY timestamp DESC LIMIT ?`,
        )
        .all(ch, safeLimit);
    } else {
      rows = db
        .prepare(`SELECT ${columns} FROM messages ORDER BY timestamp DESC LIMIT ?`)
        .all(safeLimit);
    }
    // Map to_node back to `to` for the renderer
    return rows.map((r: any) => {
      const { to_node, ...rest } = r;
      return { ...rest, to: to_node ?? undefined };
    });
  } catch (err) {
    console.error('[IPC] db:getMessages failed:', err);
    throw err;
  }
});

ipcMain.handle('db:saveNode', (_event, node) => {
  try {
    validateSaveNode(node);
    const db = getDatabase();
    const stmt = db.prepare(`
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
    console.error('[IPC] db:saveNode failed:', err);
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
      .prepare('UPDATE nodes SET favorited = ? WHERE node_id = ?')
      .run(favorited ? 1 : 0, id);
  } catch (err) {
    console.error('[IPC] db:setNodeFavorited failed:', err);
    throw err;
  }
});

ipcMain.handle('db:getNodes', () => {
  try {
    const db = getDatabase();
    return db.prepare('SELECT * FROM nodes ORDER BY last_heard DESC').all();
  } catch (err) {
    console.error('[IPC] db:getNodes failed:', err);
    throw err;
  }
});

ipcMain.handle('db:clearMessages', () => {
  try {
    const db = getDatabase();
    return db.prepare('DELETE FROM messages').run();
  } catch (err) {
    console.error('[IPC] db:clearMessages failed:', err);
    throw err;
  }
});

ipcMain.handle('db:clearNodes', () => {
  try {
    const db = getDatabase();
    return db.prepare('DELETE FROM nodes').run();
  } catch (err) {
    console.error('[IPC] db:clearNodes failed:', err);
    throw err;
  }
});

ipcMain.handle('db:clearNodePositions', () => {
  try {
    const db = getDatabase();
    return db.prepare('UPDATE nodes SET latitude = NULL, longitude = NULL, altitude = NULL').run();
  } catch (err) {
    console.error('[IPC] db:clearNodePositions failed:', err);
    throw err;
  }
});

ipcMain.handle('db:deleteNode', (_event, nodeId: number) => {
  try {
    const id = safeNonNegativeInt(nodeId);
    const db = getDatabase();
    return db.prepare('DELETE FROM nodes WHERE node_id = ?').run(id);
  } catch (err) {
    console.error('[IPC] db:deleteNode failed:', err);
    throw err;
  }
});

ipcMain.handle('db:deleteNodesByAge', (_event, days: number) => {
  try {
    if (typeof days !== 'number' || days < 1 || !isFinite(days)) return { changes: 0 };
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    return getDatabase().prepare('DELETE FROM nodes WHERE last_heard < ?').run(cutoff);
  } catch (err) {
    console.error('[IPC] db:deleteNodesByAge failed:', err);
    throw err;
  }
});

ipcMain.handle('db:pruneNodesByCount', (_event, maxCount: number) => {
  try {
    if (typeof maxCount !== 'number' || maxCount < 1 || !isFinite(maxCount)) return { changes: 0 };
    return getDatabase()
      .prepare(
        'DELETE FROM nodes WHERE node_id NOT IN (SELECT node_id FROM nodes ORDER BY last_heard DESC LIMIT ?)',
      )
      .run(maxCount);
  } catch (err) {
    console.error('[IPC] db:pruneNodesByCount failed:', err);
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
      .prepare(`DELETE FROM nodes WHERE node_id IN (${placeholders})`)
      .run(...safe);
    return result.changes;
  } catch (err) {
    console.error('[IPC] db:deleteNodesBatch failed:', err);
    throw err;
  }
});

ipcMain.handle('db:clearMessagesByChannel', (_event, channel: number) => {
  try {
    const ch = safeNonNegativeInt(channel);
    return getDatabase().prepare('DELETE FROM messages WHERE channel = ?').run(ch);
  } catch (err) {
    console.error('[IPC] db:clearMessagesByChannel failed:', err);
    throw err;
  }
});

ipcMain.handle('db:getMessageChannels', () => {
  try {
    return getDatabase().prepare('SELECT DISTINCT channel FROM messages ORDER BY channel').all();
  } catch (err) {
    console.error('[IPC] db:getMessageChannels failed:', err);
    throw err;
  }
});

ipcMain.handle('db:deleteNodesBySource', (_event, source: string) => {
  try {
    if (typeof source !== 'string')
      throw new Error('db:deleteNodesBySource: source must be a string');
    if (source.length > 64) throw new Error('db:deleteNodesBySource: source string too long');
    return deleteNodesBySource(source);
  } catch (err) {
    console.error('[IPC] db:deleteNodesBySource failed:', err);
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
          .prepare('UPDATE messages SET status = ?, error = ?, mqtt_status = ? WHERE packet_id = ?')
          .run(statusSafe, errorSafe, mqttSafe, pid);
      }
      return db
        .prepare('UPDATE messages SET status = ?, error = ? WHERE packet_id = ?')
        .run(statusSafe, errorSafe, pid);
    } catch (err) {
      console.error('[IPC] db:updateMessageStatus failed:', err);
      throw err;
    }
  },
);

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
    console.error('[IPC] db:export failed:', err);
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
    console.error('[IPC] db:import failed:', err);
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
    console.error('[IPC] session:clearData failed:', err);
    throw err;
  }
});

// ─── IPC: Log panel ─────────────────────────────────────────────────
ipcMain.handle('log:getPath', () => {
  try {
    return getLogPath();
  } catch (err) {
    console.error('[IPC] log:getPath failed:', err);
    throw err;
  }
});

ipcMain.handle('log:getRecentLines', () => {
  try {
    return getRecentLines();
  } catch (err) {
    console.error('[IPC] log:getRecentLines failed:', err);
    throw err;
  }
});

ipcMain.handle('log:clear', () => {
  try {
    clearLogFile();
  } catch (err) {
    console.error('[IPC] log:clear failed:', err);
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
    console.error('[IPC] log:export failed:', err);
    throw err;
  }
});

// ─── App lifecycle ─────────────────────────────────────────────────
app.whenReady().then(() => {
  try {
    initLogFile();
    initDatabase();
    // Force the dock icon n development on macOS
    if (!app.isPackaged && process.platform === 'darwin') {
      const iconPath = path.join(
        __dirname,
        '../../resources/icons/mac/iconset/icon_256x256@1x.png',
      );
      app.dock?.setIcon(iconPath);
    }
    createWindow();
  } catch (error) {
    console.error('Fatal startup error:', error);
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
        console.error('Window creation error:', error);
      }
    } else {
      mainWindow?.show(); // Restore hidden window on dock click
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  closeDatabase();
});

app.on('window-all-closed', () => {
  const hasConnection = isConnected || mqttManager.getStatus() === 'connected';
  // On macOS: quit when user chose Quit, or when there's no connection (window closed with nothing to keep running for)
  if (process.platform !== 'darwin' || isQuitting || !hasConnection) {
    app.quit();
  }
});
