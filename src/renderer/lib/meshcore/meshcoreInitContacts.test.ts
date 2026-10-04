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
          dumps.push({
            emitContact: () => {
              for (const cb of listeners.get(MESHCORE_RESPONSE_CONTACT) ?? []) cb({});
            },
            finish: resolve,
          });
        }),
    ),
  };
  const listenerCount = () => listeners.get(MESHCORE_RESPONSE_CONTACT)?.size ?? 0;
  return { conn, dumps, listenerCount };
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

  it('retries once on the same link after an idle stall', async () => {
    const { conn, dumps, listenerCount } = makeConn();
    const onStallRetry = vi.fn();
    const p = fetchMeshcoreContactsForInit(conn, {
      totalTimeoutMs: 60_000,
      idleTimeoutMs: 1_000,
      onStallRetry,
    });
    dumps[0].emitContact();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onStallRetry).toHaveBeenCalledWith({ contactsBeforeStall: 1, idleTimeoutMs: 1_000 });
    expect(conn.getContacts).toHaveBeenCalledTimes(2);
    dumps[1].finish([contact('b')]);
    await expect(p).resolves.toEqual([contact('b')]);
    expect(listenerCount()).toBe(0);
  });

  it('rejects when the retry stalls too', async () => {
    const { conn, listenerCount } = makeConn();
    const p = fetchMeshcoreContactsForInit(conn, { totalTimeoutMs: 60_000, idleTimeoutMs: 1_000 });
    const assertion = expect(p).rejects.toThrow(/getContacts stalled after 1000ms idle/);
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
    expect(conn.getContacts).toHaveBeenCalledTimes(2);
    expect(listenerCount()).toBe(0);
  });

  it('enforces the total cap across both attempts', async () => {
    const { conn, dumps, listenerCount } = makeConn();
    const p = fetchMeshcoreContactsForInit(conn, { totalTimeoutMs: 3_000, idleTimeoutMs: 1_000 });
    const assertion = expect(p).rejects.toThrow('getContacts timed out after 3000ms');
    await vi.advanceTimersByTimeAsync(1_000);
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(600);
      dumps[1].emitContact();
    }
    await assertion;
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
