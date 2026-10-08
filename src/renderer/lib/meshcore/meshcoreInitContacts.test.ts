import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeshCoreContactRaw } from './meshcoreHookTypes';
import {
  fetchMeshcoreContactsForInit,
  MESHCORE_RESPONSE_CONTACT,
  type MeshcoreInitContactsConn,
} from './meshcoreInitContacts';

type Listener = (...args: unknown[]) => void;

interface FakeDump {
  emitContact: () => void;
  finish: (contacts: MeshCoreContactRaw[]) => void;
}

function makeConn() {
  const listeners = new Map<string | number, Set<Listener>>();
  const dumps: FakeDump[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const conn: MeshcoreInitContactsConn = {
    on: vi.fn((event: string | number, cb: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
    }),
    off: vi.fn((event: string | number, cb: Listener) => {
      listeners.get(event)?.delete(cb);
    }),
    getContacts: vi.fn(
      () =>
        new Promise<MeshCoreContactRaw[]>((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          dumps.push({
            emitContact: () => {
              for (const cb of listeners.get(MESHCORE_RESPONSE_CONTACT) ?? []) cb({});
            },
            finish: (contacts) => {
              inFlight -= 1;
              resolve(contacts);
            },
          });
        }),
    ),
  };
  const listenerCount = () => listeners.get(MESHCORE_RESPONSE_CONTACT)?.size ?? 0;
  return {
    conn,
    dumps,
    listenerCount,
    inFlight: () => inFlight,
    maxInFlight: () => maxInFlight,
  };
}

const contact = (name: string) => ({ advName: name }) as unknown as MeshCoreContactRaw;

describe('fetchMeshcoreContactsForInit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves a slow dump that keeps making progress past the idle window', async () => {
    const { conn, dumps, listenerCount } = makeConn();
    const p = fetchMeshcoreContactsForInit(conn, { totalTimeoutMs: 60_000, idleTimeoutMs: 1_000 });
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(900);
      dumps[0].emitContact();
    }
    dumps[0].finish([contact('a')]);
    await expect(p).resolves.toEqual([contact('a')]);
    expect(conn.getContacts).toHaveBeenCalledTimes(1);
    expect(listenerCount()).toBe(0);
  });

  it('retries once on the same link after an idle stall without overlapping dumps', async () => {
    const { conn, dumps, listenerCount, maxInFlight } = makeConn();
    const onStallRetry = vi.fn();
    const p = fetchMeshcoreContactsForInit(conn, {
      totalTimeoutMs: 60_000,
      idleTimeoutMs: 1_000,
      onStallRetry,
    });
    dumps[0].emitContact();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(conn.getContacts).toHaveBeenCalledTimes(1);
    expect(maxInFlight()).toBe(1);
    expect(onStallRetry).not.toHaveBeenCalled();
    // Frames from the stalled dump must not arm a second attempt that is not running yet.
    dumps[0].emitContact();
    expect(conn.getContacts).toHaveBeenCalledTimes(1);
    dumps[0].finish([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(onStallRetry).toHaveBeenCalledWith({ contactsBeforeStall: 1, idleTimeoutMs: 1_000 });
    expect(conn.getContacts).toHaveBeenCalledTimes(2);
    expect(maxInFlight()).toBe(1);
    dumps[1].finish([contact('b')]);
    await expect(p).resolves.toEqual([contact('b')]);
    expect(listenerCount()).toBe(0);
    expect(maxInFlight()).toBe(1);
  });

  it('rejects when the retry stalls too', async () => {
    const { conn, dumps, listenerCount, maxInFlight } = makeConn();
    const p = fetchMeshcoreContactsForInit(conn, { totalTimeoutMs: 60_000, idleTimeoutMs: 1_000 });
    const assertion = expect(p).rejects.toThrow(/getContacts stalled after 1000ms idle/);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(conn.getContacts).toHaveBeenCalledTimes(1);
    dumps[0].finish([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(conn.getContacts).toHaveBeenCalledTimes(2);
    expect(maxInFlight()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(listenerCount()).toBe(0);
    expect(maxInFlight()).toBe(1);
  });

  it('does not start a second dump when the stalled one is still in flight at the total cap', async () => {
    const { conn, maxInFlight } = makeConn();
    const p = fetchMeshcoreContactsForInit(conn, { totalTimeoutMs: 1_500, idleTimeoutMs: 1_000 });
    const assertion = expect(p).rejects.toThrow('getContacts timed out after 1500ms');
    await vi.advanceTimersByTimeAsync(1_500);
    await assertion;
    expect(conn.getContacts).toHaveBeenCalledTimes(1);
    expect(maxInFlight()).toBe(1);
  });

  it('rethrows the stall after the grace window when the stalled dump never settles', async () => {
    const { conn, dumps, maxInFlight } = makeConn();
    const onStallRetry = vi.fn();
    const p = fetchMeshcoreContactsForInit(conn, {
      totalTimeoutMs: 60_000,
      idleTimeoutMs: 1_000,
      stallGraceMs: 2_000,
      onStallRetry,
    });
    let settledAt: number | null = null;
    const start = Date.now();
    const assertion = expect(
      p.finally(() => {
        settledAt = Date.now() - start;
      }),
    ).rejects.toThrow('getContacts stalled after 1000ms idle (2 contacts received)');
    dumps[0].emitContact();
    dumps[0].emitContact();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(settledAt).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(settledAt).toBe(3_000);
    expect(onStallRetry).not.toHaveBeenCalled();
    expect(conn.getContacts).toHaveBeenCalledTimes(1);
    expect(maxInFlight()).toBe(1);
  });

  it('enforces the total cap across both attempts', async () => {
    const { conn, dumps, listenerCount, maxInFlight } = makeConn();
    const p = fetchMeshcoreContactsForInit(conn, { totalTimeoutMs: 3_000, idleTimeoutMs: 1_000 });
    const assertion = expect(p).rejects.toThrow('getContacts timed out after 3000ms');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(conn.getContacts).toHaveBeenCalledTimes(1);
    dumps[0].finish([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(conn.getContacts).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(600);
      dumps[1].emitContact();
    }
    await assertion;
    expect(listenerCount()).toBe(0);
    expect(maxInFlight()).toBe(1);
  });

  it('does not retry after a stall when the setup was cancelled', async () => {
    const { conn, listenerCount } = makeConn();
    const onStallRetry = vi.fn();
    const p = fetchMeshcoreContactsForInit(conn, {
      totalTimeoutMs: 60_000,
      idleTimeoutMs: 1_000,
      onStallRetry,
      isCancelled: () => true,
    });
    const assertion = expect(p).rejects.toThrow(/getContacts stalled/);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(onStallRetry).not.toHaveBeenCalled();
    expect(conn.getContacts).toHaveBeenCalledTimes(1);
    expect(listenerCount()).toBe(0);
  });

  it('propagates getContacts rejection without retrying', async () => {
    const { conn, listenerCount } = makeConn();
    vi.mocked(conn.getContacts).mockRejectedValueOnce(new Error('link closed'));
    await expect(
      fetchMeshcoreContactsForInit(conn, { totalTimeoutMs: 60_000, idleTimeoutMs: 1_000 }),
    ).rejects.toThrow('link closed');
    expect(conn.getContacts).toHaveBeenCalledTimes(1);
    expect(listenerCount()).toBe(0);
  });
});
