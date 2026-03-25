// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const INDEX_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8');

describe('IPC payload size limits (source contract)', () => {
  it('defines meshcore tcp-write and noble-ble limits and uses them in handlers', () => {
    expect(INDEX_SOURCE).toContain('const MESHCORE_TCP_WRITE_MAX_BYTES = 256 * 1024');
    expect(INDEX_SOURCE).toContain('const NOBLE_BLE_TO_RADIO_MAX_BYTES = 512');
    expect(INDEX_SOURCE).toMatch(/maxBytes: NOBLE_BLE_TO_RADIO_MAX_BYTES/);
    expect(INDEX_SOURCE).toMatch(/bytes\.length > MESHCORE_TCP_WRITE_MAX_BYTES/);
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

describe('MQTT forwarder dropped-event logs (source contract)', () => {
  it('sanitizes dynamic MQTT fields when mainWindow is not ready', () => {
    expect((INDEX_SOURCE.match(/sanitizeLogMessage\(String\(s\)\)/g) ?? []).length).toBe(2);
    expect((INDEX_SOURCE.match(/sanitizeLogMessage\(String\(msg\)\)/g) ?? []).length).toBe(3);
    expect((INDEX_SOURCE.match(/sanitizeLogMessage\(String\(id\)\)/g) ?? []).length).toBe(2);
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
});
