import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as TimeConstantsModule from './timeConstants';

vi.mock('./timeConstants', async (importOriginal) => {
  const actual = await importOriginal<typeof TimeConstantsModule>();
  return {
    ...actual,
    MESHCORE_ROOM_SYNC_MIN_MESH_TX_SPACING_MS: 0,
  };
});

import {
  dequeueMeshcoreRoomLogin,
  enqueueMeshcoreRoomLogin,
  getMeshcoreRoomLoginQueueSnapshot,
  meshcoreIsRoomLoginQueued,
  resetMeshcoreRoomLoginQueue,
} from './meshcoreRoomLoginQueue';
import { MESHCORE_ROOM_LOGIN_ABORT_MESSAGE } from './meshcoreRoomLoginRpc';

describe('meshcoreRoomLoginQueue', () => {
  afterEach(() => {
    resetMeshcoreRoomLoginQueue();
  });

  it('runs jobs one at a time in order', async () => {
    const order: number[] = [];
    const a = enqueueMeshcoreRoomLogin(1, async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 5));
    });
    const b = enqueueMeshcoreRoomLogin(2, () => {
      order.push(2);
      return Promise.resolve();
    });
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2]);
  });

  it('tracks pending and active node ids', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = enqueueMeshcoreRoomLogin(10, async () => {
      await firstGate;
    });
    const second = enqueueMeshcoreRoomLogin(20, () => Promise.resolve());

    await Promise.resolve();
    expect(meshcoreIsRoomLoginQueued(10)).toBe(true);
    expect(meshcoreIsRoomLoginQueued(20)).toBe(true);
    expect(getMeshcoreRoomLoginQueueSnapshot().activeNodeId).toBe(10);
    expect(getMeshcoreRoomLoginQueueSnapshot().pendingNodeIds).toContain(20);

    releaseFirst?.();
    await Promise.all([first, second]);
    expect(meshcoreIsRoomLoginQueued(10)).toBe(false);
    expect(meshcoreIsRoomLoginQueued(20)).toBe(false);
  });

  it('dequeue skips a pending job with abort error', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = enqueueMeshcoreRoomLogin(1, async () => {
      await firstGate;
    });
    const second = enqueueMeshcoreRoomLogin(2, async () => {});
    dequeueMeshcoreRoomLogin(2);

    releaseFirst?.();
    await expect(first).resolves.toBeUndefined();
    await expect(second).rejects.toMatchObject({
      message: MESHCORE_ROOM_LOGIN_ABORT_MESSAGE,
      name: 'AbortError',
    });
  });
});
