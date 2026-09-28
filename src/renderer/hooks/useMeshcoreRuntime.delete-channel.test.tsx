/**
 * deleteMeshcoreChannel against a connected (mocked) USB radio: a refused delete rejects and
 * leaves the channel listed; an accepted one drops it (#1077).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { touch } from '@/shared/touch';

import { meshcoreProtocol } from '../lib/protocols/MeshCoreProtocol';

const deleteChannelMock = vi.fn();

const SELF_PUBKEY = new Uint8Array(32).fill(0xab);
const SECRET = new Uint8Array(16).fill(1);

vi.mock('@liamcottle/meshcore.js', () => {
  // Post-init work waits on radio replies, so listeners are real and every frame gets one.
  class MockWebSerialConnection {
    private listeners = new Map<string | number, Set<(...args: unknown[]) => void>>();

    constructor(port: unknown) {
      touch(port);
    }
    getSelfInfo = vi.fn().mockResolvedValue({
      name: 'SelfRadio',
      publicKey: SELF_PUBKEY,
      type: 1,
      txPower: 22,
      radioFreq: 902_000_000,
    });
    getContacts = vi.fn().mockResolvedValue([]);
    getChannels = vi.fn().mockResolvedValue([
      { channelIdx: 0, name: 'Public', secret: SECRET },
      { channelIdx: 3, name: '#test', secret: SECRET },
    ]);
    deleteChannel = deleteChannelMock;
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
    close = vi.fn().mockResolvedValue(undefined);
    sendToRadioFrame = vi.fn().mockImplementation((data: Uint8Array) => {
      touch(data);
      this.emit('rx', new Uint8Array([25, 0x0f, 3]));
    });
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
    SerialConnection: MockConnection,
    WebSerialConnection: MockWebSerialConnection,
  };
});

import { useMeshcoreRuntime } from '../runtime/useMeshcoreRuntime';
import { resetMeshcoreRuntimeElectronMocks } from '../vitestClearHelpers';

describe('useMeshcoreRuntime deleteMeshcoreChannel', () => {
  const originalSerial = navigator.serial;
  let subscribeSpy: ReturnType<typeof vi.spyOn>;
  let destroySpy: ReturnType<typeof vi.spyOn>;
  let discoverSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetMeshcoreRuntimeElectronMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(window.electronAPI.db.getNodes).mockResolvedValue([]);
    subscribeSpy = vi.spyOn(meshcoreProtocol, 'subscribe').mockReturnValue(() => {});
    destroySpy = vi.spyOn(meshcoreProtocol, 'destroyDevice').mockResolvedValue(undefined);
    discoverSpy = vi.spyOn(meshcoreProtocol, 'discoverSelf').mockResolvedValue({
      publicKey: SELF_PUBKEY,
    });
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: vi.fn().mockResolvedValue({
          open: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
          writable: new WritableStream<Uint8Array>({ write: vi.fn() }),
          readable: new ReadableStream(),
          getInfo: vi.fn().mockReturnValue({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
        }),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: originalSerial,
    });
    subscribeSpy.mockRestore();
    destroySpy.mockRestore();
    discoverSpy.mockRestore();
    deleteChannelMock.mockReset();
  });

  async function connectWithTwoChannels() {
    const hook = renderHook(() => useMeshcoreRuntime());
    await act(async () => {
      await hook.result.current.connect('serial');
    });
    await waitFor(() => {
      expect(hook.result.current.channels.map((c) => c.index)).toEqual([0, 3]);
    });
    return hook;
  }

  it('rejects and keeps the channel listed when the radio refuses', async () => {
    deleteChannelMock.mockRejectedValue(new Error('radio busy'));
    const { result, unmount } = await connectWithTwoChannels();

    await act(async () => {
      await expect(result.current.deleteMeshcoreChannel(3)).rejects.toThrow('radio busy');
    });

    expect(deleteChannelMock).toHaveBeenCalledWith(3);
    expect(result.current.channels.map((c) => c.index)).toEqual([0, 3]);
    await act(async () => {
      await result.current.disconnect();
    });
    unmount();
  });

  it('drops the channel once the radio deletes it', async () => {
    deleteChannelMock.mockResolvedValue(undefined);
    const { result, unmount } = await connectWithTwoChannels();

    await act(async () => {
      await result.current.deleteMeshcoreChannel(3);
    });

    expect(result.current.channels.map((c) => c.index)).toEqual([0]);
    await act(async () => {
      await result.current.disconnect();
    });
    unmount();
  });
});
