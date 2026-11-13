import { describe, expect, it } from 'vitest';

import { analyzeLogs, type LogEntry } from './logAnalyzer';
import type { MeshProtocol } from './types';

function entry(message: string, level = 'warn', ts = 1000): LogEntry {
  return { ts, level, source: 'main', message };
}

// Fixtures mirror production emitters; keep failure text and harmless counterexamples together.
const fixtures: { category: string; protocol: MeshProtocol; message: string }[] = [
  {
    category: 'renderer-unresponsive',
    protocol: 'meshtastic',
    message: '[main] renderer unresponsive after system resume (no heartbeat within 30s)',
  },
  {
    category: 'renderer-unresponsive',
    protocol: 'meshcore',
    message: '[main] renderer webContents unresponsive',
  },
  {
    category: 'renderer-unresponsive',
    protocol: 'reticulum',
    message: '[main] renderer heartbeat stalled (no heartbeat while window visible)',
  },
  {
    category: 'database-persistence',
    protocol: 'meshtastic',
    message:
      '[dbPersistRetry] degraded persistence: saveNode failed after retries: database is locked',
  },
  {
    category: 'database-persistence',
    protocol: 'meshcore',
    message:
      '[dbPersistRetry] degraded persistence: queue full; dropping saveMeshcoreContact: disk full',
  },
  {
    category: 'meshtastic-tcp',
    protocol: 'meshtastic',
    message: '[IPC] meshtastic:tcp-connect error: ECONNREFUSED',
  },
  {
    category: 'meshtastic-tcp',
    protocol: 'meshtastic',
    message: '[IPC] meshtastic:tcp-write error: broken pipe',
  },
  {
    category: 'reticulum-sidecar',
    protocol: 'reticulum',
    message: '[reticulumSidecarWatchdog] hung poll failure 2/2: status 503',
  },
  {
    category: 'reticulum-sidecar',
    protocol: 'reticulum',
    message: '[reticulumSidecarWatchdog] restarting hung sidecar',
  },
  {
    category: 'reticulum-sidecar',
    protocol: 'reticulum',
    message: '[ReticulumIPC] start failed: RETICULUM_SIDECAR_BUNDLED_MISSING',
  },
  {
    category: 'reticulum-sidecar',
    protocol: 'reticulum',
    message: '[ReticulumSidecar] ws error: ECONNRESET',
  },
  {
    category: 'reticulum-sidecar',
    protocol: 'reticulum',
    message: '[ReticulumSidecar] voice ws bridge unavailable: socket closed',
  },
  {
    category: 'reticulum-sidecar',
    protocol: 'reticulum',
    message: '[useReticulumRuntime] power resume reconnect failed Error: timeout',
  },
  {
    category: 'reticulum-delivery',
    protocol: 'reticulum',
    message:
      '[ReticulumSidecar] WARN lxmf-outbound: LXMF outbound delivery failed dest=abc attempts=3',
  },
  {
    category: 'reticulum-delivery',
    protocol: 'reticulum',
    message: '[ReticulumSidecar] WARN LXMF path request budget exhausted; marking outbound failed',
  },
  {
    category: 'reticulum-delivery',
    protocol: 'reticulum',
    message: '[reticulumPropagationStore] sync Error: PROPAGATION_PATH_UNKNOWN',
  },
  {
    category: 'reticulum-backpressure',
    protocol: 'reticulum',
    message:
      '[ReticulumSidecar] WARN LXMF outbound backchannel saturated — dropping newest packet capacity=64',
  },
  {
    category: 'reticulum-backpressure',
    protocol: 'reticulum',
    message:
      '[ReticulumSidecar] WARN LXMF inbound raw channel full; dropping newest opportunistic packet',
  },
  {
    category: 'reticulum-backpressure',
    protocol: 'reticulum',
    message:
      '[ReticulumSidecar] WARN websocket event subscriber lagged; some events dropped skipped=5',
  },
  {
    category: 'reticulum-backpressure',
    protocol: 'reticulum',
    message:
      '[ReticulumSidecar] WARN voice audio websocket subscriber lagged; frames dropped skipped=5',
  },
  {
    category: 'reticulum-backpressure',
    protocol: 'reticulum',
    message: '[ReticulumSidecar] ws message exceeded 1048576 byte cap, dropping',
  },
  {
    category: 'firmware-flash',
    protocol: 'meshtastic',
    message: '[nrf52DfuFlasher] sendFirmware stalled — closing serial port',
  },
  {
    category: 'firmware-flash',
    protocol: 'meshcore',
    message: '[esp32Flasher] writeFlash stalled — closing serial port',
  },
  {
    category: 'mqtt-packet-limit',
    protocol: 'meshtastic',
    message:
      '[Meshtastic MQTT] Broker sent an MQTT packet larger than the 1048576-byte safety limit; automatic reconnect is disabled.',
  },
  {
    category: 'mqtt-packet-limit',
    protocol: 'meshcore',
    message:
      '[MeshCore MQTT] Broker sent an MQTT packet larger than the 1048576-byte safety limit; automatic reconnect is disabled.',
  },
  {
    category: 'mqtt',
    protocol: 'meshcore',
    message: '[MeshCore MQTT] connection watchdog: no packets received, forcing reconnect',
  },
  {
    category: 'mqtt',
    protocol: 'meshcore',
    message: '[MeshCore MQTT] power resume token refresh timed out — reconnecting',
  },
  {
    category: 'mqtt',
    protocol: 'meshtastic',
    message: '[Meshtastic MQTT] Invalid publish PSK; falling back to channel map or default key',
  },
  {
    category: 'transport-loss',
    protocol: 'meshtastic',
    message: '[meshtasticTransportLoss] serial link lost (disconnect event)',
  },
  {
    category: 'transport-loss',
    protocol: 'meshtastic',
    message: '[meshtasticTransportLoss] ble link lost (read-pipe-failure): pipe closed',
  },
  {
    category: 'transport-loss',
    protocol: 'meshcore',
    message: '[meshcoreSerialTransportLoss] serial link lost (serial-disconnect)',
  },
  {
    category: 'rf-auto-connect',
    protocol: 'meshtastic',
    message: '[useProtocolRfAutoConnect] meshtastic auto-connect timed out after 30s',
  },
  {
    category: 'rf-auto-connect',
    protocol: 'meshtastic',
    message:
      '[useProtocolRfAutoConnect] serial auto-connect failed for meshtastic; falling back to BLE GATT scan: Error: busy',
  },
  {
    category: 'rf-auto-connect',
    protocol: 'meshcore',
    message: '[useProtocolRfAutoConnect] meshcore ble auto-connect failed: Error: timeout',
  },
  {
    category: 'power-save-blocker',
    protocol: 'meshtastic',
    message: '[main] powerSaveBlocker start failed: Error: not allowed',
  },
  {
    category: 'power-save-blocker',
    protocol: 'meshcore',
    message: '[main] powerSaveBlocker stop failed: Error: unknown id',
  },
  {
    category: 'bluetooth-pairing',
    protocol: 'meshtastic',
    message: '[IPC] bluetooth-connect failed: Device not available',
  },
  {
    category: 'tak-chat',
    protocol: 'meshtastic',
    message: '[TakDirectMessages] pushDirectMessage failed Error: offline',
  },
  {
    category: 'tak-chat',
    protocol: 'meshcore',
    message: '[TakInboundChat] mesh send failed Error: not connected',
  },
  {
    category: 'tak-chat',
    protocol: 'reticulum',
    message: '[TakGeochat] pushChatMessage failed Error: relay down',
  },
  {
    category: 'mecp',
    protocol: 'meshtastic',
    message: '[mecp-rebroadcast] send failed Error: radio busy',
  },
  {
    category: 'mecp',
    protocol: 'meshtastic',
    message: '[mecp-received-log] append failed Error: ENOSPC',
  },
  {
    category: 'mecp',
    protocol: 'meshcore',
    message: '[mecp] failed to load language en',
  },
  {
    category: 'mecp',
    protocol: 'meshtastic',
    message: '[MecpComposeModal] send failed radio disconnected',
  },
  {
    category: 'offline-maps',
    protocol: 'meshtastic',
    message: '[offline-maps] download start failed: network error',
  },
  {
    category: 'offline-maps',
    protocol: 'meshcore',
    message: '[offline-maps] job failed: disk full',
  },
  {
    category: 'offline-maps',
    protocol: 'reticulum',
    message: '[offline-maps] mbtiles import failed: corrupt file',
  },
  {
    category: 'offline-maps',
    protocol: 'meshtastic',
    message: '[offline-maps] custom-sources.json unreadable; starting empty: ENOENT',
  },
  {
    category: 'meshcore-cli',
    protocol: 'meshcore',
    message: '[MeshcoreCompanionCliSection] console command failed Error: timeout',
  },
  {
    category: 'meshcore-cli',
    protocol: 'meshcore',
    message: '[MeshcoreRemoteCliSection] write remote CLI flag failed Error: not on radio',
  },
  {
    category: 'ai-summary',
    protocol: 'meshtastic',
    message: '[ai] Download failed: ENETUNREACH',
  },
  {
    category: 'ai-summary',
    protocol: 'meshcore',
    message: '[ai] Startup status unavailable; setup remains available for saved opt-in.',
  },
  {
    category: 'live-map',
    protocol: 'meshtastic',
    message: '[live-map] pop-out failed to open Error: blocked',
  },
  {
    category: 'live-map',
    protocol: 'meshcore',
    message: '[live-map] regional feed did not resume',
  },
  {
    category: 'live-map',
    protocol: 'reticulum',
    message: '[live-map] pop-out is unavailable for this renderer origin',
  },
  {
    category: 'coi-memory',
    protocol: 'meshtastic',
    message: '[coiMemorySampler] persist failed Error: database locked',
  },
  {
    category: 'coi-memory',
    protocol: 'meshcore',
    message: '[renderer-memory-auto-sampler] persist failed Error: ENOSPC',
  },
  {
    category: 'gps',
    protocol: 'meshtastic',
    message: '[gps] ip fix failed: msg="timeout"',
  },
  {
    category: 'gps',
    protocol: 'reticulum',
    message: '[gps] inetChecksite preflight failed: ENETUNREACH',
  },
];

