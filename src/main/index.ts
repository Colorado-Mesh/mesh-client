import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from "electron";
import path from "path";
import { initDatabase, getDatabase, exportDatabase, mergeDatabase, closeDatabase, deleteNodesBySource } from "./database";
import { MQTTManager } from "./mqtt-manager";

const mqttManager = new MQTTManager();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isConnected = false;

// Pending Bluetooth callback from Chromium's Web Bluetooth API
let pendingBluetoothCallback: ((deviceId: string) => void) | null = null;
// Pending Serial callback (mirrors the BLE pattern)
let pendingSerialCallback: ((portId: string) => void) | null = null;

// ─── Global error handlers (prevent silent crashes in packaged app) ──
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  try {
    dialog.showErrorBox(
      "Mesh-Client — Unexpected Error",
      `${error.message}\n\n${error.stack ?? ""}`
    );
  } catch { /* dialog may not be available during early startup */ }
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

// Enable Web Bluetooth feature flag
app.commandLine.appendSwitch("enable-features", "WebBluetooth");
// Enable Web Serial (experimental)
app.commandLine.appendSwitch(
  "enable-blink-features",
  "Serial"
);

function buildTrayIcon(hasUnread: boolean): Electron.NativeImage {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(__dirname, "../../resources/icon.png");

  const size = process.platform === "darwin" ? 16 : 22;
  const base = nativeImage.createFromPath(iconPath).resize({ width: size, height: size });

  if (!hasUnread) return base;

  // Overlay a 4px red dot in the top-right corner
  const bitmap = Buffer.from(base.toBitmap());
  const dotR = 2;
  const dotCx = size - dotR - 1;
  const dotCy = dotR + 1;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px - dotCx;
      const dy = py - dotCy;
      if (dx * dx + dy * dy <= dotR * dotR) {
        const idx = (py * size + px) * 4;
        bitmap[idx]     = 239; // R
        bitmap[idx + 1] = 68;  // G
        bitmap[idx + 2] = 68;  // B
        bitmap[idx + 3] = 255; // A
      }
    }
  }

  return nativeImage.createFromBitmap(bitmap, { width: size, height: size });
}

function setupTray(window: BrowserWindow) {
  tray = new Tray(buildTrayIcon(false));
  tray.setToolTip("Mesh-Client");
  tray.on("click", () => {
    window.show();
    window.focus();
  });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Mesh-Client", click: () => { window.show(); window.focus(); } },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ])
  );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Meshtastic Client",
    // In packaged mode, electron-builder sets the app icon via mac.icon config.
    // Only set the icon manually during development.
    icon: app.isPackaged ? undefined : path.join(__dirname, "../../resources/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // ─── Web Bluetooth: Device Selection ───────────────────────────────
  // When the renderer calls navigator.bluetooth.requestDevice(),
  // Chromium fires this event. We intercept it to build our own picker
  // in the renderer instead of the (missing) native Chromium dialog.
  mainWindow.webContents.on(
    "select-bluetooth-device",
    (event, devices, callback) => {
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
          deviceName: d.deviceName || "Unknown Device",
        });
      }
      mainWindow?.webContents.send(
        "bluetooth-devices-discovered",
        Array.from(seen.values())
      );
    }
  );

  // ─── Web Serial: Port Selection ────────────────────────────────────
  // Electron requires this handler for navigator.serial.requestPort()
  // to work. Without it, the Web Serial API throws.
  mainWindow.webContents.session.on(
    "select-serial-port",
    (event, portList, _webContents, callback) => {
      event.preventDefault();

      // Store callback so we can resolve it when the user picks a port
      pendingSerialCallback = callback;

      // Send port list to renderer for selection
      mainWindow?.webContents.send(
        "serial-ports-discovered",
        portList.map((p) => ({
          portId: p.portId,
          displayName:
            p.displayName || p.portName || `Port ${p.portId}`,
          portName: p.portName || "",
          vendorId: p.vendorId,
          productId: p.productId,
        }))
      );
    }
  );

  // Allow all serial port connections (needed for the permission check)
  mainWindow.webContents.session.setPermissionCheckHandler(
    (_webContents, permission) => permission === "serial"
  );

  // ─── Bluetooth Device Permission ───────────────────────────────────
  // Required in Electron 20+ — without this, Chromium shows a blank/black
  // permission overlay when navigator.bluetooth.requestDevice() is called.
  mainWindow.webContents.session.setDevicePermissionHandler((details) => {
    if (details.deviceType === "bluetooth" || details.deviceType === "serial") {
      return true;
    }
    return false;
  });

  // ─── Bluetooth Pairing ─────────────────────────────────────────────
  mainWindow.webContents.session.setBluetoothPairingHandler(
    (details, callback) => {
      // Auto-confirm pairing (Meshtastic doesn't use PIN)
      callback({ confirmed: true });
    }
  );

  // ─── Renderer crash / load failure detection ──────────────────────
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process gone:", details.reason, details.exitCode);
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDesc, url) => {
    console.error("Failed to load:", errorCode, errorDesc, url);
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, "../../dist/renderer/index.html");
    // Startup diagnostics for troubleshooting packaged app issues
    console.log("[Startup] app.isPackaged:", app.isPackaged);
    console.log("[Startup] __dirname:", __dirname);
    console.log("[Startup] Renderer path:", indexPath);
    console.log("[Startup] process.resourcesPath:", process.resourcesPath);
    console.log("[Startup] userData:", app.getPath("userData"));
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Handle window close event
  mainWindow.on('close', (event) => {
    if (isConnected || mqttManager.getStatus() === "connected") {
      event.preventDefault();
      if (process.platform === 'darwin') {
        mainWindow.hide();
      } else {
        mainWindow.minimize();
      }
    } else {
      app.quit();
    }
  });

  setupTray(mainWindow);
}

