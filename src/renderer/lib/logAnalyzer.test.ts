import { describe, expect, it } from 'vitest';

import {
  analyzeLogs,
  type CategoryFinding,
  dedupeRecommendations,
  formatTimeAgo,
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
      makeEntry('[MQTT] Connection timeout (will reconnect): connack timeout', 'error'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.categories.find((c) => c.id === 'ble-connection')).toBeUndefined();
  });

  it('detects BLE connect race/timeout for meshcore', () => {
    const entries: LogEntry[] = [
      makeEntry(
        '[IpcNobleConnection:meshcore] waiting on onConnected() (raced with disconnect) timeout=20000ms',
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
        '[IpcNobleConnection:meshcore] waiting on onConnected() (raced with disconnect) timeout=20000ms',
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
      makeEntry('[MQTT] Connection timeout (will reconnect): connack timeout', 'warn'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const mqttCategory = result.categories.find((c) => c.id === 'mqtt');
    expect(mqttCategory).toBeDefined();
    expect(mqttCategory?.count).toBe(1);
  });

  it('detects MQTT will reconnect messages', () => {
    const entries: LogEntry[] = [
      makeEntry('[MQTT] Network error (will reconnect): socket hang up', 'warn'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const mqttCategory = result.categories.find((c) => c.id === 'mqtt');
    expect(mqttCategory).toBeDefined();
    expect(mqttCategory?.count).toBe(1);
  });

  it('detects MQTT issues with various formats including [MQTT] prefix', () => {
    const entries: LogEntry[] = [
      makeEntry('[MQTT] Connection timeout (will reconnect): connack timeout', 'warn'),
      makeEntry('[MQTT] Network error (will reconnect): socket hang up', 'warn'),
      makeEntry('[MQTT] Fatal connection error: certificate has expired', 'error'),
      makeEntry('[MQTT] Reconnecting in 500ms (attempt 1/3)', 'warn'),
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
      makeEntry('[MQTT] broker connection refused', 'error'),
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

  it('detects native module failure message', () => {
    const entries: LogEntry[] = [
      makeEntry('A native module failed to load. Run npm install.', 'error'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const cat = result.categories.find((c) => c.id === 'native-module');
    expect(cat).toBeDefined();
    expect(cat?.count).toBe(1);
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
    const cat = result.categories.find((c) => c.id === 'bluetooth-pairing-timeout');
    expect(cat).toBeDefined();
    expect(cat?.count).toBe(1);
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

  it('includes recommendation for each category', () => {
    const entries: LogEntry[] = [makeEntry('auth failed')];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.categories[0].recommendation).toContain('channel keys');
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
  it('merges duplicate recommendation text and escalates severity', () => {
    const cats: CategoryFinding[] = [
      {
        id: 'a',
        label: 'Cat A',
        count: 1,
        severity: 'warning',
        recommendation: 'Do the thing.',
        lastTs: 1,
        lastMessage: '',
      },
      {
        id: 'b',
        label: 'Cat B',
        count: 2,
        severity: 'error',
        recommendation: 'Do the thing.',
        lastTs: 2,
        lastMessage: '',
      },
    ];
    const d = dedupeRecommendations(cats);
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe('error');
    expect(d[0].appliesToLabels).toEqual(['Cat A', 'Cat B']);
  });

  it('keeps separate rows for distinct recommendations', () => {
    const cats: CategoryFinding[] = [
      {
        id: 'a',
        label: 'A',
        count: 1,
        severity: 'error',
        recommendation: 'One',
        lastTs: 1,
        lastMessage: '',
      },
      {
        id: 'b',
        label: 'B',
        count: 1,
        severity: 'warning',
        recommendation: 'Two',
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

describe('formatTimeAgo', () => {
  it('returns "just now" for recent times', () => {
    const result = formatTimeAgo(Date.now() - 30000);
    expect(result).toBe('just now');
  });

  it('returns minutes for times under an hour', () => {
    const result = formatTimeAgo(Date.now() - 1800000);
    expect(result).toBe('30 min ago');
  });

  it('returns hours for times under a day', () => {
    const result = formatTimeAgo(Date.now() - 7200000);
    expect(result).toBe('2 hr ago');
  });

  it('returns days for older times', () => {
    const result = formatTimeAgo(Date.now() - 172800000);
    expect(result).toBe('2 days ago');
  });

  it('returns singular day for one day', () => {
    const result = formatTimeAgo(Date.now() - 86400000);
    expect(result).toBe('1 day ago');
  });
});
