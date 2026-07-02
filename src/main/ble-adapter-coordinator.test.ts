import { describe, expect, it, vi } from 'vitest';

import { BleAdapterBusyError, BleAdapterCoordinator } from './ble-adapter-coordinator';

describe('BleAdapterCoordinator', () => {
  it('grants reticulum lease after tearing down noble sessions', async () => {
    const noble = {
      stopAllScanning: vi.fn().mockResolvedValue(undefined),
      disconnectAllSessions: vi.fn().mockResolvedValue(undefined),
    };
    const coordinator = new BleAdapterCoordinator();
    coordinator.setNobleManager(noble as never);

    await coordinator.acquire('noble');
    expect(coordinator.getState().owner).toBe('noble');

    await coordinator.acquire('reticulum-sidecar');
    expect(noble.stopAllScanning).toHaveBeenCalled();
    expect(noble.disconnectAllSessions).toHaveBeenCalled();
    expect(coordinator.getState().owner).toBe('reticulum-sidecar');
  });

  it('rejects noble acquire while reticulum holds the adapter', async () => {
    const coordinator = new BleAdapterCoordinator();
    await coordinator.acquire('reticulum-sidecar');

    await expect(coordinator.acquire('noble')).rejects.toBeInstanceOf(BleAdapterBusyError);
    expect(coordinator.getState().owner).toBe('reticulum-sidecar');
  });

  it('release clears owner', async () => {
    const coordinator = new BleAdapterCoordinator();
    await coordinator.acquire('noble');
    coordinator.release('noble');
    expect(coordinator.getState().owner).toBeNull();
  });
});