// ─── Tray unread badge ──────────────────────────────────────────────
ipcMain.on("set-tray-unread", (_event, count: number) => {
  tray?.setImage(buildTrayIcon(count > 0));
  tray?.setToolTip(count > 0 ? `Mesh-Client (${count} unread)` : "Mesh-Client");
  if (process.platform === "darwin") {
    app.dock.setBadge(count > 0 ? String(count) : "");
  }
});

// ─── IPC: Bluetooth device selected by user ────────────────────────
ipcMain.on("bluetooth-device-selected", (_event, deviceId: string) => {
  if (pendingBluetoothCallback) {
    pendingBluetoothCallback(deviceId);
    pendingBluetoothCallback = null;
  }
});

// ─── IPC: Cancel Bluetooth selection ────────────────────────────────
ipcMain.on("bluetooth-device-cancelled", () => {
  if (pendingBluetoothCallback) {
    pendingBluetoothCallback(""); // Empty string cancels the request
    pendingBluetoothCallback = null;
  }
});

// ─── IPC: Serial port selected by user ──────────────────────────────
ipcMain.on("serial-port-selected", (_event, portId: string) => {
  if (pendingSerialCallback) {
    pendingSerialCallback(portId);
    pendingSerialCallback = null;
  }
});

// ─── IPC: Cancel Serial selection ───────────────────────────────────
ipcMain.on("serial-port-cancelled", () => {
  if (pendingSerialCallback) {
    pendingSerialCallback(""); // Empty string cancels the request
    pendingSerialCallback = null;
  }
});

// ─── IPC: Connection status tracking (module-scope, not per-window) ─
ipcMain.on('device-connected', () => { isConnected = true; });
ipcMain.on('device-disconnected', () => { isConnected = false; });

// ─── MQTT: Forward manager events to renderer ───────────────────────
mqttManager.on("status", (s) => mainWindow?.webContents.send("mqtt:status", s));
mqttManager.on("error", (msg) => mainWindow?.webContents.send("mqtt:error", msg));
mqttManager.on("clientId", (id) => mainWindow?.webContents.send("mqtt:clientId", id));
mqttManager.on("nodeUpdate", (n) => mainWindow?.webContents.send("mqtt:node-update", n));
mqttManager.on("message", (m) => mainWindow?.webContents.send("mqtt:message", m));

// ─── IPC: MQTT connect/disconnect ───────────────────────────────────
ipcMain.handle("mqtt:connect", async (_event, settings) => {
  mqttManager.connect(settings);
});
ipcMain.handle("mqtt:disconnect", async () => {
  mqttManager.disconnect();
});
ipcMain.handle("mqtt:publish", async (_event, args) => {
  return mqttManager.publish(
    args.text,
    args.from,
    args.channel,
    args.destination ?? 0xffffffff,
    args.channelName ?? "LongFast"
  );
});

// ─── IPC: Force quit (disconnect all, then quit) ────────────────────
ipcMain.handle("app:quit", async () => {
  mqttManager.disconnect();
  isConnected = false;
  app.quit();
});

