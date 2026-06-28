import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildMeshcoreConnectionParamsFromLastConnection,
  buildMeshtasticConnectionParamsFromLastConnection,
  type LastConnection,
  loadLastBleDeviceId,
  loadLastConnection,
  rehydrateMeshcoreConnectionParamsFromStorage,
  rehydrateMeshtasticConnectionParamsFromStorage,
  resolveLastBlePeripheralId,
  resolveLastHttpAddress,
  resolveLastSerialPortId,
} from './lastConnectionStorage';

describe('lastConnectionStorage reconnect rehydrate', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
  });

  it('builds MeshCore BLE params from last connection', () => {
    const last: LastConnection = { type: 'ble', bleDeviceId: 'eccf2847e1fd3f5f0811064db1639a3d' };
    expect(buildMeshcoreConnectionParamsFromLastConnection(last)).toEqual({
      rfType: 'ble',
      blePeripheralId: 'eccf2847e1fd3f5f0811064db1639a3d',
      serialPort: null,
    });
  });

  it('builds MeshCore serial and TCP params from last connection', () => {
    expect(
      buildMeshcoreConnectionParamsFromLastConnection({
        type: 'serial',
        serialPortId: 'usb-port-1',
      }),
    ).toEqual({
      rfType: 'serial',
      serialPortId: 'usb-port-1',
      serialPort: null,
    });
    expect(
      buildMeshcoreConnectionParamsFromLastConnection({
        type: 'http',
        httpAddress: '192.168.1.50:4403',
      }),
    ).toEqual({
      rfType: 'tcp',
      httpAddress: '192.168.1.50:4403',
      serialPort: null,
    });
  });

  it('rehydrates MeshCore params from localStorage after in-memory ref loss', () => {
    localStorage.setItem(
      'mesh-client:lastConnection:meshcore',
      JSON.stringify({ type: 'ble', bleDeviceId: 'eccf2847e1fd3f5f0811064db1639a3d' }),
    );
    expect(rehydrateMeshcoreConnectionParamsFromStorage()).toEqual({
      rfType: 'ble',
      blePeripheralId: 'eccf2847e1fd3f5f0811064db1639a3d',
      serialPort: null,
    });
  });

  it('builds Meshtastic BLE params from last connection', () => {
    const last: LastConnection = { type: 'ble', bleDeviceId: '7b2a14115e0c24275b50f7c2ee8f6f9e' };
    expect(buildMeshtasticConnectionParamsFromLastConnection(last)).toEqual({
      type: 'ble',
      blePeripheralId: '7b2a14115e0c24275b50f7c2ee8f6f9e',
      serialPort: null,
    });
  });

  it('builds Meshtastic serial and HTTP params from last connection', () => {
    expect(
      buildMeshtasticConnectionParamsFromLastConnection({
        type: 'serial',
        serialPortId: 'com3',
      }),
    ).toEqual({
      type: 'serial',
      lastSerialPortId: 'com3',
      serialPort: null,
    });
    expect(
      buildMeshtasticConnectionParamsFromLastConnection({
        type: 'http',
        httpAddress: 'meshtastic.local',
      }),
    ).toEqual({
      type: 'http',
      httpAddress: 'meshtastic.local',
      serialPort: null,
    });
  });

  it('rehydrates Meshtastic params from localStorage', () => {
    localStorage.setItem(
      'mesh-client:lastConnection:meshtastic',
      JSON.stringify({ type: 'ble', bleDeviceId: '7b2a14115e0c24275b50f7c2ee8f6f9e' }),
    );
    expect(rehydrateMeshtasticConnectionParamsFromStorage()).toEqual({
      type: 'ble',
      blePeripheralId: '7b2a14115e0c24275b50f7c2ee8f6f9e',
      serialPort: null,
    });
  });

  it('returns null for malformed last-connection JSON', () => {
    localStorage.setItem('mesh-client:lastConnection:meshcore', '{not-json');
    expect(loadLastConnection('meshcore')).toBeNull();
    expect(rehydrateMeshcoreConnectionParamsFromStorage()).toBeNull();
  });

  it('falls back to lastBleDevice when bleDeviceId is absent from last connection', () => {
    localStorage.setItem('mesh-client:lastConnection:meshtastic', JSON.stringify({ type: 'ble' }));
    localStorage.setItem('mesh-client:lastBleDevice:meshtastic', 'fallback-ble-id');
    expect(resolveLastBlePeripheralId('meshtastic')).toBe('fallback-ble-id');
    expect(loadLastBleDeviceId('meshtastic')).toBe('fallback-ble-id');
    expect(rehydrateMeshtasticConnectionParamsFromStorage()).toEqual({
      type: 'ble',
      blePeripheralId: 'fallback-ble-id',
      serialPort: null,
    });
  });

  it('resolves HTTP and serial helpers from stored last connection', () => {
    localStorage.setItem(
      'mesh-client:lastConnection:meshcore',
      JSON.stringify({ type: 'http', httpAddress: '10.0.0.5:4403' }),
    );
    expect(resolveLastHttpAddress('meshcore')).toBe('10.0.0.5:4403');
    localStorage.setItem(
      'mesh-client:lastConnection:meshtastic',
      JSON.stringify({ type: 'serial', serialPortId: 'ttyUSB0' }),
    );
    expect(resolveLastSerialPortId('meshtastic')).toBe('ttyUSB0');
  });
});
