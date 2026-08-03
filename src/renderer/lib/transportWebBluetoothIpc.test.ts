import { describe, expect, it, vi } from 'vitest';

const { mockRequestDevice, mockAcquireGrantedDeviceById } = vi.hoisted(() => ({
  mockRequestDevice: vi.fn(),
  mockAcquireGrantedDeviceById: vi.fn(),
}));

vi.mock('./webbluetooth-ble-manager', () => ({
  WebBluetoothManager: vi.fn().mockImplementation(function WebBluetoothManager() {
    return {
      requestDevice: mockRequestDevice,
      acquireGrantedDeviceById: mockAcquireGrantedDeviceById,
    };
  }),
}));

import { TransportWebBluetoothIpc } from './transportWebBluetoothIpc';

describe('TransportWebBluetoothIpc.getConnectedDeviceId', () => {
  it('is null before a device is resolved', () => {
    const transport = new TransportWebBluetoothIpc('meshtastic');
    expect(transport.getConnectedDeviceId()).toBeNull();
  });

  it('returns the device id resolved by requestDevice() (gesture-based picker flow)', async () => {
    mockRequestDevice.mockResolvedValue({ id: 'AA:BB:CC:DD:EE:FF', name: 'Radio' });
    const transport = new TransportWebBluetoothIpc('meshtastic');

    await transport.requestDevice();

    expect(transport.getConnectedDeviceId()).toBe('AA:BB:CC:DD:EE:FF');
  });

  it('returns the device id resolved by requestGrantedDevice() (no-gesture reconnect flow)', async () => {
    mockAcquireGrantedDeviceById.mockResolvedValue({ id: 'AA:BB:CC:DD:EE:FF', name: 'Radio' });
    const transport = new TransportWebBluetoothIpc('meshtastic');

    await transport.requestGrantedDevice('AA:BB:CC:DD:EE:FF');

    expect(transport.getConnectedDeviceId()).toBe('AA:BB:CC:DD:EE:FF');
  });
});
