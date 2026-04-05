import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serialConnCloseMock = vi.fn();
const serialConnGetSelfInfoMock = vi.fn();

vi.mock('@liamcottle/meshcore.js', () => {
  class MockWebSerialConnection {
    constructor(port: unknown) {
      void port;
    }
    on(event: string | number, cb: (...args: unknown[]) => void) {
      void event;
      void cb;
      return undefined;
    }
    off(event: string | number, cb: (...args: unknown[]) => void) {
      void event;
      void cb;
      return undefined;
    }
    once(event: string | number, cb: (...args: unknown[]) => void) {
      void event;
      void cb;
      return undefined;
    }
    emit(event: string | number, ...args: unknown[]) {
      void event;
      void args;
      return undefined;
    }
    close = serialConnCloseMock;
    getSelfInfo = serialConnGetSelfInfoMock;
    getContacts = vi.fn().mockResolvedValue([]);
    getChannels = vi.fn().mockResolvedValue([]);
    syncDeviceTime = vi.fn().mockResolvedValue(undefined);
    getBatteryVoltage = vi.fn().mockResolvedValue({ batteryMilliVolts: 4200 });
    sendToRadioFrame = vi.fn().mockRejectedValue(new Error('mocked'));
  }

  class MockSerialConnection {
    async write(bytes: Uint8Array) {
      await Promise.resolve();
      void bytes;
      return undefined;
    }
    async onDataReceived(value: Uint8Array) {
      await Promise.resolve();
      void value;
      return undefined;
    }
    async onConnected() {
      await Promise.resolve();
      return undefined;
    }
    onDisconnected() {
      return undefined;
    }
    async close() {
      await Promise.resolve();
      return undefined;
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      void event;
      void cb;
      return undefined;
    }
    off(event: string, cb: (...args: unknown[]) => void) {
      void event;
      void cb;
      return undefined;
    }
    once(event: string, cb: (...args: unknown[]) => void) {
      void event;
      void cb;
      return undefined;
    }
    emit(event: string, ...args: unknown[]) {
      void event;
      void args;
      return undefined;
    }
    sendToRadioFrame = vi.fn().mockRejectedValue(new Error('mocked'));
  }

  /** Base class for Noble-over-IPC (same surface as meshcore.js Connection). */
  class MockConnection {
    async write(bytes: Uint8Array) {
      await Promise.resolve();
      void bytes;
      return undefined;
    }
    async sendToRadioFrame(data: Uint8Array) {
      await Promise.resolve();
      void data;
      return undefined;
    }
    async onConnected() {
      await Promise.resolve();
      return undefined;
    }
    onDisconnected() {
      return undefined;
    }
    onFrameReceived(frame: Uint8Array) {
      void frame;
      return undefined;
    }
    async close() {
      await Promise.resolve();
      return undefined;
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      void event;
      void cb;
      return undefined;
    }
    off(event: string, cb: (...args: unknown[]) => void) {
      void event;
      void cb;
      return undefined;
    }
    once(event: string, cb: (...args: unknown[]) => void) {
      void event;
      void cb;
      return undefined;
    }
    emit(event: string, ...args: unknown[]) {
      void event;
      void args;
      return undefined;
    }
  }

  return {
    CayenneLpp: {
      parse: vi.fn().mockReturnValue([]),
    },
    Connection: MockConnection,
    SerialConnection: MockSerialConnection,
    WebSerialConnection: MockWebSerialConnection,
  };
});

import { useMeshCore } from './useMeshCore';

interface MockSerialPort {
  portId?: string;
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  getInfo: ReturnType<typeof vi.fn>;
}

function makeMockSerialPort(portId = 'port-1'): MockSerialPort {
  return {
    portId,
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getInfo: vi.fn().mockReturnValue({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
  };
}

describe('useMeshCore serial cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    serialConnGetSelfInfoMock.mockRejectedValue(new Error('serial init failed'));
    serialConnCloseMock.mockResolvedValue(undefined);
  });

  it('connectAutomatic closes raw port even when connection close throws', async () => {
    const port = makeMockSerialPort('auto-port');
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        getPorts: vi.fn().mockResolvedValue([port]),
      },
    });
    serialConnCloseMock.mockRejectedValue(new Error('conn close failed'));

    const { result } = renderHook(() => useMeshCore());

    await expect(
      act(async () => {
        await result.current.connectAutomatic('serial', undefined, 'auto-port');
      }),
    ).rejects.toThrow('serial init failed');

    expect(serialConnCloseMock).toHaveBeenCalledTimes(1);
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('disconnected');
  });

  it('connect serial closes both conn and raw port on init failure', async () => {
    const port = makeMockSerialPort('manual-port');
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: vi.fn().mockResolvedValue(port),
      },
    });
    serialConnCloseMock.mockRejectedValue(new Error('conn close failed'));

    const { result } = renderHook(() => useMeshCore());

    await expect(
      act(async () => {
        await result.current.connect('serial');
      }),
    ).rejects.toThrow('serial init failed');

    expect(serialConnCloseMock).toHaveBeenCalledTimes(1);
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('disconnected');
  });
});