describe('current production log messages', () => {
  it.each(fixtures)('classifies $category: $message', ({ category, protocol, message }) => {
    const result = analyzeLogs([entry(message)], protocol);
    expect(result.categories.find((finding) => finding.id === category)?.count).toBe(1);
    expect(result.categories.find((finding) => finding.id === 'unclassified')).toBeUndefined();
  });

  it.each(fixtures)('does not diagnose debug-only $category', ({ category, protocol, message }) => {
    expect(
      analyzeLogs([entry(message, 'debug')], protocol).categories.find(
        (finding) => finding.id === category,
      ),
    ).toBeUndefined();
  });

  it.each([
    '[main] renderer webContents responsive again',
    '[ReticulumSidecar] exited code=0 signal=null',
    '[useReticulumRuntime] restarting stack to reload interface config',
    '[ReticulumSidecar] INFO propagation-deposit: stored at propagation node',
    '[ReticulumSidecar] WARN LXMF inbound opportunistic packet len=123',
  ])('does not infer an outage from routine progress: %s', (message) => {
    const warning = entry(message);
    const categories = analyzeLogs([warning], 'reticulum').categories;
    expect(categories).toEqual([
      expect.objectContaining({ id: 'unclassified', count: 1, entries: [warning] }),
    ]);
  });

  it.each([
    '[main] bleCoexistence:acquireScan failed: busy',
    '[IPC] mqtt:getCachedNodes failed: database locked',
    '[useProtocolRfAutoConnect] meshtastic BLE auto-connect cancelled after coexistence wait',
    '[useProtocolRfAutoConnect] meshcore BLE auto-connect skipped — same peripheral as Meshtastic (aa:bb)',
    '[offline-maps] dropped invalid custom source record',
  ])('leaves noise unclassified rather than misdiagnosing: %s', (message) => {
    const warning = entry(message);
    const result = analyzeLogs([warning], 'meshtastic');
    expect(result.categories.map((finding) => finding.id)).toEqual(['unclassified']);
    expect(result.categories.find((finding) => finding.id === 'ble-connection')).toBeUndefined();
    expect(result.categories.find((finding) => finding.id === 'mqtt')).toBeUndefined();
    expect(result.categories.find((finding) => finding.id === 'rf-auto-connect')).toBeUndefined();
    expect(result.categories.find((finding) => finding.id === 'offline-maps')).toBeUndefined();
  });

  it('keeps Reticulum bleCoexistence noise unclassified on the Reticulum tab (excluded elsewhere)', () => {
    const warning = entry('[Reticulum] bleCoexistence acquireScan failed: Error: held');
    const onMeshtastic = analyzeLogs([warning], 'meshtastic');
    expect(onMeshtastic.ignoredOtherProtocol).toBe(1);
    expect(onMeshtastic.categories).toEqual([]);
    const onReticulum = analyzeLogs([warning], 'reticulum');
    expect(onReticulum.categories.map((finding) => finding.id)).toEqual(['unclassified']);
    expect(
      onReticulum.categories.find((finding) => finding.id === 'ble-connection'),
    ).toBeUndefined();
  });

  it('does not suggest LoRa channel keys for Reticulum decryption failures', () => {
    const result = analyzeLogs(
      [entry('[ReticulumSidecar] WARN opportunistic LXMF decrypt failed')],
      'reticulum',
    );
    expect(result.categories.map((finding) => finding.id)).toEqual(['reticulum-delivery']);
  });

  it('excludes other-protocol lines instead of dumping them into unclassified', () => {
    const reticulumOnMeshcore = analyzeLogs(
      [entry('[ReticulumIPC] start failed: unavailable')],
      'meshcore',
    );
    expect(reticulumOnMeshcore.categories).toEqual([]);
    expect(reticulumOnMeshcore.ignoredOtherProtocol).toBe(1);
    expect(reticulumOnMeshcore.totalEntries).toBe(0);

    const meshtasticOnReticulum = analyzeLogs(
      [entry('[IPC] meshtastic:tcp-connect error: refused')],
      'reticulum',
    );
    expect(meshtasticOnReticulum.categories).toEqual([]);
    expect(meshtasticOnReticulum.ignoredOtherProtocol).toBe(1);

    const transportOnMeshcore = analyzeLogs(
      [entry('[meshtasticTransportLoss] serial link lost (disconnect event)')],
      'meshcore',
    );
    expect(transportOnMeshcore.categories.map((f) => f.id)).not.toContain('transport-loss');
    expect(transportOnMeshcore.ignoredOtherProtocol).toBe(1);

    const sharedDb = analyzeLogs(
      [entry('[dbPersistRetry] degraded persistence: failed after retries')],
      'meshcore',
    );
    expect(sharedDb.ignoredOtherProtocol).toBe(0);
    expect(sharedDb.categories.some((f) => f.id === 'database-persistence')).toBe(true);
  });
});

