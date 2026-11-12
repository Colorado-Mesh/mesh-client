/**
 * MeshCore traceRoute: synthesize [relayPrefix, destPrefix] for UI-only 1-hop targets
 * when a direct 0-hop repeater neighbor is known.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { touch } from '@/shared/touch';

import type { MeshcoreContactDbRow } from '../lib/meshcore/meshcoreHookTypes';
import { clearMeshcorePubKeyRegistry } from '../lib/meshcore/meshcorePubKeyRegistry';
import {
  meshcoreTraceSimChain,
  simulateMeshcoreTrace,
} from '../lib/meshcoreTraceFirmwareSimTestHelpers';
import { pubkeyToNodeId, resolveMeshcoreRoomLoginHopsAway } from '../lib/meshcoreUtils';
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
      touch(port);
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
      touch(data);
      this.emit('rx', new Uint8Array([25, 0x0f, 3]));
    });
  }

  class MockSerialConnection {
    async write(bytes: Uint8Array) {
      await Promise.resolve();
      touch(bytes);
    }
    async onDataReceived(value: Uint8Array) {
      await Promise.resolve();
      touch(value);
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
      touch(bytes);
    }
    async sendToRadioFrame(data: Uint8Array) {
      await Promise.resolve();
      touch(data);
    }
    async onConnected() {
      await Promise.resolve();
    }
    onDisconnected() {
      return undefined;
    }
    onFrameReceived(frame: Uint8Array) {
      touch(frame);
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
    expect(window.electronAPI.db.getMeshcoreIdentityHydration).toHaveBeenCalled();
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
    vi.mocked(window.electronAPI.db.getMeshcoreMessagesForHydration).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getNodes).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a synthesized [relayPrefix, destPrefix] path for a 1-hop target with a known 0-hop repeater', async () => {
    const contacts = [
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
    ];
    vi.mocked(window.electronAPI.db.getMeshcoreIdentityHydration).mockResolvedValue({
      contacts,
      nodes: [],
      hopHistory: [],
      messages: [],
    });
    getContactsMock.mockResolvedValue([
      makeRadioContact(RELAY_PUBKEY, 'FNL-LONGM-NV0N-RE-0647'),
      makeRoutedRadioContact({
        pubKey: REMOTE_PUBKEY,
        advName: 'DEN-LYONS-RBTMT-RC-0700',
        outPathLenByte: 0xff,
        route: [],
        staleTail: [0x99],
      }),
    ]);
    // Direct tries time out; the synthesized relay path answers.
    startMeshcoreTracePathMultiplexedMock.mockImplementation((_conn, path: Uint8Array) => {
      if (path.length <= 8 && path.every((b, i) => b === REMOTE_PUBKEY[i])) {
        return Promise.reject(new Error('timeout'));
      }
      return Promise.resolve({
        pathLen: path.length,
        pathHashes: Array.from(path),
        pathSnrs: [4, 8],
        lastSnr: 1.25,
        tag: 7,
      });
    });

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
    const expected = new Uint8Array([RELAY_PUBKEY[0], REMOTE_PUBKEY[0], RELAY_PUBKEY[0]]);
    const routed = startMeshcoreTracePathMultiplexedMock.mock.calls.find((call) => {
      const path = call[1] as Uint8Array;
      return path.length === expected.length && path.every((byte, i) => byte === expected[i]);
    });
    // Auto-return: relay → dest → relay so TraceData comes back to the companion.
    expect(routed?.[1]).toEqual(expected);
  });

  it('fast-fails pingNoRoute when no 0-hop repeater relay is known for 1-hop', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreIdentityHydration).mockResolvedValue({
      contacts: [
        makeRepeaterContactRow({
          nodeId: REMOTE_NODE_ID,
          pubKeyHex: REMOTE_PUBKEY_HEX,
          hopsAway: 1,
          advName: 'DEN-LYONS-RBTMT-RC-0700',
        }),
      ],
      nodes: [],
      hopHistory: [],
      messages: [],
    });
    getContactsMock.mockResolvedValue([
      makeRoutedRadioContact({
        pubKey: REMOTE_PUBKEY,
        advName: 'DEN-LYONS-RBTMT-RC-0700',
        outPathLenByte: 0xff,
        route: [],
      }),
    ]);
    startMeshcoreTracePathMultiplexedMock.mockRejectedValue(new Error('timeout'));

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
    expect(startMeshcoreTracePathMultiplexedMock).toHaveBeenCalledTimes(2);
  });
});

/** Keys whose first three bytes all differ, so 1-, 2- and 3-byte hashes are distinct. */
function makeKey(lead: [number, number, number]): Uint8Array {
  const key = new Uint8Array(32).fill(0x5a);
  key.set(lead, 0);
  return key;
}

