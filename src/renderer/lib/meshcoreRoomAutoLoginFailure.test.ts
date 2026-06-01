import { describe, expect, it, vi } from 'vitest';

import {
  clearMeshcoreRoomAutoLoginFailure,
  getMeshcoreRoomAutoLoginFailure,
  setMeshcoreRoomAutoLoginFailure,
  subscribeMeshcoreRoomAutoLoginFailureChanges,
} from './meshcoreRoomAutoLoginFailure';

describe('meshcoreRoomAutoLoginFailure', () => {
  it('stores and clears failure per room', () => {
    clearMeshcoreRoomAutoLoginFailure(42);
    expect(getMeshcoreRoomAutoLoginFailure(42)).toBeUndefined();
    setMeshcoreRoomAutoLoginFailure(42, 'timeout');
    expect(getMeshcoreRoomAutoLoginFailure(42)).toBe('timeout');
    clearMeshcoreRoomAutoLoginFailure(42);
    expect(getMeshcoreRoomAutoLoginFailure(42)).toBeUndefined();
  });

  it('notifies subscribers on set and clear', () => {
    const cb = vi.fn();
    const unsub = subscribeMeshcoreRoomAutoLoginFailureChanges(cb);
    setMeshcoreRoomAutoLoginFailure(1, 'login failed');
    expect(cb).toHaveBeenCalledTimes(1);
    clearMeshcoreRoomAutoLoginFailure(1);
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
    setMeshcoreRoomAutoLoginFailure(1, 'again');
    expect(cb).toHaveBeenCalledTimes(2);
    clearMeshcoreRoomAutoLoginFailure(1);
  });
});
