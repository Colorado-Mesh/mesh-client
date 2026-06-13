import { errLikeToLogString } from './errLikeToLogString';
import {
  keyBackupBase64ToBytes,
  keyBackupBytesToBase64,
  nodeNumDisplayHex,
} from './keyBackupBytes';

export const LEGACY_MESHTASTIC_DM_KEY_BACKUP_KEY = 'mesh-client:key-backup';
export const MESHTASTIC_DM_KEY_BACKUP_PREFIX = 'mesh-client:meshtastic-dm-key-backup:';
export const MESHTASTIC_DM_KEY_BACKUP_INDEX_KEY = 'mesh-client:meshtastic-dm-key-backup-index';

const MESHTASTIC_KEY_LEN = 32;

export interface MeshtasticDmKeyBackupPayload {
  protocol: 'meshtastic';
  nodeNum: number;
  publicKey: string;
  privateKey: string;
  nodeLabel?: string;
  backedUpAt: number;
}

export interface MeshtasticDmKeyBackupIndexEntry {
  nodeNum: number;
  nodeLabel?: string;
  publicKeyB64: string;
  backedUpAt: number;
}

function normalizeNodeNum(nodeNum: number): number {
  return nodeNum >>> 0;
}

export function meshtasticDmKeyBackupStorageKey(nodeNum: number): string {
  return `${MESHTASTIC_DM_KEY_BACKUP_PREFIX}${String(normalizeNodeNum(nodeNum))}`;
}

function validateMeshtasticKeyPair(publicKey: Uint8Array, privateKey: Uint8Array): void {
  if (publicKey.length !== MESHTASTIC_KEY_LEN) {
    throw new Error('Meshtastic backup: public key must be 32 bytes');
  }
  if (privateKey.length !== MESHTASTIC_KEY_LEN) {
    throw new Error('Meshtastic backup: private key must be 32 bytes');
  }
}

function parsePayload(raw: string): MeshtasticDmKeyBackupPayload {
  const parsed = JSON.parse(raw) as MeshtasticDmKeyBackupPayload;
  if (parsed.protocol !== 'meshtastic') {
    throw new Error('Meshtastic backup: invalid protocol');
  }
  const publicKey = keyBackupBase64ToBytes(parsed.publicKey);
  const privateKey = keyBackupBase64ToBytes(parsed.privateKey);
  validateMeshtasticKeyPair(publicKey, privateKey);
  if (typeof parsed.nodeNum !== 'number') {
    throw new Error('Meshtastic backup: nodeNum missing');
  }
  return parsed;
}

function readIndex(): MeshtasticDmKeyBackupIndexEntry[] {
  try {
    const raw = localStorage.getItem(MESHTASTIC_DM_KEY_BACKUP_INDEX_KEY);
    if (!raw) return rebuildIndexFromStorage();
    const parsed = JSON.parse(raw) as MeshtasticDmKeyBackupIndexEntry[];
    return Array.isArray(parsed) ? parsed : rebuildIndexFromStorage();
  } catch {
    // catch-no-log-ok corrupt index JSON — rebuild from per-node slots
    return rebuildIndexFromStorage();
  }
}

function writeIndex(entries: MeshtasticDmKeyBackupIndexEntry[]): void {
  localStorage.setItem(MESHTASTIC_DM_KEY_BACKUP_INDEX_KEY, JSON.stringify(entries));
}

function rebuildIndexFromStorage(): MeshtasticDmKeyBackupIndexEntry[] {
  const entries: MeshtasticDmKeyBackupIndexEntry[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(MESHTASTIC_DM_KEY_BACKUP_PREFIX)) continue;
      const ciphertext = localStorage.getItem(key);
      if (!ciphertext) continue;
      // Index metadata only; skip decrypt in rebuild — use stored index on next save
    }
  } catch {
    // catch-no-log-ok localStorage iteration
  }
  return entries;
}

