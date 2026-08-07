// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { formatHostForUrl, parseConnectHostPort } from '../shared/connectHost';
import { isValidHttpHostname } from './httpHostValidation';

const INDEX_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8');
const SUPPORT_BUNDLE_SOURCE = readFileSync(join(__dirname, 'support-bundle.ts'), 'utf-8');
const TAK_IPC_SOURCE = readFileSync(join(__dirname, 'ipc/tak-handlers.ts'), 'utf-8');
const GPS_IPC_SOURCE = readFileSync(join(__dirname, 'ipc/gps-handlers.ts'), 'utf-8');

// ─── http:preflight / http:connect hostname validation ──────────────

describe('validateHttpHost (source contract)', () => {
  it('uses isValidHttpHostname from httpHostValidation', () => {
    expect(INDEX_SOURCE).toContain("import { isValidHttpHostname } from './httpHostValidation'");
    expect(INDEX_SOURCE).toContain('isValidHttpHostname(bareHost)');
  });

  it('calls validateHttpHost in http:preflight handler', () => {
    // Ensure both handlers use the shared helper rather than ad-hoc length checks
    const preflightIdx = INDEX_SOURCE.indexOf("ipcMain.handle('http:preflight'");
    const connectIdx = INDEX_SOURCE.indexOf("ipcMain.handle('http:connect'");
    expect(preflightIdx).toBeGreaterThan(-1);
    expect(connectIdx).toBeGreaterThan(-1);

    // Extract the handler body up to the next ipcMain.handle boundary
    const preflightBody = INDEX_SOURCE.slice(preflightIdx, preflightIdx + 300);
    const connectBody = INDEX_SOURCE.slice(connectIdx, connectIdx + 300);

    expect(preflightBody).toContain('validateHttpHost(');
    expect(connectBody).toContain('validateHttpHost(');
  });

  it('rejects whitespace in hostnames via isValidHttpHostname', () => {
    expect(isValidHttpHostname('example.com')).toBe(true);
    expect(isValidHttpHostname('my-router.local')).toBe(true);
    expect(isValidHttpHostname('192.168.1.1')).toBe(true);
    expect(isValidHttpHostname('a')).toBe(true);
    expect(isValidHttpHostname('sub.domain.example.org')).toBe(true);
    expect(isValidHttpHostname('host with spaces')).toBe(false);
    expect(isValidHttpHostname('-leading-hyphen.com')).toBe(false);
    expect(isValidHttpHostname('trailing-hyphen-.com')).toBe(false);
    expect(isValidHttpHostname('')).toBe(false);
    expect(isValidHttpHostname('has..double.dot')).toBe(false);
  });

  it('accepts IPv6 bare and bracketed hosts', () => {
    expect(isValidHttpHostname('::1')).toBe(true);
    expect(isValidHttpHostname('[::1]')).toBe(true);
    expect(isValidHttpHostname('fd00::1')).toBe(true);
  });

  it('strips a trailing port via parseConnectHostPort before calling isValidHttpHostname', () => {
    // http:preflight/http:connect are called with an authority string that always
    // has a port appended (connection.ts: formatHostForUrl(host, port)), even for
    // a bare IP with no port typed. isValidHttpHostname alone rejects that string
    // because it looks like an unbracketed (and invalid) IPv6 literal.
    const bodyIdx = INDEX_SOURCE.indexOf('function validateHttpHost(');
    expect(bodyIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(bodyIdx, bodyIdx + 500);
    expect(body).toContain('parseConnectHostPort(host, 0).host');
  });

  it('regression: recovers a validatable host from formatHostForUrl output (connection.ts http case)', () => {
    const urlHost = formatHostForUrl('192.168.1.50', 80);
    expect(urlHost).toBe('192.168.1.50:80');

    // Without the fix, validateHttpHost would call isValidHttpHostname directly
    // on this authority string, which fails.
    expect(isValidHttpHostname(urlHost)).toBe(false);

    // The fix strips the port first, recovering a validatable bare host.
    expect(isValidHttpHostname(parseConnectHostPort(urlHost, 0).host)).toBe(true);
  });

  it('regression: IPv6 authority from formatHostForUrl also validates after stripping the port', () => {
    const urlHost = formatHostForUrl('fd00::1', 4403);
    expect(urlHost).toBe('[fd00::1]:4403');
    expect(isValidHttpHostname(urlHost)).toBe(false);
    expect(isValidHttpHostname(parseConnectHostPort(urlHost, 0).host)).toBe(true);
  });

  it('still validates a bare host with no port, as used by meshcore:tcp-connect', () => {
    expect(parseConnectHostPort('fd00::1', 0).host).toBe('fd00::1');
    expect(isValidHttpHostname(parseConnectHostPort('fd00::1', 0).host)).toBe(true);
  });
});

// ─── meshtastic:tcp-write byte element validation ───────────────────

describe('meshtastic:tcp-write byte validation (source contract)', () => {
  it('validates individual byte elements in addition to array length', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshtastic:tcp-write'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 600);
    expect(handlerBody).toContain('Number.isInteger(b)');
    expect(handlerBody).toContain('b >= 0');
    expect(handlerBody).toContain('b <= 255');
  });

  it('defines a 256 KB cap on meshtastic tcp-write payloads', () => {
    expect(INDEX_SOURCE).toContain('const MESHTASTIC_TCP_WRITE_MAX_BYTES = 256 * 1024');
  });

  it('rejects connect when port is out of range', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshtastic:tcp-connect'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 400);
    expect(handlerBody).toContain('p < 1');
    expect(handlerBody).toContain('p > 65535');
  });

  it('destroys prior socket before opening a new meshtastic tcp connection', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshtastic:tcp-connect'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 1400);
    // Null the active ref before destroy so the superseded close does not emit
    // meshtastic:tcp-disconnected against a healthy replacement (#792).
    expect(handlerBody).toMatch(
      /const prev = meshtasticTcpSocket;\s*meshtasticTcpSocket = null;\s*clearLiveSessionMeter\('meshtastic'\);\s*prev\.destroy\(\)/,
    );
  });

  it('emits meshtastic:tcp-disconnected only for the active socket (PR #792)', () => {
    // connect/disconnect null the ref before destroy(); a superseded close must not broadcast
    // or the renderer TCP loss-watch will tear down a healthy replacement session.
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshtastic:tcp-connect'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const closeIdx = INDEX_SOURCE.indexOf("socket.on('close'", handlerIdx);
    expect(closeIdx).toBeGreaterThan(handlerIdx);
    const closeBody = INDEX_SOURCE.slice(closeIdx, closeIdx + 900);
    expect(closeBody).toContain('if (meshtasticTcpSocket === socket)');
    expect(closeBody).toContain("mainWindow?.webContents.send('meshtastic:tcp-disconnected')");
    // Emit must be inside the active-socket guard (not before it).
    const guardIdx = closeBody.indexOf('if (meshtasticTcpSocket === socket)');
    const emitIdx = closeBody.indexOf(
      "mainWindow?.webContents.send('meshtastic:tcp-disconnected')",
    );
    expect(guardIdx).toBeGreaterThan(-1);
    expect(emitIdx).toBeGreaterThan(guardIdx);
  });

  it('nulls meshtasticTcpSocket before destroy on disconnect (PR #792)', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshtastic:tcp-disconnect'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 500);
    expect(handlerBody).toMatch(
      /const prev = meshtasticTcpSocket;\s*meshtasticTcpSocket = null;\s*clearLiveSessionMeter\('meshtastic'\);\s*prev\.destroy\(\)/,
    );
  });

  it('does not null meshtasticTcpSocket in the error handler (error-before-close race)', () => {
    // Node emits 'error' then 'close' on ECONNRESET. If error nulls the ref first, close's
    // active-socket guard fails and meshtastic:tcp-disconnected is swallowed.
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshtastic:tcp-connect'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const errorIdx = INDEX_SOURCE.indexOf("socket.on('error'", handlerIdx);
    expect(errorIdx).toBeGreaterThan(handlerIdx);
    const closeIdx = INDEX_SOURCE.indexOf("socket.on('close'", handlerIdx);
    expect(closeIdx).toBeGreaterThan(handlerIdx);
    expect(errorIdx).toBeGreaterThan(closeIdx);
    const errorBody = INDEX_SOURCE.slice(errorIdx, errorIdx + 500);
    expect(errorBody).not.toMatch(/meshtasticTcpSocket\s*=\s*null/);
    expect(errorBody).toContain('Do not null meshtasticTcpSocket');
  });
});

