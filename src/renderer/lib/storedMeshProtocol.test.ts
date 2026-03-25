import { afterEach, describe, expect, it } from 'vitest';

import { getStoredMeshProtocol, MESH_PROTOCOL_STORAGE_KEY } from './storedMeshProtocol';

describe('storedMeshProtocol', () => {
  afterEach(() => {
    localStorage.removeItem(MESH_PROTOCOL_STORAGE_KEY);
  });

  it('returns meshtastic when key is missing', () => {
    expect(getStoredMeshProtocol()).toBe('meshtastic');
  });

  it('returns meshcore when key is meshcore', () => {
    localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, 'meshcore');
    expect(getStoredMeshProtocol()).toBe('meshcore');
  });

  it('returns meshtastic for any other value', () => {
    localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, 'meshtastic');
    expect(getStoredMeshProtocol()).toBe('meshtastic');

    localStorage.setItem(MESH_PROTOCOL_STORAGE_KEY, 'garbage');
    expect(getStoredMeshProtocol()).toBe('meshtastic');
  });
});
