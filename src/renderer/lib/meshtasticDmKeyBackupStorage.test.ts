import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasMeshtasticDmKeyBackup,
  LEGACY_MESHTASTIC_DM_KEY_BACKUP_KEY,
  listMeshtasticDmKeyBackups,
  loadMeshtasticDmKeyBackup,
  meshtasticDmKeyBackupStorageKey,
  migrateLegacyMeshtasticDmKeyBackup,
  saveMeshtasticDmKeyBackup,
} from './meshtasticDmKeyBackupStorage';

describe('meshtasticDmKeyBackupStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.safeStorage.encrypt).mockImplementation(async (plain) =>
      Promise.resolve(`enc:${plain}`),
    );
    vi.mocked(window.electronAPI.safeStorage.decrypt).mockImplementation(async (cipher) =>
      Promise.resolve(cipher.startsWith('enc:') ? cipher.slice(4) : null),
    );
  });

  it('stores separate backups per nodeNum', async () => {
    const pubA = new Uint8Array(32).fill(1);
    const privA = new Uint8Array(32).fill(2);
    const pubB = new Uint8Array(32).fill(3);
    const privB = new Uint8Array(32).fill(4);

    await saveMeshtasticDmKeyBackup({ nodeNum: 0x100, publicKey: pubA, privateKey: privA });
    await saveMeshtasticDmKeyBackup({ nodeNum: 0x200, publicKey: pubB, privateKey: privB });

    expect(hasMeshtasticDmKeyBackup(0x100)).toBe(true);
    expect(hasMeshtasticDmKeyBackup(0x200)).toBe(true);
    expect(listMeshtasticDmKeyBackups()).toHaveLength(2);

    const loaded = await loadMeshtasticDmKeyBackup(0x200);
    expect(loaded?.publicKey).toEqual(pubB);
    expect(loaded?.privateKey).toEqual(privB);
  });

  it('rejects save without valid key lengths', async () => {
    await expect(
      saveMeshtasticDmKeyBackup({
        nodeNum: 1,
        publicKey: new Uint8Array(16),
        privateKey: new Uint8Array(32),
      }),
    ).rejects.toThrow(/public key/);
    await expect(
      saveMeshtasticDmKeyBackup({
        nodeNum: 1,
        publicKey: new Uint8Array(32),
        privateKey: new Uint8Array(16),
      }),
    ).rejects.toThrow(/private key/);
  });

  it('migrates legacy single-slot backup to per-node storage', async () => {
    const pub = new Uint8Array(32).fill(9);
    const priv = new Uint8Array(32).fill(8);
    const legacyPayload = JSON.stringify({
      publicKey: btoa(String.fromCharCode(...pub)),
      privateKey: btoa(String.fromCharCode(...priv)),
    });
    localStorage.setItem(LEGACY_MESHTASTIC_DM_KEY_BACKUP_KEY, `enc:${legacyPayload}`);

    const migrated = await migrateLegacyMeshtasticDmKeyBackup(0x42);
    expect(migrated).toBe(true);
    expect(localStorage.getItem(LEGACY_MESHTASTIC_DM_KEY_BACKUP_KEY)).toBeNull();
    expect(localStorage.getItem(meshtasticDmKeyBackupStorageKey(0x42))).toBeTruthy();
  });
});
