import type { MeshDevice } from '@meshtastic/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransportHttpIpc } from '../transportHttpIpc';
import { TransportSidecarGatt } from '../transportSidecarGatt';
import { TransportTcpIpc } from '../transportTcpIpc';
import {
  attachConfigureFailureAction,
  cleanupSupersededStaleOpenedDevice,
  isMeshtasticAttachSupersededError,
  MESHTASTIC_ATTACH_SUPERSEDED_MESSAGE,
  resolveSupersededAttemptLiveOwner,
  supersededStaleDeviceCleanupMode,
} from './meshtasticAttachSuperseded';

vi.mock('../connection', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const actual = await importOriginal<typeof import('../connection')>();
  return {
    ...actual,
    safeDisconnect: vi.fn().mockResolvedValue(undefined),
  };
});

import { safeDisconnect } from '../connection';

/** Avoid constructing real GATT transports (needs window.electronAPI) in node tests. */
function fakeSidecarGattTransport(): TransportSidecarGatt & {
  retireInbound: ReturnType<typeof vi.fn>;
} {
  const retireInbound = vi.fn();
  const transport = {
    retireInbound,
    toDevice: { close: vi.fn() },
  } as unknown as TransportSidecarGatt & {
    retireInbound: ReturnType<typeof vi.fn>;
  };
  Object.setPrototypeOf(transport, TransportSidecarGatt.prototype);
  return transport;
}

function fakeTcpTransport(): TransportTcpIpc & { retireInbound: ReturnType<typeof vi.fn> } {
  const retireInbound = vi.fn();
  const transport = { retireInbound } as unknown as TransportTcpIpc & {
    retireInbound: ReturnType<typeof vi.fn>;
  };
  Object.setPrototypeOf(transport, TransportTcpIpc.prototype);
  return transport;
}

