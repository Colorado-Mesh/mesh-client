// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const INDEX_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8');
const PRELOAD_SOURCE = readFileSync(join(__dirname, '../preload/index.ts'), 'utf-8');

describe('IPC payload size limits (source contract)', () => {
  it('defines meshcore tcp-write, http:write, and noble-ble limits and uses them in handlers', () => {
    expect(INDEX_SOURCE).toContain('const MESHCORE_TCP_WRITE_MAX_BYTES = 256 * 1024');
    expect(INDEX_SOURCE).toContain('MESHCORE_TCP_DATA_MAX_BYTES');
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

  it('resolves meshtastic:tcp-write with no-socket instead of rejecting when the socket is gone', () => {
    expect(INDEX_SOURCE).toMatch(
      /meshtastic:tcp-write[\s\S]{0,800}console\.debug\('\[IPC\] meshtastic:tcp-write: no active socket'\)[\s\S]{0,80}return 'no-socket'/,
    );
    expect(INDEX_SOURCE).toContain('meshtasticTcpWriteErrorIsNoSocket');
    expect(INDEX_SOURCE).toMatch(/sock\.destroyed \|\| sock\.writableEnded/);
    expect(PRELOAD_SOURCE).toMatch(/result === 'no-socket'/);
    expect(PRELOAD_SOURCE).toMatch(/throw new Error\('meshtastic:tcp-write: no active socket'\)/);
  });

  it('returns scan_busy result instead of throwing when Reticulum holds the scan mutex', () => {
    expect(INDEX_SOURCE).toContain('BleScanBusyError');
    expect(INDEX_SOURCE).toMatch(
      /noble-ble-start-scan[\s\S]{0,1200}err instanceof BleScanBusyError[\s\S]{0,400}code: 'scan_busy'/,
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
    // Path-specific (not aggregate counts): each dropped-event branch sanitizes its payload.
    expect(INDEX_SOURCE).toMatch(
      /mqtt:status dropped \(mainWindow not ready\)',\s*sanitizeLogMessage\(s\)/,
    );
    expect(INDEX_SOURCE).toMatch(
      /mqtt:error dropped \(mainWindow not ready\)',\s*sanitizeLogMessage\(msg\)/,
    );
    expect(INDEX_SOURCE).toMatch(
      /mqtt:clientId dropped \(mainWindow not ready\)',\s*sanitizeLogMessage\(id\)/,
    );
    expect(INDEX_SOURCE).toMatch(
      /mqtt:status \(meshcore\) dropped \(mainWindow not ready\)',[\s\S]{0,40}sanitizeLogMessage\(s\)/,
    );
    expect(INDEX_SOURCE).toMatch(
      /mqtt:error \(meshcore\) dropped \(mainWindow not ready\)',[\s\S]{0,40}sanitizeLogMessage\(msg\)/,
    );
    expect(INDEX_SOURCE).toMatch(
      /mqtt:clientId \(meshcore\) dropped \(mainWindow not ready\)',[\s\S]{0,40}sanitizeLogMessage\(id\)/,
    );
  });

  it('sanitizes Linux bluetoothctl spawn-error log paths', () => {
    expect(INDEX_SOURCE).toMatch(/bluetooth-unpair error:',\s*sanitizeLogMessage\(msg\)/);
    expect(INDEX_SOURCE).toMatch(/bluetooth-start-scan error:',\s*sanitizeLogMessage\(msg\)/);
    expect(INDEX_SOURCE).toMatch(/bluetooth-connect error:',\s*sanitizeLogMessage\(msg\)/);
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
  it('registers updateMeshcoreMessageSender with validated sender id and name', () => {
    expect(INDEX_SOURCE).toContain("'db:updateMeshcoreMessageSender'");
    expect(INDEX_SOURCE).toContain('db:updateMeshcoreMessageSender: invalid senderId');
    expect(INDEX_SOURCE).toMatch(/sender_name = @sender_name WHERE id = @id/);
    expect(INDEX_SOURCE).toMatch(/sid < 1/);
  });

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
    const DATABASE_SOURCE = readFileSync(join(__dirname, '../main/database.ts'), 'utf-8');
    expect(INDEX_SOURCE).toContain("'db:saveMeshcoreContact'");
    expect(INDEX_SOURCE).toContain("'db:saveMeshcoreContactsBatch'");
    expect(INDEX_SOURCE).toContain('saveMeshcoreContactsBatch');
    expect(DATABASE_SOURCE).toContain('ON CONFLICT(node_id) DO UPDATE SET');
    expect(DATABASE_SOURCE).toContain('favorited = meshcore_contacts.favorited');
    expect(DATABASE_SOURCE).toContain(
      'hops_away = CASE WHEN excluded.hops_away IS NOT NULL AND (meshcore_contacts.hops_away IS NULL OR excluded.hops_away < meshcore_contacts.hops_away) THEN excluded.hops_away ELSE meshcore_contacts.hops_away END,',
    );
    expect(DATABASE_SOURCE).not.toContain('INSERT OR REPLACE INTO meshcore_contacts');
  });

  it('saveMeshcoreContactsBatch IPC slices large radio syncs at MESHCORE_CONTACTS_BATCH_MAX', () => {
    expect(INDEX_SOURCE).toContain('MESHCORE_CONTACTS_BATCH_MAX');
    expect(INDEX_SOURCE).toMatch(
      /for \(let i = 0; i < contacts\.length; i \+= MESHCORE_CONTACTS_BATCH_MAX\)/,
    );
    expect(INDEX_SOURCE).toContain('contacts.slice(i, i + MESHCORE_CONTACTS_BATCH_MAX)');
    expect(INDEX_SOURCE).toContain('return saveMeshcoreContactsBatch(rows)');
    expect(INDEX_SOURCE).not.toContain('max 500 contacts per batch');
    expect(INDEX_SOURCE).not.toMatch(/saved \+= saveMeshcoreContactsBatch/);
  });
});

describe('Persistent app settings IPC (source contract)', () => {
  it('registers appSettings:get and appSettings:set with allow-listed keys', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('appSettings:get'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('appSettings:set'");
    expect(INDEX_SOURCE).toContain('APP_SETTINGS_ALLOWED_KEYS');
    expect(INDEX_SOURCE).toMatch(/key not allowed/);
    expect(INDEX_SOURCE).toContain("'meshtasticLastRfSelfNodeId'");
    expect(INDEX_SOURCE).toContain("'meshcoreLastSelfNodeId'");
    expect(INDEX_SOURCE).toContain("'reticulumLastSelfLxmfHash'");
    expect(INDEX_SOURCE).toContain("'use24HourTime'");
    expect(INDEX_SOURCE).toContain('MESHTASTIC_REMOTE_ADMIN_KEY_SETTING_PREFIX');
    expect(INDEX_SOURCE).toContain('MESHCORE_ROOM_SYNC_SETTING_PREFIX');
    expect(INDEX_SOURCE).toContain('MESHCORE_ROOM_LAST_POST_SETTING_PREFIX');
    expect(INDEX_SOURCE).toContain('MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX');
    expect(INDEX_SOURCE).toContain('MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX');
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

  it('db:listMeshtasticDmPeers and db:listMeshcoreDmPeers assert IPC sender', () => {
    expect(INDEX_SOURCE).toMatch(
      /ipcMain\.handle\('db:listMeshtasticDmPeers'[\s\S]*?assertIpcSender\(event, 'db:listMeshtasticDmPeers'\)/,
    );
    expect(INDEX_SOURCE).toMatch(
      /ipcMain\.handle\('db:listMeshcoreDmPeers'[\s\S]*?assertIpcSender\(event, 'db:listMeshcoreDmPeers'\)/,
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
    expect(INDEX_SOURCE).toContain("ipcMain.handle('mqtt:publishProxy'");
    expect(INDEX_SOURCE).toContain('validateMqttPublishProxyArgs');
    expect(INDEX_SOURCE).toContain('mqtt:publishProxy: data too long');
  });

  it('registers meshtastic XMODEM file IPC handlers', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('meshtastic:xmodemPickUpload'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('meshtastic:xmodemSaveDownload'");
  });

  it('registers mqtt:publishNodeInfo and mqtt:publishPosition', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('mqtt:publishNodeInfo'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('mqtt:publishPosition'");
  });

  it('registers mqtt power suspend/resume handlers for sleep/wake recovery', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('mqtt:powerResume'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('mqtt:powerSuspend'");
  });

  it('registers renderer heartbeat IPC for post-resume hang detection', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('app:rendererHeartbeat'");
    expect(INDEX_SOURCE).toContain('createRendererHeartbeatWatchdog');
    expect(INDEX_SOURCE).toContain('rendererHeartbeatWatchdog.recordHeartbeat');
    expect(INDEX_SOURCE).toContain('rendererHeartbeatWatchdog.startResumeWatchdog');
    expect(INDEX_SOURCE).toContain('rendererHeartbeatWatchdog.startStallWatchdog');
    expect(INDEX_SOURCE).toContain("webContents.on('unresponsive'");
    expect(INDEX_SOURCE).toContain("webContents.on('responsive'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('app:getRendererLiveness'");
  });

  it('registers support bundle export IPC', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('support:exportBundle'");
    expect(INDEX_SOURCE).toContain('buildSupportBundleZip');
  });
});

describe('Reticulum sidecar IPC handlers (source contract)', () => {
  const RETICULUM_HANDLERS_SOURCE = readFileSync(
    join(__dirname, 'ipc/reticulum-handlers.ts'),
    'utf8',
  );
  const RETICULUM_DB_HANDLERS_SOURCE = readFileSync(
    join(__dirname, 'ipc/reticulum-db-handlers.ts'),
    'utf8',
  );
  it('registers reticulum lifecycle and proxy handlers', () => {
    expect(INDEX_SOURCE).toContain('registerReticulumIpcHandlers');
    expect(RETICULUM_HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:start'");
    expect(RETICULUM_HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:stop'");
    expect(RETICULUM_HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:getStatus'");
    expect(RETICULUM_HANDLERS_SOURCE).toContain("'reticulum:syncInterfaceIssueScope'");
    expect(RETICULUM_HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:proxyGet'");
    expect(RETICULUM_HANDLERS_SOURCE).toContain('settleReticulumProxyFailure');
    expect(RETICULUM_HANDLERS_SOURCE).toContain('reticulumProxyIpcErrorEnvelope');
    expect(PRELOAD_SOURCE).toContain('unwrapReticulumProxy');
    expect(PRELOAD_SOURCE).toContain('throwIfReticulumProxyIpcError');
    expect(PRELOAD_SOURCE).toContain("'/api/v1/rrc/hubs'");
    expect(PRELOAD_SOURCE).toContain('rrc:');
    expect(RETICULUM_HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:proxyPost'");
    expect(RETICULUM_HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:voiceSendAudio'");
    expect(RETICULUM_HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:gamesStatus'");
    expect(RETICULUM_HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:gamesAction'");
    expect(RETICULUM_HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:proxyPut'");
    expect(RETICULUM_HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:proxyDelete'");
    expect(RETICULUM_HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:readDefaultConfigFile'");
    expect(RETICULUM_HANDLERS_SOURCE).toContain(
      "ipcMain.handle('reticulum:showConfigImportDialog'",
    );
    expect(RETICULUM_HANDLERS_SOURCE).toContain(
      "ipcMain.handle('reticulum:showIdentityImportDialog'",
    );
    expect(RETICULUM_HANDLERS_SOURCE).toContain(
      "ipcMain.handle('reticulum:showIdentityBackupImportDialog'",
    );
    expect(RETICULUM_HANDLERS_SOURCE).toContain("'reticulum:saveIdentityExportDialog'");
    expect(RETICULUM_HANDLERS_SOURCE).toContain(
      "ipcMain.handle('reticulum:showNomadContentSourceDialog'",
    );
    expect(RETICULUM_HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:setNomadContentSource'");
    expect(RETICULUM_HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:validateConfig'");
    expect(INDEX_SOURCE).toContain('registerReticulumDbIpcHandlers');
    expect(INDEX_SOURCE).toContain('registerRrcDbIpcHandlers');
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain("ipcMain.handle('db:getReticulumMessages'");
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain("ipcMain.handle('db:saveReticulumMessage'");
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain("'db:searchReticulumMessages'");
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain("ipcMain.handle('db:deleteReticulumMessage'");
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain("ipcMain.handle('db:clearReticulumMessages'");
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain(
      "ipcMain.handle('db:clearReticulumContactDestinations'",
    );
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain("'db:getBlockedContacts'");
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain("'db:getReticulumIdentityActivity'");
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain(
      "ipcMain.handle('db:upsertReticulumIdentityActivityBatch'",
    );
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain(
      "ipcMain.handle('db:pruneReticulumDestinationsByCount'",
    );
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain(
      "ipcMain.handle('db:deleteReticulumDestinationsByAge'",
    );
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain(
      "ipcMain.handle('db:pruneReticulumIdentityActivityByAge'",
    );
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain(
      "ipcMain.handle('db:deleteReticulumDestination'",
    );
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

describe('Host link quality IPC (source contract)', () => {
  it('forwards Noble link RSSI and registers HTTP/TCP RTT probes', () => {
    expect(INDEX_SOURCE).toContain("webContents.send('noble-ble-link-rssi'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('hostLink:probeHttpRtt'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('hostLink:probeTcpRtt'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('hostLink:getSessionMeter'");
  });

  it('wires live-session meters on both Meshtastic and MeshCore TCP bridges', () => {
    expect(INDEX_SOURCE).toContain("resetLiveSessionMeter('meshtastic')");
    expect(INDEX_SOURCE).toContain("resetLiveSessionMeter('meshcore')");
    expect(INDEX_SOURCE).toContain("noteLiveSessionWrite('meshtastic')");
    expect(INDEX_SOURCE).toContain("noteLiveSessionWrite('meshcore')");
    expect(INDEX_SOURCE).toContain("noteLiveSessionData('meshtastic')");
    expect(INDEX_SOURCE).toContain("noteLiveSessionData('meshcore')");
    expect(INDEX_SOURCE).toContain("clearLiveSessionMeter('meshtastic')");
    expect(INDEX_SOURCE).toContain("clearLiveSessionMeter('meshcore')");
    // Accounting must ignore superseded sockets (same active-ref guard as #792 disconnect IPC).
    expect(INDEX_SOURCE).toMatch(
      /if \(meshcoreTcpSocket === socket\) \{\s*noteLiveSessionData\('meshcore'\)/,
    );
    expect(INDEX_SOURCE).toMatch(
      /if \(meshtasticTcpSocket === socket\) \{\s*noteLiveSessionData\('meshtastic'\)/,
    );
    expect(INDEX_SOURCE).toMatch(
      /if \(meshcoreTcpSocket === sock\) \{\s*noteLiveSessionWrite\('meshcore'\)/,
    );
    expect(INDEX_SOURCE).toMatch(
      /if \(meshtasticTcpSocket === sock\) \{\s*noteLiveSessionWrite\('meshtastic'\)/,
    );
  });
});

describe('Host link quality preload surface (source contract)', () => {
  it('exposes onNobleBleLinkRssi and hostLink probe APIs', () => {
    expect(PRELOAD_SOURCE).toContain('onNobleBleLinkRssi:');
    expect(PRELOAD_SOURCE).toContain("ipcRenderer.on('noble-ble-link-rssi'");
    expect(PRELOAD_SOURCE).toContain('hostLink:');
    expect(PRELOAD_SOURCE).toContain("ipcRenderer.invoke('hostLink:probeHttpRtt'");
    expect(PRELOAD_SOURCE).toContain("ipcRenderer.invoke('hostLink:probeTcpRtt'");
    expect(PRELOAD_SOURCE).toContain("ipcRenderer.invoke('hostLink:getSessionMeter'");
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

  it('flushes logs on uncaught errors and records will-quit breadcrumbs', () => {
    expect(INDEX_SOURCE).toContain('void flushLogBeforeQuit()');
    expect(INDEX_SOURCE).toContain('flushLogBeforeQuit()');
    expect(INDEX_SOURCE).toContain('will-quit userInitiated=');
  });

  it('uses shared Meshtastic Bluetooth PIN helpers in bluetooth-pair IPC', () => {
    expect(INDEX_SOURCE).toContain("from '../shared/meshtasticBluetoothPin'");
    expect(INDEX_SOURCE).toContain('formatMeshtasticBluetoothPin');
    expect(INDEX_SOURCE).toContain('parseMeshtasticBluetoothPin');
  });
});

describe('Long-session maintenance (source contract)', () => {
  it('exposes process uptime IPC for restart nudge', () => {
    expect(INDEX_SOURCE).toContain("'app:getProcessUptimeSec'");
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
    expect(INDEX_SOURCE).toContain("showFatalStartupError('Mesh-Client — Startup Error', message)");
    expect(INDEX_SOURCE).toContain('isDatabaseSchemaTooNewError(error)');
    expect(INDEX_SOURCE).toContain('formatDatabaseSchemaTooNewMessage');
    expect(INDEX_SOURCE).not.toMatch(/showMessageBox\([^)]*mainWindow[^)]*Startup Error/s);
  });

  it('quits quietly when schema upgrade is declined without a fatal error dialog', () => {
    expect(INDEX_SOURCE).toContain('isDatabaseSchemaUpgradeDeclinedError(error)');
    expect(INDEX_SOURCE).toMatch(
      /isDatabaseSchemaUpgradeDeclinedError\(error\)[\s\S]*?app\.quit\(\)[\s\S]*?return;/,
    );
    expect(INDEX_SOURCE).toMatch(
      /isDatabaseSchemaUpgradeDeclinedError\(error\)[\s\S]*?Schema upgrade declined[\s\S]*?app\.quit\(\)/,
    );
  });

  it('shows import blocked dialog when merge source schema is too new', () => {
    expect(INDEX_SOURCE).toContain("'Mesh-Client — Import Blocked'");
    expect(INDEX_SOURCE).toMatch(
      /db:import[\s\S]*?isDatabaseSchemaTooNewError\(err\)[\s\S]*?formatDatabaseSchemaTooNewMessage/,
    );
  });

  it('registers chat:fetchLinkPreview handler with sender validation', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('chat:fetchLinkPreview'");
    expect(INDEX_SOURCE).toMatch(
      /ipcMain\.handle\('chat:fetchLinkPreview'[\s\S]*?validateIpcSender\(event\)/,
    );
  });

  it('registers chat:readReticulumAttachmentAsDataUrl with sender validation and path jail', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('chat:readReticulumAttachmentAsDataUrl'");
    expect(INDEX_SOURCE).toMatch(
      /ipcMain\.handle\('chat:readReticulumAttachmentAsDataUrl'[\s\S]*?validateIpcSender\(event\)/,
    );
    expect(INDEX_SOURCE).toContain('readReticulumAttachmentAsDataUrl');
    expect(INDEX_SOURCE).toContain('takeReticulumAttachmentImageRateToken');
    expect(INDEX_SOURCE).toContain('o.filePath.length > 512');
    // Optional mimeType on the wire is ignored — magic bytes alone decide embed MIME.
    expect(INDEX_SOURCE).toContain('magic bytes alone decide embed MIME');
    expect(INDEX_SOURCE).toContain('return { dataUrl }');
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

  it('bounds bluetooth-start-scan with a 15 s timeout', () => {
    expect(INDEX_SOURCE).toContain('BLUETOOTH_START_SCAN_TIMEOUT_MS = 15_000');
    expect(INDEX_SOURCE).toContain("ipcMain.handle('bluetooth-start-scan'");
    expect(INDEX_SOURCE).toContain('bluetooth-start-scan: timed out after 15 s');
  });

  it('reads meshcore import JSON via fs.promises.readFile', () => {
    expect(INDEX_SOURCE).toMatch(
      /ipcMain\.handle\('meshcore:openJsonFile'[\s\S]*?fs\.promises\.readFile/,
    );
  });

  it('validates IPC sender for meshcore:openJsonFile and device-connected listeners', () => {
    expect(INDEX_SOURCE).toMatch(
      /ipcMain\.handle\('meshcore:openJsonFile'[\s\S]*?assertIpcSender\(event, 'meshcore:openJsonFile'\)/,
    );
    expect(INDEX_SOURCE).toMatch(
      /ipcMain\.on\('device-connected'[\s\S]*?validateIpcSender\(event\)/,
    );
    expect(INDEX_SOURCE).toMatch(
      /ipcMain\.on\('device-disconnected'[\s\S]*?validateIpcSender\(event\)/,
    );
    expect(INDEX_SOURCE).toMatch(
      /ipcMain\.handle\('app:getProcessUptimeSec'[\s\S]*?assertIpcSender\(event, 'app:getProcessUptimeSec'\)/,
    );
  });
});
