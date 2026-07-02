import { beforeEach, describe, expect, it, vi } from 'vitest';

import { closeSerialPortIfOpen } from '@/renderer/lib/connection';
import { selectGrantedSerialPort } from '@/renderer/lib/serialPortSignature';

import { requestFlasherSerialPort } from './flasherSerial';
import { getFlasherSessionSerialPort } from './flasherSessionPort';

vi.mock('@/renderer/lib/connection', () => ({
  closeSerialPortIfOpen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/renderer/lib/serialPortSignature', () => ({
  loadLastSerialPortId: vi.fn(() => 'port-heltec'),
  selectGrantedSerialPort: vi.fn(),
}));

vi.mock('./flasherSessionPort', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getFlasherSessionPortId: vi.fn(() => 'port-heltec'),
    getFlasherSessionSerialPort: vi.fn(() => null),
    getPostFlashBootWaitMs: vi.fn(() => 0),
  };
});

describe('requestFlasherSerialPort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFlasherSessionSerialPort).mockReturnValue(null);
  });

  it('reuses the flashed serial port object when preferSessionReuse is set', async () => {
    const sessionPort = {
      getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
    } as SerialPort;
    vi.mocked(getFlasherSessionSerialPort).mockReturnValue(sessionPort);

    const requestPort = vi.fn();
    vi.stubGlobal('navigator', {
      serial: {
        getPorts: vi.fn().mockResolvedValue([sessionPort, {} as SerialPort]),
        requestPort,
      },
    });

    await expect(
      requestFlasherSerialPort(requestPort, {
        preferSessionReuse: true,
      }),
    ).resolves.toBe(sessionPort);

    expect(requestPort).not.toHaveBeenCalled();
    expect(selectGrantedSerialPort).not.toHaveBeenCalled();
    expect(closeSerialPortIfOpen).toHaveBeenCalledWith(sessionPort);
  });

  it('opens the picker when session reuse is requested but no flasher session exists', async () => {
    const requestPort = vi
      .fn()
      .mockRejectedValue(new Error("Failed to execute 'requestPort' on 'Serial'"));
    vi.stubGlobal('navigator', {
      serial: {
        getPorts: vi.fn().mockResolvedValue([]),
        requestPort,
      },
    });
    vi.stubGlobal('window', {
      electronAPI: {
        onSerialPortsDiscovered: vi.fn(() => () => {}),
        selectSerialPort: vi.fn(),
      },
    });

    await expect(
      requestFlasherSerialPort(requestPort, {
        preferSessionReuse: true,
      }),
    ).rejects.toThrow();

    expect(requestPort).toHaveBeenCalled();
  });

  it('reuses flasher session when portId matches a granted port', async () => {
    const grantedPort = {
      portId: 'port-heltec',
      getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
    } as SerialPort & { portId: string };

    const requestPort = vi.fn();
    vi.stubGlobal('navigator', {
      serial: {
        getPorts: vi.fn().mockResolvedValue([grantedPort]),
        requestPort,
      },
    });

    await expect(
      requestFlasherSerialPort(requestPort, {
        preferSessionReuse: true,
      }),
    ).resolves.toBe(grantedPort);

    expect(requestPort).not.toHaveBeenCalled();
    expect(selectGrantedSerialPort).not.toHaveBeenCalled();
  });

  it('auto-selects the flasher session port when the picker opens', async () => {
    const sessionPort = {} as SerialPort;
    const requestPort = vi.fn().mockResolvedValue(sessionPort);
    const selectSerialPort = vi.fn();
    const onSerialPortsDiscovered = vi.fn((handler: (ports: { portId: string }[]) => void) => {
      queueMicrotask(() => {
        handler([{ portId: 'other-port' }, { portId: 'session-port' }] as { portId: string }[]);
      });
      return () => {};
    });

    vi.stubGlobal('navigator', {
      serial: {
        getPorts: vi.fn().mockResolvedValue([]),
        requestPort,
      },
    });
    vi.stubGlobal('window', {
      electronAPI: { onSerialPortsDiscovered, selectSerialPort },
    });

    await expect(
      requestFlasherSerialPort(requestPort, {
        autoSelectPortId: 'session-port',
      }),
    ).resolves.toBe(sessionPort);

    expect(selectSerialPort).toHaveBeenCalledWith('session-port');
    expect(requestPort).toHaveBeenCalled();
  });

  it('falls back to a granted port when Electron discovers zero serial ports', async () => {
    const grantedPort = {
      getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
    } as SerialPort;
    vi.mocked(selectGrantedSerialPort).mockReturnValue(grantedPort);

    const onSerialPortsDiscovered = vi.fn((handler: (ports: unknown[]) => void) => {
      queueMicrotask(() => {
        handler([]);
      });
      return () => {};
    });
    const selectSerialPort = vi.fn();

    vi.stubGlobal('navigator', {
      serial: {
        getPorts: vi.fn().mockResolvedValue([grantedPort]),
        requestPort: vi
          .fn()
          .mockRejectedValue(new Error("Failed to execute 'requestPort' on 'Serial'")),
      },
    });
    vi.stubGlobal('window', {
      electronAPI: { onSerialPortsDiscovered, selectSerialPort },
    });

    await expect(requestFlasherSerialPort(undefined)).resolves.toBe(grantedPort);

    expect(selectSerialPort).toHaveBeenCalledWith('');
  });
});