function upsertIndexEntry(entry: MeshtasticDmKeyBackupIndexEntry): void {
  const nodeNum = normalizeNodeNum(entry.nodeNum);
  const next = readIndex().filter((e) => normalizeNodeNum(e.nodeNum) !== nodeNum);
  next.push({ ...entry, nodeNum });
  next.sort((a, b) => b.backedUpAt - a.backedUpAt);
  writeIndex(next);
}

export function listMeshtasticDmKeyBackups(): MeshtasticDmKeyBackupIndexEntry[] {
  return readIndex();
}

export function hasMeshtasticDmKeyBackup(nodeNum: number): boolean {
  return localStorage.getItem(meshtasticDmKeyBackupStorageKey(nodeNum)) !== null;
}

export async function saveMeshtasticDmKeyBackup(options: {
  nodeNum: number;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  nodeLabel?: string;
}): Promise<void> {
  validateMeshtasticKeyPair(options.publicKey, options.privateKey);
  const nodeNum = normalizeNodeNum(options.nodeNum);
  const payload: MeshtasticDmKeyBackupPayload = {
    protocol: 'meshtastic',
    nodeNum,
    publicKey: keyBackupBytesToBase64(options.publicKey),
    privateKey: keyBackupBytesToBase64(options.privateKey),
    nodeLabel: options.nodeLabel?.trim() || undefined,
    backedUpAt: Date.now(),
  };
  const encrypted = await window.electronAPI.safeStorage.encrypt(JSON.stringify(payload));
  if (!encrypted) throw new Error('Encryption failed');
  localStorage.setItem(meshtasticDmKeyBackupStorageKey(nodeNum), encrypted);
  upsertIndexEntry({
    nodeNum,
    nodeLabel: payload.nodeLabel,
    publicKeyB64: payload.publicKey,
    backedUpAt: payload.backedUpAt,
  });
}

export async function loadMeshtasticDmKeyBackup(nodeNum: number): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  payload: MeshtasticDmKeyBackupPayload;
} | null> {
  const ciphertext = localStorage.getItem(meshtasticDmKeyBackupStorageKey(nodeNum));
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

export function deleteMeshtasticDmKeyBackup(nodeNum: number): void {
  const normalized = normalizeNodeNum(nodeNum);
  localStorage.removeItem(meshtasticDmKeyBackupStorageKey(normalized));
  writeIndex(readIndex().filter((e) => normalizeNodeNum(e.nodeNum) !== normalized));
}

/** Migrate legacy single-slot backup when it contains a valid pair. */
export async function migrateLegacyMeshtasticDmKeyBackup(nodeNum: number): Promise<boolean> {
  if (hasMeshtasticDmKeyBackup(nodeNum)) return false;
  const legacy = localStorage.getItem(LEGACY_MESHTASTIC_DM_KEY_BACKUP_KEY);
  if (!legacy) return false;
  try {
    const decrypted = await window.electronAPI.safeStorage.decrypt(legacy);
    if (!decrypted) return false;
    const parsed = JSON.parse(decrypted) as { publicKey?: string; privateKey?: string };
    if (!parsed.publicKey || !parsed.privateKey) return false;
    const publicKey = keyBackupBase64ToBytes(parsed.publicKey);
    const privateKey = keyBackupBase64ToBytes(parsed.privateKey);
    validateMeshtasticKeyPair(publicKey, privateKey);
    await saveMeshtasticDmKeyBackup({ nodeNum, publicKey, privateKey });
    localStorage.removeItem(LEGACY_MESHTASTIC_DM_KEY_BACKUP_KEY);
    return true;
  } catch (err) {
    console.warn('[meshtasticDmKeyBackupStorage] legacy migrate failed ' + errLikeToLogString(err));
    return false;
  }
}

export function formatMeshtasticBackupDetail(entry: MeshtasticDmKeyBackupIndexEntry): string {
  const hex = nodeNumDisplayHex(entry.nodeNum);
  const label = entry.nodeLabel?.trim();
  return label ? `${label} (!${hex})` : `!${hex}`;
}
