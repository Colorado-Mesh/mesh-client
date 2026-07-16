import { keyBackupBase64ToBytes, keyBackupBytesToBase64 } from './keyBackupBytes';

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
 * Shared encrypted key-backup storage (MeshCore DM keys, Meshtastic DM keys): per-id encrypted
 * localStorage slot via `window.electronAPI.safeStorage` plus a plaintext index for the restore
 * picker. Meshtastic-only legacy single-slot migration and index-rebuild-from-slots are exposed
 * as opt-in methods rather than folded into `save`/`load` so MeshCore callers don't inherit them.
 */
export function createEncryptedKeyBackupStorage(config: EncryptedKeyBackupStorageConfig) {
  const { prefix, indexKey, protocol, idField, validateKeyPair } = config;

  function storageKey(id: number): string {
    return `${prefix}${String(normalizeId(id))}`;
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
      const raw = localStorage.getItem(indexKey);
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

  function writeIndex(entries: EncryptedKeyBackupIndexEntry[]): void {
    const raw = entries.map((e) => ({
      [idField]: e.id,
      nodeLabel: e.nodeLabel,
      publicKeyB64: e.publicKeyB64,
      backedUpAt: e.backedUpAt,
    }));
    localStorage.setItem(indexKey, JSON.stringify(raw));
  }

  function upsertIndexEntry(entry: EncryptedKeyBackupIndexEntry): void {
    const id = normalizeId(entry.id);
    const next = readIndex().filter((e) => normalizeId(e.id) !== id);
    next.push({ ...entry, id });
    next.sort((a, b) => b.backedUpAt - a.backedUpAt);
    writeIndex(next);
  }

  function listBackupStorageKeys(): string[] {
    const keys: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) keys.push(key);
      }
    } catch {
      // catch-no-log-ok localStorage iteration unavailable
    }
    return keys;
  }

  function list(): EncryptedKeyBackupIndexEntry[] {
    return readIndex();
  }

  function has(id: number): boolean {
    return localStorage.getItem(storageKey(id)) !== null;
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
    const encrypted = await window.electronAPI.safeStorage.encrypt(
      JSON.stringify(toRawPayload(payload)),
    );
    if (!encrypted) throw new Error('Encryption failed');
    localStorage.setItem(storageKey(id), encrypted);
    upsertIndexEntry({
      id,
      nodeLabel: payload.nodeLabel,
      publicKeyB64: payload.publicKey,
      backedUpAt: payload.backedUpAt,
    });
  }

  async function load(id: number): Promise<{
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    payload: EncryptedKeyBackupPayload;
  } | null> {
    const ciphertext = localStorage.getItem(storageKey(id));
    if (!ciphertext) return null;
    const decrypted = await window.electronAPI.safeStorage.decrypt(ciphertext);
    if (!decrypted) throw new Error('Decryption failed');
    const payload = parsePayload(decrypted);
    return {
      publicKey: keyBackupBase64ToBytes(payload.publicKey),
      privateKey: keyBackupBase64ToBytes(payload.privateKey),
      payload,
    };
  }

  function remove(id: number): void {
    const normalized = normalizeId(id);
    localStorage.removeItem(storageKey(normalized));
    writeIndex(readIndex().filter((e) => normalizeId(e.id) !== normalized));
  }

  /** Decrypt every per-id slot and rewrite the index (missing or corrupt index). Meshtastic-only hook. */
  async function rebuildIndexFromSlots(): Promise<EncryptedKeyBackupIndexEntry[]> {
    const entries: EncryptedKeyBackupIndexEntry[] = [];
    for (const key of listBackupStorageKeys()) {
      const ciphertext = localStorage.getItem(key);
      if (!ciphertext) continue;
      try {
        const decrypted = await window.electronAPI.safeStorage.decrypt(ciphertext);
        if (!decrypted) continue;
        const payload = parsePayload(decrypted);
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
    writeIndex(entries);
    return entries;
  }

  function indexNeedsRebuild(index: EncryptedKeyBackupIndexEntry[]): boolean {
    const slotKeys = listBackupStorageKeys();
    if (slotKeys.length === 0) return false;
    if (index.length === 0) return true;
    const indexedIds = new Set(index.map((e) => normalizeId(e.id)));
    return slotKeys.some((key) => {
      const suffix = key.slice(prefix.length);
      const id = Number(suffix);
      return Number.isFinite(id) && !indexedIds.has(normalizeId(id));
    });
  }

  /** Rebuild index from encrypted slots when missing, corrupt, or out of sync. Meshtastic-only hook. */
  async function ensureIndex(): Promise<void> {
    if (!indexNeedsRebuild(readIndex())) return;
    await rebuildIndexFromSlots();
  }

  /**
   * Migrate a legacy single-slot backup (pre-per-node storage) into per-id storage.
   * Meshtastic-only hook — throws on decrypt/parse failure so the caller can log with its own tag.
   */
  async function migrateLegacySingleSlot(legacyKey: string, id: number): Promise<boolean> {
    if (has(id)) return false;
    const legacy = localStorage.getItem(legacyKey);
    if (!legacy) return false;
    const decrypted = await window.electronAPI.safeStorage.decrypt(legacy);
    if (!decrypted) return false;
    const parsed = JSON.parse(decrypted) as { publicKey?: string; privateKey?: string };
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
    save,
    load,
    remove,
    rebuildIndexFromSlots,
    ensureIndex,
    migrateLegacySingleSlot,
  };
}