function keyHex(key: Uint8Array): string {
  return Array.from(key, (x) => x.toString(16).padStart(2, '0')).join('');
}

const NEAR = { name: 'near', pubKey: makeKey([0x57, 0xa1, 0x11]) };
const MID = { name: 'mid', pubKey: makeKey([0x21, 0xb2, 0x12]) };
const FAR = { name: 'far', pubKey: makeKey([0x07, 0xc3, 0x13]) };
const FAR_NODE_ID = pubkeyToNodeId(FAR.pubKey);

/**
 * A contact as meshcore.js hands it over: a 64-byte path buffer and the path length byte read
 * as int8. `staleTail` stands for bytes a longer, older route left behind the current one.
 */
function makeRoutedRadioContact(opts: {
  pubKey: Uint8Array;
  advName: string;
  outPathLenByte: number;
  route: number[];
  staleTail?: number[];
}) {
  const outPath = new Uint8Array(64);
  outPath.set(opts.route, 0);
  outPath.set(opts.staleTail ?? [], opts.route.length);
  return {
    publicKey: opts.pubKey,
    advName: opts.advName,
    type: 2,
    lastAdvert: 1_700_000_000,
    advLat: 0,
    advLon: 0,
    outPath,
    outPathLen: opts.outPathLenByte > 127 ? opts.outPathLenByte - 256 : opts.outPathLenByte,
  };
}

interface RadioRouteScenario {
  name: string;
  relays: { name: string; pubKey: Uint8Array }[];
  outPathLenByte: number;
  route: number[];
  staleTail?: number[];
  wirePath: number[];
  wireFlags: number;
}

const RADIO_ROUTE_SCENARIOS: RadioRouteScenario[] = [
  {
    name: 'one relay, 1-byte hashes',
    relays: [NEAR],
    outPathLenByte: 0x01,
    route: [0x57],
    staleTail: [0xee, 0xdd],
    wirePath: [0x57, 0x07, 0x57],
    wireFlags: 0,
  },
  {
    name: 'one relay, 2-byte hashes',
    relays: [NEAR],
    outPathLenByte: 0x41,
    route: [0x57, 0xa1],
    staleTail: [0xee, 0xdd],
    wirePath: [0x57, 0xa1, 0x07, 0xc3, 0x57, 0xa1],
    wireFlags: 1,
  },
  {
    name: 'one relay, 3-byte hashes (sent as 2-byte entries)',
    relays: [NEAR],
    outPathLenByte: 0x81,
    route: [0x57, 0xa1, 0x11],
    staleTail: [0xee, 0xdd],
    wirePath: [0x57, 0xa1, 0x07, 0xc3, 0x57, 0xa1],
    wireFlags: 1,
  },
  {
    name: 'two relays, 1-byte hashes',
    relays: [NEAR, MID],
    outPathLenByte: 0x02,
    route: [0x57, 0x21],
    staleTail: [0xee],
    wirePath: [0x57, 0x21, 0x07, 0x21, 0x57],
    wireFlags: 0,
  },
  {
    name: 'two relays, 2-byte hashes',
    relays: [NEAR, MID],
    outPathLenByte: 0x42,
    route: [0x57, 0xa1, 0x21, 0xb2],
    wirePath: [0x57, 0xa1, 0x21, 0xb2, 0x07, 0xc3, 0x21, 0xb2, 0x57, 0xa1],
    wireFlags: 1,
  },
];

