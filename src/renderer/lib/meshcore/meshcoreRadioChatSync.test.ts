import { describe, expect, it, vi } from 'vitest';

import type { MeshCoreChannelRaw } from './meshcoreHookTypes';
import {
  mergeLiveMapChanges,
  readRadioChannels,
  readRadioChats,
  reconcileRadioChatChannels,
  runRadioChatOperation,
  waitForRadioChatSetup,
} from './meshcoreRadioChatSync';

const channel = (
  channelIdx: number,
  name: string,
  secret = new Uint8Array(16).fill(1),
): MeshCoreChannelRaw => ({ channelIdx, name, secret });

describe('radio chat sync', () => {
  it.each(['linux', 'darwin', 'win32'])(
    'imports fresh channels on %s and reconciles repeated/partial/empty reads',
    async () => {
      const conn = {
        getContacts: vi.fn().mockResolvedValue([{ type: 3, advName: 'Radio room' }]),
        getChannels: vi.fn().mockResolvedValue([channel(2, 'Ops')]),
      };
      const snapshot = await readRadioChats(conn, () => {});
      expect(snapshot.contacts).toEqual([{ type: 3, advName: 'Radio room' }]);
      const fresh = reconcileRadioChatChannels([], snapshot.channels);
      expect(fresh).toMatchObject([{ index: 2, name: 'Ops' }]);
      expect(reconcileRadioChatChannels(fresh, snapshot.channels)).toEqual(fresh);
      expect(reconcileRadioChatChannels(fresh, [])).toEqual(fresh);
      expect(reconcileRadioChatChannels(fresh, [channel(1, 'New')])).toHaveLength(2);
      expect(reconcileRadioChatChannels(fresh, [channel(2, '', new Uint8Array(16))])).toMatchObject(
        [{ index: 2, name: '', secret: new Uint8Array(16) }],
      );
    },
  );
  it('does not apply interrupted or invalid reads, and retries on the next call', async () => {
    const conn = {
      getContacts: vi.fn().mockResolvedValue([]),
      getChannels: vi
        .fn()
        .mockRejectedValueOnce(new Error('link lost'))
        .mockResolvedValue([channel(0, 'Public')]),
    };
    await expect(readRadioChats(conn, () => {})).rejects.toThrow('link lost');
    await expect(readRadioChats(conn, () => {})).resolves.toHaveProperty('channels');
    conn.getChannels.mockResolvedValue([channel(-1, 'bad')]);
    await expect(readRadioChats(conn, () => {})).rejects.toThrow('Invalid channel');
  });
  it('aborts an old connection before starting the next RPC', async () => {
    let current = true;
    const conn = {
      getContacts: vi.fn(() => {
        current = false;
        return Promise.resolve([]);
      }),
      getChannels: vi.fn(),
    };
    await expect(
      readRadioChats(conn, () => {
        if (!current) throw new Error('disconnected');
      }),
    ).rejects.toThrow('disconnected');
    expect(conn.getChannels).not.toHaveBeenCalled();
  });
});

