/**
 * MeshCore traceRoute: synthesize [relayPrefix, destPrefix] for UI-only 1-hop targets
 * when a direct 0-hop repeater neighbor is known.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeshcoreContactDbRow } from '../lib/meshcore/meshcoreHookTypes';
import { clearMeshcorePubKeyRegistry } from '../lib/meshcore/meshcorePubKeyRegistry';
import { pubkeyToNodeId } from '../lib/meshcoreUtils';
import { useNodeStore } from '../stores/nodeStore';
import { usePathHistoryStore } from '../stores/pathHistoryStore';

const { startMeshcoreTracePathMultiplexedMock, getContactsMock } = vi.hoisted(() => ({
  startMeshcoreTracePathMultiplexedMock: vi.fn(),
  getContactsMock: vi.fn().mockResolvedValue([]),
}));
vi.mock('../lib/meshcoreTracePathMultiplex', async (importOriginal) => {
  const actual = await importOriginal();
  return Object.assign({}, actual, {
    startMeshcoreTracePathMultiplexed: (...args: unknown[]) => {
      const promise = startMeshcoreTracePathMultiplexedMock(...args);
      return {
        promise,
        cancel: vi.fn(),
      };
    },
  });
});
import {
  computeMeshcoreTracePrimeAggregateTimeoutMs,
  MESHCORE_PING_NO_ROUTE_ERROR_MSG,
  MESHCORE_TRACE_PRIME_MAX_ROUNDS,
} from '../hooks/meshcore/meshcoreHookPreamble';
import { useMeshcoreRuntime } from '../runtime/useMeshcoreRuntime';
import { resetMeshcoreRuntimeElectronMocks } from '../vitestClearHelpers';

const getSelfInfoMock = vi.fn();

const RELAY_PUBKEY = (() => {
  const b = new Uint8Array(32);
  b[0] = 0x06;
  b[31] = 0xaa;
  return b;
})();
const RELAY_NODE_ID = pubkeyToNodeId(RELAY_PUBKEY);
const RELAY_PUBKEY_HEX = Array.from(RELAY_PUBKEY)
  .map((x) => x.toString(16).padStart(2, '0'))
  .join('');

const REMOTE_PUBKEY = (() => {
  const b = new Uint8Array(32);
  b[0] = 0x3d;
  b[31] = 0x44;
  return b;
})();
const REMOTE_NODE_ID = pubkeyToNodeId(REMOTE_PUBKEY);
const REMOTE_PUBKEY_HEX = Array.from(REMOTE_PUBKEY)
  .map((x) => x.toString(16).padStart(2, '0'))
  .join('');

const SELF_PUBKEY = new Uint8Array(32).fill(0xab);
const MY_NODE_ID = pubkeyToNodeId(SELF_PUBKEY);

const ONE_HOP_PASSIVE_AGGREGATE_MS = computeMeshcoreTracePrimeAggregateTimeoutMs(1, 1, 'passive');
const ONE_HOP_FLOOD_AGGREGATE_MS = computeMeshcoreTracePrimeAggregateTimeoutMs(
  1,
  MESHCORE_TRACE_PRIME_MAX_ROUNDS,
  'flood',
);
/** Passive priming plus optional 1-hop flood fallback when no PathUpdated (129). */
const ONE_HOP_FULL_PRIME_MS = ONE_HOP_PASSIVE_AGGREGATE_MS + ONE_HOP_FLOOD_AGGREGATE_MS;

function makeRadioContact(pubKey: Uint8Array, advName: string) {
  return {
    publicKey: pubKey,
    advName,
    type: 2,
    lastAdvert: 1_700_000_000,
    advLat: 0,
    advLon: 0,
    outPath: new Uint8Array(32),
    outPathLen: 0,
  };
}

function makeRepeaterContactRow(opts: {
  nodeId: number;
  pubKeyHex: string;
  hopsAway: number;
  advName: string;
}): MeshcoreContactDbRow {
  return {
    node_id: opts.nodeId,
    public_key: opts.pubKeyHex,
    adv_name: opts.advName,
    contact_type: 2,
    last_advert: 1_700_000_000,
    adv_lat: null,
    adv_lon: null,
    last_snr: null,
    last_rssi: null,
    favorited: 0,
    nickname: null,
    hops_away: opts.hopsAway,
    contact_flags: null,
    on_radio: 0,
    last_synced_from_radio: null,
  };
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

async function connectConfiguredRuntime() {
  const port = makeMockSerialPort();
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: {
      requestPort: vi.fn().mockResolvedValue(port),
    },
  });

  const { result } = renderHook(() => useMeshcoreRuntime());

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
  return result;
}

