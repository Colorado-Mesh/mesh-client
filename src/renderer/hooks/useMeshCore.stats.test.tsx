import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSelfInfoMock = vi.fn();
const getStatsCoreMock = vi.fn();
const getStatsRadioMock = vi.fn();
const getStatsPacketsMock = vi.fn();

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
    getContacts = vi.fn().mockResolvedValue([]);
    getChannels = vi.fn().mockResolvedValue([]);
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
    getStatsCore = getStatsCoreMock;
    getStatsRadio = getStatsRadioMock;
    getStatsPackets = getStatsPacketsMock;
    sendToRadioFrame = vi.fn().mockImplementation((data: Uint8Array) => {
      void data;
      this.emit('rx', new Uint8Array([25, 0x0f, 3]));
    });
  }

  class MockSerialConnection {
    async write(bytes: Uint8Array) {
      await Promise.resolve();
      void bytes;
    }
    async onDataReceived(value: Uint8Array) {
      await Promise.resolve();
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
    async write(bytes: Uint8Array) {
      await Promise.resolve();
      void bytes;
    }
    async sendToRadioFrame(data: Uint8Array) {
      await Promise.resolve();
      void data;
    }
    async onConnected() {
      await Promise.resolve();
    }
    onDisconnected() {
      return undefined;
    }
    onFrameReceived(frame: Uint8Array) {
      void frame;
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
  }

  return {
    CayenneLpp: { parse: vi.fn().mockReturnValue([]) },
    Connection: MockConnection,
    SerialConnection: MockSerialConnection,
    WebSerialConnection: MockWebSerialConnection,
  };
});

import { pubkeyToNodeId } from '../lib/meshcoreUtils';
import { useMeshCore } from './useMeshCore';

const SELF_PUBKEY = new Uint8Array(32).fill(0xab);
const MY_NODE_ID = pubkeyToNodeId(SELF_PUBKEY);

function makeMockSerialPort() {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getInfo: vi.fn().mockReturnValue({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
  };
}

describe('useMeshCore stats parsing', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    getSelfInfoMock.mockResolvedValue({
      name: 'SelfRadio',
      publicKey: SELF_PUBKEY,
      type: 1,
      txPower: 22,
      radioFreq: 902_000_000,
    });
    getStatsCoreMock.mockResolvedValue({
      type: 0,
      raw: (() => {
        const r = new Uint8Array(9);
        r[6] = 5;
        r[7] = 0;
        r[8] = 7; // true queue per MeshCore stats_binary_frames (meshcore.js .data.queueLen reads err low byte)
        return r;
      })(),
      data: {
        batteryMilliVolts: 4123,
        uptimeSecs: 456,
        queueLen: 5,
      },
    });
    getStatsRadioMock.mockResolvedValue({
      type: 1,
      raw: new Uint8Array([1]),
      data: {
        noiseFloor: -110,
        lastRssi: -89,
        lastSnr: 6.5,
        txAirSecs: 12,
        rxAirSecs: 34,
      },
    });
    getStatsPacketsMock.mockResolvedValue({
      type: 2,
      raw: new Uint8Array([2]),
      data: {
        recv: 100,
        sent: 50,
        nSentFlood: 5,
        nSentDirect: 10,
        nRecvFlood: 15,
        nRecvDirect: 20,
        nRecvErrors: 2,
      },
    });
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('hydrates queueStatus from the meshcore.js stats payload data field', async () => {
    const port = makeMockSerialPort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: vi.fn().mockResolvedValue(port),
      },
    });

    const { result } = renderHook(() => useMeshCore());

    await act(async () => {
      await result.current.connect('serial');
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
      expect(result.current.queueStatus).toEqual({ free: 249, maxlen: 256, res: 0 });
    });

    expect(result.current.state.myNodeNum).toBe(MY_NODE_ID);
    expect(getStatsCoreMock).toHaveBeenCalled();
    expect(getStatsRadioMock).toHaveBeenCalled();
    expect(getStatsPacketsMock).toHaveBeenCalled();
  });

  it('still hydrates queueStatus when getStatsRadio/getStatsPackets fail after getStatsCore succeeds', async () => {
    getStatsRadioMock.mockRejectedValue(new Error('radio stats timeout'));
    getStatsPacketsMock.mockRejectedValue(new Error('packet stats timeout'));

    const port = makeMockSerialPort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: vi.fn().mockResolvedValue(port),
      },
    });

    const { result } = renderHook(() => useMeshCore());

    await act(async () => {
      await result.current.connect('serial');
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
      expect(result.current.queueStatus).toEqual({ free: 249, maxlen: 256, res: 0 });
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[useMeshCore] fetchAndUpdateLocalStats radio/packet error:',
      'radio stats timeout',
    );
  });
});
