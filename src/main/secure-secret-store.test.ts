// @vitest-environment node
import { safeStorage } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const safeStorageHarness = vi.hoisted(() => ({
  backend: 'keychain',
  available: true,
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => safeStorageHarness.available),
    getSelectedStorageBackend: vi.fn(() => safeStorageHarness.backend),
    encryptString: vi.fn((value: string) => Buffer.from(`protected:${value}`, 'utf8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^protected:/, '')),
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

  it('persists every supported credential class only as OS-protected ciphertext', () => {
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
        expect(store.set(key, value)).toEqual({
          available: true,
          persistent: true,
          verified: true,
        });
        expect(store.get(key)).toBe(value);
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

  it('rejects basic_text and keeps secrets session-only', () => {
    const { db, store } = createStore();
    try {
      safeStorageHarness.backend = 'basic_text';
      expect(store.set('meshcore:room:7', 'session-only-password')).toEqual({
        available: true,
        persistent: false,
        verified: true,
      });
      expect(store.status()).toEqual({ available: true, persistent: false });
      expect(store.get('meshcore:room:7')).toBe('session-only-password');
      expect(db.prepareOnce('SELECT COUNT(*) AS count FROM secure_secrets').get()).toEqual({
        count: 0,
      });
    } finally {
      db.close();
    }
  });

  it('preserves durable ciphertext through temporary strong-storage outages', () => {
    const { db, store } = createStore();
    try {
      store.set('mqtt:meshcore', 'old-value');
      safeStorageHarness.available = false;
      store.set('mqtt:meshcore', 'new-session-value');
      expect(store.get('mqtt:meshcore')).toBe('new-session-value');
      expect(
        db.prepareOnce('SELECT ciphertext FROM secure_secrets WHERE key = ?').get('mqtt:meshcore'),
      ).toBeDefined();
      safeStorageHarness.available = true;
      const reloaded = new SecureSecretStore(() => db);
      expect(reloaded.get('mqtt:meshcore')).toBe('old-value');
    } finally {
      db.close();
    }
  });

  it('rolls back a replacement when read-back verification fails', () => {
    const { db, store } = createStore();
    try {
      store.set('mqtt:meshcore', 'old-value');
      const original = db
        .prepareOnce('SELECT ciphertext FROM secure_secrets WHERE key = ?')
        .get('mqtt:meshcore');

      vi.mocked(safeStorage.decryptString).mockReturnValueOnce('wrong-value');
      expect(() => store.set('mqtt:meshcore', 'replacement')).toThrow(
        /persistence verification failed/,
      );
      expect(
        db.prepareOnce('SELECT ciphertext FROM secure_secrets WHERE key = ?').get('mqtt:meshcore'),
      ).toEqual(original);
      expect(store.get('mqtt:meshcore')).toBe('old-value');

      vi.mocked(safeStorage.decryptString).mockImplementationOnce(() => {
        throw new Error('keychain read failed');
      });
      expect(() => store.set('mqtt:meshcore', 'second-replacement')).toThrow(
        'keychain read failed',
      );
      expect(
        db.prepareOnce('SELECT ciphertext FROM secure_secrets WHERE key = ?').get('mqtt:meshcore'),
      ).toEqual(original);
      expect(store.get('mqtt:meshcore')).toBe('old-value');
    } finally {
      db.close();
    }
  });

  it('preserves protected ciphertext when the backend falls back to basic_text', () => {
    const { db, store } = createStore();
    try {
      store.set('mqtt:meshcore', 'old-value');
      safeStorageHarness.backend = 'basic_text';
      store.set('mqtt:meshcore', 'new-session-value');
      expect(store.get('mqtt:meshcore')).toBe('new-session-value');
      expect(
        db.prepareOnce('SELECT ciphertext FROM secure_secrets WHERE key = ?').get('mqtt:meshcore'),
      ).toBeDefined();
      safeStorageHarness.backend = 'keychain';
      expect(new SecureSecretStore(() => db).get('mqtt:meshcore')).toBe('old-value');
    } finally {
      db.close();
    }
  });

  it.each(['basic_text', 'unavailable'])(
    'rejects a required durable write before changing data on %s',
    (backend) => {
      const { db, store } = createStore();
      try {
        store.set('backup:meshcore:1', 'existing');
        safeStorageHarness.backend = backend;
        safeStorageHarness.available = backend !== 'unavailable';
        expect(() => store.set('backup:meshcore:1', 'replacement', true)).toThrow(
          'OS key storage unavailable',
        );
        safeStorageHarness.backend = 'keychain';
        safeStorageHarness.available = true;
        expect(store.get('backup:meshcore:1')).toBe('existing');
      } finally {
        db.close();
      }
    },
  );

  it('gets all readable values in one snapshot and omits unavailable durable rows', () => {
    const { db, store } = createStore();
    try {
      store.set('mqtt:meshcore', 'durable');
      safeStorageHarness.available = false;
      store.set('meshcore:room:7', 'session');
      expect(store.getAll()).toEqual({ 'meshcore:room:7': 'session' });
    } finally {
      db.close();
    }
  });

  it('imports only a valid legacy identity into its fixed destination', () => {
    const { db, store } = createStore();
    try {
      const privateKey = JSON.stringify(Array.from({ length: 32 }, (_, index) => index));
      const legacy = Buffer.from(`protected:${privateKey}`, 'utf8').toString('base64');
      expect(store.migrateLegacyIdentityCiphertext(legacy)).toMatchObject({
        persistent: true,
        verified: true,
      });
      expect(store.get('meshcore:identity')).toBe(privateKey);
      expect(() =>
        store.migrateLegacyIdentityCiphertext(
          Buffer.from('protected:arbitrary-secret', 'utf8').toString('base64'),
        ),
      ).toThrow(/invalid legacy identity/);
    } finally {
      db.close();
    }
  });

  it('binds valid legacy backups to their protocol and node id', () => {
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
      expect(store.migrateLegacyBackupCiphertext('meshcore', 9, 'per-node', legacy)).toMatchObject({
        persistent: true,
        verified: true,
      });
      expect(store.get('backup:meshcore:9')).toBe(payload);
      expect(() => store.migrateLegacyBackupCiphertext('meshcore', 10, 'per-node', legacy)).toThrow(
        /invalid legacy backup metadata/,
      );
      expect(() =>
        store.migrateLegacyBackupCiphertext('meshcore', 9, 'meshtastic-single', legacy),
      ).toThrow(/invalid legacy backup format/);
    } finally {
      db.close();
    }
  });

  it('preserves an existing backup unless a legacy import has the same key pair', () => {
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
      store.set('backup:meshtastic:9', existingPayload);

      const sameLegacy = JSON.stringify({
        publicKey: Buffer.alloc(32, 1).toString('base64'),
        privateKey: Buffer.alloc(32, 2).toString('base64'),
      });
      expect(
        store.migrateLegacyBackupCiphertext(
          'meshtastic',
          9,
          'meshtastic-single',
          Buffer.from(`protected:${sameLegacy}`, 'utf8').toString('base64'),
        ),
      ).toMatchObject({ verified: true });
      expect(store.get('backup:meshtastic:9')).toBe(existingPayload);

      const conflictingLegacy = JSON.stringify({
        publicKey: Buffer.alloc(32, 3).toString('base64'),
        privateKey: Buffer.alloc(32, 4).toString('base64'),
      });
      expect(() =>
        store.migrateLegacyBackupCiphertext(
          'meshtastic',
          9,
          'meshtastic-single',
          Buffer.from(`protected:${conflictingLegacy}`, 'utf8').toString('base64'),
        ),
      ).toThrow(/conflicting legacy backup/);
      expect(store.get('backup:meshtastic:9')).toBe(existingPayload);
    } finally {
      db.close();
    }
  });

  it('retries an interrupted single-slot migration with the same bare key pair', () => {
    const { db, store } = createStore();
    try {
      const barePair = JSON.stringify({
        publicKey: Buffer.alloc(32, 1).toString('base64'),
        privateKey: Buffer.alloc(32, 2).toString('base64'),
      });
      store.set('backup:meshtastic:9', barePair);

      expect(
        store.migrateLegacyBackupCiphertext(
          'meshtastic',
          9,
          'meshtastic-single',
          Buffer.from(`protected:${barePair}`, 'utf8').toString('base64'),
        ),
      ).toMatchObject({ persistent: true, verified: true });
      expect(store.get('backup:meshtastic:9')).toBe(barePair);
    } finally {
      db.close();
    }
  });

  it('strictly allowlists keys and caps secret values', () => {
    const { db, store } = createStore();
    try {
      expect(() => store.set('arbitrary:key', 'secret')).toThrow(/invalid key/);
      expect(() => store.set('meshcore:room:1', 'x'.repeat(64 * 1024 + 1))).toThrow(
        /invalid value/,
      );
      expect(() => store.get('meshcore:room:-1')).toThrow(/invalid key/);
      expect(() => store.get('meshcore:room:4294967296')).toThrow(/invalid key/);
    } finally {
      db.close();
    }
  });

  it('removes session and durable copies together', () => {
    const { db, store } = createStore();
    try {
      store.set('meshcore:repeater:3', 'durable');
      safeStorageHarness.backend = 'basic_text';
      store.set('meshcore:room:4', 'session');
      expect(store.list()).toEqual(['meshcore:repeater:3', 'meshcore:room:4']);
      store.remove('meshcore:repeater:3');
      store.remove('meshcore:room:4');
      expect(store.list()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
