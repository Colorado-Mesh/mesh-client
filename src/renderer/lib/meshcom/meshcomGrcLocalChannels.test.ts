import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addMeshcomGrcLocalChannel,
  getMeshcomGrcLocalChannels,
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
  });

  afterEach(() => {
    setMeshcomGrcLocalChannels([]);
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
});