// ─── meshcore:tcp-write byte element validation ──────────────────────

describe('meshcore:tcp-write byte validation (source contract)', () => {
  it('validates individual byte elements in addition to array length', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshcore:tcp-write'");
    expect(handlerIdx).toBeGreaterThan(-1);
    // Read enough of the handler to see the element validation
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 600);

    // Must check each byte is a valid 0-255 integer
    expect(handlerBody).toContain('Number.isInteger(b)');
    expect(handlerBody).toContain('b >= 0');
    expect(handlerBody).toContain('b <= 255');
  });

  it('defines a 256 KB cap on tcp-write payloads', () => {
    expect(INDEX_SOURCE).toContain('const MESHCORE_TCP_WRITE_MAX_BYTES = 256 * 1024');
  });
});

// ─── storage:encrypt / storage:decrypt input validation ─────────────

describe('storage IPC input validation (source contract)', () => {
  it('storage:encrypt rejects inputs over 4096 bytes', () => {
    const encryptIdx = INDEX_SOURCE.indexOf("ipcMain.handle('storage:encrypt'");
    expect(encryptIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(encryptIdx, encryptIdx + 300);
    expect(body).toContain('4096');
  });

  it('storage:decrypt rejects inputs over 8192 bytes', () => {
    const decryptIdx = INDEX_SOURCE.indexOf("ipcMain.handle('storage:decrypt'");
    expect(decryptIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(decryptIdx, decryptIdx + 300);
    expect(body).toContain('8192');
  });
});

// ─── bluetooth-pair input validation ───────────────────────────────

describe('bluetooth-pair input validation (source contract)', () => {
  it('validates MAC address format with isMacAddress', () => {
    expect(INDEX_SOURCE).toContain('function isMacAddress(value: string): boolean');
  });

  it('applies isMacAddress in bluetooth-pair handler', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('bluetooth-pair'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 600);
    expect(body).toContain('isMacAddress(macAddress)');
  });
});

// ─── H1: bluetooth-* IPC sender validation ──────────────────────────

describe('bluetooth IPC sender validation (source contract, H1)', () => {
  const bluetoothChannels = [
    'bluetooth-unpair',
    'bluetooth-start-scan',
    'bluetooth-stop-scan',
    'bluetooth-pair',
    'bluetooth-connect',
    'bluetooth-untrust',
    'bluetooth-get-info',
  ] as const;

  it.each(bluetoothChannels)('%s calls assertIpcSender', (channel) => {
    const handlerIdx = INDEX_SOURCE.indexOf(`ipcMain.handle('${channel}'`);
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 300);
    expect(handlerBody).toContain(`assertIpcSender(event, '${channel}')`);
  });

  it('bluetooth-provide-pin validates IPC sender', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.on('bluetooth-provide-pin'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 400);
    expect(body).toContain('validateIpcSender(event)');
  });

  it('meshtastic:xmodemPickUpload uses a bounded descriptor read', () => {
    expect(INDEX_SOURCE).toContain('MESHTASTIC_XMODEM_UPLOAD_MAX_BYTES');
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshtastic:xmodemPickUpload'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 900);
    expect(body).toContain('MESHTASTIC_XMODEM_UPLOAD_MAX_BYTES');
    expect(body).toContain('readFileUpTo(filePath, MESHTASTIC_XMODEM_UPLOAD_MAX_BYTES)');
    expect(body).toContain("err.message === 'File too large'");
    expect(body).not.toContain('fs.promises.readFile(filePath)');
  });
});

