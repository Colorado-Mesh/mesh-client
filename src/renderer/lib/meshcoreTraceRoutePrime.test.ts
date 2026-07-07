import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  computeMeshcoreTracePrimeWaitMs,
  MESHCORE_TRACE_PRIME_MAX_ROUNDS,
  MESHCORE_TRACE_PRIME_WAIT_BASE_MS,
  MESHCORE_TRACE_PRIME_WAIT_CAP_MS,
  MESHCORE_TRACE_PRIME_WAIT_PER_HOP_MS,
} from '@/renderer/hooks/meshcore/meshcoreHookPreamble';

import {
  type MeshcoreTraceRoutePrimeConn,
  primeMeshcoreTraceRoute,
} from './meshcoreTraceRoutePrime';
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
          },
        ]),
      ),
    };

    const outPathMapRef = new Map<number, Uint8Array>();
    const resultPromise = primeMeshcoreTraceRoute({
      conn: conn as unknown as MeshcoreTraceRoutePrimeConn,
      nodeId: REMOTE_NODE_ID,
      pubKey: REMOTE_PUBKEY,
      hopsAway: 2,
      outPathMapRef,
      maxRounds: MESHCORE_TRACE_PRIME_MAX_ROUNDS,
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
    });

    await vi.advanceTimersByTimeAsync(waitMs * MESHCORE_TRACE_PRIME_MAX_ROUNDS);
    const result = await resultPromise;

    expect(result.path).toBeUndefined();
    expect(conn.sendFloodAdvert).toHaveBeenCalledTimes(MESHCORE_TRACE_PRIME_MAX_ROUNDS);
  });
});
