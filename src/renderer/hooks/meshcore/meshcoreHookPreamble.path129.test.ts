import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pubkeyToNodeId } from '../../lib/meshcoreUtils';
import { waitForMeshcorePath129ForNode } from './meshcoreHookPreamble';

const REMOTE_PUBKEY = (() => {
  const b = new Uint8Array(32);
  b[0] = 0x33;
  b[31] = 0x44;
  return b;
})();
const REMOTE_NODE_ID = pubkeyToNodeId(REMOTE_PUBKEY);

const OTHER_PUBKEY = (() => {
  const b = new Uint8Array(32);
  b[0] = 0x55;
  b[31] = 0x66;
  return b;
})();

function create129ListenerConn() {
  const listeners = new Map<number, Set<(...args: unknown[]) => void>>();
  const conn = {
    on: vi.fn((event: number, cb: (...args: unknown[]) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(cb);
      listeners.set(event, set);
    }),
    off: vi.fn((event: number, cb: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(cb);
    }),
  };
  return { conn, listeners };
}

describe('waitForMeshcorePath129ForNode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves true when matching PathUpdated (129) arrives and removes listener', async () => {
    const { conn, listeners } = create129ListenerConn();
    const { promise } = waitForMeshcorePath129ForNode(conn, REMOTE_NODE_ID, 5_000);

    expect(conn.on).toHaveBeenCalledWith(129, expect.any(Function));
    expect(listeners.get(129)?.size).toBe(1);

    listeners.get(129)?.forEach((cb) => {
      cb({ publicKey: REMOTE_PUBKEY });
    });

    await vi.runOnlyPendingTimersAsync();
    await expect(promise).resolves.toBe(true);
    expect(conn.off).toHaveBeenCalledWith(129, expect.any(Function));
    expect(listeners.get(129)?.size ?? 0).toBe(0);
  });

  it('ignores PathUpdated for wrong pubkey until timeout', async () => {
    const { conn, listeners } = create129ListenerConn();
    const { promise } = waitForMeshcorePath129ForNode(conn, REMOTE_NODE_ID, 1_000);

    listeners.get(129)?.forEach((cb) => {
      cb({ publicKey: OTHER_PUBKEY });
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(listeners.get(129)?.size).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe(false);
    expect(conn.off).toHaveBeenCalledWith(129, expect.any(Function));
  });

  it('ignores PathUpdated payloads without a 32-byte publicKey', async () => {
    const { conn, listeners } = create129ListenerConn();
    const { promise } = waitForMeshcorePath129ForNode(conn, REMOTE_NODE_ID, 500);

    listeners.get(129)?.forEach((cb) => {
      cb({ publicKey: new Uint8Array([0x01, 0x02]) });
      cb({});
    });

    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toBe(false);
  });

  it('returns false on timeout and cleans up listener', async () => {
    const { conn, listeners } = create129ListenerConn();
    const { promise } = waitForMeshcorePath129ForNode(conn, REMOTE_NODE_ID, 2_000);

    expect(listeners.get(129)?.size).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(promise).resolves.toBe(false);
    expect(conn.off).toHaveBeenCalledWith(129, expect.any(Function));
    expect(listeners.get(129)?.size ?? 0).toBe(0);
  });

  it('cancel resolves false and removes listener', async () => {
    const { conn, listeners } = create129ListenerConn();
    const { promise, cancel } = waitForMeshcorePath129ForNode(conn, REMOTE_NODE_ID, 5_000);

    expect(listeners.get(129)?.size).toBe(1);
    cancel();
    await expect(promise).resolves.toBe(false);
    expect(conn.off).toHaveBeenCalledWith(129, expect.any(Function));
    expect(listeners.get(129)?.size ?? 0).toBe(0);
  });
});
