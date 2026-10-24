// @vitest-environment node
import { safeStorage } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const safeStorageHarness = vi.hoisted(() => ({
  backend: 'keychain',
  available: true,
}));

vi.mock('electron', () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: vi.fn(() => Promise.resolve(safeStorageHarness.available)),
    getSelectedStorageBackend: vi.fn(() => safeStorageHarness.backend),
    encryptStringAsync: vi.fn((value: string) =>
      Promise.resolve(Buffer.from(`protected:${value}`, 'utf8')),
    ),
    decryptStringAsync: vi.fn((value: Buffer) =>
      Promise.resolve({
        result: value.toString('utf8').replace(/^protected:/, ''),
        shouldReEncrypt: false,
      }),
    ),
  },
}));

import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';
import { SecureSecretStore } from './secure-secret-store';

function createStore(): { db: NodeSqliteDB; store: SecureSecretStore } {
  const db = new NodeSqliteDB(':memory:');
  runSchemaUpgrade(db);
  return { db, store: new SecureSecretStore(() => db) };
}

describe('SecureSecretStore', () => {
  beforeEach(() => {
    safeStorageHarness.available = true;
    safeStorageHarness.backend = 'keychain';
  });

  it('persists every supported credential class only as OS-protected ciphertext', async () => {
    const { db, store } = createStore();
    try {
      const values = new Map([
        ['meshcore:identity', 'identity-private-key-material'],
        ['mqtt:meshcore', 'meshcore-mqtt-password-and-psk'],
        ['mqtt:meshtastic', 'meshtastic-mqtt-password-and-psk'],
        ['mqtt:profiles', 'saved-mqtt-profile-passwords'],
        ['meshcore:room:42', 'room-password'],
        ['meshcore:repeater:43', 'repeater-password'],
        ['backup:meshcore:44', 'meshcore-channel-key-backup'],
        ['backup:meshtastic:45', 'meshtastic-dm-key-backup'],
        ['backup-index:meshcore', 'meshcore-backup-index'],
        ['backup-index:meshtastic', 'meshtastic-backup-index'],
      ]);

      for (const [key, value] of values) {
        expect(await store.set(key, value)).toEqual({
          available: true,
          persistent: true,
          verified: true,
        });
        expect(await store.get(key)).toBe(value);
      }

      const rows = db.prepareOnce('SELECT key, ciphertext FROM secure_secrets').all() as {
        key: string;
        ciphertext: string;
      }[];
      expect(rows.map((row) => row.key).sort()).toEqual([...values.keys()].sort());
      const serializedRows = JSON.stringify(rows);
      for (const value of values.values()) expect(serializedRows).not.toContain(value);
    } finally {
      db.close();
    }
  });

  it('rejects basic_text and keeps secrets session-only', async () => {
    const { db, store } = createStore();
    try {
      safeStorageHarness.backend = 'basic_text';
      expect(await store.set('meshcore:room:7', 'session-only-password')).toEqual({
        available: true,
        persistent: false,
        verified: true,
      });
      expect(await store.status()).toEqual({ available: true, persistent: false });
      expect(await store.get('meshcore:room:7')).toBe('session-only-password');
      expect(db.prepareOnce('SELECT COUNT(*) AS count FROM secure_secrets').get()).toEqual({
        count: 0,
      });
    } finally {
      db.close();
    }
  });

  it('preserves durable ciphertext through temporary strong-storage outages', async () => {
    const { db, store } = createStore();
    try {
      await store.set('mqtt:meshcore', 'old-value');
      safeStorageHarness.available = false;
      await store.set('mqtt:meshcore', 'new-session-value');
      expect(await store.get('mqtt:meshcore')).toBe('new-session-value');
      expect(
        db.prepareOnce('SELECT ciphertext FROM secure_secrets WHERE key = ?').get('mqtt:meshcore'),
      ).toBeDefined();
      safeStorageHarness.available = true;
      const reloaded = new SecureSecretStore(() => db);
      expect(await reloaded.get('mqtt:meshcore')).toBe('old-value');
    } finally {
      db.close();
    }
  });

  it('rolls back a replacement when read-back verification fails', async () => {
    const { db, store } = createStore();
    try {
      await store.set('mqtt:meshcore', 'old-value');
      const original = db
        .prepareOnce('SELECT ciphertext FROM secure_secrets WHERE key = ?')
        .get('mqtt:meshcore');

      vi.mocked(safeStorage.decryptStringAsync).mockResolvedValueOnce({
        result: 'wrong-value',
        shouldReEncrypt: false,
      });
      await expect(store.set('mqtt:meshcore', 'replacement')).rejects.toThrow(
        /persistence verification failed/,
      );
      expect(
        db.prepareOnce('SELECT ciphertext FROM secure_secrets WHERE key = ?').get('mqtt:meshcore'),
      ).toEqual(original);
      expect(await store.get('mqtt:meshcore')).toBe('old-value');

      vi.mocked(safeStorage.decryptStringAsync).mockRejectedValueOnce(
        new Error('keychain read failed'),
      );
      await expect(store.set('mqtt:meshcore', 'second-replacement')).rejects.toThrow(
        'keychain read failed',
      );
      expect(
        db.prepareOnce('SELECT ciphertext FROM secure_secrets WHERE key = ?').get('mqtt:meshcore'),
      ).toEqual(original);
      expect(await store.get('mqtt:meshcore')).toBe('old-value');
    } finally {
      db.close();
    }
  });

  it('preserves protected ciphertext when the backend falls back to basic_text', async () => {
    const { db, store } = createStore();
    try {
      await store.set('mqtt:meshcore', 'old-value');
      safeStorageHarness.backend = 'basic_text';
      await store.set('mqtt:meshcore', 'new-session-value');
      expect(await store.get('mqtt:meshcore')).toBe('new-session-value');
      expect(
        db.prepareOnce('SELECT ciphertext FROM secure_secrets WHERE key = ?').get('mqtt:meshcore'),
      ).toBeDefined();
      safeStorageHarness.backend = 'keychain';
      expect(await new SecureSecretStore(() => db).get('mqtt:meshcore')).toBe('old-value');
    } finally {
      db.close();
    }
  });

  it.each(['basic_text', 'unavailable'])(
    'rejects a required durable write before changing data on %s',
    async (backend) => {
      const { db, store } = createStore();
      try {
        await store.set('backup:meshcore:1', 'existing');
        safeStorageHarness.backend = backend;
        safeStorageHarness.available = backend !== 'unavailable';
        await expect(store.set('backup:meshcore:1', 'replacement', true)).rejects.toThrow(
          'OS key storage unavailable',
        );
        safeStorageHarness.backend = 'keychain';
        safeStorageHarness.available = true;
        expect(await store.get('backup:meshcore:1')).toBe('existing');
      } finally {
        db.close();
      }
    },
  );

  it('gets all readable values in one snapshot and omits unavailable durable rows', async () => {
    const { db, store } = createStore();
    try {
      await store.set('mqtt:meshcore', 'durable');
      safeStorageHarness.available = false;
      await store.set('meshcore:room:7', 'session');
      expect(await store.getAll()).toEqual({ 'meshcore:room:7': 'session' });
    } finally {
      db.close();
    }
  });

  it('imports only a valid legacy identity into its fixed destination', async () => {
    const { db, store } = createStore();
    try {
      const privateKey = JSON.stringify(Array.from({ length: 32 }, (_, index) => index));
      const legacy = Buffer.from(`protected:${privateKey}`, 'utf8').toString('base64');
      expect(await store.migrateLegacyIdentityCiphertext(legacy)).toMatchObject({
        persistent: true,
        verified: true,
      });
      expect(await store.get('meshcore:identity')).toBe(privateKey);
      await expect(
        store.migrateLegacyIdentityCiphertext(
          Buffer.from('protected:arbitrary-secret', 'utf8').toString('base64'),
        ),
      ).rejects.toThrow(/invalid legacy identity/);
    } finally {
      db.close();
    }
  });

  it('binds valid legacy backups to their protocol and node id', async () => {
    const { db, store } = createStore();
    try {
      const payload = JSON.stringify({
        protocol: 'meshcore',
        nodeId: 9,
        publicKey: Buffer.alloc(32, 1).toString('base64'),
        privateKey: Buffer.alloc(64, 2).toString('base64'),
        backedUpAt: 123,
      });
      const legacy = Buffer.from(`protected:${payload}`, 'utf8').toString('base64');
      expect(
        await store.migrateLegacyBackupCiphertext('meshcore', 9, 'per-node', legacy),
      ).toMatchObject({
        persistent: true,
        verified: true,
      });
      expect(await store.get('backup:meshcore:9')).toBe(payload);
      await expect(
        store.migrateLegacyBackupCiphertext('meshcore', 10, 'per-node', legacy),
      ).rejects.toThrow(/invalid legacy backup metadata/);
      await expect(
        store.migrateLegacyBackupCiphertext('meshcore', 9, 'meshtastic-single', legacy),
      ).rejects.toThrow(/invalid legacy backup format/);
    } finally {
      db.close();
    }
  });

  it('preserves an existing backup unless a legacy import has the same key pair', async () => {
    const { db, store } = createStore();
    try {
      const existingPayload = JSON.stringify({
        protocol: 'meshtastic',
        nodeNum: 9,
        publicKey: Buffer.alloc(32, 1).toString('base64'),
        privateKey: Buffer.alloc(32, 2).toString('base64'),
        nodeLabel: 'Current',
        backedUpAt: 456,
      });
      await store.set('backup:meshtastic:9', existingPayload);

      const sameLegacy = JSON.stringify({
        publicKey: Buffer.alloc(32, 1).toString('base64'),
        privateKey: Buffer.alloc(32, 2).toString('base64'),
      });
      expect(
        await store.migrateLegacyBackupCiphertext(
          'meshtastic',
          9,
          'meshtastic-single',
          Buffer.from(`protected:${sameLegacy}`, 'utf8').toString('base64'),
        ),
      ).toMatchObject({ verified: true });
      expect(await store.get('backup:meshtastic:9')).toBe(existingPayload);

      const conflictingLegacy = JSON.stringify({
        publicKey: Buffer.alloc(32, 3).toString('base64'),
        privateKey: Buffer.alloc(32, 4).toString('base64'),
      });
      await expect(
        store.migrateLegacyBackupCiphertext(
          'meshtastic',
          9,
          'meshtastic-single',
          Buffer.from(`protected:${conflictingLegacy}`, 'utf8').toString('base64'),
        ),
      ).rejects.toThrow(/conflicting legacy backup/);
      expect(await store.get('backup:meshtastic:9')).toBe(existingPayload);
    } finally {
      db.close();
    }
  });

  it('retries an interrupted single-slot migration with the same bare key pair', async () => {
    const { db, store } = createStore();
    try {
      const barePair = JSON.stringify({
        publicKey: Buffer.alloc(32, 1).toString('base64'),
        privateKey: Buffer.alloc(32, 2).toString('base64'),
      });
      await store.set('backup:meshtastic:9', barePair);

      expect(
        await store.migrateLegacyBackupCiphertext(
          'meshtastic',
          9,
          'meshtastic-single',
          Buffer.from(`protected:${barePair}`, 'utf8').toString('base64'),
        ),
      ).toMatchObject({ persistent: true, verified: true });
      expect(await store.get('backup:meshtastic:9')).toBe(barePair);
    } finally {
      db.close();
    }
  });

  it('strictly allowlists keys and caps secret values', async () => {
    const { db, store } = createStore();
    try {
      await expect(store.set('arbitrary:key', 'secret')).rejects.toThrow(/invalid key/);
      await expect(store.set('meshcore:room:1', 'x'.repeat(64 * 1024 + 1))).rejects.toThrow(
        /invalid value/,
      );
      await expect(store.get('meshcore:room:-1')).rejects.toThrow(/invalid key/);
      await expect(store.get('meshcore:room:4294967296')).rejects.toThrow(/invalid key/);
    } finally {
      db.close();
    }
  });

  it('removes session and durable copies together', async () => {
    const { db, store } = createStore();
    try {
      await store.set('meshcore:repeater:3', 'durable');
      safeStorageHarness.backend = 'basic_text';
      await store.set('meshcore:room:4', 'session');
      expect(store.list()).toEqual(['meshcore:repeater:3', 'meshcore:room:4']);
      store.remove('meshcore:repeater:3');
      store.remove('meshcore:room:4');
      expect(store.list()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
