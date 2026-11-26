import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMeshcomGrcHiddenChannels,
  hideMeshcomGrcChannel,
  isMeshcomGrcHiddenChannel,
  setMeshcomGrcHiddenChannels,
  unhideMeshcomGrcChannel,
} from './meshcomGrcHiddenChannels';

describe('meshcomGrcHiddenChannels', () => {
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
    setMeshcomGrcHiddenChannels([]);
  });

  afterEach(() => {
    setMeshcomGrcHiddenChannels([]);
    vi.unstubAllGlobals();
  });

  it('hides and unhides GRC ids with persistence', () => {
    hideMeshcomGrcChannel(999);
    hideMeshcomGrcChannel(999);
    expect(isMeshcomGrcHiddenChannel(999)).toBe(true);
    expect([...getMeshcomGrcHiddenChannels()]).toEqual([999]);
    expect(memory.get('mesh-client:meshcomGrcHiddenChannels')).toBe('999');

    unhideMeshcomGrcChannel(999);
    expect(isMeshcomGrcHiddenChannel(999)).toBe(false);
    expect(memory.get('mesh-client:meshcomGrcHiddenChannels')).toBeUndefined();
  });

  it('ignores invalid ids', () => {
    hideMeshcomGrcChannel(0);
    hideMeshcomGrcChannel(-1);
    hideMeshcomGrcChannel(1.5);
    expect([...getMeshcomGrcHiddenChannels()]).toEqual([]);
  });
});
