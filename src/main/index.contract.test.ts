// @vitest-environment node
import { readdirSync, readFileSync } from 'fs';
import { dirname, join, normalize } from 'path';
import { describe, expect, it } from 'vitest';

const INDEX_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8');
const PRELOAD_SOURCE = readFileSync(join(__dirname, '../preload/index.ts'), 'utf-8');
const TCP_BRIDGE_SOURCE = readFileSync(join(__dirname, 'ipc/tcp-bridge.ts'), 'utf-8');

describe('notification audio metadata CSP', () => {
  it('permits local blob metadata probes without allowing remote media', () => {
    const html = readFileSync(join(__dirname, '../renderer/index.html'), 'utf-8');
    expect(/media-src\s+([^;]+)/.exec(html)?.[1]).toBe("'self' blob:");
  });
});

describe('IPC payload size limits (source contract)', () => {
  it('defines meshcore tcp-write, http:write, and gatt to-radio limits and uses them in handlers', () => {
    expect(TCP_BRIDGE_SOURCE).toContain('export const TCP_BRIDGE_WRITE_MAX_BYTES = 256 * 1024');
    expect(TCP_BRIDGE_SOURCE).toContain('TCP_BRIDGE_DATA_MAX_BYTES');
    expect(INDEX_SOURCE).toContain('const HTTP_WRITE_TO_RADIO_MAX_BYTES = 256 * 1024');
    expect(INDEX_SOURCE).toContain('const GATT_TO_RADIO_MAX_BYTES = 512');
    expect(INDEX_SOURCE).toMatch(/GATT_TO_RADIO_MAX_BYTES/);
    expect(TCP_BRIDGE_SOURCE).toMatch(/bytes\.length > TCP_BRIDGE_WRITE_MAX_BYTES/);
    expect(INDEX_SOURCE).toMatch(/data\.length > HTTP_WRITE_TO_RADIO_MAX_BYTES/);
    expect(INDEX_SOURCE).toMatch(/http:write: byte values must be integers 0-255/);
  });
});

