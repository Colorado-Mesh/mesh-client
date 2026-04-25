/**
 * MeshCore ping error: “no route” message auto-expires after {@link MESHCORE_PING_NO_ROUTE_ERROR_DISPLAY_MS}.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pubkeyToNodeId } from '../lib/meshcoreUtils';
import { computePathHash, usePathHistoryStore } from '../stores/pathHistoryStore';

const { runMeshcoreTracePathMultiplexedMock } = vi.hoisted(() => ({
  runMeshcoreTracePathMultiplexedMock: vi.fn(),
}));
vi.mock('../lib/meshcoreTracePathMultiplex', async (importOriginal) => {
  const actual = await importOriginal();
  return Object.assign({}, actual, {
    runMeshcoreTracePathMultiplexed: runMeshcoreTracePathMultiplexedMock,
  });
});
import {
  MESHCORE_PING_NO_ROUTE_ERROR_DISPLAY_MS,
  MESHCORE_PING_NO_ROUTE_ERROR_MSG,
  meshcorePingNoRouteErrorExpiryUpdate,
  useMeshCore,
} from './useMeshCore';

const getSelfInfoMock = vi.fn();

const REMOTE_PUBKEY = (() => {
  const b = new Uint8Array(32);
  b[0] = 0x33;
  b[31] = 0x44;
  return b;
})();
const REMOTE_NODE_ID = pubkeyToNodeId(REMOTE_PUBKEY);
const REMOTE_PUBKEY_HEX = Array.from(REMOTE_PUBKEY)
  .map((x) => x.toString(16).padStart(2, '0'))
  .join('');

const SELF_PUBKEY = new Uint8Array(32).fill(0xab);
const MY_NODE_ID = pubkeyToNodeId(SELF_PUBKEY);

/** Matches {@link MESHCORE_TRACE_PRIME_WAIT_MS} in useMeshCore.ts — wait after flood advert for PathUpdated. */
const TRACE_PRIME_WAIT_MS = 12_000;

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
    getStatsCore = vi.fn().mockResolvedValue({
      type: 0,
      raw: new Uint8Array(9),
      data: { batteryMilliVolts: 4123, uptimeSecs: 456, queueLen: 5 },
    });
    getStatsRadio = vi.fn().mockResolvedValue({
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
    getStatsPackets = vi.fn().mockResolvedValue({
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
    sendFloodAdvert = vi.fn().mockResolvedValue(undefined);
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

function makeMockSerialPort() {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getInfo: vi.fn().mockReturnValue({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
  };
}

describe('meshcorePingNoRouteErrorExpiryUpdate', () => {
  it('removes the no-route message when it still matches', () => {
    const prev = new Map<number, string>([[42, MESHCORE_PING_NO_ROUTE_ERROR_MSG]]);
    const next = meshcorePingNoRouteErrorExpiryUpdate(prev, 42);
    expect(next.has(42)).toBe(false);
  });

  it('does not remove a different ping error for the same node', () => {
    const prev = new Map<number, string>([[42, 'Failed: radio']]);
    const next = meshcorePingNoRouteErrorExpiryUpdate(prev, 42);
    expect(next.get(42)).toBe('Failed: radio');
  });
});

describe('useMeshCore refreshNodesFromDb hop preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePathHistoryStore.setState({ records: new Map(), lruOrder: [] });
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getNodes).mockResolvedValue([]);
  });

  it('keeps known hops_away when DB refresh row omits it', async () => {
    const rowWithHops = {
      node_id: REMOTE_NODE_ID,
      public_key: REMOTE_PUBKEY_HEX,
      adv_name: 'RemotePeer',
      contact_type: 1,
      last_advert: 1_700_000_000,
      adv_lat: null,
      adv_lon: null,
      last_snr: null,
      last_rssi: null,
      favorited: 0,
      nickname: null,
      hops_away: 3,
    };
    const rowWithoutHops = {
      ...rowWithHops,
      hops_away: null,
    };
    vi.mocked(window.electronAPI.db.getMeshcoreContacts)
      .mockResolvedValueOnce([rowWithHops])
      .mockResolvedValueOnce([rowWithoutHops]);

    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(result.current.nodes.get(REMOTE_NODE_ID)?.hops_away).toBe(3);
    });

    await act(async () => {
      await result.current.refreshNodesFromDb();
    });

    expect(result.current.nodes.get(REMOTE_NODE_ID)?.hops_away).toBe(3);
  });
});

