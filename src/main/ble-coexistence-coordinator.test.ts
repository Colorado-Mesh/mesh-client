import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BleCoexistenceCoordinator } from './ble-coexistence-coordinator';

describe('BleCoexistenceCoordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects same MAC for two owners', () => {
    const coordinator = new BleCoexistenceCoordinator();
    coordinator.register('AA:BB:CC:DD:EE:01', 'gatt:meshtastic');
    expect(() => {
      coordinator.register('AA:BB:CC:DD:EE:01', 'gatt:meshcore');
    }).toThrow(/already in use/);
  });

  it('allows different MACs for meshtastic and meshcore', () => {
    const coordinator = new BleCoexistenceCoordinator();
    coordinator.register('AA:BB:CC:DD:EE:01', 'gatt:meshtastic');
    coordinator.register('AA:BB:CC:DD:EE:02', 'gatt:meshcore');
    const state = coordinator.getState();
    expect(state.connections).toEqual(
      expect.arrayContaining([
        { mac: 'aa:bb:cc:dd:ee:01', owner: 'gatt:meshtastic' },
        { mac: 'aa:bb:cc:dd:ee:02', owner: 'gatt:meshcore' },
      ]),
    );
  });

  it('suspendForReticulumBleConnect does not disconnect GATT sessions', async () => {
    const coordinator = new BleCoexistenceCoordinator();
    const gatt = {
      disconnectAll: vi.fn().mockResolvedValue(undefined),
    };
    coordinator.setGattProxy(gatt as never);
    await coordinator.suspendForReticulumBleConnect();
    expect(gatt.disconnectAll).not.toHaveBeenCalled();
  });

  it.each(['linux', 'darwin', 'win32'] as const)(
    'suspendForReticulumBleConnect is a no-op on %s',
    async (platform) => {
      const original = process.platform;
      Object.defineProperty(process, 'platform', { value: platform });
      try {
        const coordinator = new BleCoexistenceCoordinator();
        const gatt = { disconnectAll: vi.fn().mockResolvedValue(undefined) };
        coordinator.setGattProxy(gatt as never);
        await coordinator.suspendForReticulumBleConnect();
        expect(gatt.disconnectAll).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process, 'platform', { value: original });
      }
    },
  );
});
