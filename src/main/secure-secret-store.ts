import { randomUUID } from 'node:crypto';

import { safeStorage } from 'electron';

import { parseRendererStorageDeletionState } from '../shared/rendererStorageIntent';
import type { NodeSqliteDB } from './db-compat';
import { withFullSqliteSync } from './sqliteDurability';

const MAX_SECRET_BYTES = 64 * 1024;
const SECRET_KEY_PATTERN =
  /^(?:meshcore:identity|mqtt:(?:meshcore|meshtastic|profiles)|meshcore:(?:room|repeater):\d{1,10}|backup:(?:meshcore|meshtastic):\d{1,10}|backup-index:(?:meshcore|meshtastic))$/;

export interface SecureSecretStoreStatus {
  available: boolean;
  persistent: boolean;
}

export interface SecureSecretWriteResult extends SecureSecretStoreStatus {
  verified: boolean;
}

export type LegacyBackupProtocol = 'meshcore' | 'meshtastic';
export type LegacyBackupFormat = 'per-node' | 'meshtastic-single';

function assertSecretKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !SECRET_KEY_PATTERN.test(key)) {
    throw new Error('secureSecrets: invalid key');
  }
  const numericSuffix = /:(\d+)$/.exec(key)?.[1];
  if (numericSuffix != null && Number(numericSuffix) > 0xffff_ffff) {
    throw new Error('secureSecrets: invalid key');
  }
}

function assertSecretValue(value: unknown): asserts value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES) {
    throw new Error('secureSecrets: invalid value');
  }
}

async function decryptLegacyCiphertext(ciphertext: unknown): Promise<string> {
  if (typeof ciphertext !== 'string' || ciphertext.length > MAX_SECRET_BYTES * 2) {
    throw new Error('secureSecrets: invalid legacy ciphertext');
  }
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('secureSecrets: legacy ciphertext cannot be decrypted');
  }
  const { result } = await safeStorage.decryptStringAsync(Buffer.from(ciphertext, 'base64'));
  return result;
}

function parseLegacyObject(plaintext: string, kind: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext) as unknown;
  } catch {
    throw new Error(`secureSecrets: invalid legacy ${kind}`);
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`secureSecrets: invalid legacy ${kind}`);
  }
  return parsed as Record<string, unknown>;
}

function assertByteArray(value: unknown, lengths: readonly number[], kind: string): void {
  if (
    !Array.isArray(value) ||
    !lengths.includes(value.length) ||
    value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff)
  ) {
    throw new Error(`secureSecrets: invalid legacy ${kind}`);
  }
}

function assertBase64Key(
  value: unknown,
  lengths: readonly number[],
  kind: string,
): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`secureSecrets: invalid legacy ${kind}`);
  }
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error(`secureSecrets: invalid legacy ${kind}`);
  }
  const bytes = Buffer.from(normalized, 'base64');
  if (!lengths.includes(bytes.length) || bytes.toString('base64') !== normalized) {
    throw new Error(`secureSecrets: invalid legacy ${kind}`);
  }
}

function assertLegacyBackupPayload(
  plaintext: string,
  protocol: LegacyBackupProtocol,
  id: number,
  format: LegacyBackupFormat,
): { publicKey: string; privateKey: string } {
  const parsed = parseLegacyObject(plaintext, 'backup');
  const privateLengths = protocol === 'meshcore' ? [32, 64] : [32];
  assertBase64Key(parsed.publicKey, [32], 'backup public key');
  assertBase64Key(parsed.privateKey, privateLengths, 'backup private key');

  if (format === 'meshtastic-single') {
    if (protocol !== 'meshtastic') {
      throw new Error('secureSecrets: invalid legacy backup format');
    }
    return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
  }

  const idField = protocol === 'meshcore' ? 'nodeId' : 'nodeNum';
  if (
    parsed.protocol !== protocol ||
    parsed[idField] !== id ||
    typeof parsed.backedUpAt !== 'number' ||
    !Number.isFinite(parsed.backedUpAt) ||
    (parsed.nodeLabel != null && typeof parsed.nodeLabel !== 'string')
  ) {
    throw new Error('secureSecrets: invalid legacy backup metadata');
  }
  return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
}

async function strongStorageAvailable(): Promise<boolean> {
  try {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
    return safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  } catch {
    // catch-no-log-ok storage backend probing is intentionally fail-closed
    return false;
  }
}

