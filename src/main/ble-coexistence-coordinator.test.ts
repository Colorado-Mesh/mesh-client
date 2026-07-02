import { describe, expect, it, vi } from 'vitest';

import {
  BleCoexistenceCoordinator,
  BlePeripheralConflictError,
  BleScanBusyError,
  normalizeBleMac,
} from './ble-coexistence-coordinator';

describe('BleCoexistenceCoordinator', () => {
  it('normalizes MAC addresses for registry keys', () => {
    expect(normalizeBleMac('AA:BB:CC:DD:EE:FF')).toBe('aa:bb:cc:dd:ee:ff');
    expect(normalizeBleMac('AABBCCDDEEFF')).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('registers and unregisters peripheral ownership', () => {
    const coordinator = new BleCoexistenceCoordinator();
    coordinator.register('AA:BB:CC:DD:EE:01', 'noble:meshtastic');
    expect(coordinator.getState().connections).toEqual([
      { mac: 'aa:bb:cc:dd:ee:01', owner: 'noble:meshtastic' },
    ]);
    coordinator.unregister('AA:BB:CC:DD:EE:01', 'noble:meshtastic');
    expect(coordinator.getState().connections).toEqual([]);
  });

  it('rejects registering the same MAC to a different owner', () => {
    const coordinator = new BleCoexistenceCoordinator();
    coordinator.register('aa:bb:cc:dd:ee:02', 'noble:meshcore');
    expect(() => {
      coordinator.register('AA:BB:CC:DD:EE:02', 'reticulum');
    }).toThrow(BlePeripheralConflictError);
  });

  it('serializes scan leases without disconnecting noble sessions', async () => {
    const noble = {
      pauseScanningForExternalScan: vi.fn().mockResolvedValue(undefined),
      resumeScanningAfterExternalScan: vi.fn().mockResolvedValue(undefined),
    };
    const coordinator = new BleCoexistenceCoordinator();
    coordinator.setNobleManager(noble as never);

    await coordinator.acquireScan('noble');
    expect(coordinator.getState().scanOwner).toBe('noble');

    await expect(coordinator.acquireScan('reticulum')).rejects.toBeInstanceOf(BleScanBusyError);

    coordinator.releaseScan('noble');
    await coordinator.acquireScan('reticulum');
    expect(noble.pauseScanningForExternalScan).toHaveBeenCalled();
    expect(coordinator.getState().scanOwner).toBe('reticulum');

    coordinator.releaseScan('reticulum');
    expect(noble.resumeScanningAfterExternalScan).toHaveBeenCalled();
    expect(coordinator.getState().scanOwner).toBeNull();
  });
});