describe('finding evidence', () => {
  it('keeps the original messages, newest first, without changing the input', () => {
    const oldest = entry(
      '[dbPersistRetry] degraded persistence: first failed after retries',
      'warn',
      1,
    );
    const newest = entry(
      '[dbPersistRetry] degraded persistence: second failed after retries',
      'warn',
      3,
    );
    const input = [oldest, entry('normal progress', 'info', 2), newest];
    const result = analyzeLogs(input, 'meshtastic');
    const finding = result.categories[0];
    expect(finding.entries).toEqual([newest, oldest]);
    expect(finding.lastTs).toBe(3);
    expect(input[0]).toBe(oldest);
    expect(finding.entries[0]).toBe(newest);
  });

  it('surfaces unmatched errors once, without double-counting recognized warnings', () => {
    const unknown = entry('[FutureModule] request failed', 'error');
    const known = entry('[dbPersistRetry] degraded persistence: save failed after retries');
    const result = analyzeLogs([known, unknown, entry('normal progress', 'info')], 'meshtastic');
    expect(result.categories.find((finding) => finding.id === 'unclassified')).toMatchObject({
      count: 1,
      severity: 'error',
      entries: [unknown],
    });
  });

  it('preserves cancelled-navigation noise suppression in the fallback', () => {
    expect(
      analyzeLogs([entry('[main] Failed to load: -3 ERR_ABORTED', 'error')], 'meshtastic')
        .categories,
    ).toEqual([]);
  });

  it.each([
    'Electron Security Warning (experimentalFeatures) This renderer process has "experimentalFeatures" enabled. This warning will not show up once the app is packaged.',
    'Electron Security Warning (enableBlinkFeatures) This renderer process has additional "enableBlinkFeatures" enabled. This warning will not show up once the app is packaged.',
    'Error received for packet 445325495: NO_RESPONSE',
    'Packet 577169153 of type packet timed out',
  ])('excludes known benign noise from findings: %s', (message) => {
    expect(analyzeLogs([entry(message)], 'meshtastic').categories).toEqual([]);
  });
});