describe('GATT BLE disconnect handling (source contract)', () => {
  it('routes gatt:to-radio through the tested disconnect-race handler', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('gatt:to-radio'");
    expect(INDEX_SOURCE).toContain('await writeGattToRadio(gattSidecarProxy, sessionId, buf)');
  });

  it('registers Windows in-app pairing IPC serialized with GATT scans', () => {
    expect(INDEX_SOURCE).toMatch(
      /registerGattPairingIpcHandlers\(\{[\s\S]{0,200}bleCoexistenceCoordinator\.withScan\('gatt', operation\)/,
    );
  });

  it('latches isQuitting before async GATT teardown on before-quit', () => {
    expect(INDEX_SOURCE).toMatch(
      /app\.on\('before-quit'[\s\S]{0,800}isQuitting = true;[\s\S]{0,200}event\.preventDefault\(\)/,
    );
  });

  it('resolves meshtastic:tcp-write with no-socket instead of rejecting when the socket is gone', () => {
    expect(TCP_BRIDGE_SOURCE).toContain("writeMissing: 'no-socket'");
    expect(TCP_BRIDGE_SOURCE).toContain("writeMissing: 'reject'");
    expect(TCP_BRIDGE_SOURCE).toMatch(
      /writeMissing === 'no-socket'[\s\S]{0,200}console\.debug\(`\[IPC\] \$\{writeChannel\}: no active socket`\)[\s\S]{0,80}return 'no-socket'/,
    );
    expect(TCP_BRIDGE_SOURCE).toContain('meshtasticTcpWriteErrorIsNoSocket');
    expect(TCP_BRIDGE_SOURCE).toMatch(/sock\.destroyed \|\| sock\.writableEnded/);
    expect(PRELOAD_SOURCE).toMatch(/result === 'no-socket'/);
    expect(PRELOAD_SOURCE).toMatch(/throw new Error\('meshtastic:tcp-write: no active socket'\)/);
  });

  it('returns scan_busy from gattSidecarProxy.startScan without throwing', () => {
    expect(INDEX_SOURCE).toContain('gattSidecarProxy.startScan');
    const start = INDEX_SOURCE.indexOf("ipcMain.handle('gatt:start-scan'");
    const end = INDEX_SOURCE.indexOf("ipcMain.handle('gatt:stop-scan'");
    const handler = INDEX_SOURCE.slice(start, end);
    expect(handler).toContain("bleCoexistenceCoordinator.withScan('gatt'");
    expect(handler).toContain('gattSidecarProxy.startScan(sessionId)');
    expect(handler).toContain("code: 'scan_busy'");
  });

  it('returns scan_busy from bleCoexistence:acquireScan without throwing', () => {
    const start = INDEX_SOURCE.indexOf("ipcMain.handle('bleCoexistence:acquireScan'");
    const end = INDEX_SOURCE.indexOf("ipcMain.handle('bleCoexistence:releaseScan'");
    const handler = INDEX_SOURCE.slice(start, end);
    expect(handler).toContain('BleScanBusyError');
    expect(handler).toContain("code: 'scan_busy'");
    expect(handler).toContain('ok: false as const');
    expect(handler).toMatch(/console\.debug\([\s\S]*bleCoexistence:acquireScan busy/);
  });

  it('invalidates GATT proxy port when shared sidecar process exits', () => {
    expect(INDEX_SOURCE).toContain('gattSidecarProxy.invalidateAfterSidecarExit()');
    expect(INDEX_SOURCE).toMatch(
      /mgr\.on\('status'[\s\S]{0,200}!\(status\.processRunning \?\? status\.running\)[\s\S]{0,120}invalidateAfterSidecarExit/,
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

const RENDERER_ROOT = join(__dirname, '../renderer');
const SRC_ROOT = join(__dirname, '..');

function listRendererSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listRendererSources(full));
      continue;
    }
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      continue;
    }
    out.push(normalize(full));
  }
  return out;
}

function readBalanced(
  source: string,
  openIndex: number,
  open: string,
  close: string,
): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIndex; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return null;
}

function readFirstArg(source: string, start: number): string {
  let i = start;
  while (i < source.length && /\s/.test(source[i] ?? '')) i += 1;
  const begin = i;
  let depth = 0;
  let quote: string | null = null;
  for (; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return source.slice(begin, i).trim();
      depth -= 1;
    } else if (c === ',' && depth === 0) {
      return source.slice(begin, i).trim();
    }
  }
  return source.slice(begin).trim();
}

function appSettingsSetArgExprs(source: string): string[] {
  const args: string[] = [];
  const re = /electronAPI\.appSettings\s*\.set\s*\(/g;
  for (const match of source.matchAll(re)) {
    const arg = readFirstArg(source, (match.index ?? 0) + match[0].length);
    if (arg) args.push(arg);
  }
  return args;
}

function isIdentChar(ch: string): boolean {
  return (
    (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '_'
  );
}

function isIdent(value: string): boolean {
  if (value.length === 0) return false;
  for (const ch of value) {
    if (!isIdentChar(ch)) return false;
  }
  return true;
}

/** Index just after `=` for `const`/`let name =`, skipping identifier prefixes. */
function constAssignmentValueStarts(source: string, name: string): number[] {
  const starts: number[] = [];
  for (const keyword of ['const', 'let']) {
    const needle = `${keyword} ${name}`;
    let from = 0;
    while (from < source.length) {
      const at = source.indexOf(needle, from);
      if (at < 0) break;
      const before = at === 0 ? '' : (source[at - 1] ?? '');
      if (before && isIdentChar(before)) {
        from = at + needle.length;
        continue;
      }
      let i = at + needle.length;
      if (isIdentChar(source[i] ?? '')) {
        from = at + needle.length;
        continue;
      }
      while (i < source.length && /\s/.test(source[i] ?? '')) i += 1;
      if (source[i] !== '=') {
        from = at + needle.length;
        continue;
      }
      i += 1;
      while (i < source.length && /\s/.test(source[i] ?? '')) i += 1;
      starts.push(i);
      from = i;
    }
  }
  return starts;
}

function readQuoted(source: string, start: number): string | null {
  const quote = source[start];
  if (quote !== "'" && quote !== '"') return null;
  const end = source.indexOf(quote, start + 1);
  if (end < 0) return null;
  return source.slice(start + 1, end);
}

function stringConstValue(source: string, name: string): string | null {
  for (const start of constAssignmentValueStarts(source, name)) {
    const value = readQuoted(source, start);
    if (value != null) return value;
  }
  return null;
}

function objectConstValues(source: string, name: string): Record<string, string> | null {
  for (const start of constAssignmentValueStarts(source, name)) {
    if (source[start] !== '{') continue;
    const body = readBalanced(source, start, '{', '}');
    if (body == null) return null;
    const values: Record<string, string> = {};
    for (const prop of body.matchAll(/([A-Za-z0-9_]+)\s*:\s*(['"])([^'"\\]*)\2/g)) {
      const key = prop[1];
      const value = prop[3];
      if (key && value != null) values[key] = value;
    }
    return values;
  }
  return null;
}

function importedValueBindings(source: string): Map<string, { from: string; exported: string }> {
  const bindings = new Map<string, { from: string; exported: string }>();
  for (const match of source.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    const specifiers = match[1];
    const from = match[2];
    if (!specifiers || !from) continue;
    for (const part of specifiers.split(',')) {
      const piece = part.trim();
      if (!piece || piece.startsWith('type ')) continue;
      const parts = piece.split(/\s+/).filter(Boolean);
      const exported = parts[0];
      const local = parts.length === 3 && parts[1] === 'as' ? parts[2] : exported;
      if (!exported || !local || !isIdent(exported) || !isIdent(local)) continue;
      if (parts.length !== 1 && !(parts.length === 3 && parts[1] === 'as')) continue;
      bindings.set(local, { from, exported });
    }
  }
  return bindings;
}

function localInitializers(source: string, name: string): string[] {
  const out: string[] = [];
  for (const start of constAssignmentValueStarts(source, name)) {
    let stop = source.length;
    const semi = source.indexOf(';', start);
    const nl = source.indexOf('\n', start);
    if (semi >= 0) stop = Math.min(stop, semi);
    if (nl >= 0) stop = Math.min(stop, nl);
    const init = source.slice(start, stop).trim();
    if (init) out.push(init);
  }
  return out;
}

function resolveModule(
  fromFile: string,
  spec: string,
  sources: ReadonlyMap<string, string>,
): string | null {
  const base = spec.startsWith('@/')
    ? join(SRC_ROOT, spec.slice(2))
    : spec.startsWith('.')
      ? join(dirname(fromFile), spec)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    const normalized = normalize(candidate);
    if (sources.has(normalized)) return normalized;
  }
  return null;
}

function lookupStringConst(
  name: string,
  source: string,
  file: string,
  sources: ReadonlyMap<string, string>,
): string | null {
  const local = stringConstValue(source, name);
  if (local != null) return local;
  const imported = importedValueBindings(source).get(name);
  if (!imported) return null;
  const otherPath = resolveModule(file, imported.from, sources);
  const other = otherPath ? sources.get(otherPath) : undefined;
  return other ? stringConstValue(other, imported.exported) : null;
}

function lookupObjectConst(
  name: string,
  source: string,
  file: string,
  sources: ReadonlyMap<string, string>,
): Record<string, string> | null {
  const local = objectConstValues(source, name);
  if (local && Object.keys(local).length > 0) return local;
  const imported = importedValueBindings(source).get(name);
  if (!imported) return null;
  const otherPath = resolveModule(file, imported.from, sources);
  const other = otherPath ? sources.get(otherPath) : undefined;
  return other ? objectConstValues(other, imported.exported) : null;
}

function resolveAppSettingsKeyExpr(
  expr: string,
  source: string,
  file: string,
  sources: ReadonlyMap<string, string>,
  depth = 0,
): string[] {
  if (depth > 6) return [];
  const trimmed = expr.trim().replace(/;$/, '');
  const literal = /^(['"])([^'"\\]*)\1$/.exec(trimmed);
  if (literal?.[2] != null) return [literal[2]];

  const member = /^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/.exec(trimmed);
  if (member?.[1] && member[2]) {
    const value = lookupObjectConst(member[1], source, file, sources)?.[member[2]];
    return value != null ? [value] : [];
  }

  const indexed = /^([A-Za-z0-9_]+)\[(.+)\]$/.exec(trimmed);
  if (indexed?.[1]) {
    const values = lookupObjectConst(indexed[1], source, file, sources);
    if (!values) return [];
    const indexLiteral = /^(['"])([^'"\\]*)\1$/.exec(indexed[2]?.trim() ?? '');
    if (indexLiteral?.[2] != null) {
      const value = values[indexLiteral[2]];
      return value != null ? [value] : [];
    }
    return Object.values(values);
  }

  if (!/^[A-Za-z0-9_]+$/.test(trimmed)) return [];
  const direct = lookupStringConst(trimmed, source, file, sources);
  if (direct != null) return [direct];
  const resolved = localInitializers(source, trimmed).flatMap((init) =>
    init === trimmed ? [] : resolveAppSettingsKeyExpr(init, source, file, sources, depth + 1),
  );
  return [...new Set(resolved)];
}

/** String-literal keys the renderer passes to `electronAPI.appSettings.set`. */
function collectRendererAppSettingsSetKeys(): string[] {
  const files = listRendererSources(RENDERER_ROOT);
  const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf-8')]));
  const keys = new Set<string>();
  for (const [file, source] of sources) {
    for (const arg of appSettingsSetArgExprs(source)) {
      for (const key of resolveAppSettingsKeyExpr(arg, source, file, sources)) {
        if (key) keys.add(key);
      }
    }
  }
  return [...keys].sort();
}

describe('Persistent app settings IPC (source contract)', () => {
  it('registers appSettings:get and appSettings:set with allow-listed keys', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('appSettings:get'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('appSettings:set'");
    expect(INDEX_SOURCE).toContain('APP_SETTINGS_ALLOWED_KEYS');
    expect(INDEX_SOURCE).toMatch(/key not allowed/);
    expect(INDEX_SOURCE).toContain("'meshtasticLastRfSelfNodeId'");
    expect(INDEX_SOURCE).toContain("'meshcoreLastSelfNodeId'");
    // Missing allowlist entries fail silently, so pin the Reticulum keys explicitly.
    expect(INDEX_SOURCE).toContain("'reticulumAutostart'");
    expect(INDEX_SOURCE).toContain("'reticulumAutoResendOnAnnounce'");
    expect(INDEX_SOURCE).toContain("'reticulumLastSelfLxmfHash'");
    expect(INDEX_SOURCE).toContain("'use24HourTime'");
    expect(INDEX_SOURCE).toContain('MESHTASTIC_REMOTE_ADMIN_KEY_SETTING_PREFIX');
    expect(INDEX_SOURCE).toContain('MESHCORE_ROOM_SYNC_SETTING_PREFIX');
    expect(INDEX_SOURCE).toContain('MESHCORE_ROOM_LAST_POST_SETTING_PREFIX');
    expect(INDEX_SOURCE).toContain('MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX');
    expect(INDEX_SOURCE).toContain('MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX');
    expect(INDEX_SOURCE).toContain('isAppSettingsKeyAllowed');
  });

  it('allowlists every renderer key persisted via appSettings:set', () => {
    const allowListStart = INDEX_SOURCE.indexOf('const APP_SETTINGS_ALLOWED_KEYS');
    const allowListEnd = INDEX_SOURCE.indexOf('const APP_SETTINGS_MAX_VALUE_LENGTH');
    expect(allowListStart).toBeGreaterThanOrEqual(0);
    expect(allowListEnd).toBeGreaterThan(allowListStart);
    const allowListBlock = INDEX_SOURCE.slice(allowListStart, allowListEnd);
    const rmapSource = readFileSync(
      join(__dirname, '../renderer/lib/reticulum/reticulumRmapDiscovery.ts'),
      'utf-8',
    );
    const rmapKeysBlock = /export const RMAP_SETTINGS_KEYS = \{([\s\S]*?)\}/.exec(rmapSource)?.[1];
    const rmapKeys = [...(rmapKeysBlock ?? '').matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(rmapKeys.length).toBeGreaterThanOrEqual(7);

    const identitySource = readFileSync(
      join(__dirname, '../renderer/lib/meshtasticMqttIdentity.ts'),
      'utf-8',
    );
    const ownNodeKey = /MESHTASTIC_OWN_NODE_NUMS_BY_PUBLIC_KEY_KEY = '([^']+)'/.exec(
      identitySource,
    )?.[1];
    expect(ownNodeKey).toBeDefined();

    for (const key of [...rmapKeys, ownNodeKey]) {
      expect(allowListBlock).toContain(`'${key}'`);
    }

    const prefixSource = readFileSync(
      join(__dirname, '../shared/appSettingsKeyPrefixes.ts'),
      'utf-8',
    );
    const prefixes = [...prefixSource.matchAll(/export const ([A-Z0-9_]+) = '([^']+)'/g)].flatMap(
      (match) => {
        const name = match[1];
        const value = match[2];
        if (!name || !value || !INDEX_SOURCE.includes(`key.startsWith(${name})`)) return [];
        return [value];
      },
    );
    const rendererKeys = collectRendererAppSettingsSetKeys();
    expect(rendererKeys).toEqual(
      expect.arrayContaining([
        'storeForwardHistoryProfile',
        'locale',
        'mapBasemapId',
        'notificationSounds',
        'reduceMotion',
        'use24HourTime',
        'storeForwardAutoFetchHistory',
        'reticulumAutostart',
        'reticulumAutoResendOnAnnounce',
        'meshtasticConfigureTargetNodeNum',
        'meshtasticLastRfSelfNodeId',
        'meshtasticOwnNodeNumsByPublicKey',
        'meshcoreLastSelfNodeId',
        'reticulumLastSelfLxmfHash',
        'meshtasticMessageRetentionEnabled',
        'rrcMessageRetentionCount',
        'reticulumRmapPublishIfac',
      ]),
    );
    const missing = rendererKeys.filter(
      (key) =>
        !allowListBlock.includes(`'${key}'`) &&
        !prefixes.some((prefix) => key.startsWith(prefix) && key.length > prefix.length),
    );
    expect(missing).toEqual([]);
  });

  it('gives own-node public key history a JSON-sized value limit', () => {
    expect(INDEX_SOURCE).toMatch(/key === 'meshtasticOwnNodeNumsByPublicKey'\) return 4096/);
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
    expect(RETICULUM_HANDLERS_SOURCE).toContain(
      "'reticulum:clearBleBondIssuesForOnlineInterfaces'",
    );
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
    expect(RETICULUM_HANDLERS_SOURCE).toContain("'reticulum:saveBlocklistDialog'");
    expect(RETICULUM_HANDLERS_SOURCE).toContain("'reticulum:openBlocklistDialog'");
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
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain("'db:blockContact'");
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain("'db:unblockContact'");
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain("'db:exportBlockedContacts'");
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain("'db:importBlockedContacts'");
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain("'db:getReticulumIdentityActivity'");
    expect(RETICULUM_DB_HANDLERS_SOURCE).toContain("'db:getReticulumIdentityActivityByIdentity'");
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
  it('forwards GATT link RSSI and registers HTTP/TCP RTT probes', () => {
    expect(INDEX_SOURCE).toContain("webContents.send('gatt-link-rssi'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('hostLink:probeHttpRtt'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('hostLink:probeTcpRtt'");
    expect(INDEX_SOURCE).toContain("ipcMain.handle('hostLink:getSessionMeter'");
  });

  it('wires live-session meters on both Meshtastic and MeshCore TCP bridges', () => {
    expect(TCP_BRIDGE_SOURCE).toContain('resetLiveSessionMeter(protocol)');
    expect(TCP_BRIDGE_SOURCE).toContain('noteLiveSessionWrite(protocol)');
    expect(TCP_BRIDGE_SOURCE).toContain('noteLiveSessionData(protocol)');
    expect(TCP_BRIDGE_SOURCE).toContain('clearLiveSessionMeter(protocol)');
    // Accounting must ignore superseded sockets (same active-ref guard as #792 disconnect IPC).
    expect(TCP_BRIDGE_SOURCE).toMatch(
      /if \(activeSocket === socket\) \{\s*noteLiveSessionData\(protocol\)/,
    );
    expect(TCP_BRIDGE_SOURCE).toMatch(
      /if \(activeSocket === sock\) \{\s*noteLiveSessionWrite\(protocol\)/,
    );
    expect(INDEX_SOURCE).toContain('registerTcpBridgeIpcHandlers({');
    expect(INDEX_SOURCE).toContain('destroyRegisteredTcpBridgeSockets(');
  });
});

describe('Host link quality preload surface (source contract)', () => {
  it('exposes onGattLinkRssi and hostLink probe APIs', () => {
    expect(PRELOAD_SOURCE).toContain('onGattLinkRssi:');
    expect(PRELOAD_SOURCE).toContain("ipcRenderer.on('gatt-link-rssi'");
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

  it('registers mesh-tiles as a privileged scheme before ready and handles it', () => {
    expect(INDEX_SOURCE).toContain("scheme: 'mesh-tiles'");
    expect(INDEX_SOURCE).toContain('protocol.registerSchemesAsPrivileged');
    expect(INDEX_SOURCE).toContain("protocol.handle(\n      'mesh-tiles'");
    expect(INDEX_SOURCE).toContain('createMeshTilesProtocolHandler');
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

  it('registers app:relaunch via shared quitMainProcess', () => {
    expect(INDEX_SOURCE).toContain("ipcMain.handle('app:relaunch'");
    expect(INDEX_SOURCE).toContain("assertIpcSender(event, 'app:relaunch')");
    expect(INDEX_SOURCE).toContain('async function quitMainProcess');
    expect(INDEX_SOURCE).toContain('quitMainProcess({ relaunch: true })');
    expect(INDEX_SOURCE).toContain('quitMainProcess({ relaunch: false })');
    expect(INDEX_SOURCE).toMatch(/if \(opts\.relaunch\) \{\s*app\.relaunch\(\);/);
    expect(INDEX_SOURCE).toContain('app.exit(0)');
  });
});

describe('Unread app badge wiring (source contract)', () => {
  it('initializes native notification support without displaying a notification', () => {
    const start = INDEX_SOURCE.indexOf('function refreshUnreadAppBadge(): void');
    const end = INDEX_SOURCE.indexOf("ipcMain.on('set-tray-unread'", start);
    const refresh = INDEX_SOURCE.slice(start, end);
    expect(refresh).toContain('Notification.isSupported()');
    expect(refresh).not.toContain('new Notification');
    expect(refresh).not.toContain('.show()');
    expect(refresh).toContain('suppressDockBadge: () => false');
    expect(refresh).toContain('mainWindow.isDestroyed()');
  });

  it('reapplies the latest unread count on focus and before best-effort tray updates', () => {
    expect(INDEX_SOURCE).toMatch(/win\.on\('focus', \(\) => \{[^}]*refreshUnreadAppBadge\(\)/);
    expect(INDEX_SOURCE).toMatch(/lastTrayUnreadCount = n;\s*refreshUnreadAppBadge\(\);/);
    expect(INDEX_SOURCE).toContain("'[main] app unread badge update failed:'");
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
    expect(INDEX_SOURCE).toContain('await clipboard.writeText(text)');
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

describe('notification sound preferences', () => {
  it('registers the sound boundary and gives only its bounded settings blob a larger limit', () => {
    expect(INDEX_SOURCE).toContain('registerNotificationSoundHandlers();');
    expect(INDEX_SOURCE).toContain("  'notificationSounds',");
    expect(INDEX_SOURCE).toContain("if (key === 'notificationSounds') return 4096;");
    expect(INDEX_SOURCE).toContain('const APP_SETTINGS_MAX_VALUE_LENGTH = 256;');
    expect(PRELOAD_SOURCE).toContain("ipcRenderer.invoke('notificationSounds:choose')");
    expect(PRELOAD_SOURCE).toContain("ipcRenderer.invoke('notificationSounds:read', event, id)");
  });
});

describe('desktop notification click focus', () => {
  it('restores, shows and focuses only the sender window', () => {
    const idx = INDEX_SOURCE.indexOf("ipcMain.handle('app:focusWindow'");
    expect(idx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(idx, idx + 400);
    expect(body).toContain('BrowserWindow.fromWebContents(event.sender)');
    expect(body).toContain('window.restore()');
    expect(body).toContain('window.focus()');
    expect(PRELOAD_SOURCE).toContain("ipcRenderer.invoke('app:focusWindow')");
  });
});

describe('unseen emergency window attention', () => {
  it('flashes only the unfocused sender window and clears on focus', () => {
    const idx = INDEX_SOURCE.indexOf("ipcMain.handle('app:requestAttention'");
    expect(idx).toBeGreaterThan(-1);
    const end = INDEX_SOURCE.indexOf('ipcMain.handle(', idx + 1);
    const body = INDEX_SOURCE.slice(idx, end);
    expect(body).toContain("assertIpcSender(event, 'app:requestAttention')");
    expect(body).toContain('BrowserWindow.fromWebContents(event.sender)');
    expect(body).toContain('window.isFocused()');
    expect(body).toContain('window.flashFrame(true)');
    expect(body).toContain("window.once('focus'");
    expect(body).toContain('window.flashFrame(false)');
    expect(body).not.toContain('process.platform');
    expect(PRELOAD_SOURCE).toContain("ipcRenderer.invoke('app:requestAttention')");
  });
});

describe('RNode flasher firmware backup', () => {
  it('registers the save handler module and exposes it on the flasher namespace', () => {
    expect(INDEX_SOURCE).toContain('registerFlasherHandlers();');
    expect(PRELOAD_SOURCE).toContain("'flasher:saveFirmwareBackup'");
  });
});

describe('translation worker registration', () => {
  it('registers the opt-in namespace and tears down workers before quit', () => {
    expect(INDEX_SOURCE).toContain('const disposeTranslation = registerTranslationHandlers(');
    expect(INDEX_SOURCE).toContain("app.on('before-quit', disposeTranslation)");
    expect(PRELOAD_SOURCE).toContain("'translation:packProgress'");
  });
});
