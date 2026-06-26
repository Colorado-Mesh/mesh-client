// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachSerialServiceDisconnectListener,
  clearPersistedSerialPortIdentity,
  forgetGrantedSerialPortBestEffort,
  openSerialPortWithTimeout,
  SERIAL_OPEN_TIMEOUT_MS,
  serialPortMatchesPersistedIdentity,
  withSerialTransportTimeout,
} from './serialPortRecovery';
import { LAST_SERIAL_PORT_KEY, LAST_SERIAL_PORT_SIGNATURE_KEY } from './serialPortSignature';

describe('serialPortRecovery', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.useFakeTimers();
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('openSerialPortWithTimeout rejects when open hangs', async () => {
    const port = {
      open: vi.fn(() => new Promise<void>(() => {})),
    } as unknown as SerialPort;

    const openPromise = openSerialPortWithTimeout(port, 115200, 'test open');
    const rejection = expect(openPromise).rejects.toThrow(/test open timed out/);
    await vi.advanceTimersByTimeAsync(SERIAL_OPEN_TIMEOUT_MS);
    await rejection;
  });

  it('withSerialTransportTimeout resolves when promise settles in time', async () => {
    await expect(withSerialTransportTimeout(Promise.resolve('ok'), 'transport')).resolves.toBe(
      'ok',
    );
  });

  it('clearPersistedSerialPortIdentity removes stored keys', () => {
    localStorage.setItem(LAST_SERIAL_PORT_KEY, 'p1');
    localStorage.setItem(LAST_SERIAL_PORT_SIGNATURE_KEY, '{"usbVendorId":1}');
    clearPersistedSerialPortIdentity();
    expect(localStorage.getItem(LAST_SERIAL_PORT_KEY)).toBeNull();
    expect(localStorage.getItem(LAST_SERIAL_PORT_SIGNATURE_KEY)).toBeNull();
  });

  it('serialPortMatchesPersistedIdentity matches portId', () => {
    localStorage.setItem(LAST_SERIAL_PORT_KEY, 'port-a');
    const port = {
      portId: 'port-a',
      getInfo: () => ({}),
    } as SerialPort & { portId: string };
    expect(serialPortMatchesPersistedIdentity(port)).toBe(true);
  });

  it('forgetGrantedSerialPortBestEffort calls forget when port exposes it', async () => {
    const forget = vi.fn().mockResolvedValue(undefined);
    await forgetGrantedSerialPortBestEffort({ forget } as unknown as SerialPort);
    expect(forget).toHaveBeenCalledTimes(1);
  });

  it('attachSerialServiceDisconnectListener invokes handler on disconnect', () => {
    const port = { close: vi.fn() } as unknown as SerialPort;
    const handler = vi.fn();
    const remove = vi.fn();
    const addEventListener = vi.fn();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { addEventListener, removeEventListener: remove },
    });

    const cleanup = attachSerialServiceDisconnectListener(handler);
    expect(addEventListener).toHaveBeenCalledWith('disconnect', expect.any(Function));

    const listener = addEventListener.mock.calls[0][1] as (event: Event) => void;
    listener({ target: port } as unknown as Event);
    expect(handler).toHaveBeenCalledWith(port);

    cleanup();
    expect(remove).toHaveBeenCalledWith('disconnect', listener);
  });
});