describe('strict radio channel reader', () => {
  function fake(
    reply: (index: number, emit: (event: number, value: unknown) => void) => void,
    count = 3,
    firmware = 14,
  ) {
    const listeners = new Map<number | string, Set<(...args: unknown[]) => void>>();
    const emit = (event: number | string, value: unknown) =>
      listeners.get(event)?.forEach((fn) => {
        fn(value);
      });
    return {
      on: (event: number | string, fn: (...args: unknown[]) => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(fn);
        listeners.set(event, set);
      },
      off: (event: number | string, fn: (...args: unknown[]) => void) => {
        listeners.get(event)?.delete(fn);
      },
      sendToRadioFrame: vi.fn((data: Uint8Array) => {
        if (data[0] === 22) emit('rx', [13, firmware, 100, count, 0, 0, 0, 0]);
        else reply(data[1], emit);
        return Promise.resolve();
      }),
      listeners,
    };
  }
  it('reads the reported capacity including empty slots', async () => {
    const conn = fake((index, emit) => {
      if (index === 3) emit(1, { errCode: 2 });
      else emit(18, channel(index, index === 2 ? 'Ops' : '', new Uint8Array(16)));
    });
    expect((await readRadioChannels(conn, () => {})).map((c) => c.channelIdx)).toEqual([0, 1, 2]);
    expect([...conn.listeners.values()].every((set) => set.size === 0)).toBe(true);
  });
  it.each([2, 4, null])(
    'rejects first-slot error %s rather than returning false success',
    async (code) => {
      const conn = fake((_index, emit) => {
        emit(1, { errCode: code });
      });
      await expect(readRadioChannels(conn, () => {})).rejects.toThrow('read failed');
      expect([...conn.listeners.values()].every((set) => set.size === 0)).toBe(true);
    },
  );
  it.each([2, 4])(
    'rejects mid-table error %s and does not expose partial results',
    async (code) => {
      const conn = fake((index, emit) => {
        if (index === 1) emit(1, { errCode: code });
        else emit(18, channel(index, 'Public'));
      });
      await expect(readRadioChannels(conn, () => {})).rejects.toThrow('read failed');
    },
  );
  it('times out a dropped reply and cleans up the listener for retry', async () => {
    const conn = fake((_index, emit) => {
      emit(18, channel(7, 'Wrong slot'));
    });
    await expect(readRadioChannels(conn, () => {}, 5)).rejects.toThrow('timed out');
    expect([...conn.listeners.values()].every((set) => set.size === 0)).toBe(true);
  });
  it.each([
    [0, 14],
    [41, 14],
    [8, 2],
  ])('rejects unsupported capacity %s / firmware %s', async (count, firmware) => {
    const conn = fake(() => {}, count, firmware);
    await expect(readRadioChannels(conn, () => {})).rejects.toThrow('capacity');
    expect(conn.sendToRadioFrame).toHaveBeenCalledTimes(1);
  });
});

describe('radio chat RPC ownership', () => {
  it('rejects overlapping reads/writes and releases the lease after failure', async () => {
    const connection = {};
    let complete!: () => void;
    const first = runRadioChatOperation(
      connection,
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    await expect(runRadioChatOperation(connection, () => Promise.resolve())).rejects.toThrow(
      'busy',
    );
    complete();
    await first;
    await expect(
      runRadioChatOperation(connection, () => Promise.reject(new Error('radio busy'))),
    ).rejects.toThrow('radio busy');
    await expect(runRadioChatOperation(connection, () => Promise.resolve('ok'))).resolves.toBe(
      'ok',
    );
  });
});

describe('radio sync publication', () => {
  it.each(['linux', 'darwin', 'win32'])(
    'keeps live map updates and deletions during persistence on %s',
    () => {
      const baseline = new Map([
        [1, 'old'],
        [2, 'removed'],
        [3, 'unchanged'],
      ]);
      const live = new Map([
        [1, 'new live value'],
        [3, 'unchanged'],
        [4, 'new live contact'],
      ]);
      const staged = new Map([
        [1, 'radio value'],
        [2, 'radio value'],
        [3, 'new radio value'],
      ]);
      mergeLiveMapChanges(baseline, live, staged);
      expect([...staged]).toEqual([
        [1, 'new live value'],
        [3, 'new radio value'],
        [4, 'new live contact'],
      ]);
    },
  );
  it('waits for setup and aborts if its connection is superseded', async () => {
    vi.useFakeTimers();
    try {
      let busy = true;
      let current = true;
      const assertCurrent = () => {
        if (!current) throw new Error('disconnected');
      };
      const ready = waitForRadioChatSetup(() => busy, assertCurrent);
      busy = false;
      await vi.advanceTimersByTimeAsync(50);
      await ready;
      busy = true;
      const aborted = waitForRadioChatSetup(() => busy, assertCurrent);
      const rejected = expect(aborted).rejects.toThrow('disconnected');
      current = false;
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