// ─── H4: bluetoothctl stop-scan / get-info hang guards ──────────────

describe('bluetoothctl timeout hardening (source contract, H4)', () => {
  it('defines 5s timeouts for stop-scan and get-info', () => {
    expect(INDEX_SOURCE).toContain('const BLUETOOTH_STOP_SCAN_TIMEOUT_MS = 5_000;');
    expect(INDEX_SOURCE).toContain('const BLUETOOTH_GET_INFO_TIMEOUT_MS = 5_000;');
  });

  it('bluetooth-stop-scan kills the process and settles the promise on timeout', () => {
    const idx = INDEX_SOURCE.indexOf("ipcMain.handle('bluetooth-stop-scan'");
    expect(idx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(idx, idx + 1200);
    expect(body).toContain('BLUETOOTH_STOP_SCAN_TIMEOUT_MS');
    expect(body).toContain('proc.kill()');
    // Must not leave the returned Promise pending forever — timeout resolves it.
    expect(body).toMatch(/setTimeout\(\(\) => \{[\s\S]*?proc\.kill\(\);[\s\S]*?finish\(\);/);
  });

  it('bluetooth-get-info kills the process and resolves on timeout', () => {
    const idx = INDEX_SOURCE.indexOf("ipcMain.handle('bluetooth-get-info'");
    expect(idx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(idx, idx + 1500);
    expect(body).toContain('BLUETOOTH_GET_INFO_TIMEOUT_MS');
    expect(body).toContain('proc.kill()');
    expect(body).toMatch(/setTimeout\(\(\) => \{[\s\S]*?proc\.kill\(\);[\s\S]*?finish\(/);
  });
});

// ─── BrowserWindow security settings ────────────────────────────────

describe('BrowserWindow webPreferences (source contract)', () => {
  it('disables nodeIntegration', () => {
    expect(INDEX_SOURCE).toContain('nodeIntegration: false');
  });

  it('enables contextIsolation', () => {
    expect(INDEX_SOURCE).toContain('contextIsolation: true');
  });

  it('disables webviewTag', () => {
    expect(INDEX_SOURCE).toContain('webviewTag: false');
  });

  it('documents why experimentalFeatures is enabled', () => {
    // Must have an explanatory comment alongside the flag
    const flagIdx = INDEX_SOURCE.indexOf('experimentalFeatures: true');
    expect(flagIdx).toBeGreaterThan(-1);
    // A security note comment should appear nearby (within 400 chars before the flag)
    const surrounding = INDEX_SOURCE.slice(Math.max(0, flagIdx - 400), flagIdx);
    expect(surrounding).toContain('Security note:');
  });
});

// ─── Permission handler whitelist ───────────────────────────────────

describe('session permission whitelist (source contract)', () => {
  it('grants serial, geolocation, and media via setPermissionCheckHandler', () => {
    // Search for the actual session method call, not a comment mention of the name
    const checkIdx = INDEX_SOURCE.indexOf('.setPermissionCheckHandler(');
    expect(checkIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(checkIdx, checkIdx + 450);
    // Ensure the allowlist is serial + geolocation + media, not a wildcard
    expect(body).toContain("permission === 'serial'");
    expect(body).toContain("permission === 'geolocation'");
    expect(body).toContain("permission === 'media'");
    expect(body).not.toContain('return true'); // Must be conditional, not blanket true
  });

  it('grants media via setPermissionRequestHandler for camera/audio', () => {
    const reqIdx = INDEX_SOURCE.indexOf('.setPermissionRequestHandler(');
    expect(reqIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(reqIdx, reqIdx + 450);
    expect(body).toContain("permission === 'geolocation'");
    expect(body).toContain("permission === 'media'");
    expect(body).not.toMatch(/callback\s*\(\s*true\s*\)/);
  });

  it('registers media:ensureMicrophoneAccess IPC handler', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('media:ensureMicrophoneAccess'");
    expect(INDEX_SOURCE).toContain('ensureMicrophoneAccess(');
  });

  it('registers media:ensureCameraAccess IPC handler', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('media:ensureCameraAccess'");
    expect(INDEX_SOURCE).toContain('ensureCameraAccess(');
  });
});

// ─── meshcore:tcp-connect hostname validation ────────────────────────

describe('meshcore:tcp-connect hostname validation (source contract)', () => {
  it('calls validateHttpHost in the meshcore:tcp-connect handler', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshcore:tcp-connect'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 600);
    expect(handlerBody).toContain('validateHttpHost(');
  });

  it('does not use a bare length-only host check in meshcore:tcp-connect', () => {
    // The old pattern was: typeof host !== 'string' || host.length === 0 || host.length > MAX_TCP_HOST_LENGTH
    // It should now delegate entirely to validateHttpHost which applies isValidHttpHostname
    expect(INDEX_SOURCE).not.toContain('MAX_TCP_HOST_LENGTH');
  });

  it('normalizes bracketed IPv6 before net.Socket.connect', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshcore:tcp-connect'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 1400);
    expect(handlerBody).toContain('formatHostForSocket(');
  });

  it('emits meshcore:tcp-disconnected only for the active socket (PR #792)', () => {
    // Same contract as meshtastic:tcp-connect — superseded closes from connect-replace /
    // disconnect must not look like a live link drop to the renderer reconnect path.
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshcore:tcp-connect'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const closeIdx = INDEX_SOURCE.indexOf("socket.on('close'", handlerIdx);
    expect(closeIdx).toBeGreaterThan(handlerIdx);
    const closeBody = INDEX_SOURCE.slice(closeIdx, closeIdx + 1600);
    expect(closeBody).toContain('if (meshcoreTcpSocket === socket)');
    expect(closeBody).toContain("mainWindow?.webContents.send('meshcore:tcp-disconnected')");
    expect(closeBody).toContain('readableEnded');
    expect(closeBody).toContain('writableEnded');
    expect(closeBody).toContain('remoteAddress');
    const guardIdx = closeBody.indexOf('if (meshcoreTcpSocket === socket)');
    const emitIdx = closeBody.indexOf("mainWindow?.webContents.send('meshcore:tcp-disconnected')");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(emitIdx).toBeGreaterThan(guardIdx);
  });

  it('nulls meshcoreTcpSocket before destroy on connect-replace and disconnect (PR #792)', () => {
    const connectIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshcore:tcp-connect'");
    expect(connectIdx).toBeGreaterThan(-1);
    const connectBody = INDEX_SOURCE.slice(connectIdx, connectIdx + 1400);
    expect(connectBody).toMatch(
      /const prev = meshcoreTcpSocket;\s*meshcoreTcpSocket = null;\s*clearLiveSessionMeter\('meshcore'\);\s*prev\.destroy\(\)/,
    );

    const disconnectIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshcore:tcp-disconnect'");
    expect(disconnectIdx).toBeGreaterThan(-1);
    const disconnectBody = INDEX_SOURCE.slice(disconnectIdx, disconnectIdx + 500);
    expect(disconnectBody).toMatch(
      /const prev = meshcoreTcpSocket;\s*meshcoreTcpSocket = null;\s*clearLiveSessionMeter\('meshcore'\);\s*prev\.destroy\(\)/,
    );
  });

  it('enables TCP_NODELAY and keepalive on meshcore:tcp-connect sockets', () => {
    expect(INDEX_SOURCE).toContain('MESHCORE_TCP_KEEPALIVE_INITIAL_DELAY_MS');
    const connectIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshcore:tcp-connect'");
    expect(connectIdx).toBeGreaterThan(-1);
    const connectBody = INDEX_SOURCE.slice(connectIdx, connectIdx + 1600);
    expect(connectBody).toContain('socket.setNoDelay(true)');
    expect(connectBody).toContain(
      'socket.setKeepAlive(true, MESHCORE_TCP_KEEPALIVE_INITIAL_DELAY_MS)',
    );
  });

  it('does not null meshcoreTcpSocket in the error handler (error-before-close race)', () => {
    // Node emits 'error' then 'close' on ECONNRESET. If error nulls the ref first, close's
    // active-socket guard fails and meshcore:tcp-disconnected is swallowed (n7eal).
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshcore:tcp-connect'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const errorIdx = INDEX_SOURCE.indexOf("socket.on('error'", handlerIdx);
    expect(errorIdx).toBeGreaterThan(handlerIdx);
    const closeIdx = INDEX_SOURCE.indexOf("socket.on('close'", handlerIdx);
    expect(closeIdx).toBeGreaterThan(handlerIdx);
    expect(errorIdx).toBeGreaterThan(closeIdx);
    const errorBody = INDEX_SOURCE.slice(errorIdx, errorIdx + 500);
    expect(errorBody).not.toMatch(/meshcoreTcpSocket\s*=\s*null/);
    expect(errorBody).toContain('Do not null meshcoreTcpSocket');
  });
});

describe('hostLink:getSessionMeter validation (source contract)', () => {
  it('rejects protocols other than meshtastic/meshcore', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('hostLink:getSessionMeter'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 400);
    expect(handlerBody).toContain("assertIpcSender(event, 'hostLink:getSessionMeter')");
    expect(handlerBody).toContain("protocol !== 'meshtastic'");
    expect(handlerBody).toContain("protocol !== 'meshcore'");
    expect(handlerBody).toContain("throw new Error('Invalid protocol')");
    expect(handlerBody).toContain('snapshotLiveSessionMeter(');
  });
});

// ─── meshtastic:tcp-connect hostname validation ──────────────────────

describe('meshtastic:tcp-connect hostname validation (source contract)', () => {
  it('calls validateHttpHost in the meshtastic:tcp-connect handler', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshtastic:tcp-connect'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 600);
    expect(handlerBody).toContain('validateHttpHost(');
  });

  it('normalizes bracketed IPv6 before net.Socket.connect', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshtastic:tcp-connect'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 1400);
    expect(handlerBody).toContain('formatHostForSocket(');
  });

  it('uses an independent socket ref from meshcore:tcp-connect', () => {
    expect(INDEX_SOURCE).toContain('let meshtasticTcpSocket: net.Socket | null = null;');
  });

  it('destroys the socket on oversized meshtastic:tcp-data chunks without emitting', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('meshtastic:tcp-connect'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const dataIdx = INDEX_SOURCE.indexOf("socket.on('data'", handlerIdx);
    expect(dataIdx).toBeGreaterThan(handlerIdx);
    const dataBody = INDEX_SOURCE.slice(dataIdx, dataIdx + 900);
    expect(dataBody).toContain('MESHTASTIC_TCP_DATA_MAX_BYTES');
    expect(dataBody).toContain('meshtastic:tcp-data oversized chunk');
    expect(dataBody).toContain('socket.destroy()');
    const oversizeIdx = dataBody.indexOf('chunk.length > MESHTASTIC_TCP_DATA_MAX_BYTES');
    const destroyIdx = dataBody.indexOf('socket.destroy()');
    const emitIdx = dataBody.indexOf("mainWindow?.webContents.send('meshtastic:tcp-data'");
    expect(oversizeIdx).toBeGreaterThan(-1);
    expect(destroyIdx).toBeGreaterThan(oversizeIdx);
    expect(emitIdx).toBeGreaterThan(destroyIdx);
    // Oversized branch returns before the emit (emit is only on the success path after return).
    const returnAfterDestroy = dataBody.slice(destroyIdx, emitIdx);
    expect(returnAfterDestroy).toContain('return;');
  });
});

// ─── IPC sender validation (gps / tak) ──────────────────────────────

describe('GPS/TAK IPC sender validation (source contract)', () => {
  const takChannels = [
    'tak:start',
    'tak:stop',
    'tak:getStatus',
    'tak:getConnectedClients',
    'tak:generateDataPackage',
    'tak:regenerateCertificates',
    'tak:pushNodeUpdate',
  ] as const;

  it.each(takChannels)('tak handler %s calls assertIpcSender', (channel) => {
    const handlerIdx = TAK_IPC_SOURCE.indexOf(`ipcMain.handle('${channel}'`);
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = TAK_IPC_SOURCE.slice(handlerIdx, handlerIdx + 400);
    expect(handlerBody).toContain('assertIpcSender(event');
  });

  it('gps:getFix calls assertIpcSender', () => {
    const handlerIdx = GPS_IPC_SOURCE.indexOf("ipcMain.handle('gps:getFix'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = GPS_IPC_SOURCE.slice(handlerIdx, handlerIdx + 300);
    expect(handlerBody).toContain("assertIpcSender(event, 'gps:getFix')");
  });
});

// ─── tak:start settings validation ──────────────────────────────────

describe('tak:start settings validation (source contract)', () => {
  it('defines validateTakSettings before the tak:start handler', () => {
    const validatorIdx = INDEX_SOURCE.indexOf('function validateTakSettings(');
    const handlerIdx = TAK_IPC_SOURCE.indexOf("ipcMain.handle('tak:start'");
    expect(validatorIdx).toBeGreaterThan(-1);
    expect(handlerIdx).toBeGreaterThan(-1);
    expect(INDEX_SOURCE).toContain('registerTakIpcHandlers');
  });

  it('calls validateTakSettings in the tak:start handler', () => {
    const handlerIdx = TAK_IPC_SOURCE.indexOf("ipcMain.handle('tak:start'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = TAK_IPC_SOURCE.slice(handlerIdx, handlerIdx + 400);
    expect(handlerBody).toContain('validateTakSettings(');
  });

  it('validateTakSettings checks port range 1024-65535', () => {
    const fnIdx = INDEX_SOURCE.indexOf('function validateTakSettings(');
    expect(fnIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(fnIdx, fnIdx + 600);
    expect(body).toContain('1024');
    expect(body).toContain('65535');
  });
});

// ─── Navigation / window-open security ──────────────────────────────

describe('MeshCore clear-by-channel validation (source contract)', () => {
  it('allows Rooms channel index -2 in safeMeshcoreChannelIndex', () => {
    const fnIdx = INDEX_SOURCE.indexOf('function safeMeshcoreChannelIndex');
    expect(fnIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(fnIdx, fnIdx + 350);
    expect(body).toContain('n < -2');
    expect(body).not.toContain('n < -1');
    expect(body).toContain('Invalid MeshCore channel index');
  });

  it('db:clearMeshcoreMessagesByChannel uses safeMeshcoreChannelIndex', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('db:clearMeshcoreMessagesByChannel'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 400);
    expect(body).toContain('safeMeshcoreChannelIndex(channelIdx)');
  });
});

describe('privileged IPC sender validation (source contract)', () => {
  const privilegedChannels = [
    'mqtt:connect',
    'mqtt:disconnect',
    'mqtt:publish',
    'mqtt:publishProxy',
    'mqtt:publishMeshcore',
    'mqtt:publishMeshcorePacketLog',
    'storage:encrypt',
    'storage:decrypt',
    'http:write',
    'http:disconnect',
    'meshcore:tcp-connect',
    'meshcore:tcp-write',
    'meshcore:tcp-disconnect',
    'meshtastic:tcp-connect',
    'meshtastic:tcp-write',
    'meshtastic:tcp-disconnect',
    'hostLink:getSessionMeter',
    'noble-ble-connect',
    'noble-ble-disconnect',
    'notify:message',
    'chat:outbox:add',
    'chat:outbox:remove',
    'chat:fetchLinkPreview',
    'chat:readReticulumAttachmentAsDataUrl',
    'appSettings:get',
    'appSettings:set',
    'app:rendererHeartbeat',
    'app:getRendererLiveness',
    'db:saveNode',
    'db:saveNodePath',
    'db:getNodes',
    'db:getMessageChannels',
    'db:getNodeNote',
    'db:getMeshcoreMessages',
    'db:listMeshtasticDmPeers',
    'db:listMeshcoreDmPeers',
    'db:searchMessages',
    'db:searchMeshcoreMessages',
    'db:getMeshcoreContacts',
    'db:getMeshcoreMessageChannels',
    'db:getMeshcoreContactCount',
    'db:getMeshcoreContactById',
    'db:getContactGroups',
    'db:getContactGroupMembers',
    'db:getPositionHistory',
    'db:getMeshcoreHopHistory',
    'db:getAllMeshcoreHopHistory',
    'db:getMeshcoreTraceHistory',
    'db:getAllMeshcorePathHistory',
    'db:getMeshcorePathHistory',
    'log:getPath',
    'log:getRecentLines',
    'mqtt:getCachedNodes',
    'mqtt:getChannelNameToIndex',
    'mqtt:getClientId',
    'storage:isAvailable',
    'support:exportBundle',
  ] as const;

  it.each(privilegedChannels)('%s calls assertIpcSender or validateIpcSender', (channel) => {
    const handlerIdx = INDEX_SOURCE.indexOf(`ipcMain.handle('${channel}'`);
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 400);
    expect(
      handlerBody.includes('assertIpcSender(event') ||
        handlerBody.includes('validateIpcSender(event)'),
    ).toBe(true);
  });

  it('http fromradio poll uses AbortSignal.timeout', () => {
    expect(INDEX_SOURCE).toContain('HTTP_FETCH_TIMEOUT_MS');
    expect(INDEX_SOURCE).toMatch(
      /fromradio\?all=false[\s\S]{0,400}AbortSignal\.timeout\(HTTP_FETCH_TIMEOUT_MS\)/,
    );
  });

  it('meshcore tcp-connect uses connect timeout', () => {
    expect(INDEX_SOURCE).toContain('MESHCORE_TCP_CONNECT_TIMEOUT_MS');
    expect(INDEX_SOURCE).toMatch(
      /meshcore:tcp-connect[\s\S]{0,1800}meshcore:tcp-connect: connection timeout/,
    );
  });

  it('meshtastic tcp-connect uses connect timeout', () => {
    expect(INDEX_SOURCE).toContain('MESHTASTIC_TCP_CONNECT_TIMEOUT_MS');
    expect(INDEX_SOURCE).toMatch(
      /meshtastic:tcp-connect[\s\S]{0,1800}meshtastic:tcp-connect: connection timeout/,
    );
  });

  it('validateMqttSettings rejects invalid broker hostnames', () => {
    const fnIdx = INDEX_SOURCE.indexOf('function validateMqttSettings(');
    expect(fnIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(fnIdx, fnIdx + 500);
    expect(body).toContain('isValidHttpHostname(s.server.trim())');
  });

  it('chat:export caps message array length', () => {
    expect(INDEX_SOURCE).toContain('CHAT_EXPORT_MAX_MESSAGES');
  });

  it('chat:export validates per-message field sizes and total bytes', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('chat:export'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 900);
    expect(body).toContain('assertChatExportMessageSizes(messages)');
    expect(body).toContain('formatChatExportLinesWithTotalCap(messages)');
    expect(body).toContain('exportIpcRateLimit.checkOrThrow()');
  });

  it('expensive export/crypto IPC channels use createIpcRateLimiter', () => {
    expect(INDEX_SOURCE).toContain('createIpcRateLimiter');
    expect(INDEX_SOURCE).toContain('exportIpcRateLimit');
    expect(INDEX_SOURCE).toContain('storageCryptoIpcRateLimit');
    for (const channel of [
      'db:export',
      'db:import',
      'log:export',
      'support:exportBundle',
      'storage:encrypt',
      'storage:decrypt',
    ] as const) {
      const handlerIdx = INDEX_SOURCE.indexOf(`ipcMain.handle('${channel}'`);
      expect(handlerIdx).toBeGreaterThan(-1);
      const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 500);
      expect(body).toMatch(/RateLimit\.checkOrThrow\(\)/);
    }
  });

  it('support:exportBundle validates mode and snapshot size', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('support:exportBundle'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 1200);
    expect(body).toContain('validateIpcSender(event)');
    expect(body).toContain('isSupportBundleMode');
    expect(body).toContain('buildSupportBundleZip');
    expect(SUPPORT_BUNDLE_SOURCE).toContain('MAX_DEBUG_SNAPSHOT_JSON_BYTES');
  });

  it('appSettings allows meshcore repeater credential prefix', () => {
    expect(INDEX_SOURCE).toContain('meshcoreRepeaterCredential:');
    expect(INDEX_SOURCE).toContain('appSettingsMaxValueLengthForKey');
  });

  it('appSettings:get validates IPC sender', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('appSettings:get'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 300);
    expect(body).toContain('validateIpcSender(event)');
  });

  it('app:rendererHeartbeat validates IPC sender', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('app:rendererHeartbeat'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 300);
    expect(body).toContain('validateIpcSender(event)');
  });

  it('app:getRendererLiveness validates IPC sender', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('app:getRendererLiveness'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 400);
    expect(body).toContain('validateIpcSender(event)');
  });
});

// ─── H3: db:* mutator + app:setLoginItem + log:device-connection sender checks ─

describe('db mutator IPC sender validation (source contract, H3)', () => {
  const dbMutatorChannels = [
    'db:setNodeFavorited',
    'db:setNodeNote',
    'db:clearNodePositions',
    'db:clearMessages',
    'db:clearNodes',
    'db:pruneNodesByCount',
    'db:pruneMessagesByCount',
    'db:pruneMeshcoreMessagesByCount',
    'db:prunePositionHistory',
    'db:prunePositionHistoryPerNode',
    'db:deleteMeshcoreContactsNeverAdvertised',
    'db:deleteMeshcoreContactsByAge',
    'db:pruneMeshcoreContactsByCount',
    'db:updateMessageStatus',
    'db:updateMessageReceivedVia',
    'db:updateMessagePacketId',
    'db:export',
    'db:import',
    'db:saveMeshcoreMessage',
    'db:saveMeshcoreContact',
    'db:saveMeshcoreContactsBatch',
    'db:updateMeshcoreContactRfTransport',
    'db:updateMeshcoreContactNickname',
    'db:updateMeshcoreContactFavorited',
    'db:updateMeshcoreContactAdvert',
    'db:updateMeshcoreContactType',
    'db:updateMeshcoreContactLastRf',
    'db:savePositionHistory',
    'db:clearPositionHistory',
    'db:saveMeshcoreHopHistory',
    'db:saveMeshcoreTraceHistory',
    'db:pruneMeshcorePathHistory',
    'db:upsertMeshcorePathHistory',
    'db:recordMeshcorePathOutcome',
    'db:deleteMeshcorePathHistoryForNode',
    'db:deleteAllMeshcorePathHistory',
    'db:markAllMeshcoreContactsOffRadio',
    'db:deleteMeshcoreContactsWithoutPubkey',
    'db:offloadAllMeshcoreContacts',
    'db:createContactGroup',
    'db:updateContactGroup',
    'db:deleteContactGroup',
    'db:addContactToGroup',
    'db:removeContactFromGroup',
    'db:updateMeshcoreMessageSender',
    'db:updateMeshcoreMessageStatus',
    'db:updateMeshcoreMessageStatusByKey',
    'db:migrateRfStubNodes',
    'db:deleteMeshcoreContact',
  ] as const;

  it.each(dbMutatorChannels)('%s calls validateIpcSender', (channel) => {
    const handlerIdx = INDEX_SOURCE.indexOf(`ipcMain.handle('${channel}'`);
    if (handlerIdx === -1) {
      const multilineIdx = INDEX_SOURCE.indexOf(`ipcMain.handle(\n  '${channel}'`);
      expect(multilineIdx).toBeGreaterThan(-1);
      const handlerBody = INDEX_SOURCE.slice(multilineIdx, multilineIdx + 400);
      expect(handlerBody).toContain('validateIpcSender(event)');
      return;
    }
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 300);
    expect(handlerBody).toContain('validateIpcSender(event)');
  });

  const dbReadChannels = [
    'db:getNodeNote',
    'db:getMeshcoreMessages',
    'db:listMeshtasticDmPeers',
    'db:listMeshcoreDmPeers',
    'db:searchMessages',
    'db:searchMeshcoreMessages',
    'db:getMeshcoreContacts',
    'db:getMeshcoreMessageChannels',
    'db:getMeshcoreContactCount',
    'db:getMeshcoreContactById',
    'db:getContactGroups',
    'db:getContactGroupMembers',
    'db:getPositionHistory',
    'db:getMeshcoreHopHistory',
    'db:getAllMeshcoreHopHistory',
    'db:getMeshcoreTraceHistory',
    'db:getAllMeshcorePathHistory',
    'db:getMeshcorePathHistory',
    'db:getNodes',
    'db:getMessageChannels',
  ] as const;

  it.each(dbReadChannels)('%s calls assertIpcSender', (channel) => {
    const handlerIdx = INDEX_SOURCE.indexOf(`ipcMain.handle('${channel}'`);
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 400);
    expect(handlerBody).toContain(`assertIpcSender(event, '${channel}')`);
  });

  it.each([
    ['app:setLoginItem', "assertIpcSender(event, 'app:setLoginItem')"],
    ['app:getLoginItem', "assertIpcSender(event, 'app:getLoginItem')"],
    ['log:device-connection', 'validateIpcSender(event)'],
  ] as const)('%s validates the IPC sender', (channel, expectedCheck) => {
    const handlerIdx = INDEX_SOURCE.indexOf(`ipcMain.handle('${channel}'`);
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 300);
    expect(body).toContain(expectedCheck);
  });

  it('regression: no db:* handler is missing a sender check', () => {
    // Any db:* handler must call assertIpcSender or validateIpcSender within the
    // first 400 chars of its body (reads and mutators alike).
    const re = /ipcMain\.handle\(\s*\n?\s*'(db:[a-zA-Z]+)'/g;
    const missing: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(INDEX_SOURCE))) {
      const channel = m[1];
      const body = INDEX_SOURCE.slice(m.index, m.index + 400);
      const hasCheck =
        body.includes('assertIpcSender(event') || body.includes('validateIpcSender(event)');
      if (!hasCheck) missing.push(channel);
    }
    expect(missing).toEqual([]);
  });
});

