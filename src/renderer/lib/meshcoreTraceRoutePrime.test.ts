import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  computeMeshcoreTracePrimeAggregateTimeoutMs,
  computeMeshcoreTracePrimeWaitMs,
  MESHCORE_TRACE_PRIME_CONTACT_REFRESH_MS,
  MESHCORE_TRACE_PRIME_MAX_ROUNDS,
  MESHCORE_TRACE_PRIME_WAIT_BASE_MS,
  MESHCORE_TRACE_PRIME_WAIT_CAP_MS,
  MESHCORE_TRACE_PRIME_WAIT_PER_HOP_MS,
} from '@/renderer/hooks/meshcore/meshcoreHookPreamble';

import type { MeshCoreContactRaw } from './meshcore/meshcoreHookTypes';
import { primeMeshcoreTraceRoute } from './meshcoreTraceRoutePrime';
import { pubkeyToNodeId } from './meshcoreUtils';

const REMOTE_PUBKEY = (() => {
  const b = new Uint8Array(32);
  b[0] = 0x33;
  b[31] = 0x44;
  return b;
})();
const REMOTE_NODE_ID = pubkeyToNodeId(REMOTE_PUBKEY);

describe('computeMeshcoreTracePrimeWaitMs', () => {
  it('scales with hop count and caps at 45s', () => {
    expect(computeMeshcoreTracePrimeWaitMs(0)).toBe(MESHCORE_TRACE_PRIME_WAIT_BASE_MS);
    expect(computeMeshcoreTracePrimeWaitMs(2)).toBe(
      MESHCORE_TRACE_PRIME_WAIT_BASE_MS + 2 * MESHCORE_TRACE_PRIME_WAIT_PER_HOP_MS,
    );
    expect(computeMeshcoreTracePrimeWaitMs(10)).toBe(MESHCORE_TRACE_PRIME_WAIT_CAP_MS);
  });
});

describe('computeMeshcoreTracePrimeAggregateTimeoutMs', () => {
  it('passive strategy covers pre/post getContacts plus PathUpdated wait', () => {
    const wait1 = computeMeshcoreTracePrimeWaitMs(1);
    expect(computeMeshcoreTracePrimeAggregateTimeoutMs(1, 1, 'passive')).toBe(
      2 * MESHCORE_TRACE_PRIME_CONTACT_REFRESH_MS + wait1,
    );
    const wait3 = computeMeshcoreTracePrimeWaitMs(3);
    expect(computeMeshcoreTracePrimeAggregateTimeoutMs(3, 1, 'passive')).toBe(
      2 * MESHCORE_TRACE_PRIME_CONTACT_REFRESH_MS + wait3,
    );
  });
});