// ─── IPC: Database operations ──────────────────────────────────────
ipcMain.handle("db:saveMessage", (_event, message) => {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO messages (sender_id, sender_name, payload, channel, timestamp, packet_id, status, error, emoji, reply_id, to_node)
      VALUES (@sender_id, @sender_name, @payload, @channel, @timestamp, @packet_id, @status, @error, @emoji, @reply_id, @to_node)
    `);
    return stmt.run({
      sender_id: message.sender_id,
      sender_name: message.sender_name,
      payload: message.payload,
      channel: message.channel,
      timestamp: message.timestamp,
      packet_id: message.packetId ?? null,
      status: message.status ?? null,
      error: message.error ?? null,
      emoji: message.emoji ?? null,
      reply_id: message.replyId ?? null,
      to_node: message.to ?? null,
    });
  } catch (err) {
    console.error("[IPC] db:saveMessage failed:", err);
    throw err;
  }
});

ipcMain.handle("db:getMessages", (_event, channel?: number, limit = 200) => {
  try {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 200), 2000);
    const db = getDatabase();
    const columns = `id, sender_id, sender_name, payload, channel, timestamp,
         packet_id AS packetId, status, error, emoji, reply_id AS replyId, to_node`;
    let rows: any[];
    if (channel !== undefined && channel !== null) {
      rows = db
        .prepare(
          `SELECT ${columns} FROM messages WHERE channel = ? ORDER BY timestamp DESC LIMIT ?`
        )
        .all(channel, safeLimit);
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
    console.error("[IPC] db:getMessages failed:", err);
    throw err;
  }
});

ipcMain.handle("db:saveNode", (_event, node) => {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO nodes (node_id, long_name, short_name, hw_model, snr, rssi, battery, last_heard, latitude, longitude, role, hops_away, via_mqtt, voltage, channel_utilization, air_util_tx, altitude, favorited, source)
      VALUES (@node_id, @long_name, @short_name, @hw_model, @snr, @rssi, @battery, @last_heard, @latitude, @longitude, @role, @hops_away, @via_mqtt, @voltage, @channel_utilization, @air_util_tx, @altitude,
        COALESCE((SELECT favorited FROM nodes WHERE node_id = @node_id), 0),
        @source)
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
        source = CASE WHEN excluded.source = 'rf' THEN 'rf' ELSE COALESCE((SELECT source FROM nodes WHERE node_id = excluded.node_id), 'mqtt') END
    `);
    return stmt.run({
      role: null,
      hops_away: null,
      rssi: null,
      voltage: null,
      channel_utilization: null,
      air_util_tx: null,
      altitude: null,
      source: "rf",
      ...node,
      via_mqtt: node.via_mqtt != null ? (node.via_mqtt ? 1 : 0) : null,
    });
  } catch (err) {
    console.error("[IPC] db:saveNode failed:", err);
    throw err;
  }
});

ipcMain.handle("db:setNodeFavorited", (_event, nodeId: number, favorited: boolean) => {
  try {
    const db = getDatabase();
    return db.prepare("UPDATE nodes SET favorited = ? WHERE node_id = ?")
      .run(favorited ? 1 : 0, nodeId);
  } catch (err) {
    console.error("[IPC] db:setNodeFavorited failed:", err);
    throw err;
  }
});

ipcMain.handle("db:getNodes", () => {
  try {
    const db = getDatabase();
    return db.prepare("SELECT * FROM nodes ORDER BY last_heard DESC").all();
  } catch (err) {
    console.error("[IPC] db:getNodes failed:", err);
    throw err;
  }
});

ipcMain.handle("db:clearMessages", () => {
  try {
    const db = getDatabase();
    return db.prepare("DELETE FROM messages").run();
  } catch (err) {
    console.error("[IPC] db:clearMessages failed:", err);
    throw err;
  }
});

ipcMain.handle("db:clearNodes", () => {
  try {
    const db = getDatabase();
    return db.prepare("DELETE FROM nodes").run();
  } catch (err) {
    console.error("[IPC] db:clearNodes failed:", err);
    throw err;
  }
});

ipcMain.handle("db:deleteNode", (_event, nodeId: number) => {
  try {
    const db = getDatabase();
    return db.prepare("DELETE FROM nodes WHERE node_id = ?").run(nodeId);
  } catch (err) {
    console.error("[IPC] db:deleteNode failed:", err);
    throw err;
  }
});

ipcMain.handle("db:deleteNodesByAge", (_event, days: number) => {
  try {
    if (typeof days !== "number" || days < 1 || !isFinite(days)) return { changes: 0 };
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    return getDatabase().prepare("DELETE FROM nodes WHERE last_heard < ?").run(cutoff);
  } catch (err) {
    console.error("[IPC] db:deleteNodesByAge failed:", err);
    throw err;
  }
});