describe('useMeshCore traceRoute no-route error expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runMeshcoreTracePathMultiplexedMock.mockResolvedValue({
      pathLen: 2,
      pathHashes: [1, 2],
      pathSnrs: [4, 8],
      lastSnr: 1.25,
      tag: 7,
    });
    usePathHistoryStore.setState({ records: new Map(), lruOrder: [] });
    getSelfInfoMock.mockResolvedValue({
      name: 'SelfRadio',
      publicKey: SELF_PUBKEY,
      type: 1,
      txPower: 22,
      radioFreq: 902_000_000,
    });
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getNodes).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([
      {
        node_id: REMOTE_NODE_ID,
        public_key: REMOTE_PUBKEY_HEX,
        adv_name: 'RemotePeer',
        contact_type: 1,
        last_advert: 1_700_000_000,
        adv_lat: null,
        adv_lon: null,
        last_snr: null,
        last_rssi: null,
        favorited: 0,
        nickname: null,
        hops_away: 2,
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the no-route ping error after the display duration (fake timers)', async () => {
    const port = makeMockSerialPort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: vi.fn().mockResolvedValue(port),
      },
    });

    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(window.electronAPI.db.getMeshcoreContacts).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.connect('serial');
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
    });

    expect(result.current.state.myNodeNum).toBe(MY_NODE_ID);
    expect(result.current.nodes.get(REMOTE_NODE_ID)?.hops_away).toBe(2);

    vi.useFakeTimers();

    let tracePromise: Promise<void>;
    await act(async () => {
      tracePromise = result.current.traceRoute(REMOTE_NODE_ID);
      await vi.advanceTimersByTimeAsync(TRACE_PRIME_WAIT_MS);
    });

    await act(async () => {
      await tracePromise!;
    });

    expect(result.current.meshcorePingErrors.get(REMOTE_NODE_ID)).toBe(
      MESHCORE_PING_NO_ROUTE_ERROR_MSG,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MESHCORE_PING_NO_ROUTE_ERROR_DISPLAY_MS);
    });

    expect(result.current.meshcorePingErrors.has(REMOTE_NODE_ID)).toBe(false);
  });
});

describe('useMeshCore traceRoute path outcome attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runMeshcoreTracePathMultiplexedMock.mockResolvedValue({
      pathLen: 2,
      pathHashes: [1, 2],
      pathSnrs: [4, 8],
      lastSnr: 1.25,
      tag: 7,
    });
    usePathHistoryStore.setState({ records: new Map(), lruOrder: [] });
    getSelfInfoMock.mockResolvedValue({
      name: 'SelfRadio',
      publicKey: SELF_PUBKEY,
      type: 1,
      txPower: 22,
      radioFreq: 902_000_000,
    });
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getNodes).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([
      {
        node_id: REMOTE_NODE_ID,
        public_key: REMOTE_PUBKEY_HEX,
        adv_name: 'RemotePeer',
        contact_type: 1,
        last_advert: 1_700_000_000,
        adv_lat: null,
        adv_lon: null,
        last_snr: null,
        last_rssi: null,
        favorited: 0,
        nickname: null,
        hops_away: 2,
      },
    ]);
  });

  it('records success outcome for traceRoute on the used path hash', async () => {
    const dbOutcomeSpy = vi.spyOn(window.electronAPI.db, 'recordMeshcorePathOutcome');
    const pathBytes = [0x11, 0x22];
    const pathHash = computePathHash(pathBytes);
    usePathHistoryStore.getState().recordPathUpdated(REMOTE_NODE_ID, pathBytes, 1, false);

    const port = makeMockSerialPort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: vi.fn().mockResolvedValue(port),
      },
    });

    const { result } = renderHook(() => useMeshCore());
    await waitFor(() => {
      expect(window.electronAPI.db.getMeshcoreContacts).toHaveBeenCalled();
    });
    await act(async () => {
      await result.current.connect('serial');
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
    });

    await act(async () => {
      await result.current.traceRoute(REMOTE_NODE_ID);
      await Promise.resolve();
    });

    const record = usePathHistoryStore
      .getState()
      .records.get(REMOTE_NODE_ID)
      ?.find((r) => r.pathHash === pathHash);
    expect(record?.successCount).toBe(1);
    expect(record?.failureCount).toBe(0);
    expect(dbOutcomeSpy).toHaveBeenCalledWith(REMOTE_NODE_ID, pathHash, true, undefined);
  });

  it('records failure outcome for traceRoute errors on the used path hash', async () => {
    runMeshcoreTracePathMultiplexedMock.mockRejectedValueOnce(new Error('trace timeout'));
    const dbOutcomeSpy = vi.spyOn(window.electronAPI.db, 'recordMeshcorePathOutcome');
    const pathBytes = [0x11, 0x22];
    const pathHash = computePathHash(pathBytes);
    usePathHistoryStore.getState().recordPathUpdated(REMOTE_NODE_ID, pathBytes, 1, false);

    const port = makeMockSerialPort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: vi.fn().mockResolvedValue(port),
      },
    });

    const { result } = renderHook(() => useMeshCore());
    await waitFor(() => {
      expect(window.electronAPI.db.getMeshcoreContacts).toHaveBeenCalled();
    });
    await act(async () => {
      await result.current.connect('serial');
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
    });

    await act(async () => {
      await result.current.traceRoute(REMOTE_NODE_ID);
      await Promise.resolve();
    });

    const record = usePathHistoryStore
      .getState()
      .records.get(REMOTE_NODE_ID)
      ?.find((r) => r.pathHash === pathHash);
    expect(record?.successCount).toBe(0);
    expect(record?.failureCount).toBe(1);
    expect(dbOutcomeSpy).toHaveBeenCalledWith(REMOTE_NODE_ID, pathHash, false, undefined);
  });
});