function fakeHttpTransport(): TransportHttpIpc & { retireInbound: ReturnType<typeof vi.fn> } {
  const retireInbound = vi.fn();
  const transport = { retireInbound } as unknown as TransportHttpIpc & {
    retireInbound: ReturnType<typeof vi.fn>;
  };
  Object.setPrototypeOf(transport, TransportHttpIpc.prototype);
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

describe('attachConfigureFailureAction', () => {
  it('maps stale configure rejection to superseded and current to propagate', () => {
    expect(attachConfigureFailureAction(2, 1)).toBe('superseded');
    expect(attachConfigureFailureAction(1, 1)).toBe('propagate');
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
    expect(supersededStaleDeviceCleanupMode(live, stale)).toBe('soft-retire-shared-transport');
  });

  it('soft-retires shared TCP/HTTP even when deviceRef was cleared mid-open', () => {
    const staleTcp = { transport: fakeTcpTransport() } as unknown as MeshDevice;
    const staleHttp = { transport: fakeHttpTransport() } as unknown as MeshDevice;
    expect(supersededStaleDeviceCleanupMode(null, staleTcp)).toBe('soft-retire-shared-transport');
    expect(supersededStaleDeviceCleanupMode(null, staleHttp)).toBe('soft-retire-shared-transport');
  });

  it('soft-retires when stale and live share the same SerialPort', () => {
    const sharedPort = { close: vi.fn() } as unknown as SerialPort;
    const live = { transport: { port: sharedPort }, complete: vi.fn() } as unknown as MeshDevice;
    const stale = { transport: { port: sharedPort }, complete: vi.fn() } as unknown as MeshDevice;
    expect(supersededStaleDeviceCleanupMode(live, stale)).toBe('soft-retire-shared-transport');
  });

  it('safe-disconnects unrelated non-shared transports when not current', () => {
    const live = { transport: {} } as unknown as MeshDevice;
    const stale = { transport: {} } as unknown as MeshDevice;
    expect(supersededStaleDeviceCleanupMode(live, stale)).toBe('safe-disconnect');
  });
});

describe('resolveSupersededAttemptLiveOwner', () => {
  it('keeps noop-current-owner when refs match and the attempt is still live', () => {
    const device = { transport: fakeSidecarGattTransport() } as unknown as MeshDevice;
    expect(resolveSupersededAttemptLiveOwner(device, device, false)).toBe(device);
  });

  it('treats equal refs as no live owner when the attempt is superseded', () => {
    const device = { transport: fakeSidecarGattTransport() } as unknown as MeshDevice;
    expect(resolveSupersededAttemptLiveOwner(device, device, true)).toBe(null);
    expect(resolveSupersededAttemptLiveOwner(null, device, true)).toBe(null);
  });

  it('returns the live device when a newer session owns deviceRef', () => {
    const live = { transport: fakeSidecarGattTransport() } as unknown as MeshDevice;
    const stale = { transport: fakeSidecarGattTransport() } as unknown as MeshDevice;
    expect(resolveSupersededAttemptLiveOwner(live, stale, true)).toBe(live);
  });
});

describe('cleanupSupersededStaleOpenedDevice', () => {
  beforeEach(() => {
    vi.mocked(safeDisconnect).mockClear();
  });

  it('soft-retires GATT/TCP/HTTP when refs match but supersession cleared live owner to null', async () => {
    const gatt = fakeSidecarGattTransport();
    const stale = { transport: gatt, complete: vi.fn() } as unknown as MeshDevice;
    const liveOwner = resolveSupersededAttemptLiveOwner(stale, stale, true);
    await cleanupSupersededStaleOpenedDevice(liveOwner, stale);
    expect(gatt.retireInbound).toHaveBeenCalledTimes(1);
    expect(safeDisconnect).not.toHaveBeenCalled();
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

  it('retires an owned stale GATT transport via retireInbound without safeDisconnect', async () => {
    const liveTransport = fakeSidecarGattTransport();
    const staleTransport = fakeSidecarGattTransport();
    const live = { transport: liveTransport, complete: vi.fn() } as unknown as MeshDevice;
    const stale = { transport: staleTransport, complete: vi.fn() } as unknown as MeshDevice;

    await cleanupSupersededStaleOpenedDevice(live, stale);

    expect(safeDisconnect).not.toHaveBeenCalled();
    expect(stale.complete).toHaveBeenCalledTimes(1);
    expect(staleTransport.retireInbound).toHaveBeenCalledTimes(1);
    expect(liveTransport.retireInbound).not.toHaveBeenCalled();
    expect(staleTransport.toDevice.close).not.toHaveBeenCalled();
  });

  it('soft-retires stale TCP after a newer owner opens without session disconnect', async () => {
    const liveTransport = fakeTcpTransport();
    const staleTransport = fakeTcpTransport();
    const live = { transport: liveTransport, complete: vi.fn() } as unknown as MeshDevice;
    const stale = { transport: staleTransport, complete: vi.fn() } as unknown as MeshDevice;

    await cleanupSupersededStaleOpenedDevice(live, stale);

    expect(safeDisconnect).not.toHaveBeenCalled();
    expect(staleTransport.retireInbound).toHaveBeenCalledTimes(1);
    expect(liveTransport.retireInbound).not.toHaveBeenCalled();
  });

  it('soft-retires stale HTTP after a newer owner opens without session disconnect', async () => {
    const liveTransport = fakeHttpTransport();
    const staleTransport = fakeHttpTransport();
    const live = { transport: liveTransport, complete: vi.fn() } as unknown as MeshDevice;
    const stale = { transport: staleTransport, complete: vi.fn() } as unknown as MeshDevice;

    await cleanupSupersededStaleOpenedDevice(live, stale);

    expect(safeDisconnect).not.toHaveBeenCalled();
    expect(staleTransport.retireInbound).toHaveBeenCalledTimes(1);
    expect(liveTransport.retireInbound).not.toHaveBeenCalled();
  });

  it('does not close a SerialPort shared with the live device', async () => {
    const close = vi.fn();
    const sharedPort = { close, readable: {}, writable: {} } as unknown as SerialPort;
    const fromDeviceCancel = vi.fn().mockResolvedValue(undefined);
    const live = {
      transport: { port: sharedPort, fromDevice: { cancel: vi.fn() } },
      complete: vi.fn(),
    } as unknown as MeshDevice;
    const stale = {
      transport: { port: sharedPort, fromDevice: { cancel: fromDeviceCancel } },
      complete: vi.fn(),
    } as unknown as MeshDevice;

    await cleanupSupersededStaleOpenedDevice(live, stale);

    expect(safeDisconnect).not.toHaveBeenCalled();
    expect(stale.complete).toHaveBeenCalledTimes(1);
    expect(fromDeviceCancel).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('safeDisconnects a non-shared stale transport', async () => {
    const live = { transport: {}, complete: vi.fn() } as unknown as MeshDevice;
    const stale = { transport: {}, complete: vi.fn() } as unknown as MeshDevice;
    await cleanupSupersededStaleOpenedDevice(live, stale);
    expect(safeDisconnect).toHaveBeenCalledWith(stale);
  });
});
