import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEncryptedKeyBackupStorage } from './encryptedKeyBackupStorage';
import {
  getCachedSecureSecret,
  removeSecureSecret,
  resetSecureSecretCacheForTests,
  setSecureSecret,
} from './secureSecretStorage';

describe('createEncryptedKeyBackupStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSecureSecretCacheForTests();
  });

  function makeStorage(idField = 'nodeId', protocol: 'meshcore' | 'meshtastic' = 'meshcore') {
    return createEncryptedKeyBackupStorage({
      prefix: 'test:key-backup:',
      indexKey: 'test:key-backup-index',
      protocol,
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

    expect(localStorage.getItem(storage.storageKey(0xabc))).toBeNull();
    const rawJson = JSON.parse(getCachedSecureSecret('backup:meshcore:2748')!);
    expect(rawJson.nodeId).toBe(0xabc);
    expect(rawJson.nodeNum).toBeUndefined();
    expect(localStorage.getItem('test:key-backup-index')).toBeNull();
    expect(getCachedSecureSecret('backup-index:meshcore')).not.toBeNull();
  });

  it('rejects an invalid key pair before writing anything', async () => {
    const storage = makeStorage();
    await expect(
      storage.save({ id: 1, publicKey: new Uint8Array(1), privateKey: new Uint8Array(4) }),
    ).rejects.toThrow(/public key/);
    expect(storage.has(1)).toBe(false);
  });

  it('rejects a session-only backup without advertising success or removing legacy data', async () => {
    const storage = makeStorage();
    const legacy = 'legacy-encrypted-backup';
    localStorage.setItem(storage.storageKey(7), legacy);
    vi.mocked(window.electronAPI.secureSecrets.set).mockResolvedValueOnce({
      available: true,
      persistent: false,
      verified: true,
    });
    await expect(
      storage.save({ id: 7, publicKey: new Uint8Array(4), privateKey: new Uint8Array(4) }),
    ).rejects.toThrow('OS key storage unavailable');
    expect(storage.has(7)).toBe(false);
    expect(storage.list()).toEqual([]);
    expect(localStorage.getItem(storage.storageKey(7))).toBe(legacy);
  });

  it('remove clears both the slot and the index entry', async () => {
    const storage = makeStorage();
    await storage.save({
      id: 42,
      publicKey: new Uint8Array(4),
      privateKey: new Uint8Array(4),
    });
    expect(storage.list()).toHaveLength(1);
    await storage.remove(42);
    expect(storage.has(42)).toBe(false);
    expect(storage.list()).toHaveLength(0);
  });

  it('removes a backup during a keyring outage without failing on index metadata', async () => {
    const storage = makeStorage();
    await storage.save({
      id: 42,
      publicKey: new Uint8Array(4),
      privateKey: new Uint8Array(4),
    });
    vi.mocked(window.electronAPI.secureSecrets.set).mockResolvedValueOnce({
      available: true,
      persistent: false,
      verified: true,
    });

    await expect(storage.remove(42)).resolves.toBeUndefined();
    expect(storage.has(42)).toBe(false);
    expect(storage.list()).toEqual([]);
  });

  it('rebuildIndexFromSlots recovers entries when the index is missing', async () => {
    const storage = makeStorage('nodeId');
    await storage.save({
      id: 7,
      publicKey: new Uint8Array(4),
      privateKey: new Uint8Array(4),
      nodeLabel: 'Recovered',
    });
    await removeSecureSecret('backup-index:meshcore');
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

  it('ensureIndex migrates a legacy clear index into secure storage', async () => {
    localStorage.setItem(
      'test:key-backup-index',
      JSON.stringify([{ nodeId: 3, publicKeyB64: 'AQIDBA==', backedUpAt: 1 }]),
    );
    const storage = makeStorage();

    await storage.ensureIndex();

    expect(localStorage.getItem('test:key-backup-index')).toBeNull();
    expect(getCachedSecureSecret('backup-index:meshcore')).not.toBeNull();
  });

  it('ensureIndex rebuilds a stale legacy index before removing it', async () => {
    const storage = makeStorage();
    await storage.save({ id: 7, publicKey: new Uint8Array(4), privateKey: new Uint8Array(4) });
    await removeSecureSecret('backup-index:meshcore');
    localStorage.setItem(
      'test:key-backup-index',
      JSON.stringify([{ nodeId: 8, publicKeyB64: 'AQIDBA==', backedUpAt: 1 }]),
    );

    await storage.ensureIndex();

    expect(localStorage.getItem('test:key-backup-index')).toBeNull();
    expect(storage.list().map((entry) => entry.id)).toEqual([7]);
  });

  it('migrateLegacySingleSlot moves a valid legacy payload into per-id storage', async () => {
    const legacyKey = 'test:legacy-key-backup';
    const legacyPayload = JSON.stringify({
      publicKey: Buffer.from([1, 2, 3, 4]).toString('base64'),
      privateKey: Buffer.from([5, 6, 7, 8]).toString('base64'),
    });
    localStorage.setItem(legacyKey, `enc:${legacyPayload}`);

    const storage = makeStorage('nodeNum', 'meshtastic');
    const migrated = await storage.migrateLegacySingleSlot(legacyKey, 99);
    expect(migrated).toBe(true);
    expect(localStorage.getItem(legacyKey)).toBeNull();
    expect(storage.has(99)).toBe(true);
  });

  it('retries an interrupted single-slot migration instead of trusting its intermediate slot', async () => {
    const legacyKey = 'test:legacy-key-backup';
    const legacyPayload = JSON.stringify({
      publicKey: Buffer.from([1, 2, 3, 4]).toString('base64'),
      privateKey: Buffer.from([5, 6, 7, 8]).toString('base64'),
    });
    localStorage.setItem(legacyKey, `enc:${legacyPayload}`);
    vi.mocked(window.electronAPI.secureSecrets.set).mockRejectedValueOnce(
      new Error('regular payload save failed'),
    );
    const storage = makeStorage('nodeNum', 'meshtastic');

    await expect(storage.migrateLegacySingleSlot(legacyKey, 99)).rejects.toThrow(
      'regular payload save failed',
    );
    expect(localStorage.getItem(legacyKey)).not.toBeNull();

    await expect(storage.migrateLegacySingleSlot(legacyKey, 99)).resolves.toBe(true);
    expect(localStorage.getItem(legacyKey)).toBeNull();
    expect((await storage.load(99))?.payload.id).toBe(99);
  });

  it('reconciles stale index metadata before removing an equivalent legacy slot', async () => {
    const legacyKey = 'test:legacy-key-backup';
    const publicKey = new Uint8Array([1, 2, 3, 4]);
    const privateKey = new Uint8Array([5, 6, 7, 8]);
    const storage = makeStorage('nodeNum', 'meshtastic');
    await storage.save({ id: 99, publicKey, privateKey, nodeLabel: 'Current' });
    const current = (await storage.load(99))?.payload;
    expect(current).toBeDefined();
    await setSecureSecret(
      'backup-index:meshtastic',
      JSON.stringify([
        {
          nodeNum: 99,
          nodeLabel: 'Stale',
          publicKeyB64: Buffer.from([9, 9, 9, 9]).toString('base64'),
          backedUpAt: 1,
        },
      ]),
    );
    localStorage.setItem(
      legacyKey,
      `enc:${JSON.stringify({
        publicKey: Buffer.from(publicKey).toString('base64'),
        privateKey: Buffer.from(privateKey).toString('base64'),
      })}`,
    );

    await expect(storage.migrateLegacySingleSlot(legacyKey, 99)).resolves.toBe(true);

    expect(localStorage.getItem(legacyKey)).toBeNull();
    expect(storage.list()).toEqual([
      {
        id: 99,
        nodeLabel: 'Current',
        publicKeyB64: current?.publicKey,
        backedUpAt: current?.backedUpAt,
      },
    ]);
  });

  it('keeps Forget after a delayed single-slot conversion from resurrecting its payload or index', async () => {
    const storage = makeStorage('nodeNum', 'meshtastic');
    const legacyKey = 'test:legacy-key-backup';
    localStorage.setItem(
      legacyKey,
      `enc:${JSON.stringify({
        publicKey: Buffer.from([1, 2, 3, 4]).toString('base64'),
        privateKey: Buffer.from([5, 6, 7, 8]).toString('base64'),
      })}`,
    );
    const originalGet = window.electronAPI.secureSecrets.get;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reading = vi.fn();
    vi.mocked(window.electronAPI.secureSecrets.get).mockImplementationOnce(async (key) => {
      const value = await originalGet(key);
      reading();
      await barrier;
      return value;
    });
    const importing = storage.migrateLegacySingleSlot(legacyKey, 99);
    await vi.waitFor(() => {
      expect(reading).toHaveBeenCalled();
    });
    const forgetting = storage.remove(99);
    release();
    await importing;
    await forgetting;
    expect(storage.has(99)).toBe(false);
    expect(storage.list()).toEqual([]);
    expect(await window.electronAPI.secureSecrets.get('backup:meshtastic:99')).toBeNull();
  });

  it('preserves both backups when an existing slot has a different key pair', async () => {
    const legacyKey = 'test:legacy-key-backup';
    const storage = makeStorage('nodeNum', 'meshtastic');
    await storage.save({
      id: 99,
      publicKey: new Uint8Array([1, 2, 3, 4]),
      privateKey: new Uint8Array([5, 6, 7, 8]),
    });
    const existing = getCachedSecureSecret('backup:meshtastic:99');
    localStorage.setItem(
      legacyKey,
      `enc:${JSON.stringify({
        publicKey: Buffer.from([9, 9, 9, 9]).toString('base64'),
        privateKey: Buffer.from([8, 8, 8, 8]).toString('base64'),
      })}`,
    );

    await expect(storage.migrateLegacySingleSlot(legacyKey, 99)).rejects.toThrow(
      /conflicting legacy backup/,
    );

    expect(localStorage.getItem(legacyKey)).not.toBeNull();
    expect(getCachedSecureSecret('backup:meshtastic:99')).toBe(existing);
  });
});
