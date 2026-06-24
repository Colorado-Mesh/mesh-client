/**
 * Serial USB init must run getSelfInfo → getContacts before getChannels (UART single-flight).
 * TCP/BLE keep overlapping init RPCs for faster connect.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { meshcoreProtocol } from '../lib/protocols/MeshCoreProtocol';

const getSelfInfoMock = vi.fn();
const getContactsMock = vi.fn();
const getChannelsMock = vi.fn();

const SELF_PUBKEY = new Uint8Array(32).fill(0xab);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

vi.mock('@liamcottle/meshcore.js', () => {
  class MockWebSerialConnection {
    private listeners = new Map<string | number, Set<(...args: unknown[]) => void>>();

    constructor(port: unknown) {
      void port;
    }
    on(event: string | number, cb: (...args: unknown[]) => void) {
      const listeners = this.listeners.get(event) ?? new Set();
      listeners.add(cb);
      this.listeners.set(event, listeners);
      return undefined;
    }
    off(event: string | number, cb: (...args: unknown[]) => void) {
      this.listeners.get(event)?.delete(cb);
      return undefined;
    }
    once(event: string | number, cb: (...args: unknown[]) => void) {
      const wrapped = (...args: unknown[]) => {
        this.off(event, wrapped);
        cb(...args);
      };
      this.on(event, wrapped);
      return undefined;
    }
    emit(event: string | number, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((cb) => {
        cb(...args);
      });
      return undefined;
    }
    close = vi.fn().mockResolvedValue(undefined);
    getSelfInfo = getSelfInfoMock;
    getContacts = getContactsMock;
    getChannels = getChannelsMock;
    deviceQuery = vi.fn().mockResolvedValue({
      firmwareVer: 1,
      firmware_build_date: 'test',
      manufacturerModel: 'test',
    });
    syncDeviceTime = vi.fn().mockResolvedValue(undefined);
    getWaitingMessages = vi.fn().mockResolvedValue([]);
    syncNextMessage = vi.fn().mockResolvedValue(null);
    setOtherParams = vi.fn().mockResolvedValue(undefined);
    setAutoAddContacts = vi.fn().mockResolvedValue(undefined);
    setManualAddContacts = vi.fn().mockResolvedValue(undefined);
    getBatteryVoltage = vi.fn().mockResolvedValue({ batteryMilliVolts: 4200 });
    getStatsCore = vi.fn().mockResolvedValue({
      type: 0,
      raw: new Uint8Array(9),
      data: { batteryMilliVolts: 4100, uptimeSecs: 1, queueLen: 0 },
    });
    getStatsRadio = vi.fn().mockResolvedValue({
      type: 1,
      raw: new Uint8Array([1]),
      data: { noiseFloor: -110, lastRssi: -90, lastSnr: 5, txAirSecs: 0, rxAirSecs: 0 },
    });
    getStatsPackets = vi.fn().mockResolvedValue({
      type: 2,
      raw: new Uint8Array([2]),
      data: {
        recv: 0,
        sent: 0,
        nSentFlood: 0,
        nSentDirect: 0,
        nRecvFlood: 0,
        nRecvDirect: 0,
        nRecvErrors: 0,
      },
    });
    sendFloodAdvert = vi.fn().mockResolvedValue(undefined);
    sendToRadioFrame = vi.fn().mockImplementation((data: Uint8Array) => {
      void data;
      this.emit('rx', new Uint8Array([25, 0x0f, 3]));
    });
  }

  class MockSerialConnection {
    write(bytes: Uint8Array) {
      void bytes;
    }
    onDataReceived(value: Uint8Array) {
      void value;
    }
    async onConnected() {
      await Promise.resolve();
    }
    onDisconnected() {
      return undefined;
    }
    close = vi.fn().mockResolvedValue(undefined);
    on() {
      return undefined;
    }
    off() {
      return undefined;
    }
    once() {
      return undefined;
    }
    emit() {
      return undefined;
    }
    sendToRadioFrame = vi.fn().mockRejectedValue(new Error('mocked'));
  }

  class MockConnection {
    close = vi.fn().mockResolvedValue(undefined);
    on() {
      return undefined;
    }
    off() {
      return undefined;
    }
    once() {
      return undefined;
    }
    emit() {
      return undefined;
    }
  }

  return {
    CayenneLpp: { parse: vi.fn().mockReturnValue([]) },
    Connection: MockConnection,
    SerialConnection: MockSerialConnection,
    WebSerialConnection: MockWebSerialConnection,
  };
});

import { useMeshcoreRuntime } from '../runtime/useMeshcoreRuntime';

function makeMockSerialPort() {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    writable: new WritableStream<Uint8Array>({ write: vi.fn() }),
    readable: new ReadableStream(),
    getInfo: vi.fn().mockReturnValue({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
  };
}

const selfInfoPayload = {
  name: 'SelfRadio',
  publicKey: SELF_PUBKEY,
  type: 1,
  txPower: 22,
  radioFreq: 902_000_000,
};

describe('useMeshcoreRuntime initConn RPC ordering', () => {
  const originalSerial = navigator.serial;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getNodes).mockResolvedValue([]);
    vi.spyOn(meshcoreProtocol, 'subscribe').mockReturnValue(() => {});
    vi.spyOn(meshcoreProtocol, 'destroyDevice').mockResolvedValue(undefined);
    vi.spyOn(meshcoreProtocol, 'discoverSelf').mockResolvedValue({
      publicKey: SELF_PUBKEY,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: originalSerial,
    });
    vi.restoreAllMocks();
  });

  it('serial: getContacts waits for getSelfInfo; getChannels starts after contacts', async () => {
    const callOrder: string[] = [];
    const selfInfoGate = deferred<undefined>();
    const contactsGate = deferred<undefined>();
    const channelsGate = deferred<undefined>();

    getSelfInfoMock.mockImplementation(async () => {
      callOrder.push('getSelfInfo:start');
      await selfInfoGate.promise;
      callOrder.push('getSelfInfo:end');
      return selfInfoPayload;
    });
    getContactsMock.mockImplementation(async () => {
      callOrder.push('getContacts:start');
      await contactsGate.promise;
      callOrder.push('getContacts:end');
      return [];
    });
    getChannelsMock.mockImplementation(async () => {
      callOrder.push('getChannels:start');
      await channelsGate.promise;
      callOrder.push('getChannels:end');
      return [];
    });

    const port = makeMockSerialPort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort: vi.fn().mockResolvedValue(port) },
    });

    const { result, unmount } = renderHook(() => useMeshcoreRuntime());
    let connectPromise: Promise<void> | undefined;
    await act(async () => {
      connectPromise = result.current.connect('serial');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(callOrder).toContain('getSelfInfo:start');
    });
    expect(callOrder).not.toContain('getContacts:start');
    expect(callOrder).not.toContain('getChannels:start');

    selfInfoGate.resolve(undefined);
    await waitFor(() => {
      expect(callOrder).toContain('getSelfInfo:end');
      expect(callOrder).toContain('getContacts:start');
    });
    expect(callOrder).not.toContain('getChannels:start');

    contactsGate.resolve(undefined);
    await waitFor(() => {
      expect(callOrder).toContain('getContacts:end');
    });
    expect(callOrder.indexOf('getChannels:start')).toBeGreaterThan(
      callOrder.indexOf('getContacts:end'),
    );

    channelsGate.resolve(undefined);
    await waitFor(() => {
      expect(callOrder).toContain('getChannels:end');
    });

    await act(async () => {
      await connectPromise;
    });

    await act(async () => {
      await result.current.disconnect();
    });
    unmount();
  });

  // TCP/BLE parallel init is preserved in initConn's `if (!isSerialInit)` branch (see useMeshcoreRuntime.ts).
});