describe('primeMeshcoreTraceRoute', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers PathUpdated listener before sendFloodAdvert resolves', async () => {
    const callOrder: string[] = [];
    const listeners = new Map<number, Set<(...args: unknown[]) => void>>();

    const conn = {
      on: vi.fn((event: number, cb: (...args: unknown[]) => void) => {
        if (event === 129) {
          callOrder.push('on129');
          const set = listeners.get(129) ?? new Set();
          set.add(cb);
          listeners.set(129, set);
        }
      }),
      off: vi.fn((event: number, cb: (...args: unknown[]) => void) => {
        listeners.get(event)?.delete(cb);
      }),
      sendFloodAdvert: vi.fn(() => {
        callOrder.push('sendFloodAdvert');
        return Promise.resolve();
      }),
      getContacts: vi.fn(() => Promise.resolve([])),
    };

    const outPathMapRef = new Map<number, Uint8Array>();
    const primePromise = primeMeshcoreTraceRoute({
      conn: conn,
      nodeId: REMOTE_NODE_ID,
      pubKey: REMOTE_PUBKEY,
      hopsAway: 2,
      outPathMapRef,
      maxRounds: 1,
      strategy: 'flood',
    });

    await vi.runOnlyPendingTimersAsync();
    await primePromise;

    expect(callOrder.indexOf('on129')).toBeLessThan(callOrder.indexOf('sendFloodAdvert'));
    expect(conn.sendFloodAdvert).toHaveBeenCalledTimes(1);
  });

  it('breaks early when getContacts returns a usable multi-hop path', async () => {
    const usablePath = new Uint8Array([0x11, 0x22, 0x33]);
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      sendFloodAdvert: vi.fn(() => Promise.resolve(undefined)),
      getContacts: vi.fn(() =>
        Promise.resolve([
          {
            publicKey: REMOTE_PUBKEY,
            outPath: usablePath,
            outPathLen: 2,
            type: 2,
            advName: 'RPT',
            lastAdvert: 1,
            advLat: 0,
            advLon: 0,
            flags: 0,
          },
        ]),
      ),
    };

    const outPathMapRef = new Map<number, Uint8Array>();
    const resultPromise = primeMeshcoreTraceRoute({
      conn: conn,
      nodeId: REMOTE_NODE_ID,
      pubKey: REMOTE_PUBKEY,
      hopsAway: 2,
      outPathMapRef,
      maxRounds: MESHCORE_TRACE_PRIME_MAX_ROUNDS,
      strategy: 'flood',
    });

    await vi.runOnlyPendingTimersAsync();
    const result = await resultPromise;

    expect(result.path).toEqual(usablePath);
    expect(conn.sendFloodAdvert).toHaveBeenCalledTimes(1);
    expect(outPathMapRef.get(REMOTE_NODE_ID)).toEqual(usablePath);
  });

  it('uses outPathMapRef populated during flood advert when getContacts is empty', async () => {
    const usablePath = new Uint8Array([0xaa, 0xbb]);
    const listeners = new Map<number, Set<(...args: unknown[]) => void>>();
    let floodAdvertStarted = false;

    const conn = {
      on: vi.fn((event: number, cb: (...args: unknown[]) => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(cb);
        listeners.set(event, set);
      }),
      off: vi.fn((event: number, cb: (...args: unknown[]) => void) => {
        listeners.get(event)?.delete(cb);
      }),
      sendFloodAdvert: vi.fn(() => {
        floodAdvertStarted = true;
        listeners.get(129)?.forEach((cb) => {
          cb({ publicKey: REMOTE_PUBKEY });
        });
        return Promise.resolve();
      }),
      getContacts: vi.fn(() => {
        expect(floodAdvertStarted).toBe(true);
        return Promise.resolve([]);
      }),
    };

    const outPathMapRef = new Map<number, Uint8Array>([[REMOTE_NODE_ID, usablePath]]);
    const resultPromise = primeMeshcoreTraceRoute({
      conn: conn,
      nodeId: REMOTE_NODE_ID,
      pubKey: REMOTE_PUBKEY,
      hopsAway: 2,
      outPathMapRef,
      maxRounds: 1,
      strategy: 'flood',
    });

    await vi.runOnlyPendingTimersAsync();
    const result = await resultPromise;

    expect(result.path).toEqual(usablePath);
  });

  it('runs a second flood round when the first yields no usable path', async () => {
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      sendFloodAdvert: vi.fn(() => Promise.resolve(undefined)),
      getContacts: vi.fn(() => Promise.resolve([])),
    };

    const outPathMapRef = new Map<number, Uint8Array>();
    const waitMs = computeMeshcoreTracePrimeWaitMs(2);
    const resultPromise = primeMeshcoreTraceRoute({
      conn: conn,
      nodeId: REMOTE_NODE_ID,
      pubKey: REMOTE_PUBKEY,
      hopsAway: 2,
      outPathMapRef,
      maxRounds: MESHCORE_TRACE_PRIME_MAX_ROUNDS,
      strategy: 'flood',
    });

    await vi.advanceTimersByTimeAsync(waitMs * MESHCORE_TRACE_PRIME_MAX_ROUNDS);
    const result = await resultPromise;

    expect(result.path).toBeUndefined();
    expect(conn.sendFloodAdvert).toHaveBeenCalledTimes(MESHCORE_TRACE_PRIME_MAX_ROUNDS);
  });

  it('continues to round 2 when sendFloodAdvert rejects on the first round', async () => {
    let floodRound = 0;
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      sendFloodAdvert: vi.fn(() => {
        floodRound += 1;
        if (floodRound === 1) {
          return Promise.reject(new Error('flood rejected'));
        }
        return Promise.resolve(undefined);
      }),
      getContacts: vi.fn(() => Promise.resolve([])),
    };

    const outPathMapRef = new Map<number, Uint8Array>();
    const waitMs = computeMeshcoreTracePrimeWaitMs(2);
    const resultPromise = primeMeshcoreTraceRoute({
      conn: conn,
      nodeId: REMOTE_NODE_ID,
      pubKey: REMOTE_PUBKEY,
      hopsAway: 2,
      outPathMapRef,
      maxRounds: MESHCORE_TRACE_PRIME_MAX_ROUNDS,
      strategy: 'flood',
    });

    await vi.advanceTimersByTimeAsync(waitMs * MESHCORE_TRACE_PRIME_MAX_ROUNDS);
    await resultPromise;

    expect(conn.sendFloodAdvert).toHaveBeenCalledTimes(MESHCORE_TRACE_PRIME_MAX_ROUNDS);
  });

  it('falls back to outPathMapRef when getContacts throws', async () => {
    const usablePath = new Uint8Array([0x11, 0x22, 0x33]);
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      sendFloodAdvert: vi.fn(() => Promise.resolve(undefined)),
      getContacts: vi.fn(() => Promise.reject(new Error('radio busy'))),
    };

    const outPathMapRef = new Map<number, Uint8Array>([[REMOTE_NODE_ID, usablePath]]);
    const resultPromise = primeMeshcoreTraceRoute({
      conn: conn,
      nodeId: REMOTE_NODE_ID,
      pubKey: REMOTE_PUBKEY,
      hopsAway: 2,
      outPathMapRef,
      maxRounds: 1,
    });

    await vi.runOnlyPendingTimersAsync();
    const result = await resultPromise;

    expect(result.path).toEqual(usablePath);
    expect(conn.getContacts).toHaveBeenCalledTimes(1);
  });

  it('continues promptly when PathUpdated 129 arrives during wait', async () => {
    const listeners = new Map<number, Set<(...args: unknown[]) => void>>();
    const usablePath = new Uint8Array([0x11, 0x22]);
    const waitMs = computeMeshcoreTracePrimeWaitMs(2);

    const conn = {
      on: vi.fn((event: number, cb: (...args: unknown[]) => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(cb);
        listeners.set(event, set);
      }),
      off: vi.fn((event: number, cb: (...args: unknown[]) => void) => {
        listeners.get(event)?.delete(cb);
      }),
      sendFloodAdvert: vi.fn(() => {
        listeners.get(129)?.forEach((cb) => {
          cb({ publicKey: REMOTE_PUBKEY });
        });
        return Promise.resolve(undefined);
      }),
      getContacts: vi.fn(() =>
        Promise.resolve([
          {
            publicKey: REMOTE_PUBKEY,
            outPath: new Uint8Array([0x11, 0x22, 0, 0]),
            outPathLen: 1,
            type: 2,
            advName: 'RPT',
            lastAdvert: 1,
            advLat: 0,
            advLon: 0,
            flags: 0,
          },
        ]),
      ),
    };

    const outPathMapRef = new Map<number, Uint8Array>();
    const resultPromise = primeMeshcoreTraceRoute({
      conn: conn,
      nodeId: REMOTE_NODE_ID,
      pubKey: REMOTE_PUBKEY,
      hopsAway: 2,
      outPathMapRef,
      maxRounds: 1,
    });

    await vi.runOnlyPendingTimersAsync();
    const result = await resultPromise;

    expect(result.path).toEqual(usablePath);
    expect(vi.getTimerCount()).toBe(0);
    expect(waitMs).toBeGreaterThan(0);
  });

  it('propagates radioContactPathLen from matching contact', async () => {
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      sendFloodAdvert: vi.fn(() => Promise.resolve(undefined)),
      getContacts: vi.fn(() =>
        Promise.resolve([
          {
            publicKey: REMOTE_PUBKEY,
            outPath: new Uint8Array([0x11, 0x22, 0, 0]),
            outPathLen: 1,
            type: 2,
            advName: 'RPT',
            lastAdvert: 1,
            advLat: 0,
            advLon: 0,
            flags: 0,
          },
        ]),
      ),
    };

    const outPathMapRef = new Map<number, Uint8Array>();
    const resultPromise = primeMeshcoreTraceRoute({
      conn: conn,
      nodeId: REMOTE_NODE_ID,
      pubKey: REMOTE_PUBKEY,
      hopsAway: 2,
      outPathMapRef,
      maxRounds: 1,
    });

    await vi.runOnlyPendingTimersAsync();
    const result = await resultPromise;

    expect(result.radioContactPathLen).toBe(1);
    expect(result.path).toEqual(new Uint8Array([0x11, 0x22]));
  });

  it('passive strategy waits for 129 without sendFloodAdvert', async () => {
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      sendFloodAdvert: vi.fn(() => Promise.resolve(undefined)),
      getContacts: vi.fn(() => Promise.resolve([])),
    };
    const outPathMapRef = new Map<number, Uint8Array>();
    const resultPromise = primeMeshcoreTraceRoute({
      conn,
      nodeId: REMOTE_NODE_ID,
      pubKey: REMOTE_PUBKEY,
      hopsAway: 2,
      outPathMapRef,
      strategy: 'passive',
    });
    await vi.runOnlyPendingTimersAsync();
    const result = await resultPromise;
    expect(conn.sendFloodAdvert).not.toHaveBeenCalled();
    expect(result.metrics?.strategy).toBe('passive');
  });

  it('returns map path when aggregate timeout fires', async () => {
    const aggregateMs = computeMeshcoreTracePrimeAggregateTimeoutMs(2, 1, 'flood');
    const mapPath = new Uint8Array([0x11, 0x22]);
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      sendFloodAdvert: vi.fn(() => Promise.resolve(undefined)),
      getContacts: vi.fn((): Promise<MeshCoreContactRaw[]> => new Promise(() => {})),
    };

    const outPathMapRef = new Map<number, Uint8Array>([[REMOTE_NODE_ID, mapPath]]);
    const resultPromise = primeMeshcoreTraceRoute({
      conn: conn,
      nodeId: REMOTE_NODE_ID,
      pubKey: REMOTE_PUBKEY,
      hopsAway: 2,
      outPathMapRef,
      maxRounds: 1,
      strategy: 'flood',
    });

    await vi.advanceTimersByTimeAsync(aggregateMs + 1);
    const result = await resultPromise;

    expect(result.path).toEqual(mapPath);
    expect(result.radioContactPathLen).toBeNull();
  });
});
