import type { MeshDevice } from '@meshtastic/core';
import { TransportWebSerial } from '@meshtastic/transport-web-serial';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { closeSerialPortIfOpen, reconnectSerial, safeDisconnect } from './connection';

vi.mock('@meshtastic/transport-web-serial', () => ({
  TransportWebSerial: {
    createFromPort: vi.fn(),
  },
}));

interface MockSerialPort {
  portId?: string;
  readable: ReadableStream | null;
  writable: WritableStream | null;
  close: ReturnType<typeof vi.fn>;
  getInfo: ReturnType<typeof vi.fn>;
}

function makeMockSerialPort(overrides: Partial<MockSerialPort> = {}): MockSerialPort {
  return {
    portId: 'port-1',
    readable: new ReadableStream(),
    writable: new WritableStream(),
    close: vi.fn().mockResolvedValue(undefined),
    getInfo: vi.fn().mockReturnValue({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
    ...overrides,
  };
}

describe('connection serial cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('closeSerialPortIfOpen closes port when streams are active', async () => {
    const port = makeMockSerialPort();
    await closeSerialPortIfOpen(port as unknown as SerialPort);
    expect(port.close).toHaveBeenCalledTimes(1);
  });

  it('closeSerialPortIfOpen skips close when port is already closed', async () => {
    const port = makeMockSerialPort({ readable: null, writable: null });
    await closeSerialPortIfOpen(port as unknown as SerialPort);
    expect(port.close).not.toHaveBeenCalled();
  });

  it('closeSerialPortIfOpen swallows close rejection when streams stay locked', async () => {
    const port = makeMockSerialPort({
      close: vi
        .fn()
        .mockRejectedValue(new DOMException('Cannot cancel a locked stream', 'InvalidStateError')),
    });
    await expect(closeSerialPortIfOpen(port as unknown as SerialPort)).resolves.toBeUndefined();
    expect(port.close).toHaveBeenCalledTimes(1);
  });

  it('reconnectSerial closes an open port before createFromPort', async () => {
    const port = makeMockSerialPort({ portId: 'saved-port' });
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        getPorts: vi.fn().mockResolvedValue([port]),
      },
    });
    localStorage.setItem('mesh-client:lastSerialPort', 'saved-port');
    vi.mocked(TransportWebSerial.createFromPort).mockResolvedValue({
      toDevice: new WritableStream(),
      fromDevice: new ReadableStream(),
    } as Awaited<ReturnType<typeof TransportWebSerial.createFromPort>>);

    await reconnectSerial('saved-port');

    expect(port.close).toHaveBeenCalledTimes(1);
    expect(TransportWebSerial.createFromPort).toHaveBeenCalledWith(port, 115200);
  });

  it('safeDisconnect closes underlying serial port after device.disconnect', async () => {
    const port = makeMockSerialPort();
    const fromDevice = new ReadableStream();
    const cancelSpy = vi.spyOn(fromDevice, 'cancel');
    const device = {
      disconnect: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn(),
      transport: { port, fromDevice },
    } as unknown as MeshDevice;

    await safeDisconnect(device);

    expect(device.disconnect).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalled();
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(device.complete).toHaveBeenCalledTimes(1);
  });

  it('safeDisconnect closes TransportWebSerial connection field', async () => {
    const port = makeMockSerialPort();
    const device = {
      disconnect: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn(),
      transport: { connection: port },
    } as unknown as MeshDevice;

    await safeDisconnect(device);

    expect(port.close).toHaveBeenCalledTimes(1);
  });
});