describe('useMeshcoreRuntime traceRoute over a route the radio knows', () => {
  beforeEach(() => {
    resetMeshcoreRuntimeElectronMocks();
    clearMeshcorePubKeyRegistry();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    getContactsMock.mockReset();
    startMeshcoreTracePathMultiplexedMock.mockReset();
    usePathHistoryStore.setState({ records: new Map(), lruOrder: [] });
    getSelfInfoMock.mockResolvedValue({
      name: 'SelfRadio',
      publicKey: SELF_PUBKEY,
      type: 1,
      txPower: 22,
      radioFreq: 902_000_000,
    });
    vi.mocked(window.electronAPI.db.getMeshcoreMessagesForHydration).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getNodes).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreIdentityHydration).mockResolvedValue({
      contacts: [],
      nodes: [],
      hopHistory: [],
      messages: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Answer each trace the way a mesh of these nodes would, or never if it cannot return. */
  function answerTracesLikeFirmware(relays: RadioRouteScenario['relays']) {
    const mesh = meshcoreTraceSimChain(relays, FAR);
    startMeshcoreTracePathMultiplexedMock.mockImplementation((...args: unknown[]) => {
      const path = args[1] as Uint8Array;
      const flags = (args[4] as number | undefined) ?? 0;
      const sim = simulateMeshcoreTrace(mesh, path, flags);
      if (!sim.returned) return Promise.reject(new Error('timeout'));
      return Promise.resolve({
        pathLen: path.length >> (flags & 3),
        pathLenByte: path.length,
        flags,
        pathHashes: Array.from(path),
        pathSnrs: Array.from({ length: sim.snrCount }, () => 20),
        lastSnr: 6,
        tag: 7,
      });
    });
  }

  async function pingFar(result: Awaited<ReturnType<typeof connectConfiguredRuntime>>) {
    let ok = false;
    await act(async () => {
      const tracePromise = result.current.traceRoute(FAR_NODE_ID);
      await vi.advanceTimersByTimeAsync(ONE_HOP_FULL_PRIME_MS);
      ok = await tracePromise;
    });
    return ok;
  }

  it.each(RADIO_ROUTE_SCENARIOS)(
    'ping comes back through $name',
    async ({ relays, outPathLenByte, route, staleTail, wirePath, wireFlags }) => {
      getContactsMock.mockResolvedValue([
        makeRoutedRadioContact({
          pubKey: FAR.pubKey,
          advName: 'DEN-FAR-RC',
          outPathLenByte,
          route,
          staleTail,
        }),
      ]);
      answerTracesLikeFirmware(relays);

      const result = await connectConfiguredRuntime();
      expect(result.current.nodes.get(FAR_NODE_ID)?.hops_away).toBe(relays.length);

      vi.useFakeTimers();
      const ok = await pingFar(result);

      expect(startMeshcoreTracePathMultiplexedMock).toHaveBeenCalledTimes(1);
      const call = startMeshcoreTracePathMultiplexedMock.mock.calls[0];
      expect(Array.from(call?.[1] as Uint8Array)).toEqual(wirePath);
      expect(call?.[4] ?? 0).toBe(wireFlags);
      expect(result.current.meshcorePingErrors.get(FAR_NODE_ID)).toBeUndefined();
      expect(ok).toBe(true);
      expect(result.current.nodes.get(FAR_NODE_ID)?.hops_away).toBe(relays.length);
      const shown = result.current.meshcoreTraceResults.get(FAR_NODE_ID);
      expect(shown?.pathLen).toBe(relays.length + 1);
      // The reply covers the round trip; the result keeps the outbound leg: the relays and
      // the repeater, one SNR per relay, and the SNR the repeater heard the trace at.
      const entryBytes = 1 << wireFlags;
      expect(shown?.pathHashes).toEqual(wirePath.slice(0, (relays.length + 1) * entryBytes));
      expect(shown?.pathSnrs).toHaveLength(relays.length);
      expect(shown?.lastSnr).toBe(5);
      // The verified route is saved to path history in its stored shape at every hash size
      // (1-byte hashes: the relays plus the one trailing byte the app slices with them).
      const storedRoute =
        outPathLenByte < 0x40 ? [...route, ...(staleTail ?? []).slice(0, 1)] : route;
      expect(usePathHistoryStore.getState().records.get(FAR_NODE_ID)?.[0]?.pathBytes).toEqual(
        storedRoute,
      );
    },
  );

  // The radio sends all 64 path bytes with every contact and only the length byte says how
  // many are the route. A repeater that was once reached through relays and is now heard
  // direct keeps the old relay hashes in the buffer.
  it.each([
    {
      name: 'a 1-byte length, two leftover bytes',
      outPathLenByte: 0x00,
      leftover: [0x57, 0x21],
      wirePath: [0x07],
      wireFlags: 0,
    },
    {
      name: 'a 1-byte length, three leftover bytes',
      outPathLenByte: 0x00,
      leftover: [0x57, 0x21, 0xee],
      wirePath: [0x07],
      wireFlags: 0,
    },
    {
      name: 'a 1-byte length, one leftover byte that is a neighbour',
      outPathLenByte: 0x00,
      leftover: [0x57],
      wirePath: [0x07],
      wireFlags: 0,
    },
    {
      name: 'a 2-byte length, a leftover 2-byte route',
      outPathLenByte: 0x40,
      leftover: [0xee, 0xdd],
      wirePath: [0x07, 0xc3],
      wireFlags: 1,
    },
    {
      name: 'a 3-byte length, a leftover 3-byte route',
      outPathLenByte: 0x80,
      leftover: [0x57, 0xa1, 0x11],
      wirePath: [0x07, 0xc3],
      wireFlags: 1,
    },
  ])(
    'a repeater the radio lists as direct is pinged by its own key with $name',
    async ({ outPathLenByte, leftover, wirePath, wireFlags }) => {
      getContactsMock.mockResolvedValue([
        makeRoutedRadioContact({
          pubKey: FAR.pubKey,
          advName: 'DEN-FAR-RC',
          outPathLenByte,
          route: [],
          staleTail: leftover,
        }),
      ]);
      // The repeater is in direct range; a second repeater hears both ends.
      const mesh = {
        companion: 'companion',
        nodes: [
          { name: NEAR.name, pubKey: NEAR.pubKey, forwards: true },
          { name: FAR.name, pubKey: FAR.pubKey, forwards: true },
        ],
        links: [
          ['companion', NEAR.name],
          ['companion', FAR.name],
          [NEAR.name, FAR.name],
        ] as [string, string][],
      };
      const answeredBy: string[][] = [];
      startMeshcoreTracePathMultiplexedMock.mockImplementation((...args: unknown[]) => {
        const path = args[1] as Uint8Array;
        const flags = (args[4] as number | undefined) ?? 0;
        const sim = simulateMeshcoreTrace(mesh, path, flags);
        if (!sim.returned) return Promise.reject(new Error('timeout'));
        answeredBy.push(sim.forwardedBy);
        return Promise.resolve({
          pathLen: path.length >> (flags & 3),
          pathLenByte: path.length,
          flags,
          pathHashes: Array.from(path),
          pathSnrs: Array.from({ length: sim.snrCount }, () => 20),
          lastSnr: 6,
          tag: 7,
        });
      });

      const result = await connectConfiguredRuntime();

      vi.useFakeTimers();
      const ok = await pingFar(result);

      expect(result.current.meshcorePingErrors.get(FAR_NODE_ID)).toBeUndefined();
      expect(ok).toBe(true);
      expect(startMeshcoreTracePathMultiplexedMock).toHaveBeenCalledTimes(1);
      const call = startMeshcoreTracePathMultiplexedMock.mock.calls[0];
      expect(Array.from(call?.[1] as Uint8Array)).toEqual(wirePath);
      expect(call?.[4] ?? 0).toBe(wireFlags);
      // The pinged repeater answered, not a neighbour named by the leftover bytes.
      expect(answeredBy).toEqual([[FAR.name]]);
      expect(result.current.nodes.get(FAR_NODE_ID)?.hops_away).toBe(0);
    },
  );

  // A Status or Telemetry timeout resets the contact's route to unknown (0xFF) before the
  // flood resend; when no path comes back the radio keeps that length. The buffer still holds
  // the older route's relay hashes, which the app reads as hops.
  function routeResetContact(staleTail: number[]) {
    return makeRoutedRadioContact({
      pubKey: FAR.pubKey,
      advName: 'DEN-FAR-RC',
      outPathLenByte: 0xff,
      route: [],
      staleTail,
    });
  }

  function answerTracesIn(mesh: Parameters<typeof simulateMeshcoreTrace>[0]) {
    startMeshcoreTracePathMultiplexedMock.mockImplementation((...args: unknown[]) => {
      const path = args[1] as Uint8Array;
      const flags = (args[4] as number | undefined) ?? 0;
      const sim = simulateMeshcoreTrace(mesh, path, flags);
      if (!sim.returned) return Promise.reject(new Error('timeout'));
      return Promise.resolve({
        pathLen: path.length >> (flags & 3),
        pathLenByte: path.length,
        flags,
        pathHashes: Array.from(path),
        pathSnrs: Array.from({ length: sim.snrCount }, () => 20),
        lastSnr: 6,
        tag: 7,
      });
    });
  }

  it('a repeater in direct range whose route the radio reset is pinged by its own key', async () => {
    getContactsMock.mockResolvedValue([routeResetContact([0x57, 0x21])]);
    // Only the repeater is in range; the relays the leftover bytes name are not.
    answerTracesIn({
      companion: 'companion',
      nodes: [{ name: FAR.name, pubKey: FAR.pubKey, forwards: true }],
      links: [['companion', FAR.name]],
    });

    const result = await connectConfiguredRuntime();
    expect(result.current.nodes.get(FAR_NODE_ID)?.hops_away).toBe(1);

    vi.useFakeTimers();
    const ok = await pingFar(result);

    expect(result.current.meshcorePingErrors.get(FAR_NODE_ID)).toBeUndefined();
    expect(ok).toBe(true);
    expect(startMeshcoreTracePathMultiplexedMock).toHaveBeenCalledTimes(1);
    const call = startMeshcoreTracePathMultiplexedMock.mock.calls[0];
    // Hash-sized dest prefix first (1-byte when companion mode is unset).
    expect(Array.from(call?.[1] as Uint8Array)).toEqual(Array.from(FAR.pubKey.subarray(0, 1)));
    expect(call?.[4] ?? 0).toBe(0);
    expect(result.current.nodes.get(FAR_NODE_ID)?.hops_away).toBe(0);
    // The stored route is the repeater's own 1-byte prefix.
    expect(usePathHistoryStore.getState().records.get(FAR_NODE_ID)?.[0]?.pathBytes).toEqual([0x07]);
  });

  it('drops a direct reply when the radio disconnects before the ping finishes', async () => {
    // The buffer holds the whole key: no usable stored route, so after the direct try answers
    // the ping still reads path history, and the app disconnects during that read.
    getContactsMock.mockResolvedValue([routeResetContact(Array.from(FAR.pubKey))]);
    answerTracesIn({
      companion: 'companion',
      nodes: [{ name: FAR.name, pubKey: FAR.pubKey, forwards: true }],
      links: [['companion', FAR.name]],
    });
    const result = await connectConfiguredRuntime();
    expect(result.current.nodes.get(FAR_NODE_ID)?.hops_away).toBeGreaterThanOrEqual(1);

    const ensureBestPathLoaded = usePathHistoryStore.getState().ensureBestPathLoaded;
    let readsDuringPing = 0;
    usePathHistoryStore.setState({
      ensureBestPathLoaded: async () => {
        readsDuringPing += 1;
        await result.current.disconnect();
        return null;
      },
    });
    try {
      vi.useFakeTimers();
      const ok = await pingFar(result);

      expect(readsDuringPing).toBeGreaterThan(0);
      expect(startMeshcoreTracePathMultiplexedMock).toHaveBeenCalledTimes(1);
      expect(startMeshcoreTracePathMultiplexedMock.mock.calls[0]?.[4] ?? 0).toBe(0);
      expect(ok).toBe(false);
      expect(result.current.meshcoreTraceResults.get(FAR_NODE_ID)).toBeUndefined();
      expect(usePathHistoryStore.getState().records.get(FAR_NODE_ID)).toBeUndefined();
    } finally {
      usePathHistoryStore.setState({ ensureBestPathLoaded });
    }
  });

  it('a repeater the radio never routed is tried direct first, then through a known 0-hop relay', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreIdentityHydration).mockResolvedValue({
      contacts: [
        makeRepeaterContactRow({
          nodeId: pubkeyToNodeId(NEAR.pubKey),
          pubKeyHex: keyHex(NEAR.pubKey),
          hopsAway: 0,
          advName: 'DEN-NEAR-RC',
        }),
        makeRepeaterContactRow({
          nodeId: FAR_NODE_ID,
          pubKeyHex: keyHex(FAR.pubKey),
          hopsAway: 1,
          advName: 'DEN-FAR-RC',
        }),
      ],
      nodes: [],
      hopHistory: [],
      messages: [],
    });
    // 0xFF with a clean buffer: the radio has never held a route to it.
    getContactsMock.mockResolvedValue([
      makeRoutedRadioContact({
        pubKey: NEAR.pubKey,
        advName: 'DEN-NEAR-RC',
        outPathLenByte: 0x00,
        route: [],
      }),
      makeRoutedRadioContact({
        pubKey: FAR.pubKey,
        advName: 'DEN-FAR-RC',
        outPathLenByte: 0xff,
        route: [],
      }),
    ]);
    answerTracesLikeFirmware([NEAR]);
    const result = await connectConfiguredRuntime();
    expect(result.current.nodes.get(FAR_NODE_ID)?.hops_away).toBe(1);

    vi.useFakeTimers();
    expect(await pingFar(result)).toBe(true);

    // Hash-prefix + full-key miss; a known 0-hop relay is enough evidence to synth.
    expect(startMeshcoreTracePathMultiplexedMock).toHaveBeenCalledTimes(3);
    const [prefix, fullKey, routed] = startMeshcoreTracePathMultiplexedMock.mock.calls;
    expect(Array.from(prefix?.[1] as Uint8Array)).toEqual(Array.from(FAR.pubKey.subarray(0, 1)));
    expect(prefix?.[4] ?? 0).toBe(0);
    expect(Array.from(fullKey?.[1] as Uint8Array)).toEqual(Array.from(FAR.pubKey.subarray(0, 8)));
    expect(fullKey?.[4]).toBe(3);
    expect(Array.from(routed?.[1] as Uint8Array)).toEqual([0x57, 0x07, 0x57]);
    expect(result.current.meshcorePingErrors.get(FAR_NODE_ID)).toBeUndefined();
  });

  it('a repeater behind a relay whose route the radio reset still answers through it', async () => {
    // 0x57 is the relay; 0xee is the trailing byte a 1-byte route is sliced with.
    getContactsMock.mockResolvedValue([routeResetContact([0x57, 0xee])]);
    answerTracesLikeFirmware([NEAR]);

    const result = await connectConfiguredRuntime();
    expect(result.current.nodes.get(FAR_NODE_ID)?.hops_away).toBe(1);

    vi.useFakeTimers();
    const ok = await pingFar(result);

    expect(result.current.meshcorePingErrors.get(FAR_NODE_ID)).toBeUndefined();
    expect(ok).toBe(true);
    // Prefix + full-key direct tries are not answered; then out-and-back through the relay.
    expect(startMeshcoreTracePathMultiplexedMock).toHaveBeenCalledTimes(3);
    const [prefix, fullKey, routed] = startMeshcoreTracePathMultiplexedMock.mock.calls;
    expect(Array.from(prefix?.[1] as Uint8Array)).toEqual(Array.from(FAR.pubKey.subarray(0, 1)));
    expect(prefix?.[4] ?? 0).toBe(0);
    expect(Array.from(fullKey?.[1] as Uint8Array)).toEqual(Array.from(FAR.pubKey.subarray(0, 8)));
    expect(fullKey?.[4]).toBe(3);
    expect(Array.from(routed?.[1] as Uint8Array)).toEqual([0x57, 0x07, 0x57]);
    expect(result.current.nodes.get(FAR_NODE_ID)?.hops_away).toBe(1);

    // A ping teaches the radio no route, so it still has none: the next ping tries direct
    // first again, then goes through the relay.
    expect(await pingFar(result)).toBe(true);
    expect(startMeshcoreTracePathMultiplexedMock).toHaveBeenCalledTimes(6);
    const [, , , prefixAgain, fullKeyAgain, routedAgain] =
      startMeshcoreTracePathMultiplexedMock.mock.calls;
    expect(prefixAgain?.[4] ?? 0).toBe(0);
    expect(fullKeyAgain?.[4]).toBe(3);
    expect(Array.from(routedAgain?.[1] as Uint8Array)).toEqual([0x57, 0x07, 0x57]);
  });

  it('a second ping reuses the route the first one stored', async () => {
    const scenario = RADIO_ROUTE_SCENARIOS[0];
    getContactsMock.mockResolvedValue([
      makeRoutedRadioContact({
        pubKey: FAR.pubKey,
        advName: 'DEN-FAR-RC',
        outPathLenByte: scenario.outPathLenByte,
        route: scenario.route,
        staleTail: scenario.staleTail,
      }),
    ]);
    answerTracesLikeFirmware(scenario.relays);
    const result = await connectConfiguredRuntime();

    vi.useFakeTimers();
    expect(await pingFar(result)).toBe(true);
    expect(await pingFar(result)).toBe(true);

    expect(startMeshcoreTracePathMultiplexedMock).toHaveBeenCalledTimes(2);
    const second = startMeshcoreTracePathMultiplexedMock.mock.calls[1];
    expect(Array.from(second?.[1] as Uint8Array)).toEqual(scenario.wirePath);
  });

  it('a radio-direct contact with stale UI hops is pinged zero-hop at 2-byte width', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreIdentityHydration).mockResolvedValue({
      contacts: [
        makeRepeaterContactRow({
          nodeId: FAR_NODE_ID,
          pubKeyHex: keyHex(FAR.pubKey),
          hopsAway: 1,
          advName: 'DEN-FAR-RC',
        }),
      ],
      nodes: [],
      hopHistory: [],
      messages: [],
    });
    // 0x40: radio says direct with 2-byte path hashes; UI hops are stale from an advert.
    getContactsMock.mockResolvedValue([
      makeRoutedRadioContact({
        pubKey: FAR.pubKey,
        advName: 'DEN-FAR-RC',
        outPathLenByte: 0x40,
        route: [],
      }),
    ]);
    answerTracesIn({
      companion: 'companion',
      nodes: [{ name: FAR.name, pubKey: FAR.pubKey, forwards: true }],
      links: [['companion', FAR.name]],
    });
    const result = await connectConfiguredRuntime();
    expect(result.current.nodes.get(FAR_NODE_ID)?.hops_away).toBe(1);

    vi.useFakeTimers();
    const ok = await pingFar(result);

    const call = startMeshcoreTracePathMultiplexedMock.mock.calls[0];
    expect(Array.from(call?.[1] as Uint8Array)).toEqual([0x07, 0xc3]);
    expect(call?.[4] ?? 0).toBe(1);
    expect(ok).toBe(true);
    expect(result.current.nodes.get(FAR_NODE_ID)?.hops_away).toBe(0);

    expect(await pingFar(result)).toBe(true);
    expect(startMeshcoreTracePathMultiplexedMock).toHaveBeenCalledTimes(2);
    const second = startMeshcoreTracePathMultiplexedMock.mock.calls[1];
    expect(Array.from(second?.[1] as Uint8Array)).toEqual([0x07, 0xc3]);
  });

  it('room login still reads one hop from the route a synthesized 1-byte ping stored', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreIdentityHydration).mockResolvedValue({
      contacts: [
        makeRepeaterContactRow({
          nodeId: pubkeyToNodeId(NEAR.pubKey),
          pubKeyHex: keyHex(NEAR.pubKey),
          hopsAway: 0,
          advName: 'DEN-NEAR-RC',
        }),
        makeRepeaterContactRow({
          nodeId: FAR_NODE_ID,
          pubKeyHex: keyHex(FAR.pubKey),
          hopsAway: 1,
          advName: 'DEN-FAR-RC',
        }),
      ],
      nodes: [],
      hopHistory: [],
      messages: [],
    });
    getContactsMock.mockResolvedValue([
      makeRoutedRadioContact({
        pubKey: NEAR.pubKey,
        advName: 'DEN-NEAR-RC',
        outPathLenByte: 0x00,
        route: [],
      }),
      makeRoutedRadioContact({
        pubKey: FAR.pubKey,
        advName: 'DEN-FAR-RC',
        outPathLenByte: 0xff,
        route: [],
        // Leftover evidence lets 1-hop synthesis run after direct tries miss (clean 0xFF aborts).
        staleTail: [0x99],
      }),
    ]);
    answerTracesLikeFirmware([NEAR]);
    const result = await connectConfiguredRuntime();

    vi.useFakeTimers();
    expect(await pingFar(result)).toBe(true);

    // Prefix + full-key direct tries miss; then synthesized [relay, dest] round trip.
    const routed = startMeshcoreTracePathMultiplexedMock.mock.calls[2];
    expect(Array.from(routed?.[1] as Uint8Array)).toEqual([0x57, 0x07, 0x57]);
    // The verified route goes to path history in the same bytes the shared route map holds.
    const stored = usePathHistoryStore.getState().records.get(FAR_NODE_ID)?.[0]?.pathBytes ?? [];
    expect(stored).toEqual([0x57, 0x07]);
    expect(resolveMeshcoreRoomLoginHopsAway({ hops_away: 1 }, Uint8Array.from(stored))).toBe(1);
  });

  it('a 1-hop repeater with no route and no relay fails with no route', async () => {
    vi.mocked(window.electronAPI.db.getMeshcoreIdentityHydration).mockResolvedValue({
      contacts: [
        makeRepeaterContactRow({
          nodeId: FAR_NODE_ID,
          pubKeyHex: keyHex(FAR.pubKey),
          hopsAway: 1,
          advName: 'DEN-FAR-RC',
        }),
      ],
      nodes: [],
      hopHistory: [],
      messages: [],
    });
    getContactsMock.mockResolvedValue([
      makeRoutedRadioContact({
        pubKey: FAR.pubKey,
        advName: 'DEN-FAR-RC',
        outPathLenByte: 0xff,
        route: [],
      }),
    ]);
    answerTracesLikeFirmware([NEAR]);
    const result = await connectConfiguredRuntime();
    expect(result.current.nodes.get(FAR_NODE_ID)?.hops_away).toBe(1);

    vi.useFakeTimers();
    const ok = await pingFar(result);

    expect(ok).toBe(false);
    // Hash-prefix + full-key direct tries, then abort without a relay.
    expect(startMeshcoreTracePathMultiplexedMock).toHaveBeenCalledTimes(2);
    expect(result.current.meshcorePingErrors.get(FAR_NODE_ID)).toBe(
      MESHCORE_PING_NO_ROUTE_ERROR_MSG,
    );
  });
});
