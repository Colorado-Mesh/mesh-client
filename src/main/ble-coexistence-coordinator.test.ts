import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BleCoexistenceCoordinator } from './ble-coexistence-coordinator';
import type { GattSessionProfile, GattSidecarProxy } from './gatt-sidecar-proxy';

function gattReservations(connections: ReturnType<GattSidecarProxy['getConnections']>) {
  return {
    getConnections: () => connections,
    setConnectionGuard:
      vi.fn<(guard: (session: GattSessionProfile, address: string) => void) => void>(),
    disconnectAll: vi.fn().mockResolvedValue(undefined),
  };
}

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

  it('rejects a LoRa connect to a registered Reticulum device', () => {
    const coordinator = new BleCoexistenceCoordinator();
    const gatt = gattReservations([]);
    coordinator.setGattProxy(gatt);
    coordinator.register('AA:BB:CC:DD:EE:01', 'reticulum');

    const guard = gatt.setConnectionGuard.mock.calls[0]?.[0];
    expect(guard).toBeDefined();
    expect(() => {
      guard('meshcore', 'aabbccddee01');
    }).toThrow(/already in use by reticulum/);
    expect(() => {
      guard('meshtastic', 'AA:BB:CC:DD:EE:02');
    }).not.toThrow();
  });

  it('rejects Reticulum registration while a LoRa connection is pending', () => {
    const coordinator = new BleCoexistenceCoordinator();
    const connections: ReturnType<GattSidecarProxy['getConnections']> = [
      { mac: 'AA:BB:CC:DD:EE:01', owner: 'gatt:meshcore' },
    ];
    coordinator.setGattProxy(gattReservations(connections));

    expect(() => {
      coordinator.register('aabbccddee01', 'reticulum');
    }).toThrow(/already in use by gatt:meshcore/);
    connections.length = 0;
    expect(() => {
      coordinator.register('aabbccddee01', 'reticulum');
    }).not.toThrow();
  });

  it('reports live LoRa reservations together with Reticulum ownership', () => {
    const coordinator = new BleCoexistenceCoordinator();
    coordinator.setGattProxy(
      gattReservations([{ mac: 'AA:BB:CC:DD:EE:01', owner: 'gatt:meshtastic' }]),
    );
    coordinator.register('AA:BB:CC:DD:EE:02', 'reticulum');

    expect(coordinator.getState().connections).toEqual(
      expect.arrayContaining([
        { mac: 'aa:bb:cc:dd:ee:01', owner: 'gatt:meshtastic' },
        { mac: 'aa:bb:cc:dd:ee:02', owner: 'reticulum' },
      ]),
    );
  });

  it('rejects a GATT scan while Reticulum is scanning', async () => {
    const coordinator = new BleCoexistenceCoordinator();
    const scan = vi.fn().mockResolvedValue(undefined);
    await coordinator.acquireScan('reticulum');

    await expect(coordinator.withScan('gatt', scan)).rejects.toThrow(/Bluetooth scan in progress/);
    expect(scan).not.toHaveBeenCalled();
    expect(coordinator.getState().scanOwner).toBe('reticulum');
  });

  it.each([false, true])(
    'releases the GATT scan lease after completion (failure=%s)',
    async (fails) => {
      const coordinator = new BleCoexistenceCoordinator();
      const operation = coordinator.withScan('gatt', async () => {
        await expect(coordinator.acquireScan('reticulum')).rejects.toThrow(
          /Bluetooth scan in progress/,
        );
        if (fails) throw new Error('adapter unavailable');
        return 'done';
      });
      if (fails) await expect(operation).rejects.toThrow('adapter unavailable');
      else await expect(operation).resolves.toBe('done');
      await expect(coordinator.acquireScan('reticulum')).resolves.toBeUndefined();
    },
  );

  it('suspendForReticulumBleConnect does not disconnect GATT sessions', async () => {
    const coordinator = new BleCoexistenceCoordinator();
    const gatt = gattReservations([]);
    coordinator.setGattProxy(gatt);
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
        const gatt = gattReservations([]);
        coordinator.setGattProxy(gatt);
        await coordinator.suspendForReticulumBleConnect();
        expect(gatt.disconnectAll).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process, 'platform', { value: original });
      }
    },
  );
});
