import { describe, expect, it } from 'vitest';

import {
  isAppLogLine,
  isDeviceLogLine,
  isOwnedByOther,
  listLogTagScopeKeys,
  LOG_TAG_SCOPE,
  resolveLogProtocol,
  resolveLogSurface,
} from './logProtocolScope';

function line(
  message: string,
  source = 'main',
  protocol?: 'meshtastic' | 'meshcore' | 'reticulum',
) {
  return protocol ? { source, message, protocol } : { source, message };
}

describe('logProtocolScope registry', () => {
  it('exposes a substantial tag registry', () => {
    expect(listLogTagScopeKeys().length).toBeGreaterThan(40);
  });

  it('resolves appendix-style owned tags', () => {
    expect(resolveLogProtocol(line('[meshtasticTransportLoss] serial link lost'))).toBe(
      'meshtastic',
    );
    expect(resolveLogProtocol(line('[meshcoreSerialTransportLoss] link lost'))).toBe('meshcore');
    expect(resolveLogProtocol(line('[ReticulumSidecar] WARN decrypt failed'))).toBe('reticulum');
    expect(resolveLogProtocol(line('[MeshCore MQTT] PINGRESP'))).toBe('meshcore');
    expect(resolveLogSurface(line('[MeshCore MQTT] PINGRESP'))).toBe('app');
    expect(resolveLogSurface(line('[Meshtastic MQTT] decode failed'))).toBe('app');
  });

  it('keeps bare GATT/BLE shared (no Meshtastic guess)', () => {
    expect(resolveLogProtocol(line('[GATT] ws parse failed'))).toBeUndefined();
    expect(resolveLogProtocol(line('[GATT:all] adapter_missing'))).toBeUndefined();
    expect(resolveLogProtocol(line('[BLE:abc123] connect failed'))).toBeUndefined();
    expect(resolveLogSurface(line('[GATT] ws parse failed'))).toBe('device');
    expect(resolveLogSurface(line('[Connection] connected'))).toBe('device');
  });

  it('attributes session-scoped GATT/BLE/sidecar tags', () => {
    expect(resolveLogProtocol(line('[GATT:meshcore] connect_timeout'))).toBe('meshcore');
    expect(resolveLogProtocol(line('[GATT:meshtastic] connect_timeout'))).toBe('meshtastic');
    expect(resolveLogProtocol(line('[BLE:meshcore] coalesce failed'))).toBe('meshcore');
    expect(resolveLogProtocol(line('[IpcSidecarGattConnection:meshtastic] disconnected'))).toBe(
      'meshtastic',
    );
  });

  it('uses longest-prefix so ReticulumSidecar is not swallowed by Reticulum', () => {
    expect(resolveLogProtocol(line('[ReticulumSidecar] ready'))).toBe('reticulum');
    expect(LOG_TAG_SCOPE['[ReticulumSidecar]']).toMatchObject({ protocol: 'reticulum' });
    expect(LOG_TAG_SCOPE['[Reticulum]']).toMatchObject({ protocol: 'reticulum' });
  });

  it('lets explicit protocol win over message tags', () => {
    expect(resolveLogProtocol(line('[meshtasticTransportLoss] lost', 'main', 'meshcore'))).toBe(
      'meshcore',
    );
  });

  it('parses Connection stack= before generic Connection tag', () => {
    expect(resolveLogProtocol(line('[Connection] connected stack=meshtastic path=serial'))).toBe(
      'meshtastic',
    );
    expect(resolveLogProtocol(line('[Connection] connected stack=meshcore path=ble'))).toBe(
      'meshcore',
    );
  });

  it('parses IPC / main gatt session / RF auto-connect channel forms', () => {
    expect(resolveLogProtocol(line('[IPC] meshtastic:tcp-connect error: refused'))).toBe(
      'meshtastic',
    );
    expect(resolveLogProtocol(line('[IPC] reticulum start failed'))).toBe('reticulum');
    expect(
      resolveLogProtocol(
        line('[main] gatt:connect failed: session=meshcore peripheral=AA:BB message=timeout'),
      ),
    ).toBe('meshcore');
    expect(
      resolveLogProtocol(
        line('[useProtocolRfAutoConnect] meshtastic auto-connect timed out after 30s'),
      ),
    ).toBe('meshtastic');
    expect(
      resolveLogProtocol(
        line(
          '[useProtocolRfAutoConnect] meshcore BLE auto-connect skipped — same peripheral as Meshtastic',
        ),
      ),
    ).toBeUndefined();
  });

  it('maps sdk source to meshtastic', () => {
    expect(resolveLogProtocol(line('Packet timed out', 'sdk'))).toBe('meshtastic');
    expect(resolveLogSurface(line('Packet timed out', 'sdk'))).toBe('device');
  });

  it('returns undefined for unknown tags (shared)', () => {
    expect(resolveLogProtocol(line('[TotallyUnknownModule] boom'))).toBeUndefined();
    expect(resolveLogSurface(line('[TotallyUnknownModule] boom'))).toBe('app');
  });

  it('isOwnedByOther / device / app helpers', () => {
    const mtLoss = line('[meshtasticTransportLoss] serial link lost');
    expect(isOwnedByOther(mtLoss, 'meshcore')).toBe(true);
    expect(isDeviceLogLine(mtLoss, 'meshtastic')).toBe(true);
    expect(isDeviceLogLine(mtLoss, 'meshcore')).toBe(false);
    expect(isAppLogLine(mtLoss, 'meshcore')).toBe(false);

    const mqtt = line('[MeshCore MQTT] PINGRESP');
    expect(isDeviceLogLine(mqtt, 'meshcore')).toBe(false);
    expect(isAppLogLine(mqtt, 'meshcore')).toBe(true);
    expect(isAppLogLine(mqtt, 'meshtastic')).toBe(false);

    const sharedGatt = line('[GATT] ws parse failed');
    expect(isDeviceLogLine(sharedGatt, 'meshtastic')).toBe(true);
    expect(isDeviceLogLine(sharedGatt, 'meshcore')).toBe(true);
    expect(isAppLogLine(sharedGatt, 'meshtastic')).toBe(false);
  });

  it('meshcoreRoom / meshcoreRepeater family prefixes', () => {
    expect(resolveLogProtocol(line('[meshcoreRoomSession] login failed'))).toBe('meshcore');
    expect(resolveLogProtocol(line('[meshcoreRepeaterSession] login failed'))).toBe('meshcore');
    expect(resolveLogSurface(line('[meshcoreRoomSession] login failed'))).toBe('app');
  });
});
