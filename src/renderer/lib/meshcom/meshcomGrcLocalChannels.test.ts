import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hideMeshcomGrcChannel,
  isMeshcomGrcHiddenChannel,
  setMeshcomGrcHiddenChannels,
} from './meshcomGrcHiddenChannels';
import {
  addMeshcomGrcLocalChannel,
  getMeshcomGrcLocalChannels,
  removeMeshcomGrcLocalChannel,
  setMeshcomGrcLocalChannels,
} from './meshcomGrcLocalChannels';

describe('meshcomGrcLocalChannels', () => {
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => {
        memory.clear();
      },
    });
    setMeshcomGrcLocalChannels([]);
    setMeshcomGrcHiddenChannels([]);
  });

  afterEach(() => {
    setMeshcomGrcLocalChannels([]);
    setMeshcomGrcHiddenChannels([]);
    vi.unstubAllGlobals();
  });

  it('round-trips seven groups persisted by addMeshcomGrcLocalChannel', () => {
    for (let id = 1; id <= 7; id++) {
      addMeshcomGrcLocalChannel(id);
    }
    expect([...getMeshcomGrcLocalChannels()]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(memory.get('mesh-client:meshcomGrcLocalChannels')).toBe('1;2;3;4;5;6;7');

    setMeshcomGrcLocalChannels([]);
    setMeshcomGrcLocalChannels([1, 2, 3, 4, 5, 6, 7]);
    expect([...getMeshcomGrcLocalChannels()]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('removes a local GRC id', () => {
    setMeshcomGrcLocalChannels([9, 999, 262]);
    removeMeshcomGrcLocalChannel(999);
    expect([...getMeshcomGrcLocalChannels()]).toEqual([9, 262]);
  });

  it('add clears a hide tombstone', () => {
    hideMeshcomGrcChannel(999);
    expect(isMeshcomGrcHiddenChannel(999)).toBe(true);
    addMeshcomGrcLocalChannel(999);
    expect(isMeshcomGrcHiddenChannel(999)).toBe(false);
    expect([...getMeshcomGrcLocalChannels()]).toEqual([999]);
  });
});
