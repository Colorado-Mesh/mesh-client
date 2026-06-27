import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildMeshcoreConnectionParamsFromLastConnection,
  buildMeshtasticConnectionParamsFromLastConnection,
  type LastConnection,
  rehydrateMeshcoreConnectionParamsFromStorage,
  rehydrateMeshtasticConnectionParamsFromStorage,
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
});
