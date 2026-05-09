import { describe, expect, it } from 'vitest';

import {
  analyzeLogs,
  type CategoryFinding,
  dedupeRecommendations,
  formatTimeRange,
  type LogEntry,
} from './logAnalyzer';

function makeEntry(
  message: string,
  level: 'error' | 'warn' | 'log' | 'info' | 'debug' = 'log',
  source = 'main',
  ts = Date.now(),
): LogEntry {
  return { ts, level, source, message };
}

describe('analyzeLogs', () => {
  it('returns empty result for empty entries', () => {
    const result = analyzeLogs([], 'meshtastic');
    expect(result.totalEntries).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.categories).toHaveLength(0);
  });

  it('counts errors and warnings separately', () => {
    const entries: LogEntry[] = [
      makeEntry('normal log', 'log'),
      makeEntry('warning message', 'warn'),
      makeEntry('error occurred', 'error'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.totalEntries).toBe(3);
    expect(result.errorCount).toBe(1);
    expect(result.warningCount).toBe(1);
  });

  it('detects BLE connection issues', () => {
    const entries: LogEntry[] = [
      makeEntry('connectAsync timed out'),
      makeEntry('gatt server is disconnected'),
      makeEntry('normal log'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const bleCategory = result.categories.find((c) => c.id === 'ble-connection');
    expect(bleCategory).toBeDefined();
    expect(bleCategory?.count).toBe(2);
    expect(bleCategory?.severity).toBe('error');
    expect(bleCategory?.lastMessage).toBeTruthy();
  });

  it('does not flag MQTT connection timeout as BLE issue', () => {
    const entries: LogEntry[] = [
      makeEntry('[Meshtastic MQTT] Connection timeout (will reconnect): connack timeout', 'error'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.categories.find((c) => c.id === 'ble-connection')).toBeUndefined();
  });

  it('detects BLE connect race/timeout for meshcore', () => {
    const entries: LogEntry[] = [
      makeEntry(
        '[IpcNobleConnection:meshcore] disconnect raced ahead of handshake — will fail immediately',
        'warn',
      ),
    ];
    const result = analyzeLogs(entries, 'meshcore');
    const raceCategory = result.categories.find((c) => c.id === 'ble-connect-race');
    expect(raceCategory).toBeDefined();
    expect(raceCategory?.count).toBe(1);
    expect(raceCategory?.severity).toBe('warning');
  });

  it('does not detect BLE connect race for meshtastic protocol', () => {
    const entries: LogEntry[] = [
      makeEntry(
        '[IpcNobleConnection:meshcore] disconnect raced ahead of handshake — will fail immediately',
        'warn',
      ),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.categories.find((c) => c.id === 'ble-connect-race')).toBeUndefined();
  });

  it('does not flag BLE peripheral info state=disconnected as BLE issue', () => {
    const entries: LogEntry[] = [
      makeEntry(
        '[BLE:meshcore] peripheral info — address= addressType=unknown rssi=-69 state=disconnected platform=darwin',
        'log',
      ),
    ];
    const result = analyzeLogs(entries, 'meshcore');
    expect(result.categories.find((c) => c.id === 'ble-connection')).toBeUndefined();
  });

  it('detects MQTT issues', () => {
    const entries: LogEntry[] = [
      makeEntry('MQTT Network error (will reconnect)'),
      makeEntry('Subscribe failed'),
      makeEntry('normal log'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const mqttCategory = result.categories.find((c) => c.id === 'mqtt');
    expect(mqttCategory).toBeDefined();
    expect(mqttCategory?.count).toBe(2);
    expect(mqttCategory?.severity).toBe('warning');
  });

  it('detects MQTT connection timeout', () => {
    const entries: LogEntry[] = [
      makeEntry('[Meshtastic MQTT] Connection timeout (will reconnect): connack timeout', 'warn'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const mqttCategory = result.categories.find((c) => c.id === 'mqtt');
    expect(mqttCategory).toBeDefined();
    expect(mqttCategory?.count).toBe(1);
  });

  it('detects MQTT will reconnect messages', () => {
    const entries: LogEntry[] = [
      makeEntry('[Meshtastic MQTT] Network error (will reconnect): socket hang up', 'warn'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const mqttCategory = result.categories.find((c) => c.id === 'mqtt');
    expect(mqttCategory).toBeDefined();
    expect(mqttCategory?.count).toBe(1);
  });

  it('detects MQTT issues with various formats including [Meshtastic MQTT] prefix', () => {
    const entries: LogEntry[] = [
      makeEntry('[Meshtastic MQTT] Connection timeout (will reconnect): connack timeout', 'warn'),
      makeEntry('[Meshtastic MQTT] Network error (will reconnect): socket hang up', 'warn'),
      makeEntry('[Meshtastic MQTT] Fatal connection error: certificate has expired', 'error'),
      makeEntry('[Meshtastic MQTT] Reconnecting in 500ms (attempt 1/3)', 'warn'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const mqttCategory = result.categories.find((c) => c.id === 'mqtt');
    expect(mqttCategory).toBeDefined();
    expect(mqttCategory?.count).toBe(4);
  });

  it('does not flag bare connection refused as MQTT', () => {
    const entries: LogEntry[] = [makeEntry('Error: connection refused', 'error')];
    const result = analyzeLogs(entries, 'meshtastic');
    const mqttCategory = result.categories.find((c) => c.id === 'mqtt');
    expect(mqttCategory).toBeUndefined();
  });

  it('flags MQTT-context connection refused', () => {
    const entries: LogEntry[] = [
      makeEntry('[Meshtastic MQTT] broker connection refused', 'error'),
      makeEntry('connect failed: connection refused for mqtt client', 'error'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const mqttCategory = result.categories.find((c) => c.id === 'mqtt');
    expect(mqttCategory).toBeDefined();
    expect(mqttCategory?.count).toBe(2);
  });

  it('detects MQTT reconnect limit', () => {
    const entries: LogEntry[] = [makeEntry('Connection lost after 5 reconnect attempts', 'error')];
    const result = analyzeLogs(entries, 'meshtastic');
    const cat = result.categories.find((c) => c.id === 'mqtt-retries-exhausted');
    expect(cat).toBeDefined();
    expect(cat?.count).toBe(1);
  });

  it('detects native module failure message and recommends pnpm', () => {
    const entries: LogEntry[] = [
      makeEntry('A native module failed to load. Run npm install.', 'error'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const cat = result.categories.find((c) => c.id === 'native-module');
    expect(cat).toBeDefined();
    expect(cat?.count).toBe(1);
    expect(cat?.id).toBe('native-module');
  });

  it('detects database not writable', () => {
    const entries: LogEntry[] = [makeEntry('Database directory is not writable: /tmp/x', 'error')];
    const result = analyzeLogs(entries, 'meshtastic');
    const cat = result.categories.find((c) => c.id === 'database-writable');
    expect(cat).toBeDefined();
    expect(cat?.count).toBe(1);
  });

  it('detects MeshCore BLE notify watchdog', () => {
    const entries: LogEntry[] = [
      makeEntry('[BLE:meshcore] notify watchdog: no data in 5s on Win32. Pair the radio.', 'warn'),
    ];
    const result = analyzeLogs(entries, 'meshcore');
    const cat = result.categories.find((c) => c.id === 'ble-meshcore-notify-watchdog');
    expect(cat).toBeDefined();
    expect(cat?.count).toBe(1);
  });

  it('detects bluetooth pairing PIN timeout', () => {
    const entries: LogEntry[] = [
      makeEntry('bluetooth-pairing: PIN prompt timed out after 120s — aborting', 'warn'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const cat = result.categories.find((c) => c.id === 'bluetooth-pairing');
    expect(cat).toBeDefined();
    expect(cat?.count).toBe(1);
  });

  it('detects bluetooth IPC pair and unpair failures', () => {
    const entries: LogEntry[] = [
      makeEntry('[IPC] bluetooth-pair failed: timeout', 'warn'),
      makeEntry('[IPC] bluetooth-unpair failed: not paired', 'warn'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const cat = result.categories.find((c) => c.id === 'bluetooth-pairing');
    expect(cat).toBeDefined();
    expect(cat?.count).toBe(2);
  });

  it('detects internal app errors', () => {
    const entries: LogEntry[] = [
      makeEntry('[main] Uncaught exception: Error: boom', 'error'),
      makeEntry('[main] Unhandled rejection: bad', 'error'),
      makeEntry('[main] Renderer process gone: crashed', 'error'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const cat = result.categories.find((c) => c.id === 'internal-error');
    expect(cat).toBeDefined();
    expect(cat?.count).toBe(3);
  });

  it('detects Failed to load as internal error when not ERR_ABORTED', () => {
    const entries: LogEntry[] = [
      makeEntry('[main] Failed to load: -105 ERR_BLOCKED_BY_CLIENT https://example.com/', 'error'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.categories.find((c) => c.id === 'internal-error')).toBeDefined();
  });

  it('does not flag Failed to load ERR_ABORTED -3 as internal error', () => {
    const entries: LogEntry[] = [
      makeEntry('[main] Failed to load: -3 ERR_ABORTED https://localhost/', 'error'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.categories.find((c) => c.id === 'internal-error')).toBeUndefined();
  });

  it('detects database failures', () => {
    const entries: LogEntry[] = [
      makeEntry('[db] Database init failed: SQLITE_CANTOPEN', 'error'),
      makeEntry('[db] runSchemaUpgrade failed corrupt', 'error'),
      makeEntry('[db] migration v12 failed: rollback', 'error'),
      makeEntry('[db] mergeDatabase failed: corrupt', 'error'),
      makeEntry('[db] Merge failed: duplicate', 'error'),
      makeEntry('[db] createBaseTables failed: no disk', 'error'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const cat = result.categories.find((c) => c.id === 'database-error');
    expect(cat).toBeDefined();
    expect(cat?.count).toBe(6);
  });

  it('detects database chmod as warning', () => {
    const entries: LogEntry[] = [
      makeEntry('[db] chmod failed (non-fatal, expected on Windows):', 'warn'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const cat = result.categories.find((c) => c.id === 'database-chmod');
    expect(cat).toBeDefined();
    expect(cat?.severity).toBe('warning');
  });

  it('does not flag TakServer debug lines', () => {
    const entries: LogEntry[] = [makeEntry('[TakServer] Listening on port 8080', 'debug')];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.categories.find((c) => c.id === 'tak-server')).toBeUndefined();
  });

  it('detects TakServer warn lines', () => {
    const entries: LogEntry[] = [
      makeEntry('[TakServer] Client socket error abc: socket error', 'warn'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.categories.find((c) => c.id === 'tak-server')).toBeDefined();
  });

  it('does not flag updater debug lines', () => {
    const entries: LogEntry[] = [makeEntry('[updater] would check (hypothetical debug)', 'debug')];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.categories.find((c) => c.id === 'updater')).toBeUndefined();
  });

  it('detects updater warnings', () => {
    const entries: LogEntry[] = [makeEntry('[updater] checkForUpdates failed: network', 'warn')];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.categories.find((c) => c.id === 'updater')).toBeDefined();
  });

  it('detects meshcore TCP bridge errors for meshcore protocol only', () => {
    const tcpLine = '[IPC] meshcore:tcp-connect error: ECONNREFUSED';
    const mesh = analyzeLogs([makeEntry(tcpLine, 'error')], 'meshcore');
    expect(mesh.categories.find((c) => c.id === 'meshcore-tcp')).toBeDefined();
    const mega = analyzeLogs([makeEntry(tcpLine, 'error')], 'meshtastic');
    expect(mega.categories.find((c) => c.id === 'meshcore-tcp')).toBeUndefined();
  });

  it('detects meshcore TCP write errors', () => {
    const result = analyzeLogs(
      [makeEntry('[IPC] meshcore:tcp-write error: broken pipe', 'error')],
      'meshcore',
    );
    expect(result.categories.find((c) => c.id === 'meshcore-tcp')).toBeDefined();
  });

  it('classifies IpcNobleConnection:meshtastic under sdk-meshtastic', () => {
    const result = analyzeLogs(
      [makeEntry('[IpcNobleConnection:meshtastic] peripheral disconnected', 'warn')],
      'meshtastic',
    );
    const sdk = result.categories.find((c) => c.id === 'sdk-meshtastic');
    expect(sdk).toBeDefined();
    expect(sdk?.count).toBe(1);
  });

  it('classifies IpcNobleConnection:meshcore under sdk-meshcore', () => {
    const result = analyzeLogs(
      [makeEntry('[IpcNobleConnection:meshcore] peripheral disconnected', 'warn')],
      'meshcore',
    );
    const sdk = result.categories.find((c) => c.id === 'sdk-meshcore');
    expect(sdk).toBeDefined();
    expect(sdk?.count).toBe(1);
  });

  it('detects watchdog triggers', () => {
    const entries: LogEntry[] = [
      makeEntry('watchdog: BLE dead for 30000ms, triggering reconnect'),
      makeEntry('watchdog: telemetry stale for 60000ms'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const watchdogCategory = result.categories.find((c) => c.id === 'watchdog');
    expect(watchdogCategory).toBeDefined();
    expect(watchdogCategory?.count).toBe(2);
  });

  it('detects auth/decryption failures', () => {
    const entries: LogEntry[] = [
      makeEntry('auth failed for node'),
      makeEntry('decrypt attempt failed (wrong key)'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const authCategory = result.categories.find((c) => c.id === 'auth-decrypt');
    expect(authCategory).toBeDefined();
    expect(authCategory?.count).toBe(2);
  });

  it('filters protocol-specific SDK patterns for meshtastic (warn/error only)', () => {
    const entries: LogEntry[] = [
      makeEntry('[iMeshDevice] error: connection lost', 'error'),
      makeEntry('[useMeshCore] error: something failed', 'warn'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const meshtasticCategory = result.categories.find((c) => c.id === 'sdk-meshtastic');
    expect(meshtasticCategory).toBeDefined();
    expect(meshtasticCategory?.count).toBe(1);
    const meshcoreCategory = result.categories.find((c) => c.id === 'sdk-meshcore');
    expect(meshcoreCategory).toBeUndefined();
  });

  it('does not flag SDK debug noise for meshtastic', () => {
    const entries: LogEntry[] = [
      makeEntry('[iMeshDevice] debug: heartbeat ok', 'debug'),
      makeEntry('[TransportNobleIpc] packet received', 'log'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.categories.find((c) => c.id === 'sdk-meshtastic')).toBeUndefined();
  });

  it('filters protocol-specific SDK patterns for meshcore (warn/error only)', () => {
    const entries: LogEntry[] = [
      makeEntry('[useMeshCore] error: connection lost', 'error'),
      makeEntry('[iMeshDevice] error: something failed', 'warn'),
    ];
    const result = analyzeLogs(entries, 'meshcore');
    const meshcoreCategory = result.categories.find((c) => c.id === 'sdk-meshcore');
    expect(meshcoreCategory).toBeDefined();
    expect(meshcoreCategory?.count).toBe(1);
    const meshtasticCategory = result.categories.find((c) => c.id === 'sdk-meshtastic');
    expect(meshtasticCategory).toBeUndefined();
  });

  it('does not flag MeshCore SDK debug lines', () => {
    const entries: LogEntry[] = [
      makeEntry('[useMeshCore] event 128: advert from ABCD', 'debug'),
      makeEntry('[BLE:meshcore] connect idempotent skip — already connected', 'log'),
    ];
    const result = analyzeLogs(entries, 'meshcore');
    expect(result.categories.find((c) => c.id === 'sdk-meshcore')).toBeUndefined();
  });

  it('sorts categories by severity then count', () => {
    const entries: LogEntry[] = [
      makeEntry('MQTT Network error'),
      makeEntry('MQTT Network error'),
      makeEntry('auth failed'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.categories[0].id).toBe('auth-decrypt');
    expect(result.categories[0].severity).toBe('error');
    expect(result.categories[1].id).toBe('mqtt');
    expect(result.categories[1].severity).toBe('warning');
  });

  it('calculates time range correctly', () => {
    const now = Date.now();
    const entries: LogEntry[] = [
      makeEntry('msg1', 'log', 'main', now - 10000),
      makeEntry('msg2', 'log', 'main', now),
      makeEntry('msg3', 'log', 'main', now - 5000),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.oldestTs).toBe(now - 10000);
    expect(result.newestTs).toBe(now);
  });

  it('flags auth-decrypt category for auth failed lines', () => {
    const entries: LogEntry[] = [makeEntry('auth failed')];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.categories[0].id).toBe('auth-decrypt');
  });

  it('truncates lastMessage for long lines', () => {
    const longBle = `BLE failure ${'y'.repeat(200)}`;
    const result = analyzeLogs([makeEntry(longBle, 'error')], 'meshtastic');
    const bleCat = result.categories.find((c) => c.id === 'ble-connection');
    expect(bleCat).toBeDefined();
    expect(bleCat!.lastMessage.length).toBeLessThanOrEqual(100);
    expect(bleCat!.lastMessage.endsWith('…')).toBe(true);
  });
});

describe('dedupeRecommendations', () => {
  it('merges identical recommendationGroup and escalates severity', () => {
    const cats: CategoryFinding[] = [
      {
        id: 'a',
        recommendationGroup: '__test_merged',
        count: 1,
        severity: 'warning',
        lastTs: 1,
        lastMessage: '',
      },
      {
        id: 'b',
        recommendationGroup: '__test_merged',
        count: 2,
        severity: 'error',
        lastTs: 2,
        lastMessage: '',
      },
    ];
    const d = dedupeRecommendations(cats);
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe('error');
    expect(d[0].categoryIds).toEqual(['a', 'b']);
  });

  it('keeps separate rows for distinct recommendation groups', () => {
    const cats: CategoryFinding[] = [
      {
        id: 'a',
        recommendationGroup: 'a',
        count: 1,
        severity: 'error',
        lastTs: 1,
        lastMessage: '',
      },
      {
        id: 'b',
        recommendationGroup: 'b',
        count: 1,
        severity: 'warning',
        lastTs: 2,
        lastMessage: '',
      },
    ];
    const d = dedupeRecommendations(cats);
    expect(d).toHaveLength(2);
  });
});

describe('formatTimeRange', () => {
  it('formats same-day range', () => {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const result = formatTimeRange(oneHourAgo, now);
    expect(result).toContain('–');
  });

  it('formats different-day range with start and end segments', () => {
    const now = Date.now();
    const twoDaysAgo = now - 2 * 86400000;
    const result = formatTimeRange(twoDaysAgo, now);
    const parts = result.split('–');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts[0].trim().length).toBeGreaterThan(0);
    expect(parts[parts.length - 1].trim().length).toBeGreaterThan(0);
  });
});
