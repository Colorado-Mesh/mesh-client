import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSelfInfoMock = vi.fn();
const getContactsMock = vi.fn();
const getChannelsMock = vi.fn();

/** Events registered by useMeshCore setupEventListeners (persistent conn.on). */
const MESHCORE_PERSISTENT_CONN_EVENTS = [
  128,
  129,
  130,
  138,
  131,
  7,
  8,
  136,
  'disconnected',
  'rx',
] as const;

/** Narrow type for the vi.mock WebSerialConnection instance (class is not visible at module scope). */
interface MeshSerialMockConn {
  persistentListenerCount(): number;
  emit(event: string | number, ...args: unknown[]): undefined;
}

/** Holder avoids `this` → module binding (eslint no-this-alias) in the mock constructor. */
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
      return MESHCORE_PERSISTENT_CONN_EVENTS.reduce(
        (n, ev) => n + (this.listeners.get(ev)?.size ?? 0),
        0,
      );
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

import { useMeshCore } from './useMeshCore';

const SELF_PUBKEY = new Uint8Array(32).fill(0xab);

function makeMockSerialPort() {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getInfo: vi.fn().mockReturnValue({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
  };
}

describe('useMeshCore connection listener teardown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastMeshSerialMock.current = null;
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    getSelfInfoMock.mockResolvedValue({
      name: 'SelfRadio',
      publicKey: SELF_PUBKEY,
      type: 1,
      txPower: 22,
      radioFreq: 902_000_000,
    });
    getContactsMock.mockResolvedValue([]);
    getChannelsMock.mockResolvedValue([]);
  });

  it('removes all persistent conn.on handlers after disconnect()', async () => {
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
    });

    const conn = lastMeshSerialMock.current;
    expect(conn).not.toBeNull();
    expect(conn!.persistentListenerCount()).toBeGreaterThan(0);

    await act(async () => {
      await result.current.disconnect();
    });

    expect(conn!.persistentListenerCount()).toBe(0);
  });

  it('tears down listeners on the previous connection when connect replaces it', async () => {
    const port1 = makeMockSerialPort();
    const port2 = makeMockSerialPort();
    const requestPort = vi.fn().mockResolvedValueOnce(port1).mockResolvedValueOnce(port2);
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort },
    });

    const { result } = renderHook(() => useMeshCore());

    await act(async () => {
      await result.current.connect('serial');
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
    });

    const firstConn = lastMeshSerialMock.current;
    expect(firstConn).not.toBeNull();
    expect(firstConn!.persistentListenerCount()).toBeGreaterThan(0);

    await act(async () => {
      await result.current.connect('serial');
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
    });

    expect(firstConn!.persistentListenerCount()).toBe(0);
    expect(lastMeshSerialMock.current).not.toBe(firstConn);
    expect(lastMeshSerialMock.current!.persistentListenerCount()).toBeGreaterThan(0);
  });

  it('clears persistent listeners when conn emits disconnected', async () => {
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
    });

    const conn = lastMeshSerialMock.current!;
    expect(conn.persistentListenerCount()).toBeGreaterThan(0);

    act(() => {
      conn.emit('disconnected');
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('disconnected');
    });

    expect(conn.persistentListenerCount()).toBe(0);
  });
});
