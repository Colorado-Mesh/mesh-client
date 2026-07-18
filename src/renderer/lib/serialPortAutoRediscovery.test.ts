import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureSerialIdentityForRediscovery,
  SERIAL_REDISCOVERY_POLL_MS,
  SERIAL_REDISCOVERY_TIMEOUT_MS,
  startSerialRediscovery,
} from './serialPortAutoRediscovery';

function mockPort(opts: {
  portId?: string;
  usbVendorId?: number;
  usbProductId?: number;
}): SerialPort {
  return {
    portId: opts.portId,
    getInfo: () => ({
      usbVendorId: opts.usbVendorId,
      usbProductId: opts.usbProductId,
    }),
  } as unknown as SerialPort;
}

describe('serialPortAutoRediscovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'serial', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  it('captures signature and portId from a granted port', () => {
    const port = mockPort({ portId: 'p1', usbVendorId: 0x10c4, usbProductId: 0xea60 });
    expect(captureSerialIdentityForRediscovery(port)).toEqual({
      signature: {
        usbVendorId: 0x10c4,
        usbProductId: 0xea60,
        bluetoothServiceClassId: undefined,
      },
      portId: 'p1',
    });
  });

  it('invokes onFound when a matching port appears', async () => {
    const target = mockPort({ portId: 'p1', usbVendorId: 1, usbProductId: 2 });
    const getPorts = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([target]);
    Object.defineProperty(navigator, 'serial', {
      value: { getPorts },
      configurable: true,
      writable: true,
    });

    const onFound = vi.fn();
    const stop = startSerialRediscovery({
      signature: { usbVendorId: 1, usbProductId: 2 },
      portId: 'p1',
      onFound,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onFound).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SERIAL_REDISCOVERY_POLL_MS);
    expect(onFound).toHaveBeenCalledWith(target);

    stop();
  });

  it('stops polling after timeout without a match', async () => {
    const getPorts = vi.fn().mockResolvedValue([]);
    Object.defineProperty(navigator, 'serial', {
      value: { getPorts },
      configurable: true,
      writable: true,
    });

    const onFound = vi.fn();
    startSerialRediscovery({
      signature: { usbVendorId: 1, usbProductId: 2 },
      onFound,
      timeoutMs: SERIAL_REDISCOVERY_TIMEOUT_MS,
    });

    await vi.advanceTimersByTimeAsync(SERIAL_REDISCOVERY_TIMEOUT_MS + SERIAL_REDISCOVERY_POLL_MS);
    expect(onFound).not.toHaveBeenCalled();
    const callsAfterTimeout = getPorts.mock.calls.length;
    await vi.advanceTimersByTimeAsync(SERIAL_REDISCOVERY_POLL_MS * 3);
    expect(getPorts.mock.calls.length).toBe(callsAfterTimeout);
  });

  it('cleanup cancels further polls', async () => {
    const getPorts = vi.fn().mockResolvedValue([]);
    Object.defineProperty(navigator, 'serial', {
      value: { getPorts },
      configurable: true,
      writable: true,
    });

    const stop = startSerialRediscovery({
      signature: { usbVendorId: 1, usbProductId: 2 },
      onFound: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    const before = getPorts.mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(SERIAL_REDISCOVERY_POLL_MS * 2);
    expect(getPorts.mock.calls.length).toBe(before);
  });

  it('does not call onFound after cleanup races with in-flight getPorts', async () => {
    let resolvePorts: (ports: SerialPort[]) => void = () => {};
    const getPorts = vi.fn(
      () =>
        new Promise<SerialPort[]>((resolve) => {
          resolvePorts = resolve;
        }),
    );
    Object.defineProperty(navigator, 'serial', {
      value: { getPorts },
      configurable: true,
      writable: true,
    });

    const onFound = vi.fn();
    const stop = startSerialRediscovery({
      signature: { usbVendorId: 1, usbProductId: 2 },
      onFound,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(getPorts).toHaveBeenCalled();
    stop();
    resolvePorts([mockPort({ portId: 'p1', usbVendorId: 1, usbProductId: 2 })]);
    await Promise.resolve();
    await Promise.resolve();
    expect(onFound).not.toHaveBeenCalled();
  });
});
