// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const INDEX_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8');

describe('IPC payload size limits (source contract)', () => {
  it('defines meshcore tcp-write, http:write, and noble-ble limits and uses them in handlers', () => {
    expect(INDEX_SOURCE).toContain('const MESHCORE_TCP_WRITE_MAX_BYTES = 256 * 1024');
    expect(INDEX_SOURCE).toContain('const HTTP_WRITE_TO_RADIO_MAX_BYTES = 256 * 1024');
    expect(INDEX_SOURCE).toContain('const NOBLE_BLE_TO_RADIO_MAX_BYTES = 512');
    expect(INDEX_SOURCE).toMatch(/maxBytes: NOBLE_BLE_TO_RADIO_MAX_BYTES/);
    expect(INDEX_SOURCE).toMatch(/bytes\.length > MESHCORE_TCP_WRITE_MAX_BYTES/);
    expect(INDEX_SOURCE).toMatch(/data\.length > HTTP_WRITE_TO_RADIO_MAX_BYTES/);
    expect(INDEX_SOURCE).toMatch(/http:write: byte values must be integers 0-255/);
  });
});

describe('Noble BLE disconnect handling (source contract)', () => {
  it('classifies expected disconnect write races and ignores them in noble-ble-to-radio', () => {
    expect(INDEX_SOURCE).toContain("import { handleNobleBleToRadioWrite } from './noble-ble-ipc'");
    expect(INDEX_SOURCE).toMatch(/const result = await handleNobleBleToRadioWrite\(/);
    expect(INDEX_SOURCE).toMatch(/result === 'ignored-expected-disconnect'/);
    expect(INDEX_SOURCE).toMatch(
      /noble-ble-to-radio: disconnected during write, ignoring session=/,
    );
  });
});

describe('MeshCore packet log IPC (source contract)', () => {
  it('validates publishMeshcorePacketLog args and wires handler', () => {
    expect(INDEX_SOURCE).toContain('const MAX_MESHCORE_PACKET_LOG_ORIGIN = 200');
    expect(INDEX_SOURCE).toContain('const MAX_MESHCORE_PACKET_LOG_RAW_HEX = 2048');
    expect(INDEX_SOURCE).toContain(
      'function validateMqttPublishMeshcorePacketLogArgs(args: unknown)',
    );
    expect(INDEX_SOURCE).toMatch(/validateMqttPublishMeshcorePacketLogArgs\(args\)/);
    expect(INDEX_SOURCE).toContain('mqtt:publishMeshcorePacketLog');
    expect(INDEX_SOURCE).toMatch(/rawHex must be hex/);
  });
});

describe('Meshtastic MQTT waypoint IPC (source contract)', () => {
  it('registers publishWaypoint handler with validation', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('mqtt:publishWaypoint'");
    expect(INDEX_SOURCE).toContain('validateMqttPublishWaypointArgs');
  });
});

describe('MQTT forwarder dropped-event logs (source contract)', () => {
  it('sanitizes dynamic MQTT fields when mainWindow is not ready', () => {
    expect((INDEX_SOURCE.match(/sanitizeLogMessage\(String\(s\)\)/g) ?? []).length).toBe(2);
    expect((INDEX_SOURCE.match(/sanitizeLogMessage\(String\(msg\)\)/g) ?? []).length).toBe(3);
    expect((INDEX_SOURCE.match(/sanitizeLogMessage\(String\(id\)\)/g) ?? []).length).toBe(2);
  });
});

describe('Meshtastic message DB IPC (source contract)', () => {
  it('registers db:updateMessagePacketId for optimistic packet_id → RF id (tapback reply_id)', () => {
    expect(INDEX_SOURCE).toContain("'db:updateMessagePacketId'");
    expect(INDEX_SOURCE).toMatch(/UPDATE messages SET packet_id = \? WHERE packet_id = \?/);
  });

  it('updateMessageReceivedVia merges rx_hops with COALESCE when upgrading to both', () => {
    expect(INDEX_SOURCE).toContain("'db:updateMessageReceivedVia'");
    expect(INDEX_SOURCE).toMatch(/rx_hops = COALESCE\(\?, rx_hops\)/);
  });
});

describe('MeshCore DB IPC (source contract)', () => {
  it('registers updateMeshcoreContactLastRf for repeater Status persistence', () => {
    expect(INDEX_SOURCE).toContain("'db:updateMeshcoreContactLastRf'");
    expect(INDEX_SOURCE).toContain('last_snr = ?,');
    expect(INDEX_SOURCE).toContain('last_rssi = ?,');
    expect(INDEX_SOURCE).toContain(
      'hops_away = CASE WHEN ? IS NOT NULL AND (hops_away IS NULL OR ? < hops_away) THEN ? ELSE hops_away END,',
    );
    expect(INDEX_SOURCE).toContain('last_advert = CASE WHEN ? IS NOT NULL');
  });

  it('saveMeshcoreContact uses UPSERT that preserves favorited on conflict', () => {
    expect(INDEX_SOURCE).toContain("'db:saveMeshcoreContact'");
    expect(INDEX_SOURCE).toContain('ON CONFLICT(node_id) DO UPDATE SET');
    expect(INDEX_SOURCE).toContain('favorited = meshcore_contacts.favorited');
    expect(INDEX_SOURCE).toContain(
      'hops_away = CASE WHEN excluded.hops_away IS NOT NULL AND (meshcore_contacts.hops_away IS NULL OR excluded.hops_away < meshcore_contacts.hops_away) THEN excluded.hops_away ELSE meshcore_contacts.hops_away END,',
    );
    expect(INDEX_SOURCE).not.toContain('INSERT OR REPLACE INTO meshcore_contacts');
  });
});

describe('Persistent app settings IPC (source contract)', () => {
  it('registers appSettings:get and appSettings:set with allow-listed keys', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('appSettings:get'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('appSettings:set'");
    expect(INDEX_SOURCE).toContain('APP_SETTINGS_ALLOWED_KEYS');
    expect(INDEX_SOURCE).toMatch(/key not allowed/);
    expect(INDEX_SOURCE).toContain("'meshtasticLastRfSelfNodeId'");
    expect(INDEX_SOURCE).toContain('meshtasticRemoteAdminKey:');
    expect(INDEX_SOURCE).toContain('isAppSettingsKeyAllowed');
  });

  it('registers DB-level message prune IPC for both protocols (issue #387)', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('db:pruneMessagesByCount'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('db:pruneMeshcoreMessagesByCount'");
  });
});

describe('External link routing (source contract)', () => {
  it('routes external http/https navigations to system browser', () => {
    expect(INDEX_SOURCE).toContain('setWindowOpenHandler');
    expect(INDEX_SOURCE).toContain('will-navigate');
    expect(INDEX_SOURCE).toContain('openExternalHttpOrHttpsIfExternal');
    expect(INDEX_SOURCE).toContain("protocol === 'http:'");
    expect(INDEX_SOURCE).toContain("protocol === 'https:'");
    expect(INDEX_SOURCE).toContain('shell.openExternal');
    expect(INDEX_SOURCE).toContain('event.preventDefault()');
  });

  it('logs rejected external link opens instead of leaving unhandled rejections', () => {
    expect(INDEX_SOURCE).toContain('shell.openExternal(target.toString()).catch((e: unknown) => {');
    expect(INDEX_SOURCE).toContain("'[main] external link open failed'");
    expect(INDEX_SOURCE).toContain(
      'sanitizeLogMessage(e instanceof Error ? e.message : String(e))',
    );
  });
});

describe('About dialog crash guard (source contract)', () => {
  it('uses Windows HTML About fallback and native panel elsewhere (no showMessageBox About)', () => {
    expect(INDEX_SOURCE).toContain('function showAboutDialog(): void {');
    expect(INDEX_SOURCE).toContain(
      'console.debug(`[main] about dialog: opening app=${sanitizeLogMessage(appName)}`);',
    );
    expect(INDEX_SOURCE).toContain(
      "import { buildWindowsAboutDocumentHtml } from './windows-about-html';",
    );
    expect(INDEX_SOURCE).toContain('function showWindowsAboutFallbackWindow(): void {');
    expect(INDEX_SOURCE).toContain('showWindowsAboutFallbackWindow();');
    expect(INDEX_SOURCE).toContain('app.showAboutPanel();');
    expect(INDEX_SOURCE).toContain('app.setAboutPanelOptions');
    expect(INDEX_SOURCE).toContain('function applyAboutPanelOptions(): void');
    expect(INDEX_SOURCE).toMatch(
      /function applyAboutPanelOptions\(\): void \{[\s\S]*?if \(process\.platform === 'win32'\) \{\s*return;\s*\}/,
    );
    expect(INDEX_SOURCE).toContain("'[main] about dialog failed'");
    expect(INDEX_SOURCE).toContain(
      'dialog.showErrorBox(`About ${appName}`, `${appName}\\nVersion ${version}`);',
    );
    expect(INDEX_SOURCE).toContain("'[main] about dialog fallback failed'");
    expect(INDEX_SOURCE).not.toContain('showMessageBox(`About ${appName}`');
  });

  it('exposes Help menu external link helper with validated openExternal', () => {
    expect(INDEX_SOURCE).toContain('function openHelpExternalLink(');
    expect(INDEX_SOURCE).toContain('function buildHelpMenuExternalLinkItems(');
    expect(INDEX_SOURCE).toContain('[main] help link: openExternal url=');
    expect(INDEX_SOURCE).toContain('[main] help link: openExternal failed');
    expect(INDEX_SOURCE).toContain(
      'void shell.openExternal(target.toString() /* parseHttpOrHttpsUrl */).catch((e: unknown) => {',
    );
    expect(INDEX_SOURCE).toContain('HELP_URL_WEBSITE');
    expect(INDEX_SOURCE).toContain('HELP_URL_GITHUB');
    expect(INDEX_SOURCE).toContain('HELP_URL_DISCORD');
  });
});

describe('IPC sender validation on high-value handlers (source contract)', () => {
  it('db:saveMessage, db:getMessages validate IPC sender before executing', () => {
    expect(INDEX_SOURCE).toMatch(
      /ipcMain\.handle\('db:saveMessage'[\s\S]*?validateIpcSender\(event\)/,
    );
    expect(INDEX_SOURCE).toMatch(
      /ipcMain\.handle\('db:getMessages'[\s\S]*?validateIpcSender\(event\)/,
    );
  });

  it('http:preflight and http:connect validate IPC sender before executing', () => {
    expect(INDEX_SOURCE).toMatch(
      /ipcMain\.handle\('http:preflight'[\s\S]*?validateIpcSender\(event\)/,
    );
    expect(INDEX_SOURCE).toMatch(
      /ipcMain\.handle\('http:connect'[\s\S]*?validateIpcSender\(event\)/,
    );
  });
});

describe('MQTT IPC handlers (source contract)', () => {
  it('registers mqtt:connect, mqtt:disconnect handlers', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('mqtt:connect'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('mqtt:disconnect'");
  });

  it('registers mqtt:publish with payload validation', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('mqtt:publish'");
    expect(INDEX_SOURCE).toMatch(/validateMqttPublish/);
  });

  it('registers mqtt:publishNodeInfo and mqtt:publishPosition', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('mqtt:publishNodeInfo'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('mqtt:publishPosition'");
  });
});

describe('HTTP bridge IPC handlers (source contract)', () => {
  it('registers all four HTTP bridge handlers', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('http:preflight'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('http:connect'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('http:write'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('http:disconnect'");
  });

  it('http:connect uses an in-flight guard to prevent concurrent fetches', () => {
    expect(INDEX_SOURCE).toContain('fetchInFlight');
    expect(INDEX_SOURCE).toMatch(/fetchInFlight.*return/);
  });
});

describe('Native crash observability (source contract)', () => {
  it('starts crashReporter without upload and logs child-process-gone', () => {
    expect(INDEX_SOURCE).toContain(
      'import {\n  app,\n  BrowserWindow,\n  clipboard,\n  crashReporter,',
    );
    expect(INDEX_SOURCE).toContain('crashReporter.start({ uploadToServer: false })');
    expect(INDEX_SOURCE).toContain("'[main] crashDumps path:'");
    expect(INDEX_SOURCE).toContain("'[main] child-process-gone:'");
  });
});

describe('Native Electron call guards (source contract)', () => {
  it('keeps tray, badge, and power-save native calls best-effort', () => {
    expect(INDEX_SOURCE).toContain("'[main] tray icon load failed:'");
    expect(INDEX_SOURCE).toContain("'[main] tray unread icon overlay failed:'");
    expect(INDEX_SOURCE).toContain("'[main] tray setup failed:'");
    expect(INDEX_SOURCE).toContain("'[main] tray unread update failed:'");
    expect(INDEX_SOURCE).toContain('function startPowerSaveBlocker(): void');
    expect(INDEX_SOURCE).toContain('function stopPowerSaveBlocker(): void');
    expect(INDEX_SOURCE).toContain("'[main] powerSaveBlocker start failed:'");
    expect(INDEX_SOURCE).toContain("'[main] powerSaveBlocker stop failed:'");
  });

  it('logs native IPC helper failures locally before fallback or rejection', () => {
    expect(INDEX_SOURCE).toContain("'[IPC] notify:message failed:'");
    expect(INDEX_SOURCE).toContain("'[IPC] storage:isAvailable failed:'");
    expect(INDEX_SOURCE).toContain("'[IPC] storage:encrypt failed:'");
    expect(INDEX_SOURCE).toContain("'[IPC] storage:decrypt failed:'");
    expect(INDEX_SOURCE).toContain("'[IPC] app:getLoginItem failed:'");
    expect(INDEX_SOURCE).toContain("'[IPC] app:setLoginItem failed:'");
    expect(INDEX_SOURCE).toContain("'[IPC] app:showEmojiPanel failed:'");
    expect(INDEX_SOURCE).toContain("'[IPC] meshcore:openJsonFile failed:'");
  });

  it('guards fatal startup error dialog fallback', () => {
    expect(INDEX_SOURCE).toContain("dialog.showErrorBox('Mesh-Client — Startup Error', message);");
    expect(INDEX_SOURCE).toContain(
      'catch-no-log-ok dialog unavailable during fatal startup handling; error already logged above',
    );
  });

  it('registers chat:fetchLinkPreview handler with sender validation', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('chat:fetchLinkPreview'");
    expect(INDEX_SOURCE).toMatch(
      /ipcMain\.handle\('chat:fetchLinkPreview'[\s\S]*?validateIpcSender\(event\)/,
    );
  });

  it('registers chat:outbox handlers with protocol, status, and payload validation', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('chat:outbox:list'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('chat:outbox:add'");
    expect(INDEX_SOURCE).toMatch(/'chat:outbox:updateStatus'/);
    expect(INDEX_SOURCE).toContain("ipcMain.handle('chat:outbox:remove'");
    expect(INDEX_SOURCE).toContain('OUTBOX_VALID_PROTOCOLS');
    expect(INDEX_SOURCE).toContain('OUTBOX_VALID_STATUSES');
    // payload length guard prevents oversized strings entering the DB
    expect(INDEX_SOURCE).toMatch(/e\.payload\.length === 0 \|\| e\.payload\.length > 2048/);
    // rowToOutboxEntry maps snake_case columns to camelCase
    expect(INDEX_SOURCE).toContain('function rowToOutboxEntry(');
    expect(INDEX_SOURCE).toContain('view_key');
    expect(INDEX_SOURCE).toContain('attempt_count');
  });

  it('registers clipboard:writeText with sender validation', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('clipboard:writeText'");
    expect(INDEX_SOURCE).toMatch(
      /ipcMain\.handle\('clipboard:writeText'[\s\S]*?validateIpcSender\(event\)/,
    );
    expect(INDEX_SOURCE).toContain('clipboard.writeText(text)');
  });
});
