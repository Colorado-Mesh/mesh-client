import type { MeshDevice } from '@meshtastic/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransportSidecarGatt } from '../transportSidecarGatt';
import {
  cleanupSupersededStaleOpenedDevice,
  isMeshtasticAttachSupersededError,
  MESHTASTIC_ATTACH_SUPERSEDED_MESSAGE,
  supersededStaleDeviceCleanupMode,
} from './meshtasticAttachSuperseded';

vi.mock('../connection', () => ({
  safeDisconnect: vi.fn().mockResolvedValue(undefined),
}));

import { safeDisconnect } from '../connection';

/** Avoid constructing real GATT transports (needs window.electronAPI) in node tests. */
function fakeSidecarGattTransport(): TransportSidecarGatt {
  const toDevice = { close: vi.fn().mockResolvedValue(undefined) };
  const transport = { toDevice } as unknown as TransportSidecarGatt;
  Object.setPrototypeOf(transport, TransportSidecarGatt.prototype);
  return transport;
}

describe('isMeshtasticAttachSupersededError', () => {
  it('matches the attachRfSession supersession message', () => {
    expect(isMeshtasticAttachSupersededError(new Error(MESHTASTIC_ATTACH_SUPERSEDED_MESSAGE))).toBe(
      true,
    );
  });

  it('rejects unrelated connection failures', () => {
    expect(isMeshtasticAttachSupersededError(new Error('Connection failed'))).toBe(false);
    expect(
      isMeshtasticAttachSupersededError(new Error('Reconnect superseded during configure')),
    ).toBe(false);
  });
});

describe('supersededStaleDeviceCleanupMode', () => {
  it('rejects cleanup when the current device is still the opened device', () => {
    const device = { transport: {} } as unknown as MeshDevice;
    expect(supersededStaleDeviceCleanupMode(device, device)).toBe('noop-current-owner');
  });

  it('soft-retires shared GATT when a newer device owns the session', () => {
    const live = { transport: fakeSidecarGattTransport() } as unknown as MeshDevice;
    const stale = { transport: fakeSidecarGattTransport() } as unknown as MeshDevice;
    expect(supersededStaleDeviceCleanupMode(live, stale)).toBe('soft-retire-shared-gatt');
  });

  it('soft-retires shared GATT even when deviceRef was cleared mid-open', () => {
    const stale = { transport: fakeSidecarGattTransport() } as unknown as MeshDevice;
    expect(supersededStaleDeviceCleanupMode(null, stale)).toBe('soft-retire-shared-gatt');
  });

  it('safe-disconnects non-GATT stale transports when not current', () => {
    const live = { transport: {} } as unknown as MeshDevice;
    const stale = { transport: {} } as unknown as MeshDevice;
    expect(supersededStaleDeviceCleanupMode(live, stale)).toBe('safe-disconnect');
  });
});

describe('cleanupSupersededStaleOpenedDevice', () => {
  beforeEach(() => {
    vi.mocked(safeDisconnect).mockClear();
  });

  it('does not disconnect when the opened device still owns the connection', async () => {
    const device = {
      transport: {},
      complete: vi.fn(),
    } as unknown as MeshDevice;
    await cleanupSupersededStaleOpenedDevice(device, device);
    expect(safeDisconnect).not.toHaveBeenCalled();
    expect(device.complete).not.toHaveBeenCalled();
  });

  it('retires an owned stale GATT transport without safeDisconnect', async () => {
    const liveTransport = fakeSidecarGattTransport();
    const staleTransport = fakeSidecarGattTransport();
    const live = { transport: liveTransport, complete: vi.fn() } as unknown as MeshDevice;
    const stale = { transport: staleTransport, complete: vi.fn() } as unknown as MeshDevice;

    await cleanupSupersededStaleOpenedDevice(live, stale);

    expect(safeDisconnect).not.toHaveBeenCalled();
    expect(stale.complete).toHaveBeenCalledTimes(1);
    expect(staleTransport.toDevice.close).toHaveBeenCalledTimes(1);
  });

  it('safeDisconnects a non-GATT stale transport', async () => {
    const live = { transport: {}, complete: vi.fn() } as unknown as MeshDevice;
    const stale = { transport: {}, complete: vi.fn() } as unknown as MeshDevice;
    await cleanupSupersededStaleOpenedDevice(live, stale);
    expect(safeDisconnect).toHaveBeenCalledWith(stale);
  });
});
