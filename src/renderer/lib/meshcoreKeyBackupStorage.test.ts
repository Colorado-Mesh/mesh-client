import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasMeshcoreKeyBackup,
  loadMeshcoreKeyBackup,
  saveMeshcoreKeyBackup,
} from './meshcoreKeyBackupStorage';

describe('meshcoreKeyBackupStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.safeStorage.encrypt).mockImplementation(async (plain) =>
      Promise.resolve(`enc:${plain}`),
    );
    vi.mocked(window.electronAPI.safeStorage.decrypt).mockImplementation(async (cipher) =>
      Promise.resolve(cipher.startsWith('enc:') ? cipher.slice(4) : null),
    );
  });

  it('round-trips 32-byte seed private key with public key', async () => {
    const publicKey = new Uint8Array(32).fill(0x11);
    const privateKey = new Uint8Array(32).fill(0x22);
    await saveMeshcoreKeyBackup({ nodeId: 0xabc, publicKey, privateKey });
    expect(hasMeshcoreKeyBackup(0xabc)).toBe(true);
    const loaded = await loadMeshcoreKeyBackup(0xabc);
    expect(loaded?.publicKey).toEqual(publicKey);
    expect(loaded?.privateKey).toEqual(privateKey);
  });

  it('accepts 64-byte orlp private key', async () => {
    const publicKey = new Uint8Array(32).fill(0x33);
    const privateKey = new Uint8Array(64).fill(0x44);
    await saveMeshcoreKeyBackup({ nodeId: 7, publicKey, privateKey });
    const loaded = await loadMeshcoreKeyBackup(7);
    expect(loaded?.privateKey.length).toBe(64);
  });

  it('rejects missing public key on save', async () => {
    await expect(
      saveMeshcoreKeyBackup({
        nodeId: 1,
        publicKey: new Uint8Array(16),
        privateKey: new Uint8Array(32),
      }),
    ).rejects.toThrow(/public key/);
  });
});
