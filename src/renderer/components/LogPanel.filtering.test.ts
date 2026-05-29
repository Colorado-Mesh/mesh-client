import { execFileSync } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { isDeviceEntry } from './LogPanel';

function entry(source: string, message: string, level = 'log') {
  return { ts: Date.now(), level, source, message };
}

describe('log-panel filter contract', () => {
  it('all [TAG] prefixes in device source files are registered in isDeviceEntry', () => {
    const projectRoot = path.resolve(import.meta.dirname ?? __dirname, '..', '..', '..');
    execFileSync('node', [path.join(projectRoot, 'scripts', 'check-log-panel-filter.mjs')], {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: projectRoot,
    });
    expect(true).toBe(true);
  });
});

describe('isDeviceEntry — Meshtastic protocol', () => {
  it('classifies SDK source as Meshtastic device entry', () => {
    expect(isDeviceEntry(entry('meshtastic-sdk', 'some sdk message'), 'meshtastic')).toBe(true);
  });

  it('classifies [useMeshtasticRuntime] runtime message as Meshtastic device entry', () => {
    expect(
      isDeviceEntry(
        entry('main', '[useMeshtasticRuntime] Connection lost — initiating reconnect'),
        'meshtastic',
      ),
    ).toBe(true);
  });

  it('classifies [iMeshDevice] message as Meshtastic device entry', () => {
    expect(isDeviceEntry(entry('main', '[iMeshDevice] connected'), 'meshtastic')).toBe(true);
  });

  it('classifies [TransportNobleIpc] message as Meshtastic device entry', () => {
    expect(isDeviceEntry(entry('main', '[TransportNobleIpc] packet received'), 'meshtastic')).toBe(
      true,
    );
  });

  it('classifies [Meshtastic MQTT] message as app-level (not Meshtastic device entry)', () => {
    expect(
      isDeviceEntry(
        entry('main', '[Meshtastic MQTT] ServiceEnvelope decode failed: illegal tag'),
        'meshtastic',
      ),
    ).toBe(false);
  });

  it('classifies [NobleBleManager] message as Meshtastic device entry', () => {
    expect(
      isDeviceEntry(entry('main', '[NobleBleManager] startScanning error: timeout'), 'meshtastic'),
    ).toBe(true);
  });

  it('classifies [BLE:sessionId] message as Meshtastic device entry', () => {
    expect(
      isDeviceEntry(entry('main', '[BLE:abc123] connect failed: peripheral lost'), 'meshtastic'),
    ).toBe(true);
  });

  it('classifies sdk source as Meshtastic device entry', () => {
    expect(isDeviceEntry(entry('sdk', 'Packet 42 of type decoded timed out'), 'meshtastic')).toBe(
      true,
    );
  });

  it('does NOT classify MeshCore source as Meshtastic device entry', () => {
    expect(isDeviceEntry(entry('meshcore', 'meshcore message'), 'meshtastic')).toBe(false);
  });

  it('does NOT classify [useMeshcoreRuntime] message as Meshtastic device entry', () => {
    expect(isDeviceEntry(entry('main', '[useMeshcoreRuntime] connected'), 'meshtastic')).toBe(
      false,
    );
  });

  it('does NOT classify [useMeshtasticRuntime] message as MeshCore device entry', () => {
    expect(isDeviceEntry(entry('main', '[useMeshtasticRuntime] watchdog: stale'), 'meshcore')).toBe(
      false,
    );
  });

  it('does NOT classify [MeshCore MQTT] message as Meshtastic device entry', () => {
    expect(isDeviceEntry(entry('main', '[MeshCore MQTT] status changed'), 'meshtastic')).toBe(
      false,
    );
  });
});

