import { describe, expect, it } from 'vitest';

import { analyzeLogs, formatTimeAgo, formatTimeRange, type LogEntry } from './logAnalyzer';

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

  it('counts errors and warnings', () => {
    const entries: LogEntry[] = [
      makeEntry('normal log', 'log'),
      makeEntry('warning message', 'warn'),
      makeEntry('error occurred', 'error'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    expect(result.totalEntries).toBe(3);
    expect(result.errorCount).toBe(2);
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

  it('filters protocol-specific patterns for meshtastic', () => {
    const entries: LogEntry[] = [
      makeEntry('[iMeshDevice] error: connection lost'),
      makeEntry('[useMeshCore] error: something failed'),
    ];
    const result = analyzeLogs(entries, 'meshtastic');
    const meshtasticCategory = result.categories.find((c) => c.id === 'sdk-meshtastic');
    expect(meshtasticCategory).toBeDefined();
    const meshcoreCategory = result.categories.find((c) => c.id === 'sdk-meshcore');
    expect(meshcoreCategory).toBeUndefined();
  });

  it('filters protocol-specific patterns for meshcore', () => {
    const entries: LogEntry[] = [
      makeEntry('[useMeshCore] error: connection lost'),
      makeEntry('[iMeshDevice] error: something failed'),
    ];
    const result = analyzeLogs(entries, 'meshcore');
    const meshcoreCategory = result.categories.find((c) => c.id === 'sdk-meshcore');
    expect(meshcoreCategory).toBeDefined();
    const meshtasticCategory = result.categories.find((c) => c.id === 'sdk-meshtastic');
    expect(meshtasticCategory).toBeUndefined();
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
});

describe('formatTimeRange', () => {
  it('formats same-day range', () => {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const result = formatTimeRange(oneHourAgo, now);
    expect(result).toContain('–');
  });

  it('formats different-day range', () => {
    const now = Date.now();
    const twoDaysAgo = now - 2 * 86400000;
    const result = formatTimeRange(twoDaysAgo, now);
    expect(result).toContain('/');
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
