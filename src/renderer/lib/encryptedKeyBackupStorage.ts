import { keyBackupBase64ToBytes, keyBackupBytesToBase64 } from './keyBackupBytes';
import {
  getCachedSecureSecret,
  keyBackupIndexSecretKey,
  keyBackupSecretKey,
  listCachedSecureSecretKeys,
  migrateLegacyBackupCiphertext,
  removeSecureSecret,
  setSecureSecret,
} from './secureSecretStorage';

/**
 * Generic shape used internally by the factory. Protocol wrappers rename the numeric `id` field
 * to their own on-disk field (`nodeId` / `nodeNum`) via `idField` so existing encrypted localStorage
 * payloads and index JSON stay backward-compatible.
 */
export interface EncryptedKeyBackupPayload {
  protocol: string;
  id: number;
  publicKey: string;
  privateKey: string;
  nodeLabel?: string;
  backedUpAt: number;
}

export interface EncryptedKeyBackupIndexEntry {
  id: number;
  nodeLabel?: string;
  publicKeyB64: string;
  backedUpAt: number;
}

export interface EncryptedKeyBackupStorageConfig {
  /** localStorage key prefix for per-id encrypted slots, e.g. `mesh-client:meshcore-key-backup:`. */
  prefix: string;
  /** localStorage key for the plaintext index (id/label/pubkey lookup without decrypting every slot). */
  indexKey: string;
  /** Written into the encrypted payload and checked on load; also used in thrown error messages. */
  protocol: string;
  /** On-disk JSON field name for the numeric id (`nodeId` for MeshCore, `nodeNum` for Meshtastic). */
  idField: string;
  /** Throws when the key pair is invalid for this protocol (lengths differ: MeshCore 32/64, Meshtastic 32). */
  validateKeyPair: (publicKey: Uint8Array, privateKey: Uint8Array) => void;
}

function normalizeId(id: number): number {
  return id >>> 0;
}

/**
 * Shared key-backup storage: key material lives in the main-process secure-secret service while
 * a non-sensitive local index feeds the restore picker.
 */