/**
 * Main-process-only credential service. Durable values are encrypted by an OS-backed
 * safeStorage backend before SQLite sees them. When no confidential backend exists,
 * values remain process-memory-only. Durable values are preserved through temporary keyring
 * outages and backend changes. This service never creates `basic_text` ciphertext,
 * so a backend fallback cannot justify deleting previously protected values.
 */
export class SecureSecretStore {
  private readonly session = new Map<string, string>();
  private readonly mutations = new Map<string, symbol>();

  constructor(private readonly db: () => NodeSqliteDB) {}

  /** Commit legacy-copy retirement with the secret so a failed renderer ACK cannot undo it. */
  private markLegacyHandled(db: NodeSqliteDB, key: string): void {
    const setting = `rendererDeletedStorage:mesh-client:credentialCompatibility:${key}`;
    const row = db.prepareOnce('SELECT value FROM app_settings WHERE key = ?').get(setting) as
      { value: string } | undefined;
    const state = parseRendererStorageDeletionState(row?.value);
    db.prepareOnce('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)').run(
      setting,
      JSON.stringify({ ...state, deleted: true, secretRevision: randomUUID() }),
    );
  }

  async status(): Promise<SecureSecretStoreStatus> {
    const persistent = await strongStorageAvailable();
    return { available: true, persistent };
  }

  private legacyRetired(key: string): boolean {
    const row = this.db()
      .prepareOnce('SELECT value FROM app_settings WHERE key = ?')
      .get(`rendererDeletedStorage:mesh-client:credentialCompatibility:${key}`) as
      { value: string } | undefined;
    return row !== undefined && parseRendererStorageDeletionState(row.value).deleted;
  }

  async set(
    key: unknown,
    value: unknown,
    requirePersistent: unknown = false,
    retireLegacy = true,
  ): Promise<SecureSecretWriteResult> {
    assertSecretKey(key);
    assertSecretValue(value);
    if (typeof requirePersistent !== 'boolean') {
      throw new Error('secureSecrets: invalid persistence requirement');
    }
    const mutation = retireLegacy ? Symbol() : this.mutations.get(key);
    if (retireLegacy) this.mutations.set(key, mutation!);
    const assertCurrent = () => {
      if (this.mutations.get(key) !== mutation) throw new Error('secureSecrets: superseded write');
    };

    if (!(await strongStorageAvailable())) {
      assertCurrent();
      if (requirePersistent) throw new Error('secureSecrets: OS key storage unavailable');
      this.session.set(key, value);
      return { available: true, persistent: false, verified: this.session.get(key) === value };
    }

    const ciphertext = (await safeStorage.encryptStringAsync(value)).toString('base64');
    const { result } = await safeStorage.decryptStringAsync(Buffer.from(ciphertext, 'base64'));
    if (result !== value) throw new Error('secureSecrets: persistence verification failed');
    assertCurrent();
    const db = this.db();
    withFullSqliteSync(db, () => {
      db.transaction(() => {
        db.prepareOnce(
          'INSERT OR REPLACE INTO secure_secrets(key, ciphertext, updated_at) VALUES (?, ?, ?)',
        ).run(key, ciphertext, Date.now());
        const row = db
          .prepareOnce('SELECT ciphertext FROM secure_secrets WHERE key = ?')
          .get(key) as { ciphertext?: unknown } | undefined;
        const stored = typeof row?.ciphertext === 'string' ? row.ciphertext : '';
        if (stored.length === 0 || stored !== ciphertext) {
          throw new Error('secureSecrets: persistence verification failed');
        }
        if (retireLegacy) this.markLegacyHandled(db, key);
      })();
    });
    this.session.delete(key);
    return { available: true, persistent: true, verified: true };
  }

