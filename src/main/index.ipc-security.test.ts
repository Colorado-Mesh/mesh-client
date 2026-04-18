// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const INDEX_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8');

// ─── http:preflight / http:connect hostname validation ──────────────

describe('validateHttpHost (source contract)', () => {
  it('defines VALID_HOSTNAME_RE with a regex that rejects leading-hyphen labels', () => {
    expect(INDEX_SOURCE).toContain('const VALID_HOSTNAME_RE =');
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

  it('rejects whitespace in hostnames via VALID_HOSTNAME_RE', () => {
    // Extract the regex literal from source and evaluate it to run unit tests
    const matches = [...INDEX_SOURCE.matchAll(/const VALID_HOSTNAME_RE =\s*(\/[^\n]+\/)/g)];
    expect(matches).toHaveLength(1);
    const regexStr = matches[0][1];
    // Build the actual RegExp from the source literal
    const flags = regexStr.slice(regexStr.lastIndexOf('/') + 1);
    const pattern = regexStr.slice(1, regexStr.lastIndexOf('/'));
    const re = new RegExp(pattern, flags);

    // Valid cases
    expect(re.test('example.com')).toBe(true);
    expect(re.test('my-router.local')).toBe(true);
    expect(re.test('192.168.1.1')).toBe(true);
    expect(re.test('a')).toBe(true);
    expect(re.test('sub.domain.example.org')).toBe(true);

    // Invalid cases
    expect(re.test('host with spaces')).toBe(false);
    expect(re.test('-leading-hyphen.com')).toBe(false);
    expect(re.test('trailing-hyphen-.com')).toBe(false);
    expect(re.test('')).toBe(false);
    expect(re.test('has..double.dot')).toBe(false);
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
  it('validates MAC address format with a regex', () => {
    // The MAC_ADDRESS_REGEX constant must exist
    expect(INDEX_SOURCE).toContain(
      'const MAC_ADDRESS_REGEX = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/',
    );
  });

  it('applies MAC_ADDRESS_REGEX in bluetooth-pair handler', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('bluetooth-pair'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 600);
    expect(body).toContain('MAC_ADDRESS_REGEX.test(');
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
  it('grants only serial and geolocation via setPermissionCheckHandler', () => {
    // Search for the actual session method call, not a comment mention of the name
    const checkIdx = INDEX_SOURCE.indexOf('.setPermissionCheckHandler(');
    expect(checkIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(checkIdx, checkIdx + 300);
    // Ensure the allowlist is exactly serial + geolocation, not a wildcard
    expect(body).toContain("permission === 'serial'");
    expect(body).toContain("permission === 'geolocation'");
    expect(body).not.toContain('return true'); // Must be conditional, not blanket true
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
    // It should now delegate entirely to validateHttpHost which applies VALID_HOSTNAME_RE
    expect(INDEX_SOURCE).not.toContain('MAX_TCP_HOST_LENGTH');
  });
});

// ─── tak:start settings validation ──────────────────────────────────

describe('tak:start settings validation (source contract)', () => {
  it('defines validateTakSettings before the tak:start handler', () => {
    const validatorIdx = INDEX_SOURCE.indexOf('function validateTakSettings(');
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('tak:start'");
    expect(validatorIdx).toBeGreaterThan(-1);
    expect(handlerIdx).toBeGreaterThan(-1);
    expect(validatorIdx).toBeLessThan(handlerIdx);
  });

  it('calls validateTakSettings in the tak:start handler', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("ipcMain.handle('tak:start'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 400);
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
    const idx = INDEX_SOURCE.indexOf('setWindowOpenHandler');
    const body = INDEX_SOURCE.slice(idx, idx + 200);
    expect(body).toContain("{ action: 'deny' }");
  });
});
