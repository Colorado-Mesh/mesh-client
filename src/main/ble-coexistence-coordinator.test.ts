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

  it.each(['darwin', 'win32'] as const)(
    'suspendNobleForReticulumBleConnect acquires reticulum scan and disconnects noble sessions on %s',
    async (platform) => {
      const noble = {
        pauseScanningForExternalScan: vi.fn().mockResolvedValue(undefined),
        resumeScanningAfterExternalScan: vi.fn().mockResolvedValue(undefined),
        disconnectAllSessions: vi.fn().mockResolvedValue(undefined),
      };
      const coordinator = new BleCoexistenceCoordinator();
      coordinator.setNobleManager(noble as never);

      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });

      try {
        await coordinator.suspendNobleForReticulumBleConnect();
        expect(coordinator.getState().scanOwner).toBe('reticulum');
        expect(noble.pauseScanningForExternalScan).toHaveBeenCalled();
        expect(noble.disconnectAllSessions).toHaveBeenCalled();
      } finally {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true,
        });
      }
    },
  );

  it('suspendNobleForReticulumBleConnect acquires reticulum scan but does not disconnect noble sessions on linux', async () => {
    // Linux mesh BLE uses Web Bluetooth (no Noble GATT sessions to contend with); only
    // macOS/Windows CoreBluetooth/WinRT need the disconnect-all handshake before btleplug connects.
    const noble = {
      pauseScanningForExternalScan: vi.fn().mockResolvedValue(undefined),
      resumeScanningAfterExternalScan: vi.fn().mockResolvedValue(undefined),
      disconnectAllSessions: vi.fn().mockResolvedValue(undefined),
    };
    const coordinator = new BleCoexistenceCoordinator();
    coordinator.setNobleManager(noble as never);

    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    try {
      await coordinator.suspendNobleForReticulumBleConnect();
      expect(coordinator.getState().scanOwner).toBe('reticulum');
      expect(noble.pauseScanningForExternalScan).toHaveBeenCalled();
      expect(noble.disconnectAllSessions).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it.each(['darwin', 'win32'] as const)(
    'suspendNobleForReticulumBleConnect releases yield when Noble disconnect times out on %s',
    async (platform) => {
      const noble = {
        pauseScanningForExternalScan: vi.fn().mockResolvedValue(undefined),
        resumeScanningAfterExternalScan: vi.fn().mockResolvedValue(undefined),
        disconnectAllSessions: vi.fn().mockImplementation(
          () => new Promise(() => undefined), // never resolves
        ),
      };
      const coordinator = new BleCoexistenceCoordinator();
      coordinator.setNobleManager(noble as never);

      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
      vi.useFakeTimers();

      try {
        const pending = coordinator.suspendNobleForReticulumBleConnect();
        const expectation = expect(pending).rejects.toThrow(/Noble disconnectAll timeout/);
        await vi.advanceTimersByTimeAsync(30_000);
        await expectation;
        expect(coordinator.getState().scanOwner).toBeNull();
      } finally {
        vi.useRealTimers();
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true,
        });
      }
    },
  );

  it('assertCanConnect rejects Noble while reticulum holds the scan yield', async () => {
    const coordinator = new BleCoexistenceCoordinator();
    await coordinator.acquireScan('reticulum');
    expect(() => {
      coordinator.assertCanConnect('noble:meshtastic', 'aa:bb:cc:dd:ee:01');
    }).toThrow(BleScanBusyError);
    expect(() => {
      coordinator.assertCanConnect('noble:meshcore', 'aa:bb:cc:dd:ee:02');
    }).toThrow(BleScanBusyError);
    coordinator.releaseScan('reticulum');
    expect(() => {
      coordinator.assertCanConnect('noble:meshtastic', 'aa:bb:cc:dd:ee:01');
    }).not.toThrow();
  });

  it('nests same-owner acquireScan so nested release does not drop the outer lease', async () => {
    const noble = {
      pauseScanningForExternalScan: vi.fn().mockResolvedValue(undefined),
      resumeScanningAfterExternalScan: vi.fn().mockResolvedValue(undefined),
    };
    const coordinator = new BleCoexistenceCoordinator();
    coordinator.setNobleManager(noble as never);

    // Outer hold (Noble yield for BLE RNode connect).
    await coordinator.acquireScan('reticulum');
    expect(coordinator.getState().scanOwner).toBe('reticulum');

    // Nested RSSI poll acquire — same owner.
    await coordinator.acquireScan('reticulum');
    expect(coordinator.getState().scanOwner).toBe('reticulum');

    // Nested release must not drop the yield hold.
    coordinator.releaseScan('reticulum');
    expect(coordinator.getState().scanOwner).toBe('reticulum');
    expect(noble.resumeScanningAfterExternalScan).not.toHaveBeenCalled();

    // Outer release clears ownership.
    coordinator.releaseScan('reticulum');
    expect(coordinator.getState().scanOwner).toBeNull();
    expect(noble.resumeScanningAfterExternalScan).toHaveBeenCalledTimes(1);
  });
});
