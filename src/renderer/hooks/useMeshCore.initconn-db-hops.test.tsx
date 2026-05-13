/**
 * Regression: first connect after app start must merge hops from SQLite even when
 * nodesRef has not flushed yet (mount hydration vs initConn race).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pubkeyToNodeId } from '../lib/meshcoreUtils';

const getSelfInfoMock = vi.fn();

// Captures the most-recently-created WebSerial connection so tests can emit live events.
let capturedConn: { emit: (event: string | number, ...args: unknown[]) => void } | null = null;
function captureConnInstance(conn: { emit: (event: string | number, ...args: unknown[]) => void }) {
  capturedConn = conn;
}

const REMOTE_PUBKEY = (() => {
  const b = new Uint8Array(32);
  b[0] = 0x55;
  b[31] = 0x66;
  return b;
})();
const REMOTE_NODE_ID = pubkeyToNodeId(REMOTE_PUBKEY);
const REMOTE_PUBKEY_HEX = Array.from(REMOTE_PUBKEY)
  .map((x) => x.toString(16).padStart(2, '0'))
  .join('');

const SELF_PUBKEY = new Uint8Array(32).fill(0xcd);

vi.mock('@liamcottle/meshcore.js', () => {
  class MockWebSerialConnection {
    private listeners = new Map<string | number, Set<(...args: unknown[]) => void>>();

    constructor(port: unknown) {
      void port;
      captureConnInstance(this);
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
    getContacts = vi.fn().mockResolvedValue([
      {
        publicKey: REMOTE_PUBKEY,
        type: 2,
        advName: 'RemoteInit',
        lastAdvert: 1_700_000_000,
        advLat: 0,
        advLon: 0,
        flags: 0,
        outPathLen: 1,
        outPath: new Uint8Array([REMOTE_PUBKEY[0], REMOTE_PUBKEY[1]]),
      },
    ]);
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
      data: { batteryMilliVolts: 4123, uptimeSecs: 456, queueLen: 0 },
    });
    getStatsRadio = vi.fn().mockResolvedValue({
      type: 1,
      raw: new Uint8Array([1]),
      data: {
        noiseFloor: -110,
        lastRssi: -89,
        lastSnr: 6.5,
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

import { useMeshCore } from './useMeshCore';

function makeMockSerialPort() {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getInfo: vi.fn().mockReturnValue({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
  };
}

describe('useMeshCore initConn merges DB hops at first connect', () => {
  beforeEach(() => {
    capturedConn = null;
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([
      {
        node_id: REMOTE_NODE_ID,
        public_key: REMOTE_PUBKEY_HEX,
        adv_name: 'RemoteInit',
        contact_type: 2,
        last_advert: 1_700_000_000,
        adv_lat: null,
        adv_lon: null,
        last_snr: 0,
        last_rssi: 0,
        favorited: 0,
        nickname: null,
        hops_away: 4,
        on_radio: 0,
        last_synced_from_radio: null,
      },
    ] as never[]);
    vi.mocked(window.electronAPI.db.getNodes).mockResolvedValue([]);
    getSelfInfoMock.mockResolvedValue({
      name: 'SelfRadio',
      publicKey: SELF_PUBKEY,
      type: 1,
      txPower: 22,
      radioFreq: 902_000_000,
    });
  });

  it('live contact event (event 138) preserves persisted hops when radio reports direct path', async () => {
    const port = makeMockSerialPort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort: vi.fn().mockResolvedValue(port) },
    });

    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(result.current.nodes.get(REMOTE_NODE_ID)?.hops_away).toBe(4);
    });

    await act(async () => {
      await result.current.connect('serial');
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
    });

    // Simulate a live contact advertisement arriving after connect with outPathLen=1 (direct, inferred=0).
    // Before the fix, this overwrote hops_away=4 with 0 in both memory and DB.
    const liveContactPayload = {
      publicKey: REMOTE_PUBKEY,
      type: 2,
      advName: 'RemoteInit',
      lastAdvert: 1_700_000_001,
      advLat: 0,
      advLon: 0,
      flags: 0,
      outPathLen: 1,
      outPath: new Uint8Array([REMOTE_PUBKEY[0], REMOTE_PUBKEY[1]]),
    };
    capturedConn?.emit(138, liveContactPayload);

    await waitFor(() => {
      expect(result.current.nodes.get(REMOTE_NODE_ID)?.hops_away).toBe(4);
    });
  });

  it('keeps persisted hops when radio reports direct path on getContacts', async () => {
    const port = makeMockSerialPort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: vi.fn().mockResolvedValue(port),
      },
    });

    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(result.current.nodes.get(REMOTE_NODE_ID)?.hops_away).toBe(4);
    });

    await act(async () => {
      await result.current.connect('serial');
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
    });

    expect(result.current.nodes.get(REMOTE_NODE_ID)?.hops_away).toBe(4);
  });
});

/**
 * Regression: sparse `meshcore_contacts` (e.g. after off-radio cleanup) must not leave hop counts
 * empty when `buildNodesFromContacts` rebuilds from `getContacts` — persisted `nodes` rows are
 * the fallback for contacts not present in prevSnap.
 */
describe('useMeshCore buildNodesFromContacts merges nodes-table hops when meshcore_contacts is empty', () => {
  beforeEach(() => {
    capturedConn = null;
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getNodes).mockResolvedValue([
      { node_id: REMOTE_NODE_ID, hops: 7, hops_away: null },
    ] as never[]);
    getSelfInfoMock.mockResolvedValue({
      name: 'SelfRadio',
      publicKey: SELF_PUBKEY,
      type: 1,
      txPower: 22,
      radioFreq: 902_000_000,
    });
  });

  it('first connect applies saved hops from nodes table when radio reports direct path', async () => {
    const port = makeMockSerialPort();
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort: vi.fn().mockResolvedValue(port) },
    });

    const { result } = renderHook(() => useMeshCore());

    await waitFor(() => {
      expect(vi.mocked(window.electronAPI.db.getMeshcoreContacts)).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.connect('serial');
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('configured');
    });

    expect(result.current.nodes.get(REMOTE_NODE_ID)?.hops_away).toBe(7);
  });
});
