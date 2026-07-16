import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEncryptedKeyBackupStorage } from './encryptedKeyBackupStorage';

describe('createEncryptedKeyBackupStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.safeStorage.encrypt).mockImplementation(async (plain) =>
      Promise.resolve(`enc:${plain}`),
    );
    vi.mocked(window.electronAPI.safeStorage.decrypt).mockImplementation(async (cipher) =>
      Promise.resolve(cipher.startsWith('enc:') ? cipher.slice(4) : null),
    );
  });

  function makeStorage(idField = 'nodeId') {
    return createEncryptedKeyBackupStorage({
      prefix: 'test:key-backup:',
      indexKey: 'test:key-backup-index',
      protocol: 'test-protocol',
      idField,
      validateKeyPair: (publicKey, privateKey) => {
        if (publicKey.length !== 4) throw new Error('public key must be 4 bytes');
        if (privateKey.length !== 4) throw new Error('private key must be 4 bytes');
      },
    });
  }

  it('round-trips save/load and serializes the id under the configured field name', async () => {
    const storage = makeStorage('nodeId');
    const publicKey = new Uint8Array([1, 2, 3, 4]);
    const privateKey = new Uint8Array([5, 6, 7, 8]);
    await storage.save({ id: 0xabc, publicKey, privateKey, nodeLabel: 'Test' });

    expect(storage.has(0xabc)).toBe(true);
    const loaded = await storage.load(0xabc);
    expect(loaded?.publicKey).toEqual(publicKey);
    expect(loaded?.privateKey).toEqual(privateKey);
    expect(loaded?.payload.id).toBe(0xabc);

    const rawCipher = localStorage.getItem(storage.storageKey(0xabc));
    expect(rawCipher).toBeTruthy();
    const rawJson = JSON.parse(rawCipher!.slice('enc:'.length));
    expect(rawJson.nodeId).toBe(0xabc);
    expect(rawJson.nodeNum).toBeUndefined();
  });

  it('rejects an invalid key pair before writing anything', async () => {
    const storage = makeStorage();
    await expect(
      storage.save({ id: 1, publicKey: new Uint8Array(1), privateKey: new Uint8Array(4) }),
    ).rejects.toThrow(/public key/);
    expect(storage.has(1)).toBe(false);
  });

  it('remove clears both the slot and the index entry', async () => {
    const storage = makeStorage();
    await storage.save({
      id: 42,
      publicKey: new Uint8Array(4),
      privateKey: new Uint8Array(4),
    });
    expect(storage.list()).toHaveLength(1);
    storage.remove(42);
    expect(storage.has(42)).toBe(false);
    expect(storage.list()).toHaveLength(0);
  });

  it('rebuildIndexFromSlots recovers entries when the index is missing', async () => {
    const storage = makeStorage('nodeId');
    await storage.save({
      id: 7,
      publicKey: new Uint8Array(4),
      privateKey: new Uint8Array(4),
      nodeLabel: 'Recovered',
    });
    localStorage.removeItem('test:key-backup-index');
    expect(storage.list()).toHaveLength(0);

    const rebuilt = await storage.rebuildIndexFromSlots();
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]?.id).toBe(7);
    expect(rebuilt[0]?.nodeLabel).toBe('Recovered');
    expect(storage.list()).toHaveLength(1);
  });

  it('ensureIndex is a no-op when the index already matches stored slots', async () => {
    const storage = makeStorage();
    await storage.save({ id: 1, publicKey: new Uint8Array(4), privateKey: new Uint8Array(4) });
    const before = storage.list();
    await storage.ensureIndex();
    expect(storage.list()).toEqual(before);
  });

  it('migrateLegacySingleSlot moves a valid legacy payload into per-id storage', async () => {
    const legacyKey = 'test:legacy-key-backup';
    const legacyPayload = JSON.stringify({
      publicKey: Buffer.from([1, 2, 3, 4]).toString('base64'),
      privateKey: Buffer.from([5, 6, 7, 8]).toString('base64'),
    });
    localStorage.setItem(legacyKey, `enc:${legacyPayload}`);

    const storage = makeStorage();
    const migrated = await storage.migrateLegacySingleSlot(legacyKey, 99);
    expect(migrated).toBe(true);
    expect(localStorage.getItem(legacyKey)).toBeNull();
    expect(storage.has(99)).toBe(true);
  });

  it('migrateLegacySingleSlot is a no-op when a backup already exists for the id', async () => {
    const storage = makeStorage();
    await storage.save({ id: 99, publicKey: new Uint8Array(4), privateKey: new Uint8Array(4) });
    localStorage.setItem('test:legacy-key-backup', 'enc:{}');
    const migrated = await storage.migrateLegacySingleSlot('test:legacy-key-backup', 99);
    expect(migrated).toBe(false);
  });
});