export function createEncryptedKeyBackupStorage(config: EncryptedKeyBackupStorageConfig) {
  const { prefix, indexKey, protocol, idField, validateKeyPair } = config;
  let mutation: Promise<unknown> | undefined;
  // Serialize slot conversion with explicit Save/Forget and their shared index updates.
  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = mutation
      ? mutation
          .catch(() => {
            /* catch-no-log-ok the original caller receives the error */
          })
          .then(operation)
      : operation();
    mutation = next;
    return next.finally(() => {
      if (mutation === next) mutation = undefined;
    });
  }

  function storageKey(id: number): string {
    return `${prefix}${String(normalizeId(id))}`;
  }

  function secretKey(id: number): string {
    if (protocol !== 'meshcore' && protocol !== 'meshtastic') {
      throw new Error(`${protocol} backup: unsupported protocol`);
    }
    return keyBackupSecretKey(protocol, normalizeId(id));
  }

  function indexSecretKey(): string {
    if (protocol !== 'meshcore' && protocol !== 'meshtastic') {
      throw new Error(`${protocol} backup: unsupported protocol`);
    }
    return keyBackupIndexSecretKey(protocol);
  }

  function toRawPayload(payload: EncryptedKeyBackupPayload): Record<string, unknown> {
    return {
      protocol: payload.protocol,
      [idField]: payload.id,
      publicKey: payload.publicKey,
      privateKey: payload.privateKey,
      nodeLabel: payload.nodeLabel,
      backedUpAt: payload.backedUpAt,
    };
  }

  function fromRawPayload(raw: Record<string, unknown>): EncryptedKeyBackupPayload {
    return {
      protocol: raw.protocol as string,
      id: raw[idField] as number,
      publicKey: raw.publicKey as string,
      privateKey: raw.privateKey as string,
      nodeLabel: raw.nodeLabel as string | undefined,
      backedUpAt: raw.backedUpAt as number,
    };
  }

  function parsePayload(raw: string): EncryptedKeyBackupPayload {
    const parsed = fromRawPayload(JSON.parse(raw) as Record<string, unknown>);
    if (parsed.protocol !== protocol) {
      throw new Error(`${protocol} backup: invalid protocol`);
    }
    const publicKey = keyBackupBase64ToBytes(parsed.publicKey);
    const privateKey = keyBackupBase64ToBytes(parsed.privateKey);
    validateKeyPair(publicKey, privateKey);
    if (typeof parsed.id !== 'number') {
      throw new Error(`${protocol} backup: ${idField} missing`);
    }
    return parsed;
  }

  function readIndex(): EncryptedKeyBackupIndexEntry[] {
    try {
      const raw = getCachedSecureSecret(indexSecretKey()) ?? localStorage.getItem(indexKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Record<string, unknown>[];
      if (!Array.isArray(parsed)) return [];
      return parsed.map(
        (e) =>
          ({
            id: e[idField] as number,
            nodeLabel: e.nodeLabel as string | undefined,
            publicKeyB64: e.publicKeyB64 as string,
            backedUpAt: e.backedUpAt as number,
          }) satisfies EncryptedKeyBackupIndexEntry,
      );
    } catch {
      // catch-no-log-ok corrupt index JSON — treat as empty index (rebuild hooks recover it)
      return [];
    }
  }

  async function writeIndex(entries: EncryptedKeyBackupIndexEntry[]): Promise<void> {
    const raw = entries.map((e) => ({
      [idField]: e.id,
      nodeLabel: e.nodeLabel,
      publicKeyB64: e.publicKeyB64,
      backedUpAt: e.backedUpAt,
    }));
    // The index has no private key material; removal and startup repair must
    // still work when OS-backed key storage is temporarily unavailable.
    await setSecureSecret(indexSecretKey(), JSON.stringify(raw));
    localStorage.removeItem(indexKey);
  }

  async function upsertIndexEntry(entry: EncryptedKeyBackupIndexEntry): Promise<void> {
    const id = normalizeId(entry.id);
    const next = readIndex().filter((e) => normalizeId(e.id) !== id);
    next.push({ ...entry, id });
    next.sort((a, b) => b.backedUpAt - a.backedUpAt);
    await writeIndex(next);
  }

  function list(): EncryptedKeyBackupIndexEntry[] {
    return readIndex().filter((entry) => getCachedSecureSecret(secretKey(entry.id)) !== null);
  }

  function has(id: number): boolean {
    return getCachedSecureSecret(secretKey(id)) !== null;
  }

  async function save(options: {
    id: number;
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    nodeLabel?: string;
  }): Promise<void> {
    validateKeyPair(options.publicKey, options.privateKey);
    const id = normalizeId(options.id);
    const payload: EncryptedKeyBackupPayload = {
      protocol,
      id,
      publicKey: keyBackupBytesToBase64(options.publicKey),
      privateKey: keyBackupBytesToBase64(options.privateKey),
      nodeLabel: options.nodeLabel?.trim() || undefined,
      backedUpAt: Date.now(),
    };
    // A backup must survive a restart. Require durability at the write itself,
    // since the panel's earlier keyring probe can become stale.
    await setSecureSecret(secretKey(id), JSON.stringify(toRawPayload(payload)), true);
    localStorage.removeItem(storageKey(id));
    await upsertIndexEntry({
      id,
      nodeLabel: payload.nodeLabel,
      publicKeyB64: payload.publicKey,
      backedUpAt: payload.backedUpAt,
    });
  }

  function load(id: number): Promise<{
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    payload: EncryptedKeyBackupPayload;
  } | null> {
    const stored = getCachedSecureSecret(secretKey(id));
    if (!stored) return Promise.resolve(null);
    const payload = parsePayload(stored);
    return Promise.resolve({
      publicKey: keyBackupBase64ToBytes(payload.publicKey),
      privateKey: keyBackupBase64ToBytes(payload.privateKey),
      payload,
    });
  }

  async function remove(id: number): Promise<void> {
    const normalized = normalizeId(id);
    await removeSecureSecret(secretKey(normalized));
    localStorage.removeItem(storageKey(normalized));
    await writeIndex(readIndex().filter((e) => normalizeId(e.id) !== normalized));
  }

  /** Rebuild the non-sensitive index from secure-store payloads. */
  async function rebuildIndexFromSlots(): Promise<EncryptedKeyBackupIndexEntry[]> {
    const entries: EncryptedKeyBackupIndexEntry[] = [];
    for (const key of listCachedSecureSecretKeys(`backup:${protocol}:`)) {
      const stored = getCachedSecureSecret(key);
      if (!stored) continue;
      try {
        const payload = parsePayload(stored);
        if (payload.id !== Number(key.slice(`backup:${protocol}:`.length))) continue;
        entries.push({
          id: normalizeId(payload.id),
          nodeLabel: payload.nodeLabel,
          publicKeyB64: payload.publicKey,
          backedUpAt: payload.backedUpAt,
        });
      } catch {
        // catch-no-log-ok skip corrupt slot during rebuild
      }
    }
    entries.sort((a, b) => b.backedUpAt - a.backedUpAt);
    await writeIndex(entries);
    return entries;
  }

  function indexNeedsRebuild(index: EncryptedKeyBackupIndexEntry[]): boolean {
    const securePrefix = `backup:${protocol}:`;
    const slotKeys = listCachedSecureSecretKeys(securePrefix);
    if (slotKeys.length === 0) return false;
    if (index.length === 0) return true;
    const indexedIds = new Set(index.map((e) => normalizeId(e.id)));
    return slotKeys.some((key) => {
      const suffix = key.slice(securePrefix.length);
      const id = Number(suffix);
      return Number.isFinite(id) && !indexedIds.has(normalizeId(id));
    });
  }

  /** Rebuild index from encrypted slots when missing, corrupt, or out of sync. Meshtastic-only hook. */
  async function ensureIndex(): Promise<void> {
    const index = readIndex();
    if (indexNeedsRebuild(index)) {
      await rebuildIndexFromSlots();
      return;
    }
    if (getCachedSecureSecret(indexSecretKey()) == null && localStorage.getItem(indexKey) != null) {
      await writeIndex(index);
    }
  }

  /**
   * Migrate a legacy single-slot backup (pre-per-node storage) into per-id storage.
   * Meshtastic-only hook — throws on decrypt/parse failure so the caller can log with its own tag.
   */
  async function migrateLegacySingleSlot(legacyKey: string, id: number): Promise<boolean> {
    const legacy = localStorage.getItem(legacyKey);
    if (!legacy) return false;
    if (protocol !== 'meshtastic') return false;
    const existing = getCachedSecureSecret(secretKey(id));
    if (existing) {
      let existingPayload: EncryptedKeyBackupPayload | null = null;
      try {
        existingPayload = parsePayload(existing);
      } catch {
        // A prior interrupted single-slot migration leaves the legacy shape in this final slot.
        // Re-run the conversion below so it becomes a regular indexed backup payload.
        // catch-no-log-ok Expected intermediate migration shape; the conversion below validates it.
      }
      if (existingPayload) {
        const verified = await migrateLegacyBackupCiphertext(
          'meshtastic',
          normalizeId(id),
          'meshtastic-single',
          legacy,
        );
        if (!verified) return false;
        const verifiedExisting = getCachedSecureSecret(secretKey(id));
        if (!verifiedExisting) return false;
        const payload = parsePayload(verifiedExisting);
        await upsertIndexEntry({
          id: normalizeId(payload.id),
          nodeLabel: payload.nodeLabel,
          publicKeyB64: payload.publicKey,
          backedUpAt: payload.backedUpAt,
        });
        localStorage.removeItem(legacyKey);
        return true;
      }
    }
    const migrated = await migrateLegacyBackupCiphertext(
      'meshtastic',
      normalizeId(id),
      'meshtastic-single',
      legacy,
    );
    if (!migrated) return false;
    const stored = getCachedSecureSecret(secretKey(id));
    if (!stored) return false;
    const parsed = JSON.parse(stored) as { publicKey?: string; privateKey?: string };
    if (!parsed.publicKey || !parsed.privateKey) return false;
    const publicKey = keyBackupBase64ToBytes(parsed.publicKey);
    const privateKey = keyBackupBase64ToBytes(parsed.privateKey);
    validateKeyPair(publicKey, privateKey);
    await save({ id, publicKey, privateKey });
    localStorage.removeItem(legacyKey);
    return true;
  }

  return {
    storageKey,
    parsePayload,
    list,
    has,
    save: (options: Parameters<typeof save>[0]) => mutate(() => save(options)),
    load,
    remove: (id: number) => mutate(() => remove(id)),
    rebuildIndexFromSlots: () => mutate(rebuildIndexFromSlots),
    ensureIndex: () => mutate(ensureIndex),
    migrateLegacySingleSlot: (legacyKey: string, id: number) =>
      mutate(() => migrateLegacySingleSlot(legacyKey, id)),
  };
}