  async get(key: unknown): Promise<string | null> {
    assertSecretKey(key);
    const mutation = this.mutations.get(key);
    if (this.session.has(key)) return this.session.get(key) ?? null;
    if (!(await strongStorageAvailable())) return null;
    const row = this.db()
      .prepareOnce('SELECT ciphertext FROM secure_secrets WHERE key = ?')
      .get(key) as { ciphertext?: unknown } | undefined;
    if (typeof row?.ciphertext !== 'string' || row.ciphertext.length === 0) return null;
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
        Buffer.from(row.ciphertext, 'base64'),
      );
      if (shouldReEncrypt && this.mutations.get(key) === mutation) {
        try {
          await this.set(key, result, false, false);
        } catch {
          // catch-no-log-ok re-encrypt is best-effort after key rotation
        }
      }
      return result;
    } catch {
      // catch-no-log-ok corrupt ciphertext is treated as an unavailable secret
      return null;
    }
  }

  remove(key: unknown): void {
    assertSecretKey(key);
    this.mutations.set(key, Symbol());
    const db = this.db();
    withFullSqliteSync(db, () => {
      db.transaction(() => {
        db.prepareOnce('DELETE FROM secure_secrets WHERE key = ?').run(key);
        this.markLegacyHandled(db, key);
      })();
    });
    this.session.delete(key);
  }

  list(): string[] {
    const keys = new Set(this.session.keys());
    const rows = this.db().prepareOnce('SELECT key FROM secure_secrets').all() as {
      key?: unknown;
    }[];
    for (const row of rows) {
      if (typeof row.key === 'string' && SECRET_KEY_PATTERN.test(row.key)) keys.add(row.key);
    }
    return [...keys].sort();
  }

  async getAll(): Promise<Record<string, string>> {
    const values: Record<string, string> = {};
    for (const key of this.list()) {
      const value = await this.get(key);
      if (value != null) values[key] = value;
    }
    return values;
  }

  /** Import the one historical encrypted MeshCore identity shape into its fixed destination. */
  async migrateLegacyIdentityCiphertext(ciphertext: unknown): Promise<SecureSecretWriteResult> {
    const key = 'meshcore:identity';
    const mutation = this.mutations.get(key);
    const plaintext = await decryptLegacyCiphertext(ciphertext);
    let privateKey: unknown;
    try {
      privateKey = JSON.parse(plaintext) as unknown;
    } catch {
      throw new Error('secureSecrets: invalid legacy identity');
    }
    assertByteArray(privateKey, [32, 64], 'identity');
    const existing = await this.get(key);
    if (this.mutations.get(key) !== mutation || (existing === null && this.legacyRetired(key)))
      return { ...(await this.status()), verified: false };
    if (existing !== null) return { ...(await this.status()), verified: true };
    return this.set(key, plaintext);
  }

  /** Import historical encrypted backup shapes after binding protocol, id, and destination. */
  async migrateLegacyBackupCiphertext(
    protocol: unknown,
    id: unknown,
    format: unknown,
    ciphertext: unknown,
  ): Promise<SecureSecretWriteResult> {
    if (protocol !== 'meshcore' && protocol !== 'meshtastic') {
      throw new Error('secureSecrets: invalid legacy backup protocol');
    }
    if (!Number.isInteger(id) || Number(id) < 0 || Number(id) > 0xffff_ffff) {
      throw new Error('secureSecrets: invalid legacy backup id');
    }
    if (format !== 'per-node' && format !== 'meshtastic-single') {
      throw new Error('secureSecrets: invalid legacy backup format');
    }
    const normalizedId = Number(id);
    const key = `backup:${protocol}:${String(normalizedId)}`;
    const mutation = this.mutations.get(key);
    const plaintext = await decryptLegacyCiphertext(ciphertext);
    const legacyKeys = assertLegacyBackupPayload(plaintext, protocol, normalizedId, format);
    const existing = await this.get(key);
    if (this.mutations.get(key) !== mutation || (existing === null && this.legacyRetired(key)))
      return { ...(await this.status()), verified: false };
    if (existing != null) {
      let existingKeys: { publicKey: string; privateKey: string };
      try {
        existingKeys = assertLegacyBackupPayload(existing, protocol, normalizedId, 'per-node');
      } catch (error) {
        if (format !== 'meshtastic-single') throw error;
        existingKeys = assertLegacyBackupPayload(
          existing,
          protocol,
          normalizedId,
          'meshtastic-single',
        );
      }
      if (
        existingKeys.publicKey !== legacyKeys.publicKey ||
        existingKeys.privateKey !== legacyKeys.privateKey
      ) {
        throw new Error('secureSecrets: conflicting legacy backup');
      }
      return { ...(await this.status()), verified: true };
    }
    return this.set(key, plaintext);
  }
}

export const secureSecretLimits = {
  maxSecretBytes: MAX_SECRET_BYTES,
  keyPattern: SECRET_KEY_PATTERN,
} as const;