ipcMain.handle("db:pruneNodesByCount", (_event, maxCount: number) => {
  try {
    if (typeof maxCount !== "number" || maxCount < 1 || !isFinite(maxCount)) return { changes: 0 };
    return getDatabase().prepare(
      "DELETE FROM nodes WHERE node_id NOT IN (SELECT node_id FROM nodes ORDER BY last_heard DESC LIMIT ?)"
    ).run(maxCount);
  } catch (err) {
    console.error("[IPC] db:pruneNodesByCount failed:", err);
    throw err;
  }
});

ipcMain.handle("db:deleteNodesBatch", (_event, nodeIds: number[]) => {
  try {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) return 0;
    const safe = nodeIds
      .filter((id) => typeof id === "number" && Number.isInteger(id) && id > 0)
      .slice(0, 10_000);
    if (safe.length === 0) return 0;
    const placeholders = safe.map(() => "?").join(", ");
    const result = getDatabase().prepare(`DELETE FROM nodes WHERE node_id IN (${placeholders})`).run(...safe);
    return result.changes;
  } catch (err) {
    console.error("[IPC] db:deleteNodesBatch failed:", err);
    throw err;
  }
});

ipcMain.handle("db:clearMessagesByChannel", (_event, channel: number) => {
  try {
    return getDatabase().prepare("DELETE FROM messages WHERE channel = ?").run(channel);
  } catch (err) {
    console.error("[IPC] db:clearMessagesByChannel failed:", err);
    throw err;
  }
});

ipcMain.handle("db:getMessageChannels", () => {
  try {
    return getDatabase().prepare("SELECT DISTINCT channel FROM messages ORDER BY channel").all();
  } catch (err) {
    console.error("[IPC] db:getMessageChannels failed:", err);
    throw err;
  }
});

ipcMain.handle("db:deleteNodesBySource", (_event, source: string) => {
  try {
    return deleteNodesBySource(source);
  } catch (err) {
    console.error("[IPC] db:deleteNodesBySource failed:", err);
    throw err;
  }
});

// ─── IPC: Update message delivery status ────────────────────────────
ipcMain.handle(
  "db:updateMessageStatus",
  (_event, packetId: number, status: string, error?: string) => {
    try {
      const db = getDatabase();
      return db
        .prepare("UPDATE messages SET status = ?, error = ? WHERE packet_id = ?")
        .run(status, error ?? null, packetId);
    } catch (err) {
      console.error("[IPC] db:updateMessageStatus failed:", err);
      throw err;
    }
  }
);

// ─── IPC: Export database ───────────────────────────────────────────
ipcMain.handle("db:export", async () => {
  try {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export Database",
      defaultPath: `mesh-client-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (!result.canceled && result.filePath) {
      await exportDatabase(result.filePath);
      return result.filePath;
    }
    return null;
  } catch (err) {
    console.error("[IPC] db:export failed:", err);
    throw err;
  }
});

// ─── IPC: Import / merge database ───────────────────────────────────
ipcMain.handle("db:import", async () => {
  try {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Import Database",
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
      properties: ["openFile"],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const summary = mergeDatabase(result.filePaths[0]);
      return summary;
    }
    return null;
  } catch (err) {
    console.error("[IPC] db:import failed:", err);
    throw err;
  }
});

// ─── IPC: Clear Chromium session data (BLE cache, cookies, etc.) ──
ipcMain.handle("session:clearData", async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    await win.webContents.session.clearStorageData({
      storages: [
        "cookies",
        "localstorage",
        "cachestorage",
        "shadercache",
        "serviceworkers",
      ],
    });
    await win.webContents.session.clearCache();
  } catch (err) {
    console.error("[IPC] session:clearData failed:", err);
    throw err;
  }
});

// ─── App lifecycle ─────────────────────────────────────────────────
app.whenReady().then(() => {
  try {
    initDatabase();
    createWindow();
  } catch (error) {
    console.error("Fatal startup error:", error);
    dialog.showErrorBox(
      "Mesh-Client — Startup Error",
      `The application failed to start:\n\n${error instanceof Error ? error.message : String(error)}\n\nPlease report this issue.`
    );
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        createWindow();
      } catch (error) {
        console.error("Window creation error:", error);
      }
    } else {
      mainWindow?.show(); // Restore hidden window on dock click
    }
  });
});

app.on("before-quit", () => {
  closeDatabase();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
