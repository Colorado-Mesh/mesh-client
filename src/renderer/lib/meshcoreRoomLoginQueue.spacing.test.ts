import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  dequeueMeshcoreRoomLogin,
  enqueueMeshcoreRoomLogin,
  resetMeshcoreRoomLoginQueue,
} from './meshcoreRoomLoginQueue';
import { MESHCORE_ROOM_LOGIN_ABORT_MESSAGE } from './meshcoreRoomLoginRpc';

describe('meshcoreRoomLoginQueue TX spacing', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetMeshcoreRoomLoginQueue();
  });

  it('dequeue during TX spacing wait aborts without waiting the full interval', async () => {
    vi.useFakeTimers();
    const first = enqueueMeshcoreRoomLogin(1, () => Promise.resolve());
    await first;

    const ranSecond = vi.fn(() => Promise.resolve());
    const second = enqueueMeshcoreRoomLogin(2, ranSecond);
    dequeueMeshcoreRoomLogin(2);
    await vi.advanceTimersByTimeAsync(100);
    await expect(second).rejects.toMatchObject({
      message: MESHCORE_ROOM_LOGIN_ABORT_MESSAGE,
      name: 'AbortError',
    });
    expect(ranSecond).not.toHaveBeenCalled();
  });
});
