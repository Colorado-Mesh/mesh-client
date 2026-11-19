import { describe, expect, it, vi } from 'vitest';

import {
  getVisibleMeshProtocol,
  resetVisibleMeshProtocolForTests,
  setVisibleMeshProtocol,
  subscribeVisibleMeshProtocol,
} from './visibleMeshProtocolStore';

describe('visibleMeshProtocolStore', () => {
  it('notifies on change and resets for tests', () => {
    resetVisibleMeshProtocolForTests();
    expect(getVisibleMeshProtocol()).toBeNull();
    const listener = vi.fn();
    const unsub = subscribeVisibleMeshProtocol(listener);
    setVisibleMeshProtocol('meshcore');
    expect(getVisibleMeshProtocol()).toBe('meshcore');
    expect(listener).toHaveBeenCalledTimes(1);
    setVisibleMeshProtocol('meshcore');
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    setVisibleMeshProtocol('reticulum');
    expect(listener).toHaveBeenCalledTimes(1);
    resetVisibleMeshProtocolForTests();
    expect(getVisibleMeshProtocol()).toBeNull();
  });
});