// ─── H2: MQTT mutator IPC sender validation + token hardening ───────

describe('MQTT mutator IPC sender validation (source contract, H2)', () => {
  const mqttMutatorChannels = [
    'mqtt:powerResume',
    'mqtt:powerSuspend',
    'mqtt:refreshMeshcoreToken',
    'mqtt:updateMeshcoreToken',
    'mqtt:updateChannelKeys',
    'mqtt:updateTopicPrefix',
    'mqtt:publishNodeInfo',
    'mqtt:publishPosition',
    'mqtt:publishWaypoint',
  ] as const;

  it.each(mqttMutatorChannels)('%s calls assertIpcSender', (channel) => {
    const handlerIdx = INDEX_SOURCE.indexOf(`ipcMain.handle('${channel}'`);
    if (handlerIdx === -1) {
      // mqtt:updateMeshcoreToken's ipcMain.handle( call wraps the channel name onto its own
      // line — fall back to the multiline shape.
      const multilineIdx = INDEX_SOURCE.indexOf(`ipcMain.handle(\n  '${channel}'`);
      expect(multilineIdx).toBeGreaterThan(-1);
      const handlerBody = INDEX_SOURCE.slice(multilineIdx, multilineIdx + 400);
      expect(handlerBody).toContain(`assertIpcSender(event, '${channel}')`);
      return;
    }
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 300);
    expect(handlerBody).toContain(`assertIpcSender(event, '${channel}')`);
  });

  it('mqtt:updateMeshcoreToken validates token is a non-empty, length-capped string', () => {
    const idx = INDEX_SOURCE.indexOf("'mqtt:updateMeshcoreToken'");
    expect(idx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(idx, idx + 700);
    expect(INDEX_SOURCE).toContain('const MQTT_MESHCORE_TOKEN_MAX_LENGTH = 8192;');
    expect(body).toContain("typeof token !== 'string' || token.length === 0");
    expect(body).toContain('token.length > MQTT_MESHCORE_TOKEN_MAX_LENGTH');
  });

  it('mqtt:updateMeshcoreToken validates expiresAt is a finite number', () => {
    const idx = INDEX_SOURCE.indexOf("'mqtt:updateMeshcoreToken'");
    expect(idx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(idx, idx + 700);
    expect(body).toContain("typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)");
  });
});

// ─── H5: Meshtastic HTTP fromradio response size cap ────────────────

describe('HTTP fromradio response size cap (source contract, H5)', () => {
  it('defines a 1 MB response cap', () => {
    expect(INDEX_SOURCE).toContain('const HTTP_FROMRADIO_MAX_RESPONSE_BYTES = 1 * 1024 * 1024;');
  });

  it('readBoundedArrayBuffer throws ResponseSizeCapExceededError when the cap is exceeded', () => {
    expect(INDEX_SOURCE).toContain('class ResponseSizeCapExceededError extends Error {}');
    const fnIdx = INDEX_SOURCE.indexOf('async function readBoundedArrayBuffer(');
    expect(fnIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(fnIdx, fnIdx + 1200);
    expect(body).toContain('throw new ResponseSizeCapExceededError(');
  });

  it('http:connect fromradio poll uses readBoundedArrayBuffer with the cap', () => {
    expect(INDEX_SOURCE).toMatch(
      /fromradio\?all=false[\s\S]{0,400}readBoundedArrayBuffer\(response, HTTP_FROMRADIO_MAX_RESPONSE_BYTES\)/,
    );
  });

  it('disconnects httpDevice on oversized fromradio response but keeps retrying transient errors', () => {
    const idx = INDEX_SOURCE.indexOf(
      'readBoundedArrayBuffer(response, HTTP_FROMRADIO_MAX_RESPONSE_BYTES)',
    );
    expect(idx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(idx, idx + 1000);
    expect(body).toContain('if (err instanceof ResponseSizeCapExceededError)');
    expect(body).toContain('httpDevice = null');
  });
});

// ─── H6: Reticulum sidecar proxy/WS response caps ────────────────────

describe('Reticulum sidecar proxy/WS caps (source contract, H6)', () => {
  it('defines proxy response and WS message byte caps in shared limits', () => {
    const limitsSource = readFileSync(
      join(__dirname, '../shared/reticulumProxyLimits.ts'),
      'utf-8',
    );
    expect(limitsSource).toContain(
      'export const RETICULUM_PROXY_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;',
    );
    expect(limitsSource).toContain(
      'export const RETICULUM_WS_MAX_MESSAGE_BYTES = 2 * 1024 * 1024;',
    );
  });

  it('reticulum-sidecar-manager imports and applies both caps', () => {
    const sidecarSource = readFileSync(join(__dirname, 'reticulum-sidecar-manager.ts'), 'utf-8');
    expect(sidecarSource).toContain('RETICULUM_PROXY_MAX_RESPONSE_BYTES');
    expect(sidecarSource).toContain('RETICULUM_WS_MAX_MESSAGE_BYTES');
    expect(sidecarSource).toContain('maxPayload: RETICULUM_WS_MAX_MESSAGE_BYTES');
  });
});

// ─── H9: log injection hardening (MQTT topic / from-node handler tag) ─

describe('MQTT log injection hardening (source contract, H9)', () => {
  it('mqtt-manager sanitizes topic before interpolating into unknown-format debug log', () => {
    const mqttManagerSource = readFileSync(join(__dirname, 'mqtt-manager.ts'), 'utf-8');
    expect(mqttManagerSource).toMatch(
      /Unknown message format, firstByte=0x\$\{bytes\[0\]\.toString\(16\)\} topic=\$\{sanitizeLogMessage\(topic\)\}/,
    );
  });

  it('parseFromNodeId sanitizes the handler tag (which embeds the MQTT topic) before logging', () => {
    const mqttManagerSource = readFileSync(join(__dirname, 'mqtt-manager.ts'), 'utf-8');
    const fnIdx = mqttManagerSource.indexOf('private parseFromNodeId(');
    expect(fnIdx).toBeGreaterThan(-1);
    const body = mqttManagerSource.slice(fnIdx, fnIdx + 400);
    expect(body).toContain('const safeHandler = sanitizeLogMessage(handler);');
    // Every JSON debug log inside parseFromNodeId must use the sanitized copy, not raw `handler`.
    const wholeFn = mqttManagerSource.slice(fnIdx, fnIdx + 1600);
    expect(wholeFn).not.toMatch(/console\.debug\(`\[Meshtastic MQTT\] JSON \$\{handler\}/);
  });
});

describe('navigation security (source contract)', () => {
  it('blocks non-http(s) schemes in parseHttpOrHttpsUrl', () => {
    expect(INDEX_SOURCE).toContain('function parseHttpOrHttpsUrl');
    const fnIdx = INDEX_SOURCE.indexOf('function parseHttpOrHttpsUrl');
    const body = INDEX_SOURCE.slice(fnIdx, fnIdx + 300);
    expect(body).toContain("protocol === 'http:'");
    expect(body).toContain("protocol === 'https:'");
    expect(body).toContain('return null');
  });

  it('uses setWindowOpenHandler to gate all window.open calls', () => {
    expect(INDEX_SOURCE).toContain('setWindowOpenHandler');
    const anchor = 'openExternalHttpOrHttpsIfExternal(currentUrl, url)';
    const anchorIdx = INDEX_SOURCE.indexOf(anchor);
    expect(anchorIdx).toBeGreaterThanOrEqual(0);
    const idx = INDEX_SOURCE.lastIndexOf('setWindowOpenHandler', anchorIdx);
    expect(idx).toBeGreaterThanOrEqual(0);
    const body = INDEX_SOURCE.slice(idx, idx + 250);
    expect(body).toContain("{ action: 'deny' }");
  });
});
