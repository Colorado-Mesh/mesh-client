/**
 * deleteMeshcoreChannel against a connected (mocked) USB radio: a refused delete rejects and
 * leaves the channel listed; an accepted one drops it (#1077).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { touch } from '@/shared/touch';

import { getMeshcorePubKey, registerMeshcorePubKey } from '../lib/meshcore/meshcorePubKeyRegistry';
import { meshcoreProtocol } from '../lib/protocols/MeshCoreProtocol';

const deleteChannelMock = vi.fn();
const getContactsMock = vi.fn();
const getChannelsMock = vi.fn();

const makePublicKey = (id: number) => {
  const key = new Uint8Array(32);
  new DataView(key.buffer).setUint32(0, id, true);
  return key;
};
const SELF_PUBKEY = makePublicKey(171);
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
    getContacts = getContactsMock;
    getChannels = getChannelsMock;
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
    sendToRadioFrame = vi.fn().mockImplementation(async (data: Uint8Array) => {
      if (data[0] === 22) {
        const channels = await getChannelsMock();
        this.emit(
          'rx',
          new Uint8Array([
            13,
            14,
            100,
            Math.max(...channels.map((channel: { channelIdx: number }) => channel.channelIdx)) + 1,
            0,
            0,
            0,
            0,
          ]),
        );
      } else if (data[0] === 31) {
        const channels = await getChannelsMock();
        const index = data[1];
        const maxIndex = Math.max(
          ...channels.map((channel: { channelIdx: number }) => channel.channelIdx),
        );
        if (index > maxIndex) this.emit(1, { errCode: 2 });
        else
          this.emit(
            18,
            channels.find((channel: { channelIdx: number }) => channel.channelIdx === index) ?? {
              channelIdx: index,
              name: '',
              secret: new Uint8Array(16),
            },
          );
      } else {
        this.emit('rx', new Uint8Array([25, 0x0f, 3]));
      }
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
    getContactsMock.mockReset().mockResolvedValue([]);
    getChannelsMock.mockReset().mockResolvedValue([
      { channelIdx: 0, name: 'Public', secret: SECRET },
      { channelIdx: 3, name: '#test', secret: SECRET },
    ]);
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
  it('imports radio channels and Room contacts on fresh setup and repeated explicit sync without radio writes', async () => {
    const { result, unmount } = await connectWithTwoChannels();
    getContactsMock.mockResolvedValue([
      {
        publicKey: makePublicKey(193),
        type: 3,
        flags: 0,
        advName: 'Restored Room',
        lastAdvert: 0,
        advLat: 0,
        advLon: 0,
        outPathLen: 0,
        outPath: new Uint8Array(),
      },
    ]);
    getChannelsMock.mockResolvedValue([{ channelIdx: 2, name: 'Restored Ops', secret: SECRET }]);
    await act(async () => {
      await result.current.syncRadioChats();
    });
    expect(result.current.channels.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    expect([...result.current.nodes.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hw_model: 'Room', long_name: 'Restored Room' }),
      ]),
    );
    await act(async () => {
      await result.current.syncRadioChats();
    });
    expect(
      [...result.current.nodes.values()].filter((node) => node.hw_model === 'Room'),
    ).toHaveLength(1);
    expect(deleteChannelMock).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.disconnect();
    });
    unmount();
  });

  it('keeps existing channels and contacts on failed sync, then allows retry', async () => {
    const { result, unmount } = await connectWithTwoChannels();
    getChannelsMock.mockRejectedValueOnce(new Error('radio busy'));
    await act(async () => {
      await expect(result.current.syncRadioChats()).rejects.toThrow('radio busy');
    });
    expect(result.current.channels.map((c) => c.index)).toEqual([0, 3]);
    await act(async () => {
      await result.current.syncRadioChats();
    });
    expect(result.current.channels.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    await act(async () => {
      await result.current.disconnect();
    });
    unmount();
  });

  it('waits for an active sync before refreshing contacts and propagates refresh errors', async () => {
    const { result, unmount } = await connectWithTwoChannels();
    let acknowledge!: () => void;
    vi.mocked(window.electronAPI.db.saveMeshcoreContactsBatch).mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          acknowledge = () => {
            resolve(0);
          };
        }),
    );
    let sync!: Promise<void>;
    act(() => {
      sync = result.current.syncRadioChats();
    });
    await waitFor(() => {
      expect(acknowledge).toBeDefined();
    });
    const before = getContactsMock.mock.calls.length;
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refreshContacts();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(getContactsMock).toHaveBeenCalledTimes(before);
    acknowledge();
    await act(async () => {
      await Promise.all([sync, refresh]);
    });
    expect(getContactsMock).toHaveBeenCalledTimes(before + 1);
    getContactsMock.mockRejectedValueOnce(new Error('read failed'));
    await act(async () => {
      await expect(result.current.refreshContacts()).rejects.toThrow('read failed');
    });
    await act(async () => {
      await result.current.disconnect();
    });
    unmount();
  });
  it.each(['syncRadioChats', 'refreshContacts'] as const)(
    'closes a stalled %s dump before retry can own the stream',
    async (operation) => {
      const { result, unmount } = await connectWithTwoChannels();
      vi.useFakeTimers();
      try {
        getContactsMock.mockImplementation(() => new Promise(() => {}));
        let pending!: Promise<void>;
        act(() => {
          pending = result.current[operation]();
        });
        const failure = expect(pending).rejects.toThrow(/stalled|timed out/);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000);
        });
        await failure;
        const dumps = getContactsMock.mock.calls.length;
        await expect(result.current.syncRadioChats()).rejects.toThrow('Radio is not connected');
        expect(getContactsMock).toHaveBeenCalledTimes(dumps);
      } finally {
        vi.useRealTimers();
        unmount();
      }
    },
  );
  it('rejects sync while disconnected', async () => {
    const { result, unmount } = renderHook(() => useMeshcoreRuntime());
    await expect(result.current.syncRadioChats()).rejects.toThrow('Radio is not connected');
    expect(getChannelsMock).not.toHaveBeenCalled();
    unmount();
  });
  it('does not publish stale contacts when disconnect happens during the builder database read', async () => {
    const { result, unmount } = await connectWithTwoChannels();
    let resolveRead!: (rows: []) => void;
    vi.mocked(window.electronAPI.db.getNodes).mockImplementationOnce(
      () =>
        new Promise<[]>((resolve) => {
          resolveRead = resolve;
        }),
    );
    getContactsMock.mockResolvedValue([
      {
        publicKey: makePublicKey(194),
        type: 3,
        flags: 0,
        advName: 'Old radio room',
        lastAdvert: 0,
        advLat: 0,
        advLon: 0,
      },
    ]);
    const savedBefore = vi.mocked(window.electronAPI.db.saveMeshcoreContactsBatch).mock.calls
      .length;
    let sync!: Promise<void>;
    act(() => {
      sync = result.current.syncRadioChats();
      void sync.catch(() => {});
    });
    await waitFor(() => {
      expect(resolveRead).toBeDefined();
    });
    await act(async () => {
      await result.current.disconnect();
    });
    resolveRead([]);
    await act(async () => {
      await expect(sync).rejects.toThrow('disconnected');
    });
    expect(vi.mocked(window.electronAPI.db.saveMeshcoreContactsBatch).mock.calls.length).toBe(
      savedBefore,
    );
    expect(
      [...result.current.nodes.values()].some((node) => node.long_name === 'Old radio room'),
    ).toBe(false);
    unmount();
  });

  it('surfaces durable room import failures and allows retry', async () => {
    const { result, unmount } = await connectWithTwoChannels();
    getContactsMock.mockResolvedValue([
      {
        publicKey: makePublicKey(194),
        type: 3,
        flags: 0,
        advName: 'Restored Room',
        lastAdvert: 0,
        advLat: 0,
        advLon: 0,
      },
    ]);
    vi.mocked(window.electronAPI.db.saveMeshcoreContactsBatch).mockRejectedValueOnce(
      new Error('disk full'),
    );
    await act(async () => {
      await expect(result.current.syncRadioChats()).rejects.toThrow('disk full');
    });
    await act(async () => {
      await result.current.syncRadioChats();
    });
    expect(
      [...result.current.nodes.values()].some((node) => node.long_name === 'Restored Room'),
    ).toBe(true);
    await act(async () => {
      await result.current.disconnect();
    });
    unmount();
  });
  it('preserves a live contact registered while the snapshot waits for durable storage', async () => {
    const { result, unmount } = await connectWithTwoChannels();
    getContactsMock.mockResolvedValue([
      {
        publicKey: makePublicKey(194),
        type: 3,
        flags: 0,
        advName: 'Radio Room',
        lastAdvert: 0,
        advLat: 0,
        advLon: 0,
      },
    ]);
    let acknowledge!: () => void;
    vi.mocked(window.electronAPI.db.saveMeshcoreContactsBatch).mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          acknowledge = () => {
            resolve(1);
          };
        }),
    );
    let sync!: Promise<void>;
    act(() => {
      sync = result.current.syncRadioChats();
    });
    await waitFor(() => {
      expect(acknowledge).toBeDefined();
    });
    const liveKey = makePublicKey(195);
    registerMeshcorePubKey(195, liveKey);
    acknowledge();
    await act(async () => {
      await sync;
    });
    expect(getMeshcorePubKey(195)).toEqual(liveKey);
    await act(async () => {
      await result.current.disconnect();
    });
    unmount();
  });
});