describe('useMeshcoreRuntime traceRoute one-hop path synthesis', () => {
  beforeEach(() => {
    resetMeshcoreRuntimeElectronMocks();
    clearMeshcorePubKeyRegistry();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    getContactsMock.mockReset();
    getContactsMock.mockResolvedValue([]);
    startMeshcoreTracePathMultiplexedMock.mockReset();
    startMeshcoreTracePathMultiplexedMock.mockResolvedValue({
      pathLen: 2,
      pathHashes: [RELAY_PUBKEY[0], REMOTE_PUBKEY[0]],
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a synthesized [relayPrefix, destPrefix] path for a 1-hop target with a known 0-hop repeater', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([
      makeRepeaterContactRow({
        nodeId: RELAY_NODE_ID,
        pubKeyHex: RELAY_PUBKEY_HEX,
        hopsAway: 0,
        advName: 'FNL-LONGM-NV0N-RE-0647',
      }),
      makeRepeaterContactRow({
        nodeId: REMOTE_NODE_ID,
        pubKeyHex: REMOTE_PUBKEY_HEX,
        hopsAway: 1,
        advName: 'DEN-LYONS-RBTMT-RC-0700',
      }),
    ]);
    getContactsMock.mockResolvedValue([
      makeRadioContact(RELAY_PUBKEY, 'FNL-LONGM-NV0N-RE-0647'),
      makeRadioContact(REMOTE_PUBKEY, 'DEN-LYONS-RBTMT-RC-0700'),
    ]);

    const result = await connectConfiguredRuntime();

    expect(result.current.nodes.get(RELAY_NODE_ID)?.hops_away).toBe(0);
    expect(result.current.nodes.get(RELAY_NODE_ID)?.hw_model).toBe('Repeater');
    expect(result.current.nodes.get(REMOTE_NODE_ID)?.hops_away).toBe(1);

    vi.useFakeTimers();

    let tracePromise: Promise<boolean>;
    await act(async () => {
      tracePromise = result.current.traceRoute(REMOTE_NODE_ID);
      await vi.advanceTimersByTimeAsync(ONE_HOP_FULL_PRIME_MS);
    });

    await act(async () => {
      await tracePromise!;
    });

    expect(result.current.meshcorePingErrors.get(REMOTE_NODE_ID)).not.toBe(
      MESHCORE_PING_NO_ROUTE_ERROR_MSG,
    );
    expect(startMeshcoreTracePathMultiplexedMock).toHaveBeenCalled();
    const tracePathArg = startMeshcoreTracePathMultiplexedMock.mock.calls[0]?.[1] as Uint8Array;
    expect(tracePathArg).toEqual(new Uint8Array([RELAY_PUBKEY[0], REMOTE_PUBKEY[0]]));
  });

  it('fast-fails pingNoRoute when no 0-hop repeater relay is known for 1-hop', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([
      makeRepeaterContactRow({
        nodeId: REMOTE_NODE_ID,
        pubKeyHex: REMOTE_PUBKEY_HEX,
        hopsAway: 1,
        advName: 'DEN-LYONS-RBTMT-RC-0700',
      }),
    ]);
    getContactsMock.mockResolvedValue([makeRadioContact(REMOTE_PUBKEY, 'DEN-LYONS-RBTMT-RC-0700')]);

    const result = await connectConfiguredRuntime();
    expect(result.current.nodes.get(REMOTE_NODE_ID)?.hops_away).toBe(1);

    vi.useFakeTimers();

    let tracePromise: Promise<boolean>;
    await act(async () => {
      tracePromise = result.current.traceRoute(REMOTE_NODE_ID);
      await vi.advanceTimersByTimeAsync(ONE_HOP_FULL_PRIME_MS);
    });

    await act(async () => {
      const ok = await tracePromise!;
      expect(ok).toBe(false);
    });

    expect(result.current.meshcorePingErrors.get(REMOTE_NODE_ID)).toBe(
      MESHCORE_PING_NO_ROUTE_ERROR_MSG,
    );
    expect(startMeshcoreTracePathMultiplexedMock).not.toHaveBeenCalled();
  });
});