describe('isDeviceEntry — MeshCore protocol', () => {
  it('classifies meshcore source as MeshCore device entry', () => {
    expect(isDeviceEntry(entry('meshcore', 'some message'), 'meshcore')).toBe(true);
  });

  it('classifies [useMeshcoreRuntime] message as MeshCore device entry', () => {
    expect(isDeviceEntry(entry('main', '[useMeshcoreRuntime] rx packet'), 'meshcore')).toBe(true);
  });

  it('classifies [MeshCore MQTT] message as MeshCore device entry', () => {
    expect(isDeviceEntry(entry('main', '[MeshCore MQTT] status changed'), 'meshcore')).toBe(true);
  });

  it('does NOT classify Meshtastic SDK source as MeshCore device entry', () => {
    expect(isDeviceEntry(entry('meshtastic-sdk', 'sdk message'), 'meshcore')).toBe(false);
  });

  it('does NOT classify [iMeshDevice] message as MeshCore device entry', () => {
    expect(isDeviceEntry(entry('main', '[iMeshDevice] connected'), 'meshcore')).toBe(false);
  });

  it('does NOT classify [Meshtastic MQTT] message as MeshCore device entry', () => {
    expect(
      isDeviceEntry(entry('main', '[Meshtastic MQTT] ServiceEnvelope decode failed'), 'meshcore'),
    ).toBe(false);
  });

  it('does NOT classify [NobleBleManager] message as MeshCore device entry', () => {
    expect(
      isDeviceEntry(entry('main', '[NobleBleManager] startScanning error: timeout'), 'meshcore'),
    ).toBe(false);
  });

  it('does NOT classify [BLE:sessionId] message as MeshCore device entry', () => {
    expect(
      isDeviceEntry(entry('main', '[BLE:abc123] connect failed: peripheral lost'), 'meshcore'),
    ).toBe(false);
  });

  it('classifies [BLE:meshcore] Noble IPC message as MeshCore device entry', () => {
    expect(
      isDeviceEntry(entry('main', '[BLE:meshcore] connect coalesce await failed — x'), 'meshcore'),
    ).toBe(true);
  });

  it('classifies [IpcNobleConnection:meshcore] message as MeshCore device entry', () => {
    expect(
      isDeviceEntry(
        entry(
          'main',
          '[IpcNobleConnection:meshcore] disconnect raced ahead of handshake — will fail immediately',
        ),
        'meshcore',
      ),
    ).toBe(true);
  });

  it('does NOT classify [IpcNobleConnection:meshcore] message as Meshtastic device entry', () => {
    expect(
      isDeviceEntry(
        entry(
          'main',
          '[IpcNobleConnection:meshcore] disconnect raced ahead of handshake — will fail immediately',
        ),
        'meshtastic',
      ),
    ).toBe(false);
  });

  it('classifies [IpcNobleConnection:meshtastic] message as Meshtastic device entry', () => {
    expect(
      isDeviceEntry(
        entry('main', '[IpcNobleConnection:meshtastic] peripheral disconnected'),
        'meshtastic',
      ),
    ).toBe(true);
  });

  it('does NOT classify [IpcNobleConnection:meshtastic] message as MeshCore device entry', () => {
    expect(
      isDeviceEntry(
        entry('main', '[IpcNobleConnection:meshtastic] peripheral disconnected'),
        'meshcore',
      ),
    ).toBe(false);
  });
});

describe('isDeviceEntry — no protocol (fallback)', () => {
  it('classifies meshtastic source as device entry', () => {
    expect(isDeviceEntry(entry('meshtastic', 'msg'))).toBe(true);
  });

  it('classifies meshcore source as device entry', () => {
    expect(isDeviceEntry(entry('meshcore', 'msg'))).toBe(true);
  });

  it('classifies [Meshtastic MQTT] message as app-level when no protocol', () => {
    expect(isDeviceEntry(entry('main', '[Meshtastic MQTT] something'))).toBe(false);
  });

  it('classifies [MeshCore MQTT] message as device entry', () => {
    expect(isDeviceEntry(entry('main', '[MeshCore MQTT] something'))).toBe(true);
  });

  it('classifies [iMeshDevice] message as device entry', () => {
    expect(isDeviceEntry(entry('main', '[iMeshDevice] something'))).toBe(true);
  });

  it('classifies [useMeshtasticRuntime] message as device entry', () => {
    expect(isDeviceEntry(entry('main', '[useMeshtasticRuntime] something'))).toBe(true);
  });

  it('classifies [useMeshcoreRuntime] message as device entry', () => {
    expect(isDeviceEntry(entry('main', '[useMeshcoreRuntime] something'))).toBe(true);
  });

  it('does NOT classify generic app-only message as device entry', () => {
    expect(isDeviceEntry(entry('main', 'App started successfully'))).toBe(false);
    expect(isDeviceEntry(entry('renderer', 'React mounted'))).toBe(false);
  });
});

describe('dual-mode appEntries guard', () => {
  it('Meshtastic [Meshtastic MQTT] entry appears in app view (not treated as device log)', () => {
    const mqttEntry = entry('main', '[Meshtastic MQTT] ServiceEnvelope decode failed');
    const isApp = !isDeviceEntry(mqttEntry, 'meshtastic') && !isDeviceEntry(mqttEntry, 'meshcore');
    expect(isApp).toBe(true);
  });

  it('MeshCore [MeshCore MQTT] entry is excluded from app view when Meshtastic is active', () => {
    const mqttEntry = entry('main', '[MeshCore MQTT] status: connected');
    const isApp = !isDeviceEntry(mqttEntry, 'meshtastic') && !isDeviceEntry(mqttEntry, 'meshcore');
    expect(isApp).toBe(false);
  });

  it('Meshtastic SDK entry is excluded from app view', () => {
    const sdkEntry = entry('meshtastic-sdk', 'packet decoded');
    const isApp = !isDeviceEntry(sdkEntry, 'meshtastic') && !isDeviceEntry(sdkEntry, 'meshcore');
    expect(isApp).toBe(false);
  });

  it('MeshCore source entry is excluded from app view', () => {
    const meshcoreEntry = entry('meshcore', 'rx rssi=-90');
    const isApp =
      !isDeviceEntry(meshcoreEntry, 'meshtastic') && !isDeviceEntry(meshcoreEntry, 'meshcore');
    expect(isApp).toBe(false);
  });

  it('[NobleBleManager] entry is excluded from app view', () => {
    const bleEntry = entry('main', '[NobleBleManager] startScanning error: peripheral lost');
    const isApp = !isDeviceEntry(bleEntry, 'meshtastic') && !isDeviceEntry(bleEntry, 'meshcore');
    expect(isApp).toBe(false);
  });

  it('generic app entry passes through to app view', () => {
    const appEntry = entry('main', 'Window created');
    const isApp = !isDeviceEntry(appEntry, 'meshtastic') && !isDeviceEntry(appEntry, 'meshcore');
    expect(isApp).toBe(true);
  });
});
