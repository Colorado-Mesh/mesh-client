import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSelfInfoMock = vi.fn();
const getContactsMock = vi.fn();
const getChannelsMock = vi.fn();
const getWaitingMessagesMock = vi.fn();
const syncNextMessageMock = vi.fn();

interface MeshSerialMockConn {
  persistentListenerCount(): number;
  emit(event: string | number, ...args: unknown[]): undefined;
}

const lastMeshSerialMock: { current: MeshSerialMockConn | null } = { current: null };

vi.mock('@liamcottle/meshcore.js', () => {
  class MockWebSerialConnection implements MeshSerialMockConn {
    private listeners = new Map<string | number, Set<(...args: unknown[]) => void>>();

    constructor(port: unknown) {
      void port;
      lastMeshSerialMock.current = this;
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
      const cbs = [...(this.listeners.get(event) ?? [])];
      for (const cb of cbs) {
        cb(...args);
      }
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
    getWaitingMessages = getWaitingMessagesMock;
    syncNextMessage = syncNextMessageMock;
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
      data: {
        noiseFloor: -110,
        lastRssi: -90,
        lastSnr: 5,
        txAirSecs: 0,
        rxAirSecs: 0,
      },
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
    sendToRadioFrame = vi.fn().mockRejectedValue(new Error('mocked'));
    persistentListenerCount() {
      return this.listeners.size;
    }
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

import { useMeshcoreRuntime } from '../runtime/useMeshcoreRuntime';
import { resetMeshcoreRuntimeElectronMocks } from '../vitestClearHelpers';

const SELF_PUBKEY = new Uint8Array(32).fill(0xab);

function makeMockSerialPort() {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getInfo: vi.fn().mockReturnValue({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
  };
}

describe('useMeshcoreRuntime waiting messages drain', () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetMeshcoreRuntimeElectronMocks();
    lastMeshSerialMock.current = null;
    getSelfInfoMock.mockReset();
    getContactsMock.mockReset();
    getChannelsMock.mockReset();
    getWaitingMessagesMock.mockReset();
    syncNextMessageMock.mockReset();
    getSelfInfoMock.mockResolvedValue({
      name: 'SelfRadio',
      publicKey: SELF_PUBKEY,
      type: 1,
      txPower: 22,
      radioFreq: 902_000_000,
    });
    getContactsMock.mockResolvedValue([]);
    getChannelsMock.mockResolvedValue([]);
    getWaitingMessagesMock.mockResolvedValue([]);
    syncNextMessageMock.mockResolvedValue(null);
  });

  async function connectSerialConfigured() {
    const port = makeMockSerialPort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort: vi.fn().mockResolvedValue(port) },
    });
    const { result } = renderHook(() => useMeshcoreRuntime());
    await act(async () => {
      await result.current.connect('serial');
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
    });
    return result;
  }

  it('manual Sync now calls getWaitingMessages', async () => {
    getWaitingMessagesMock.mockResolvedValue([
      { channelMessage: { channelIdx: 0, senderTimestamp: 1, text: 'a' } },
    ]);
    const result = await connectSerialConfigured();

    await act(async () => {
      await result.current.syncWaitingMessages();
    });

    expect(getWaitingMessagesMock).toHaveBeenCalled();
    expect(syncNextMessageMock).not.toHaveBeenCalled();
  });

  it('event 131 schedules silent bulk getWaitingMessages drain', async () => {
    getWaitingMessagesMock.mockResolvedValueOnce([
      { channelMessage: { channelIdx: 0, senderTimestamp: 1, text: 'queued' } },
    ]);

    await connectSerialConfigured();
    const conn = lastMeshSerialMock.current;
    expect(conn).not.toBeNull();

    act(() => {
      conn!.emit(131);
    });

    await waitFor(
      () => {
        expect(getWaitingMessagesMock).toHaveBeenCalled();
      },
      { timeout: 8_000 },
    );
    expect(syncNextMessageMock).not.toHaveBeenCalled();
  }, 15_000);

  it('event 131 silent drain falls back on bulk timeout then ends on syncNextMessage timeout', async () => {
    getWaitingMessagesMock.mockRejectedValue(
      new Error('MeshCore getWaitingMessages timed out after 15000ms'),
    );
    syncNextMessageMock.mockRejectedValue(
      new Error('MeshCore syncNextMessage timed out after 12000ms'),
    );

    const result = await connectSerialConfigured();
    const conn = lastMeshSerialMock.current;
    expect(conn).not.toBeNull();

    act(() => {
      conn!.emit(131);
    });

    await waitFor(
      () => {
        expect(getWaitingMessagesMock).toHaveBeenCalled();
        expect(syncNextMessageMock).toHaveBeenCalled();
      },
      { timeout: 8_000 },
    );
    await waitFor(
      () => {
        expect(result.current.waitingMessagesSilentDrainActive).toBe(false);
      },
      { timeout: 8_000 },
    );
  }, 20_000);
});
