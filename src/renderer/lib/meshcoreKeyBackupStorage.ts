import {
  keyBackupBase64ToBytes,
  keyBackupBytesToBase64,
  nodeNumDisplayHex,
} from './keyBackupBytes';
import { MESHCORE_PUBLIC_KEY_LENGTH } from './letsMeshJwt';

export const MESHCORE_KEY_BACKUP_PREFIX = 'mesh-client:meshcore-key-backup:';
export const MESHCORE_KEY_BACKUP_INDEX_KEY = 'mesh-client:meshcore-key-backup-index';

const MESHCORE_PRIVATE_LENS = [MESHCORE_PUBLIC_KEY_LENGTH, MESHCORE_PUBLIC_KEY_LENGTH * 2] as const;

export interface MeshcoreKeyBackupPayload {
  protocol: 'meshcore';
  nodeId: number;
  publicKey: string;
  privateKey: string;
  nodeLabel?: string;
  backedUpAt: number;
}

export interface MeshcoreKeyBackupIndexEntry {
  nodeId: number;
  nodeLabel?: string;
  publicKeyB64: string;
  backedUpAt: number;
}

function normalizeNodeId(nodeId: number): number {
  return nodeId >>> 0;
}

export function meshcoreKeyBackupStorageKey(nodeId: number): string {
  return `${MESHCORE_KEY_BACKUP_PREFIX}${String(normalizeNodeId(nodeId))}`;
}

function isValidMeshcorePrivateKeyLength(len: number): boolean {
  return MESHCORE_PRIVATE_LENS.some((n) => n === len);
}

function validateMeshcoreKeyPair(publicKey: Uint8Array, privateKey: Uint8Array): void {
  if (publicKey.length !== MESHCORE_PUBLIC_KEY_LENGTH) {
    throw new Error('MeshCore backup: public key must be 32 bytes');
  }
  if (!isValidMeshcorePrivateKeyLength(privateKey.length)) {
    throw new Error('MeshCore backup: private key must be 32 or 64 bytes');
  }
}

function parsePayload(raw: string): MeshcoreKeyBackupPayload {
  const parsed = JSON.parse(raw) as MeshcoreKeyBackupPayload;
  if (parsed.protocol !== 'meshcore') {
    throw new Error('MeshCore backup: invalid protocol');
  }
  const publicKey = keyBackupBase64ToBytes(parsed.publicKey);
  const privateKey = keyBackupBase64ToBytes(parsed.privateKey);
  validateMeshcoreKeyPair(publicKey, privateKey);
  if (typeof parsed.nodeId !== 'number') {
    throw new Error('MeshCore backup: nodeId missing');
  }
  return parsed;
}

function readIndex(): MeshcoreKeyBackupIndexEntry[] {
  try {
    const raw = localStorage.getItem(MESHCORE_KEY_BACKUP_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MeshcoreKeyBackupIndexEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // catch-no-log-ok corrupt index JSON — treat as empty index
    return [];
  }
}

function writeIndex(entries: MeshcoreKeyBackupIndexEntry[]): void {
  localStorage.setItem(MESHCORE_KEY_BACKUP_INDEX_KEY, JSON.stringify(entries));
}

function upsertIndexEntry(entry: MeshcoreKeyBackupIndexEntry): void {
  const nodeId = normalizeNodeId(entry.nodeId);
  const next = readIndex().filter((e) => normalizeNodeId(e.nodeId) !== nodeId);
  next.push({ ...entry, nodeId });
  next.sort((a, b) => b.backedUpAt - a.backedUpAt);
  writeIndex(next);
}

export function listMeshcoreKeyBackups(): MeshcoreKeyBackupIndexEntry[] {
  return readIndex();
}

export function hasMeshcoreKeyBackup(nodeId: number): boolean {
  return localStorage.getItem(meshcoreKeyBackupStorageKey(nodeId)) !== null;
}

export async function saveMeshcoreKeyBackup(options: {
  nodeId: number;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  nodeLabel?: string;
}): Promise<void> {
  validateMeshcoreKeyPair(options.publicKey, options.privateKey);
  const nodeId = normalizeNodeId(options.nodeId);
  const payload: MeshcoreKeyBackupPayload = {
    protocol: 'meshcore',
    nodeId,
    publicKey: keyBackupBytesToBase64(options.publicKey),
    privateKey: keyBackupBytesToBase64(options.privateKey),
    nodeLabel: options.nodeLabel?.trim() || undefined,
    backedUpAt: Date.now(),
  };
  const encrypted = await window.electronAPI.safeStorage.encrypt(JSON.stringify(payload));
  if (!encrypted) throw new Error('Encryption failed');
  localStorage.setItem(meshcoreKeyBackupStorageKey(nodeId), encrypted);
  upsertIndexEntry({
    nodeId,
    nodeLabel: payload.nodeLabel,
    publicKeyB64: payload.publicKey,
    backedUpAt: payload.backedUpAt,
  });
}

export async function loadMeshcoreKeyBackup(nodeId: number): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  payload: MeshcoreKeyBackupPayload;
} | null> {
  const ciphertext = localStorage.getItem(meshcoreKeyBackupStorageKey(nodeId));
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

export function deleteMeshcoreKeyBackup(nodeId: number): void {
  const normalized = normalizeNodeId(nodeId);
  localStorage.removeItem(meshcoreKeyBackupStorageKey(normalized));
  writeIndex(readIndex().filter((e) => normalizeNodeId(e.nodeId) !== normalized));
}

/** Node label / !hex detail for restore picker (protocol prefix applied in UI via i18n). */
export function formatMeshcoreBackupDetail(entry: MeshcoreKeyBackupIndexEntry): string {
  const hex = nodeNumDisplayHex(entry.nodeId);
  const label = entry.nodeLabel?.trim();
  return label ? `${label} (!${hex})` : `!${hex}`;
}
